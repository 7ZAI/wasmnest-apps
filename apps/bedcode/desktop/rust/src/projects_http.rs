//! 项目 / 运行 / Agent 的移动端 REST 面（`/api/projects`、`/api/runs*`、`/api/agents`）
//!
//! 桌面以项目为一级容器后，移动端是「项目 → 运行 → 终端」的消费者：它需要
//! 项目列表、项目内运行列表、启动运行与 agent 清单。**项目写面不在本模块开放**：
//! 建项目 / 改名 / 删除 / 选目录需要桌面侧目录选择与用户确认，移动端只是消费者
//! （与 issue #23「移动端不在本 spec 范围内」的边界一致，但补上项目视角所需的读面
//! 与运行启动）。
//!
//! 响应口径与 [`crate::sessions_http`] 逐项一致：成功 `{code:0, message:"ok",
//! data:…}` + HTTP 200；业务失败 **HTTP 200 + `{code:1002, message}`**（旧控制器的
//! 错误口径——**不是** `http_response::error(4xx, …)`，那会把 HTTP 状态码一起改掉，
//! 移动端 `classify_http_response` 按 code 分支时会拿到两套语义）。
//!
//! **形状真源不复制**：项目视图直接复用 `project::list_via_host` 的
//! `project::ops::view_json`；运行视图复用 `session::list_runs_via_host` 的
//! `session::view::run_json`；agent 清单复用 hub 注册表 + 探测状态。本模块只做
//! 「HTTP 分派 + 移动端需要的合并形状」，不另写第二份投影。

use crate::WasmHost;
use serde_json::Value;
use wasmnest_plugin_api::host::HostLog;
use wasmnest_plugin_api::http_response;

/// 内部端点段（`_http_endpoint` 分派键；host 模板在 `http_routes`）
pub const PROJECTS_HTTP_PATHS: &[&str] = &["projects", "runs", "runs/start", "agents"];

/// 旧控制器的错误信封：HTTP 200 + `{code:1002, message}`（业务码而非 HTTP 码）
fn projects_error(message: &str) -> Value {
    serde_json::json!({ "status": 200, "body": { "code": 1002, "message": message } })
}

/// 项目 / 运行 / Agent 的移动端 REST 分派入口（path 全等匹配）
///
/// `device` = JWT claims 派生的调用方设备（与 sessions REST 同一份）。它只被
/// `runs/start` 消费：启动端就是正统渲染端的初始归属，必须与 resize 路径同源。
#[allow(clippy::too_many_arguments)]
pub fn handle_projects_http(
    host: &WasmHost,
    method: &str,
    path: &str,
    body: &Value,
    query: &Value,
    device: &Value,
) -> Value {
    match path {
        "projects" => list_projects(host, method),
        "runs" => list_runs(host, method, query),
        "runs/start" => start_run(host, method, body, device),
        "agents" => list_agents(host, method),
        _ => http_response::error(404, &format!("Unknown project endpoint: {path}")),
    }
}

/// 启动运行入参 + 调用方设备 → `run.start` 入参
///
/// 设备名**只取自 JWT**（`sessions_http::device_name`），body 里客户端自报的
/// `sourceDevice` 被覆盖——否则任何已认证设备都能把自己声称为正统端。
fn start_run_args(body: &Value, device: &Value) -> Value {
    let mut args = body.clone();
    let Some(object) = args.as_object_mut() else {
        return args;
    };
    match crate::sessions_http::device_name(device) {
        Some(name) => {
            object.insert("sourceDevice".to_string(), Value::String(name));
        }
        // 无设备名（桌面本机调用 / 未携带 claims）：显式删掉自报字段，
        // 让 `run.start` 走「缺省 = 桌面本地启动」的唯一口径
        None => {
            object.remove("sourceDevice");
        }
    }
    args
}

/// 项目列表（GET /api/projects）→ `{projects: ProjectView[]}`（后端已按最近活动倒序）
fn list_projects(host: &WasmHost, method: &str) -> Value {
    if method != "GET" {
        return http_response::error(405, &format!("Method not allowed: {method}"));
    }
    match crate::project::list_via_host() {
        Ok(data) => http_response::ok_with_data(data),
        Err(e) => {
            host.log_warn(&format!("projects http: {e}"));
            projects_error(&e)
        }
    }
}

/// 运行列表（GET /api/runs?projectId=…）→ `{runs: RunView[]}`
///
/// `projectId` 缺省 / 空串 = 全部运行（与命令面 `run.list` 同语义）；移动端项目
/// 详情页始终带 projectId，全量口径留给排障与后续复用。
fn list_runs(host: &WasmHost, method: &str, query: &Value) -> Value {
    if method != "GET" {
        return http_response::error(405, &format!("Method not allowed: {method}"));
    }
    let project_id = query
        .get("projectId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match crate::session::list_runs_via_host(project_id) {
        Ok(data) => http_response::ok_with_data(data),
        Err(e) => {
            host.log_warn(&format!("runs http: {e}"));
            projects_error(&e)
        }
    }
}

/// 启动运行（POST /api/runs/start，body `{projectId, agentId, cols?, rows?}`）
/// → `{runId, name, configId}`
///
/// 必填项在这里先显性校验：空 projectId / agentId 直接拒绝，不让错误落成
/// `run.start: unknown agent: ` 这种半截文案（移动端会原样展示 message）。
/// 调用方设备名从 JWT 注入（见 [`start_run_args`]），移动端自己启动的运行
/// 因此归移动端为正统渲染端。
fn start_run(host: &WasmHost, method: &str, body: &Value, device: &Value) -> Value {
    if method != "POST" {
        return http_response::error(405, &format!("Method not allowed: {method}"));
    }
    for key in ["projectId", "agentId"] {
        let present = body
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        if !present {
            return projects_error(&format!("{key} required"));
        }
    }
    match crate::run::start_via_host(&start_run_args(body, device)) {
        Ok(data) => http_response::ok_with_data(data),
        Err(e) => {
            host.log_warn(&format!("runs start http: {e}"));
            projects_error(&e)
        }
    }
}

/// Agent 清单（GET /api/agents）→ `{agents: [{id, displayName, binary, readiness}]}`
///
/// `readiness` 三态与桌面项目工作台同源：`ready`（探测确认已装）/ `missing`
/// （确认未装）/ `unknown`（无结论，允许尝试启动）。探测状态读取失败**不阻断**
/// 清单：注册表仍可用，全部按 `unknown` 返回（与桌面 `loadAgents` 同口径）。
fn list_agents(host: &WasmHost, method: &str) -> Value {
    if method != "GET" {
        return http_response::error(405, &format!("Method not allowed: {method}"));
    }
    let listed = match crate::hub::invoke_command("agent.list-agents", serde_json::json!({})) {
        Ok(value) => value,
        Err(e) => {
            host.log_warn(&format!("agents http: {e}"));
            return projects_error(&e.to_string());
        }
    };
    let state = crate::hub::invoke_command("agent.get-state", serde_json::json!({}))
        .unwrap_or_else(|e| {
            host.log_warn(&format!("agents http: detection state unavailable: {e}"));
            Value::Null
        });
    http_response::ok_with_data(serde_json::json!({ "agents": agent_views(&listed, &state) }))
}

/// 注册表 + 探测状态 → 移动端 agent 条目（纯函数，native 可测）
fn agent_views(listed: &Value, state: &Value) -> Vec<Value> {
    let clis = state.get("state").and_then(|value| value.get("clis"));
    listed
        .get("agents")
        .and_then(Value::as_array)
        .map(|agents| {
            agents
                .iter()
                .filter_map(|agent| {
                    let id = agent.get("id").and_then(Value::as_str)?;
                    let display_name = agent
                        .get("displayName")
                        .and_then(Value::as_str)
                        .unwrap_or(id);
                    let binary = agent.get("binary").and_then(Value::as_str).unwrap_or(id);
                    let status = clis
                        .and_then(|clis| clis.get(id))
                        .and_then(|entry| entry.get("status"))
                        .and_then(Value::as_str);
                    Some(serde_json::json!({
                        "id": id,
                        "displayName": display_name,
                        "binary": binary,
                        "readiness": readiness_of(status),
                    }))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 探测状态 → 就绪度（与桌面 `useProjects.readinessOf` 同判据）
fn readiness_of(status: Option<&str>) -> &'static str {
    match status {
        Some("ok") => "ready",
        Some("not-installed") => "missing",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 业务失败信封：HTTP 200 + code 1002（移动端按 code 分支的契约）
    #[test]
    fn business_error_is_http_200_with_code_1002() {
        let value = projects_error("boom");
        assert_eq!(value["status"], 200);
        assert_eq!(value["body"]["code"], 1002);
        assert_eq!(value["body"]["message"], "boom");
        assert!(value["body"].get("data").is_none());
    }

    /// 三态映射：ok → ready，not-installed → missing，其余（含缺状态）→ unknown
    #[test]
    fn readiness_maps_three_states() {
        assert_eq!(readiness_of(Some("ok")), "ready");
        assert_eq!(readiness_of(Some("not-installed")), "missing");
        assert_eq!(readiness_of(Some("detecting")), "unknown");
        assert_eq!(readiness_of(Some("unavailable")), "unknown");
        assert_eq!(readiness_of(None), "unknown");
    }

    /// agent 视图：注册表字段 + 探测就绪度合并；缺展示名/二进制时退回 id
    #[test]
    fn agent_views_merge_registry_and_detection() {
        let listed = serde_json::json!({
            "agents": [
                { "id": "pi", "displayName": "Pi", "binary": "pi" },
                { "id": "claude" },
                { "id": "opencode", "displayName": "OpenCode", "binary": "opencode" },
            ]
        });
        let state = serde_json::json!({
            "state": { "clis": { "pi": { "status": "ok" }, "opencode": { "status": "not-installed" } } }
        });

        let views = agent_views(&listed, &state);
        assert_eq!(views.len(), 3);
        assert_eq!(views[0]["readiness"], "ready");
        assert_eq!(views[1]["displayName"], "claude");
        assert_eq!(views[1]["binary"], "claude");
        assert_eq!(views[1]["readiness"], "unknown");
        assert_eq!(views[2]["readiness"], "missing");
    }

    /// 探测状态缺失 / 畸形：清单照常返回，就绪度一律 unknown（不阻断列表）
    #[test]
    fn agent_views_tolerate_missing_detection_state() {
        let listed = serde_json::json!({ "agents": [{ "id": "pi" }] });
        for state in [
            serde_json::Value::Null,
            serde_json::json!({}),
            serde_json::json!({ "state": {} }),
        ] {
            let views = agent_views(&listed, &state);
            assert_eq!(views.len(), 1);
            assert_eq!(views[0]["readiness"], "unknown");
        }
    }

    /// 注册表畸形（非数组 / 缺 id）不产出半成品条目
    #[test]
    fn agent_views_skip_malformed_entries() {
        let listed = serde_json::json!({ "agents": [{ "displayName": "no id" }, { "id": "pi" }] });
        let views = agent_views(&listed, &serde_json::Value::Null);
        assert_eq!(views.len(), 1);
        assert_eq!(views[0]["id"], "pi");

        assert!(agent_views(&serde_json::json!({}), &serde_json::Value::Null).is_empty());
        assert!(agent_views(
            &serde_json::json!({ "agents": "nope" }),
            &serde_json::Value::Null
        )
        .is_empty());
    }

    /// 方法守卫：GET 端点收到 POST 直接 405，不进入 wasm 取数
    #[test]
    fn method_guards_reject_wrong_methods() {
        let host = WasmHost;
        let body = serde_json::json!({});
        let query = serde_json::json!({});
        let device = serde_json::json!({});

        for path in ["projects", "runs", "agents"] {
            let value = handle_projects_http(&host, "POST", path, &body, &query, &device);
            assert_eq!(value["status"], 405, "path={path}");
        }
        let value = handle_projects_http(&host, "GET", "runs/start", &body, &query, &device);
        assert_eq!(value["status"], 405);
    }

    /// 启动入参的设备名只取 JWT：客户端自报的 `sourceDevice` 必须被覆盖/剔除
    ///
    /// 回归 2026-11-10 P0-1：移动端启动项目运行不带设备名 → 正统端被登记为
    /// 桌面 → 手机首次 resize 被 `needsConfirmation` 拒绝，PTY 停在 120×40。
    #[test]
    fn start_run_args_take_device_from_jwt_only() {
        let body = serde_json::json!({
            "projectId": "p-1",
            "agentId": "pi",
            "cols": 52,
            "rows": 60,
            "sourceDevice": "spoofed"
        });

        let args = start_run_args(&body, &serde_json::json!({ "deviceName": "Pixel 9" }));
        assert_eq!(args["sourceDevice"], "Pixel 9", "JWT 设备名覆盖自报值");
        assert_eq!(args["cols"], 52);
        assert_eq!(args["rows"], 60);

        let plain = start_run_args(&body, &serde_json::json!({}));
        assert!(
            plain.get("sourceDevice").is_none(),
            "无 JWT 设备名 → 桌面本地口径"
        );

        // 空设备名与缺字段同口径
        let empty = start_run_args(&body, &serde_json::json!({ "deviceName": "  " }));
        assert!(empty.get("sourceDevice").is_none());
    }

    /// 非对象 body（错误调用）原样返回，不在适配层 panic
    #[test]
    fn start_run_args_tolerate_non_object_body() {
        let args = start_run_args(&serde_json::json!("nope"), &serde_json::json!({}));
        assert_eq!(args, serde_json::json!("nope"));
    }

    /// 启动运行的必填校验：空串 / 缺键直接 200 + code 1002，不落 run.start
    #[test]
    fn start_run_requires_project_and_agent() {
        let host = WasmHost;
        for body in [
            serde_json::json!({}),
            serde_json::json!({ "projectId": "", "agentId": "pi" }),
            serde_json::json!({ "projectId": "p-1", "agentId": "  " }),
        ] {
            let value = handle_projects_http(
                &host,
                "POST",
                "runs/start",
                &body,
                &serde_json::json!({}),
                &serde_json::json!({}),
            );
            assert_eq!(value["status"], 200);
            assert_eq!(value["body"]["code"], 1002);
            assert!(value["body"]["message"]
                .as_str()
                .unwrap()
                .contains("required"));
        }
    }
}
