//! Lanbitou 文件系统存储
//!
//! - 笔记：`{data_root}/notes/<id>.md`（UTF-8 纯文本，可被任意编辑器读取）
//! - 索引：`{data_root}/index.json`（createdAt / updatedAt 元数据）
//! - 设置：`{data_root}/settings.json`
//! - 工作上下文：`{data_root}/context.json`
//!
//! **文件访问经宿主 `host-fs` 原语（不经 WASI）**：wasip3 的 filesystem 方法是
//! async import，而插件导出是 sync-lifted，等待 async import 会 trap
//! `cannot block a synchronous task`（与 ai-chatbox 同因，见其 store.rs 头注释）。
//!
//! **时间戳来源**：宿主 `FsStat` 只暴露 size / isFile / isDir，没有 mtime；
//! 时间戳统一经 `ConfigKey::CurrentTimeMs`（宿主 Unix 毫秒）在写入时记录进
//! `index.json`。索引缺失 / 损坏时条目回退为 0（显示为「—」），不阻塞笔记读取。
//!
//! **路径校验**：笔记 id 只允许 ASCII 字母数字与 `-`（UUID 形态），从根上排除
//! `/`、`\`、`..` 等目录穿越字符；打开 / 删除前再做一次 canonicalize containment
//! 判定（spec §35）。

use std::collections::BTreeMap;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use wasmnest_plugin_api::host::{ConfigKey, FsDirEntry, FsNodeType, HostConfig, HostFs, HostLog};

/// 笔记数据（命令面 JSON，camelCase）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub file_path: String,
}

/// 索引条目（仅持久化时间戳；标题由正文首行派生）
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteMeta {
    created_at: u64,
    updated_at: u64,
}

/// 索引文件形状
#[derive(Debug, Default, Serialize, Deserialize)]
struct NoteIndex {
    #[serde(default)]
    notes: BTreeMap<String, NoteMeta>,
}

/// 默认设置（真源；settings.json 缺项按此深合并）
pub fn default_settings() -> serde_json::Value {
    serde_json::json!({
        "autoSaveMode": "realtime",
        "autoSaveDebounce": 500,
        "theme": "system",
        "fontSize": 14,
        "fontFamily": "monospace",
        "language": "zh-CN",
        "timeDivider": {
            "enabled": true,
            "format": "--- {{date}} {{weekday}} {{time}} ---",
            "position": "bottom",
            "triggerInterval": 5
        }
    })
}

/// 默认工作上下文
pub fn default_context() -> serde_json::Value {
    serde_json::json!({
        "lastOpenedNoteId": null,
        "cursorPosition": null,
        "scrollPosition": null,
        "lastEditTimestamp": null,
        "deletedDividerNotes": []
    })
}

// ==================== 路径与授权 ====================

/// 笔记 id 合法性：UUID 形态（ASCII 字母数字 + `-`），杜绝目录穿越
pub fn validate_id(id: &str) -> anyhow::Result<()> {
    if id.is_empty() || id.len() > 128 {
        anyhow::bail!("invalid note id length");
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        anyhow::bail!("invalid note id: {}", id);
    }
    Ok(())
}

fn notes_dir(data_root: &str) -> String {
    format!("{}/notes", data_root)
}

fn note_path(data_root: &str, id: &str) -> anyhow::Result<String> {
    validate_id(id)?;
    Ok(format!("{}/{}.md", notes_dir(data_root), id))
}

/// 笔记路径必须落在 notes 目录内（存在时用 canonicalize 判定，防 symlink 逃逸）
fn ensure_contained<H: HostFs>(host: &H, data_root: &str, path: &str) -> anyhow::Result<()> {
    let notes = notes_dir(data_root);
    let Some(canonical_notes) = host
        .fs_canonicalize(&notes)
        .map_err(|e| anyhow::anyhow!("failed to canonicalize {}: {}", notes, e))?
    else {
        // notes 目录尚未落盘（首建）：id 白名单已排除穿越字符
        return Ok(());
    };
    if let Some(canonical_path) = host
        .fs_canonicalize(path)
        .map_err(|e| anyhow::anyhow!("failed to canonicalize {}: {}", path, e))?
    {
        if !canonical_path.starts_with(&canonical_notes) {
            anyhow::bail!("note path escapes notes directory: {}", path);
        }
    }
    Ok(())
}

// ==================== 初始化与元数据 ====================

/// 初始化数据目录：索引 / 设置 / 上下文缺省文件不存在时写入默认内容
pub fn init<H: HostLog + HostFs>(host: &H, data_root: &str) -> anyhow::Result<()> {
    let index_path = format!("{}/index.json", data_root);
    if !host.fs_exists(&index_path).unwrap_or(false) {
        write_file(host, &index_path, "{\"notes\":{}}")?;
    }

    let settings_path = format!("{}/settings.json", data_root);
    if !host.fs_exists(&settings_path).unwrap_or(false) {
        write_file(host, &settings_path, &pretty(&default_settings())?)?;
    }

    let context_path = format!("{}/context.json", data_root);
    if !host.fs_exists(&context_path).unwrap_or(false) {
        write_file(host, &context_path, &pretty(&default_context())?)?;
    }

    host.log_info("lanbitou store initialized");
    Ok(())
}

fn now_ms<H: HostConfig>(host: &H) -> u64 {
    host.config_get(ConfigKey::CurrentTimeMs)
        .ok()
        .flatten()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
}

fn read_index<H: HostLog + HostFs>(host: &H, data_root: &str) -> NoteIndex {
    let path = format!("{}/index.json", data_root);
    match host.fs_read(&path) {
        Ok(Some(content)) => serde_json::from_str(&content).unwrap_or_else(|e| {
            host.log_warn(&format!("index.json corrupted, rebuilding: {}", e));
            NoteIndex::default()
        }),
        Ok(None) => NoteIndex::default(),
        Err(e) => {
            host.log_warn(&format!("failed to read index.json: {}", e));
            NoteIndex::default()
        }
    }
}

fn write_index<H: HostFs>(host: &H, data_root: &str, index: &NoteIndex) -> anyhow::Result<()> {
    let path = format!("{}/index.json", data_root);
    let content = serde_json::to_string_pretty(index).context("serialize index")?;
    write_file(host, &path, &content)
}

/// 标题 = 正文首行（去掉 Markdown 标题井号），空 / 纯空白回退 "Untitled"
pub fn derive_title(content: &str) -> String {
    let first = content.lines().next().unwrap_or("").trim();
    let title = first.trim_start_matches('#').trim();
    if title.is_empty() {
        "Untitled".to_string()
    } else {
        title.chars().take(200).collect()
    }
}

fn note_from_content(id: &str, path: &str, content: &str, meta: NoteMeta) -> Note {
    Note {
        id: id.to_string(),
        title: derive_title(content),
        content: content.to_string(),
        created_at: meta.created_at,
        updated_at: meta.updated_at,
        file_path: path.to_string(),
    }
}

// ==================== 笔记 CRUD ====================

pub fn create_note<H: HostLog + HostFs + HostConfig>(
    host: &H,
    data_root: &str,
) -> anyhow::Result<Note> {
    let id = Uuid::new_v4().to_string();
    let path = note_path(data_root, &id)?;
    ensure_contained(host, data_root, &path)?;

    let now = now_ms(host);
    write_file(host, &path, "")?;

    let mut index = read_index(host, data_root);
    index.notes.insert(
        id.clone(),
        NoteMeta {
            created_at: now,
            updated_at: now,
        },
    );
    write_index(host, data_root, &index)?;

    Ok(note_from_content(
        &id,
        &path,
        "",
        NoteMeta {
            created_at: now,
            updated_at: now,
        },
    ))
}

pub fn open_note<H: HostLog + HostFs>(host: &H, data_root: &str, id: &str) -> anyhow::Result<Note> {
    let path = note_path(data_root, id)?;
    ensure_contained(host, data_root, &path)?;

    let content = host
        .fs_read(&path)
        .map_err(|e| anyhow::anyhow!("failed to read {}: {}", path, e))?
        .ok_or_else(|| anyhow::anyhow!("note not found: {}", id))?;

    let index = read_index(host, data_root);
    let meta = index.notes.get(id).copied().unwrap_or(NoteMeta {
        created_at: 0,
        updated_at: 0,
    });

    Ok(note_from_content(id, &path, &content, meta))
}

pub fn save_note<H: HostLog + HostFs + HostConfig>(
    host: &H,
    data_root: &str,
    id: &str,
    content: &str,
) -> anyhow::Result<Note> {
    let path = note_path(data_root, id)?;
    ensure_contained(host, data_root, &path)?;
    write_file(host, &path, content)?;

    let now = now_ms(host);
    let mut index = read_index(host, data_root);
    let entry = index.notes.entry(id.to_string()).or_insert(NoteMeta {
        created_at: now,
        updated_at: now,
    });
    entry.updated_at = now;
    let meta = *entry;
    write_index(host, data_root, &index)?;

    Ok(note_from_content(id, &path, content, meta))
}

pub fn delete_note<H: HostLog + HostFs>(host: &H, data_root: &str, id: &str) -> anyhow::Result<()> {
    let path = note_path(data_root, id)?;
    ensure_contained(host, data_root, &path)?;
    delete_file(host, &path)?;

    let mut index = read_index(host, data_root);
    index.notes.remove(id);
    write_index(host, data_root, &index)
}

pub fn list_notes<H: HostLog + HostFs + HostConfig>(
    host: &H,
    data_root: &str,
) -> anyhow::Result<Vec<Note>> {
    let dir = notes_dir(data_root);
    let entries: Vec<FsDirEntry> = match host.fs_read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) => {
            // 首次启动 notes 目录可能尚不存在：视为空列表而非激活失败
            host.log_warn(&format!("notes dir unreadable ({}): {}", dir, e));
            return Ok(Vec::new());
        }
    };

    let mut index = read_index(host, data_root);
    let now = now_ms(host);
    let mut notes = Vec::new();
    let mut index_dirty = false;

    for entry in entries {
        if entry.node_type != FsNodeType::File {
            continue;
        }
        let Some(id) = entry.name.strip_suffix(".md").map(str::to_string) else {
            continue;
        };
        if validate_id(&id).is_err() {
            host.log_warn(&format!(
                "skipping note with invalid filename: {}",
                entry.name
            ));
            continue;
        }
        let path = format!("{}/{}", dir, entry.name);
        let content = match host.fs_read(&path) {
            Ok(Some(content)) => content,
            Ok(None) => continue,
            Err(e) => {
                host.log_warn(&format!("skipping unreadable note {}: {}", path, e));
                continue;
            }
        };
        let meta = *index.notes.entry(id.clone()).or_insert_with(|| {
            index_dirty = true;
            NoteMeta {
                created_at: now,
                updated_at: now,
            }
        });
        notes.push(note_from_content(&id, &path, &content, meta));
    }

    if index_dirty {
        let _ = write_index(host, data_root, &index);
    }

    notes.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.title.cmp(&b.title))
    });
    Ok(notes)
}

/// 重命名 = 把正文首行替换为新标题（保留其余内容）
pub fn rename_note<H: HostLog + HostFs + HostConfig>(
    host: &H,
    data_root: &str,
    id: &str,
    title: &str,
) -> anyhow::Result<Note> {
    let title = title.trim();
    if title.is_empty() {
        anyhow::bail!("title must not be empty");
    }
    let note = open_note(host, data_root, id)?;
    let mut lines = note.content.lines();
    let _ = lines.next();
    let rest: Vec<&str> = lines.collect();
    let content = if rest.is_empty() {
        title.to_string()
    } else {
        format!("{}\n{}", title, rest.join("\n"))
    };
    save_note(host, data_root, id, &content)
}

/// 搜索：标题或正文包含查询串（大小写不敏感）
pub fn search_notes<H: HostLog + HostFs + HostConfig>(
    host: &H,
    data_root: &str,
    query: &str,
) -> anyhow::Result<Vec<Note>> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return list_notes(host, data_root);
    }
    let notes = list_notes(host, data_root)?;
    Ok(notes
        .into_iter()
        .filter(|n| {
            n.title.to_lowercase().contains(&needle) || n.content.to_lowercase().contains(&needle)
        })
        .collect())
}

// ==================== 设置 / 上下文 ====================

pub fn read_settings<H: HostLog + HostFs>(host: &H, data_root: &str) -> serde_json::Value {
    read_json_merged(
        host,
        &format!("{}/settings.json", data_root),
        default_settings(),
    )
}

pub fn save_settings<H: HostFs>(
    host: &H,
    data_root: &str,
    settings: &serde_json::Value,
) -> anyhow::Result<()> {
    let merged = deep_merge(default_settings(), settings.clone());
    let path = format!("{}/settings.json", data_root);
    write_file(host, &path, &pretty(&merged)?)
}

pub fn read_context<H: HostLog + HostFs>(host: &H, data_root: &str) -> serde_json::Value {
    read_json_merged(
        host,
        &format!("{}/context.json", data_root),
        default_context(),
    )
}

pub fn save_context<H: HostFs>(
    host: &H,
    data_root: &str,
    context: &serde_json::Value,
) -> anyhow::Result<()> {
    let merged = deep_merge(default_context(), context.clone());
    let path = format!("{}/context.json", data_root);
    write_file(host, &path, &pretty(&merged)?)
}

fn read_json_merged<H: HostLog + HostFs>(
    host: &H,
    path: &str,
    defaults: serde_json::Value,
) -> serde_json::Value {
    let value = match host.fs_read(path) {
        Ok(Some(content)) => serde_json::from_str(&content).unwrap_or_else(|e| {
            host.log_warn(&format!("{} corrupted, using defaults: {}", path, e));
            serde_json::Value::Null
        }),
        Ok(None) => serde_json::Value::Null,
        Err(e) => {
            host.log_warn(&format!("failed to read {}: {}", path, e));
            serde_json::Value::Null
        }
    };
    deep_merge(defaults, value)
}

/// 对象递归合并；`override` 非对象时整体回退默认值
fn deep_merge(defaults: serde_json::Value, override_value: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match (defaults, override_value) {
        (Value::Object(mut base), Value::Object(over)) => {
            for (key, value) in over {
                let merged = match base.remove(&key) {
                    Some(existing) => deep_merge(existing, value),
                    None => value,
                };
                base.insert(key, merged);
            }
            Value::Object(base)
        }
        (fallback, Value::Null) => fallback,
        (_, value) => value,
    }
}

// ==================== host-fs 辅助 ====================

fn write_file<H: HostFs>(host: &H, path: &str, content: &str) -> anyhow::Result<()> {
    host.fs_write(path, content)
        .map_err(|e| anyhow::anyhow!("failed to write {}: {}", path, e))
}

fn delete_file<H: HostFs>(host: &H, path: &str) -> anyhow::Result<()> {
    host.fs_delete(path)
        .map_err(|e| anyhow::anyhow!("failed to delete {}: {}", path, e))
}

fn pretty(value: &serde_json::Value) -> anyhow::Result<String> {
    serde_json::to_string_pretty(value).context("serialize json")
}

#[cfg(test)]
mod tests;
