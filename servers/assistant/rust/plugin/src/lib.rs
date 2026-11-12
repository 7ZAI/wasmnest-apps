//! Nest 助手插件（WASM，双端同构共享 crate · 票 05 骨架）
//!
//! 骨架阶段只导出 `assistant.ping` 一条命令：证明「前端 appInvoke → 共享
//! crate `invoke_command` → 宿主返回」链路在双端都通。真实命令面（对话流 /
//! 保险库 / 记忆 / 审计，spec 附录 A）随票 07–14 加入，未知命令一律显性报错，
//! 不静默返回空对象冒充成功（spec §2.4 失败语义）。
//!
//! 清单真源 = 桌面端 `desktop/plugin.json`（spec 附录 A 草案）；共享 crate 不
//! 属于任何一端，`manifest()` 读桌面端清单（移动端 plugin.json 同形状，仅
//! `platform` 字段不同，与 file-transfer 单产物口径一致）。

use wasmnest_plugin_api::host::HostLog;
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::{WasmHost, WasmPlugin};

const PLUGIN_ID: &str = "com.wasmnest.assistant";

struct AssistantPlugin;

impl WasmPlugin for AssistantPlugin {
    const ID: &'static str = PLUGIN_ID;

    fn manifest() -> PluginManifest {
        serde_json::from_str(include_str!("../../../desktop/plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        WasmHost.log_info("Nest assistant skeleton activated (ping wiring only)");
        Ok(())
    }

    fn deactivate() -> anyhow::Result<()> {
        WasmHost.log_info("Nest assistant skeleton deactivated");
        Ok(())
    }

    fn invoke_command(name: &str, _args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        match name {
            "assistant.ping" => Ok(serde_json::json!({
                "ok": true,
                "appId": PLUGIN_ID,
            })),
            other => Err(anyhow::anyhow!("Unknown assistant command: {other}")),
        }
    }
}

wasmnest_plugin_api::wasm_entry!(AssistantPlugin);

#[cfg(test)]
mod tests {
    use super::*;

    /// ping 回显插件身份（双端同源，可与其它应用区分）
    #[test]
    fn ping_echoes_plugin_identity() {
        let result = AssistantPlugin::invoke_command("assistant.ping", serde_json::json!({}))
            .expect("ping 必须成功");
        assert_eq!(result["ok"], serde_json::json!(true));
        assert_eq!(result["appId"], serde_json::json!(PLUGIN_ID));
    }

    /// 未知命令显性报错（不静默返回空对象冒充成功）
    #[test]
    fn unknown_command_is_rejected() {
        let err = AssistantPlugin::invoke_command("assistant.nope", serde_json::json!({}))
            .expect_err("未知命令必须报错");
        assert!(err.to_string().contains("Unknown assistant command"), "got: {err}");
    }
}
