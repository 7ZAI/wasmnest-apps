//! Lanbitou Plugin (WASM, wasm32-wasip3)
//!
//! 轻量级 Markdown 记事本插件：文件系统存储 + 自动保存 + 时间分隔符 + 剪贴板集成。
//!
//! **文件访问经宿主 `host-fs` 原语**（`store.rs` 全部 IO 走它，不经 WASI）：
//! WASI 0.3 的 filesystem 方法是 `async func`，而插件导出（`activate` /
//! `invoke_command`…）是 sync-lifted——wasmtime 进入 sync 导出时会清掉 task 的
//! `may_block` 标志，guest 一旦等待 async import 即 trap
//! `wasm trap: cannot block a synchronous task before returning`
//! （CannotBlockSyncTask），故 wasip3 目标下必须走宿主 fs 原语。
//!
//! 数据根 = `{HomeDir}/.wasmnest/lanbitou`；激活时经 `fs_request_auth` 集中申请
//! 一次目录授权（同意后宿主持久化记住，后续逐调用免弹窗），拒绝/超时 → 激活失败
//! （Error 状态），重新启用可重试。

mod commands;
mod store;

use std::sync::OnceLock;

use wasmnest_plugin_api::host::{ConfigKey, HostConfig, HostFs, HostLog};
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::{WasmHost, WasmPlugin};

/// 插件数据根（宿主绝对路径）：`activate` 解析成功后缓存，命令面复用。
static DATA_ROOT: OnceLock<String> = OnceLock::new();

/// 数据根访问（activate 未完成 → `None`）
pub(crate) fn data_root() -> Option<&'static str> {
    DATA_ROOT.get().map(|s| s.as_str())
}

struct LanbitouPlugin;

impl WasmPlugin for LanbitouPlugin {
    const ID: &'static str = "com.wasmnest.lanbitou";

    fn manifest() -> PluginManifest {
        serde_json::from_str(include_str!("../../plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        let host = WasmHost;

        // 数据目录固定：{HomeDir}/.wasmnest/lanbitou/
        let home = host
            .config_get(ConfigKey::HomeDir)?
            .ok_or_else(|| anyhow::anyhow!("activate: home_dir config unavailable"))?;
        let data_dir = format!("{}/.wasmnest/lanbitou", home.trim_end_matches(['/', '\\']));

        // 集中目录授权
        let allowed = host
            .fs_request_auth(&[data_dir.clone()])
            .map_err(|e| anyhow::anyhow!("activate: fs_request_auth failed: {}", e))?;
        if !allowed {
            return Err(anyhow::anyhow!(
                "directory authorization denied: {} (re-enable the plugin to retry)",
                data_dir
            ));
        }

        store::init(&host, &data_dir)?;
        let _ = DATA_ROOT.set(data_dir);

        host.log_info("Lanbitou plugin activated (wasm, host-fs access)");
        Ok(())
    }

    fn deactivate() -> anyhow::Result<()> {
        WasmHost.log_info("Lanbitou plugin deactivated (wasm)");
        Ok(())
    }

    fn invoke_command(name: &str, args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        match name {
            // 诊断命令（迁移自 notenote.status）：装机排查时确认插件版本
            "lanbitou.status" => Ok(serde_json::json!({
                "plugin": Self::ID,
                "version": env!("CARGO_PKG_VERSION"),
            })),
            "lanbitou.create-note" => commands::create_note(args),
            "lanbitou.open-note" => commands::open_note(args),
            "lanbitou.save-note" => commands::save_note(args),
            "lanbitou.delete-note" => commands::delete_note(args),
            "lanbitou.list-notes" => commands::list_notes(args),
            "lanbitou.rename-note" => commands::rename_note(args),
            "lanbitou.search-notes" => commands::search_notes(args),
            "lanbitou.read-settings" => commands::read_settings(args),
            "lanbitou.save-settings" => commands::save_settings(args),
            "lanbitou.read-context" => commands::read_context(args),
            "lanbitou.save-context" => commands::save_context(args),
            "lanbitou.clipboard-read" => commands::clipboard_read(args),
            "lanbitou.clipboard-write" => commands::clipboard_write(args),
            _ => Err(anyhow::anyhow!("unknown command: {}", name)),
        }
    }
}

wasmnest_plugin_api::wasm_entry!(LanbitouPlugin);
