//! 插件私有库（`plugin.db`）：表结构、迁移、读写语句。
//!
//! 约束来自宿主 `host-plugin-database`：`execute` 只执行**单条**语句、没有事务
//! 包装，因此这里不写多语句脚本、不依赖 `user_version`；迁移逐条 `CREATE … IF
//! NOT EXISTS`，重复执行幂等。写入一律走参数绑定（字符串拼接只用于 IN 列表）。

use crate::domain::{
    error_kind, Circle, ClearMode, ClearedStats, ContentBlock, CredentialSummary, FetchLogEntry,
    Item, Origin, ReaderState, ReaderStats, Settings, Source, SourceState, UNGROUPED_CIRCLE_ID,
};
use crate::ports::{PortError, Ports};
use serde_json::{json, Value};

/// 当前 schema 版本（写入 `meta.schema_version`）。
pub const SCHEMA_VERSION: i64 = 2;
/// 条目保留天数（非收藏）。
pub const RETENTION_DAYS: i64 = 30;
/// 每源抓取日志保留行数。
pub const FETCH_LOG_PER_SOURCE: i64 = 200;

/// 建表 + 建索引 + 写 schema 版本。逐条执行，重复调用无副作用。
pub fn migrate(p: &Ports<'_>) -> Result<(), PortError> {
    for sql in SCHEMA {
        p.db.execute(sql)?;
    }
    let version = meta_get(p, "schema_version")?.unwrap_or_default();
    if version != SCHEMA_VERSION.to_string() {
        meta_set(p, "schema_version", &SCHEMA_VERSION.to_string())?;
    }
    Ok(())
}

/// 表结构与索引（顺序即建表顺序，全部幂等）。
const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS circles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    )",
    "CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        circle_id TEXT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        enabled INTEGER NOT NULL DEFAULT 1,
        auth_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )",
    "CREATE TABLE IF NOT EXISTS source_state (
        source_id TEXT PRIMARY KEY,
        last_fetch_at INTEGER,
        next_retry_at INTEGER,
        fail_count INTEGER NOT NULL DEFAULT 0,
        last_ok_at INTEGER,
        last_error_kind TEXT,
        last_error_detail TEXT,
        etag TEXT,
        last_modified TEXT
    )",
    "CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        canonical_url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        summary TEXT,
        published_at INTEGER NOT NULL,
        first_seen_at INTEGER NOT NULL,
        lang TEXT,
        author TEXT,
        raw_url TEXT NOT NULL
    )",
    "CREATE TABLE IF NOT EXISTS item_origins (
        item_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        raw_url TEXT NOT NULL,
        source_title TEXT,
        published_at INTEGER,
        PRIMARY KEY (item_id, source_id, raw_url)
    )",
    "CREATE TABLE IF NOT EXISTS item_state (
        item_id TEXT PRIMARY KEY,
        read_at INTEGER,
        favorited_at INTEGER
    )",
    "CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        secret_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )",
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS fetch_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        ok INTEGER NOT NULL,
        http_status INTEGER,
        error_kind TEXT,
        item_count INTEGER
    )",
    "CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at)",
    "CREATE INDEX IF NOT EXISTS idx_items_seen      ON items(first_seen_at)",
    "CREATE INDEX IF NOT EXISTS idx_origins_source  ON item_origins(source_id)",
    "CREATE INDEX IF NOT EXISTS idx_sources_circle  ON sources(circle_id)",
    "CREATE INDEX IF NOT EXISTS idx_fetchlog_source ON fetch_log(source_id, started_at)",
    "CREATE TABLE IF NOT EXISTS item_content (
        item_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        blocks_json TEXT,
        text_length INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        fetched_at INTEGER NOT NULL,
        last_attempt_at INTEGER NOT NULL,
        last_attempt_kind TEXT,
        error_kind TEXT,
        error_detail TEXT,
        truncated INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0
    )",
    "CREATE INDEX IF NOT EXISTS idx_item_content_fetched  ON item_content(fetched_at)",
    "CREATE INDEX IF NOT EXISTS idx_item_content_archived ON item_content(archived, fetched_at)",
];

// ==================== 行映射 ====================

fn text(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn int(row: &Value, key: &str) -> Option<i64> {
    row.get(key).and_then(|v| v.as_i64())
}

fn real(row: &Value, key: &str) -> Option<f64> {
    row.get(key).and_then(|v| v.as_f64())
}

fn flag(row: &Value, key: &str) -> bool {
    int(row, key).unwrap_or(0) != 0
}

// ==================== meta / settings ====================

/// 读 `meta` 键。
pub fn meta_get(p: &Ports<'_>, key: &str) -> Result<Option<String>, PortError> {
    let rows =
        p.db.query_params("SELECT value FROM meta WHERE key = ?1", &[json!(key)])?;
    Ok(rows.first().and_then(|row| text(row, "value")))
}

/// 写 `meta` 键（插入或覆盖）。
pub fn meta_set(p: &Ports<'_>, key: &str, value: &str) -> Result<(), PortError> {
    p.db.execute_params(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        &[json!(key), json!(value)],
    )?;
    Ok(())
}

/// 读设置项（缺省 = 空）。
pub fn setting_get(p: &Ports<'_>, key: &str) -> Result<Option<String>, PortError> {
    let rows =
        p.db.query_params("SELECT value FROM settings WHERE key = ?1", &[json!(key)])?;
    Ok(rows.first().and_then(|row| text(row, "value")))
}

/// 写设置项。
pub fn setting_set(p: &Ports<'_>, key: &str, value: &str) -> Result<(), PortError> {
    p.db.execute_params(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        &[json!(key), json!(value)],
    )?;
    Ok(())
}

/// 装载设置（AI 密钥只回掩码）。
pub fn load_settings(p: &Ports<'_>) -> Result<Settings, PortError> {
    let api_key = setting_get(p, "ai.apiKey")?;
    Ok(Settings {
        ai_enabled: setting_get(p, "ai.enabled")?
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false),
        ai_base_url: setting_get(p, "ai.baseUrl")?.unwrap_or_default(),
        ai_model: setting_get(p, "ai.model")?.unwrap_or_default(),
        ai_api_key_len: api_key
            .as_ref()
            .map(|key| key.chars().count() as u32)
            .unwrap_or(0),
        ai_api_key_tail: api_key.as_deref().map(tail_of).unwrap_or_default(),
        reader_enabled: setting_get(p, "reader.enabled")?
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false),
    })
}

/// 保存设置；`api_key = None` 表示不改动已保存密钥。
pub fn save_settings(
    p: &Ports<'_>,
    enabled: bool,
    base_url: &str,
    model: &str,
    reader_enabled: bool,
    api_key: Option<&str>,
) -> Result<Settings, PortError> {
    setting_set(p, "ai.enabled", if enabled { "1" } else { "0" })?;
    setting_set(p, "ai.baseUrl", base_url.trim())?;
    setting_set(p, "ai.model", model.trim())?;
    setting_set(p, "reader.enabled", if reader_enabled { "1" } else { "0" })?;
    if let Some(key) = api_key {
        setting_set(p, "ai.apiKey", key.trim())?;
    }
    load_settings(p)
}

/// 读取 AI 密钥明文（**只允许用于构造请求头**）。
pub fn ai_api_key(p: &Ports<'_>) -> Result<Option<String>, PortError> {
    Ok(setting_get(p, "ai.apiKey")?.filter(|v| !v.trim().is_empty()))
}

fn tail_of(raw: &str) -> String {
    let chars: Vec<char> = raw.chars().collect();
    if chars.len() <= 4 {
        return String::new();
    }
    chars[chars.len() - 4..].iter().collect()
}

// ==================== 圈子 ====================

/// 全部圈子（含源计数）。
pub fn load_circles(p: &Ports<'_>) -> Result<Vec<Circle>, PortError> {
    let rows = p.db.query(
        "SELECT c.id, c.name, c.weight, c.sort_order, c.created_at,
                (SELECT COUNT(*) FROM sources s WHERE s.circle_id = c.id) AS source_count
         FROM circles c
         ORDER BY c.sort_order, c.created_at, c.id",
    )?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            Some(Circle {
                id: text(row, "id")?,
                name: text(row, "name")?,
                weight: real(row, "weight").unwrap_or(1.0),
                sort_order: int(row, "sort_order").unwrap_or(0),
                created_at: int(row, "created_at").unwrap_or(0),
                source_count: int(row, "source_count").unwrap_or(0) as u32,
            })
        })
        .collect())
}

/// 插入圈子。
pub fn insert_circle(
    p: &Ports<'_>,
    id: &str,
    name: &str,
    weight: f64,
    sort_order: i64,
    now_ms: i64,
) -> Result<(), PortError> {
    p.db.execute_params(
        "INSERT INTO circles (id, name, weight, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        &[json!(id), json!(name), json!(weight), json!(sort_order), json!(now_ms)],
    )?;
    Ok(())
}

/// 更新圈子（仅权重 / 名称；`sort_order` 保持不变）。
pub fn update_circle(p: &Ports<'_>, id: &str, name: &str, weight: f64) -> Result<(), PortError> {
    p.db.execute_params(
        "UPDATE circles SET name = ?2, weight = ?3 WHERE id = ?1",
        &[json!(id), json!(name), json!(weight)],
    )?;
    Ok(())
}

/// 删除圈子：其下源回到「未分组」，条目保留。
pub fn delete_circle(p: &Ports<'_>, id: &str) -> Result<(), PortError> {
    p.db.execute_params(
        "UPDATE sources SET circle_id = NULL WHERE circle_id = ?1",
        &[json!(id)],
    )?;
    p.db.execute_params("DELETE FROM circles WHERE id = ?1", &[json!(id)])?;
    Ok(())
}

// ==================== 源 ====================

/// 全部源（含状态与凭据存在性）。
pub fn load_sources(p: &Ports<'_>) -> Result<Vec<Source>, PortError> {
    let rows = p.db.query(
        "SELECT s.id, s.name, s.kind, s.url, s.circle_id, s.weight, s.enabled, s.auth_id,
                st.last_fetch_at, st.last_ok_at, st.next_retry_at, st.fail_count,
                st.last_error_kind, st.last_error_detail, st.etag, st.last_modified
         FROM sources s
         LEFT JOIN source_state st ON st.source_id = s.id
         ORDER BY s.created_at, s.id",
    )?;
    let credential_ids = load_credential_ids(p)?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let kind = text(row, "kind")?;
            let auth_id = text(row, "auth_id");
            Some(Source {
                id: text(row, "id")?,
                name: text(row, "name")?,
                experimental: crate::domain::SourceKind::parse(&kind)
                    .map(|k| k.is_experimental())
                    .unwrap_or(false),
                has_credential: auth_id
                    .as_ref()
                    .map(|id| credential_ids.contains(id))
                    .unwrap_or(false),
                auth_id,
                kind,
                url: text(row, "url")?,
                circle_id: text(row, "circle_id"),
                weight: real(row, "weight").unwrap_or(1.0),
                enabled: flag(row, "enabled"),
                state: SourceState {
                    last_fetch_at: int(row, "last_fetch_at"),
                    last_ok_at: int(row, "last_ok_at"),
                    next_retry_at: int(row, "next_retry_at"),
                    fail_count: int(row, "fail_count").unwrap_or(0) as u32,
                    last_error_kind: text(row, "last_error_kind"),
                    last_error_detail: text(row, "last_error_detail"),
                    etag: text(row, "etag"),
                    last_modified: text(row, "last_modified"),
                },
            })
        })
        .collect())
}

/// 单个源。
pub fn load_source(p: &Ports<'_>, id: &str) -> Result<Option<Source>, PortError> {
    Ok(load_sources(p)?.into_iter().find(|s| s.id == id))
}

/// 插入源（`auth_id` 可为空）。
pub fn insert_source(
    p: &Ports<'_>,
    id: &str,
    name: &str,
    kind: &str,
    url: &str,
    circle_id: Option<&str>,
    weight: f64,
    auth_id: Option<&str>,
    now_ms: i64,
) -> Result<(), PortError> {
    p.db.execute_params(
        "INSERT INTO sources (id, circle_id, kind, name, url, weight, enabled, auth_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?8)",
        &[
            json!(id),
            arg_opt(circle_id),
            json!(kind),
            json!(name),
            json!(url),
            json!(weight),
            arg_opt(auth_id),
            json!(now_ms),
        ],
    )?;
    Ok(())
}

/// 更新源（名称 / 地址 / 圈子 / 权重 / 启用 / 凭据）。
pub fn update_source(
    p: &Ports<'_>,
    id: &str,
    name: &str,
    url: &str,
    circle_id: Option<&str>,
    weight: f64,
    enabled: bool,
    auth_id: Option<&str>,
    now_ms: i64,
) -> Result<(), PortError> {
    p.db.execute_params(
        "UPDATE sources
            SET name = ?2, url = ?3, circle_id = ?4, weight = ?5, enabled = ?6,
                auth_id = ?7, updated_at = ?8
          WHERE id = ?1",
        &[
            json!(id),
            json!(name),
            json!(url),
            arg_opt(circle_id),
            json!(weight),
            json!(if enabled { 1 } else { 0 }),
            arg_opt(auth_id),
            json!(now_ms),
        ],
    )?;
    Ok(())
}

/// 删除源：其来源归属一并删除（条目本身保留，可能仍有其它来源）。
pub fn delete_source(p: &Ports<'_>, id: &str) -> Result<(), PortError> {
    p.db.execute_params(
        "DELETE FROM item_origins WHERE source_id = ?1",
        &[json!(id)],
    )?;
    p.db.execute_params(
        "DELETE FROM source_state WHERE source_id = ?1",
        &[json!(id)],
    )?;
    p.db.execute_params("DELETE FROM fetch_log WHERE source_id = ?1", &[json!(id)])?;
    p.db.execute_params("DELETE FROM sources WHERE id = ?1", &[json!(id)])?;
    Ok(())
}

/// 写抓取结果到 `source_state`。
#[allow(clippy::too_many_arguments)]
pub fn save_source_state(
    p: &Ports<'_>,
    source_id: &str,
    last_fetch_at: i64,
    last_ok_at: Option<i64>,
    next_retry_at: Option<i64>,
    fail_count: u32,
    error_kind: Option<&str>,
    error_detail: Option<&str>,
    etag: Option<&str>,
    last_modified: Option<&str>,
) -> Result<(), PortError> {
    p.db.execute_params(
        "INSERT INTO source_state
            (source_id, last_fetch_at, last_ok_at, next_retry_at, fail_count,
             last_error_kind, last_error_detail, etag, last_modified)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(source_id) DO UPDATE SET
            last_fetch_at = excluded.last_fetch_at,
            last_ok_at = COALESCE(excluded.last_ok_at, source_state.last_ok_at),
            next_retry_at = excluded.next_retry_at,
            fail_count = excluded.fail_count,
            last_error_kind = excluded.last_error_kind,
            last_error_detail = excluded.last_error_detail,
            etag = COALESCE(excluded.etag, source_state.etag),
            last_modified = COALESCE(excluded.last_modified, source_state.last_modified)",
        &[
            json!(source_id),
            json!(last_fetch_at),
            arg_opt_num(last_ok_at),
            arg_opt_num(next_retry_at),
            json!(fail_count),
            arg_opt(error_kind),
            arg_opt(error_detail),
            arg_opt(etag),
            arg_opt(last_modified),
        ],
    )?;
    Ok(())
}

// ==================== 抓取日志 ====================

/// 写一条抓取日志。
#[allow(clippy::too_many_arguments)]
pub fn insert_fetch_log(
    p: &Ports<'_>,
    source_id: &str,
    started_at: i64,
    duration_ms: i64,
    ok: bool,
    http_status: Option<u16>,
    kind: Option<&str>,
    item_count: u32,
) -> Result<(), PortError> {
    p.db.execute_params(
        "INSERT INTO fetch_log (source_id, started_at, duration_ms, ok, http_status, error_kind, item_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        &[
            json!(source_id),
            json!(started_at),
            json!(duration_ms),
            json!(if ok { 1 } else { 0 }),
            arg_opt_num(http_status.map(i64::from)),
            arg_opt(kind),
            json!(item_count),
        ],
    )?;
    Ok(())
}

/// 最近抓取记录（含源名，按源过滤可选）。
pub fn load_fetch_log(
    p: &Ports<'_>,
    source_id: Option<&str>,
    limit: usize,
) -> Result<Vec<FetchLogEntry>, PortError> {
    let limit = limit.clamp(1, FETCH_LOG_PER_SOURCE as usize);
    let rows = match source_id {
        Some(id) => p.db.query_params(
            &format!(
                "SELECT f.id, f.source_id, COALESCE(s.name, f.source_id) AS source_name,
                        f.started_at, f.duration_ms, f.ok, f.http_status, f.error_kind, f.item_count
                   FROM fetch_log f LEFT JOIN sources s ON s.id = f.source_id
                  WHERE f.source_id = ?1
                  ORDER BY f.id DESC LIMIT {limit}"
            ),
            &[json!(id)],
        )?,
        None => p.db.query(&format!(
            "SELECT f.id, f.source_id, COALESCE(s.name, f.source_id) AS source_name,
                    f.started_at, f.duration_ms, f.ok, f.http_status, f.error_kind, f.item_count
               FROM fetch_log f LEFT JOIN sources s ON s.id = f.source_id
              ORDER BY f.id DESC LIMIT {limit}"
        ))?,
    };
    Ok(rows
        .iter()
        .filter_map(|row| {
            Some(FetchLogEntry {
                id: int(row, "id")?,
                source_id: text(row, "source_id")?,
                source_name: text(row, "source_name").unwrap_or_default(),
                started_at: int(row, "started_at").unwrap_or(0),
                duration_ms: int(row, "duration_ms").unwrap_or(0),
                ok: flag(row, "ok"),
                http_status: int(row, "http_status").map(|v| v as u16),
                error_kind: text(row, "error_kind"),
                item_count: int(row, "item_count").map(|v| v as u32),
            })
        })
        .collect())
}

// ==================== 条目 ====================

/// 视图取数用的条目行（未算权重）。
pub struct ItemRow {
    pub item: Item,
    pub favorited_at: Option<i64>,
}

/// 读窗口内的条目（含已读 / 收藏态）。
pub fn load_items(
    p: &Ports<'_>,
    since_ms: Option<i64>,
    favorite_only: bool,
) -> Result<Vec<ItemRow>, PortError> {
    let sql = if favorite_only {
        "SELECT i.id, i.canonical_url, i.title, i.summary, i.published_at, i.first_seen_at,
                i.lang, i.author, i.raw_url,
                st.read_at, st.favorited_at
           FROM items i
           JOIN item_state st ON st.item_id = i.id
          WHERE st.favorited_at IS NOT NULL
          ORDER BY st.favorited_at DESC
          LIMIT 500"
            .to_string()
    } else {
        let since = since_ms.unwrap_or(0);
        format!(
            "SELECT i.id, i.canonical_url, i.title, i.summary, i.published_at, i.first_seen_at,
                    i.lang, i.author, i.raw_url,
                    st.read_at, st.favorited_at
               FROM items i
               LEFT JOIN item_state st ON st.item_id = i.id
              WHERE i.first_seen_at >= {since}
              ORDER BY i.first_seen_at DESC
              LIMIT 500"
        )
    };
    let rows = p.db.query(&sql)?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            Some(ItemRow {
                item: Item {
                    id: text(row, "id")?,
                    title: text(row, "title")?,
                    url: text(row, "canonical_url")?,
                    summary: text(row, "summary"),
                    published_at: int(row, "published_at").unwrap_or(0),
                    first_seen_at: int(row, "first_seen_at").unwrap_or(0),
                    lang: text(row, "lang"),
                    author: text(row, "author"),
                    source_id: String::new(),
                    source_name: String::new(),
                    circle_id: None,
                    circle_name: String::new(),
                    read: int(row, "read_at").is_some(),
                    favorite: int(row, "favorited_at").is_some(),
                    favorited_at: int(row, "favorited_at"),
                    origin_count: 0,
                    score: 0.0,
                    origins: Vec::new(),
                },
                favorited_at: int(row, "favorited_at"),
            })
        })
        .collect())
}

/// 按条目 id 列表读来源归属。
pub fn load_origins(p: &Ports<'_>, item_ids: &[String]) -> Result<Vec<Origin>, PortError> {
    Ok(load_origins_grouped(p, item_ids)?
        .into_iter()
        .map(|(_, origin)| origin)
        .collect())
}

/// 按条目 id 列表读来源归属，并按条目分组。
pub fn load_origins_grouped(
    p: &Ports<'_>,
    item_ids: &[String],
) -> Result<Vec<(String, Origin)>, PortError> {
    if item_ids.is_empty() {
        return Ok(Vec::new());
    }
    let list = item_ids
        .iter()
        .map(|id| lit(id))
        .collect::<Vec<_>>()
        .join(", ");
    let rows = p.db.query(&format!(
        "SELECT o.item_id, o.source_id, o.raw_url, o.source_title, o.published_at,
                COALESCE(s.name, o.source_id) AS source_name
           FROM item_origins o
           LEFT JOIN sources s ON s.id = o.source_id
          WHERE o.item_id IN ({list})"
    ))?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            Some((
                text(row, "item_id")?,
                Origin {
                    source_id: text(row, "source_id")?,
                    source_name: text(row, "source_name").unwrap_or_default(),
                    raw_url: text(row, "raw_url")?,
                    source_title: text(row, "source_title"),
                    published_at: int(row, "published_at"),
                },
            ))
        })
        .collect())
}

/// 单条信息条（含全部来源归属）。
pub fn load_item(p: &Ports<'_>, item_id: &str) -> Result<Option<(Item, Vec<Origin>)>, PortError> {
    let rows = p.db.query_params(
        "SELECT i.id, i.canonical_url, i.title, i.summary, i.published_at, i.first_seen_at,
                i.lang, i.author, st.read_at, st.favorited_at
           FROM items i LEFT JOIN item_state st ON st.item_id = i.id
          WHERE i.id = ?1",
        &[json!(item_id)],
    )?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let origins = load_origins(p, &[item_id.to_string()])?;
    let primary = origins.first();
    let item = Item {
        id: text(row, "id").unwrap_or_default(),
        title: text(row, "title").unwrap_or_default(),
        url: text(row, "canonical_url").unwrap_or_default(),
        summary: text(row, "summary"),
        published_at: int(row, "published_at").unwrap_or(0),
        first_seen_at: int(row, "first_seen_at").unwrap_or(0),
        lang: text(row, "lang"),
        author: text(row, "author"),
        source_id: primary.map(|o| o.source_id.clone()).unwrap_or_default(),
        source_name: primary.map(|o| o.source_name.clone()).unwrap_or_default(),
        circle_id: None,
        circle_name: String::new(),
        read: int(row, "read_at").is_some(),
        favorite: int(row, "favorited_at").is_some(),
        favorited_at: int(row, "favorited_at"),
        origin_count: origins.len() as u32,
        score: 0.0,
        origins,
    };
    let origins = item.origins.clone();
    Ok(Some((item, origins)))
}

/// 插入信息条。
pub fn insert_item(p: &Ports<'_>, item: &Item, raw_url: &str) -> Result<(), PortError> {
    p.db.execute_params(
        "INSERT OR IGNORE INTO items
            (id, canonical_url, title, summary, published_at, first_seen_at, lang, author, raw_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        &[
            json!(item.id),
            json!(item.url),
            json!(item.title),
            arg_opt(item.summary.as_deref()),
            json!(item.published_at),
            json!(item.first_seen_at),
            arg_opt(item.lang.as_deref()),
            arg_opt(item.author.as_deref()),
            json!(raw_url),
        ],
    )?;
    Ok(())
}

/// 追加来源归属（`raw_url` 原样保存，用于详情页「各来源原始链接」）。
pub fn insert_origin(
    p: &Ports<'_>,
    item_id: &str,
    source_id: &str,
    raw_url: &str,
    source_title: Option<&str>,
    published_at: Option<i64>,
) -> Result<(), PortError> {
    p.db.execute_params(
        "INSERT OR IGNORE INTO item_origins (item_id, source_id, raw_url, source_title, published_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        &[
            json!(item_id),
            json!(source_id),
            json!(raw_url),
            arg_opt(source_title),
            arg_opt_num(published_at),
        ],
    )?;
    Ok(())
}

/// 同源最近条目（标题指纹去重与来源归属存在性检查用）。
pub fn load_source_recent(
    p: &Ports<'_>,
    source_id: &str,
    since_ms: i64,
) -> Result<Vec<(String, String, String)>, PortError> {
    let rows = p.db.query_params(
        &format!(
            "SELECT i.id, i.title, o.raw_url
               FROM items i JOIN item_origins o ON o.item_id = i.id
              WHERE o.source_id = ?1 AND i.first_seen_at >= {since_ms}
              ORDER BY i.first_seen_at DESC LIMIT 200"
        ),
        &[json!(source_id)],
    )?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            Some((
                text(row, "id")?,
                text(row, "title")?,
                text(row, "raw_url").unwrap_or_default(),
            ))
        })
        .collect())
}

/// 批量查询已存在的条目 id（id 由归一化地址派生，命中即同地址）。
pub fn existing_item_ids(p: &Ports<'_>, ids: &[String]) -> Result<Vec<String>, PortError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let list = ids.iter().map(|id| lit(id)).collect::<Vec<_>>().join(", ");
    let rows =
        p.db.query(&format!("SELECT id FROM items WHERE id IN ({list})"))?;
    Ok(rows.iter().filter_map(|row| text(row, "id")).collect())
}

/// 已读 / 未读。
pub fn set_read(p: &Ports<'_>, item_id: &str, read: bool, now_ms: i64) -> Result<(), PortError> {
    if read {
        p.db.execute_params(
            "INSERT INTO item_state (item_id, read_at) VALUES (?1, ?2)
             ON CONFLICT(item_id) DO UPDATE SET read_at = COALESCE(item_state.read_at, excluded.read_at)",
            &[json!(item_id), json!(now_ms)],
        )?;
    } else {
        p.db.execute_params(
            "INSERT INTO item_state (item_id, read_at) VALUES (?1, NULL)
             ON CONFLICT(item_id) DO UPDATE SET read_at = NULL",
            &[json!(item_id)],
        )?;
    }
    Ok(())
}

/// 全部标为已读（只影响窗口内条目，收藏的不动）。
pub fn mark_all_read(p: &Ports<'_>, item_ids: &[String], now_ms: i64) -> Result<u32, PortError> {
    let mut count = 0;
    for id in item_ids {
        set_read(p, id, true, now_ms)?;
        count += 1;
    }
    Ok(count)
}

/// 收藏 / 取消收藏。
pub fn set_favorite(
    p: &Ports<'_>,
    item_id: &str,
    favorite: bool,
    now_ms: i64,
) -> Result<(), PortError> {
    if favorite {
        p.db.execute_params(
            "INSERT INTO item_state (item_id, favorited_at) VALUES (?1, ?2)
             ON CONFLICT(item_id) DO UPDATE SET favorited_at = COALESCE(item_state.favorited_at, excluded.favorited_at)",
            &[json!(item_id), json!(now_ms)],
        )?;
    } else {
        p.db.execute_params(
            "INSERT INTO item_state (item_id, favorited_at) VALUES (?1, NULL)
             ON CONFLICT(item_id) DO UPDATE SET favorited_at = NULL",
            &[json!(item_id)],
        )?;
    }
    // 收藏状态是权威，归档是派生标记；派生写失败可被下次阅读校正。
    mark_archived(p, item_id, favorite)?;
    Ok(())
}

/// 写 AI 摘要（只补空，不覆盖更好的原文摘要由调用方决定）。
pub fn save_item_summary(p: &Ports<'_>, item_id: &str, summary: &str) -> Result<(), PortError> {
    p.db.execute_params(
        "UPDATE items SET summary = ?2 WHERE id = ?1",
        &[json!(item_id), json!(summary)],
    )?;
    Ok(())
}

/// 搜索（标题 / 摘要 LIKE，最近优先）。
pub fn search_items(
    p: &Ports<'_>,
    keyword: &str,
    limit: usize,
) -> Result<Vec<(Item, Vec<Origin>)>, PortError> {
    let pattern = format!("%{}%", keyword.replace('%', "").replace('\'', ""));
    let limit = limit.clamp(1, 50);
    let rows = p.db.query_params(
        &format!(
            "SELECT i.id, i.canonical_url, i.title, i.summary, i.published_at, i.first_seen_at,
                    i.lang, i.author, st.read_at, st.favorited_at
               FROM items i LEFT JOIN item_state st ON st.item_id = i.id
              WHERE i.title LIKE ?1 OR COALESCE(i.summary, '') LIKE ?1
              ORDER BY i.published_at DESC LIMIT {limit}"
        ),
        &[json!(pattern)],
    )?;
    let mut out = Vec::new();
    for row in rows {
        let Some(id) = text(&row, "id") else { continue };
        let origins = load_origins(p, &[id.clone()])?;
        let primary = origins.first();
        out.push((
            Item {
                id,
                title: text(&row, "title").unwrap_or_default(),
                url: text(&row, "canonical_url").unwrap_or_default(),
                summary: text(&row, "summary"),
                published_at: int(&row, "published_at").unwrap_or(0),
                first_seen_at: int(&row, "first_seen_at").unwrap_or(0),
                lang: text(&row, "lang"),
                author: text(&row, "author"),
                source_id: primary.map(|o| o.source_id.clone()).unwrap_or_default(),
                source_name: primary.map(|o| o.source_name.clone()).unwrap_or_default(),
                circle_id: None,
                circle_name: String::new(),
                read: int(&row, "read_at").is_some(),
                favorite: int(&row, "favorited_at").is_some(),
                favorited_at: int(&row, "favorited_at"),
                origin_count: origins.len() as u32,
                score: 0.0,
                origins,
            },
            Vec::new(),
        ));
    }
    Ok(out)
}

/// 已读条目 id 清单（导出用）。
pub fn load_read_flags(p: &Ports<'_>) -> Result<Vec<String>, PortError> {
    let rows =
        p.db.query("SELECT item_id FROM item_state WHERE read_at IS NOT NULL ORDER BY item_id")?;
    Ok(rows.iter().filter_map(|row| text(row, "item_id")).collect())
}

/// 收藏条目 id 清单（导出用）。
pub fn load_favorite_flags(p: &Ports<'_>) -> Result<Vec<String>, PortError> {
    let rows = p
        .db
        .query("SELECT item_id FROM item_state WHERE favorited_at IS NOT NULL ORDER BY item_id")?;
    Ok(rows.iter().filter_map(|row| text(row, "item_id")).collect())
}

// ==================== 正文副本 ====================

/// `item_content` 的一行（`blocks` 已解析；失败行 blocks 为空）。
#[derive(Debug, Clone, PartialEq)]
pub struct ContentRow {
    pub item_id: String,
    pub state: ReaderState,
    pub blocks: Vec<ContentBlock>,
    pub text_length: u32,
    pub bytes: u64,
    pub fetched_at: i64,
    pub last_attempt_at: i64,
    pub last_attempt_kind: Option<String>,
    pub error_kind: Option<String>,
    pub error_detail: Option<String>,
    pub truncated: bool,
    pub archived: bool,
}

fn storage_failed(detail: impl Into<String>) -> PortError {
    PortError::with_detail(error_kind::STORAGE_FAILED, detail)
}

/// 读一条正文副本。非法状态或损坏的 blocks JSON 一律显性失败，不回落为空正文。
pub fn load_content(p: &Ports<'_>, item_id: &str) -> Result<Option<ContentRow>, PortError> {
    let rows = p.db.query_params(
        "SELECT item_id, state, blocks_json, text_length, bytes, fetched_at,
                last_attempt_at, last_attempt_kind, error_kind, error_detail,
                truncated, archived
           FROM item_content WHERE item_id = ?1",
        &[json!(item_id)],
    )?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let state = match text(row, "state").as_deref() {
        Some("ready") => ReaderState::Ready,
        Some("failed") => ReaderState::Failed,
        other => {
            return Err(storage_failed(format!(
                "item_content has invalid state: {other:?}"
            )))
        }
    };
    let blocks = if state == ReaderState::Ready {
        let raw = text(row, "blocks_json")
            .ok_or_else(|| storage_failed("ready content has no blocks_json"))?;
        serde_json::from_str::<Vec<ContentBlock>>(&raw)
            .map_err(|e| storage_failed(format!("invalid blocks_json: {e}")))?
    } else {
        Vec::new()
    };
    Ok(Some(ContentRow {
        item_id: text(row, "item_id").unwrap_or_else(|| item_id.to_string()),
        state,
        blocks,
        text_length: int(row, "text_length").unwrap_or(0).max(0) as u32,
        bytes: int(row, "bytes").unwrap_or(0).max(0) as u64,
        fetched_at: int(row, "fetched_at").unwrap_or(0),
        last_attempt_at: int(row, "last_attempt_at").unwrap_or(0),
        last_attempt_kind: text(row, "last_attempt_kind"),
        error_kind: text(row, "error_kind"),
        error_detail: text(row, "error_detail"),
        truncated: flag(row, "truncated"),
        archived: flag(row, "archived"),
    }))
}

/// 写一条成功的正文副本；`bytes` 与 `text_length` 由块序列计算，返回写入字节数。
pub fn save_ready_content(
    p: &Ports<'_>,
    item_id: &str,
    blocks: &[ContentBlock],
    fetched_at: i64,
    truncated: bool,
    archived: bool,
) -> Result<u64, PortError> {
    let blocks_json = serde_json::to_string(blocks)
        .map_err(|e| storage_failed(format!("serialize content blocks: {e}")))?;
    let bytes = blocks_json.len() as u64;
    let text_length: u32 = blocks
        .iter()
        .map(|block| block.text.chars().count())
        .sum::<usize>()
        .min(u32::MAX as usize) as u32;
    p.db.execute_params(
        "INSERT INTO item_content
            (item_id, state, blocks_json, text_length, bytes, fetched_at,
             last_attempt_at, last_attempt_kind, error_kind, error_detail,
             truncated, archived)
         VALUES (?1, 'ready', ?2, ?3, ?4, ?5, ?5, NULL, NULL, NULL, ?6, ?7)
         ON CONFLICT(item_id) DO UPDATE SET
            state = 'ready',
            blocks_json = excluded.blocks_json,
            text_length = excluded.text_length,
            bytes = excluded.bytes,
            fetched_at = excluded.fetched_at,
            last_attempt_at = excluded.last_attempt_at,
            last_attempt_kind = NULL,
            error_kind = NULL,
            error_detail = NULL,
            truncated = excluded.truncated,
            archived = CASE
                WHEN item_content.archived = 1 OR excluded.archived = 1 THEN 1
                ELSE 0
            END",
        &[
            json!(item_id),
            json!(blocks_json),
            json!(text_length),
            json!(bytes),
            json!(fetched_at),
            json!(if truncated { 1 } else { 0 }),
            json!(if archived { 1 } else { 0 }),
        ],
    )?;
    Ok(bytes)
}

/// 记录一次失败尝试。已有 `ready` 正文时只更新尝试信息，保留旧正文与 `archived`。
pub fn save_failed_content(
    p: &Ports<'_>,
    item_id: &str,
    kind: &str,
    detail: Option<&str>,
    attempt_at: i64,
) -> Result<(), PortError> {
    p.db.execute_params(
        "INSERT INTO item_content
            (item_id, state, blocks_json, text_length, bytes, fetched_at,
             last_attempt_at, last_attempt_kind, error_kind, error_detail,
             truncated, archived)
         VALUES (?1, 'failed', NULL, 0, 0, ?2, ?2, ?3, ?3, ?4, 0, 0)
         ON CONFLICT(item_id) DO UPDATE SET
            fetched_at = CASE
                WHEN item_content.state = 'failed' THEN excluded.fetched_at
                ELSE item_content.fetched_at
            END,
            last_attempt_at = excluded.last_attempt_at,
            last_attempt_kind = excluded.last_attempt_kind,
            error_kind = CASE
                WHEN item_content.state = 'failed' THEN excluded.error_kind
                ELSE item_content.error_kind
            END,
            error_detail = CASE
                WHEN item_content.state = 'failed' THEN excluded.error_detail
                ELSE item_content.error_detail
            END",
        &[
            json!(item_id),
            json!(attempt_at),
            json!(kind),
            arg_opt(detail),
        ],
    )?;
    Ok(())
}

/// 设置归档标记；无正文行时是 no-op。
pub fn mark_archived(p: &Ports<'_>, item_id: &str, archived: bool) -> Result<(), PortError> {
    p.db.execute_params(
        "UPDATE item_content SET archived = ?2 WHERE item_id = ?1",
        &[json!(item_id), json!(if archived { 1 } else { 0 })],
    )?;
    Ok(())
}

/// 一次聚合返回四数：非归档条数 / 字节，归档条数 / 字节。
pub fn reader_stats(p: &Ports<'_>) -> Result<ReaderStats, PortError> {
    let rows = p.db.query(
        "SELECT
            COALESCE(SUM(CASE WHEN archived = 0 THEN 1 ELSE 0 END), 0) AS cached_count,
            COALESCE(SUM(CASE WHEN archived = 0 THEN bytes ELSE 0 END), 0) AS cached_bytes,
            COALESCE(SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END), 0) AS archived_count,
            COALESCE(SUM(CASE WHEN archived = 1 THEN bytes ELSE 0 END), 0) AS archived_bytes
           FROM item_content",
    )?;
    let row = rows.first();
    Ok(ReaderStats {
        cached_count: row
            .and_then(|value| int(value, "cached_count"))
            .unwrap_or(0)
            .max(0) as u32,
        cached_bytes: row
            .and_then(|value| int(value, "cached_bytes"))
            .unwrap_or(0)
            .max(0) as u64,
        archived_count: row
            .and_then(|value| int(value, "archived_count"))
            .unwrap_or(0)
            .max(0) as u32,
        archived_bytes: row
            .and_then(|value| int(value, "archived_bytes"))
            .unwrap_or(0)
            .max(0) as u64,
    })
}

/// 全部正文的字节总量。
pub fn sum_content_bytes(p: &Ports<'_>) -> Result<u64, PortError> {
    let rows =
        p.db.query("SELECT COALESCE(SUM(bytes), 0) AS total FROM item_content")?;
    Ok(rows
        .first()
        .and_then(|row| int(row, "total"))
        .unwrap_or(0)
        .max(0) as u64)
}

/// 清除正文；统计与删除使用同一过滤条件。
pub fn clear_content(p: &Ports<'_>, mode: ClearMode) -> Result<ClearedStats, PortError> {
    let filter = mode.where_clause();
    let rows = p.db.query(&format!(
        "SELECT COUNT(*) AS removed, COALESCE(SUM(bytes), 0) AS bytes
           FROM item_content WHERE {filter}"
    ))?;
    let removed = rows
        .first()
        .and_then(|row| int(row, "removed"))
        .unwrap_or(0)
        .max(0) as u32;
    let bytes = rows
        .first()
        .and_then(|row| int(row, "bytes"))
        .unwrap_or(0)
        .max(0) as u64;
    p.db.execute(&format!("DELETE FROM item_content WHERE {filter}"))?;
    Ok(ClearedStats { removed, bytes })
}

/// 按 `fetched_at` 从旧到新删除非归档正文，直到总量不超过软上限。
///
/// 归档正文永不自动删除；达到上限时返回剩余总量，由调用方决定拒绝新写入。
pub fn evict_oldest_unarchived(p: &Ports<'_>, limit_bytes: u64) -> Result<u64, PortError> {
    evict_oldest_unarchived_except(p, limit_bytes, None)
}

/// 同上，但保留指定条目的正文（用于「本次要覆盖的旧正文」）。
pub fn evict_oldest_unarchived_except(
    p: &Ports<'_>,
    limit_bytes: u64,
    keep_item_id: Option<&str>,
) -> Result<u64, PortError> {
    let mut total = sum_content_bytes(p)?;
    if total <= limit_bytes {
        return Ok(total);
    }
    let rows = p.db.query(
        "SELECT item_id, bytes FROM item_content
          WHERE archived = 0
          ORDER BY fetched_at ASC, item_id ASC",
    )?;
    for row in rows {
        if total <= limit_bytes {
            break;
        }
        let Some(item_id) = text(&row, "item_id") else {
            continue;
        };
        if keep_item_id == Some(item_id.as_str()) {
            continue;
        }
        let bytes = int(&row, "bytes").unwrap_or(0).max(0) as u64;
        p.db.execute_params(
            "DELETE FROM item_content WHERE item_id = ?1 AND archived = 0",
            &[json!(item_id)],
        )?;
        total = total.saturating_sub(bytes);
    }
    sum_content_bytes(p)
}

// ==================== 清理 ====================

/// 30 天清理：非收藏条目、孤儿来源归属、过期抓取日志、每源日志上限。
pub fn cleanup(p: &Ports<'_>, now_ms: i64) -> Result<u32, PortError> {
    let cutoff = now_ms - RETENTION_DAYS * 86_400_000;

    p.db.execute_params(
        "DELETE FROM item_content
          WHERE item_id IN (
              SELECT id FROM items
               WHERE first_seen_at < ?1
                 AND id NOT IN (SELECT item_id FROM item_state WHERE favorited_at IS NOT NULL)
          )",
        &[json!(cutoff)],
    )?;
    let removed = p.db.execute_params(
        "DELETE FROM items
          WHERE first_seen_at < ?1
            AND id NOT IN (SELECT item_id FROM item_state WHERE favorited_at IS NOT NULL)",
        &[json!(cutoff)],
    )?;
    p.db.execute("DELETE FROM item_origins WHERE item_id NOT IN (SELECT id FROM items)")?;
    p.db.execute("DELETE FROM item_content WHERE item_id NOT IN (SELECT id FROM items)")?;
    p.db.execute_params(
        "DELETE FROM fetch_log WHERE started_at < ?1",
        &[json!(cutoff)],
    )?;
    for source in load_sources(p)? {
        trim_fetch_log(p, &source.id)?;
    }
    Ok(removed.max(0) as u32)
}

/// 每源抓取日志裁剪到 200 行。
pub fn trim_fetch_log(p: &Ports<'_>, source_id: &str) -> Result<(), PortError> {
    p.db.execute_params(
        &format!(
            "DELETE FROM fetch_log
              WHERE source_id = ?1
                AND id NOT IN (SELECT id FROM fetch_log WHERE source_id = ?1
                                ORDER BY id DESC LIMIT {FETCH_LOG_PER_SOURCE})"
        ),
        &[json!(source_id)],
    )?;
    Ok(())
}

// ==================== 凭据 ====================

/// 凭据清单（只有掩码）。
pub fn list_credentials(p: &Ports<'_>) -> Result<Vec<CredentialSummary>, PortError> {
    let rows = p.db.query(
        "SELECT id, kind, label, secret_json, created_at, updated_at FROM credentials ORDER BY created_at",
    )?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let secret_json = text(row, "secret_json").unwrap_or_default();
            let secret: crate::adapters::AuthSecret =
                serde_json::from_str(&secret_json).unwrap_or_default();
            let raw = secret
                .cookie
                .as_deref()
                .or(secret.bearer.as_deref())
                .unwrap_or("");
            Some(CredentialSummary {
                id: text(row, "id")?,
                kind: text(row, "kind").unwrap_or_default(),
                label: text(row, "label").unwrap_or_default(),
                tail: tail_of(raw),
                len: raw.chars().count() as u32,
                created_at: int(row, "created_at").unwrap_or(0),
                updated_at: int(row, "updated_at").unwrap_or(0),
            })
        })
        .collect())
}

fn load_credential_ids(p: &Ports<'_>) -> Result<Vec<String>, PortError> {
    let rows = p.db.query("SELECT id FROM credentials")?;
    Ok(rows.iter().filter_map(|row| text(row, "id")).collect())
}

/// 读取凭据明文（**只允许适配器构造请求头使用**）。
pub fn load_credential_secret(
    p: &Ports<'_>,
    id: &str,
) -> Result<Option<crate::adapters::AuthSecret>, PortError> {
    let rows = p.db.query_params(
        "SELECT secret_json FROM credentials WHERE id = ?1",
        &[json!(id)],
    )?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let raw = text(row, "secret_json").unwrap_or_default();
    Ok(Some(serde_json::from_str(&raw).unwrap_or_default()))
}

/// 保存凭据（插入或覆盖）。
pub fn save_credential(
    p: &Ports<'_>,
    id: &str,
    kind: &str,
    label: &str,
    secret_json: &str,
    now_ms: i64,
) -> Result<(), PortError> {
    p.db.execute_params(
        "INSERT INTO credentials (id, kind, label, secret_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind, label = excluded.label,
            secret_json = excluded.secret_json, updated_at = excluded.updated_at",
        &[
            json!(id),
            json!(kind),
            json!(label),
            json!(secret_json),
            json!(now_ms),
        ],
    )?;
    Ok(())
}

/// 删除凭据（引用它的源把 `auth_id` 清空，抓取会显性报「缺凭据」）。
pub fn delete_credential(p: &Ports<'_>, id: &str, now_ms: i64) -> Result<(), PortError> {
    p.db.execute_params(
        "UPDATE sources SET auth_id = NULL, updated_at = ?2 WHERE auth_id = ?1",
        &[json!(id), json!(now_ms)],
    )?;
    p.db.execute_params("DELETE FROM credentials WHERE id = ?1", &[json!(id)])?;
    Ok(())
}

// ==================== 默认数据 ====================

/// 是否已经播种过默认源。
pub fn defaults_seeded(p: &Ports<'_>) -> Result<bool, PortError> {
    Ok(meta_get(p, "seeded")?.as_deref() == Some("1"))
}

/// 播种默认圈子与内置源（只在首次激活时执行）。
pub fn seed_defaults(p: &Ports<'_>, now_ms: i64) -> Result<bool, PortError> {
    if defaults_seeded(p)? {
        return Ok(false);
    }
    let circles = default_circles();
    for (order, (id, name)) in circles.iter().enumerate() {
        insert_circle(p, id, name, 1.0, order as i64, now_ms)?;
    }
    for source in default_sources() {
        let circle_id = match source.3 {
            "tech" => Some(circles[0].0),
            "world" => Some(circles[1].0),
            _ => None,
        };
        insert_source(
            p, source.0, source.1, source.2, source.4, circle_id, 1.0, None, now_ms,
        )?;
    }
    meta_set(p, "seeded", "1")?;
    Ok(true)
}

/// 默认圈子（id, 名称）。
pub fn default_circles() -> Vec<(&'static str, &'static str)> {
    vec![("circle-tech", "科技"), ("circle-world", "国际")]
}

/// 默认源：(id, 名称, kind, 圈子键, 地址)。
///
/// Reuters 已停止公开 RSS，国际新闻改用 The Guardian World；YouTube 用三个
/// 公开频道 id（频道页地址由适配器归一成 feeds 地址）。
pub fn default_sources() -> Vec<(
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
)> {
    vec![
        (
            "src-hn-top",
            "Hacker News Top",
            "hn",
            "tech",
            "https://hacker-news.firebaseio.com/v0/topstories.json",
        ),
        (
            "src-github-trending",
            "GitHub Trending",
            "github-trending",
            "tech",
            "https://github.com/trending",
        ),
        (
            "src-reddit-worldnews",
            "Reddit r/worldnews",
            "reddit",
            "world",
            "https://www.reddit.com/r/worldnews/hot.json",
        ),
        (
            "src-bbc-world",
            "BBC World",
            "rss",
            "world",
            "https://feeds.bbci.co.uk/news/world/rss.xml",
        ),
        (
            "src-verge",
            "The Verge",
            "rss",
            "tech",
            "https://www.theverge.com/rss/index.xml",
        ),
        (
            "src-guardian-world",
            "The Guardian World",
            "rss",
            "world",
            "https://www.theguardian.com/world/rss",
        ),
        (
            "src-yt-kurzgesagt",
            "Kurzgesagt",
            "youtube-rss",
            "tech",
            "https://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q",
        ),
        (
            "src-yt-veritasium",
            "Veritasium",
            "youtube-rss",
            "tech",
            "https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA",
        ),
        (
            "src-yt-ted",
            "TED",
            "youtube-rss",
            "tech",
            "https://www.youtube.com/channel/UCAuUUnT6oDeKwE6v1NGQxug",
        ),
    ]
}

// ==================== 工具 ====================

/// SQL 字符串字面量（IN 列表用；单引号翻倍）。
pub fn lit(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', "''"))
}

/// `Option<&str>` → 参数（None = NULL）。
fn arg_opt(value: Option<&str>) -> Value {
    match value {
        Some(v) => json!(v),
        None => Value::Null,
    }
}

fn arg_opt_num(value: Option<i64>) -> Value {
    match value {
        Some(v) => json!(v),
        None => Value::Null,
    }
}

/// 「未分组」伪圈子的展示名。
pub fn ungrouped_name() -> &'static str {
    "未分组"
}

/// 伪圈子 id（前端沿用同一常量）。
pub fn ungrouped_id() -> &'static str {
    UNGROUPED_CIRCLE_ID
}

/// 参数错误（供上层构造一致的错误码）。
pub fn invalid(detail: impl Into<String>) -> PortError {
    PortError::with_detail(error_kind::INVALID_ARGUMENT, detail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sql_literal_escapes_quotes() {
        assert_eq!(lit("a'b"), "'a''b'");
    }

    #[test]
    fn schema_covers_every_documented_table() {
        let joined = SCHEMA.join("\n");
        for table in [
            "meta",
            "circles",
            "sources",
            "source_state",
            "items",
            "item_origins",
            "item_state",
            "credentials",
            "settings",
            "fetch_log",
            "item_content",
        ] {
            assert!(
                joined.contains(&format!("CREATE TABLE IF NOT EXISTS {table}")),
                "缺表 {table}"
            );
        }
        assert!(joined.contains("CREATE INDEX IF NOT EXISTS idx_items_published"));
        assert!(joined.contains("CREATE INDEX IF NOT EXISTS idx_fetchlog_source"));
        assert!(joined.contains("CREATE INDEX IF NOT EXISTS idx_item_content_fetched"));
        assert!(joined.contains("CREATE INDEX IF NOT EXISTS idx_item_content_archived"));
    }

    #[test]
    fn schema_is_single_statement_per_entry() {
        // 宿主 execute 只执行单条语句：分号只允许出现在结尾，且没有跨表脚本
        for sql in SCHEMA {
            let trimmed = sql.trim();
            let semicolons = trimmed.matches(';').count();
            assert!(semicolons == 0, "不要写分号结尾以外的多语句: {trimmed}");
        }
    }

    #[test]
    fn default_sources_cover_all_documented_kinds_except_experimental() {
        let kinds: Vec<&str> = default_sources().iter().map(|s| s.2).collect();
        for kind in ["hn", "reddit", "github-trending", "rss", "youtube-rss"] {
            assert!(kinds.contains(&kind), "缺默认源种类 {kind}");
        }
        assert!(
            !kinds.contains(&"x-graphql"),
            "实验性源不预置（需要用户自备凭据）"
        );
    }

    #[test]
    fn default_circles_have_stable_ids() {
        let ids: Vec<&str> = default_circles().iter().map(|c| c.0).collect();
        assert_eq!(ids, vec!["circle-tech", "circle-world"]);
    }

    #[test]
    fn tail_of_returns_last_four_chars_only() {
        assert_eq!(tail_of("abcdefgh"), "efgh");
        assert_eq!(tail_of("abc"), "");
        assert_eq!(tail_of(""), "");
    }

    mod content_tests {
        use super::*;
        use crate::domain::{
            error_kind, BlockKind, ClearMode, ContentBlock, ReaderState, SettingsPatch,
        };
        use crate::engine;
        use crate::ports::DbPort;
        use crate::test_support::TestPorts;
        use serde_json::json;

        fn ports(now_ms: i64) -> TestPorts {
            let test = TestPorts::new(now_ms);
            migrate(&test.ports()).expect("schema migrates");
            test
        }

        fn paragraph(text: &str) -> ContentBlock {
            ContentBlock {
                kind: BlockKind::Paragraph,
                level: None,
                text: text.to_string(),
            }
        }

        fn insert_item_row(test: &TestPorts, id: &str, first_seen_at: i64) {
            test.db
                .execute_params(
                    "INSERT INTO items (id, canonical_url, title, published_at, first_seen_at, raw_url)
                     VALUES (?1, ?2, ?3, ?4, ?4, ?2)",
                    &[
                        json!(id),
                        json!(format!("https://example.com/{id}")),
                        json!(format!("title {id}")),
                        json!(first_seen_at),
                    ],
                )
                .expect("item inserts");
        }

        fn favorite(test: &TestPorts, item_id: &str, at: i64) {
            test.db
                .execute_params(
                    "INSERT INTO item_state (item_id, favorited_at) VALUES (?1, ?2)",
                    &[json!(item_id), json!(at)],
                )
                .expect("favorite inserts");
        }

        #[test]
        fn migration_runs_twice_and_records_version_two() {
            let test = ports(0);
            let p = test.ports();
            migrate(&p).expect("second migrate is idempotent");
            assert_eq!(
                meta_get(&p, "schema_version")
                    .expect("version reads")
                    .as_deref(),
                Some("2")
            );
        }

        #[test]
        fn ready_content_round_trips_bytes_and_text_length() {
            let test = ports(1_000);
            let p = test.ports();
            let blocks = vec![
                ContentBlock {
                    kind: BlockKind::Heading,
                    level: Some(2),
                    text: "标题".into(),
                },
                paragraph("第一段中文内容"),
            ];
            let saved = save_ready_content(&p, "item-1", &blocks, 1_000, false, false)
                .expect("content saves");
            let expected = serde_json::to_string(&blocks).expect("blocks serialize");
            assert_eq!(saved, expected.len() as u64);

            let row = load_content(&p, "item-1")
                .expect("content loads")
                .expect("row exists");
            assert_eq!(row.state, ReaderState::Ready);
            assert_eq!(row.blocks, blocks);
            assert_eq!(row.text_length, "标题第一段中文内容".chars().count() as u32);
            assert_eq!(row.fetched_at, 1_000);
            assert_eq!(row.last_attempt_at, 1_000);
            assert!(!row.archived);
            assert!(!row.truncated);
        }

        #[test]
        fn failed_attempt_keeps_existing_ready_content() {
            let test = ports(1_000);
            let p = test.ports();
            let blocks = vec![paragraph("可读正文")];
            save_ready_content(&p, "item-1", &blocks, 1_000, false, true).expect("ready saves");
            save_failed_content(&p, "item-1", error_kind::NET_FAILED, Some("timeout"), 2_000)
                .expect("failure records");

            let row = load_content(&p, "item-1")
                .expect("content loads")
                .expect("row exists");
            assert_eq!(row.state, ReaderState::Ready);
            assert_eq!(row.blocks, blocks);
            assert_eq!(row.fetched_at, 1_000);
            assert_eq!(row.last_attempt_at, 2_000);
            assert_eq!(
                row.last_attempt_kind.as_deref(),
                Some(error_kind::NET_FAILED)
            );
            assert_eq!(row.error_kind, None);
            assert!(row.archived);
        }

        #[test]
        fn failed_without_ready_writes_failed_row() {
            let test = ports(1_000);
            let p = test.ports();
            save_failed_content(
                &p,
                "item-1",
                error_kind::EXTRACT_NO_CONTENT,
                Some("no article"),
                3_000,
            )
            .expect("failure saves");

            let row = load_content(&p, "item-1")
                .expect("content loads")
                .expect("row exists");
            assert_eq!(row.state, ReaderState::Failed);
            assert!(row.blocks.is_empty());
            assert_eq!(row.fetched_at, 3_000);
            assert_eq!(row.last_attempt_at, 3_000);
            assert_eq!(
                row.error_kind.as_deref(),
                Some(error_kind::EXTRACT_NO_CONTENT)
            );
            assert_eq!(row.error_detail.as_deref(), Some("no article"));
        }

        #[test]
        fn invalid_blocks_json_is_a_storage_failure() {
            let test = ports(1_000);
            let p = test.ports();
            save_ready_content(&p, "item-1", &[paragraph("正文")], 1_000, false, false)
                .expect("ready saves");
            test.db
                .execute_params(
                    "UPDATE item_content SET blocks_json = ?1 WHERE item_id = ?2",
                    &[json!("not-json"), json!("item-1")],
                )
                .expect("corrupts row");

            let error = load_content(&p, "item-1").expect_err("corruption must fail");
            assert_eq!(error.code(), error_kind::STORAGE_FAILED);
        }

        #[test]
        fn stats_and_clear_use_the_same_scope() {
            let test = ports(1_000);
            let p = test.ports();
            save_ready_content(&p, "cached", &[paragraph("abc")], 1_000, false, false)
                .expect("cached saves");
            save_ready_content(&p, "archived", &[paragraph("de")], 1_000, false, true)
                .expect("archived saves");

            let stats = reader_stats(&p).expect("stats read");
            assert_eq!(stats.cached_count, 1);
            assert_eq!(stats.archived_count, 1);
            assert!(stats.cached_bytes > 0);
            assert!(stats.archived_bytes > 0);

            let cleared = clear_content(&p, ClearMode::Unarchived).expect("cache clears");
            assert_eq!(cleared.removed, stats.cached_count);
            assert_eq!(cleared.bytes, stats.cached_bytes);
            assert!(load_content(&p, "cached").expect("loads").is_none());
            assert!(load_content(&p, "archived").expect("loads").is_some());

            let stats = reader_stats(&p).expect("stats read");
            assert_eq!(stats.cached_count, 0);
            assert_eq!(stats.archived_count, 1);
        }

        #[test]
        fn clearing_all_content_does_not_touch_favorites() {
            let test = ports(1_000);
            let p = test.ports();
            insert_item_row(&test, "item-1", 1_000);
            favorite(&test, "item-1", 1_000);
            save_ready_content(&p, "item-1", &[paragraph("正文")], 1_000, false, true)
                .expect("ready saves");

            let cleared = clear_content(&p, ClearMode::All).expect("all clears");
            assert_eq!(cleared.removed, 1);
            assert!(load_content(&p, "item-1").expect("loads").is_none());
            assert_eq!(
                load_favorite_flags(&p).expect("favorites read"),
                vec!["item-1".to_string()]
            );
        }

        #[test]
        fn favorite_links_archive_and_unfavorite_keeps_content() {
            let test = ports(1_000);
            let p = test.ports();
            insert_item_row(&test, "item-1", 1_000);
            save_ready_content(&p, "item-1", &[paragraph("正文")], 1_000, false, false)
                .expect("ready saves");

            set_favorite(&p, "item-1", true, 2_000).expect("favorite");
            let row = load_content(&p, "item-1")
                .expect("loads")
                .expect("row exists");
            assert!(row.archived);
            assert_eq!(test.fetch.calls(), 0, "收藏不得触发抓取");

            set_favorite(&p, "item-1", false, 3_000).expect("unfavorite");
            let row = load_content(&p, "item-1")
                .expect("loads")
                .expect("row exists");
            assert!(!row.archived);
            assert_eq!(row.state, ReaderState::Ready);
            assert_eq!(row.blocks, vec![paragraph("正文")]);
        }

        #[test]
        fn cleanup_deletes_content_with_expired_items_and_keeps_favorites() {
            let now = 1_000_000_000_000;
            let old = now - (RETENTION_DAYS + 1) * 86_400_000;
            let test = ports(now);
            let p = test.ports();
            insert_item_row(&test, "old-free", old);
            insert_item_row(&test, "old-favorite", old);
            insert_item_row(&test, "fresh", now);
            favorite(&test, "old-favorite", old);
            for id in ["old-free", "old-favorite", "fresh"] {
                save_ready_content(
                    &p,
                    id,
                    &[paragraph("正文")],
                    old,
                    false,
                    id == "old-favorite",
                )
                .expect("content saves");
            }

            cleanup(&p, now).expect("cleanup runs");

            assert!(load_content(&p, "old-free").expect("loads").is_none());
            assert!(load_content(&p, "old-favorite").expect("loads").is_some());
            assert!(load_content(&p, "fresh").expect("loads").is_some());
            let orphans = test
                .db
                .query(
                    "SELECT item_id FROM item_content
                      WHERE item_id NOT IN (SELECT id FROM items)",
                )
                .expect("orphans query");
            assert!(orphans.is_empty(), "不得残留孤儿正文: {orphans:?}");
        }

        #[test]
        fn cleanup_deletes_content_before_items_even_if_item_delete_fails() {
            let now = 1_000_000_000_000;
            let old = now - (RETENTION_DAYS + 1) * 86_400_000;
            let test = ports(now);
            let p = test.ports();
            insert_item_row(&test, "old-free", old);
            save_ready_content(&p, "old-free", &[paragraph("正文")], old, false, false)
                .expect("content saves");

            test.db.fail_on("DELETE FROM items");
            let error = cleanup(&p, now).expect_err("item deletion fails");
            assert_eq!(error.code(), error_kind::STORAGE_FAILED);
            assert!(
                load_content(&p, "old-free").expect("loads").is_none(),
                "正文必须先于条目删除"
            );
        }

        #[test]
        fn eviction_only_removes_unarchived_content() {
            let test = ports(1_000);
            let p = test.ports();
            save_ready_content(&p, "cached", &[paragraph("aaa")], 1_000, false, false)
                .expect("cached saves");
            save_ready_content(&p, "archived", &[paragraph("bbb")], 1_000, false, true)
                .expect("archived saves");

            let remaining = evict_oldest_unarchived(&p, 0).expect("eviction runs");
            assert!(load_content(&p, "cached").expect("loads").is_none());
            let archived = load_content(&p, "archived")
                .expect("loads")
                .expect("row exists");
            assert!(archived.archived);
            assert_eq!(remaining, archived.bytes);
        }

        #[test]
        fn reader_setting_round_trips_without_touching_ai_fields() {
            let test = ports(1_000);
            let p = test.ports();
            assert!(!load_settings(&p).expect("settings load").reader_enabled);

            let patch = SettingsPatch {
                ai_model: Some("gpt-test".into()),
                reader_enabled: Some(true),
                ..Default::default()
            };
            let saved = engine::save_settings(&p, &patch).expect("settings save");
            assert!(saved.reader_enabled);
            assert_eq!(saved.ai_model, "gpt-test");

            let patch = SettingsPatch {
                reader_enabled: Some(false),
                ..Default::default()
            };
            let saved = engine::save_settings(&p, &patch).expect("settings save");
            assert!(!saved.reader_enabled);
            assert_eq!(saved.ai_model, "gpt-test");
        }
    }
}
