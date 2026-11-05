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
        "viewMode": "split",
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

/// 临时记事（scratch）固定 id：常驻默认文档，不可删除
///
/// 归档只针对它（见 `archive_scratch`）；普通笔记走 `create_note` 随机 uuid。
pub const SCRATCH_ID: &str = "scratch";

fn notes_dir(data_root: &str) -> String {
    format!("{}/notes", data_root)
}

/// 归档固定文件夹（与 notes/ 平级）
fn archives_dir(data_root: &str) -> String {
    format!("{}/archives", data_root)
}

fn note_path(data_root: &str, id: &str) -> anyhow::Result<String> {
    validate_id(id)?;
    Ok(format!("{}/{}.md", notes_dir(data_root), id))
}

/// 笔记路径必须落在 notes 目录内（存在时用 canonicalize 判定，防 symlink 逃逸）
fn ensure_contained<H: HostFs>(host: &H, data_root: &str, path: &str) -> anyhow::Result<()> {
    ensure_under_dir(host, &notes_dir(data_root), path, "notes")
}

/// 归档路径必须落在 archives 目录内（口径同笔记）
fn ensure_archive_contained<H: HostFs>(
    host: &H,
    data_root: &str,
    path: &str,
) -> anyhow::Result<()> {
    ensure_under_dir(host, &archives_dir(data_root), path, "archives")
}

/// 路径必须落在 dir 目录内（存在时用 canonicalize 判定，防 symlink 逃逸）
fn ensure_under_dir<H: HostFs>(host: &H, dir: &str, path: &str, label: &str) -> anyhow::Result<()> {
    let Some(canonical_notes) = host
        .fs_canonicalize(dir)
        .map_err(|e| anyhow::anyhow!("failed to canonicalize {}: {}", dir, e))?
    else {
        // 目录尚未落盘（首建）：id 白名单已排除穿越字符
        return Ok(());
    };
    if let Some(canonical_path) = host
        .fs_canonicalize(path)
        .map_err(|e| anyhow::anyhow!("failed to canonicalize {}: {}", path, e))?
    {
        // 按路径组件比较（`Path::starts_with`），不能用字符串前缀：
        // `/x/notes-evil/a.md` 的字符串前缀也是 `/x/notes`，会被误判为在目录内。
        let notes_path = std::path::Path::new(&canonical_notes);
        let candidate = std::path::Path::new(&canonical_path);
        if !candidate.starts_with(notes_path) {
            anyhow::bail!("{} path escapes its directory: {}", label, path);
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
    // 默认文档不可删：界面上没有入口，命令面也挡一道（外部调用者同样受限）
    if id == SCRATCH_ID {
        anyhow::bail!("scratch note cannot be deleted");
    }
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
            // 首次启动 notes/ 可能尚未创建（init 只写数据根下的文件）→ 空列表；
            // 其余失败（权限 / IO）必须上抛：伪装成空列表会让用户以为笔记全没了。
            match host.fs_stat(&dir) {
                Ok(None) => return Ok(Vec::new()),
                Ok(Some(_)) => {
                    return Err(anyhow::anyhow!("failed to read notes dir {}: {}", dir, e))
                }
                Err(stat_err) => {
                    return Err(anyhow::anyhow!(
                        "failed to read notes dir {}: {} (stat failed: {})",
                        dir,
                        e,
                        stat_err
                    ))
                }
            }
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

// ==================== 临时记事 / 归档 ====================

/// 归档条目（命令面 JSON，camelCase）
///
/// 归档就是 `archives/<时间范围>.md`：文件名即时时间范围，正文是临时记事剪出来的原样内容。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    /// 文件主名（= 时间范围，也是列表/打开归档用的 id）
    pub id: String,
    /// 展示标题（同 id：`2026-10-01_2026-11-04`）
    pub title: String,
    /// 完整文件名（含 `.md`）
    pub file_name: String,
    pub size: u64,
}

/// 归档正文
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDetail {
    pub archive: Archive,
    pub content: String,
}

/// 确保临时记事存在（缺失则建空文档），返回它
///
/// 没有它就不存在「默认文档」：首次安装、或被外部删除后启动都要自愈，
/// 不依赖前端写文件。
pub fn ensure_scratch<H: HostLog + HostFs + HostConfig>(
    host: &H,
    data_root: &str,
) -> anyhow::Result<Note> {
    let path = note_path(data_root, SCRATCH_ID)?;
    ensure_contained(host, data_root, &path)?;

    let exists = host
        .fs_exists(&path)
        .map_err(|e| anyhow::anyhow!("failed to check {}: {}", path, e))?;
    if !exists {
        let now = now_ms(host);
        write_file(host, &path, "")?;
        let mut index = read_index(host, data_root);
        index.notes.entry(SCRATCH_ID.to_string()).or_insert(NoteMeta {
            created_at: now,
            updated_at: now,
        });
        write_index(host, data_root, &index)?;
    }

    open_note(host, data_root, SCRATCH_ID)
}

/// 归档临时记事：全部内容剪到 `archives/<起日_今日>.md`，源文档清空
///
/// - 起日取正文里最早的 `YYYY-MM-DD`（时间分隔符里的日期），没有则用调用方给的
///   `fallback_start`（前端按本地时区算的创建日），再退回 createdAt（UTC）；
/// - 终日落点：调用方传的 `today`（本地时区），否则按宿主时钟（UTC）；
/// - 同名归档已存在时追加 `_2`/`_3`…：每次归档都是**新文档**，不覆盖旧记录。
///
/// 日期参数由前端给：wasm 侧拿不到本地时区，`CurrentTimeMs` 只能算出 UTC 日。
pub fn archive_scratch<H: HostLog + HostFs + HostConfig>(
    host: &H,
    data_root: &str,
    today: Option<&str>,
    fallback_start: Option<&str>,
) -> anyhow::Result<(Archive, Note)> {
    let scratch = open_note(host, data_root, SCRATCH_ID)?;
    if scratch.content.trim().is_empty() {
        anyhow::bail!("scratch note is empty: nothing to archive");
    }

    let content_start = earliest_date(&scratch.content);
    let start = content_start
        .or_else(|| fallback_start.and_then(normalize_date))
        .unwrap_or_else(|| date_from_ms(scratch.created_at));
    let end = today
        .and_then(normalize_date)
        .unwrap_or_else(|| date_from_ms(now_ms(host)));
    // 正文里的日期比今天晚（时钟回拨 / 手写了未来日期）时按区间两端排序，不让名字倒序
    let (start, end) = if start > end { (end, start) } else { (start, end) };
    let title = if start == end {
        end
    } else {
        format!("{}_{}", start, end)
    };

    let dir = archives_dir(data_root);
    let (id, path) = unique_archive_path(host, &dir, &title)?;
    write_file(host, &path, &scratch.content)?;
    // 源文档清空（“剪切”）：先写归档再改源，失败也不会丢正文
    let source = save_note(host, data_root, SCRATCH_ID, "")?;

    Ok((
        Archive {
            title: id.clone(),
            file_name: format!("{}.md", id),
            id,
            size: scratch.content.len() as u64,
        },
        source,
    ))
}

/// 列出归档（新的在前；缺目录 = 空列表）
pub fn list_archives<H: HostLog + HostFs>(host: &H, data_root: &str) -> anyhow::Result<Vec<Archive>> {
    let dir = archives_dir(data_root);
    let entries = match host.fs_read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) => {
            // 与 notes 同口径：目录不存在 = 还没归档过；其余失败必须上抛
            return match host.fs_stat(&dir) {
                Ok(None) => Ok(Vec::new()),
                _ => Err(anyhow::anyhow!("failed to read archives dir {}: {}", dir, e)),
            };
        }
    };

    let mut archives = Vec::new();
    for entry in entries {
        if entry.node_type != FsNodeType::File {
            continue;
        }
        let Some(id) = entry.name.strip_suffix(".md") else {
            continue;
        };
        if validate_archive_id(id).is_err() {
            host.log_warn(&format!(
                "skipping archive with unexpected name: {}",
                entry.name
            ));
            continue;
        }
        let path = format!("{}/{}", dir, entry.name);
        let size = host
            .fs_stat(&path)
            .ok()
            .flatten()
            .map(|stat| stat.size)
            .unwrap_or(0);
        archives.push(Archive {
            id: id.to_string(),
            title: id.to_string(),
            file_name: entry.name.clone(),
            size,
        });
    }

    archives.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(archives)
}

/// 读归档正文（只读面：归档不改写）
pub fn open_archive<H: HostLog + HostFs>(
    host: &H,
    data_root: &str,
    id: &str,
) -> anyhow::Result<ArchiveDetail> {
    validate_archive_id(id)?;
    let path = format!("{}/{}.md", archives_dir(data_root), id);
    ensure_archive_contained(host, data_root, &path)?;

    let content = host
        .fs_read(&path)
        .map_err(|e| anyhow::anyhow!("failed to read {}: {}", path, e))?
        .ok_or_else(|| anyhow::anyhow!("archive not found: {}", id))?;
    let size = content.len() as u64;

    Ok(ArchiveDetail {
        archive: Archive {
            id: id.to_string(),
            title: id.to_string(),
            file_name: format!("{}.md", id),
            size,
        },
        content,
    })
}

/// 归档 id 合法性：时间范围形态（数字、`-`、`_`；不允许分隔符 / `..`）
pub fn validate_archive_id(id: &str) -> anyhow::Result<()> {
    if id.is_empty() || id.len() > 128 {
        anyhow::bail!("invalid archive id length");
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        anyhow::bail!("invalid archive id: {}", id);
    }
    Ok(())
}

/// 取一个不冲突的归档文件名：`<title>.md` → `<title>_2.md` → …
fn unique_archive_path<H: HostFs>(
    host: &H,
    dir: &str,
    title: &str,
) -> anyhow::Result<(String, String)> {
    for suffix in 1..1000 {
        let id = if suffix == 1 {
            title.to_string()
        } else {
            format!("{}_{}", title, suffix)
        };
        validate_archive_id(&id)?;
        let path = format!("{}/{}.md", dir, id);
        let exists = host
            .fs_exists(&path)
            .map_err(|e| anyhow::anyhow!("failed to check {}: {}", path, e))?;
        if !exists {
            return Ok((id, path));
        }
    }
    anyhow::bail!("too many archives with the same time range: {}", title)
}

// ==================== 日期（归档命名） ====================

/// `YYYY-MM-DD` 合法性（归档名只用 ISO 日；月/日范围一并校验）
pub fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return false;
    }
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..10].parse::<u32>().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

fn normalize_date(value: &str) -> Option<String> {
    let value = value.trim();
    if is_iso_date(value) {
        Some(value.to_string())
    } else {
        None
    }
}

/// 正文里最早的 ISO 日期（时间分隔符的 `{{date}}`）
///
/// 按字节滑块扫，但一律用 `str::get` 切片：位置落在非 char 边界时返回 `None`，不 panic。
pub fn earliest_date(content: &str) -> Option<String> {
    let len = content.len();
    let mut best: Option<&str> = None;
    let mut i = 0;
    while i + 10 <= len {
        if let Some(candidate) = content.get(i..i + 10) {
            if is_iso_date(candidate)
                && !is_digit_before(content, i)
                && !is_digit_after(content, i + 10)
            {
                if best.map_or(true, |b| candidate < b) {
                    best = Some(candidate);
                }
                i += 10;
                continue;
            }
        }
        i += 1;
    }
    best.map(str::to_string)
}

fn is_digit_before(content: &str, index: usize) -> bool {
    index > 0
        && content
            .get(index - 1..index)
            .is_some_and(|c| c.as_bytes()[0].is_ascii_digit())
}

fn is_digit_after(content: &str, index: usize) -> bool {
    content
        .get(index..index + 1)
        .is_some_and(|c| c.as_bytes()[0].is_ascii_digit())
}

/// Unix 毫秒 → `YYYY-MM-DD`（UTC）
///
/// 只是兜底口径：正常路径由前端传本地日期。wasm 侧拿不到本地时区，
/// 也不为格式化日期引 chrono。
pub fn date_from_ms(ms: u64) -> String {
    let (year, month, day) = civil_from_days((ms / 86_400_000) as i64);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Howard Hinnant 的 civil_from_days：1970-01-01 起的天数 → 公历年月日
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
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
