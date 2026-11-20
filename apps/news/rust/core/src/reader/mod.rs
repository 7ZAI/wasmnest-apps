//! 正文阅读：策略、抽取与读取编排。
//!
//! 这里只放与阅读有关的纯逻辑与编排；出网、库、时钟仍经端口。
//! 所有失败分成「命令错误」（开关关闭、条目不存在）与「可读态失败」
//! （网络 / 抽取 / 容量），后者由 [`ReaderView`] 承载，界面据此渲染错误态。

pub mod extract;
pub mod policy;
pub mod url;

use crate::adapters::DEFAULT_USER_AGENT;
use crate::domain::{
    error_kind, ClearMode, ClearedStats, Item, ReaderState, ReaderStats, ReaderView,
};
use crate::ports::{FetchRequest, FetchResponse, PortError, Ports};
use crate::store::{self, ContentRow};
use extract::{ExtractError, ExtractedContent};

const READER_ACCEPT: &str = "text/html, application/xhtml+xml;q=0.9, */*;q=0.8";

/// 读取或抓取一条正文。
pub fn read_item(
    p: &Ports<'_>,
    item_id: &str,
    force: bool,
    now_ms: i64,
) -> Result<ReaderView, PortError> {
    ensure_reader_enabled(p)?;
    let (item, _origins) = load_item(p, item_id)?;
    if !url::content_url_allowed(&item.url) {
        return Ok(failed_view(
            item_id,
            error_kind::EXTRACT_UNSUPPORTED,
            "the item URL is not http(s)",
            now_ms,
        ));
    }

    let existing = store::load_content(p, item_id)?;
    if !force {
        if let Some(view) = cached_view(&existing, now_ms) {
            return Ok(view);
        }
    }

    match fetch_and_extract(p, &item, now_ms) {
        Ok(content) => store_success(p, &item, content, false, now_ms),
        Err(failure) => record_failure(p, item_id, existing, failure, now_ms),
    }
}

/// 保存正文到本机；已有可读正文时只补归档标记，不重新抓取。
pub fn archive_item_content(
    p: &Ports<'_>,
    item_id: &str,
    now_ms: i64,
) -> Result<ReaderView, PortError> {
    ensure_reader_enabled(p)?;
    let (item, _origins) = load_item(p, item_id)?;
    if !url::content_url_allowed(&item.url) {
        return Ok(failed_view(
            item_id,
            error_kind::EXTRACT_UNSUPPORTED,
            "the item URL is not http(s)",
            now_ms,
        ));
    }

    let existing = store::load_content(p, item_id)?;
    if let Some(row) = existing.as_ref() {
        if row.state == ReaderState::Ready {
            return archive_existing(p, row);
        }
    }

    match fetch_and_extract(p, &item, now_ms) {
        Ok(content) => store_success(p, &item, content, true, now_ms),
        Err(failure) => record_failure(p, item_id, existing, failure, now_ms),
    }
}

/// 设置页用量；不依赖阅读开关。
pub fn reader_stats(p: &Ports<'_>) -> Result<ReaderStats, PortError> {
    store::reader_stats(p)
}

/// 清除正文；归档范围由调用方传入。
pub fn clear_content(p: &Ports<'_>, mode: ClearMode) -> Result<ClearedStats, PortError> {
    store::clear_content(p, mode)
}

fn ensure_reader_enabled(p: &Ports<'_>) -> Result<(), PortError> {
    if store::load_settings(p)?.reader_enabled {
        return Ok(());
    }
    Err(PortError::with_detail(
        error_kind::READER_DISABLED,
        "reader is disabled in settings",
    ))
}

fn load_item(
    p: &Ports<'_>,
    item_id: &str,
) -> Result<(Item, Vec<crate::domain::Origin>), PortError> {
    store::load_item(p, item_id)?.ok_or_else(|| store::invalid("reader: item not found"))
}

fn cached_view(existing: &Option<ContentRow>, now_ms: i64) -> Option<ReaderView> {
    let row = existing.as_ref()?;
    match row.state {
        ReaderState::Ready if policy::cache_is_fresh(row.archived, row.fetched_at, now_ms) => Some(
            ready_view(row, row.archived, false, None, None, row.last_attempt_at),
        ),
        ReaderState::Failed if policy::failure_is_fresh(row.last_attempt_at, now_ms) => {
            Some(failed_view_from_row(row))
        }
        _ => None,
    }
}

fn archive_existing(p: &Ports<'_>, row: &ContentRow) -> Result<ReaderView, PortError> {
    if row.archived {
        return Ok(ready_view(
            row,
            true,
            false,
            None,
            None,
            row.last_attempt_at,
        ));
    }
    match store::mark_archived(p, &row.item_id, true) {
        Ok(()) => Ok(ready_view(
            row,
            true,
            false,
            None,
            None,
            row.last_attempt_at,
        )),
        Err(_) => {
            let mut view = ready_view(row, false, false, None, None, row.last_attempt_at);
            view.error_kind = Some(error_kind::STORAGE_FAILED.into());
            view.error_detail = Some("failed to mark content archived".into());
            Ok(view)
        }
    }
}

fn store_success(
    p: &Ports<'_>,
    item: &Item,
    content: ExtractedContent,
    archive: bool,
    now_ms: i64,
) -> Result<ReaderView, PortError> {
    let previous = store::load_content(p, &item.id)?;
    let keep_item = previous
        .as_ref()
        .filter(|row| row.state == ReaderState::Ready)
        .map(|row| row.item_id.as_str());
    let limit = policy::STORAGE_SOFT_LIMIT_BYTES;
    let room_for_others = limit.saturating_sub(content.bytes);
    let total_after_evict = store::evict_oldest_unarchived_except(p, room_for_others, keep_item)?;
    let remaining_old = store::load_content(p, &item.id)?
        .map(|row| row.bytes)
        .unwrap_or(0);
    let projected = policy::projected_total(total_after_evict, remaining_old, content.bytes);
    if projected > limit {
        let failure = ReadFailure::new(
            error_kind::READER_STORAGE_FULL,
            "local reader storage is full",
        );
        let existing = store::load_content(p, &item.id)?;
        return record_failure(p, &item.id, existing, failure, now_ms);
    }

    let saved = store::save_ready_content(
        p,
        &item.id,
        &content.blocks,
        now_ms,
        content.truncated,
        item.favorite,
    )?;
    if saved != content.bytes {
        return Err(PortError::with_detail(
            error_kind::EXTRACT_FAILED,
            "stored byte length differs from extracted content",
        ));
    }

    let mut view = success_view(&item.id, &content, item.favorite, now_ms);
    if archive && !item.favorite {
        match store::mark_archived(p, &item.id, true) {
            Ok(()) => view.archived = true,
            Err(_) => {
                view.error_kind = Some(error_kind::STORAGE_FAILED.into());
                view.error_detail = Some("failed to mark content archived".into());
            }
        }
    }
    Ok(view)
}

fn success_view(
    item_id: &str,
    content: &ExtractedContent,
    archived: bool,
    now_ms: i64,
) -> ReaderView {
    ReaderView {
        item_id: item_id.to_string(),
        state: ReaderState::Ready,
        blocks: content.blocks.clone(),
        text_length: content.text_length,
        truncated: content.truncated,
        stale: false,
        archived,
        fetched_at: now_ms,
        last_attempt_at: now_ms,
        error_kind: None,
        error_detail: None,
    }
}

fn ready_view(
    row: &ContentRow,
    archived: bool,
    stale: bool,
    error_kind: Option<String>,
    error_detail: Option<String>,
    last_attempt_at: i64,
) -> ReaderView {
    ReaderView {
        item_id: row.item_id.clone(),
        state: ReaderState::Ready,
        blocks: row.blocks.clone(),
        text_length: row.text_length,
        truncated: row.truncated,
        stale,
        archived,
        fetched_at: row.fetched_at,
        last_attempt_at,
        error_kind,
        error_detail,
    }
}

fn failed_view_from_row(row: &ContentRow) -> ReaderView {
    ReaderView {
        item_id: row.item_id.clone(),
        state: ReaderState::Failed,
        blocks: Vec::new(),
        text_length: 0,
        truncated: false,
        stale: false,
        archived: false,
        fetched_at: row.fetched_at,
        last_attempt_at: row.last_attempt_at,
        error_kind: row.error_kind.clone(),
        error_detail: row.error_detail.clone(),
    }
}

fn failed_view(item_id: &str, kind: &str, detail: &str, attempt_at: i64) -> ReaderView {
    ReaderView {
        item_id: item_id.to_string(),
        state: ReaderState::Failed,
        blocks: Vec::new(),
        text_length: 0,
        truncated: false,
        stale: false,
        archived: false,
        fetched_at: attempt_at,
        last_attempt_at: attempt_at,
        error_kind: Some(kind.to_string()),
        error_detail: Some(detail.to_string()),
    }
}

fn record_failure(
    p: &Ports<'_>,
    item_id: &str,
    existing: Option<ContentRow>,
    failure: ReadFailure,
    now_ms: i64,
) -> Result<ReaderView, PortError> {
    let kind = failure.kind;
    let detail = failure.detail;
    store::save_failed_content(p, item_id, &kind, Some(&detail), now_ms)?;
    match existing {
        Some(row) if row.state == ReaderState::Ready => Ok(ready_view(
            &row,
            row.archived,
            true,
            Some(kind),
            Some(detail),
            now_ms,
        )),
        _ => Ok(failed_view(item_id, &kind, &detail, now_ms)),
    }
}

// ==================== 抓取与错误映射 ====================

#[derive(Debug, Clone)]
struct ReadFailure {
    kind: String,
    detail: String,
}

impl ReadFailure {
    fn new(kind: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            detail: detail.into(),
        }
    }
}

impl From<ExtractError> for ReadFailure {
    fn from(error: ExtractError) -> Self {
        Self::new(error.code(), error.detail())
    }
}

fn fetch_and_extract(
    p: &Ports<'_>,
    item: &Item,
    now_ms: i64,
) -> Result<ExtractedContent, ReadFailure> {
    if !url::content_url_allowed(&item.url) {
        return Err(ReadFailure::new(
            error_kind::EXTRACT_UNSUPPORTED,
            "the item URL is not http(s)",
        ));
    }
    let started = p.clock.now_ms().unwrap_or(now_ms);
    let request = FetchRequest {
        method: "GET".into(),
        url: item.url.clone(),
        headers: vec![
            ("Accept".to_string(), READER_ACCEPT.to_string()),
            ("User-Agent".to_string(), DEFAULT_USER_AGENT.to_string()),
        ],
        body: None,
    };
    let response = match p.fetch.fetch(request) {
        Ok(response) => response,
        Err(error) => {
            return Err(log_failure(
                p,
                item,
                map_fetch_error(error),
                started,
                now_ms,
            ))
        }
    };

    if !(200..300).contains(&response.status) {
        let failure = if response.status == 429 {
            ReadFailure::new(error_kind::RATE_LIMITED, "HTTP 429")
        } else {
            ReadFailure::new(error_kind::HTTP_STATUS, format!("HTTP {}", response.status))
        };
        return Err(log_failure(p, item, failure, started, now_ms));
    }

    if !is_html_response(&response) {
        let failure = ReadFailure::new(
            error_kind::EXTRACT_UNSUPPORTED,
            "response content-type is not HTML",
        );
        return Err(log_failure(p, item, failure, started, now_ms));
    }

    let content = match extract::extract(&response.body, &item.title) {
        Ok(content) => content,
        Err(error) => {
            return Err(log_failure(
                p,
                item,
                ReadFailure::from(error),
                started,
                now_ms,
            ));
        }
    };
    let finished = p.clock.now_ms().unwrap_or(now_ms);
    p.log.log_info(&format!(
        "news reader ok url={} status={} body_bytes={} text_length={} blocks={} duration_ms={}",
        url::redact_for_log(&item.url),
        response.status,
        response.body.len(),
        content.text_length,
        content.blocks.len(),
        finished.saturating_sub(started)
    ));
    Ok(content)
}

fn map_fetch_error(error: PortError) -> ReadFailure {
    let code = error.code();
    let detail = error.detail().to_ascii_lowercase();
    if code == error_kind::NET_DENIED {
        ReadFailure::new(error_kind::NET_DENIED, "network authorization was denied")
    } else if detail.contains("bytes limit") {
        ReadFailure::new(
            error_kind::EXTRACT_TOO_LARGE,
            "response exceeds the host size limit",
        )
    } else if detail.contains("not utf-8") {
        ReadFailure::new(error_kind::EXTRACT_ENCODING, "response body is not UTF-8")
    } else if code == error_kind::NET_FAILED {
        ReadFailure::new(error_kind::NET_FAILED, "network request failed")
    } else {
        ReadFailure::new(code, "request failed")
    }
}

fn log_failure(
    p: &Ports<'_>,
    item: &Item,
    failure: ReadFailure,
    started: i64,
    now_ms: i64,
) -> ReadFailure {
    let finished = p.clock.now_ms().unwrap_or(now_ms);
    p.log.log_warn(&format!(
        "news reader failed url={} kind={} duration_ms={}",
        url::redact_for_log(&item.url),
        failure.kind,
        finished.saturating_sub(started)
    ));
    failure
}

fn is_html_response(response: &FetchResponse) -> bool {
    let value = response
        .header("content-type")
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    value.starts_with("text/html") || value.starts_with("application/xhtml+xml")
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{BlockKind, ContentBlock};
    use crate::ports::DbPort;
    use crate::test_support::TestPorts;

    const NOW: i64 = 1_000_000_000_000;
    const DAY: i64 = 86_400_000;
    const ARTICLE: &str = "<html><body><article><p>Readable article body with enough words for the reader to keep it.</p><p>Second paragraph for a healthy extraction result.</p></article></body></html>";

    fn setup(enabled: bool) -> TestPorts {
        let test = TestPorts::new(NOW);
        store::migrate(&test.ports()).expect("schema migrates");
        store::setting_set(
            &test.ports(),
            "reader.enabled",
            if enabled { "1" } else { "0" },
        )
        .expect("reader setting writes");
        test
    }

    fn seed_item(test: &TestPorts, id: &str, url: &str, favorite: bool) {
        test.db
            .execute_params(
                "INSERT INTO items (id, canonical_url, title, published_at, first_seen_at, raw_url)
                 VALUES (?1, ?2, ?3, ?4, ?4, ?2)",
                &[
                    serde_json::json!(id),
                    serde_json::json!(url),
                    serde_json::json!("Item title"),
                    serde_json::json!(NOW),
                ],
            )
            .expect("item inserts");
        if favorite {
            test.db
                .execute_params(
                    "INSERT INTO item_state (item_id, favorited_at) VALUES (?1, ?2)
                     ON CONFLICT(item_id) DO UPDATE SET favorited_at = excluded.favorited_at",
                    &[serde_json::json!(id), serde_json::json!(NOW)],
                )
                .expect("favorite inserts");
        }
    }

    fn blocks() -> Vec<ContentBlock> {
        vec![ContentBlock {
            kind: BlockKind::Paragraph,
            level: None,
            text: "Cached body text with enough characters.".into(),
        }]
    }

    fn html_response(body: &str) -> FetchResponse {
        FetchResponse {
            status: 200,
            body: body.to_string(),
            headers: vec![("Content-Type".into(), "text/html; charset=utf-8".into())],
        }
    }

    fn failure_view_kind(test: &TestPorts, item_id: &str, now_ms: i64) -> String {
        read_item(&test.ports(), item_id, false, now_ms)
            .expect("view returns")
            .error_kind
            .expect("failure kind")
    }

    #[test]
    fn disabled_reader_does_not_fetch_or_read_cache() {
        let test = setup(false);
        let error = read_item(&test.ports(), "missing", false, NOW).expect_err("disabled");
        assert_eq!(error.code(), error_kind::READER_DISABLED);
        assert_eq!(test.fetch.calls(), 0);
    }

    #[test]
    fn unknown_item_is_invalid_without_fetch() {
        let test = setup(true);
        let error = read_item(&test.ports(), "missing", false, NOW).expect_err("missing item");
        assert_eq!(error.code(), error_kind::INVALID_ARGUMENT);
        assert_eq!(test.fetch.calls(), 0);
    }

    #[test]
    fn non_http_url_is_unsupported_without_fetch() {
        let test = setup(true);
        seed_item(&test, "item-1", "file:///etc/passwd", false);
        let view = read_item(&test.ports(), "item-1", false, NOW).expect("view returns");
        assert_eq!(view.state, ReaderState::Failed);
        assert_eq!(
            view.error_kind.as_deref(),
            Some(error_kind::EXTRACT_UNSUPPORTED)
        );
        assert_eq!(test.fetch.calls(), 0);
        assert!(store::load_content(&test.ports(), "item-1")
            .expect("loads")
            .is_none());
    }

    #[test]
    fn fresh_cache_hit_does_not_fetch() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", false);
        store::save_ready_content(&test.ports(), "item-1", &blocks(), NOW - DAY, false, false)
            .expect("content saves");

        let view = read_item(&test.ports(), "item-1", false, NOW).expect("view returns");
        assert_eq!(view.state, ReaderState::Ready);
        assert!(!view.stale);
        assert_eq!(view.blocks, blocks());
        assert_eq!(test.fetch.calls(), 0);
    }

    #[test]
    fn archived_content_ignores_ttl() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", true);
        store::save_ready_content(
            &test.ports(),
            "item-1",
            &blocks(),
            NOW - 30 * DAY,
            false,
            true,
        )
        .expect("content saves");

        let view = read_item(&test.ports(), "item-1", false, NOW).expect("view returns");
        assert_eq!(view.state, ReaderState::Ready);
        assert!(view.archived);
        assert_eq!(test.fetch.calls(), 0);
    }

    #[test]
    fn expired_content_refetches_and_updates_success_time() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", false);
        store::save_ready_content(
            &test.ports(),
            "item-1",
            &blocks(),
            NOW - 8 * DAY,
            false,
            false,
        )
        .expect("content saves");
        test.fetch.enqueue_ok(html_response(ARTICLE));

        let view = read_item(&test.ports(), "item-1", false, NOW).expect("view returns");
        assert_eq!(view.state, ReaderState::Ready);
        assert_eq!(test.fetch.calls(), 1);
        let row = store::load_content(&test.ports(), "item-1")
            .expect("loads")
            .expect("row exists");
        assert_eq!(row.fetched_at, NOW);
        let expected_bytes = serde_json::to_string(&view.blocks)
            .expect("blocks serialize")
            .len() as u64;
        assert_eq!(row.bytes, expected_bytes);
    }

    #[test]
    fn request_headers_are_minimal_and_use_shared_user_agent() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", false);
        test.fetch.enqueue_ok(html_response(ARTICLE));

        read_item(&test.ports(), "item-1", false, NOW).expect("view returns");
        let request = test.fetch.requests().into_iter().next().expect("request");
        assert_eq!(request.headers.len(), 2, "正文请求不得带凭据");
        assert_eq!(request.headers[0].0, "Accept");
        assert_eq!(request.headers[1].0, "User-Agent");
        assert_eq!(request.headers[1].1, crate::adapters::DEFAULT_USER_AGENT);
    }

    #[test]
    fn logs_redact_url_and_omit_body() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a?token=secret", false);
        test.fetch.enqueue_ok(html_response(
            "<html><body><article><p>private body text that must not be logged in reader logs.</p></article></body></html>",
        ));

        read_item(&test.ports(), "item-1", false, NOW).expect("view returns");
        let logs = test
            .log
            .infos()
            .into_iter()
            .chain(test.log.warns())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(logs.contains("https://example.com/a"), "logs: {logs}");
        assert!(!logs.contains("private body"), "logs: {logs}");
        assert!(!logs.contains("token=secret"), "logs: {logs}");
    }

    #[test]
    fn stale_keeps_old_content_and_marks_attempt() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", false);
        store::save_ready_content(
            &test.ports(),
            "item-1",
            &blocks(),
            NOW - 8 * DAY,
            false,
            false,
        )
        .expect("content saves");
        test.fetch
            .enqueue_err(PortError::with_detail(error_kind::NET_FAILED, "timeout"));

        let view = read_item(&test.ports(), "item-1", false, NOW).expect("view returns");
        assert_eq!(view.state, ReaderState::Ready);
        assert!(view.stale);
        assert_eq!(view.error_kind.as_deref(), Some(error_kind::NET_FAILED));
        assert_eq!(view.blocks, blocks());
        assert_eq!(view.fetched_at, NOW - 8 * DAY);
        assert_eq!(view.last_attempt_at, NOW);

        let row = store::load_content(&test.ports(), "item-1")
            .expect("loads")
            .expect("row exists");
        assert_eq!(
            row.last_attempt_kind.as_deref(),
            Some(error_kind::NET_FAILED)
        );
        assert_eq!(row.fetched_at, NOW - 8 * DAY);
    }

    #[test]
    fn failed_record_ttl_skips_network() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", false);
        test.fetch
            .enqueue_err(PortError::with_detail(error_kind::NET_FAILED, "timeout"));
        let first = read_item(&test.ports(), "item-1", false, NOW).expect("failed view");
        assert_eq!(first.state, ReaderState::Failed);
        assert_eq!(test.fetch.calls(), 1);

        let cached = read_item(&test.ports(), "item-1", false, NOW + 10 * 60_000 - 1)
            .expect("cached failure");
        assert_eq!(cached.state, ReaderState::Failed);
        assert_eq!(test.fetch.calls(), 1);

        test.fetch
            .enqueue_err(PortError::with_detail(error_kind::NET_FAILED, "timeout"));
        let retried =
            read_item(&test.ports(), "item-1", false, NOW + 10 * 60_000).expect("retried failure");
        assert_eq!(retried.state, ReaderState::Failed);
        assert_eq!(test.fetch.calls(), 2);
    }

    #[test]
    fn force_bypasses_valid_cache() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", false);
        store::save_ready_content(&test.ports(), "item-1", &blocks(), NOW - DAY, false, false)
            .expect("content saves");
        test.fetch.enqueue_ok(html_response(ARTICLE));

        let view = read_item(&test.ports(), "item-1", true, NOW).expect("view returns");
        assert_eq!(view.state, ReaderState::Ready);
        assert_eq!(test.fetch.calls(), 1);
    }

    #[test]
    fn archive_ready_content_only_marks_without_fetching() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", false);
        store::save_ready_content(&test.ports(), "item-1", &blocks(), NOW, false, false)
            .expect("content saves");

        let view = archive_item_content(&test.ports(), "item-1", NOW).expect("archive");
        assert!(view.archived);
        assert_eq!(test.fetch.calls(), 0);
        assert!(
            store::load_content(&test.ports(), "item-1")
                .expect("loads")
                .expect("row exists")
                .archived
        );
    }

    #[test]
    fn archive_write_failure_still_returns_readable_content() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", false);
        store::save_ready_content(&test.ports(), "item-1", &blocks(), NOW, false, false)
            .expect("content saves");
        test.db.fail_on("UPDATE item_content SET archived");

        let view = archive_item_content(&test.ports(), "item-1", NOW).expect("archive");
        assert_eq!(view.state, ReaderState::Ready);
        assert!(!view.archived);
        assert_eq!(view.error_kind.as_deref(), Some(error_kind::STORAGE_FAILED));
        assert_eq!(view.blocks, blocks());
    }

    #[test]
    fn favorite_read_archives_new_content() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", true);
        test.fetch.enqueue_ok(html_response(ARTICLE));

        let view = read_item(&test.ports(), "item-1", false, NOW).expect("view returns");
        assert!(view.archived);
        assert!(
            store::load_content(&test.ports(), "item-1")
                .expect("loads")
                .expect("row exists")
                .archived
        );
    }

    #[test]
    fn http_and_content_type_errors_are_classified() {
        for (status, content_type, expected) in [
            (401, Some("text/html"), error_kind::HTTP_STATUS),
            (429, Some("text/html"), error_kind::RATE_LIMITED),
            (
                200,
                Some("application/pdf"),
                error_kind::EXTRACT_UNSUPPORTED,
            ),
            (200, None, error_kind::EXTRACT_UNSUPPORTED),
        ] {
            let test = setup(true);
            seed_item(&test, "item-1", "https://example.com/a", false);
            let mut response = html_response(ARTICLE);
            response.status = status;
            match content_type {
                Some(value) => {
                    response.headers = vec![("Content-Type".into(), value.into())];
                }
                None => response.headers.clear(),
            }
            test.fetch.enqueue_ok(response);

            let view = read_item(&test.ports(), "item-1", false, NOW).expect("view returns");
            assert_eq!(view.state, ReaderState::Failed, "status {status}");
            assert_eq!(
                view.error_kind.as_deref(),
                Some(expected),
                "status {status}"
            );
        }
    }

    #[test]
    fn fetch_errors_are_classified() {
        for (code, detail, expected) in [
            (
                error_kind::NET_DENIED,
                "network authorization denied",
                error_kind::NET_DENIED,
            ),
            (
                error_kind::NET_FAILED,
                "response exceeds 33554432 bytes limit",
                error_kind::EXTRACT_TOO_LARGE,
            ),
            (
                error_kind::NET_FAILED,
                "response body is not UTF-8",
                error_kind::EXTRACT_ENCODING,
            ),
            (
                error_kind::NET_FAILED,
                "connection reset",
                error_kind::NET_FAILED,
            ),
        ] {
            let test = setup(true);
            seed_item(&test, "item-1", "https://example.com/a", false);
            test.fetch.enqueue_err(PortError::with_detail(code, detail));
            assert_eq!(failure_view_kind(&test, "item-1", NOW), expected);
        }
    }

    #[test]
    fn capacity_full_refuses_new_content_and_keeps_archive() {
        let test = setup(true);
        seed_item(&test, "item-1", "https://example.com/a", false);
        test.db
            .execute_params(
                "INSERT INTO item_content
                    (item_id, state, blocks_json, text_length, bytes, fetched_at,
                     last_attempt_at, last_attempt_kind, error_kind, error_detail,
                     truncated, archived)
                 VALUES ('old-archived', 'ready', '[]', 0, ?1, ?2, ?2, NULL, NULL, NULL, 0, 1)",
                &[
                    serde_json::json!(policy::STORAGE_SOFT_LIMIT_BYTES + 1),
                    serde_json::json!(NOW),
                ],
            )
            .expect("large archived row inserts");
        test.fetch.enqueue_ok(html_response(ARTICLE));

        let view = read_item(&test.ports(), "item-1", false, NOW).expect("view returns");
        assert_eq!(view.state, ReaderState::Failed);
        assert_eq!(
            view.error_kind.as_deref(),
            Some(error_kind::READER_STORAGE_FULL)
        );
        assert!(
            store::load_content(&test.ports(), "old-archived")
                .expect("loads")
                .expect("archive exists")
                .archived
        );
    }

    #[test]
    fn stats_are_available_when_reader_is_disabled() {
        let test = setup(false);
        seed_item(&test, "item-1", "https://example.com/a", false);
        store::save_ready_content(&test.ports(), "item-1", &blocks(), NOW, false, false)
            .expect("content saves");

        let stats = reader_stats(&test.ports()).expect("stats");
        assert_eq!(stats.cached_count, 1);
        assert!(stats.cached_bytes > 0);
    }

    #[test]
    fn clear_modes_keep_favorites_and_match_stats() {
        let test = setup(false);
        seed_item(&test, "item-1", "https://example.com/a", false);
        seed_item(&test, "item-2", "https://example.com/b", true);
        store::save_ready_content(&test.ports(), "item-1", &blocks(), NOW, false, false)
            .expect("content saves");
        store::save_ready_content(&test.ports(), "item-2", &blocks(), NOW, false, true)
            .expect("content saves");

        let stats = reader_stats(&test.ports()).expect("stats");
        let cleared =
            clear_content(&test.ports(), ClearMode::Unarchived).expect("unarchived clears");
        assert_eq!(cleared.removed, stats.cached_count);
        assert_eq!(cleared.bytes, stats.cached_bytes);
        assert_eq!(
            store::load_favorite_flags(&test.ports()).expect("favorites"),
            vec!["item-2".to_string()]
        );

        let cleared = clear_content(&test.ports(), ClearMode::All).expect("all clears");
        assert_eq!(cleared.removed, 1);
        assert_eq!(
            store::load_favorite_flags(&test.ports()).expect("favorites"),
            vec!["item-2".to_string()]
        );
    }
}
