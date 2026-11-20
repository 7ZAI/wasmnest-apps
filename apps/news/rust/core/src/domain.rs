//! 领域类型与 wire 形状。
//!
//! 所有跨进程（wasm ↔ 前端）的结构都在这里定义，`serde` 走 camelCase；时间字段
//! 一律 Unix 毫秒整数，与宿主定时器 `now_ms` 同口径，核内不使用日期库。

use serde::{Deserialize, Serialize};

// ==================== 视图 ====================

/// 三条视图 + 收藏。
///
/// 「今日 / 圈子 / 实时」是同一批信息条的三条切法；「收藏」是用户态筛选。
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum FeedView {
    Today,
    Circles,
    Realtime,
    Saved,
}

impl FeedView {
    /// 视图窗口（小时）。收藏不设窗口。
    pub fn window_hours(self) -> Option<i64> {
        match self {
            FeedView::Today | FeedView::Circles => Some(24),
            FeedView::Realtime => Some(6),
            FeedView::Saved => None,
        }
    }
}

/// 列表查询入参。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeedQuery {
    pub view: FeedView,
    /// 圈子视图下的过滤目标；`None` = 全部圈子。
    #[serde(default)]
    pub circle_id: Option<String>,
}

/// 一次列表查询的结果。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub items: Vec<Item>,
    /// 本条视图的时间窗口（小时）；收藏视图为 `None`。
    pub window_hours: Option<i64>,
    /// 数据截止时间（本次查询的 `now_ms`），界面据此标注「截至 …」。
    pub generated_at: i64,
}

// ==================== 信息条 ====================

/// 一个来源对某条信息条的贡献。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    pub source_id: String,
    pub source_name: String,
    pub raw_url: String,
    pub source_title: Option<String>,
    pub published_at: Option<i64>,
}

/// 信息条（本地副本，只存标题 / 摘要 / 链接）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub title: String,
    /// 归一化后的原文地址（跨源合并键）。
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub published_at: i64,
    pub first_seen_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// 主来源（首条来源归属；排序权重取各来源最大值，与此字段无关）。
    pub source_id: String,
    pub source_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub circle_id: Option<String>,
    pub circle_name: String,
    pub read: bool,
    pub favorite: bool,
    /// 收藏时间（未收藏为 `None`）；收藏视图按其倒序。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favorited_at: Option<i64>,
    /// 跨源命中数 = `item_origins` 行数。
    pub origin_count: u32,
    /// 确定性热度分（今日 / 圈子用；实时与收藏不显示）。
    pub score: f64,
    /// 全部来源归属；列表查询默认不带，详情查询带。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub origins: Vec<Origin>,
}

// ==================== 正文阅读 ====================

/// 正文块的类型。
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum BlockKind {
    Heading,
    Paragraph,
    ListItem,
    Quote,
    Code,
}

/// 一个结构化纯文本块。
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentBlock {
    pub kind: BlockKind,
    /// 仅 `heading` 使用；1–3 级。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    pub text: String,
}

/// 正文副本状态。
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ReaderState {
    Ready,
    Failed,
}

impl ReaderState {
    /// 落库字符串。
    pub fn as_str(self) -> &'static str {
        match self {
            ReaderState::Ready => "ready",
            ReaderState::Failed => "failed",
        }
    }
}

/// 详情抽屉阅读态的 wire 形状。
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReaderView {
    pub item_id: String,
    pub state: ReaderState,
    /// `state=ready` 且无错误时非空；`state=failed` 时为空。
    pub blocks: Vec<ContentBlock>,
    pub text_length: u32,
    pub truncated: bool,
    /// 本次刷新失败但沿用了旧正文。
    pub stale: bool,
    pub archived: bool,
    /// 当前正文的成功抓取时间；失败记录时为失败时间。
    pub fetched_at: i64,
    /// 最近一次尝试（含失败），用于 stale 展示。
    pub last_attempt_at: i64,
    /// 失败必填；stale 时承载本次刷新失败分类。
    #[serde(default)]
    pub error_kind: Option<String>,
    #[serde(default)]
    pub error_detail: Option<String>,
}

/// 设置页用量。
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReaderStats {
    /// 非归档正文条数。
    pub cached_count: u32,
    /// 非归档正文占用字节数。
    pub cached_bytes: u64,
    /// 归档正文条数。
    pub archived_count: u32,
    /// 归档正文占用字节数。
    pub archived_bytes: u64,
}

/// 清除正文的返回。
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClearedStats {
    pub removed: u32,
    pub bytes: u64,
}

/// 清除正文的范围。
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ClearMode {
    /// 只删非归档正文（含失败记录）。
    Unarchived,
    /// 删除全部正文（含归档）。
    All,
}

impl ClearMode {
    /// 对应的 SQL 过滤条件（统计与删除共用保证对账一致）。
    pub fn where_clause(self) -> &'static str {
        match self {
            ClearMode::Unarchived => "archived = 0",
            ClearMode::All => "1 = 1",
        }
    }
}

// ==================== 源 ====================

/// 源种类。用户只能选种类 + 填地址，不能注入脚本或正则。
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum SourceKind {
    #[serde(rename = "rss")]
    Rss,
    #[serde(rename = "hn")]
    Hn,
    #[serde(rename = "reddit")]
    Reddit,
    #[serde(rename = "github-trending")]
    GithubTrending,
    #[serde(rename = "youtube-rss")]
    YoutubeRss,
    #[serde(rename = "html-list")]
    HtmlList,
    #[serde(rename = "x-graphql")]
    XGraphql,
    #[serde(rename = "ig-graphql")]
    IgGraphql,
}

impl SourceKind {
    /// 落库字符串（`sources.kind`）。
    pub fn as_str(self) -> &'static str {
        match self {
            SourceKind::Rss => "rss",
            SourceKind::Hn => "hn",
            SourceKind::Reddit => "reddit",
            SourceKind::GithubTrending => "github-trending",
            SourceKind::YoutubeRss => "youtube-rss",
            SourceKind::HtmlList => "html-list",
            SourceKind::XGraphql => "x-graphql",
            SourceKind::IgGraphql => "ig-graphql",
        }
    }

    /// 解析落库字符串；未知种类返回 `None`（调用方显性报错，不猜默认值）。
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "rss" => Some(SourceKind::Rss),
            "hn" => Some(SourceKind::Hn),
            "reddit" => Some(SourceKind::Reddit),
            "github-trending" => Some(SourceKind::GithubTrending),
            "youtube-rss" => Some(SourceKind::YoutubeRss),
            "html-list" => Some(SourceKind::HtmlList),
            "x-graphql" => Some(SourceKind::XGraphql),
            "ig-graphql" => Some(SourceKind::IgGraphql),
            _ => None,
        }
    }

    /// 需要用户自备身份态（凭据失效必须显性报告，不得降级成匿名抓取）。
    pub fn needs_auth(self) -> bool {
        matches!(self, SourceKind::XGraphql | SourceKind::IgGraphql)
    }

    /// 实验性种类（私有接口随时变化；界面必须标注，不静默重试掩盖）。
    pub fn is_experimental(self) -> bool {
        self.needs_auth()
    }

    /// 用户能否在表单里手选该种类。
    ///
    /// `html-list` 只服务内置榜单页，不对用户开放自定义选择器。
    pub fn user_selectable(self) -> bool {
        !matches!(self, SourceKind::HtmlList)
    }
}

/// 源最近一次抓取的状态。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceState {
    pub last_fetch_at: Option<i64>,
    pub last_ok_at: Option<i64>,
    pub next_retry_at: Option<i64>,
    pub fail_count: u32,
    pub last_error_kind: Option<String>,
    pub last_error_detail: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

impl SourceState {
    /// 连续 3 次失败即标红。
    pub fn is_failing(&self) -> bool {
        self.fail_count >= 3
    }
}

/// 一个源。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub circle_id: Option<String>,
    pub weight: f64,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_id: Option<String>,
    /// 实验性种类标记（与 `kind` 派生，前端只读）。
    pub experimental: bool,
    /// 是否已录入凭据（只报布尔，不泄露内容）。
    pub has_credential: bool,
    pub state: SourceState,
}

/// 一次抓取的产物计数。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceFetchResult {
    pub source_id: String,
    pub source_name: String,
    pub ok: bool,
    /// 新增条目数（已存在的不计）。
    pub new_items: u32,
    /// 解析出的原始条目数（含已存在的）。
    pub parsed_items: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_retry_at: Option<i64>,
    /// 本次抓取耗时（毫秒）。
    pub duration_ms: i64,
    /// 被跳过的原因（退避中 / 未到期），`None` = 真正执行了抓取。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
}

/// 一次刷新（全部 / 到期 / 单源）的汇总。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RefreshOutcome {
    pub results: Vec<SourceFetchResult>,
    /// 失败的源数量（含被跳过的不算）。
    pub failed: u32,
    /// 新增条目总数。
    pub new_items: u32,
    /// 被退避 / 防抖跳过、未发请求的源数量。
    pub skipped: u32,
    /// 防抖拦截时的提示码（前端取文案）；`None` = 未拦截。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked: Option<String>,
}

// ==================== 圈子 ====================

/// 用户命名的兴趣分组。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Circle {
    pub id: String,
    pub name: String,
    pub weight: f64,
    pub sort_order: i64,
    pub created_at: i64,
    pub source_count: u32,
}

/// 「未分组」伪圈子 id：不属于任何圈子的源在圈子里聚合到这一档。
pub const UNGROUPED_CIRCLE_ID: &str = "__ungrouped__";

// ==================== 设置与凭据 ====================

/// 应用设置（AI 密钥只回传掩码与长度，绝不回明文）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub ai_enabled: bool,
    pub ai_base_url: String,
    pub ai_model: String,
    /// 已保存密钥的末四位（未保存 = 空串）。
    pub ai_api_key_tail: String,
    /// 已保存密钥的长度（未保存 = 0）。
    pub ai_api_key_len: u32,
    /// 正文阅读开关（桌面缺省开启；移动端归一为 false）。
    pub reader_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ai_enabled: false,
            ai_base_url: String::new(),
            ai_model: String::new(),
            ai_api_key_tail: String::new(),
            ai_api_key_len: 0,
            reader_enabled: true,
        }
    }
}


/// 设置更新入参。`ai_api_key` 缺省 = 不改动已保存密钥。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    #[serde(default)]
    pub ai_enabled: Option<bool>,
    #[serde(default)]
    pub ai_base_url: Option<String>,
    #[serde(default)]
    pub ai_model: Option<String>,
    #[serde(default)]
    pub ai_api_key: Option<String>,
    #[serde(default)]
    pub reader_enabled: Option<bool>,
}

/// 凭据清单条目（只有掩码，没有明文）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSummary {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub tail: String,
    pub len: u32,
    pub created_at: i64,
    pub updated_at: i64,
}

// ==================== 抓取日志 ====================

/// 一条抓取记录。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FetchLogEntry {
    pub id: i64,
    pub source_id: String,
    pub source_name: String,
    pub started_at: i64,
    pub duration_ms: i64,
    pub ok: bool,
    pub http_status: Option<u16>,
    pub error_kind: Option<String>,
    pub item_count: Option<u32>,
}

// ==================== 助手工具 ====================

/// 助手工具读今日摘要的返回。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TodaySummaryEntry {
    pub title: String,
    pub source_name: String,
    pub url: String,
    pub published_at: i64,
    pub origin_count: u32,
}

/// 搜索条目返回。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub url: String,
    pub source_name: String,
    pub published_at: i64,
}

// ==================== AI 摘要 ====================

/// 单条摘要请求的产物。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiSummaryResult {
    pub item_id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
}

/// 批量摘要产物。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiBatchSummaryResult {
    pub results: Vec<AiSummaryResult>,
    pub ok_count: u32,
    pub failed_count: u32,
}

// ==================== 适配器输出 ====================

/// 适配器解析出的一条原始条目（尚未归一化、未落库）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RawItem {
    pub title: String,
    pub url: String,
    /// 源给不出的发布时间 = `None`，由入库时以抓到时刻填充。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    /// 源内部标题（跨源合并时保留各源原始标题）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_title: Option<String>,
}

// ==================== 错误分类 ====================

/// 失败分类码（写入 `source_state.last_error_kind` 与 `fetch_log.error_kind`）。
///
/// 分类既是日志字段也是前端文案 key 的派生源，不允许在别处另写字面量。
pub mod error_kind {
    /// 宿主拒绝出站授权。
    pub const NET_DENIED: &str = "net.denied";
    /// 连接失败 / 超时。
    pub const NET_FAILED: &str = "net.failed";
    /// 4xx / 5xx（401 / 403 另归 `auth.expired`）。
    pub const HTTP_STATUS: &str = "http.status";
    /// 凭据失效。
    pub const AUTH_EXPIRED: &str = "auth.expired";
    /// 响应不是可识别的订阅流。
    pub const PARSE_NO_FEED: &str = "parse.no_feed";
    /// 源结构变化。
    pub const PARSE_UNEXPECTED_SHAPE: &str = "parse.unexpected_shape";
    /// 限流（429）。
    pub const RATE_LIMITED: &str = "rate.limited";
    /// AI 端点鉴权失败。
    pub const AI_AUTH: &str = "ai.auth";
    /// AI 端点其它失败。
    pub const AI_FAILED: &str = "ai.failed";
    /// 助手代抓能力不可用。
    pub const ASSISTANT_UNAVAILABLE: &str = "assistant.fetch-unavailable";
    /// 请求参数非法。
    pub const INVALID_ARGUMENT: &str = "invalid.argument";
    /// 源不存在 / 已停用 / 退避中。
    pub const SOURCE_UNAVAILABLE: &str = "source.unavailable";
    /// 本端不支持该能力。
    pub const PORT_UNSUPPORTED: &str = "port.unsupported";
    /// 插件私有库读写失败。
    pub const STORAGE_FAILED: &str = "storage.failed";
    /// 阅读开关关闭。
    pub const READER_DISABLED: &str = "reader.disabled";
    /// 正文不是可阅读的 HTML / XHTML。
    pub const EXTRACT_UNSUPPORTED: &str = "extract.unsupported";
    /// 未提取到正文或正文过短。
    pub const EXTRACT_NO_CONTENT: &str = "extract.no_content";
    /// 页面编码无法解析。
    pub const EXTRACT_ENCODING: &str = "extract.encoding";
    /// 响应或正文超过上限。
    pub const EXTRACT_TOO_LARGE: &str = "extract.too_large";
    /// 解析器内部失败。
    pub const EXTRACT_FAILED: &str = "extract.failed";
    /// 本机正文存储已达容量上限且无法继续归档。
    pub const READER_STORAGE_FULL: &str = "reader.storage_full";

    /// 分类是否属于「值得标红并提示重新授权」的授权类失败。
    pub fn is_auth_related(kind: &str) -> bool {
        matches!(kind, NET_DENIED | AUTH_EXPIRED)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn settings_default_enables_reader() {
        assert!(Settings::default().reader_enabled);
    }

    #[test]
    fn settings_patch_reader_is_optional() {
        let patch: SettingsPatch = serde_json::from_value(json!({})).expect("empty patch parses");
        assert_eq!(patch.reader_enabled, None);

        let patch: SettingsPatch =
            serde_json::from_value(json!({ "readerEnabled": true })).expect("reader patch parses");
        assert_eq!(patch.reader_enabled, Some(true));
    }

    #[test]
    fn reader_view_uses_camel_case_and_keeps_null_errors() {
        let view = ReaderView {
            item_id: "item-1".into(),
            state: ReaderState::Ready,
            blocks: vec![ContentBlock {
                kind: BlockKind::ListItem,
                level: None,
                text: "hello".into(),
            }],
            text_length: 5,
            truncated: false,
            stale: true,
            archived: true,
            fetched_at: 1,
            last_attempt_at: 2,
            error_kind: Some(error_kind::EXTRACT_NO_CONTENT.into()),
            error_detail: None,
        };
        let value: Value = serde_json::to_value(&view).expect("view serializes");
        assert_eq!(value["itemId"], "item-1");
        assert_eq!(value["state"], "ready");
        assert_eq!(value["blocks"][0]["kind"], "listItem");
        assert!(value["blocks"][0].get("level").is_none());
        assert_eq!(value["lastAttemptAt"], 2);
        assert_eq!(value["fetchedAt"], 1);
        assert_eq!(value["errorKind"], error_kind::EXTRACT_NO_CONTENT);
        assert!(value["errorDetail"].is_null());
    }

    #[test]
    fn reader_state_and_clear_mode_use_lowercase() {
        assert_eq!(
            serde_json::to_value(ReaderState::Failed).expect("state serializes"),
            json!("failed")
        );
        assert_eq!(
            serde_json::to_value(ClearMode::Unarchived).expect("mode serializes"),
            json!("unarchived")
        );
        assert_eq!(ClearMode::All.where_clause(), "1 = 1");
    }

    #[test]
    fn reader_error_kinds_are_distinct_literals() {
        let kinds = [
            error_kind::READER_DISABLED,
            error_kind::EXTRACT_UNSUPPORTED,
            error_kind::EXTRACT_NO_CONTENT,
            error_kind::EXTRACT_ENCODING,
            error_kind::EXTRACT_TOO_LARGE,
            error_kind::EXTRACT_FAILED,
            error_kind::READER_STORAGE_FULL,
        ];
        let mut unique = kinds.to_vec();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), kinds.len());
    }
}
