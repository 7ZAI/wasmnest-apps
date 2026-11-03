use wasmnest_plugin_api::host::{ConfigKey, HostConfig, HostFs};
use wasmnest_plugin_api::wasm_host::WasmHost;

pub fn ensure_dirs(data_dir: &str, notes_dir: &str) -> anyhow::Result<()> {
    let host = WasmHost;
    if !host.fs_exists(data_dir).unwrap_or(false) {
        host.fs_write(&format!("{}/.keep", data_dir), "")
            .map_err(|e| anyhow::anyhow!("mkdir data: {e}"))?;
    }
    if !host.fs_exists(notes_dir).unwrap_or(false) {
        host.fs_write(&format!("{}/.keep", notes_dir), "")
            .map_err(|e| anyhow::anyhow!("mkdir notes: {e}"))?;
    }
    Ok(())
}

pub fn notes_dir() -> anyhow::Result<String> {
    let host = WasmHost;
    let home = host
        .config_get(ConfigKey::HomeDir)
        .map_err(|e| anyhow::anyhow!("home dir: {e}"))?
        .ok_or_else(|| anyhow::anyhow!("home dir not available"))?;
    Ok(format!("{}/.wasmnest/notenote/notes", home))
}

pub fn data_dir() -> anyhow::Result<String> {
    let host = WasmHost;
    let home = host
        .config_get(ConfigKey::HomeDir)
        .map_err(|e| anyhow::anyhow!("home dir: {e}"))?
        .ok_or_else(|| anyhow::anyhow!("home dir not available"))?;
    Ok(format!("{}/.wasmnest/notenote", home))
}

pub fn settings_path() -> anyhow::Result<String> {
    Ok(format!("{}/settings.json", data_dir()?))
}

pub fn context_path() -> anyhow::Result<String> {
    Ok(format!("{}/context.json", data_dir()?))
}

pub fn note_path(id: &str) -> anyhow::Result<String> {
    let dir = notes_dir()?;
    validate_id(id)?;
    Ok(format!("{}/{}.md", dir, id))
}

fn validate_id(id: &str) -> anyhow::Result<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(anyhow::anyhow!("Invalid note id: {}", id));
    }
    Ok(())
}

pub fn validate_id_public(id: &str) -> anyhow::Result<()> {
    validate_id(id)
}

/// wasm32-unknown-unknown has no system clock — get real time from host.
pub fn current_time_rfc3339() -> anyhow::Result<String> {
    let host = WasmHost;
    let ms_str = host
        .config_get(ConfigKey::CurrentTimeMs)
        .map_err(|e| anyhow::anyhow!("time: {e}"))?
        .ok_or_else(|| anyhow::anyhow!("current time not available"))?;
    let ms: i64 = ms_str
        .parse()
        .map_err(|e| anyhow::anyhow!("parse time ms: {e}"))?;
    let dt = chrono::DateTime::from_timestamp_millis(ms)
        .ok_or_else(|| anyhow::anyhow!("invalid timestamp: {ms}"))?;
    Ok(dt.to_rfc3339())
}

pub fn read_file(path: &str) -> anyhow::Result<Option<String>> {
    let host = WasmHost;
    host.fs_read(path).map_err(|e| anyhow::anyhow!("read {}: {e}", path))
}

pub fn write_file(path: &str, content: &str) -> anyhow::Result<()> {
    let host = WasmHost;
    host.fs_write(path, content)
        .map_err(|e| anyhow::anyhow!("write {}: {e}", path))
}

pub fn delete_file(path: &str) -> anyhow::Result<()> {
    let host = WasmHost;
    host.fs_delete(path)
        .map_err(|e| anyhow::anyhow!("delete {}: {e}", path))
}

pub fn list_note_files() -> anyhow::Result<Vec<String>> {
    let host = WasmHost;
    let dir = notes_dir()?;
    match host.fs_read_dir(&dir) {
        Ok(entries) => {
            let files: Vec<String> = entries
                .into_iter()
                .filter(|e| e.name.ends_with(".md"))
                .map(|e| e.name)
                .collect();
            Ok(files)
        }
        Err(_) => Ok(vec![]),
    }
}
