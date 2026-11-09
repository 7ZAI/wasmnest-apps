//! Monitor Plugin (WASM, wasm32-wasip3)
//!
//! 只读运行监控：`monitor.snapshot` 把宿主 `host-metrics.snapshot` 的 JSON
//! 原样返回给前端。宿主侧已按 `metrics:read` 权限仲裁（manifest 必须声明），
//! 未授权 / 快照源未装配时返回 `Err` —— 本插件不吞错、不返回空对象冒充
//! 「没有插件」（fail-visible）。
//!
//! 不在本插件做指标二次加工：字段形状即宿主契约（`PluginMetricsSnapshot`），
//! 前端直接消费；此处只做错误上下文补充。
//!
//! `monitor.notify`：把前端的预警文案经宿主 `host-notify`（共享域契约）投递。
//! 文案由前端 i18n 构造、原样透传；能力未装配 / 权限拒绝时返回 `Err`，前端只
//! 记录提示——通知是锦上添花，页内告警才是权威面。

use wasmnest_plugin_api::host::{HostLog, HostMetrics, HostNotify, NotifyOptions};
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::{WasmHost, WasmPlugin};

const PLUGIN_ID: &str = "com.wasmnest.monitor";

struct MonitorPlugin;

/// `monitor.notify` 入参（前端 i18n 已拼好文案，宿主不再加工）
#[derive(serde::Deserialize)]
struct NotifyRequest {
    title: String,
    body: String,
}

impl WasmPlugin for MonitorPlugin {
    const ID: &'static str = PLUGIN_ID;

    fn manifest() -> PluginManifest {
        serde_json::from_str(include_str!("../../plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        // 不读文件、不弹授权：指标读取的权限门在宿主 host-metrics 调用点。
        WasmHost.log_info("Plugin activated (runtime metrics, read-only)");
        Ok(())
    }

    fn deactivate() -> anyhow::Result<()> {
        WasmHost.log_info("Plugin deactivated");
        Ok(())
    }

    fn invoke_command(name: &str, args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        match name {
            "monitor.snapshot" => WasmHost
                .metrics_snapshot()
                .map_err(|e| anyhow::anyhow!("metrics:read unavailable: {}", e)),
            "monitor.notify" => {
                let request: NotifyRequest = serde_json::from_value(args).map_err(|e| {
                    anyhow::anyhow!("monitor.notify expects {{title, body}}: {}", e)
                })?;
                let title = request.title.trim();
                let body = request.body.trim();
                if title.is_empty() || body.is_empty() {
                    return Err(anyhow::anyhow!(
                        "monitor.notify requires a non-empty title and body"
                    ));
                }
                WasmHost
                    .notify(title, body, &NotifyOptions::new())
                    .map_err(|e| anyhow::anyhow!("notify unavailable: {}", e))?;
                Ok(serde_json::json!({ "delivered": true }))
            }
            _ => Err(anyhow::anyhow!("Unknown command: {}", name)),
        }
    }
}

wasmnest_plugin_api::wasm_entry!(MonitorPlugin);

#[cfg(test)]
mod tests {
    use super::*;

    /// 空文案 / 缺字段在宿主调用之前显式报错（校验先于 notify 原语，native 可测）
    #[test]
    fn notify_rejects_empty_or_missing_text_before_host_call() {
        for (args, expect) in [
            (serde_json::json!({ "title": "", "body": "x" }), "non-empty"),
            (
                serde_json::json!({ "title": "  ", "body": "x" }),
                "non-empty",
            ),
            (serde_json::json!({ "title": "x", "body": "" }), "non-empty"),
            (serde_json::json!({ "title": "x" }), "expects"),
        ] {
            let err = MonitorPlugin::invoke_command("monitor.notify", args)
                .expect_err("空文案/缺字段必须报错");
            assert!(err.to_string().contains(expect), "got: {err}");
        }
    }

    /// 未知命令显性报错（不静默返回空对象冒充成功）
    #[test]
    fn unknown_command_is_rejected() {
        let err = MonitorPlugin::invoke_command("monitor.nope", serde_json::json!({}))
            .expect_err("未知命令必须报错");
        assert!(err.to_string().contains("Unknown command"), "got: {err}");
    }
}
