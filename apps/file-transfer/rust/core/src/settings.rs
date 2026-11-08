//! 接收策略与落点设置（真源 = 插件存储键 `transfer_settings`，wire 形状 `SettingsPanel`）。
//!
//! 变更后经保留的引擎原语推送宿主闸门（`set-receive-policy`）与落点（`set-download-dir`）——
//! ADR 0022 v3：二者是引擎安全闸门 / 落盘配置，非业务编排。
//!
//! 落点差异（差异面⑤）：桌面 `download_dir` 由 UI 选择后推送；移动端接收落点固定
//! MediaStore.Downloads、页面无此设置项，故 `download_dir` 恒 `None`、推送分支天然不走
//! ——同一段代码对两端都成立，无需形态位。

use serde::{Deserialize, Serialize};

use crate::ports::{KvStore, PeerPort, PluginProfile, PortResult};

/// 存储键（双端一致）
pub const SETTINGS_KEY: &str = "transfer_settings";

/// 发送并发缺省值（UI 未设置 / 旧存储缺字段时）
///
/// 闸门判据与设置读面**共用此口径**——两处各写一个 `3` 就是「设置显示 3、闸门按别的数
/// 放行」的老 bug 温床。
pub const DEFAULT_CONCURRENCY: u8 = 3;

/// 设置 wire 形状（沿用 SettingsPanel 契约）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSettings {
    /// `ask` | `accept` | `reject`（UI 词表；推送宿主时映射 always_*）
    pub receiving_policy: String,
    /// 同意超时秒（10–600，仅 ask 生效）
    pub approval_timeout_sec: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_dir: Option<String>,
    /// 发送加密固定值（穿透方案不变量 12）：**恒为 `true`，无关闭开关**。
    ///
    /// 旧版本存过 `false` 的库在读取时收紧（见 [`load`]），任何写入口也只落 `true`
    /// （见 [`save_and_push`]）；`set-settings` 传入 `false` 显性报错
    /// （见 [`validate_encryption_patch`]）。
    #[serde(default = "default_encryption")]
    pub encryption: bool,
    /// 发送方向并发上限（1–8）
    #[serde(default = "default_concurrency")]
    pub concurrency: u8,
    /// 是否允许经中继（WAN）传输（T12，缺省开）。
    ///
    /// 关闭只影响**拨号候选**（relay circuit 不进候选表，见 [`crate::dial::dial_plan`]），
    /// **不影响加密**：加密固定开（不变量 12），本字段没有也不得有「关明文」语义。
    #[serde(default = "default_allow_wan")]
    pub allow_wan: bool,
    /// 经中继单任务的「可能较慢」提示阈值（字节，0 = 每次都提示）。
    ///
    /// 只是提示阈值，不是硬限额、不入加密/授权判定：§9.2#4 默认无阈值；用户可调高
    /// 到指定大小以上才提示。真正的中继配额在 relay 服务端（单 circuit 字节 / 时长）。
    #[serde(default)]
    pub relay_max_bytes_per_task: u64,
}

fn default_concurrency() -> u8 {
    DEFAULT_CONCURRENCY
}

/// 中继缺省值（开；关闭 = 只走内网，不涉及加密）
fn default_allow_wan() -> bool {
    true
}

/// 加密缺省值（固定开；`serde(default)` 与 [`Default`] 共用同一常量）
fn default_encryption() -> bool {
    true
}

impl Default for TransferSettings {
    fn default() -> Self {
        TransferSettings {
            receiving_policy: "ask".to_string(),
            approval_timeout_sec: 60,
            download_dir: None,
            encryption: default_encryption(),
            concurrency: default_concurrency(),
            allow_wan: default_allow_wan(),
            relay_max_bytes_per_task: 0,
        }
    }
}

/// 钳制并发上限到合法区间（1–8）
pub fn clamp_concurrency(n: u8) -> u8 {
    n.clamp(1, 8)
}

/// UI 词表 → 宿主策略词表
pub fn policy_to_host(ui_policy: &str) -> &'static str {
    match ui_policy {
        "accept" => "always_accept",
        "reject" => "always_deny",
        _ => "ask",
    }
}

/// 钳制同意超时到合法区间（10–600）
pub fn clamp_timeout(secs: u64) -> u64 {
    secs.clamp(10, 600)
}

/// 接收待应答批的自动应答裁决：accept/reject 返回 `Some(bool)`，ask 返回 `None`
/// （弹窗编排在 UI 层）。
pub fn auto_answer(s: &TransferSettings) -> Option<bool> {
    match s.receiving_policy.as_str() {
        "accept" => Some(true),
        "reject" => Some(false),
        _ => None,
    }
}

// ==================== 存取编排 ====================

/// 读取设置；存储为空返回默认值（纯读语义，不回填）
///
/// 旧版本可能存过 `encryption: false`：读取时一律收紧为 `true`——发送路径
/// 只消费本函数的返回值，收紧发生在这里就能保证「无明文回退」不依赖调用点自觉。
pub fn load<H: KvStore>(h: &H) -> PortResult<TransferSettings> {
    match h.storage_get(SETTINGS_KEY)? {
        Some(v) => {
            let mut settings: TransferSettings = serde_json::from_value(v).map_err(|e| {
                crate::ports::PortError::new(format!("transfer_settings corrupt: {e}"))
            })?;
            settings.encryption = true;
            Ok(settings)
        }
        None => Ok(TransferSettings::default()),
    }
}

/// 读取设置（Phase 4 起引擎旧读接口已退役，历史值由宿主一次性迁移导出到本键，
/// 故这里空值即默认；保留函数名以对齐退役前的调用语义）
pub fn load_or_migrate<H: KvStore>(h: &H) -> PortResult<TransferSettings> {
    load(h)
}

/// 校验 `set-settings` 的加密补丁：禁止关闭（不变量 12），非布尔值也显性报错。
///
/// 这里刻意不「静默改成 true」：旧客户端仍带 `encryption:false` 时，静默改写会让
/// 调用方以为关闭生效、实际仍在加密，行为不可解释；报错让旧入口暴露出来。
pub fn validate_encryption_patch(requested: Option<&serde_json::Value>) -> PortResult<()> {
    match requested {
        None | Some(serde_json::Value::Bool(true)) => Ok(()),
        Some(serde_json::Value::Bool(false)) => Err(crate::ports::PortError::new(
            "encryption cannot be disabled (required)",
        )),
        Some(_) => Err(crate::ports::PortError::new("encryption must be a boolean")),
    }
}

/// 保存设置并推送宿主配置原语（闸门 + 落点）。
///
/// 任一宿主推送失败如实上抛：存储已写入，下次 set 重推即可收敛（不做回滚——策略闸门
/// 宁可是旧值也不能是「存储说 A、闸门收 B」的分裂态）。
///
/// 加密列**强制落 `true`**：即使调用方传了 `false`（旧调用点 / 直写），存储也不会
/// 留下可被后续读取利用的明文开关。
pub fn save_and_push<H: KvStore + PeerPort + PluginProfile>(
    h: &H,
    s: &TransferSettings,
) -> PortResult<()> {
    let mut persisted = s.clone();
    persisted.encryption = true;
    h.storage_set(
        SETTINGS_KEY,
        &serde_json::to_value(&persisted).map_err(serde_err)?,
    )?;
    h.peer_set_receive_policy(
        policy_to_host(&s.receiving_policy),
        clamp_timeout(s.approval_timeout_sec),
    )?;
    // 落点推送按形态位闸门：移动端不接受自定义落点，download_dir 即使有值也不推
    //（否则等于绕过产品形态、静默改接收落点）
    if h.supports_custom_download_dir() {
        if let Some(dir) = &s.download_dir {
            if !dir.is_empty() {
                h.peer_set_download_dir(dir)?;
            }
        }
    }
    Ok(())
}

fn serde_err(e: serde_json::Error) -> crate::ports::PortError {
    crate::ports::PortError::new(format!("transfer_settings serialize failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ports::{KvStore, PeerPort, PluginProfile, PortError, PortResult};
    use serde_json::Value;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// 只覆写被测面的端口夹具：其余方法 `unreachable!`（调用即 panic，不静默通过）
    #[derive(Default)]
    struct MockPorts {
        kv: RefCell<HashMap<String, Value>>,
        pushed_policy: RefCell<Vec<(String, u64)>>,
        pushed_dirs: RefCell<Vec<String>>,
        fail_dir_push: bool,
        /// 形态位：本端是否接受自定义落点（桌面 true / 移动 false）
        custom_download_dir: bool,
    }

    impl KvStore for MockPorts {
        fn storage_get(&self, key: &str) -> PortResult<Option<Value>> {
            Ok(self.kv.borrow().get(key).cloned())
        }
        fn storage_set(&self, key: &str, value: &Value) -> PortResult<()> {
            self.kv.borrow_mut().insert(key.to_string(), value.clone());
            Ok(())
        }
        fn storage_delete(&self, key: &str) -> PortResult<()> {
            self.kv.borrow_mut().remove(key);
            Ok(())
        }
    }

    impl PluginProfile for MockPorts {
        fn supports_custom_download_dir(&self) -> bool {
            self.custom_download_dir
        }
    }

    impl PeerPort for MockPorts {
        fn peer_set_receive_policy(&self, mode: &str, timeout_secs: u64) -> PortResult<()> {
            self.pushed_policy
                .borrow_mut()
                .push((mode.to_string(), timeout_secs));
            Ok(())
        }
        fn peer_set_download_dir(&self, path: &str) -> PortResult<()> {
            if self.fail_dir_push {
                return Err(PortError::new("engine rejected download dir"));
            }
            self.pushed_dirs.borrow_mut().push(path.to_string());
            Ok(())
        }
        fn peer_dial(&self, _e: &Value) -> PortResult<String> {
            unreachable!("未接线")
        }
        fn peer_close(&self, _h: &str) -> PortResult<bool> {
            unreachable!("未接线")
        }
        fn peer_respond_consent(&self, _r: &str, _a: bool) -> PortResult<bool> {
            unreachable!()
        }
        fn peer_list_trusted(&self) -> PortResult<Value> {
            unreachable!()
        }
        fn peer_revoke_trusted(&self, _n: &str) -> PortResult<bool> {
            unreachable!()
        }
        fn peer_send_files(&self, _s: &str, _p: &[Value]) -> PortResult<String> {
            unreachable!()
        }
        fn peer_respond_transfer(&self, _b: &str, _a: bool) -> PortResult<()> {
            unreachable!()
        }
        fn peer_pause_transfer(&self, _b: &str) -> PortResult<()> {
            unreachable!()
        }
        fn peer_resume_transfer(&self, _b: &str) -> PortResult<()> {
            unreachable!()
        }
        fn peer_set_shared_roots(&self, _d: &[Value]) -> PortResult<()> {
            unreachable!()
        }
        fn peer_list_shared_roots(&self, _s: &str) -> PortResult<Value> {
            unreachable!()
        }
        fn peer_browse_directory(&self, _s: &str, _d: &str, _r: &str) -> PortResult<Value> {
            unreachable!()
        }
        fn peer_pull_files(&self, _s: &str, _d: &str, _f: &[Value]) -> PortResult<u32> {
            unreachable!()
        }
        fn peer_active_transfers(&self) -> PortResult<Value> {
            unreachable!()
        }
        fn peer_collect_outgoing(&self, _p: &[Value]) -> PortResult<Value> {
            unreachable!()
        }
    }

    #[test]
    fn save_and_push_writes_storage_and_clamped_host_primitives() {
        // 桌面形态：接受自定义落点
        let h = MockPorts {
            custom_download_dir: true,
            ..Default::default()
        };
        let s = TransferSettings {
            receiving_policy: "accept".into(),
            approval_timeout_sec: 999,
            download_dir: Some("D:/dl".into()),
            encryption: true,
            concurrency: 5,
            allow_wan: false,
            relay_max_bytes_per_task: 1_073_741_824,
        };
        save_and_push(&h, &s).unwrap();
        assert_eq!(
            h.pushed_policy.borrow().as_slice(),
            &[("always_accept".to_string(), 600u64)][..]
        );
        assert_eq!(
            h.pushed_dirs.borrow().as_slice(),
            &["D:/dl".to_string()][..]
        );
        // 回读一致（含未钳制的原始值——钳制只作用于推送面）
        assert_eq!(load(&h).unwrap(), s);
    }

    #[test]
    fn download_dir_push_is_skipped_when_absent_or_empty() {
        let h = MockPorts {
            custom_download_dir: true,
            ..Default::default()
        };
        save_and_push(&h, &TransferSettings::default()).unwrap();
        let empty = TransferSettings {
            download_dir: Some(String::new()),
            ..Default::default()
        };
        save_and_push(&h, &empty).unwrap();
        assert!(h.pushed_dirs.borrow().is_empty(), "空/缺失落点不得推送宿主");
    }

    #[test]
    fn download_dir_push_is_skipped_when_end_does_not_support_custom_dir() {
        // 移动端形态：落点固定 MediaStore.Downloads。存储里即使残留非空 download_dir
        //（异常数据 / 手工写入），也**不得**推给宿主——推了就是静默改接收落点。
        let h = MockPorts::default();
        let s = TransferSettings {
            download_dir: Some("content://tree/1".into()),
            ..Default::default()
        };
        save_and_push(&h, &s).unwrap();
        assert!(
            h.pushed_dirs.borrow().is_empty(),
            "本端不支持自定义落点时不得推落点"
        );
        // 但策略闸门照常推（形态位只闸落点，不闸接收策略）
        assert_eq!(h.pushed_policy.borrow().len(), 1);
        // 设置本身照常落存储（前端仍可读回原值，避免「保存后值莫名变了」）
        assert_eq!(
            load(&h).unwrap().download_dir.as_deref(),
            Some("content://tree/1")
        );
    }

    #[test]
    fn failed_download_dir_push_is_reported_not_swallowed() {
        let h = MockPorts {
            fail_dir_push: true,
            custom_download_dir: true,
            ..Default::default()
        };
        let s = TransferSettings {
            download_dir: Some("D:/dl".into()),
            ..Default::default()
        };
        let err = save_and_push(&h, &s).unwrap_err();
        assert!(
            err.message().contains("engine rejected download dir"),
            "实得 {err}"
        );
    }

    #[test]
    fn concurrency_defaults_to_three_and_clamps_into_range() {
        let h = MockPorts::default();
        h.storage_set(
            SETTINGS_KEY,
            &serde_json::json!({"receivingPolicy": "ask", "approvalTimeoutSec": 60, "encryption": false}),
        )
        .unwrap();
        assert_eq!(load(&h).unwrap().concurrency, DEFAULT_CONCURRENCY);
        assert_eq!(clamp_concurrency(0), 1);
        assert_eq!(clamp_concurrency(9), 8);
        assert_eq!(clamp_concurrency(5), 5);
    }

    #[test]
    fn load_or_migrate_returns_default_when_storage_empty_and_value_when_present() {
        let h = MockPorts::default();
        assert_eq!(load_or_migrate(&h).unwrap(), TransferSettings::default());
        h.storage_set(
            SETTINGS_KEY,
            &serde_json::json!({"receivingPolicy": "reject", "approvalTimeoutSec": 30, "encryption": true}),
        )
        .unwrap();
        assert_eq!(load_or_migrate(&h).unwrap().receiving_policy, "reject");
    }

    // ==================== 不变量 12：加密固定开启 ====================

    #[test]
    fn encryption_defaults_to_true() {
        assert!(TransferSettings::default().encryption, "缺省必须加密");
    }

    #[test]
    fn stored_disabled_encryption_is_tightened_on_load() {
        // 旧版本存过 false：读取即使明明存量里的值不是 true 也收紧（不依赖调用点自觉）
        let h = MockPorts::default();
        h.storage_set(
            SETTINGS_KEY,
            &serde_json::json!({"receivingPolicy": "ask", "approvalTimeoutSec": 60, "encryption": false}),
        )
        .unwrap();
        assert!(load(&h).unwrap().encryption, "存量 false 必须在读面收紧");
    }

    #[test]
    fn save_and_push_never_persists_disabled_encryption() {
        let h = MockPorts::default();
        let s = TransferSettings {
            encryption: false,
            ..Default::default()
        };
        save_and_push(&h, &s).unwrap();
        let raw = h.storage_get(SETTINGS_KEY).unwrap().expect("已写入");
        assert_eq!(
            raw.get("encryption").and_then(|v| v.as_bool()),
            Some(true),
            "写入面不得落明文开关，实际 {raw}"
        );
        assert!(load(&h).unwrap().encryption);
    }

    #[test]
    fn validate_encryption_patch_rejects_disable_and_non_bool() {
        assert!(
            validate_encryption_patch(None).is_ok(),
            "未指定加密时不应报错"
        );
        assert!(validate_encryption_patch(Some(&serde_json::json!(true))).is_ok());

        let disabled = validate_encryption_patch(Some(&serde_json::json!(false))).unwrap_err();
        assert!(
            disabled.message().contains("cannot be disabled"),
            "实得 {disabled}"
        );

        let wrong_type = validate_encryption_patch(Some(&serde_json::json!("false"))).unwrap_err();
        assert!(
            wrong_type.message().contains("must be a boolean"),
            "实得 {wrong_type}"
        );
    }

    // ==================== T12：中继设置 ====================

    #[test]
    fn wan_defaults_to_enabled_without_touching_encryption() {
        let s = TransferSettings::default();
        assert!(s.allow_wan, "中继缺省开（用户可关，但关的不是加密）");
        assert_eq!(s.relay_max_bytes_per_task, 0, "§9.2#4：默认无阈值");
        assert!(s.encryption, "中继开关与加密正交（不变量 12）");
    }

    #[test]
    fn relay_settings_roundtrip_and_legacy_storage_defaults_them() {
        let h = MockPorts::default();
        // 旧库存没有两个新字段：读取不得报错（否则升级即丢设置）
        h.storage_set(
            SETTINGS_KEY,
            &serde_json::json!({"receivingPolicy": "ask", "approvalTimeoutSec": 60, "encryption": true}),
        )
        .unwrap();
        let l = load(&h).unwrap();
        assert!(l.allow_wan);
        assert_eq!(l.relay_max_bytes_per_task, 0);

        let s = TransferSettings {
            allow_wan: false,
            relay_max_bytes_per_task: 5_000_000_000,
            ..Default::default()
        };
        save_and_push(&h, &s).unwrap();
        let back = load(&h).unwrap();
        assert!(!back.allow_wan);
        assert_eq!(back.relay_max_bytes_per_task, 5_000_000_000);
        assert!(back.encryption, "关闭中继不得把加密也关掉");
        // 存储面同样保留两个字段（前端读回真源）
        let raw = h.storage_get(SETTINGS_KEY).unwrap().expect("已写入");
        assert_eq!(raw["allowWan"], serde_json::json!(false));
        assert_eq!(
            raw["relayMaxBytesPerTask"],
            serde_json::json!(5_000_000_000u64)
        );
    }

    #[test]
    fn corrupt_storage_is_reported_not_silently_defaulted() {
        // 关键：损坏值必须显性报错，改成「解析失败就返回默认」会让用户设置被静默重置
        let h = MockPorts::default();
        h.storage_set(SETTINGS_KEY, &serde_json::json!("not-an-object"))
            .unwrap();
        let err = load(&h).unwrap_err();
        assert!(
            err.message().contains("transfer_settings corrupt"),
            "实得 {err}"
        );
    }

    #[test]
    fn auto_answer_maps_three_branches_and_policy_word_mapping_is_stable() {
        assert_eq!(auto_answer(&TransferSettings::default()), None);
        assert_eq!(
            auto_answer(&TransferSettings {
                receiving_policy: "accept".into(),
                ..Default::default()
            }),
            Some(true)
        );
        assert_eq!(
            auto_answer(&TransferSettings {
                receiving_policy: "reject".into(),
                ..Default::default()
            }),
            Some(false)
        );
        // 未知词表按 ask（fail-safe：不静默变成自动接受）
        assert_eq!(
            auto_answer(&TransferSettings {
                receiving_policy: "".into(),
                ..Default::default()
            }),
            None
        );
        assert_eq!(policy_to_host("accept"), "always_accept");
        assert_eq!(policy_to_host("reject"), "always_deny");
        assert_eq!(policy_to_host("ask"), "ask");
        assert_eq!(clamp_timeout(5), 10);
        assert_eq!(clamp_timeout(700), 600);
    }
}
