//! store 单测：真实临时目录 + 与宿主同形的 HostFs 实现（native）

use super::*;

use std::cell::Cell;

use wasmnest_plugin_api::host::{FsDirEntry, FsNodeType, FsStat, HostError};

/// 测试宿主：日志静默 + host-fs 直连真实文件系统（临时目录内）+ 可控时钟
struct TestHost {
    clock: Cell<u64>,
    /// 模拟 `fs_read_dir` 失败（权限 / IO）；`fs_stat` 仍按真实文件系统返回
    fail_read_dir: Cell<bool>,
}

impl TestHost {
    fn new() -> Self {
        Self {
            clock: Cell::new(1_700_000_000_000),
            fail_read_dir: Cell::new(false),
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
        if self.fail_read_dir.get() {
            return Err(host_err(format!("read_dir {}: permission denied", path)));
        }
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

/// containment 按路径组件比较：共享前缀的兄弟目录（`notes-evil/`）不得被当成 notes 内
#[test]
fn containment_rejects_sibling_dir_with_shared_prefix() {
    let (host, dir) = setup();
    std::fs::create_dir_all(format!("{}/notes", dir)).unwrap();
    std::fs::create_dir_all(format!("{}/notes-evil", dir)).unwrap();
    std::fs::write(format!("{}/notes-evil/x.md", dir), "x").unwrap();

    let escape = format!("{}/notes-evil/x.md", dir);
    assert!(
        ensure_contained(&host, &dir, &escape).is_err(),
        "notes-evil/ 与 notes/ 只是字符串前缀相同，必须拒绝"
    );

    // 正常的 notes/<id>.md 仍然通过
    std::fs::write(format!("{}/notes/ok.md", dir), "ok").unwrap();
    assert!(ensure_contained(&host, &dir, &format!("{}/notes/ok.md", dir)).is_ok());
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

/// 首次启动（notes/ 尚未创建）是空列表，不是错误
#[test]
fn list_notes_missing_dir_is_empty_not_error() {
    let host = TestHost::new();
    let dir = data_root();
    init(&host, &dir).unwrap();

    let list = list_notes(&host, &dir).unwrap();
    assert!(list.is_empty());
}

/// 目录存在但读失败（权限 / IO）必须上抛：伪装成空列表会让用户以为笔记全没了
#[test]
fn list_notes_propagates_read_dir_failure_when_dir_exists() {
    let (host, dir) = setup();
    create_note(&host, &dir).unwrap();
    host.fail_read_dir.set(true);

    let err = list_notes(&host, &dir).unwrap_err();
    assert!(
        err.to_string().contains("failed to read notes dir"),
        "{err}"
    );
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
    assert_eq!(settings["viewMode"], "split");
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

// ==================== 临时记事 ====================

#[test]
fn ensure_scratch_creates_once_and_keeps_content() {
    let (host, dir) = setup();

    let first = ensure_scratch(&host, &dir).unwrap();
    assert_eq!(first.id, SCRATCH_ID);
    assert_eq!(first.content, "");
    assert!(std::path::Path::new(&format!("{}/notes/scratch.md", dir)).exists());
    assert!(first.created_at > 0);

    // 已存在时不得重置正文 / 时间戳
    save_note(&host, &dir, SCRATCH_ID, "# 临时记事\n\n今天写的东西").unwrap();
    let created_before = first.created_at;
    let second = ensure_scratch(&host, &dir).unwrap();
    assert_eq!(second.content, "# 临时记事\n\n今天写的东西");
    assert_eq!(second.created_at, created_before);

    // 外部删掉文件后有一次自愈
    std::fs::remove_file(format!("{}/notes/scratch.md", dir)).unwrap();
    let healed = ensure_scratch(&host, &dir).unwrap();
    assert_eq!(healed.content, "");
}

#[test]
fn delete_note_refuses_default_document() {
    let (host, dir) = setup();
    ensure_scratch(&host, &dir).unwrap();

    let err = delete_note(&host, &dir, SCRATCH_ID).unwrap_err();
    assert!(err.to_string().contains("cannot be deleted"), "{}", err);
    assert!(
        std::path::Path::new(&format!("{}/notes/scratch.md", dir)).exists(),
        "拒绝删除后文件必须还在"
    );
}

// ==================== 归档 ====================

#[test]
fn archive_scratch_names_by_date_range_and_clears_source() {
    let (host, dir) = setup();
    ensure_scratch(&host, &dir).unwrap();
    save_note(
        &host,
        &dir,
        SCRATCH_ID,
        "--- 2026-10-25 周日 10:00 ---\n第一段\n\n--- 2026-10-01 周四 09:00 ---\n更早的一段\n",
    )
    .unwrap();

    let (archive, source) = archive_scratch(&host, &dir, Some("2026-11-04"), None).unwrap();

    assert_eq!(archive.id, "2026-10-01_2026-11-04");
    assert_eq!(archive.title, "2026-10-01_2026-11-04");
    assert_eq!(archive.file_name, "2026-10-01_2026-11-04.md");
    assert!(archive.size > 0);
    // 正文原样搬过去（不重排、不加头）
    let archived =
        std::fs::read_to_string(format!("{}/archives/{}.md", dir, archive.id)).unwrap();
    assert!(archived.starts_with("--- 2026-10-25"));
    // 源文档被剪空
    assert_eq!(source.id, SCRATCH_ID);
    assert_eq!(source.content, "");
    assert_eq!(
        std::fs::read_to_string(format!("{}/notes/scratch.md", dir)).unwrap(),
        ""
    );
}

#[test]
fn archive_scratch_uses_fallback_start_when_content_has_no_date() {
    let (host, dir) = setup();
    ensure_scratch(&host, &dir).unwrap();
    save_note(&host, &dir, SCRATCH_ID, "没有日期的一坨笔记").unwrap();

    let (archive, _) = archive_scratch(&host, &dir, Some("2026-11-04"), Some("2026-11-01")).unwrap();
    assert_eq!(archive.id, "2026-11-01_2026-11-04");
}

#[test]
fn archive_scratch_same_day_range_is_single_date() {
    let (host, dir) = setup();
    ensure_scratch(&host, &dir).unwrap();
    save_note(
        &host,
        &dir,
        SCRATCH_ID,
        "--- 2026-11-04 周三 08:00 ---\n只有今天\n",
    )
    .unwrap();

    let (archive, _) = archive_scratch(&host, &dir, Some("2026-11-04"), None).unwrap();
    assert_eq!(archive.id, "2026-11-04");
}

#[test]
fn archive_scratch_rejects_empty_and_creates_no_file() {
    let (host, dir) = setup();
    ensure_scratch(&host, &dir).unwrap();
    save_note(&host, &dir, SCRATCH_ID, "   \n\n").unwrap();

    let err = archive_scratch(&host, &dir, Some("2026-11-04"), None).unwrap_err();
    assert!(err.to_string().contains("nothing to archive"), "{}", err);
    assert!(
        list_archives(&host, &dir).unwrap().is_empty(),
        "空白内容不得产生空归档文件"
    );
}

#[test]
fn archive_scratch_same_range_gets_suffix_not_overwrite() {
    let (host, dir) = setup();
    ensure_scratch(&host, &dir).unwrap();

    save_note(&host, &dir, SCRATCH_ID, "第一次").unwrap();
    let (first, _) = archive_scratch(&host, &dir, Some("2026-11-04"), Some("2026-11-04")).unwrap();
    save_note(&host, &dir, SCRATCH_ID, "第二次").unwrap();
    let (second, _) = archive_scratch(&host, &dir, Some("2026-11-04"), Some("2026-11-04")).unwrap();

    assert_eq!(first.id, "2026-11-04");
    assert_eq!(second.id, "2026-11-04_2");
    assert_eq!(second.file_name, "2026-11-04_2.md");
    assert_eq!(
        std::fs::read_to_string(format!("{}/archives/2026-11-04.md", dir)).unwrap(),
        "第一次",
        "旧归档不被覆盖"
    );
}

#[test]
fn list_archives_sorted_desc_and_skips_non_md() {
    let (host, dir) = setup();
    let archives = format!("{}/archives", dir);
    std::fs::create_dir_all(&archives).unwrap();
    std::fs::write(format!("{}/2026-10-01_2026-10-20.md", archives), "a").unwrap();
    std::fs::write(format!("{}/2026-11-01_2026-11-04.md", archives), "bb").unwrap();
    std::fs::write(format!("{}/notes.txt", archives), "ignore").unwrap();
    std::fs::create_dir_all(format!("{}/sub", archives)).unwrap();

    let list = list_archives(&host, &dir).unwrap();
    assert_eq!(
        list.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
        vec!["2026-11-01_2026-11-04", "2026-10-01_2026-10-20"]
    );
    assert_eq!(list[0].size, 2);
    assert_eq!(list[0].file_name, "2026-11-01_2026-11-04.md");
}

#[test]
fn list_archives_missing_dir_is_empty() {
    let (host, dir) = setup();
    assert!(list_archives(&host, &dir).unwrap().is_empty());
}

#[test]
fn open_archive_reads_content_and_rejects_traversal() {
    let (host, dir) = setup();
    ensure_scratch(&host, &dir).unwrap();
    save_note(&host, &dir, SCRATCH_ID, "归档正文").unwrap();
    let (archive, _) = archive_scratch(&host, &dir, Some("2026-11-04"), None).unwrap();

    let detail = open_archive(&host, &dir, &archive.id).unwrap();
    assert_eq!(detail.content, "归档正文");
    assert_eq!(detail.archive.id, archive.id);

    assert!(open_archive(&host, &dir, "../notes/scratch").is_err());
    assert!(open_archive(&host, &dir, "a/b").is_err());
    assert!(open_archive(&host, &dir, "2026-11-04\n").is_err());
    assert!(open_archive(&host, &dir, "2099-01-01").is_err());
}

#[test]
fn validate_archive_id_allows_date_range_only() {
    assert!(validate_archive_id("2026-10-01_2026-11-04").is_ok());
    assert!(validate_archive_id("2026-11-04_2").is_ok());
    assert!(validate_archive_id("../escape").is_err());
    assert!(validate_archive_id("2026-11-04/../x").is_err());
    assert!(validate_archive_id("").is_err());
    assert!(validate_archive_id(&"x".repeat(129)).is_err());
}

// ==================== 日期解析 ====================

#[test]
fn earliest_date_picks_min_and_ignores_false_positives() {
    assert_eq!(
        earliest_date("--- 2026-10-25 ---\n--- 2026-01-09 ---").as_deref(),
        Some("2026-01-09")
    );
    // 更长的数字串不算日期（避免从 12026-01-01 / 2026-01-011 里抠出假日期）
    assert_eq!(earliest_date("12026-01-01"), None);
    assert_eq!(earliest_date("2026-01-011"), None);
    // 非法月日直接排除
    assert_eq!(earliest_date("2026-13-01"), None);
    assert_eq!(earliest_date("2026-00-10"), None);
    // 多字节正文里不得 panic（按字节滑块 + str::get 边界保护）
    assert_eq!(
        earliest_date("中文中文 2026-02-28 中文").as_deref(),
        Some("2026-02-28")
    );
    assert_eq!(earliest_date("无日期"), None);
}

#[test]
fn date_from_ms_formats_utc_days() {
    assert_eq!(date_from_ms(0), "1970-01-01");
    assert_eq!(date_from_ms(1_700_000_000_000), "2023-11-14");
    assert_eq!(date_from_ms(1_767_225_600_000), "2026-01-01");
}
