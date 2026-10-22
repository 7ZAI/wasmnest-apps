//! Monitor Plugin (WASM, wasm32-wasip3)
//!
//! 只读运行监控：`monitor.snapshot` 把宿主 `host-metrics.snapshot` 的 JSON
//! 原样返回给前端。宿主侧已按 `metrics:read` 权限仲裁（manifest 必须声明），
//! 未授权 / 快照源未装配时返回 `Err` —— 本插件不吞错、不返回空对象冒充
//! 「没有插件」（fail-visible）。
//!
//! 不在本插件做指标二次加工：字段形状即宿主契约（`PluginMetricsSnapshot`），
//! 前端直接消费；此处只做错误上下文补充。

use wasmnest_plugin_api::host::{HostLog, HostMetrics};
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::{WasmHost, WasmPlugin};

const PLUGIN_ID: &str = "com.wasmnest.monitor";

struct MonitorPlugin;

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

    fn invoke_command(name: &str, _args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        match name {
            "monitor.snapshot" => WasmHost
                .metrics_snapshot()
                .map_err(|e| anyhow::anyhow!("metrics:read unavailable: {}", e)),
            _ => Err(anyhow::anyhow!("Unknown command: {}", name)),
        }
    }
}

wasmnest_plugin_api::wasm_entry!(MonitorPlugin);
