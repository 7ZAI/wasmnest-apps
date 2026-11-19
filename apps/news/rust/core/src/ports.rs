//! 端口 trait：双端差异面与外部能力的唯一落点。
//!
//! 纪律：
//!
//! - 双端都有的原语（出网、插件库、时钟、日志、事件）**不给默认实现**——少实现对
//!   一端就是编译错误，而不是运行期静默成功；
//! - 只在一端成立的端口（定时器、系统剪贴板、助手代抓）给默认实现，语义是
//!   [`PortError::unsupported`]：**「本端不支持」而不是「假装成功」**；
//! - 错误只带稳定错误码，细节由产生方给；核内不读系统时钟、不直接出网。

use crate::domain::RawItem;

/// 端口错误的稳定形状：`code` 是分类码（前端 i18n key），`detail` 是给人看的原因。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortError {
    code: String,
    detail: Option<String>,
}

impl PortError {
    /// 只带分类码。
    pub fn new(code: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: None,
        }
    }

    /// 分类码 + 一句原因。
    pub fn with_detail(code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: Some(detail.into()),
        }
    }

    /// 本端不支持该原语。
    pub fn unsupported(port: &str) -> Self {
        Self::with_detail("port.unsupported", format!("{port} is not available on this platform"))
    }

    /// 分类码（前端据此取文案）。
    pub fn code(&self) -> &str {
        &self.code
    }

    /// 细节（可能为空）。
    pub fn detail(&self) -> &str {
        self.detail.as_deref().unwrap_or("")
    }
}

impl std::fmt::Display for PortError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(detail) if !detail.is_empty() => write!(f, "{}: {}", self.code, detail),
            _ => f.write_str(&self.code),
        }
    }
}

impl std::error::Error for PortError {}

/// 出网请求（只经宿主 HTTP 代理）。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FetchRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

/// 宿主代发的响应。非 2xx 也是 `Ok`（状态码交给调用方分类）。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FetchResponse {
    pub status: u16,
    pub body: String,
    pub headers: Vec<(String, String)>,
}

impl FetchResponse {
    /// 不区分大小写取响应头。
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// 出网统一入口：应用内不开 socket。
pub trait FetchPort {
    /// 发起一次请求。网络 / 授权失败返回分类错误码，HTTP 状态码在 `Ok` 里。
    fn fetch(&self, request: FetchRequest) -> Result<FetchResponse, PortError>;
}

/// 插件私有库（`plugin.db`）。
///
/// 宿主 `execute` 只执行单条语句、无事务包装；多语句要么逐条发，要么走
/// `execute_batch`（宿主保证整批提交 / 整批回滚）。
pub trait DbPort {
    /// 单条写语句，返回受影响行数。
    fn execute(&self, sql: &str) -> Result<i32, PortError>;

    /// 参数绑定写语句。
    fn execute_params(&self, sql: &str, params: &[serde_json::Value]) -> Result<i32, PortError>;

    /// 事务批。
    fn execute_batch(&self, sqls: &[String]) -> Result<i32, PortError>;

    /// 查询，返回行数组（无结果 = 空数组）。
    fn query(&self, sql: &str) -> Result<Vec<serde_json::Value>, PortError>;

    /// 参数绑定查询。
    fn query_params(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<Vec<serde_json::Value>, PortError>;
}

/// 显式时钟：核内不读系统时钟，时间一律由调用方或本端口给出。
pub trait ClockPort {
    /// 当前 Unix 毫秒。
    fn now_ms(&self) -> Result<i64, PortError>;
}

/// 周期调度。移动端无宿主定时器 → 默认 unsupported。
pub trait SchedulePort {
    /// 注册（替换）周期定时器；到点调用 `command`。
    fn register_interval(&self, _interval_secs: u64, _command: &str) -> Result<(), PortError> {
        Err(PortError::unsupported("timer.register"))
    }
}

/// 系统剪贴板（写入）。移动端无后端 → 默认 unsupported，前端回退到
/// `navigator.clipboard`。
pub trait ClipboardPort {
    /// 写入文本到系统剪贴板。
    fn write_text(&self, _text: &str) -> Result<(), PortError> {
        Err(PortError::unsupported("clipboard.write"))
    }
}

/// 宿主日志。
pub trait LogPort {
    fn log_info(&self, message: &str);
    fn log_warn(&self, message: &str);
    fn log_error(&self, message: &str);
}

/// 宿主事件（推给前端）。
pub trait EventPort {
    fn emit(&self, name: &str, payload: &serde_json::Value);
}

/// 助手代抓（反向面）。
///
/// 当前宿主助手没有对外抓取能力，v1 实现固定返回
/// `assistant.fetch-unavailable`；界面必须显式提示，不得静默降级为普通 HTTP。
pub trait AssistantBridge {
    /// 请求助手按期望结构抓取并解析。
    fn request_fetch(
        &self,
        _url: &str,
        _expected_schema: &str,
    ) -> Result<Vec<RawItem>, PortError> {
        Err(PortError::with_detail(
            "assistant.fetch-unavailable",
            "the host assistant does not expose a fetch capability",
        ))
    }
}

/// 一次命令执行所需的全部端口。
///
/// 用 trait object 而不是泛型参数：端口有 8 个，泛型会让命令面签名爆炸，而
/// 这些调用都不在热路径上（一次刷新 = 每源一次出网）。
pub struct Ports<'a> {
    pub fetch: &'a dyn FetchPort,
    pub db: &'a dyn DbPort,
    pub clock: &'a dyn ClockPort,
    pub schedule: &'a dyn SchedulePort,
    pub clipboard: &'a dyn ClipboardPort,
    pub log: &'a dyn LogPort,
    pub events: &'a dyn EventPort,
    pub assistant: &'a dyn AssistantBridge,
}
