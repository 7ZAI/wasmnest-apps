//! Network Config Plugin (WASM, wasm32-wasip3)
//!
//! 穿透配置中心（T18，B 方案）：把「中继地址」从各应用私有配置提升为**跨应用共享
//! 的唯一真源**，并维护一张按插件 id 的「是否允许外网」注册表。
//!
//! ## 边界（一句话）
//!
//! **本中心统一的是配置来源，不是穿透执行**：业务仍按自己的 `tunnel:serve` /
//! `tunnel:connect` 权限与时机调宿主 `host-tunnel`；本中心不代任何业务
//! `expose` / `connect` / 签发配对票据（那等于开权限借用后门）。
//!
//! ## 为什么是 L2（`internal-business`）
//!
//! 宿主固定按 L1 → L2 → L3 装配，L2 先于所有业务应用（L3）就绪，业务启动时调用
//! 本中心不会「先调后起」。本中心**不**注册任何网关裁决，只借用该档位的装配顺序。
//!
//! ## 数据面
//!
//! 两份版本化配置住本插件私有 KV（[`model`]）：
//!
//! - `network.relay`：relay 寻址（沿用 T14 形态，`relayAddrs` 是唯一地址真源）；
//! - `network.wanPolicy`：业务 WAN 注册表（只存策略，不存端口 / 暴露规则）。
//!
//! 损坏语义：**只报错、不静默清除**；显式移除才删键。
//!
//! ## 互调 api（只读面 + 一条收养例外）
//!
//! - `relay-config`：取当前 relay 配置（未配置 = `{configured:false}`）；
//! - `wan-policy`：取业务 WAN 注册表；
//! - `relay-adopt`：幂等收养（BedCode 迁移本地旧配置；目标已有值时不覆盖）。
//!
//! 导入 / 移除 / 改注册表**不暴露为互调**，只走本服务命令面与设置页——避免任意
//! 插件改全局地址。互调准入判据是目标 api 的声明登记，不需要额外权限位。

#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

mod model;
mod ops;
mod store;

use serde_json::Value;
use store::HostStore;
// `HostBus` 供 `#[plugin_api]` 生成的 `Dispatcher::register()` 使用（订阅请求
// topic）——trait 不在作用域内时宏展开会报「no method bus_subscribe」。
use wasmnest_plugin_api::host::{HostBus, HostLog};
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::{plugin_api, BusMessage, WasmHost, WasmPlugin};

const PLUGIN_ID: &str = "com.wasmnest.net-config";

/// 从命令参数里取配置载荷：只接受 `{config: {...}}`
///
/// **不接受**任意键值包装（保存 / 收养都只认与 `network.relay` 同构的载荷）；
/// 互调 `relay-adopt` 的入参本身就是裸载荷（trait 参数直接接收）。
fn config_arg(args: &Value) -> Result<Value, String> {
    match args.get("config") {
        Some(value) if value.is_object() => Ok(value.clone()),
        Some(_) => Err("config must be an object".to_string()),
        None => Err("config required".to_string()),
    }
}

/// 命令分发（与 `WasmPlugin::invoke_command` 同一实现，抽出来供 native 单测直调）
fn dispatch_command(name: &str, args: Value) -> anyhow::Result<Value> {
    let store = HostStore;
    match name {
        "net-config.status" => Ok(ops::status_view(&store)),
        "net-config.relay.get" => ops::relay_config_view(&store).map_err(anyhow::Error::msg),
        "net-config.relay.save" => {
            let raw = config_arg(&args).map_err(anyhow::Error::msg)?;
            let saved =
                ops::save_relay(&store, &raw, ops::now_secs()).map_err(anyhow::Error::msg)?;
            serde_json::to_value(saved)
                .map_err(|e| anyhow::anyhow!("relay settings serialize: {}", e))
        }
        "net-config.relay.clear" => {
            ops::clear_relay(&store).map_err(anyhow::Error::msg)?;
            Ok(serde_json::json!({ "cleared": true }))
        }
        "net-config.relay.adopt" => {
            let raw = config_arg(&args).map_err(anyhow::Error::msg)?;
            ops::adopt_relay(&store, &raw, ops::now_secs()).map_err(anyhow::Error::msg)
        }
        "net-config.wan-policy.get" => {
            let policy = ops::load_policy(&store).map_err(anyhow::Error::msg)?;
            serde_json::to_value(policy).map_err(|e| anyhow::anyhow!("wan policy serialize: {}", e))
        }
        "net-config.wan-policy.set" => {
            let plugin_id = args
                .get("pluginId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| anyhow::anyhow!("pluginId required"))?
                .to_string();
            let allow_wan = args
                .get("allowWan")
                .and_then(Value::as_bool)
                .ok_or_else(|| anyhow::anyhow!("allowWan required (boolean)"))?;
            let note = args
                .get("note")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let policy = ops::set_policy(&store, &plugin_id, allow_wan, &note, ops::now_secs())
                .map_err(anyhow::Error::msg)?;
            serde_json::to_value(policy).map_err(|e| anyhow::anyhow!("wan policy serialize: {}", e))
        }
        other => Err(anyhow::anyhow!("Unknown command: {}", other)),
    }
}

// ==================== 互调 api 面（ADR 0017） ====================

/// 网络配置中心对外互调契约（声明方）
///
/// 方法名 ↔ manifest `api` 条目（`com.wasmnest.net-config.<方法>`）；`#[plugin_api]`
/// 在编译期比对防漂移（`plugin.json` 是唯一真源）。
///
/// 只读面给所有业务（BedCode / FileTransfer / 后续接入方）读 relay 地址与注册表；
/// `relay-adopt` 是唯一的写例外（幂等、目标已有值不覆盖），供 BedCode 迁移。
///
/// **已知边界（L9）**：当前 `host-api-call` 不向被调方携带调用方身份，所以
/// `relay-adopt` 无法在中心侧按调用方白名单收窄——中心只能靠「仅补空、不覆盖」
/// 把投毒面压到「中心为空时的先到先写」。若后续插件面扩大，必须先让宿主传递
/// caller 身份再在此加准入，不要用额外权限位代替身份校验。
#[plugin_api(manifest = "../plugin.json")]
pub trait NetConfigApi {
    /// 当前 relay 配置：`{configured, config}`（未配置不是错误）
    #[api("relay-config")]
    fn relay_config() -> Result<Value, String>;

    /// 业务 WAN 注册表：`{version, apps: {<pluginId>: {allowWan, note, updatedAt}}}`
    #[api("wan-policy")]
    fn wan_policy() -> Result<Value, String>;

    /// 幂等收养一份与 `network.relay` 同构的载荷 → `{adopted, reason?}`
    #[api("relay-adopt")]
    fn relay_adopt(config: Value) -> Result<Value, String>;
}

impl NetConfigApi for NetConfigPlugin {
    fn relay_config() -> Result<Value, String> {
        ops::relay_config_view(&HostStore)
    }

    fn wan_policy() -> Result<Value, String> {
        let policy = ops::load_policy(&HostStore)?;
        serde_json::to_value(policy).map_err(|e| format!("wan policy serialize: {e}"))
    }

    fn relay_adopt(config: Value) -> Result<Value, String> {
        ops::adopt_relay(&HostStore, &config, ops::now_secs())
    }
}

struct NetConfigPlugin;

impl WasmPlugin for NetConfigPlugin {
    const ID: &'static str = PLUGIN_ID;

    fn manifest() -> PluginManifest {
        serde_json::from_str(include_str!("../../plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        // 互调 api 面：订阅本 trait 声明的全部请求 topic。失败即激活失败——
        // 订不到就是「调用方永远等不到回执」的静默断裂。
        NetConfigApiDispatcher::register()?;
        // 就位自检：只读一次存储，损坏只留痕（不阻断激活：页面要能打开并显示原因）。
        let status = ops::status_view(&HostStore);
        if status["relayError"].is_string() {
            WasmHost.log_warn(&format!(
                "net-config relay storage unreadable at activate (kept as-is; page will report): {}",
                status["relayError"].as_str().unwrap_or("")
            ));
        }
        if status["wanError"].is_string() {
            WasmHost.log_warn(&format!(
                "net-config wan policy unreadable at activate (kept as-is; page will report): {}",
                status["wanError"].as_str().unwrap_or("")
            ));
        }
        WasmHost.log_info(&format!(
            "net-config activated (relay keys: {}, wan policy apps: {})",
            if status["configured"].as_bool().unwrap_or(false) {
                "configured"
            } else {
                "unconfigured"
            },
            status["wanApps"].as_u64().unwrap_or(0)
        ));
        Ok(())
    }

    fn deactivate() -> anyhow::Result<()> {
        WasmHost.log_info("net-config deactivated (configuration retained in plugin KV)");
        Ok(())
    }

    fn invoke_command(name: &str, args: Value) -> anyhow::Result<Value> {
        dispatch_command(name, args)
    }

    /// 互调 api 面：把宿主投递的请求转给宏生成的分派器（否则无人回响应）
    fn on_message(msg: &BusMessage) -> anyhow::Result<()> {
        NetConfigApiDispatcher::dispatch::<Self>(msg)?;
        Ok(())
    }
}

wasmnest_plugin_api::wasm_entry!(NetConfigPlugin);

// ==================== native 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{RELAY_KEY, WAN_POLICY_KEY};

    #[test]
    fn manifest_api_matches_declared_surface() {
        let manifest = NetConfigPlugin::manifest();
        let mut expected = NetConfigApiDispatcher::API_NAMES
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        expected.sort();
        let mut actual = manifest.api.clone();
        actual.sort();
        assert_eq!(actual, expected, "manifest api 必须与 trait 声明一致");
        assert_eq!(
            manifest.api.len(),
            3,
            "只读两条 + 收养一条（写操作不暴露为互调）"
        );
        assert_eq!(
            manifest.permissions,
            vec!["storage".to_string()],
            "中心不碰网络 / 隧道 / 进程：只声明 storage"
        );
    }

    #[test]
    fn dispatch_rejects_unknown_command() {
        let err = dispatch_command("net-config.nope", serde_json::json!(null)).unwrap_err();
        assert!(err.to_string().contains("Unknown command"), "{err}");
    }

    #[test]
    fn storage_faces_fail_loudly_on_native() {
        for name in [
            "net-config.relay.get",
            "net-config.wan-policy.get",
            "net-config.relay.clear",
        ] {
            let err =
                dispatch_command(name, serde_json::json!({})).expect_err("native 必须显性失败");
            assert!(
                err.to_string().contains("outside wasm runtime"),
                "{name} 未接到存储层: {err}"
            );
        }
    }

    #[test]
    fn save_validates_payload_before_touching_storage() {
        let err = dispatch_command(
            "net-config.relay.save",
            serde_json::json!({ "config": { "version": 99 } }),
        )
        .expect_err("未知版本必须拒绝");
        assert!(err.to_string().contains("version"), "{err}");

        let err = dispatch_command("net-config.relay.save", serde_json::json!({}))
            .expect_err("缺 config 必须报错");
        assert!(err.to_string().contains("config"), "{err}");
    }

    #[test]
    fn wan_policy_set_requires_valid_arguments() {
        for (args, needle) in [
            (serde_json::json!({}), "pluginId required"),
            (
                serde_json::json!({ "pluginId": "com.wasmnest.bedcode" }),
                "allowWan required",
            ),
            (
                serde_json::json!({ "pluginId": "not-a-plugin-id", "allowWan": true }),
                "invalid plugin id",
            ),
        ] {
            let err = dispatch_command("net-config.wan-policy.set", args).expect_err("必须报错");
            assert!(err.to_string().contains(needle), "{needle}: {err}");
        }
    }

    #[test]
    fn api_dispatch_is_wired_in_on_message() {
        let src = include_str!("lib.rs");
        assert!(
            src.contains("NetConfigApiDispatcher::register()?"),
            "activate 必须订阅互调请求 topic"
        );
        let start = src
            .find("    fn on_message(msg: &BusMessage) -> anyhow::Result<()> {")
            .expect("WasmPlugin 必须实现 on_message");
        let tail = &src[start..];
        let end = tail.find("\n    }\n").expect("on_message 函数体边界");
        assert!(
            tail[..end].contains("NetConfigApiDispatcher::dispatch::<Self>(msg)"),
            "on_message 必须分派给 NetConfigApiDispatcher（否则消费方 5s 超时）"
        );
    }

    #[test]
    fn storage_keys_are_the_documented_ones() {
        assert_eq!(RELAY_KEY, "network.relay");
        assert_eq!(WAN_POLICY_KEY, "network.wanPolicy");
    }
}
