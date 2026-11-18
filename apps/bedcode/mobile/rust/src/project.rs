//! 项目 / 运行 / Agent 域（移动端消费面，ADR 0003）
//!
//! 桌面端把一级容器从「终端会话」换成「项目」后，移动端随之从「会话配置列表」
//! 改为「项目 → 运行 → 终端」：
//! - 项目列表（`GET /api/projects`）与项目内运行（`GET /api/runs?projectId=…`）
//!   是只读消费面；
//! - 启动运行（`POST /api/runs/start`，`{projectId, agentId, cols?, rows?}`）是
//!   唯一写入口——项目自身的写面（建 / 改名 / 删除 / 选目录）需要桌面目录选择，
//!   不在移动端开放；
//! - Agent 清单（`GET /api/agents`）给出可启动项与就绪度（`ready` / `missing` /
//!   `unknown`），缺失项由界面显性标注，不伪造可启动态。
//!
//! **HTTP 信封与失败语义不复制**：仍走 [`crate::session::http_call`]（JWT 由宿主
//! 代注；成功 `{code:0,message:"ok",data}`；业务失败 HTTP 200 + `{code:1002}`；
//! 网络层失败命令 Err）。本模块只做端点字面量、查询串与请求体构造，形状真源
//! 在桌面端 `project::ops::view_json` / `session::view::run_json` / `projects_http`。

use serde_json::Value;

use crate::session::http_call;

/// 内部端点字面量（与桌面 `http_routes` 的业务别名逐字一致；d10 契约锁点）
pub(crate) const PATH_PROJECTS: &str = "/api/projects";
pub(crate) const PATH_RUNS: &str = "/api/runs";
pub(crate) const PATH_RUNS_START: &str = "/api/runs/start";
pub(crate) const PATH_AGENTS: &str = "/api/agents";

// ==================== 命令实现 ====================

/// 项目列表（`GET /api/projects`）→ `{code:0, data:{projects: ProjectView[]}}`
pub(crate) fn list_projects() -> anyhow::Result<Value> {
    http_call("project", "GET", PATH_PROJECTS, None)
}

/// 运行列表（`GET /api/runs?projectId=…`）→ `{code:0, data:{runs: RunView[]}}`
///
/// `projectId` 缺省 = 全部运行（与桌面 `run.list` 同语义）；项目详情页始终带 id。
pub(crate) fn list_runs(args: &Value) -> anyhow::Result<Value> {
    let project_id = args
        .get("projectId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    http_call("project", "GET", &runs_path(project_id), None)
}

/// 启动运行（`POST /api/runs/start`）→ `{code:0, data:{runId, name, configId}}`
///
/// 必填项先在本端显性校验：空 projectId / agentId 不落成桌面端
/// `run.start: projectId required` 这种半截文案（前端会原样展示 message）。
pub(crate) fn start_run(args: &Value) -> anyhow::Result<Value> {
    let project_id = require_non_empty(args, "projectId")?;
    let agent_id = require_non_empty(args, "agentId")?;
    let cols = positive_u64(args, "cols");
    let rows = positive_u64(args, "rows");
    http_call(
        "project",
        "POST",
        PATH_RUNS_START,
        Some(build_start_body(&project_id, &agent_id, cols, rows)),
    )
}

/// Agent 清单（`GET /api/agents`）→ `{code:0, data:{agents: AgentEntry[]}}`
pub(crate) fn list_agents() -> anyhow::Result<Value> {
    http_call("project", "GET", PATH_AGENTS, None)
}

// ==================== 纯函数（native 单测锚点） ====================

/// 运行列表路径：`projectId` 缺省 = `/api/runs`，否则带查询串（值做百分号编码）
pub(crate) fn runs_path(project_id: Option<&str>) -> String {
    match project_id.map(str::trim).filter(|value| !value.is_empty()) {
        Some(id) => format!("{PATH_RUNS}?projectId={}", encode_query_component(id)),
        None => PATH_RUNS.to_string(),
    }
}

/// 启动运行 body：`projectId` / `agentId` 必填；`cols` / `rows` 仅有效时出现
/// （与桌面 `run::plan::StartRequest::parse` 的宽容口径一致：缺省由宿主取默认网格）
pub(crate) fn build_start_body(
    project_id: &str,
    agent_id: &str,
    cols: Option<u64>,
    rows: Option<u64>,
) -> Value {
    let mut body = serde_json::Map::new();
    body.insert(
        "projectId".to_string(),
        Value::String(project_id.to_string()),
    );
    body.insert("agentId".to_string(), Value::String(agent_id.to_string()));
    if let Some(cols) = cols {
        body.insert("cols".to_string(), serde_json::json!(cols));
    }
    if let Some(rows) = rows {
        body.insert("rows".to_string(), serde_json::json!(rows));
    }
    Value::Object(body)
}

/// 查询串值编码（RFC 3986 unreserved 之外的字节一律 `%XX`；空格编码为 `%20`）。
///
/// 项目 id 当前是受控短串，但查询串属于线协议——目录 id、未来可读 slug 都可能
/// 带空格或 `&`，此处按组件编码而不是拼裸串。
pub(crate) fn encode_query_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 必填非空字符串（去首尾空白后为空即拒绝）
fn require_non_empty(args: &Value, key: &str) -> anyhow::Result<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("{key} required"))
}

/// 正整数可选项（0 / 非数值按缺省处理，避免把 0 列传给 PTY）
fn positive_u64(args: &Value, key: &str) -> Option<u64> {
    args.get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
}

// ==================== 单元测试（native；纯函数锚点，不触 host） ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 端点字面量与桌面业务别名逐字一致（d10 契约的移动端引用点）
    #[test]
    fn endpoint_literals_match_desktop_aliases() {
        assert_eq!(PATH_PROJECTS, "/api/projects");
        assert_eq!(PATH_RUNS, "/api/runs");
        assert_eq!(PATH_RUNS_START, "/api/runs/start");
        assert_eq!(PATH_AGENTS, "/api/agents");
    }

    /// 运行列表：无项目 = 全量；有项目 = 带查询串
    #[test]
    fn runs_path_shapes() {
        assert_eq!(runs_path(None), "/api/runs");
        assert_eq!(runs_path(Some("")), "/api/runs");
        assert_eq!(runs_path(Some("  ")), "/api/runs");
        assert_eq!(runs_path(Some("p-1")), "/api/runs?projectId=p-1");
    }

    /// 查询串编码：保留 unreserved，空格 / 分隔符转义
    #[test]
    fn query_component_encodes_reserved_bytes() {
        assert_eq!(encode_query_component("p-1_2.3~4"), "p-1_2.3~4");
        assert_eq!(encode_query_component("a b&c=d"), "a%20b%26c%3Dd");
        assert_eq!(encode_query_component("项目"), "%E9%A1%B9%E7%9B%AE");
    }

    /// 启动 body：尺寸缺省省略；有效尺寸透传
    #[test]
    fn start_body_omits_absent_or_invalid_size() {
        assert_eq!(
            build_start_body("p-1", "pi", None, None),
            serde_json::json!({ "projectId": "p-1", "agentId": "pi" })
        );
        assert_eq!(
            build_start_body("p-1", "opencode", Some(120), Some(30)),
            serde_json::json!({ "projectId": "p-1", "agentId": "opencode", "cols": 120, "rows": 30 })
        );
    }

    /// 必填校验：缺键 / 空串 / 全空白都被拒绝（错误里点名键）
    #[test]
    fn required_fields_reject_blank_values() {
        for args in [
            serde_json::json!({}),
            serde_json::json!({ "projectId": "", "agentId": "pi" }),
            serde_json::json!({ "projectId": "p-1", "agentId": "   " }),
            serde_json::json!({ "projectId": 1, "agentId": "pi" }),
        ] {
            let err = match (
                require_non_empty(&args, "projectId"),
                require_non_empty(&args, "agentId"),
            ) {
                (Err(e), _) => e.to_string(),
                (_, Err(e)) => e.to_string(),
                (Ok(_), Ok(_)) => panic!("blank fields must be rejected: {args}"),
            };
            assert!(err.contains("required"), "{err}");
        }
    }

    /// 尺寸只收正整数：0 / 负数 / 字符串一律按缺省处理
    #[test]
    fn positive_size_filters_zero_and_non_numbers() {
        let args = serde_json::json!({ "cols": 0, "rows": -3 });
        assert_eq!(positive_u64(&args, "cols"), None);
        assert_eq!(positive_u64(&args, "rows"), None);
        assert_eq!(
            positive_u64(&serde_json::json!({ "cols": "120" }), "cols"),
            None
        );
        assert_eq!(
            positive_u64(&serde_json::json!({ "cols": 120 }), "cols"),
            Some(120)
        );
    }
}
