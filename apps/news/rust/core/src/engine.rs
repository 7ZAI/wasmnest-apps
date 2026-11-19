//! 抓取引擎与视图装配：把端口、适配器、去重与排序串成一条完整路径。
//!
//! 编排层只做决定，不做 I/O：出网、读写库、剪贴板全在端口后面。

use crate::adapters::{self, AdapterError, AuthSecret, Step};
use crate::dedup::{self, Decision, ExistingItem};
use crate::domain::{
    error_kind, AiBatchSummaryResult, AiSummaryResult, Circle, Feed, FeedQuery, FeedView,
    FetchLogEntry, Item, Origin, RawItem, RefreshOutcome, SearchHit, Settings, Source,
    SourceFetchResult, SourceKind, SourceState, TodaySummaryEntry, UNGROUPED_CIRCLE_ID,
};
use crate::ports::{Ports, PortError};
use crate::schedule;
use crate::store;
use crate::summary;
use crate::urlutil;
use crate::views;

/// 刷新口径。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshMode {
    /// 用户显式刷新：绕过退避，仅受每源 60 秒防抖约束。
    Manual,
    /// 定时节拍 / 激活补抓：退避优先，未退避时按 15 分钟节拍。
    Auto,
    /// 回前台补抓：只看「上次成功是否超过 15 分钟」，退避中的源不动。
    Stale,
}

/// 一次批处理的执行口径。
#[derive(Debug, Clone, Copy)]
pub struct RefreshRequest {
    pub mode: RefreshMode,
    /// 是否尊重退避（助手工具要求退避中直接报错，不必替用户强闯）。
    pub respect_backoff: bool,
}

impl RefreshRequest {
    /// 界面手动刷新。
    pub fn manual() -> Self {
        Self {
            mode: RefreshMode::Manual,
            respect_backoff: false,
        }
    }

    /// 助手工具刷新（退避中报错）。
    pub fn tool() -> Self {
        Self {
            mode: RefreshMode::Manual,
            respect_backoff: true,
        }
    }

    /// 定时节拍。
    pub fn auto() -> Self {
        Self {
            mode: RefreshMode::Auto,
            respect_backoff: true,
        }
    }

    /// 回前台补抓。
    pub fn stale() -> Self {
        Self {
            mode: RefreshMode::Stale,
            respect_backoff: true,
        }
    }
}

// ==================== 生命周期 ====================

/// 激活期初始化：建表、播种默认源、清理过期数据。
pub fn init(p: &Ports<'_>, now_ms: i64) -> Result<u32, PortError> {
    store::migrate(p)?;
    store::seed_defaults(p, now_ms)?;
    let removed = store::cleanup(p, now_ms)?;
    if removed > 0 {
        p.log.log_info(&format!("news cleanup removed {removed} stale items"));
    }
    Ok(removed)
}

// ==================== 视图 ====================

/// 计算一条信息条在当前源 / 圈子权重下的分数与来源归属。
///
/// 合并条目的权重取「各来源最大」：与抓取先后无关，谁先抓到都不影响排序。
fn apply_weights(
    item: &mut Item,
    origins: &[Origin],
    sources: &[Source],
    circles: &[Circle],
    now_ms: i64,
) {
    let mut best_weight = 0.0f64;
    for origin in origins {
        let Some(source) = sources.iter().find(|s| s.id == origin.source_id) else {
            // 删源时已清掉它的 item_origins；仍残留的归属不参与权重，但保留在计数里。
            continue;
        };
        let circle_weight = source
            .circle_id
            .as_ref()
            .and_then(|id| circles.iter().find(|c| &c.id == id))
            .map(|c| c.weight)
            .unwrap_or(1.0);
        let combined = views::clamp_weight(source.weight) * views::clamp_weight(circle_weight);
        if combined > best_weight {
            best_weight = combined;
        }
    }
    if best_weight == 0.0 {
        best_weight = 1.0;
    }
    item.origin_count = origins.len() as u32;
    item.score = views::score(item.published_at, now_ms, best_weight, item.origin_count);
    if let Some(primary) = origins.first() {
        item.source_id = primary.source_id.clone();
        item.source_name = primary.source_name.clone();
        let circle = sources
            .iter()
            .find(|s| s.id == primary.source_id)
            .and_then(|s| s.circle_id.clone())
            .and_then(|id| circles.iter().find(|c| c.id == id).cloned());
        match circle {
            Some(circle) => {
                item.circle_id = Some(circle.id.clone());
                item.circle_name = circle.name.clone();
            }
            None => {
                item.circle_id = None;
                item.circle_name = store::ungrouped_name().to_string();
            }
        }
    }
}

fn origin_belongs_to_circle(
    origin: &Origin,
    sources: &[Source],
    target: &str,
) -> bool {
    let Some(source) = sources.iter().find(|s| s.id == origin.source_id) else {
        return false;
    };
    if target == UNGROUPED_CIRCLE_ID {
        return source.circle_id.is_none();
    }
    source.circle_id.as_deref() == Some(target)
}

/// 查询一条视图。
pub fn feed(p: &Ports<'_>, query: &FeedQuery, now_ms: i64) -> Result<Feed, PortError> {
    let sources = store::load_sources(p)?;
    let circles = store::load_circles(p)?;
    let since = views::window_start(query.view, now_ms);
    let rows = store::load_items(p, since, query.view == FeedView::Saved)?;
    let ids: Vec<String> = rows.iter().map(|r| r.item.id.clone()).collect();
    let mut origins_by_item: std::collections::BTreeMap<String, Vec<Origin>> =
        std::collections::BTreeMap::new();
    for (item_id, origin) in store::load_origins_grouped(p, &ids)? {
        origins_by_item.entry(item_id).or_default().push(origin);
    }

    let mut items: Vec<Item> = Vec::new();
    for row in rows {
        let mut item = row.item;
        let origins = origins_by_item.remove(&item.id).unwrap_or_default();
        if origins.is_empty() {
            // 归属已被删空（删源会清 item_origins）：条目仍留在库里等 30 天清理，
            // 但没有来源可展示，不进视图。仅「停用」的来源不影响条目可见性。
            continue;
        }
        if query.view == FeedView::Circles {
            if let Some(target) = &query.circle_id {
                let hit = origins
                    .iter()
                    .any(|origin| origin_belongs_to_circle(origin, &sources, target));
                if !hit {
                    continue;
                }
            }
        }
        apply_weights(&mut item, &origins, &sources, &circles, now_ms);
        items.push(item);
    }
    views::sort_for_view(&mut items, query.view);
    Ok(Feed {
        items,
        window_hours: views::window_hours(query.view),
        generated_at: now_ms,
    })
}

/// 单条详情（含全部来源归属）。
pub fn item_detail(
    p: &Ports<'_>,
    item_id: &str,
    now_ms: i64,
) -> Result<Option<(Item, Vec<Origin>)>, PortError> {
    let Some((mut item, origins)) = store::load_item(p, item_id)? else {
        return Ok(None);
    };
    let sources = store::load_sources(p)?;
    let circles = store::load_circles(p)?;
    apply_weights(&mut item, &origins, &sources, &circles, now_ms);
    Ok(Some((item, origins)))
}

// ==================== 刷新 ====================

/// 被口径跳过的源（没发请求，不是失败）。
fn skipped(source: &Source, reason: &str) -> SourceFetchResult {
    SourceFetchResult {
        source_id: source.id.clone(),
        source_name: source.name.clone(),
        ok: false,
        new_items: 0,
        parsed_items: 0,
        http_status: None,
        error_kind: None,
        error_detail: None,
        next_retry_at: source.state.next_retry_at,
        duration_ms: 0,
        skipped: Some(reason.to_string()),
    }
}

/// 全部启用源按口径刷新。
pub fn refresh_all(
    p: &Ports<'_>,
    request: RefreshRequest,
    now_ms: i64,
) -> Result<RefreshOutcome, PortError> {
    let sources = store::load_sources(p)?;
    let mut results = Vec::new();
    let mut manual_attempts = 0u32;
    let mut debounced = 0u32;

    for source in sources.iter().filter(|s| s.enabled) {
        let state = &source.state;
        match request.mode {
            RefreshMode::Manual => {
                if schedule::manual_debounced(state.last_fetch_at, now_ms) {
                    results.push(skipped(source, "debounced"));
                    debounced += 1;
                    continue;
                }
                manual_attempts += 1;
            }
            RefreshMode::Auto => {
                if !schedule::auto_due(state.last_ok_at, state.next_retry_at, now_ms) {
                    results.push(skipped(source, "not-due"));
                    continue;
                }
            }
            RefreshMode::Stale => {
                if schedule::in_backoff(state.next_retry_at, now_ms)
                    || !schedule::stale_due(state.last_ok_at, now_ms)
                {
                    results.push(skipped(source, "not-due"));
                    continue;
                }
            }
        }
        if request.respect_backoff && schedule::in_backoff(state.next_retry_at, now_ms) {
            results.push(skipped(source, "backoff"));
            continue;
        }
        results.push(fetch_source(p, source, now_ms)?);
    }

    let failed = results.iter().filter(|r| !r.ok && r.skipped.is_none()).count() as u32;
    let new_items = results.iter().map(|r| r.new_items).sum();
    let skipped_count = results.iter().filter(|r| r.skipped.is_some()).count() as u32;
    let blocked = if request.mode == RefreshMode::Manual
        && manual_attempts == 0
        && debounced > 0
    {
        Some("refresh.debounced".to_string())
    } else {
        None
    };

    let outcome = RefreshOutcome {
        results,
        failed,
        new_items,
        skipped: skipped_count,
        blocked,
    };
    p.events.emit(
        "plugin:news:refreshed",
        &serde_json::json!({
            "failed": outcome.failed,
            "newItems": outcome.new_items,
            "skipped": outcome.skipped,
        }),
    );
    Ok(outcome)
}

/// 单个源刷新（界面 / 助手工具共用）。
pub fn refresh_one(
    p: &Ports<'_>,
    source_id: &str,
    request: RefreshRequest,
    now_ms: i64,
) -> Result<SourceFetchResult, PortError> {
    let sources = store::load_sources(p)?;
    let Some(source) = sources.into_iter().find(|s| s.id == source_id) else {
        return Err(PortError::with_detail(
            error_kind::SOURCE_UNAVAILABLE,
            format!("source {source_id} does not exist"),
        ));
    };
    if !source.enabled {
        return Err(PortError::with_detail(
            error_kind::SOURCE_UNAVAILABLE,
            format!("source {source_id} is disabled"),
        ));
    }
    if request.respect_backoff && schedule::in_backoff(source.state.next_retry_at, now_ms) {
        return Err(PortError::with_detail(
            error_kind::RATE_LIMITED,
            format!(
                "source {source_id} is in backoff until {}",
                source.state.next_retry_at.unwrap_or(now_ms)
            ),
        ));
    }
    if request.mode == RefreshMode::Manual
        && schedule::manual_debounced(source.state.last_fetch_at, now_ms)
    {
        return Ok(skipped(&source, "debounced"));
    }
    fetch_source(p, &source, now_ms)
}

/// 抓一个源并落库。源级失败**不返回 Err**（结果里带错误分类），只有库故障才 Err。
fn fetch_source(
    p: &Ports<'_>,
    source: &Source,
    now_ms: i64,
) -> Result<SourceFetchResult, PortError> {
    let begin = p.clock.now_ms().unwrap_or(now_ms);
    let kind = match SourceKind::parse(&source.kind) {
        Some(kind) => kind,
        None => {
            return finish_failure(
                p,
                source,
                now_ms,
                begin,
                error_kind::INVALID_ARGUMENT,
                &format!("unknown source kind '{}'", source.kind),
                None,
            )
        }
    };

    let secret: Option<AuthSecret> = match &source.auth_id {
        Some(id) => store::load_credential_secret(p, id)?,
        None => None,
    };

    let step = match adapters::build_step(kind, &source.url, secret.as_ref()) {
        Ok(step) => step,
        Err(err) => {
            return finish_failure(
                p,
                source,
                now_ms,
                begin,
                err.kind(),
                err.detail(),
                None,
            )
        }
    };

    match step {
        Step::Single(request) => {
            let response = match p.fetch.fetch(request) {
                Ok(response) => response,
                Err(err) => {
                    return finish_failure(
                        p,
                        source,
                        now_ms,
                        begin,
                        err.code(),
                        err.detail(),
                        None,
                    )
                }
            };
            let status = response.status;
            if !(200..300).contains(&status) {
                return finish_failure(
                    p,
                    source,
                    now_ms,
                    begin,
                    status_kind(status),
                    &format!("source returned HTTP {status}"),
                    Some(status),
                );
            }
            match adapters::parse(kind, &response.body, &source.url, now_ms) {
                Ok(items) => {
                    finish_success(p, source, now_ms, begin, items, Some(status))
                }
                Err(err) => finish_failure(
                    p,
                    source,
                    now_ms,
                    begin,
                    err.kind(),
                    err.detail(),
                    Some(status),
                ),
            }
        }
        Step::Index {
            request,
            max_children,
        } => {
            let index_response = match p.fetch.fetch(request) {
                Ok(response) => response,
                Err(err) => {
                    return finish_failure(
                        p,
                        source,
                        now_ms,
                        begin,
                        err.code(),
                        err.detail(),
                        None,
                    )
                }
            };
            if !(200..300).contains(&index_response.status) {
                let status = index_response.status;
                return finish_failure(
                    p,
                    source,
                    now_ms,
                    begin,
                    status_kind(status),
                    &format!("index request returned HTTP {status}"),
                    Some(status),
                );
            }
            let ids = match adapters::parse_hn_index(&index_response.body) {
                Ok(ids) => ids,
                Err(err) => {
                    return finish_failure(
                        p,
                        source,
                        now_ms,
                        begin,
                        err.kind(),
                        err.detail(),
                        Some(index_response.status),
                    )
                }
            };
            let mut items: Vec<RawItem> = Vec::new();
            let mut child_failures = 0u32;
            let mut last_child_error: Option<String> = None;
            for id in ids.into_iter().take(max_children) {
                match p.fetch.fetch(adapters::hn_detail_request(id)) {
                    Ok(response) if (200..300).contains(&response.status) => {
                        match adapters::parse(kind, &response.body, &source.url, now_ms) {
                            Ok(mut parsed) => items.append(&mut parsed),
                            Err(err) => {
                                child_failures += 1;
                                last_child_error = Some(err.detail().to_string());
                                p.log.log_warn(&format!(
                                    "news: {} item {id} parse failed: {}",
                                    source.id,
                                    err.detail()
                                ));
                            }
                        }
                    }
                    Ok(response) => {
                        child_failures += 1;
                        last_child_error =
                            Some(format!("item {id} returned HTTP {}", response.status));
                        p.log.log_warn(&format!(
                            "news: {} item {id} returned HTTP {}",
                            source.id, response.status
                        ));
                    }
                    Err(err) => {
                        child_failures += 1;
                        last_child_error = Some(format!("item {id}: {}", err.detail()));
                        p.log.log_warn(&format!(
                            "news: {} item {id} fetch failed: {}",
                            source.id,
                            err.detail()
                        ));
                    }
                }
            }
            if items.is_empty() {
                let detail = last_child_error.unwrap_or_else(|| {
                    format!("all {child_failures} detail requests failed or returned no story")
                });
                return finish_failure(
                    p,
                    source,
                    now_ms,
                    begin,
                    error_kind::PARSE_UNEXPECTED_SHAPE,
                    &detail,
                    Some(index_response.status),
                );
            }
            if child_failures > 0 {
                p.log.log_warn(&format!(
                    "news: {} skipped {child_failures} failing items (source kept usable)",
                    source.id
                ));
            }
            finish_success(p, source, now_ms, begin, items, Some(index_response.status))
        }
    }
}

/// HTTP 状态 → 分类：401/403 归凭据失效，429 归限流，其余 4xx/5xx 归状态码。
fn status_kind(status: u16) -> &'static str {
    match status {
        401 | 403 => error_kind::AUTH_EXPIRED,
        429 => error_kind::RATE_LIMITED,
        _ => error_kind::HTTP_STATUS,
    }
}

fn finish_success(
    p: &Ports<'_>,
    source: &Source,
    now_ms: i64,
    begin: i64,
    raw_items: Vec<RawItem>,
    http_status: Option<u16>,
) -> Result<SourceFetchResult, PortError> {
    let parsed_items = raw_items.len() as u32;
    let new_items = store_items(p, source, &raw_items, now_ms)?;
    let end = p.clock.now_ms().unwrap_or(now_ms);
    let duration_ms = (end - begin).max(0);

    store::save_source_state(
        p,
        &source.id,
        now_ms,
        Some(now_ms),
        None,
        0,
        None,
        None,
        None,
        None,
    )?;
    store::insert_fetch_log(
        p,
        &source.id,
        begin,
        duration_ms,
        true,
        http_status,
        None,
        parsed_items,
    )?;
    store::trim_fetch_log(p, &source.id)?;
    p.log.log_info(&format!(
        "news: {} fetched {parsed_items} items ({new_items} new) in {duration_ms}ms",
        source.id
    ));
    Ok(SourceFetchResult {
        source_id: source.id.clone(),
        source_name: source.name.clone(),
        ok: true,
        new_items,
        parsed_items,
        http_status,
        error_kind: None,
        error_detail: None,
        next_retry_at: None,
        duration_ms,
        skipped: None,
    })
}

fn finish_failure(
    p: &Ports<'_>,
    source: &Source,
    now_ms: i64,
    begin: i64,
    kind: &str,
    detail: &str,
    http_status: Option<u16>,
) -> Result<SourceFetchResult, PortError> {
    let fail_count = source.state.fail_count.saturating_add(1);
    let next_retry_at = schedule::next_retry_at(fail_count, now_ms);
    let end = p.clock.now_ms().unwrap_or(now_ms);
    let duration_ms = (end - begin).max(0);

    store::save_source_state(
        p,
        &source.id,
        now_ms,
        None,
        next_retry_at,
        fail_count,
        Some(kind),
        Some(detail),
        None,
        None,
    )?;
    store::insert_fetch_log(
        p,
        &source.id,
        begin,
        duration_ms,
        false,
        http_status,
        Some(kind),
        0,
    )?;
    store::trim_fetch_log(p, &source.id)?;
    p.log.log_warn(&format!(
        "news: {} fetch failed ({kind}) after {duration_ms}ms: {detail}",
        source.id
    ));
    Ok(SourceFetchResult {
        source_id: source.id.clone(),
        source_name: source.name.clone(),
        ok: false,
        new_items: 0,
        parsed_items: 0,
        http_status,
        error_kind: Some(kind.to_string()),
        error_detail: Some(detail.to_string()),
        next_retry_at,
        duration_ms,
        skipped: None,
    })
}

/// 去重并落库，返回新增条目数。
///
/// 判定顺序：同地址（跨源合并）→ 同源标题指纹（丢弃重复）→ 新建。
fn store_items(
    p: &Ports<'_>,
    source: &Source,
    raw_items: &[RawItem],
    now_ms: i64,
) -> Result<u32, PortError> {
    // 同源历史：指纹表 + (条目, 原始地址) 表（同一源同一地址只记一条归属）
    let recent = store::load_source_recent(
        p,
        &source.id,
        now_ms - store::RETENTION_DAYS * 86_400_000,
    )?;
    let mut same_source: Vec<ExistingItem> = Vec::with_capacity(recent.len());
    let mut known_ids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut known_origins: std::collections::BTreeSet<(String, String)> =
        std::collections::BTreeSet::new();
    for (id, title, raw_url) in &recent {
        known_ids.insert(id.clone());
        known_origins.insert((id.clone(), raw_url.clone()));
        same_source.push(ExistingItem {
            item_id: id.clone(),
            title_fingerprint: urlutil::title_fingerprint(title),
        });
    }

    // 候选：归一化地址 → 条目 id（id 由地址派生，命中即同地址）
    struct Candidate {
        canonical: String,
        id: String,
        fingerprint: String,
        raw: RawItem,
    }
    let mut candidates = Vec::new();
    for raw in raw_items {
        if raw.title.trim().is_empty() {
            continue;
        }
        let Some(canonical) = urlutil::normalize_url(&raw.url) else {
            p.log
                .log_warn(&format!("news: {} dropped an item with unusable url", source.id));
            continue;
        };
        candidates.push(Candidate {
            id: urlutil::item_id(&canonical),
            fingerprint: urlutil::title_fingerprint(&raw.title),
            canonical,
            raw: raw.clone(),
        });
    }
    if candidates.is_empty() {
        return Ok(0);
    }

    let candidate_ids: Vec<String> = candidates.iter().map(|c| c.id.clone()).collect();
    let existing_ids: std::collections::BTreeSet<String> =
        store::existing_item_ids(p, &candidate_ids)?.into_iter().collect();

    let mut inserted = 0u32;
    for candidate in candidates {
        match dedup::decide(
            &candidate.id,
            &candidate.fingerprint,
            &existing_ids,
            &same_source,
        ) {
            Decision::SkipDuplicate(_) => continue,
            Decision::Merge(item_id) => {
                let key = (item_id.clone(), candidate.raw.url.clone());
                if !known_origins.contains(&key) {
                    store::insert_origin(
                        p,
                        &item_id,
                        &source.id,
                        &candidate.raw.url,
                        candidate.raw.source_title.as_deref(),
                        candidate.raw.published_at,
                    )?;
                    known_origins.insert(key);
                }
                known_ids.insert(item_id);
            }
            Decision::New => {
                let item = Item {
                    id: candidate.id.clone(),
                    title: candidate.raw.title.clone(),
                    url: candidate.canonical.clone(),
                    summary: candidate.raw.summary.clone(),
                    published_at: candidate.raw.published_at.unwrap_or(now_ms),
                    first_seen_at: now_ms,
                    lang: candidate.raw.lang.clone(),
                    author: candidate.raw.author.clone(),
                    source_id: source.id.clone(),
                    source_name: source.name.clone(),
                    circle_id: source.circle_id.clone(),
                    circle_name: String::new(),
                    read: false,
                    favorite: false,
                    favorited_at: None,
                    origin_count: 1,
                    score: 0.0,
                    origins: Vec::new(),
                };
                store::insert_item(p, &item, &candidate.raw.url)?;
                store::insert_origin(
                    p,
                    &candidate.id,
                    &source.id,
                    &candidate.raw.url,
                    candidate.raw.source_title.as_deref(),
                    candidate.raw.published_at,
                )?;
                // 本轮新建的条目要进入后续候选的同源指纹范围
                known_ids.insert(candidate.id.clone());
                known_origins.insert((candidate.id.clone(), candidate.raw.url.clone()));
                same_source.push(ExistingItem {
                    item_id: candidate.id.clone(),
                    title_fingerprint: candidate.fingerprint.clone(),
                });
                inserted += 1;
            }
        }
    }
    Ok(inserted)
}

// ==================== 已读 / 收藏 / 复制 ====================

/// 标记单条已读状态。
pub fn set_read(p: &Ports<'_>, item_id: &str, read: bool, now_ms: i64) -> Result<(), PortError> {
    store::set_read(p, item_id, read, now_ms)
}

/// 把当前视图里的条目全部标为已读。
pub fn mark_all_read(
    p: &Ports<'_>,
    query: &FeedQuery,
    now_ms: i64,
) -> Result<u32, PortError> {
    let feed = feed(p, query, now_ms)?;
    let ids: Vec<String> = feed.items.iter().map(|i| i.id.clone()).collect();
    store::mark_all_read(p, &ids, now_ms)
}

/// 收藏 / 取消收藏。
pub fn set_favorite(
    p: &Ports<'_>,
    item_id: &str,
    favorite: bool,
    now_ms: i64,
) -> Result<(), PortError> {
    store::set_favorite(p, item_id, favorite, now_ms)
}

/// 复制原文链接：桌面走宿主剪贴板，移动端端口显性 unsupported（前端回退）。
pub fn copy_link(p: &Ports<'_>, url: &str) -> Result<(), PortError> {
    if url.trim().is_empty() {
        return Err(store::invalid("copy-link: empty url"));
    }
    p.clipboard.write_text(url)
}

// ==================== 设置 / 日志 ====================

/// 读设置。
pub fn settings(p: &Ports<'_>) -> Result<Settings, PortError> {
    store::load_settings(p)
}

/// 写设置。
pub fn save_settings(
    p: &Ports<'_>,
    patch: &crate::domain::SettingsPatch,
) -> Result<Settings, PortError> {
    let current = store::load_settings(p)?;
    let enabled = patch.ai_enabled.unwrap_or(current.ai_enabled);
    let base_url = patch
        .ai_base_url
        .clone()
        .unwrap_or_else(|| current.ai_base_url.clone());
    let model = patch
        .ai_model
        .clone()
        .unwrap_or_else(|| current.ai_model.clone());
    if enabled && !base_url.trim().is_empty() && !summary::endpoints_ok(&base_url) {
        return Err(store::invalid(
            "ai.baseUrl must be an OpenAI-compatible http(s) endpoint",
        ));
    }
    store::save_settings(
        p,
        enabled,
        &base_url,
        &model,
        patch.ai_api_key.as_deref(),
    )
}

/// 抓取记录。
pub fn fetch_log(
    p: &Ports<'_>,
    source_id: Option<&str>,
    limit: usize,
) -> Result<Vec<FetchLogEntry>, PortError> {
    store::load_fetch_log(p, source_id, limit)
}

// ==================== 助手工具 ====================

/// 今日前 N 条（供助手读）。
pub fn today_summary(
    p: &Ports<'_>,
    now_ms: i64,
    limit: usize,
) -> Result<Vec<TodaySummaryEntry>, PortError> {
    let feed = feed(
        p,
        &FeedQuery {
            view: FeedView::Today,
            circle_id: None,
        },
        now_ms,
    )?;
    Ok(feed
        .items
        .into_iter()
        .take(limit.clamp(1, 20))
        .map(|item| TodaySummaryEntry {
            title: item.title,
            source_name: item.source_name,
            url: item.url,
            published_at: item.published_at,
            origin_count: item.origin_count,
        })
        .collect())
}

/// 关键词搜索本地条目。
pub fn search_items(
    p: &Ports<'_>,
    keyword: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, PortError> {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return Err(store::invalid("search-items: empty keyword"));
    }
    Ok(store::search_items(p, keyword, limit)?
        .into_iter()
        .map(|(item, _)| SearchHit {
            id: item.id,
            title: item.title,
            url: item.url,
            source_name: item.source_name,
            published_at: item.published_at,
        })
        .collect())
}

// ==================== AI 摘要 ====================

/// 批量 / 单条摘要。关闭时直接报错（不发请求）。
pub fn ai_summarize(
    p: &Ports<'_>,
    item_ids: &[String],
    now_ms: i64,
) -> Result<AiBatchSummaryResult, PortError> {
    let settings = store::load_settings(p)?;
    if !settings.ai_enabled {
        return Err(PortError::with_detail(
            "ai.disabled",
            "ai summary is disabled in settings",
        ));
    }
    if !summary::endpoints_ok(&settings.ai_base_url) {
        return Err(store::invalid("ai.baseUrl is not configured"));
    }
    let key = store::ai_api_key(p)?.unwrap_or_default();
    if key.trim().is_empty() {
        return Err(PortError::with_detail(
            "ai.auth",
            "ai.apiKey is not configured",
        ));
    }
    p.log.log_info(&format!(
        "news: ai summarize requested for {} items (key length {})",
        item_ids.len(),
        key.chars().count()
    ));

    let targets: Vec<String> = item_ids
        .iter()
        .take(summary::BATCH_LIMIT)
        .cloned()
        .collect();
    let mut results = Vec::new();
    let mut ok_count = 0u32;
    let mut failed_count = 0u32;

    for item_id in targets {
        let Some((item, _)) = store::load_item(p, &item_id)? else {
            results.push(AiSummaryResult {
                item_id,
                ok: false,
                summary: None,
                error_kind: Some(error_kind::SOURCE_UNAVAILABLE.to_string()),
                error_detail: Some("item does not exist".to_string()),
            });
            failed_count += 1;
            continue;
        };
        let body = item
            .summary
            .clone()
            .unwrap_or_else(|| item.title.clone());
        let request = summary::build_request(
            &settings.ai_base_url,
            &key,
            &settings.ai_model,
            &item.title,
            &body,
        );
        let result = match p.fetch.fetch(request) {
            Ok(response) => match summary::parse_response(response.status, &response.body) {
                Ok(text) => {
                    store::save_item_summary(p, &item_id, &text)?;
                    AiSummaryResult {
                        item_id: item_id.clone(),
                        ok: true,
                        summary: Some(text),
                        error_kind: None,
                        error_detail: None,
                    }
                }
                Err(err) => AiSummaryResult {
                    item_id: item_id.clone(),
                    ok: false,
                    summary: None,
                    error_kind: Some(err.kind().to_string()),
                    error_detail: Some(err.detail().to_string()),
                },
            },
            Err(err) => AiSummaryResult {
                item_id: item_id.clone(),
                ok: false,
                summary: None,
                error_kind: Some(err.code().to_string()),
                error_detail: Some(err.detail().to_string()),
            },
        };
        if result.ok {
            ok_count += 1;
        } else {
            failed_count += 1;
            p.log.log_warn(&format!(
                "news: ai summary failed for {item_id}: {}",
                result.error_kind.clone().unwrap_or_default()
            ));
        }
        results.push(result);
    }

    let _ = now_ms;
    Ok(AiBatchSummaryResult {
        results,
        ok_count,
        failed_count,
    })
}

// ==================== 助手代抓（反向面，固定不可用） ====================

/// 「用助手抓取」：当前宿主没有该能力，固定返回明确错误。
pub fn assistant_fetch(p: &Ports<'_>, url: &str, schema: &str) -> Result<Vec<RawItem>, PortError> {
    p.assistant.request_fetch(url, schema)
}

/// 供插件构造适配器错误（保持分类词表单点）。
pub fn adapter_error_kind(err: &AdapterError) -> &'static str {
    err.kind()
}

/// 当前源状态是否为「连续失败」（界面标红判据）。
pub fn is_failing(state: &SourceState) -> bool {
    state.is_failing()
}
