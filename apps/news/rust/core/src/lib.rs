//! News 双端共享业务核。
//!
//! ## 边界
//!
//! - 依赖只有 `serde` / `serde_json`；零 WIT、零宿主 SDK、零平台仓库依赖。
//! - 与宿主交互一律经 [`ports`] 的 trait；核内不出现插件 id 等产品身份字面量。
//! - 时间一律由调用方传入（Unix 毫秒）。wasm 侧没有系统时钟，时间取自宿主
//!   `system.time_ms` 配置项，核本身不读时钟。
//!
//! ## 当前实现面（v1 骨架）
//!
//! [`domain`] 与 [`feed`] 已就位：信息条 / 源 / 圈子 / 设置的 wire 形状，
//! 以及窗口过滤与排序判据。抓取、持久化与 AI 摘要尚未接入，相关能力在
//! [`ports`] 里只留 trait，不提供假实现。

pub mod domain;
pub mod feed;
pub mod ports;

pub use domain::{Circle, Feed, FeedQuery, FeedView, Item, Settings, Source};
pub use feed::{select_items, window_hours};
pub use ports::{
    AssistantBridge, FetchPort, FetchRequest, FetchResponse, PortError, UnavailableAssistant,
};
