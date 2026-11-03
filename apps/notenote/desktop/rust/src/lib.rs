//! WasmNest Plugin (WASM, Desktop) — NoteNote
//!
//! 轻量级桌面 Markdown 记事本应用。笔记存储为独立 `.md` 文件，
//! 支持 Markdown 实时预览、自动保存、会话恢复、时间分隔符。

mod commands;
mod store;

use wasmnest_plugin_api::host::{ConfigKey, HostConfig, HostFs, HostLog};
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::wasm::WasmPlugin;
use wasmnest_plugin_api::wasm_host::WasmHost;

pub struct NoteNotePlugin;

impl WasmPlugin for NoteNotePlugin {
    const ID: &'static str = "com.wasmnest.notenote";

    fn manifest() -> PluginManifest {
        serde_json::from_str(include_str!("../../plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        let host = WasmHost;
        host.log_info("NoteNote plugin activated");

        let home = host
            .config_get(ConfigKey::HomeDir)
            .map_err(|e| anyhow::anyhow!("home dir: {e}"))?
            .ok_or_else(|| anyhow::anyhow!("home dir not available"))?;

        let notes_dir = format!("{}/.wasmnest/notenote/notes", home);
        let data_dir = format!("{}/.wasmnest/notenote", home);

        let authorized = host
            .fs_request_auth(&[data_dir.clone(), notes_dir.clone()])
            .map_err(|e| anyhow::anyhow!("fs auth: {e}"))?;
        if !authorized {
            return Err(anyhow::anyhow!("File system access denied by user"));
        }

        store::ensure_dirs(&data_dir, &notes_dir)?;

        host.log_info("NoteNote storage ready");
        Ok(())
    }

    fn deactivate() -> anyhow::Result<()> {
        WasmHost.log_info("NoteNote plugin deactivated");
        Ok(())
    }

    fn invoke_command(name: &str, args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        match name {
            "notenote.status" => {
                Ok(serde_json::json!({
                    "plugin": Self::ID,
                    "version": env!("CARGO_PKG_VERSION"),
                }))
            }
            "notenote.note.create" => commands::create_note(args),
            "notenote.note.read" => commands::read_note(args),
            "notenote.note.update" => commands::update_note(args),
            "notenote.note.delete" => commands::delete_note(args),
            "notenote.note.rename" => commands::rename_note(args),
            "notenote.note.list" => commands::list_notes(args),
            "notenote.note.search" => commands::search_notes(args),
            "notenote.settings.read" => commands::read_settings(args),
            "notenote.settings.save" => commands::save_settings(args),
            "notenote.context.read" => commands::read_context(args),
            "notenote.context.save" => commands::save_context(args),
            "notenote.clipboard.read" => commands::clipboard_read(args),
            "notenote.clipboard.write" => commands::clipboard_write(args),
            _ => Err(anyhow::anyhow!("Unknown command: {}", name)),
        }
    }
}

wasmnest_plugin_api::wasm_entry!(NoteNotePlugin);
