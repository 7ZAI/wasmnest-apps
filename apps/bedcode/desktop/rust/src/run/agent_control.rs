//! agent 模型 / 思考等级控制（工作台终端 header 的下拉）
//!
//! **唯一控制入口**：`run.agent.options` / `run.agent.set`。前端不拼斜杠语法、
//! 不感知桥接 wire、不持「agent → 档位」的第二份真源——四种 agent 的差异只住在
//! 本文件的 [`profile_for`]。
//!
//! 两条通道（本机实测，2026-11-05）：
//! - **桥接**（pi / opencode）：命令写进 `run_commands` 队列（kind
//!   [`COMMAND_AGENT_CONTROL`]），agent 进程内的扩展执行后回执。运行内生效、
//!   保留对话上下文；
//! - **PTY 斜杠命令**（claude / codex）：后端拼一行 `/model …` 写进同一条 PTY。
//!   codex 的内联 `--reasoning` 要 **0.164+**，低于该版本显性拒绝（不注入按键：
//!   依赖 TUI 列表顺序，属于不可靠路径）。
//!
//! 当前值：模型 = 运行行 `model`（桥接 / usage 上行一直维护）；思考等级 = 会话
//! 注解 [`ANNOTATION_THINKING`]。`set` 成功派发后乐观写入，桥接上行的
//! `model_change` / `thinking_level_change` 会覆盖它（用户在终端里手动改也可见）。
//!
//! 失败一律 fail-visible：每个不可用态给结构化 reason（[`Reason`]），前端负责文案，
//! 后端不吞错、不猜。

use serde_json::{json, Value};

/// 桥接命令 kind：payload `{model?, thinkingLevel?}`
pub const COMMAND_AGENT_CONTROL: &str = "agent-control";

/// 会话注解键：当前思考等级（模型复用运行行 `model`，不重复存）
pub const ANNOTATION_THINKING: &str = "agent.thinking";

/// codex 内联 `/model … --reasoning …` 的最低版本
pub const CODEX_INLINE_MIN_VERSION: &str = "0.164.0";

/// 控制通道
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlChannel {
    /// agent 进程内扩展（经 `run_commands` 队列）
    Bridge,
    /// 直接写 PTY 的斜杠命令
    Pty,
}

impl ControlChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            ControlChannel::Bridge => "bridge",
            ControlChannel::Pty => "pty",
        }
    }
}

/// agent 控制画像（四种 agent 的唯一差异点）
#[derive(Debug, Clone, Copy)]
pub struct AgentProfile {
    pub channel: ControlChannel,
    /// 可切换的思考等级（空 = 该 agent 无独立等级概念）
    pub thinking_levels: &'static [&'static str],
}

const PI_LEVELS: &[&str] = &["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const CLAUDE_LEVELS: &[&str] = &["low", "medium", "high", "xhigh", "max"];
const CODEX_LEVELS: &[&str] = &["minimal", "low", "medium", "high", "xhigh", "max"];

/// agent → 控制画像（未知 agent 返回 `None`，调用方显性拒绝）
pub fn profile_for(agent: &str) -> Option<AgentProfile> {
    match agent {
        "pi" => Some(AgentProfile {
            channel: ControlChannel::Bridge,
            thinking_levels: PI_LEVELS,
        }),
        // opencode 的等级由模型 variant 承载，服务端没有独立等级入口
        "opencode" => Some(AgentProfile {
            channel: ControlChannel::Bridge,
            thinking_levels: &[],
        }),
        "claude" => Some(AgentProfile {
            channel: ControlChannel::Pty,
            thinking_levels: CLAUDE_LEVELS,
        }),
        "codex" => Some(AgentProfile {
            channel: ControlChannel::Pty,
            thinking_levels: CODEX_LEVELS,
        }),
        _ => None,
    }
}

// ==================== 不可用原因（结构化） ====================

/// fail-visible reason（前端据此选文案；`hint` 里带必要参数，如最低版本）
#[derive(Debug, Clone, PartialEq)]
pub enum Reason {
    RunEnded,
    AgentUnsupported(String),
    BridgeOffline,
    NoPty,
    CodexUpdateRequired(String),
    ThinkingUnsupported,
    ModelUnknown,
    LevelUnknown(String),
    InvalidValue,
    AgentRejected(String),
    /// PTY 输入行里还有用户未提交的草稿：注入斜杠命令会与草稿拼成一行，
    /// 既让命令失效又会把草稿当 prompt 提交，因此显性拒绝。
    InputBusy,
}

impl Reason {
    pub fn code(&self) -> &'static str {
        match self {
            Reason::RunEnded => "run-ended",
            Reason::AgentUnsupported(_) => "agent-unsupported",
            Reason::BridgeOffline => "bridge-offline",
            Reason::NoPty => "no-pty",
            Reason::CodexUpdateRequired(_) => "codex-update-required",
            Reason::ThinkingUnsupported => "thinking-unsupported",
            Reason::ModelUnknown => "model-unknown",
            Reason::LevelUnknown(_) => "level-unknown",
            Reason::InvalidValue => "invalid-value",
            Reason::AgentRejected(_) => "agent-rejected",
            Reason::InputBusy => "input-busy",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Reason::RunEnded => "run has ended".to_string(),
            Reason::AgentUnsupported(agent) => format!("agent has no control adapter: {agent}"),
            Reason::BridgeOffline => {
                "bridge unavailable (mirror mode or old bridge); restart this run".to_string()
            }
            Reason::NoPty => "run has no PTY handle".to_string(),
            Reason::CodexUpdateRequired(min) => {
                format!("codex {min}+ is required for inline /model --reasoning")
            }
            Reason::ThinkingUnsupported => {
                "this agent has no switchable thinking level".to_string()
            }
            Reason::ModelUnknown => "model is not in the available list".to_string(),
            Reason::LevelUnknown(level) => format!("unknown thinking level: {level}"),
            Reason::InvalidValue => "value rejected (control characters or too long)".to_string(),
            Reason::AgentRejected(message) => message.clone(),
            Reason::InputBusy => {
                "input line has an unsubmitted draft; clear it before switching model".to_string()
            }
        }
    }

    pub fn json(&self) -> Value {
        json!({ "reason": self.code(), "message": self.message() })
    }
}

// ==================== 纯函数：解析 / 校验 / 命令构造 ====================

/// 一个可选模型项
#[derive(Debug, Clone, PartialEq)]
pub struct ModelOption {
    /// 提交给后端的值（pi 用 `provider/model`，codex 用 slug）
    pub value: String,
    pub label: String,
    /// `current` / `catalog` / `preset`
    pub source: &'static str,
}

impl ModelOption {
    pub fn json(&self) -> Value {
        json!({ "value": self.value, "label": self.label, "source": self.source })
    }
}

/// `"codex-cli 0.160.0"` / `"0.164.1"` → `(0, 160, 0)`
pub fn parse_version(text: &str) -> Option<(u32, u32, u32)> {
    let token = text
        .split_whitespace()
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))?;
    let mut parts = token.trim_start_matches('v').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts
        .next()
        .map(|p| p.split(|c: char| !c.is_ascii_digit()).next().unwrap_or("0"))
        .unwrap_or("0")
        .parse()
        .ok()?;
    Some((major, minor, patch))
}

/// 版本比较（`>= min`）
pub fn version_at_least(version: (u32, u32, u32), min: (u32, u32, u32)) -> bool {
    version >= min
}

/// `pi --list-models` 表格 → 模型项（`provider model …`，列宽对齐）
///
/// 首行是表头，按首个 token 是否为 `provider` 跳过；模型 id 取第二列，
/// 提交值用 `provider/model`（pi 扩展据此 `modelRegistry.find`）。
pub fn parse_pi_models(stdout: &str) -> Vec<ModelOption> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        let mut cols = line.split_whitespace();
        let Some(provider) = cols.next() else {
            continue;
        };
        let Some(model) = cols.next() else { continue };
        if provider == "provider" || model == "model" {
            continue;
        }
        // 只接受 token 形态：带空格的说明行、扩展日志行都不进清单
        if provider.starts_with('[') || !safe_token(provider) || !safe_token(model) {
            continue;
        }
        out.push(ModelOption {
            value: format!("{provider}/{model}"),
            label: format!("{provider}/{model}"),
            source: "catalog",
        });
    }
    out
}

/// `opencode models` → 模型项（每行一个 `provider/model`，无表头）
///
/// 该命令读的是 opencode 自己的配置（含已应用的供应商），因此就是用户要的
/// 「供应商配置的模型」；非法 / 非 `provider/model` 形状的行不进清单。
pub fn parse_opencode_models(stdout: &str) -> Vec<ModelOption> {
    let mut out: Vec<ModelOption> = Vec::new();
    for line in stdout.lines() {
        let value = line.trim();
        if value.is_empty() || !value.contains('/') || !safe_token(value) {
            continue;
        }
        if out.iter().any(|existing| existing.value == value) {
            continue;
        }
        out.push(ModelOption {
            value: value.to_string(),
            label: value.to_string(),
            source: "catalog",
        });
    }
    out
}

/// `codex debug models` 的 JSON catalog → 模型项（只取 `visibility: list`）
pub fn parse_codex_models(stdout: &str) -> Vec<ModelOption> {
    let Ok(raw) = serde_json::from_str::<Value>(stdout.trim()) else {
        return Vec::new();
    };
    let Some(models) = raw.get("models").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for model in models {
        if model.get("visibility").and_then(Value::as_str) == Some("hidden") {
            continue;
        }
        let Some(slug) = model.get("slug").and_then(Value::as_str) else {
            continue;
        };
        if !safe_token(slug) {
            continue;
        }
        let label = model
            .get("display_name")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(|value| format!("{value} ({slug})"))
            .unwrap_or_else(|| slug.to_string());
        out.push(ModelOption {
            value: slug.to_string(),
            label,
            source: "catalog",
        });
    }
    out
}

/// `codex debug models` 的 JSON catalog → 推理等级并集（保序去重）
pub fn parse_codex_levels(stdout: &str) -> Vec<String> {
    let Ok(raw) = serde_json::from_str::<Value>(stdout.trim()) else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    let Some(models) = raw.get("models").and_then(Value::as_array) else {
        return out;
    };
    for model in models {
        // 与模型清单同口径：hidden 模型不进下拉，它的等级也不该出现在档位里
        if model.get("visibility").and_then(Value::as_str) == Some("hidden") {
            continue;
        }
        let Some(levels) = model
            .get("supported_reasoning_levels")
            .and_then(Value::as_array)
        else {
            continue;
        };
        for level in levels {
            let Some(effort) = level.get("effort").and_then(Value::as_str) else {
                continue;
            };
            if safe_token(effort) && !out.iter().any(|existing| existing == effort) {
                out.push(effort.to_string());
            }
        }
    }
    out
}

/// 安全 token：非空、≤128 字符、无控制字符与空白
///
/// 值最终会进 PTY 命令行（claude / codex）或桥接 payload，空白与控制字符是
/// 命令注入面的全部入口；不满足一律显性拒绝（[`Reason::InvalidValue`]）。
pub fn safe_token(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 128
        && !value.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// PTY 斜杠命令注入闸门（纯函数，native 可测）。
///
/// 注入经普通输入路径，会与 TUI 输入行里未提交的草稿拼成一行：命令失效、
/// 草稿被当 prompt 提交、提交行追踪器还会记一条假任务行。有草稿时优先
/// 保留用户输入，显性拒绝而不是清行。
pub fn pty_injection_guard(has_pty: bool, pending_input: bool) -> Option<Reason> {
    if !has_pty {
        return Some(Reason::NoPty);
    }
    if pending_input {
        return Some(Reason::InputBusy);
    }
    None
}

/// PTY 通道的一次切换 → 要写入 PTY 的一行（含 `\r`；`None` = 无内容）
pub fn slash_line(
    agent: &str,
    model: Option<&str>,
    level: Option<&str>,
) -> Result<Option<String>, Reason> {
    match (agent, model, level) {
        // claude 的 `/model` 与 `/effort` 是**两次独立提交**：一次写入两行会被 TUI
        // 当成粘贴，第二条可能落成普通输入。要求调用方分两次请求（界面就是一次只改一项）。
        ("claude", Some(_), Some(_)) => Err(Reason::AgentRejected(
            "claude: set model and thinking level in separate requests".to_string(),
        )),
        ("claude", Some(model), None) => Ok(Some(format!("/model {model}\r"))),
        ("claude", None, Some(level)) => Ok(Some(format!("/effort {level}\r"))),
        // codex 0.164+：`/model [model] --reasoning <level>` 一条内联搞定
        ("codex", Some(model), Some(level)) => {
            Ok(Some(format!("/model {model} --reasoning {level}\r")))
        }
        ("codex", Some(model), None) => Ok(Some(format!("/model {model}\r"))),
        ("codex", None, Some(level)) => Ok(Some(format!("/model --reasoning {level}\r"))),
        (_, None, None) => Ok(None),
        _ => Err(Reason::AgentRejected(format!(
            "no PTY slash command for agent: {agent}"
        ))),
    }
}

/// 校验并归一一次切换请求
pub fn validate_request(
    profile: AgentProfile,
    model: Option<&str>,
    level: Option<&str>,
) -> Result<(Option<String>, Option<String>), Reason> {
    let model = model.map(str::trim).filter(|value| !value.is_empty());
    let level = level.map(str::trim).filter(|value| !value.is_empty());
    if model.is_none() && level.is_none() {
        return Err(Reason::InvalidValue);
    }
    if let Some(model) = model {
        if !safe_token(model) {
            return Err(Reason::InvalidValue);
        }
    }
    if let Some(level) = level {
        if !safe_token(level) {
            return Err(Reason::InvalidValue);
        }
        if profile.thinking_levels.is_empty() {
            return Err(Reason::ThinkingUnsupported);
        }
        if !profile.thinking_levels.iter().any(|known| *known == level) {
            return Err(Reason::LevelUnknown(level.to_string()));
        }
    }
    Ok((model.map(str::to_string), level.map(str::to_string)))
}

/// 合并模型清单：当前值 → 目录 → 供应商预设（按 value 去重、保序）
pub fn merge_models(
    current: Option<&str>,
    catalog: Vec<ModelOption>,
    presets: Vec<String>,
) -> Vec<ModelOption> {
    let mut out: Vec<ModelOption> = Vec::new();
    let mut push = |option: ModelOption| {
        if !out.iter().any(|existing| existing.value == option.value) {
            out.push(option);
        }
    };
    if let Some(current) = current.map(str::trim).filter(|value| !value.is_empty()) {
        push(ModelOption {
            value: current.to_string(),
            label: current.to_string(),
            source: "current",
        });
    }
    for option in catalog {
        push(option);
    }
    for model in presets {
        let model = model.trim();
        if model.is_empty() || !safe_token(model) {
            continue;
        }
        push(ModelOption {
            value: model.to_string(),
            label: model.to_string(),
            source: "preset",
        });
    }
    out
}

// ==================== wasm：命令实现 ====================

#[cfg(target_arch = "wasm32")]
mod host_impl {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use wasmnest_plugin_api::host::{HostLog, HostProcess};
    use wasmnest_plugin_api::wasm_host::WasmHost;

    /// 目录缓存（进程内；插件重载即失效）。CLI 目录是只读快照，60s 足够新鲜。
    const CATALOG_TTL_SECS: u64 = 60;
    const CATALOG_TIMEOUT_MS: u64 = 5_000;

    #[derive(Clone)]
    struct CachedCatalog {
        at: u64,
        models: Vec<ModelOption>,
        levels: Vec<String>,
    }

    fn cache() -> &'static Mutex<HashMap<&'static str, CachedCatalog>> {
        static CACHE: OnceLock<Mutex<HashMap<&'static str, CachedCatalog>>> = OnceLock::new();
        CACHE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// 时间源不可解析时返回 None：调用方必须跳过缓存读且不写缓存。
    /// `unwrap_or(0)` 会让 `at=0` 的条目永不过期（L4）。
    fn now_epoch() -> Option<u64> {
        crate::config::model::unix_from_rfc3339(&crate::config::model::now_rfc3339())
    }

    /// 跑一条只读命令（登录 shell，保住 nvm 等 PATH 注入）；失败返回 `None`
    fn run_sync(host: &WasmHost, script: &str) -> Option<String> {
        let windows = crate::hub::is_windows();
        let (command, args) = crate::hub::shell_invocation(script.to_string(), windows);
        let request = json!({
            "command": command,
            "args": args,
            "timeout_ms": CATALOG_TIMEOUT_MS,
        });
        let result = HostProcess::process_run_sync(host, &request.to_string()).ok()?;
        if result.timed_out || result.exit_code != Some(0) {
            host.log_debug(&format!(
                "agent-control: `{script}` failed (exit={:?}, timed_out={})",
                result.exit_code, result.timed_out
            ));
            return None;
        }
        Some(result.stdout)
    }

    fn catalog(host: &WasmHost, agent: &'static str) -> CachedCatalog {
        let now = now_epoch();
        if let (Some(now), Ok(guard)) = (now, cache().lock()) {
            if let Some(hit) = guard.get(agent) {
                if now.saturating_sub(hit.at) < CATALOG_TTL_SECS {
                    return hit.clone();
                }
            }
        }
        let (models, levels) = match agent {
            "pi" => (
                run_sync(host, "pi --list-models")
                    .map(|stdout| parse_pi_models(&stdout))
                    .unwrap_or_default(),
                Vec::new(),
            ),
            "opencode" => (
                run_sync(host, "opencode models")
                    .map(|stdout| parse_opencode_models(&stdout))
                    .unwrap_or_default(),
                Vec::new(),
            ),
            "codex" => {
                let stdout = run_sync(host, "codex debug models");
                match stdout {
                    Some(stdout) => (parse_codex_models(&stdout), parse_codex_levels(&stdout)),
                    None => (Vec::new(), Vec::new()),
                }
            }
            _ => (Vec::new(), Vec::new()),
        };
        let entry = CachedCatalog {
            at: now.unwrap_or(0),
            models,
            levels,
        };
        // 时间源不可用时不写缓存：at=0 的条目会「永不过期」（L4）。
        if now.is_some() {
            if let Ok(mut guard) = cache().lock() {
                guard.insert(agent, entry.clone());
            }
        }
        entry
    }

    /// codex 版本（`codex --version`）：与目录同为 60s 缓存，避免每次
    /// options / set 都串行起一次登录 shell 子进程（M21）。
    fn codex_version(host: &WasmHost) -> Option<(u32, u32, u32)> {
        static VERSION: OnceLock<Mutex<Option<(u64, Option<(u32, u32, u32)>)>>> = OnceLock::new();
        let cache = VERSION.get_or_init(|| Mutex::new(None));
        let now = now_epoch();
        if let (Some(now), Ok(guard)) = (now, cache.lock()) {
            if let Some((at, version)) = guard.as_ref() {
                if now.saturating_sub(*at) < CATALOG_TTL_SECS {
                    return *version;
                }
            }
        }
        let version = run_sync(host, "codex --version").and_then(|stdout| parse_version(&stdout));
        if let (Some(now), Ok(mut guard)) = (now, cache.lock()) {
            *guard = Some((now, version));
        }
        version
    }

    /// 供应商预设里的模型并集（零子进程的兜底来源）
    ///
    /// 带 60s 缓存：`build_state` 会读 CLI 配置目录（授权在 activate 已批量拿到，
    /// 但仍是文件读）；下拉随焦点运行反复取数时不值得每拍重读一遍。
    fn preset_models(host: &WasmHost) -> Vec<String> {
        static PRESETS: OnceLock<Mutex<Option<(u64, Vec<String>)>>> = OnceLock::new();
        let cache = PRESETS.get_or_init(|| Mutex::new(None));
        let now = now_epoch();
        if let (Some(now), Ok(guard)) = (now, cache.lock()) {
            if let Some((at, models)) = guard.as_ref() {
                if now.saturating_sub(*at) < CATALOG_TTL_SECS {
                    return models.clone();
                }
            }
        }
        let models = load_preset_models(host);
        if let (Some(now), Ok(mut guard)) = (now, cache.lock()) {
            *guard = Some((now, models.clone()));
        }
        models
    }

    fn load_preset_models(host: &WasmHost) -> Vec<String> {
        let Ok(state) = crate::hub::providers_state(host) else {
            return Vec::new();
        };
        let mut out: Vec<String> = Vec::new();
        if let Some(presets) = state.get("presets").and_then(Value::as_array) {
            for preset in presets {
                let Some(models) = preset.get("models").and_then(Value::as_array) else {
                    continue;
                };
                for model in models {
                    if let Some(model) = model.as_str() {
                        if !out.iter().any(|existing| existing == model) {
                            out.push(model.to_string());
                        }
                    }
                }
            }
        }
        out
    }

    fn thinking_annotation(host: &WasmHost, run_id: &str) -> Result<Option<String>, String> {
        // 存储读失败不是「没设置过」：向 options 传播，别把错误吞成 None（L3）。
        let slots = crate::session::annotations_via_host(run_id)?;
        // 注解槽形状：Vec<(String, String)>
        Ok(slots.and_then(|slots| {
            slots
                .into_iter()
                .find(|(key, _)| key == ANNOTATION_THINKING)
                .map(|(_, value)| value)
                .filter(|value| !value.is_empty())
        }))
    }

    fn capability(supported: bool, channel: ControlChannel, reason: Option<Reason>) -> Value {
        match reason {
            None => json!({
                "supported": supported,
                "channel": channel.as_str(),
                "reason": Value::Null,
                "message": Value::Null,
            }),
            Some(reason) => json!({
                "supported": false,
                "channel": channel.as_str(),
                "reason": reason.code(),
                "message": reason.message(),
            }),
        }
    }

    /// `agent.profile.options {cli}` → 池成员编辑器用的「无运行」能力清单。
    ///
    /// 模型来自**该 CLI 自己的配置读取命令**（`pi --list-models` /
    /// `opencode models` / `codex debug models`）——应用供应商之后，这份清单
    /// 就是它实际可用的模型；未应用的预设模板不混入（pi / opencode 的模型值
    /// 需要 `provider/` 前缀，裸模板值不可用）。思考等级来自静态画像
    ///（codex 以目录覆盖）。没有枚举入口的 CLI（claude）返回空清单 + 自由输入。
    pub fn catalog_via_host(args: &Value) -> Result<Value, String> {
        let cli = args
            .get("cli")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "agent.profile.options: cli required".to_string())?;
        let profile =
            profile_for(cli).ok_or_else(|| format!("agent-unsupported: unknown agent `{cli}`"))?;
        let host = WasmHost;
        let state = crate::hub::invoke_command("agent.get-state", Value::Null)
            .map_err(|e| e.to_string())?;
        let installed = state["state"]["clis"][cli]["installed"] == Value::Bool(true);

        let cached = match cli {
            "pi" => Some(catalog(&host, "pi")),
            "opencode" => Some(catalog(&host, "opencode")),
            "codex" => Some(catalog(&host, "codex")),
            _ => None,
        };
        let models = cached
            .as_ref()
            .map(|cached| cached.models.clone())
            .unwrap_or_default();
        let catalog_levels = if cli == "codex" {
            cached.map(|cached| cached.levels).unwrap_or_default()
        } else {
            Vec::new()
        };
        let thinking_levels: Vec<String> = if profile.thinking_levels.is_empty() {
            Vec::new()
        } else if cli == "codex" && !catalog_levels.is_empty() {
            catalog_levels
        } else {
            profile
                .thinking_levels
                .iter()
                .map(|level| (*level).to_string())
                .collect()
        };

        Ok(json!({
            "cli": cli,
            "installed": installed,
            "bridgeCapable": crate::run::bridge::supports_bridge(cli),
            "models": models.iter().map(ModelOption::json).collect::<Vec<_>>(),
            "thinkingLevels": thinking_levels,
        }))
    }

    /// `run.agent.options {runId}` → 当前值 + 可选清单 + 能力
    pub fn options_via_host(args: &Value) -> Result<Value, String> {
        let run_id = args
            .get("runId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "run.agent.options: runId required".to_string())?;
        let host = WasmHost;
        let record = crate::session::record_via_host(run_id)?
            .ok_or_else(|| format!("run.agent.options: run not found: {run_id}"))?;
        let agent = record.agent_id.clone().unwrap_or_default();
        let live = !record.status.is_terminal();

        let mut catalog_models: Vec<ModelOption> = Vec::new();
        let mut catalog_levels: Vec<String> = Vec::new();
        let mut codex_version_ok = true;

        if live {
            let cached = catalog(
                &host,
                match agent.as_str() {
                    "pi" => "pi",
                    "codex" => "codex",
                    _ => "",
                },
            );
            catalog_models = cached.models;
            catalog_levels = cached.levels;
            if agent == "codex" {
                codex_version_ok = codex_version(&host)
                    .map(|version| {
                        version_at_least(
                            version,
                            parse_version(CODEX_INLINE_MIN_VERSION).unwrap_or((0, 0, 0)),
                        )
                    })
                    .unwrap_or(false);
            }
        }

        let current_model = record.model.clone();
        // 供应商预设是 provider/model 形态，只对桥接 agent 有意义；并入
        // claude / codex 下拉会给出「点了必报错」的死选项，还会为拿预设触发
        // providers_state 的目录授权交互（M22）。
        let presets = match profile_for(&agent).map(|profile| profile.channel) {
            Some(ControlChannel::Bridge) => preset_models(&host),
            _ => Vec::new(),
        };
        let merged = merge_models(current_model.as_deref(), catalog_models, presets);

        let profile = profile_for(&agent);

        // 模型能力
        let model_capability = match profile {
            None => capability(
                false,
                ControlChannel::Pty,
                Some(Reason::AgentUnsupported(agent.clone())),
            ),
            Some(profile) => {
                let mut reason = None;
                if !live {
                    reason = Some(Reason::RunEnded);
                } else if profile.channel == ControlChannel::Bridge
                    && !record.bridge_connected(&crate::config::model::now_rfc3339())
                {
                    reason = Some(Reason::BridgeOffline);
                } else if profile.channel == ControlChannel::Pty && record.pty_id.is_none() {
                    reason = Some(Reason::NoPty);
                } else if agent == "codex" && !codex_version_ok {
                    reason = Some(Reason::CodexUpdateRequired(
                        CODEX_INLINE_MIN_VERSION.to_string(),
                    ));
                }
                match reason {
                    Some(reason) => capability(false, profile.channel, Some(reason)),
                    None => capability(true, profile.channel, None),
                }
            }
        };

        // 思考能力
        let thinking_capability = match profile {
            None => capability(
                false,
                ControlChannel::Pty,
                Some(Reason::AgentUnsupported(agent.clone())),
            ),
            Some(profile) if profile.thinking_levels.is_empty() => {
                capability(false, profile.channel, Some(Reason::ThinkingUnsupported))
            }
            Some(profile) => {
                let mut reason = None;
                if !live {
                    reason = Some(Reason::RunEnded);
                } else if profile.channel == ControlChannel::Bridge
                    && !record.bridge_connected(&crate::config::model::now_rfc3339())
                {
                    reason = Some(Reason::BridgeOffline);
                } else if profile.channel == ControlChannel::Pty && record.pty_id.is_none() {
                    reason = Some(Reason::NoPty);
                } else if agent == "codex" && !codex_version_ok {
                    reason = Some(Reason::CodexUpdateRequired(
                        CODEX_INLINE_MIN_VERSION.to_string(),
                    ));
                }
                match reason {
                    Some(reason) => capability(false, profile.channel, Some(reason)),
                    None => capability(true, profile.channel, None),
                }
            }
        };

        // 等级清单：codex 以 catalog 覆盖静态档位；其余用静态档位
        let levels: Vec<String> = match profile {
            None => Vec::new(),
            Some(profile) if profile.thinking_levels.is_empty() => Vec::new(),
            Some(profile) => {
                if agent == "codex" && !catalog_levels.is_empty() {
                    catalog_levels
                } else {
                    profile
                        .thinking_levels
                        .iter()
                        .map(|s| s.to_string())
                        .collect()
                }
            }
        };

        Ok(json!({
            "runId": run_id,
            "agent": agent,
            "current": {
                "model": current_model,
                "thinkingLevel": thinking_annotation(&host, run_id)?,
            },
            "models": merged.iter().map(ModelOption::json).collect::<Vec<_>>(),
            "thinkingLevels": levels,
            "capabilities": {
                "model": model_capability,
                "thinking": thinking_capability,
            },
        }))
    }

    /// `run.agent.set {runId, model?, thinkingLevel?}` → `{runId, applied, channel}`
    pub fn set_via_host(args: &Value) -> Result<Value, String> {
        let run_id = args
            .get("runId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "run.agent.set: runId required".to_string())?;
        let model = args.get("model").and_then(Value::as_str);
        let level = args.get("thinkingLevel").and_then(Value::as_str);
        let host = WasmHost;

        let record = crate::session::record_via_host(run_id)?
            .ok_or_else(|| format!("run.agent.set: run not found: {run_id}"))?;
        let agent = record.agent_id.clone().unwrap_or_default();
        if record.status.is_terminal() {
            return Err(Reason::RunEnded.message());
        }
        let profile =
            profile_for(&agent).ok_or_else(|| Reason::AgentUnsupported(agent.clone()).message())?;
        let (model, level) = validate_request(profile, model, level).map_err(|r| r.message())?;

        match profile.channel {
            ControlChannel::Bridge => {
                let now = crate::config::model::now_rfc3339();
                if !record.bridge_connected(&now) {
                    return Err(Reason::BridgeOffline.message());
                }
                let mut payload = serde_json::Map::new();
                if let Some(model) = model.as_deref() {
                    payload.insert("model".to_string(), json!(model));
                }
                if let Some(level) = level.as_deref() {
                    payload.insert("thinkingLevel".to_string(), json!(level));
                }
                crate::run::bridge::commands::enqueue(
                    &host,
                    run_id,
                    COMMAND_AGENT_CONTROL,
                    &Value::Object(payload),
                    &now,
                )?;
            }
            ControlChannel::Pty => {
                if let Some(reason) = pty_injection_guard(
                    record.pty_id.is_some(),
                    crate::session::has_pending_input(run_id),
                ) {
                    return Err(reason.message());
                }
                if agent == "codex" {
                    let min = parse_version(CODEX_INLINE_MIN_VERSION).unwrap_or((0, 0, 0));
                    let ok = codex_version(&host)
                        .map(|version| version_at_least(version, min))
                        .unwrap_or(false);
                    if !ok {
                        return Err(Reason::CodexUpdateRequired(
                            CODEX_INLINE_MIN_VERSION.to_string(),
                        )
                        .message());
                    }
                }
                let line = slash_line(&agent, model.as_deref(), level.as_deref())
                    .map_err(|reason| reason.message())?;
                if let Some(line) = line {
                    crate::session::input_via_pty(run_id, &line, None)?;
                }
            }
        }

        // 乐观写入当前值：桥接上行的真实值随后覆盖（人工在终端里改也经同一路径回落）
        if let Some(model) = model.as_deref() {
            crate::session::note_run_meta(run_id, None, None, Some(model))?;
        }
        if let Some(level) = level.as_deref() {
            crate::session::note_annotation(run_id, ANNOTATION_THINKING, level)?;
        }
        host.log_info(&format!(
            "run.agent.set (run={run_id}, agent={agent}, channel={}, model={model:?}, thinking={level:?})",
            profile.channel.as_str()
        ));
        Ok(json!({
            "runId": run_id,
            "agent": agent,
            "channel": profile.channel.as_str(),
            "applied": { "model": model, "thinkingLevel": level },
        }))
    }
}

#[cfg(target_arch = "wasm32")]
pub use host_impl::{catalog_via_host, options_via_host, set_via_host};

#[cfg(not(target_arch = "wasm32"))]
pub fn catalog_via_host(_args: &Value) -> Result<Value, String> {
    Err("agent catalog unavailable outside wasm runtime".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn options_via_host(_args: &Value) -> Result<Value, String> {
    Err("agent control unavailable outside wasm runtime".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn set_via_host(_args: &Value) -> Result<Value, String> {
    Err("agent control unavailable outside wasm runtime".to_string())
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_covers_four_agents_and_rejects_unknown() {
        for agent in ["pi", "opencode", "claude", "codex"] {
            assert!(profile_for(agent).is_some(), "{agent} 必须有画像");
        }
        assert!(profile_for("unknown").is_none());
        assert_eq!(profile_for("pi").unwrap().channel, ControlChannel::Bridge);
        assert_eq!(profile_for("claude").unwrap().channel, ControlChannel::Pty);
        assert!(
            profile_for("opencode").unwrap().thinking_levels.is_empty(),
            "opencode 等级由 variant 承载，不得谎称可切"
        );
    }

    #[test]
    fn version_parsing_handles_cli_shapes() {
        assert_eq!(parse_version("codex-cli 0.160.0"), Some((0, 160, 0)));
        assert_eq!(parse_version("0.164.1"), Some((0, 164, 1)));
        assert_eq!(parse_version("2.1.288 (Claude Code)"), Some((2, 1, 288)));
        assert_eq!(parse_version("no digits here"), None);
        assert!(version_at_least((0, 164, 0), (0, 164, 0)));
        assert!(!version_at_least((0, 160, 0), (0, 164, 0)));
    }

    #[test]
    fn pi_catalog_parsing_skips_header_and_log_lines() {
        let stdout = "\
[retry-cap] installed: something
provider     model                         context  max-out  thinking  images
amd          DeepSeek-V4.1-Flash           1.0M     65.5K    yes       yes
opencode     claude-opus-4-5               200K     64K      yes       yes
";
        let models = parse_pi_models(stdout);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].value, "amd/DeepSeek-V4.1-Flash");
        assert_eq!(models[1].value, "opencode/claude-opus-4-5");
        assert!(models.iter().all(|m| m.source == "catalog"));
    }

    #[test]
    fn opencode_catalog_parsing_keeps_provider_prefixed_models() {
        let stdout = "\
gmi/openai/gpt-5\nopencode-go/deepseek-v4.1-flash\nopencode-go/deepseek-v4.1-flash\nnot-a-model\n\n";
        let models = parse_opencode_models(stdout);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].value, "gmi/openai/gpt-5");
        assert_eq!(models[1].value, "opencode-go/deepseek-v4.1-flash");
        assert!(models.iter().all(|m| m.source == "catalog"));
        assert!(parse_opencode_models("").is_empty());
    }

    #[test]
    fn codex_catalog_parsing_reads_slugs_and_levels() {
        let stdout = r#"{"models":[{"slug":"gpt-6-astra","display_name":"GPT-6-Astra","visibility":"list","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}]},{"slug":"hidden-one","visibility":"hidden","supported_reasoning_levels":[{"effort":"ultra"}]}]}"#;
        let models = parse_codex_models(stdout);
        assert_eq!(models.len(), 1, "hidden 模型不进清单");
        assert_eq!(models[0].value, "gpt-6-astra");
        assert!(models[0].label.contains("GPT-6-Astra"));
        assert_eq!(parse_codex_levels(stdout), vec!["low", "high"]);
        assert!(parse_codex_models("not json").is_empty());
    }

    #[test]
    fn safe_token_rejects_injection_surface() {
        assert!(safe_token("opencode-go/deepseek-v4.1-flash"));
        assert!(!safe_token(""));
        assert!(!safe_token("a b"));
        assert!(!safe_token("a\rb"));
        assert!(!safe_token("a\nb"));
        assert!(!safe_token(&"x".repeat(129)));
    }

    #[test]
    fn slash_lines_are_agent_specific() {
        assert_eq!(
            slash_line("claude", Some("opus"), None).unwrap(),
            Some("/model opus\r".to_string())
        );
        assert_eq!(
            slash_line("claude", None, Some("high")).unwrap(),
            Some("/effort high\r".to_string())
        );
        assert!(
            slash_line("claude", Some("opus"), Some("high")).is_err(),
            "claude 两项必须分两次提交（一次写两行会被 TUI 当粘贴）"
        );
        assert_eq!(
            slash_line("codex", Some("gpt-6-astra"), Some("xhigh")).unwrap(),
            Some("/model gpt-6-astra --reasoning xhigh\r".to_string())
        );
        assert_eq!(
            slash_line("codex", None, Some("low")).unwrap(),
            Some("/model --reasoning low\r".to_string())
        );
        assert_eq!(slash_line("claude", None, None).unwrap(), None);
        assert!(
            slash_line("pi", Some("m"), None).is_err(),
            "bridge agent 无斜杠命令"
        );
    }

    #[test]
    fn validate_request_enforces_whitelist_and_charset() {
        let pi = profile_for("pi").unwrap();
        assert_eq!(
            validate_request(pi, Some("amd/DeepSeek-V4.1-Flash"), Some("high")).unwrap(),
            (
                Some("amd/DeepSeek-V4.1-Flash".to_string()),
                Some("high".to_string())
            )
        );
        assert_eq!(
            validate_request(pi, None, None).unwrap_err(),
            Reason::InvalidValue
        );
        assert_eq!(
            validate_request(pi, Some("bad model"), None).unwrap_err(),
            Reason::InvalidValue
        );
        assert_eq!(
            validate_request(pi, None, Some("ultra")).unwrap_err(),
            Reason::LevelUnknown("ultra".to_string())
        );

        let opencode = profile_for("opencode").unwrap();
        assert_eq!(
            validate_request(opencode, None, Some("high")).unwrap_err(),
            Reason::ThinkingUnsupported
        );
    }

    #[test]
    fn merge_models_dedupes_and_keeps_current_first() {
        let merged = merge_models(
            Some("amd/x"),
            vec![
                ModelOption {
                    value: "amd/x".to_string(),
                    label: "amd/x".to_string(),
                    source: "catalog",
                },
                ModelOption {
                    value: "amd/y".to_string(),
                    label: "amd/y".to_string(),
                    source: "catalog",
                },
            ],
            vec![
                "amd/y".to_string(),
                " preset-a ".to_string(),
                "bad model".to_string(),
            ],
        );
        assert_eq!(
            merged.iter().map(|m| m.value.as_str()).collect::<Vec<_>>(),
            vec!["amd/x", "amd/y", "preset-a"]
        );
        assert_eq!(merged[0].source, "current");
        assert_eq!(merged[1].source, "catalog");
        assert_eq!(merged[2].source, "preset");
    }

    #[test]
    fn reason_codes_are_stable() {
        assert_eq!(Reason::RunEnded.code(), "run-ended");
        assert_eq!(Reason::BridgeOffline.code(), "bridge-offline");
        assert_eq!(
            Reason::CodexUpdateRequired("0.164.0".to_string()).code(),
            "codex-update-required"
        );
        assert!(Reason::CodexUpdateRequired("0.164.0".to_string())
            .message()
            .contains("0.164.0"));
    }

    #[test]
    fn pty_injection_guard_rejects_missing_pty_and_unsubmitted_drafts() {
        assert_eq!(pty_injection_guard(false, false), Some(Reason::NoPty));
        assert_eq!(pty_injection_guard(true, true), Some(Reason::InputBusy));
        assert_eq!(pty_injection_guard(true, false), None);
        assert_eq!(Reason::InputBusy.code(), "input-busy");
        assert!(Reason::InputBusy.message().contains("draft"));
    }
}
