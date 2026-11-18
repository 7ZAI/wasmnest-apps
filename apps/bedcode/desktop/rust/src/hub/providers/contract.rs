//! 供应商能力的适配器契约（`Agent::provider()` 返回的钩子表）
//!
//! 公共编排（入参校验 / key 四选一 / 多目标独立失败 / 状态推送）留在供应商域；
//! 配置路径、写入格式、方言映射与反向导入由各 agent 适配器声明。这里只做
//! 能力声明与函数指针，不引入格式中间层（统一中间格式会放大风险，见 issue #4）。

use super::import::PresetDraft;
use serde_json::Value;
use wasmnest_plugin_api::host::HostFs;
use wasmnest_plugin_api::wasm_host::WasmHost;

/// 预设快照（一次应用内的只读视图；从库行反序列化，字段与 wire 预设同义）
pub(crate) struct Preset {
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) api_style: String,
    pub(crate) models: Vec<String>,
}

/// 单目标写入上下文（公共字段 + 适配器私有入参）
pub(crate) struct ProviderWriteCtx<'a> {
    pub(crate) preset: &'a Preset,
    pub(crate) target_name: &'a str,
    pub(crate) key: Option<&'a str>,
    /// claude 桥接冲突的二次确认（仅桥接类目标使用）
    pub(crate) force: bool,
    pub(crate) home: &'a str,
    /// 原始命令入参：适配器私有输入（如 codex.envKey）自行读取
    pub(crate) args: &'a Value,
}

/// 单目标写入结局
pub(crate) enum TargetWrite {
    /// 已写入，附写入文件名
    Applied(Vec<String>),
    /// 桥接冲突，被阻止（未写任何文件）
    BridgeConflict(Vec<String>),
}

/// 失败分类（前端按 reason 查 i18n；错误原文只进日志，界面不携带）
pub(crate) const REASON_NO_MODELS: &str = "noModels";
pub(crate) const REASON_WRITE_FAILED: &str = "writeFailed";
pub(crate) const REASON_BRIDGE: &str = "bridgeConflict";

/// 供应商目标能力。`None` = 该 agent 不是供应商目标（自动不出现在目标清单）
pub(crate) struct ProviderSpec {
    /// 只读视图的 wire 键（None = 无视图）；与 `view` 必须成对声明
    pub(crate) view_key: Option<&'static str>,
    /// 应用时参与 key 四选一（codex 只写 env 变量名 → false）
    pub(crate) requires_key: bool,
    /// 反向导入草稿的合并顺序（小者先；同名冲突时先者保留原名）。
    /// 只影响导入结果命名，不参与 UI 展示顺序
    pub(crate) import_rank: u8,
    /// 配置写入（格式细节在适配器内）
    pub(crate) write: fn(&WasmHost, &ProviderWriteCtx) -> Result<TargetWrite, (String, String)>,
    /// 从源 CLI 配置直拷 key（None = 不支持 source 模式）
    pub(crate) source_key: Option<fn(&WasmHost, &str, &str) -> Result<String, String>>,
    /// 只读视图（h, home）
    pub(crate) view: Option<fn(&WasmHost, &str) -> Value>,
    /// 反向导入（h, home）；None = 该 agent 不生成预设
    pub(crate) import: Option<fn(&WasmHost, &str) -> Vec<PresetDraft>>,
    /// 应用 / 视图前的批量授权路径（home；一次弹窗列出全部）
    pub(crate) auth_paths: Option<fn(&str) -> Vec<String>>,
}

/// 读配置文件：不存在（或为空）时给空对象骨架（首次应用不要求文件已存在）
pub(crate) fn read_or_default(h: &WasmHost, path: &str, label: &str) -> Result<String, String> {
    let text = h
        .fs_read(path)
        .map_err(|e| format!("read {label} failed: {e}"))?;
    Ok(match text {
        Some(t) if !t.trim().is_empty() => t,
        _ => "{}".to_string(),
    })
}

/// 读配置文件：不存在时给空串（codex 的空配置骨架就是空文件；`{}` 是 JSON 骨架，
/// 对 TOML 无意义）
pub(crate) fn read_or_default_raw(h: &WasmHost, path: &str, label: &str) -> Result<String, String> {
    let text = h
        .fs_read(path)
        .map_err(|e| format!("read {label} failed: {e}"))?;
    Ok(text.unwrap_or_default())
}
