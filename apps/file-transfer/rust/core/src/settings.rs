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
    /// 外网接入（relay）端点地址（file-transfer 独立化 T21）。
    ///
    /// 只保存 **relay 端点**（`.../tcp/<port>/p2p/<relay>`），不保存拨号目标；
    /// 空 = 未配置外网接入（仅内网）。应用不自行建立预留——消费方仍是宿主
    /// `host-peer`（见 T21）；本字段先落存储，宿主能力到位后由插件在激活时推送。
    #[serde(default)]
    pub relay_addrs: Vec<String>,
    /// 中继会合空间码（跨 NAT 自动发现的隔离键；双端填同一个才互相可见）。
    ///
    /// 空 = 同一台中继上的所有设备互相可见（自建私有中继的默认口径）。非空时
    /// 插件只把**原文**经本机总线交给宿主，宿主用 SHA-256 派生房间键后发给中继；
    /// 中继永远看不到空间码明文。它不是密码，不参与授权——访问控制仍在目标
    /// 宿主的信任表 + 首连确认。
    #[serde(default)]
    pub relay_room: String,
    /// relay 地址来源：`""` = 手动 / 缓存，`"invite"` = 邀请导入。
    ///
    /// 只影响「中心明确未配置」时是否允许沿用本地缓存：邀请是显式用户动作，
    /// 允许在中心为空时生效；手动缓存仍按 T21 语义不复活。中心已配置时始终
    /// 中心优先（冲突由前端提示，不在后端静默覆盖）。
    #[serde(default)]
    pub relay_origin: String,
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
            relay_addrs: Vec::new(),
            relay_room: String::new(),
            relay_origin: String::new(),
        }
    }
}

/// 钳制并发上限到合法区间（1–8）
pub fn clamp_concurrency(n: u8) -> u8 {
    n.clamp(1, 8)
}

/// 规整并校验 relay 端点地址（`set-settings` 的唯一入口；纯函数，宿主无关）。
///
/// 判据（与能力仓 `wasmnest-p2p-engine/src/relay.rs::RelayEndpoint::parse` 的
/// 端点形状同口径的最小集）：
/// - 必须是以 `/` 开头的 multiaddr，且不含空白；
/// - 必须含 `/tcp/<port>` 与 `/p2p/<relay>`（钉住 relay 身份）；
/// - **不得**含 `/p2p-circuit`（这里存的是 relay 端点，不是经中继的拨号目标）；
/// - 不允许未指定地址（`/ip4/0.0.0.0` / `/ip6/::`）。
///
/// 空列表合法（清除配置）。任何一条不合法整批拒绝并点名——静默丢弃会让
/// 「保存了但没生效」变成不可归因的假故障。
pub fn normalize_relay_addrs(raw: &[String]) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::with_capacity(raw.len());
    for item in raw {
        let addr = item.trim();
        if addr.is_empty() {
            return Err("relay address must not be empty".to_string());
        }
        if !addr.starts_with('/') || addr.chars().any(char::is_whitespace) {
            return Err(format!("relay address is not a multiaddr: `{addr}`"));
        }
        if addr.contains("/p2p-circuit") {
            return Err(format!(
                "relay address must be a relay endpoint, not a circuit target: `{addr}`"
            ));
        }
        if !addr.contains("/tcp/") || !addr.contains("/p2p/") {
            return Err(format!(
                "relay address must be `<transport>/tcp/<port>/p2p/<relay>`: `{addr}`"
            ));
        }
        if addr.contains("/ip4/0.0.0.0") || addr.contains("/ip6/::") {
            return Err(format!("relay address must not be unspecified: `{addr}`"));
        }
        if !out.iter().any(|existing| existing == addr) {
            out.push(addr.to_string());
        }
    }
    Ok(out)
}

/// 空间码校验：空白 = 关闭房间隔离（relay-wide）；非空只允许 `[A-Za-z0-9_-]`，
/// 最长 64。非法值显性报错——静默截断会让两端算出不同房间键。
pub fn normalize_relay_room(raw: &str) -> Result<String, String> {
    let room = raw.trim();
    if room.is_empty() {
        return Ok(String::new());
    }
    if room.len() > 64
        || !room
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("relay room must be 1-64 chars of [A-Za-z0-9_-]".to_string());
    }
    Ok(room.to_string())
}

/// relay 来源校验：只有空串（手动 / 缓存）与 `invite`（邀请导入）两个值。
/// 未知来源显性报错——静默归成一类会让「中心为空时是否复活缓存」的判定漂移。
pub fn normalize_relay_origin(raw: &str) -> Result<String, String> {
    match raw.trim() {
        "" => Ok(String::new()),
        "invite" => Ok("invite".to_string()),
        other => Err(format!("relay origin must be empty or `invite`: `{other}`")),
    }
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
            relay_addrs: Vec::new(),
            relay_room: String::new(),
            relay_origin: String::new(),
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
    fn relay_addrs_roundtrip_and_are_normalized() {
        let h = MockPorts::default();
        let s = TransferSettings {
            relay_addrs: vec!["/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay".to_string()],
            ..Default::default()
        };
        save_and_push(&h, &s).unwrap();
        let back = load(&h).unwrap();
        assert_eq!(back.relay_addrs, s.relay_addrs);
        let raw = h.storage_get(SETTINGS_KEY).unwrap().expect("已写入");
        assert_eq!(
            raw["relayAddrs"],
            serde_json::json!(["/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay"])
        );
    }

    #[test]
    fn relay_addrs_normalization_rejects_invalid_batches() {
        assert_eq!(normalize_relay_addrs(&[]).unwrap(), Vec::<String>::new());
        let ok = normalize_relay_addrs(&[
            " /ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay ".to_string(),
            "/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay".to_string(),
        ])
        .unwrap();
        assert_eq!(
            ok,
            vec!["/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay".to_string()]
        );

        for bad in [
            "",
            "203.0.113.9:4001",
            "/ip4/203.0.113.9/udp/4001/p2p/12D3KooWRelay",
            "/ip4/203.0.113.9/tcp/4001",
            "/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/target",
            "/ip4/0.0.0.0/tcp/4001/p2p/12D3KooWRelay",
            "/ip4/10 0 0 1/tcp/4001/p2p/12D3KooWRelay",
        ] {
            assert!(
                normalize_relay_addrs(&[bad.to_string()]).is_err(),
                "应拒绝非法 relay 地址：{bad}"
            );
        }
    }

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
        assert!(
            l.relay_addrs.is_empty(),
            "旧库缺 relayAddrs = 未配置外网接入"
        );

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

    #[test]
    fn relay_origin_accepts_only_manual_or_invite() {
        assert_eq!(normalize_relay_origin("").expect("manual"), "");
        assert_eq!(normalize_relay_origin("  ").expect("blank"), "");
        assert_eq!(
            normalize_relay_origin(" invite ").expect("invite"),
            "invite"
        );
        assert!(normalize_relay_origin("center").is_err());
        assert!(normalize_relay_origin("invite!").is_err());
    }

    #[test]
    fn relay_room_allows_empty_and_rejects_unsafe() {
        assert_eq!(normalize_relay_room("").expect("empty"), "");
        assert_eq!(normalize_relay_room("  ").expect("blank"), "");
        assert_eq!(normalize_relay_room(" home_1 ").expect("valid"), "home_1");
        assert_eq!(
            normalize_relay_room(&"a".repeat(64)).expect("max"),
            "a".repeat(64)
        );
        assert!(normalize_relay_room(&"a".repeat(65)).is_err());
        assert!(normalize_relay_room("two words").is_err());
        assert!(normalize_relay_room("斜杠/").is_err());
    }
}
