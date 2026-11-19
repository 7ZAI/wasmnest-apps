//! News 双端共享业务核。
//!
//! ## 边界
//!
//! - 依赖只有 `serde` / `serde_json` / `quick-xml` / `sha2`；零 WIT、零宿主 SDK。
//! - 与宿主交互一律经 [`ports`] 的 trait；核内不出现插件 id 等产品身份字面量。
//! - 时间一律由调用方传入（Unix 毫秒）。核不读系统时钟：需要「现在」的地方
//!   （窗口、退避、排序）都接显式参数，因此可以在 native 单测里直测。
//!
//! ## 分层
//!
//! | 模块 | 职责 |
//! | --- | --- |
//! | [`domain`] | wire 形状与错误分类词表 |
//! | [`ports`] | 出网 / 库 / 时钟 / 调度 / 剪贴板 / 日志 / 事件 / 助手端口 |
//! | [`adapters`] | 八种源种类的请求构造与解析（纯函数） |
//! | [`urlutil`] | 地址归一化、标题指纹、条目 id、摘要清洗 |
//! | [`dedup`] | 跨源合并 / 同源去重判据 |
//! | [`views`] | 热度分、窗口与排序 |
//! | [`schedule`] | 补抓阈值、手动防抖、失败退避 |
//! | [`store`] | 表结构、迁移、读写语句 |
//! | [`engine`] | 抓取编排与视图装配 |
//! | [`summary`] | AI 摘要的请求构造与长度约束 |

pub mod adapters;
pub mod commands;
pub mod datetime;
pub mod dedup;
pub mod domain;
pub mod engine;
pub mod ports;
pub mod schedule;
pub mod store;
pub mod summary;
pub mod urlutil;
pub mod views;

pub use domain::{
    AiBatchSummaryResult, AiSummaryResult, Circle, CredentialSummary, Feed, FeedQuery, FeedView,
    FetchLogEntry, Item, Origin, RawItem, RefreshOutcome, SearchHit, Settings, SettingsPatch,
    Source, SourceFetchResult, SourceKind, SourceState, TodaySummaryEntry,
};
pub use commands::{CircleInput, CredentialInput, NewSource, UpdateSource};
pub use engine::{RefreshMode, RefreshRequest};
pub use ports::{
    AssistantBridge, ClipboardPort, ClockPort, DbPort, EventPort, FetchPort, FetchRequest,
    FetchResponse, LogPort, PortError, Ports, SchedulePort,
};
