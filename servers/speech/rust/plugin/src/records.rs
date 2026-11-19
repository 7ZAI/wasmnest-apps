//! 识别元数据记录：只存长度与分类，不存音频与文本
//!
//! 与设计口径一致：服务不是转写历史库；记录用于排查「这次为什么走云端 / 为什么失败」。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use wasmnest_plugin_api::host::{HostLog, HostStorage};
use wasmnest_plugin_api::WasmHost;

/// KV 键
pub const RECORDS_KEY: &str = "speech.records";
/// 保留条数
pub const MAX_RECORDS: usize = 200;

/// 一条识别元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordEntry {
    /// 任务 id
    pub id: String,
    /// 创建时间（epoch ms；未知为 0）
    pub created_at: u64,
    /// local | remote
    pub channel: String,
    /// 模型 id / 供应商模型名
    pub model_id: String,
    /// 实际语种
    pub language: Option<String>,
    /// 原始音频字节
    pub audio_bytes: u64,
    /// 文本字符数（不存文本）
    pub text_chars: u64,
    /// 总耗时
    pub elapsed_ms: u64,
    /// 失败分类
    pub error_kind: Option<String>,
    /// 调用方自报标签
    pub caller_tag: Option<String>,
}

/// 追加一条记录（超过上限裁掉最旧）
pub fn append(entry: RecordEntry) {
    let mut records = load();
    records.push(entry);
    if records.len() > MAX_RECORDS {
        let drop_count = records.len() - MAX_RECORDS;
        records.drain(0..drop_count);
    }
    let value = match serde_json::to_value(&records) {
        Ok(value) => value,
        Err(err) => {
            WasmHost.log_warn(&format!("speech: record serialize failed: {err}"));
            return;
        }
    };
    if let Err(err) = WasmHost.storage_set(RECORDS_KEY, &value) {
        WasmHost.log_warn(&format!("speech: record save failed: {err}"));
    }
}

/// 最近 N 条（新到旧）
pub fn list(limit: usize) -> Vec<Value> {
    let records = load();
    records
        .iter()
        .rev()
        .take(limit)
        .filter_map(|record| serde_json::to_value(record).ok())
        .collect()
}

fn load() -> Vec<RecordEntry> {
    match WasmHost.storage_get(RECORDS_KEY) {
        Ok(Some(value)) => serde_json::from_value(value).unwrap_or_else(|err| {
            WasmHost.log_warn(&format!("speech: records unreadable, starting empty: {err}"));
            Vec::new()
        }),
        Ok(None) => Vec::new(),
        Err(err) => {
            WasmHost.log_warn(&format!("speech: records read failed: {err}"));
            Vec::new()
        }
    }
}

/// 当前时间（epoch ms；wasm 无系统时钟时回落 0）
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}