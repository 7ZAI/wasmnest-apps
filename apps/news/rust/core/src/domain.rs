//! News 领域类型（wire 形状即前后端契约）。
//!
//! 字段统一 camelCase（serde `rename_all`），时间一律 Unix 毫秒。改动字段名 /
//! 语义属于破坏性变更，必须与前端的 `apps/news/{desktop,mobile}/src/types.ts`
//! 同批修改。

use serde::{Deserialize, Serialize};

/// 四个浏览视图。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeedView {
    Today,
    Circles,
    Realtime,
    Saved,
}

/// 从某个源取回的一条内容（本地副本，不是原文）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub url: String,
    pub source_id: String,
    pub source_name: String,
    pub circle_id: String,
    pub circle_name: String,
    pub published_at: i64,
    pub seen_at: i64,
    pub read: bool,
    pub favorite: bool,
    /// 跨源去重后的来源数，恒 >= 1。
    pub origin_count: u32,
}

/// 用户命名的兴趣分组，下挂一组源并带权重。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Circle {
    pub id: String,
    pub name: String,
    pub weight: f64,
    pub source_count: u32,
}

/// 可周期性获取信息的一类具名入口。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub circle_id: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

/// 界面设置（AI 摘要默认关闭）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub refresh_interval_minutes: u32,
    pub ai_summary_enabled: bool,
    pub ai_endpoint: String,
    pub ai_model: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            refresh_interval_minutes: 15,
            ai_summary_enabled: false,
            ai_endpoint: String::new(),
            ai_model: String::new(),
        }
    }
}

/// 一次列表查询。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedQuery {
    pub view: FeedView,
    #[serde(default)]
    pub circle_id: Option<String>,
}

/// 列表查询结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub items: Vec<Item>,
    pub window_hours: i64,
    pub generated_at: i64,
}
