//! Lanbitou 命令实现
//!
//! 所有命令经 `invoke_command` 分派，参数和返回值均为 JSON（camelCase）。

use anyhow::Context;
use serde::Deserialize;
use wasmnest_plugin_api::host::HostClipboard;
use wasmnest_plugin_api::WasmHost;

use crate::store;

/// 已初始化的数据根（activate 成功后才有值）
fn root() -> anyhow::Result<&'static str> {
    crate::data_root().ok_or_else(|| anyhow::anyhow!("plugin not activated: data root unavailable"))
}

fn host() -> WasmHost {
    WasmHost
}

/// 创建新笔记
pub fn create_note(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let note = store::create_note(&host(), root()?)?;
    serde_json::to_value(&note).context("serialize note")
}

/// 打开笔记（返回正文与元数据）
pub fn open_note(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    #[derive(Deserialize)]
    struct Args {
        id: String,
    }
    let args: Args = serde_json::from_value(args).context("parse args")?;
    let note = store::open_note(&host(), root()?, &args.id)?;
    serde_json::to_value(&note).context("serialize note")
}

/// 保存笔记正文
pub fn save_note(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    #[derive(Deserialize)]
    struct Args {
        id: String,
        content: String,
    }
    let args: Args = serde_json::from_value(args).context("parse args")?;
    let note = store::save_note(&host(), root()?, &args.id, &args.content)?;
    serde_json::to_value(&note).context("serialize note")
}

/// 删除笔记
pub fn delete_note(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    #[derive(Deserialize)]
    struct Args {
        id: String,
    }
    let args: Args = serde_json::from_value(args).context("parse args")?;
    store::delete_note(&host(), root()?, &args.id)?;
    Ok(serde_json::json!({ "success": true }))
}

/// 列出所有笔记（updatedAt 降序）
pub fn list_notes(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let notes = store::list_notes(&host(), root()?)?;
    serde_json::to_value(&notes).context("serialize notes")
}

/// 重命名笔记（改写正文首行 = 标题）
pub fn rename_note(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    #[derive(Deserialize)]
    struct Args {
        id: String,
        title: String,
    }
    let args: Args = serde_json::from_value(args).context("parse args")?;
    let note = store::rename_note(&host(), root()?, &args.id, &args.title)?;
    serde_json::to_value(&note).context("serialize note")
}

/// 搜索笔记（标题或正文包含查询串）
pub fn search_notes(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    #[derive(Deserialize)]
    struct Args {
        query: String,
    }
    let args: Args = serde_json::from_value(args).context("parse args")?;
    let notes = store::search_notes(&host(), root()?, &args.query)?;
    serde_json::to_value(&notes).context("serialize notes")
}

// ==================== 临时记事 / 归档 ====================

/// 确保临时记事存在（缺失则建空文档）；前端启动时先调它拿默认文档
pub fn ensure_scratch(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let note = store::ensure_scratch(&host(), root()?)?;
    serde_json::to_value(&note).context("serialize note")
}

/// 归档临时记事：全部内容剪到 `archives/<起日_今日>.md`，源文档清空
///
/// 日期由前端传（wasm 拿不到本地时区）：`today` = 今天，
/// `fallbackStart` = 源文档创建日的本地日期（正文里找不到日期时用）。
pub fn archive_scratch(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        today: Option<String>,
        fallback_start: Option<String>,
    }
    let args: Args = serde_json::from_value(args).unwrap_or_default();
    let (archive, source) = store::archive_scratch(
        &host(),
        root()?,
        args.today.as_deref(),
        args.fallback_start.as_deref(),
    )?;
    Ok(serde_json::json!({ "archive": archive, "source": source }))
}

/// 列出归档（时间范围名，新的在前）
pub fn list_archives(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let archives = store::list_archives(&host(), root()?)?;
    serde_json::to_value(&archives).context("serialize archives")
}

/// 读归档正文
pub fn open_archive(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    #[derive(Deserialize)]
    struct Args {
        id: String,
    }
    let args: Args = serde_json::from_value(args).context("parse args")?;
    let archive = store::open_archive(&host(), root()?, &args.id)?;
    serde_json::to_value(&archive).context("serialize archive")
}

/// 读取设置（缺项按默认值深合并）
pub fn read_settings(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    Ok(store::read_settings(&host(), root()?))
}

/// 保存设置
pub fn save_settings(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    #[derive(Deserialize)]
    struct Args {
        settings: serde_json::Value,
    }
    let args: Args = serde_json::from_value(args).context("parse args")?;
    store::save_settings(&host(), root()?, &args.settings)?;
    Ok(serde_json::json!({ "success": true }))
}

/// 读取工作上下文（缺项按默认值深合并）
pub fn read_context(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    Ok(store::read_context(&host(), root()?))
}

/// 保存工作上下文
pub fn save_context(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    #[derive(Deserialize)]
    struct Args {
        context: serde_json::Value,
    }
    let args: Args = serde_json::from_value(args).context("parse args")?;
    store::save_context(&host(), root()?, &args.context)?;
    Ok(serde_json::json!({ "success": true }))
}

/// 读取剪贴板文本（空 / 非文本内容返回 `text: null`）
pub fn clipboard_read(_args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let text = host()
        .clipboard_read_text()
        .map_err(|e| anyhow::anyhow!("clipboard read failed: {}", e))?;
    Ok(serde_json::json!({ "text": text }))
}

/// 写入剪贴板文本
pub fn clipboard_write(args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    #[derive(Deserialize)]
    struct Args {
        text: String,
    }
    let args: Args = serde_json::from_value(args).context("parse args")?;
    host()
        .clipboard_write_text(&args.text)
        .map_err(|e| anyhow::anyhow!("clipboard write failed: {}", e))?;
    Ok(serde_json::json!({ "success": true }))
}
