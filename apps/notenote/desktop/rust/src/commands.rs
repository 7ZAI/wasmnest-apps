use crate::store;
use serde::{Deserialize, Serialize};
use wasmnest_plugin_api::host::HostClipboard;
use wasmnest_plugin_api::wasm_host::WasmHost;

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

pub fn create_note(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("id required"))?;
    store::validate_id_public(id)?;

    let now = store::current_time_rfc3339()?;

    let path = store::note_path(id)?;
    store::write_file(&path, "")?;

    let meta = NoteMeta {
        id: id.to_string(),
        title: "Untitled".to_string(),
        content: String::new(),
        created_at: now.clone(),
        updated_at: now,
    };

    serde_json::to_value(&meta).map_err(|e| anyhow::anyhow!("serialize: {e}"))
}

pub fn read_note(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("id required"))?;

    let path = store::note_path(id)?;
    let content = store::read_file(&path)?
        .ok_or_else(|| anyhow::anyhow!("Note not found: {}", id))?;

    let title = extract_title(&content);
    let now = store::current_time_rfc3339()?;

    let meta = NoteMeta {
        id: id.to_string(),
        title,
        content,
        created_at: now.clone(),
        updated_at: now,
    };

    serde_json::to_value(&meta).map_err(|e| anyhow::anyhow!("serialize: {e}"))
}

pub fn update_note(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("id required"))?;

    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("content required"))?;

    let path = store::note_path(id)?;
    store::write_file(&path, content)?;

    let title = extract_title(content);
    let now = store::current_time_rfc3339()?;

    let meta = NoteMeta {
        id: id.to_string(),
        title,
        content: content.to_string(),
        created_at: now.clone(),
        updated_at: now,
    };

    serde_json::to_value(&meta).map_err(|e| anyhow::anyhow!("serialize: {e}"))
}

pub fn delete_note(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("id required"))?;

    let path = store::note_path(id)?;
    store::delete_file(&path)?;

    Ok(serde_json::json!({ "id": id, "deleted": true }))
}

pub fn rename_note(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let id = args
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("id required"))?;

    let new_title = args
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("title required"))?;

    let path = store::note_path(id)?;
    let content = store::read_file(&path)?
        .ok_or_else(|| anyhow::anyhow!("Note not found: {}", id))?;

    let new_content = replace_first_line(&content, new_title);
    store::write_file(&path, &new_content)?;

    let now = store::current_time_rfc3339()?;
    let meta = NoteMeta {
        id: id.to_string(),
        title: new_title.to_string(),
        content: new_content,
        created_at: now.clone(),
        updated_at: now,
    };

    serde_json::to_value(&meta).map_err(|e| anyhow::anyhow!("serialize: {e}"))
}

pub fn list_notes(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let files = store::list_note_files()?;

    let mut notes: Vec<NoteMeta> = Vec::new();
    for file in files {
        let id = file.trim_end_matches(".md").to_string();
        let path = store::note_path(&id)?;

        match store::read_file(&path) {
            Ok(Some(content)) => {
                let title = extract_title(&content);
                let now = store::current_time_rfc3339()?;
                notes.push(NoteMeta {
                    id,
                    title,
                    content,
                    created_at: now.clone(),
                    updated_at: now,
                });
            }
            _ => {}
        }
    }

    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    serde_json::to_value(&notes).map_err(|e| anyhow::anyhow!("serialize: {e}"))
}

pub fn search_notes(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();

    let files = store::list_note_files()?;
    let mut results: Vec<NoteMeta> = Vec::new();

    for file in files {
        let id = file.trim_end_matches(".md").to_string();
        let path = store::note_path(&id)?;

        if let Ok(Some(content)) = store::read_file(&path) {
            let title = extract_title(&content);
            if query.is_empty()
                || title.to_lowercase().contains(&query)
                || content.to_lowercase().contains(&query)
            {
                let now = store::current_time_rfc3339()?;
                results.push(NoteMeta {
                    id,
                    title,
                    content,
                    created_at: now.clone(),
                    updated_at: now,
                });
            }
        }
    }

    results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    serde_json::to_value(&results).map_err(|e| anyhow::anyhow!("serialize: {e}"))
}

pub fn read_settings(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let path = store::settings_path()?;
    match store::read_file(&path)? {
        Some(content) => Ok(serde_json::from_str(&content).unwrap_or_else(|_| default_settings())),
        None => Ok(default_settings()),
    }
}

pub fn save_settings(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let path = store::settings_path()?;
    let content = serde_json::to_string_pretty(&args)
        .map_err(|e| anyhow::anyhow!("serialize settings: {e}"))?;
    store::write_file(&path, &content)?;
    Ok(args)
}

pub fn read_context(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let path = store::context_path()?;
    match store::read_file(&path)? {
        Some(content) => Ok(serde_json::from_str(&content).unwrap_or_else(|_| default_context())),
        None => Ok(default_context()),
    }
}

pub fn save_context(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let path = store::context_path()?;
    let content = serde_json::to_string_pretty(&args)
        .map_err(|e| anyhow::anyhow!("serialize context: {e}"))?;
    store::write_file(&path, &content)?;
    Ok(args)
}

pub fn clipboard_read(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let text = WasmHost
        .clipboard_read_text()
        .map_err(|e| anyhow::anyhow!("clipboard read: {e}"))?;
    Ok(serde_json::json!({ "text": text }))
}

pub fn clipboard_write(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let text = args
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("text required"))?;
    WasmHost
        .clipboard_write_text(text)
        .map_err(|e| anyhow::anyhow!("clipboard write: {e}"))?;
    Ok(serde_json::json!({ "written": true }))
}

fn replace_first_line(content: &str, new_first: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return new_first.to_string();
    }
    let mut result: Vec<String> = Vec::with_capacity(lines.len());
    let first = lines[0].trim();
    if first.starts_with("# ") || first.starts_with("## ") || first.starts_with("### ") {
        let prefix = first.chars().take_while(|c| *c == '#').count();
        result.push(format!("{} {}", "#".repeat(prefix), new_first));
    } else {
        result.push(new_first.to_string());
    }
    for line in &lines[1..] {
        result.push(line.to_string());
    }
    result.join("\n")
}

fn default_settings() -> serde_json::Value {
    serde_json::json!({
        "autoSave": true,
        "autoSaveDebounce": 500,
        "autoSaveMode": "realtime",
        "theme": "system",
        "fontSize": 14,
        "fontFamily": "'JetBrains Mono', 'Fira Code', monospace",
        "viewMode": "split",
        "timeDivider": {
            "format": "--- {{date}} {{weekday}} {{time}} ---",
            "position": "bottom",
            "triggerInterval": 5,
            "enabled": true
        }
    })
}

fn default_context() -> serde_json::Value {
    serde_json::json!({
        "lastOpenedNoteId": null,
        "cursorPosition": null,
        "scrollPosition": null,
        "lastEditTimestamp": null,
        "deletedDividerNotes": []
    })
}

fn extract_title(content: &str) -> String {
    content
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_prefix("# ")
                .or_else(|| trimmed.strip_prefix("## "))
                .or_else(|| trimmed.strip_prefix("### "))
                .unwrap_or(trimmed)
                .to_string()
        })
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Untitled".to_string())
}
