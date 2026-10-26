//! Monitor Plugin (WASM, Mobile)
//!
//! 只读运行监控：`monitor.snapshot` 把宿主 `host-metrics.snapshot` 的 JSON
//! 原样返回给前端。宿主侧已按 `metrics:read` 权限仲裁（manifest 必须声明），
//! 未授权 / 快照源未装配时返回 `Err` —— 本插件不吞错、不返回空对象冒充
//! 「没有插件」（fail-visible）。
//!
//! host 目标（cargo test/build）下 SDK 的 wasm_entry! 不生成任何导出（仅 wasm32
//! 目标），pub 命令面在 host 构建中被判 dead_code —— SDK ABI 有意设计，故仅对
//! 非 wasm32 目标放宽该 lint。
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use wasmnest_plugin_api_mobile::host::{HostLog, HostMetrics};
use wasmnest_plugin_api_mobile::types::PluginManifest;
use wasmnest_plugin_api_mobile::{WasmHost, WasmPlugin};

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
        WasmHost.log_info("Plugin activated (runtime metrics, read-only, mobile)");
        Ok(())
    }

    fn deactivate() -> anyhow::Result<()> {
        WasmHost.log_info("Plugin deactivated (mobile)");
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

wasmnest_plugin_api_mobile::wasm_entry!(MonitorPlugin);
