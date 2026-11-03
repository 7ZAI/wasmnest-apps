//! store 单测：真实临时目录 + 与宿主同形的 HostFs 实现（native）

use super::*;

use std::cell::Cell;

use wasmnest_plugin_api::host::{FsDirEntry, FsNodeType, FsStat, HostError};

/// 测试宿主：日志静默 + host-fs 直连真实文件系统（临时目录内）+ 可控时钟
struct TestHost {
    clock: Cell<u64>,
}

impl TestHost {
    fn new() -> Self {
        Self {
            clock: Cell::new(1_700_000_000_000),
        }
    }

    fn tick(&self) -> u64 {
        let now = self.clock.get() + 1_000;
        self.clock.set(now);
        now
    }
}

fn host_err(message: String) -> HostError {
    HostError { code: -1, message }
}

impl HostLog for TestHost {
    fn log_info(&self, _message: &str) {}
    fn log_debug(&self, _message: &str) {}
    fn log_warn(&self, _message: &str) {}
    fn log_error(&self, _message: &str) {}
    fn mark_plugin_error(&self, _error: &str) {}
}

impl HostConfig for TestHost {
    fn config_get(&self, key: ConfigKey) -> Result<Option<String>, HostError> {
        match key {
            ConfigKey::CurrentTimeMs => Ok(Some(self.tick().to_string())),
            ConfigKey::HomeDir => Ok(Some("/tmp".to_string())),
            _ => Ok(None),
        }
    }
}

impl HostFs for TestHost {
    fn fs_read(&self, path: &str) -> Result<Option<String>, HostError> {
        match std::fs::read_to_string(path) {
            Ok(content) => Ok(Some(content)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(host_err(format!("read {}: {}", path, e))),
        }
    }

    fn fs_write(&self, path: &str, data: &str) -> Result<(), HostError> {
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| host_err(format!("create parent of {}: {}", path, e)))?;
        }
        std::fs::write(path, data).map_err(|e| host_err(format!("write {}: {}", path, e)))
    }

    fn fs_copy(&self, src: &str, dst: &str) -> Result<(), HostError> {
        if let Some(parent) = std::path::Path::new(dst).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| host_err(format!("create parent of {}: {}", dst, e)))?;
        }
        std::fs::copy(src, dst)
            .map(|_| ())
            .map_err(|e| host_err(format!("copy {} -> {}: {}", src, dst, e)))
    }

    fn fs_delete(&self, path: &str) -> Result<(), HostError> {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(host_err(format!("delete {}: {}", path, e))),
        }
    }

    fn fs_exists(&self, path: &str) -> Result<bool, HostError> {
        Ok(std::path::Path::new(path).exists())
    }

    fn fs_request_auth(&self, _paths: &[String]) -> Result<bool, HostError> {
        Ok(true)
    }

    fn fs_read_dir(&self, path: &str) -> Result<Vec<FsDirEntry>, HostError> {
        let dir =
            std::fs::read_dir(path).map_err(|e| host_err(format!("read_dir {}: {}", path, e)))?;
        let mut entries = Vec::new();
        for entry in dir {
            let entry = entry.map_err(|e| host_err(format!("read_dir {}: {}", path, e)))?;
            let file_type = entry
                .file_type()
                .map_err(|e| host_err(format!("file_type {}: {}", path, e)))?;
            let node_type = if file_type.is_dir() {
                FsNodeType::Folder
            } else if file_type.is_file() {
                FsNodeType::File
            } else {
                FsNodeType::Other
            };
            entries.push(FsDirEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                node_type,
            });
        }
        Ok(entries)
    }

    fn fs_canonicalize(&self, path: &str) -> Result<Option<String>, HostError> {
        match std::fs::canonicalize(path) {
            Ok(p) => Ok(Some(p.to_string_lossy().to_string())),
            Err(_) => Ok(None),
        }
    }

    fn fs_stat(&self, path: &str) -> Result<Option<FsStat>, HostError> {
        match std::fs::metadata(path) {
            Ok(meta) => Ok(Some(FsStat {
                size: meta.len(),
                is_file: meta.is_file(),
                is_dir: meta.is_dir(),
            })),
            Err(_) => Ok(None),
        }
    }
}

fn data_root() -> String {
    tempfile::tempdir()
        .expect("tempdir")
        .path()
        .to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .to_string()
}

fn setup() -> (TestHost, String) {
    let host = TestHost::new();
    let dir = data_root();
    init(&host, &dir).unwrap();
    (host, dir)
}

// ==================== 路径校验 ====================

#[test]
fn validate_id_rejects_traversal_and_separators() {
    assert!(validate_id("550e8400-e29b-41d4-a716-446655440000").is_ok());
    assert!(validate_id("abc-123").is_ok());
    assert!(validate_id("../etc/passwd").is_err());
    assert!(validate_id("a/b").is_err());
    assert!(validate_id("a\\b").is_err());
    assert!(validate_id("").is_err());
    assert!(validate_id("..").is_err());
    assert!(validate_id(&"x".repeat(129)).is_err());
}

#[test]
fn note_path_stays_inside_notes_dir() {
    let path = note_path("/root", "abc").unwrap();
    assert_eq!(path, "/root/notes/abc.md");
    assert!(note_path("/root", "../../etc/passwd").is_err());
}

// ==================== CRUD ====================

#[test]
fn create_note_writes_file_and_index() {
    let (host, dir) = setup();
    let note = create_note(&host, &dir).unwrap();
    assert_eq!(note.title, "Untitled");
    assert_eq!(note.content, "");
    assert!(note.created_at > 0);
    assert_eq!(note.created_at, note.updated_at);

    let file = format!("{}/notes/{}.md", dir, note.id);
    assert!(std::path::Path::new(&file).exists());
    let index = std::fs::read_to_string(format!("{}/index.json", dir)).unwrap();
    assert!(index.contains(&note.id));
}

#[test]
fn save_note_updates_content_title_and_timestamp() {
    let (host, dir) = setup();
    let note = create_note(&host, &dir).unwrap();
    let saved = save_note(&host, &dir, &note.id, "# 我的笔记\n\n正文").unwrap();

    assert_eq!(saved.title, "我的笔记");
    assert_eq!(saved.content, "# 我的笔记\n\n正文");
    assert!(saved.updated_at > note.updated_at);

    let reopened = open_note(&host, &dir, &note.id).unwrap();
    assert_eq!(reopened.content, saved.content);
    assert_eq!(reopened.title, "我的笔记");
}

#[test]
fn open_missing_note_fails_visibly() {
    let (host, dir) = setup();
    assert!(open_note(&host, &dir, "no-such-note").is_err());
}

#[test]
fn delete_note_removes_file_and_index_entry() {
    let (host, dir) = setup();
    let note = create_note(&host, &dir).unwrap();
    delete_note(&host, &dir, &note.id).unwrap();

    assert!(!std::path::Path::new(&format!("{}/notes/{}.md", dir, note.id)).exists());
    assert!(list_notes(&host, &dir).unwrap().is_empty());
    assert!(!std::fs::read_to_string(format!("{}/index.json", dir))
        .unwrap()
        .contains(&note.id));
}

#[test]
fn list_notes_sorted_by_updated_at_desc() {
    let (host, dir) = setup();
    let a = create_note(&host, &dir).unwrap();
    let b = create_note(&host, &dir).unwrap();
    save_note(&host, &dir, &a.id, "first").unwrap();

    let list = list_notes(&host, &dir).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, a.id);
    assert_eq!(list[1].id, b.id);
}

#[test]
fn list_notes_picks_up_externally_copied_files() {
    let (host, dir) = setup();
    std::fs::create_dir_all(format!("{}/notes", dir)).unwrap();
    std::fs::write(format!("{}/notes/manual.md", dir), "外部笔记").unwrap();

    let list = list_notes(&host, &dir).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].title, "外部笔记");
}

#[test]
fn corrupted_index_is_rebuilt_not_fatal() {
    let (host, dir) = setup();
    let note = create_note(&host, &dir).unwrap();
    std::fs::write(format!("{}/index.json", dir), "not json").unwrap();

    let list = list_notes(&host, &dir).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, note.id);
    // 列表会把缺失条目补进索引（可解析）
    let index = std::fs::read_to_string(format!("{}/index.json", dir)).unwrap();
    serde_json::from_str::<NoteIndex>(&index).unwrap();
}

// ==================== 重命名 / 搜索 ====================

#[test]
fn rename_replaces_first_line_only() {
    let (host, dir) = setup();
    let note = create_note(&host, &dir).unwrap();
    save_note(&host, &dir, &note.id, "旧标题\n\n第二行\n第三行").unwrap();

    let renamed = rename_note(&host, &dir, &note.id, "新标题").unwrap();
    assert_eq!(renamed.title, "新标题");
    assert_eq!(renamed.content, "新标题\n\n第二行\n第三行");
}

#[test]
fn rename_rejects_empty_title() {
    let (host, dir) = setup();
    let note = create_note(&host, &dir).unwrap();
    assert!(rename_note(&host, &dir, &note.id, "   ").is_err());
}

#[test]
fn search_matches_title_and_content_case_insensitive() {
    let (host, dir) = setup();
    let a = create_note(&host, &dir).unwrap();
    let b = create_note(&host, &dir).unwrap();
    save_note(&host, &dir, &a.id, "Rust 学习\n所有权").unwrap();
    save_note(&host, &dir, &b.id, "购物清单\n牛奶").unwrap();

    let by_title = search_notes(&host, &dir, "rust").unwrap();
    assert_eq!(by_title.len(), 1);
    assert_eq!(by_title[0].id, a.id);

    let by_content = search_notes(&host, &dir, "牛奶").unwrap();
    assert_eq!(by_content.len(), 1);
    assert_eq!(by_content[0].id, b.id);

    assert_eq!(search_notes(&host, &dir, "  ").unwrap().len(), 2);
}

// ==================== 设置 / 上下文 ====================

#[test]
fn init_writes_default_settings_and_context() {
    let (host, dir) = setup();
    let settings = read_settings(&host, &dir);
    assert_eq!(settings["autoSaveMode"], "realtime");
    assert_eq!(settings["timeDivider"]["triggerInterval"], 5);

    let context = read_context(&host, &dir);
    assert!(context["lastOpenedNoteId"].is_null());
    assert_eq!(context["deletedDividerNotes"], serde_json::json!([]));
}

#[test]
fn save_settings_merges_missing_keys_with_defaults() {
    let (host, dir) = setup();
    save_settings(
        &host,
        &dir,
        &serde_json::json!({ "fontSize": 18, "timeDivider": { "position": "top" } }),
    )
    .unwrap();

    let settings = read_settings(&host, &dir);
    assert_eq!(settings["fontSize"], 18);
    assert_eq!(settings["timeDivider"]["position"], "top");
    // 未提供的键保留默认值
    assert_eq!(settings["autoSaveMode"], "realtime");
    assert_eq!(settings["timeDivider"]["triggerInterval"], 5);
    assert_eq!(
        settings["timeDivider"]["format"],
        "--- {{date}} {{weekday}} {{time}} ---"
    );
}

#[test]
fn corrupted_settings_fall_back_to_defaults() {
    let (host, dir) = setup();
    std::fs::write(format!("{}/settings.json", dir), "{broken").unwrap();
    let settings = read_settings(&host, &dir);
    assert_eq!(settings["autoSaveMode"], "realtime");
}

#[test]
fn save_context_round_trips() {
    let (host, dir) = setup();
    save_context(
        &host,
        &dir,
        &serde_json::json!({
            "lastOpenedNoteId": "abc",
            "cursorPosition": { "line": 3, "ch": 7 },
            "scrollPosition": 120,
            "lastEditTimestamp": 1700000000000_u64,
            "deletedDividerNotes": ["abc"]
        }),
    )
    .unwrap();

    let context = read_context(&host, &dir);
    assert_eq!(context["lastOpenedNoteId"], "abc");
    assert_eq!(context["cursorPosition"]["line"], 3);
    assert_eq!(context["deletedDividerNotes"], serde_json::json!(["abc"]));
}
