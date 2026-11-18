//! 归一事件的值类型（ADR 0004：界面只认这一套形状）
//!
//! 三条通道（桥接 / 账本镜像 / 本地）在入口处归一到 12 类 `kind`，之后
//! 落库、广播、渲染不再区分来源；`source` 只用于排查与降级标注。
//!
//! **事件身份与更新语义**：`dedupe_key` 是同一条归一事件在一次运行内的
//! 稳定身份（opencode 的 part id / pi 的 contentIndex / 工具 callId……）。
//! 同一身份再次到达 = 原地更新（保留 `seq`、刷新 `payload`），因此流式
//! 正文不会把账本刷成一堆快照，20000 条上限统计的是「事件」而不是「增量」。

use serde_json::Value;

/// 归一事件全集（spec「归一事件（12 类）」；顺序即文档顺序）
pub const KINDS: [&str; 12] = [
    "user.message",
    "assistant.text",
    "assistant.thinking",
    "tool.call",
    "tool.result",
    "patch",
    "plan",
    "permission.request",
    "permission.replied",
    "status",
    "session.meta",
    "error",
];

/// 事件来源（spec：bridge / mirror / local）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventSource {
    Bridge,
    Mirror,
    Local,
}

impl EventSource {
    pub fn as_str(self) -> &'static str {
        match self {
            EventSource::Bridge => "bridge",
            EventSource::Mirror => "mirror",
            EventSource::Local => "local",
        }
    }

    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "bridge" => Ok(EventSource::Bridge),
            "mirror" => Ok(EventSource::Mirror),
            "local" => Ok(EventSource::Local),
            other => Err(format!("unknown event source: {other}")),
        }
    }

    /// 内容冲突时的胜出顺序：本地（我们发出去的）> 桥接（主通道）> 镜像（兜底）
    ///
    /// 同一身份两源都报时只让高优先级覆盖低优先级；低优先级后到不得把
    /// 桥接的实时快照改回镜像的滞后版本。
    pub fn priority(self) -> u8 {
        match self {
            EventSource::Local => 2,
            EventSource::Bridge => 1,
            EventSource::Mirror => 0,
        }
    }
}

/// 待落库的一条归一事件（归一化产物；尚未分配 seq）
#[derive(Debug, Clone, PartialEq)]
pub struct DraftEvent {
    /// [`KINDS`] 之一（归一化函数只产出合法值）
    pub kind: &'static str,
    /// 该 kind 的 payload（形状见 ADR 0004 的表）
    pub payload: Value,
    /// 运行内稳定身份（同一身份 = 原地更新）
    pub dedupe_key: String,
    /// 源事件版本（毫秒；0 = 源没有时间信息）
    ///
    /// 同源同身份的重放必须被挡住：桥接重投一批旧快照时，晚到的「更旧内容」
    /// 不得覆盖已落库的新内容。跨来源比较仍以 [`EventSource::priority`] 为准。
    pub rev: i64,
    /// 事件发生时间（RFC3339 文本；源没有时间时用入口时钟）
    pub at: String,
}

/// 已落库的一条事件（读取面投影的原始形态）
#[derive(Debug, Clone, PartialEq)]
pub struct StoredEvent {
    /// 写入序号（**不是**逻辑位置）：原地更新会换新 id，读取面用它做增量游标
    pub id: i64,
    pub run_id: String,
    /// 逻辑位置：同一运行内单调递增，按它排序渲染
    pub seq: i64,
    /// 源事件版本（毫秒；重放旧快照的挡板）
    pub rev: i64,
    pub at: String,
    pub kind: String,
    pub payload: Value,
    /// [`EventSource::as_str`]
    pub source: String,
    /// 运行内稳定身份（存储层去重键，读取面不外溢）
    pub dedupe_key: String,
}

impl StoredEvent {
    pub fn source_priority(&self) -> u8 {
        EventSource::parse(&self.source)
            .map(EventSource::priority)
            .unwrap_or(0)
    }
}

/// 一次写入的结果（去重与原地更新的可观测面）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppendOutcome {
    /// 新事件，占用新 seq
    Created(i64),
    /// 同身份原地更新，seq 不变
    Updated(i64),
    /// 重复投递 / 低优先级来源不覆盖，账本无变化
    Duplicate,
}

/// 一批原始事件经唯一入口处理后的报告（HTTP 回执与日志共用）
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestReport {
    pub created: usize,
    pub updated: usize,
    pub deduped: usize,
    /// 已识别但没有归一形态的桥接生命周期事件（如 step-start），不落账本
    pub ignored: usize,
    /// 未知事件类型：丢弃并计数，绝不静默
    pub unknown: usize,
    /// 未知类型名（去重排序；日志与排障用）
    pub unknown_types: Vec<String>,
    /// 本批是否触发了截断
    pub truncated: bool,
    /// 本批按上限淘汰的事件条数
    pub pruned: usize,
}

impl IngestReport {
    pub fn record_unknown(&mut self, label: &str) {
        self.unknown += 1;
        if !self.unknown_types.iter().any(|t| t == label) {
            self.unknown_types.push(label.to_string());
        }
    }
}
