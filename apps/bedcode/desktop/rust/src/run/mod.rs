//! 运行域（ADR 0003：运行 = 一次 agent 进程启动及其全部对话）
//!
//! M2 只承担一件事：**从项目里启动一条运行**（`run.start`）。选 agent 成为
//! 「一次运行的决定」而不是「一条配置」——用户不必先建配置再启动：项目给出
//! （执行环境 + 目录），本域按 `(环境, 目录, agent 二进制)` 取或建一条启动参数
//! （`session_configs` 已降级为「项目 × agent 的启动参数」），再交给既有的
//! [`crate::launch::create_via_host`] 完成命名唯一化 / shell 包装 / PTY spawn /
//! 登记 / 事件广播。
//!
//! **为什么不另写一条启动链**：PTY 生命周期（spawn → 登记 → 回滚 → 广播）已经
//! 在 `launch` 域实现且被 `session.create` / `session.action.restart` 共用；这里
//! 再写一遍就是第二套生命周期，两处必然漂移。本域只做「项目 → 配置」的参数
//! 准备，启动仍然只有一条路径。
//!
//! **agent 二进制从注册表取**（`hub::binary_for`）：agent id → 命令名是后端唯一
//! 真源，前端不再维护第二份映射；未知 id 显性拒绝，不猜一个命令名去执行。

pub mod bridge;
pub mod events;
pub mod plan;

#[cfg(target_arch = "wasm32")]
use crate::config::store::ConfigStore;
#[cfg(target_arch = "wasm32")]
use crate::project::store::ProjectStore;
#[cfg(target_arch = "wasm32")]
use plan::{find_config, new_config, StartRequest};
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::wasm_host::WasmHost;

/// `run.start` 编排：`{projectId, agentId, cols?, rows?}` → `{runId, name, configId}`
///
/// 失败一律显性（未知项目 / 未注册 agent / 配置写入失败 / PTY 启动失败），不返回
/// 半成品 id——前端拿到 id 就会去开终端，幽灵 runId 等于一个永远空的终端页签。
#[cfg(target_arch = "wasm32")]
pub fn start_via_host(args: &serde_json::Value) -> Result<serde_json::Value, String> {
    let request = StartRequest::parse(args)?;
    let binary = crate::hub::binary_for(&request.agent_id)
        .ok_or_else(|| format!("run.start: unknown agent: {}", request.agent_id))?;
    let project = ProjectStore::get(&WasmHost, &request.project_id)?
        .ok_or_else(|| format!("run.start: project not found: {}", request.project_id))?;

    // 同一项目里同一 agent 反复启动复用同一条配置：配置是启动参数，不是导航对象
    let config = match find_config(
        &ConfigStore::all(&WasmHost)?,
        &project.environment,
        &project.working_dir,
        binary,
    ) {
        Some(existing) => existing.clone(),
        None => {
            let created = new_config(
                &crate::config::model::new_config_id()?,
                &project.name,
                &project.environment,
                project.wsl_distro.as_deref(),
                &project.working_dir,
                binary,
                &crate::config::model::now_rfc3339(),
            );
            ConfigStore::put(&WasmHost, &created)?;
            created
        }
    };

    // 启动仍走唯一那条链（`start: true` 是它唯一支持的形态）
    let launched = crate::launch::create_via_host(&serde_json::json!({
        "configId": config.id,
        "cols": request.cols,
        "rows": request.rows,
        "start": true,
    }))?;
    let run_id = launched
        .get("sessionId")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "run.start: launch returned no run id".to_string())?
        .to_string();

    // 名字回读自运行视图（`launch` 里做过唯一化，前端不能自己拼）；读失败只影响
    // 终端窗口标题，**不能**把已启动的运行报成启动失败（那样用户会再点一次，
    // 变成两条运行）。故此处吞掉读错误、退回项目名。
    let name = crate::session::view_via_host(&run_id)
        .ok()
        .flatten()
        .and_then(|view| view.get("name").and_then(|v| v.as_str()).map(str::to_string))
        .unwrap_or_else(|| project.name.clone());

    Ok(serde_json::json!({
        "runId": run_id,
        "name": name,
        "configId": config.id,
    }))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn start_via_host(_args: &serde_json::Value) -> Result<serde_json::Value, String> {
    Err("run start unavailable outside wasm runtime".to_string())
}
