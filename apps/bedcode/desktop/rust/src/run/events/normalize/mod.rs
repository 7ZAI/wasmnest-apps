//! 归一化：agent 原生载荷 → 12 类归一事件（ADR 0004）
//!
//! 桥接与账本镜像喂进来的是**各家自己的形状**（opencode 事件总线 / pi 扩展
//! 事件 / pi JSONL 会话记录），本模块按驱动（agent id）分派到对应实现。归一
//! 是纯函数：不碰存储、不碰时钟（`now` 由调用方注入），native 单测可完整覆盖。
//!
//! **只收录实测/类型声明核对过的形状**（2026-10-30）：opencode 1.19.1 事件表与
//! pi 1.4.0 `ExtensionAPI` 事件类型。没核对过的类型一律落到「未知并计数」，
//! 不在猜测的形状上加映射——错映射比缺映射更难排查。
//!
//! **pi 的会话记录是树**（entry 有 id/parentId，可 in-place 分叉）：本模块只按
//! 到达顺序线性归一，不做父子重排；fork/branch 明确在 spec 范围之外。

pub mod opencode;
pub mod pi;

use super::model::DraftEvent;
use serde_json::Value;

/// 单条原始载荷的归一结果
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Outcome {
    pub drafts: Vec<DraftEvent>,
    /// 已识别但无归一形态（桥接生命周期噪声）
    pub ignored: bool,
    /// 未知类型名（`Some` = 计数并丢弃）
    pub unknown: Option<String>,
}

impl Outcome {
    pub fn events(drafts: Vec<DraftEvent>) -> Self {
        Self {
            drafts,
            ignored: false,
            unknown: None,
        }
    }

    pub fn ignored() -> Self {
        Self {
            drafts: Vec::new(),
            ignored: true,
            unknown: None,
        }
    }

    pub fn unknown(label: impl Into<String>) -> Self {
        Self {
            drafts: Vec::new(),
            ignored: false,
            unknown: Some(label.into()),
        }
    }
}

/// 按驱动分派；未适配驱动（claude / codex 本轮只读镜像尚未实现）一律未知计数
pub fn normalize(driver: &str, raw: &Value, now: &str) -> Outcome {
    match driver {
        "opencode" => opencode::normalize(raw, now),
        "pi" => pi::normalize(raw, now),
        other => {
            let ty = raw.get("type").and_then(Value::as_str).unwrap_or("?");
            Outcome::unknown(format!("{other}:{ty}"))
        }
    }
}

// ==================== 共用读取辅助 ====================

/// 字符串字段（缺失 / 非字符串 → None）
pub(crate) fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// 嵌套路径取字符串（`path(["a","b"])`）
pub(crate) fn text_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_str()
}

/// 嵌套路径取数字
pub(crate) fn number_at(value: &Value, path: &[&str]) -> Option<i64> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_i64()
}

/// `content`（字符串或内容块数组）→ 文本
pub(crate) fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|block| {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    text(block, "text")
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// 源事件版本（毫秒；缺失 = 0）
///
/// 只认数字（opencode 的 epoch ms / pi 扩展事件的 timestamp ms）。JSONL 的 ISO
/// 时间串不换算成毫秒（插件侧不引 chrono）：镜像记录是完整快照、不是流式增量，
/// 版本挡板对它们不适用，0 表示「按到达顺序」。
pub(crate) fn rev_of(value: Option<&Value>) -> i64 {
    value.and_then(Value::as_i64).unwrap_or(0)
}

/// epoch 毫秒 / RFC3339 字符串 / 缺省 → 事件时间（RFC3339 文本）
///
/// 秒级截断与全库 `created_at` / `updated_at` 同口径（插件侧不引 chrono）。
/// 字符串只在形状像 RFC3339 时原样透传（源自己的时间精度可能到毫秒）。
pub(crate) fn event_time(value: Option<&Value>, now: &str) -> String {
    match value {
        Some(Value::Number(number)) => number
            .as_u64()
            .map(|ms| crate::config::model::rfc3339_from_unix(ms / 1000))
            .unwrap_or_else(|| now.to_string()),
        Some(Value::String(raw)) if looks_like_rfc3339(raw) => raw.clone(),
        _ => now.to_string(),
    }
}

fn looks_like_rfc3339(raw: &str) -> bool {
    raw.len() >= 20
        && raw.as_bytes().get(4) == Some(&b'-')
        && raw.as_bytes().get(10) == Some(&b'T')
        && (raw.ends_with('Z') || raw.contains('+'))
}

/// 内容块的文本（text / thinking 两种字段名）
pub(crate) fn block_text(block: &Value) -> Option<&str> {
    match block.get("type").and_then(Value::as_str) {
        Some("text") => text(block, "text"),
        Some("thinking") => text(block, "thinking"),
        _ => None,
    }
}

/// 状态事件身份：有源毫秒版本用版本（同秒两次状态不撞车），否则退回秒级时间
pub(crate) fn status_key(rev: i64, at: &str) -> String {
    if rev > 0 {
        format!("status:{rev}")
    } else {
        format!("status:{at}")
    }
}

/// JSON 值 → 展示文本（工具结果：字符串原样，其余序列化）
pub(crate) fn display_json(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(other) => serde_json::to_string(other).unwrap_or_default(),
        None => String::new(),
    }
}

/// token 计数归一到跨 agent 同形（缺值 = null）
pub(crate) fn tokens_json(
    input: Option<i64>,
    output: Option<i64>,
    reasoning: Option<i64>,
    cache_read: Option<i64>,
    cache_write: Option<i64>,
    total: Option<i64>,
) -> Value {
    serde_json::json!({
        "input": input,
        "output": output,
        "reasoning": reasoning,
        "cacheRead": cache_read,
        "cacheWrite": cache_write,
        "total": total,
    })
}
