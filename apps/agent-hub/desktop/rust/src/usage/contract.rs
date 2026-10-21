//! 使用统计能力的适配器契约（`Agent::usage()` 返回的能力表）
//!
//! 公共域（扫描编排 / 水位 / 落库 / 状态 / 看板）只遍历注册表；每个 agent
//! 声明自己的日志来源形态（JSONL 目录 / SQLite 库）、解析器、格式嗅探顺序、
//! SQLite 取数引擎与「正在使用的会话」策略。未声明 Usage 能力的 agent 自然
//! 不出现在统计槽位与来源清单里。

use crate::usage_parse::{NormalizedEvent, ParsedSession};
use crate::usage_sqlite::SyncError;
use wasmnest_plugin_api::wasm_host::WasmHost;

/// 日志来源形态（家目录相对路径）
#[derive(Clone, Copy)]
pub(crate) enum UsageSource {
    /// JSONL 会话根目录（递归枚举 `*.jsonl`）
    Jsonl(&'static str),
    /// SQLite 库文件（不进文件枚举；由取数引擎同步）
    Sqlite(&'static str),
}

impl UsageSource {
    /// 家目录相对段（来源默认路径 / SQLite 库文件路径共用）
    pub(crate) fn seg(&self) -> &'static str {
        match self {
            UsageSource::Jsonl(seg) | UsageSource::Sqlite(seg) => seg,
        }
    }

    pub(crate) fn is_sqlite(&self) -> bool {
        matches!(self, UsageSource::Sqlite(_))
    }
}

/// SQLite 取数引擎（格式细节由适配器声明，水位/落库由公共域编排）
#[derive(Clone, Copy)]
pub(crate) struct SqliteUsage {
    /// 库文件 → 会话聚合
    pub(crate) collect: fn(&WasmHost, &str) -> Result<Vec<ParsedSession>, SyncError>,
    /// 库文件 + 会话 id → 归一事件流 + 是否截断（日志页现查）
    pub(crate) events: fn(&WasmHost, &str, &str) -> Result<(Vec<NormalizedEvent>, bool), SyncError>,
}

/// 使用统计能力
pub(crate) struct UsageSpec {
    pub(crate) source: UsageSource,
    /// JSONL 解析器（Jsonl 源必填；Sqlite 源为 None）
    pub(crate) parse_jsonl: Option<fn(&str) -> ParsedSession>,
    /// 自定义来源格式嗅探（只看内容 head）与声明顺序（小者先；
    /// pi 的顶层 `type=message` 先于 claude 的 `assistant/user` 判定）
    pub(crate) sniff: Option<fn(&[&str]) -> bool>,
    pub(crate) sniff_rank: u8,
    /// SQLite 源取数引擎（Sqlite 源必填）
    pub(crate) sqlite: Option<SqliteUsage>,
    /// 「正在使用的会话」策略（可选；claude 读 `~/.claude.json` 配置权威）
    pub(crate) active_session: Option<fn(&WasmHost) -> Option<(String, String)>>,
}
