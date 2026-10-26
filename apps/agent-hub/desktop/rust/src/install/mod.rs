//! 安装/更新与镜像域（票据 03）
//!
//! 职责：
//! - **测速**：host-http 对 npm 官方源与 npmmirror 各做一次小 GET 计时
//!   （计时用 `ConfigKey::CurrentTimeMs`——wasm32-unknown-unknown 无系统时钟，
//!   `Instant::now()` 会 panic），给出换源推荐
//! - **最新版本**：registry HTTP API `GET /<pkg>/latest`（免 shell，官方源失败
//!   回落 npmmirror），与探测到的本地版本比较得 outdated
//! - **一键安装/更新**：recipe 白名单构造（cli 名 + 固定模板，无用户自由输入
//!   拼接），host-process 平台分派执行（unix `bash -lc` / Windows `cmd /C`，
//!   unix 执行前经 [`exec_script`] 前缀 PATH 引导——登录 shell 不读 `~/.bashrc`，
//!   nvm 等 PATH 注入失效会让 npm 直接 127，与 detect 同源 pitfall），
//!   输出落盘供前端轮询回显；完成后自动触发全量重探测刷新卡片
//! - **持久换源**：改写 `{HomeDir}/.npmrc`（改前备份、UI 一键还原）；registry
//!   行之外的内容原样保留（含 authToken 行），文件内容不落日志
//!
//! # 模块结构
//! - [`state`]：域状态（host-storage `install` 键，读-改-写 + 全量推送）
//! - [`recipe`]：安装命令 recipe 白名单（纯函数）
//! - [`version`]：宽松语义化版本比较（纯函数）
//! - [`registry`]：测速与最新版本查询（host-http 免 shell）
//! - [`mirror`]：npmrc 持久换源与自定义源管理
//! - 本模块：安装/更新执行 lifecycle（spawn → 进程回灌 → 自动重探测）

use super::{host, pending, PendingRun, DATA_DIR, HOME, INSTALL_KEY};
use crate::agents;
use crate::detect;
use crate::detect::path_bootstrap_unix;
use crate::util::{is_windows, shell_invocation};
use wasmnest_plugin_api::events::ProcessDoneEvent;
use wasmnest_plugin_api::host::{HostFs, HostLog, HostProcess, HostStorage};
use wasmnest_plugin_api::wasm_host::WasmHost;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU32, Ordering as AtomicOrdering};

mod mirror;
pub(crate) mod recipe;
mod registry;
mod state;
mod version;

/// 命令入口面（lib.rs 路由）
pub(crate) use mirror::{add_custom_source, apply_mirror, remove_custom_source, restore_npmrc};
pub(crate) use registry::{check_updates, run_update_check, speed_test};
pub(crate) use state::now_ms;

use self::recipe::build_install_script;
use self::recipe::build_uninstall_script;
use self::state::{emit, emit_and_return, read_state, write_state};

/// 安装/更新超时：npm 全局安装含完整依赖下载，15 分钟上限（host 默认 10 分钟）
const INSTALL_TIMEOUT_MS: u64 = 900_000;

/// 执行前包装：unix 前缀 PATH 引导（登录 shell 不读 `~/.bashrc`，nvm 等 PATH
/// 注入在交互守卫内直接失效 → npm 未找到 exit 127，卸载/安装"完成"却毫无效果；
/// 与 detect 同源 pitfall，见 `detect::path_bootstrap_unix`）；Windows cmd /C
/// 读注册表用户 PATH 无需引导。仅影响实际执行的脚本——`state.active.command`
/// 仍存原始 recipe 供展示。
fn exec_script(script: String, windows: bool) -> String {
    // 引导出来的 node / npm 走脚本 env 前缀（PATH 前置 + npm_config_prefix）：
    // 装完 node 立刻能装 CLI，不需要重启应用把新 PATH 灌进宿主进程。
    // unix 的 PATH 引导会重写 PATH，故 env 前缀必须排在它之后。
    if windows {
        crate::env::prepend_env(script, true)
    } else {
        format!(
            "{}{}",
            path_bootstrap_unix(),
            crate::env::prepend_env(script, false)
        )
    }
}
/// 输出回显尾部截断：控制台只需尾部，限制 guest↔host 每次轮询的载荷
const OUTPUT_TAIL_BYTES: usize = 16 * 1024;

static RUN_SEQ: AtomicU32 = AtomicU32::new(0);

/// 是否有在途 CLI 安装/卸载（引导域互斥判定用：两域共享「同实例串行」语义）
pub(crate) fn is_active(h: &WasmHost) -> bool {
    read_state(h)["active"].is_object()
}

// ==================== 探测前置判定（三态口径） ====================

/// 探测状态 → 安装/卸载前置判定（纯函数，可测）
///
/// `unavailable` = **探测没结论**（进程失败 / 超时 / 输出不可解析），此时
/// method 恒为 `unknown`。但「没结论」与「确实不支持这种安装方式」对用户是
/// 两个完全不同的动作（先重试检测 vs 手动安装）——混成一句「unsupported
/// install method」会把用户引向错误的操作（2026-10-22 Windows 干净机实测：
/// 探测全线 unavailable 时安装页直接报「unsupported claude install method」）。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProbeGuard {
    /// 探测有结论：按 method 构造 recipe
    Proceed,
    /// 探测未完成：先重试检测（业务码 `hub.inst.error.probeUnavailable`）
    Unavailable,
}

/// 探测前置判定（纯函数）：只有 `unavailable`（无结论）才拦；`not-installed`
/// 与 `ok` 都是有效结论，照常按 method 构造命令
pub(crate) fn probe_guard(status: &str) -> ProbeGuard {
    match status {
        "unavailable" => ProbeGuard::Unavailable,
        _ => ProbeGuard::Proceed,
    }
}

/// 探测未完成时的用户可见拒绝（ADR 0030 业务码）
macro_rules! bail_probe_unavailable {
    () => {
        wasmnest_plugin_api::bail_with_code!("com.wasmnest.agent-hub.hub.inst.error.probeUnavailable")
    };
}

// ==================== 环境前置判定（node 三态口径） ====================

/// node 环境前置判定（纯函数，可测）
///
/// 缺 node + recipe 依赖 npm → 业务码 `hub.inst.error.nodeMissing`（前端据此
/// 弹链式引导）；standalone 的 CLI（官方自带 `upgrade`）不依赖 node，照常执行。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum NodeGuard {
    Proceed,
    /// 缺 node 且该安装方式需要 npm（用户可见拒绝）
    Missing,
}

/// 环境前置判定（纯函数）：`requires_node` 由适配器注册表给出（不信任前端传参）
pub(crate) fn node_guard(node_ok: bool, requires_node: bool) -> NodeGuard {
    if node_ok || !requires_node {
        NodeGuard::Proceed
    } else {
        NodeGuard::Missing
    }
}

// ==================== 安装/更新执行 ====================
// ==================== 安装/更新执行 ====================

/// 读取安装域状态（命令入口，前端挂载时拉取）
pub(crate) fn get_state(h: &WasmHost) -> anyhow::Result<Value> {
    Ok(json!({ "state": read_state(h) }))
}

/// 解析安装/更新命令供展示（node 环境缺失时的「生成命令 + 复制」降级路径）：
/// 与 start 同一 recipe 白名单与探测状态来源，仅无副作用、不做 node 兜底校验
pub(crate) fn describe_install(h: &WasmHost, args: &Value) -> anyhow::Result<Value> {
    let cli = args
        .get("cli")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("describe-install: missing cli"))?;
    if agents::get(cli).is_none() {
        return Err(anyhow::anyhow!("describe-install: unknown cli: {cli}"));
    }
    let use_mirror = args.get("mirror").and_then(|v| v.as_bool()).unwrap_or(true);

    let detection = h
        .storage_get(super::STATE_KEY)
        .map_err(|e| anyhow::anyhow!("describe-install: read detection failed: {e}"))?
        .ok_or_else(|| anyhow::anyhow!("describe-install: detection not ready"))?;
    let info = &detection["clis"][cli];
    let method = info["method"].as_str().unwrap_or("unknown");
    let installed = info["installed"].as_bool().unwrap_or(false);
    // 探测未完成（unavailable）：先重试检测，不得报成「不支持这种安装方式」
    if probe_guard(info["status"].as_str().unwrap_or("idle")) == ProbeGuard::Unavailable {
        bail_probe_unavailable!();
    }
    let (script, action) =
        build_install_script(cli, method, installed, use_mirror).map_err(anyhow::Error::msg)?;
    Ok(json!({ "command": script, "action": action }))
}

/// 触发安装/更新：recipe 白名单构造 → host-process 平台分派执行 →
/// 状态落 storage 推送前端；输出经 output_path 由前端轮询回显
pub(crate) fn start(h: &WasmHost, args: &Value) -> anyhow::Result<Value> {
    let cli = args
        .get("cli")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("install: missing cli"))?;
    let Some(agent) = agents::get(cli) else {
        return Err(anyhow::anyhow!("install: unknown cli: {cli}"));
    };
    let use_mirror = args.get("mirror").and_then(|v| v.as_bool()).unwrap_or(true);

    let mut state = read_state(h);
    if state["active"].is_object() {
        // 并发安装/更新（用户可见拒绝；ADR 0030 业务码，前端经插件 i18n 展示）
        wasmnest_plugin_api::bail_with_code!("com.wasmnest.agent-hub.hub.inst.error.busy");
    }
    // 与 Node.js 引导互斥：两域都写 PATH / 全局目录，串行才可解释
    if crate::env::is_active(h) {
        wasmnest_plugin_api::bail_with_code!("com.wasmnest.agent-hub.hub.inst.error.busy");
    }

    // method/installed 取自探测状态（不信任前端传参）；node 环境缺失时前端
    // 降级为展示命令，这里兜底拒绝——opencode standalone 例外：官方内置
    // `opencode upgrade` 自更新（curl 安装重跑官方脚本 / npm·pnpm 走包管理
    // 器），不依赖 node
    let detection = h
        .storage_get(super::STATE_KEY)
        .map_err(|e| anyhow::anyhow!("install: read detection failed: {e}"))?
        .ok_or_else(|| {
            // 探测未就绪（用户可见拒绝；ADR 0030 业务码）
            anyhow::anyhow!(wasmnest_plugin_api::user_facing_string(
                "com.wasmnest.agent-hub.hub.inst.error.detectionPending",
                serde_json::Value::Null,
            ))
        })?;
    let info = &detection["clis"][cli];
    let method = info["method"].as_str().unwrap_or("unknown");
    let installed = info["installed"].as_bool().unwrap_or(false);
    // 探测未完成（unavailable）：先重试检测（不是「node 缺失」也不是「方式未知」）
    if probe_guard(info["status"].as_str().unwrap_or("idle")) == ProbeGuard::Unavailable {
        bail_probe_unavailable!();
    }
    let node_ok = detection["env"]["node"].is_string();
    if node_guard(node_ok, agent.install_requires_node(method)) == NodeGuard::Missing {
        // 无 node 环境（用户可见拒绝；ADR 0030 业务码）：前端据此弹链式引导
        wasmnest_plugin_api::bail_with_code!("com.wasmnest.agent-hub.hub.inst.error.nodeMissing");
    }
    let (script, action) =
        build_install_script(cli, method, installed, use_mirror).map_err(anyhow::Error::msg)?;

    let data_dir = DATA_DIR
        .get()
        .ok_or_else(|| anyhow::anyhow!("install: data dir unavailable"))?;
    let seq = RUN_SEQ.fetch_add(1, AtomicOrdering::Relaxed);
    let output_path = format!("{data_dir}/runs/install-{cli}-{seq}.log");
    let (command, args_vec) =
        shell_invocation(exec_script(script.clone(), is_windows()), is_windows());
    let request = json!({
        "command": command,
        "args": args_vec,
        "output_path": output_path,
        "timeout_ms": INSTALL_TIMEOUT_MS,
    });
    let run_id = h
        .process_run(&request.to_string())
        .map_err(|e| anyhow::anyhow!("install: spawn failed: {e}"))?;

    pending()
        .lock()
        .map_err(|e| anyhow::anyhow!("install: poisoned pending map: {e}"))?
        .insert(
            run_id.clone(),
            PendingRun {
                kind: "install".to_string(),
                output_path: output_path.clone(),
                cli: Some(cli.to_string()),
                source: None,
            },
        );

    state["active"] = json!({
        "runId": run_id,
        "cli": cli,
        "action": action,
        "command": script,
        "useMirror": use_mirror,
        "outputPath": output_path,
        "startedAt": now_ms(h).unwrap_or(0),
        "cancelRequested": false,
    });
    write_state(h, &state);
    h.log_info(&format!(
        "install run started (cli = {cli}, action = {action}, mirror = {use_mirror})"
    ));
    emit_and_return(h, &state)
}

/// 触发卸载：recipe 白名单构造 → host-process 平台分派执行 → 状态落
/// storage 推送前端（与安装共用同一 run 管线：active 互斥、输出回显、取消、
/// 完成后自动重探测刷新卡片）。卸载是破坏性动作：只接受白名单 cli + 固定
/// 模板，method 取自探测状态（不信任前端传参）；npm-global 依赖 node。
pub(crate) fn uninstall(h: &WasmHost, args: &Value) -> anyhow::Result<Value> {
    let cli = args
        .get("cli")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("uninstall: missing cli"))?;
    let Some(agent) = agents::get(cli) else {
        return Err(anyhow::anyhow!("uninstall: unknown cli: {cli}"));
    };

    let mut state = read_state(h);
    if state["active"].is_object() {
        // 并发卸载（用户可见拒绝；ADR 0030 业务码）
        wasmnest_plugin_api::bail_with_code!("com.wasmnest.agent-hub.hub.inst.error.busy");
    }
    // 与 Node.js 引导互斥（同 start）
    if crate::env::is_active(h) {
        wasmnest_plugin_api::bail_with_code!("com.wasmnest.agent-hub.hub.inst.error.busy");
    }

    // method 取自探测状态（不信任前端传参）；npm-global 卸载依赖 node 环境
    let detection = h
        .storage_get(super::STATE_KEY)
        .map_err(|e| anyhow::anyhow!("uninstall: read detection failed: {e}"))?
        .ok_or_else(|| {
            // 探测未就绪（用户可见拒绝；ADR 0030 业务码）
            anyhow::anyhow!(wasmnest_plugin_api::user_facing_string(
                "com.wasmnest.agent-hub.hub.inst.error.detectionPending",
                serde_json::Value::Null,
            ))
        })?;
    let method = detection["clis"][cli]["method"]
        .as_str()
        .unwrap_or("unknown");
    // 探测未完成（unavailable）：先重试检测，不报成「不支持这种卸载方式」
    if probe_guard(detection["clis"][cli]["status"].as_str().unwrap_or("idle"))
        == ProbeGuard::Unavailable
    {
        bail_probe_unavailable!();
    }
    if node_guard(
        detection["env"]["node"].is_string(),
        agent.uninstall_requires_node(method),
    ) == NodeGuard::Missing
    {
        // 无 node 环境（用户可见拒绝；ADR 0030 业务码）
        wasmnest_plugin_api::bail_with_code!("com.wasmnest.agent-hub.hub.inst.error.nodeMissing");
    }
    let script = build_uninstall_script(cli, method, is_windows()).map_err(anyhow::Error::msg)?;

    let data_dir = DATA_DIR
        .get()
        .ok_or_else(|| anyhow::anyhow!("uninstall: data dir unavailable"))?;
    let seq = RUN_SEQ.fetch_add(1, AtomicOrdering::Relaxed);
    let output_path = format!("{data_dir}/runs/uninstall-{cli}-{seq}.log");
    let (command, args_vec) =
        shell_invocation(exec_script(script.clone(), is_windows()), is_windows());
    let request = json!({
        "command": command,
        "args": args_vec,
        "output_path": output_path,
        "timeout_ms": INSTALL_TIMEOUT_MS,
    });
    let run_id = h
        .process_run(&request.to_string())
        .map_err(|e| anyhow::anyhow!("uninstall: spawn failed: {e}"))?;

    pending()
        .lock()
        .map_err(|e| anyhow::anyhow!("uninstall: poisoned pending map: {e}"))?
        .insert(
            run_id.clone(),
            PendingRun {
                kind: "uninstall".to_string(),
                output_path: output_path.clone(),
                cli: Some(cli.to_string()),
                source: None,
            },
        );

    state["active"] = json!({
        "runId": run_id,
        "cli": cli,
        "action": "uninstall",
        "command": script,
        "useMirror": false,
        "outputPath": output_path,
        "startedAt": now_ms(h).unwrap_or(0),
        "cancelRequested": false,
    });
    write_state(h, &state);
    h.log_info(&format!("uninstall run started (cli = {cli})"));
    emit_and_return(h, &state)
}

/// 轮询回显：active run 读 output_path 尾部；无 active 时回放 last 的终态输出
pub(crate) fn run_output(h: &WasmHost) -> anyhow::Result<Value> {
    let state = read_state(h);
    if let Some(active) = state["active"].as_object() {
        let path = active["outputPath"].as_str().unwrap_or("");
        let output = h
            .fs_read(path)
            .map_err(|e| anyhow::anyhow!("run-output: read failed: {e}"))?
            .as_deref()
            .map(output_tail);
        return Ok(json!({
            "status": "running",
            "cli": active["cli"],
            "action": active["action"],
            "command": active["command"],
            "output": output,
        }));
    }
    if let Some(last) = state["last"].as_object() {
        let status = if last["ok"] == json!(true) {
            "ok"
        } else if last["cancelled"] == json!(true) {
            "cancelled"
        } else {
            "error"
        };
        return Ok(json!({
            "status": status,
            "cli": last["cli"],
            "action": last["action"],
            "command": last["command"],
            "output": last["output"],
        }));
    }
    Ok(json!({ "status": "idle", "output": null }))
}

/// 取消在途 run（尽力而为：进程可能已退出）；cancelRequested 标记使完成
/// 事件落为 cancelled 终态
pub(crate) fn cancel_run(h: &WasmHost) -> anyhow::Result<Value> {
    let mut state = read_state(h);
    let run_id = state["active"]["runId"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("cancel-run: no active run"))?
        .to_string();
    // 已自然结束属预期内（kill 与完成事件竞态），宿主按 best-effort 返回 Ok
    h.process_kill(&run_id)
        .map_err(|e| anyhow::anyhow!("cancel-run: kill failed: {e}"))?;
    state["active"]["cancelRequested"] = json!(true);
    write_state(h, &state);
    h.log_info(&format!("install run cancel requested (run_id = {run_id})"));
    emit_and_return(h, &state)
}

/// 进程完成回灌：读输出尾部落 last 终态 → 清 active → 删除输出文件 →
/// 推送 → 自动全量重探测刷新卡片（install / uninstall 共用）
pub(crate) fn handle_process_done(event: &ProcessDoneEvent) -> anyhow::Result<()> {
    let h = host();
    let removed = pending()
        .lock()
        .map_err(|e| anyhow::anyhow!("process-done: poisoned pending map: {e}"))?
        .remove(&event.run_id);
    let Some(entry) = removed else {
        return Ok(());
    };
    let Some(cli) = entry.cli else {
        return Ok(());
    };
    let kind = entry.kind;

    let mut state = read_state(&h);
    if !state["active"].is_object() {
        // 状态丢失（storage 异常/停用清理）但仍收到完成事件：只清 pending，落盘缺位可容忍
        h.log_warn("process-done: active run state missing; ignoring done event");
        return Ok(());
    }
    let active = state["active"].take();
    let cancelled = active["cancelRequested"] == json!(true);
    let ok = event.exit_code == Some(0) && !event.timed_out;
    let log_line = format!("{kind} run finished (cli = {cli}, ok = {ok}, cancelled = {cancelled})");

    let output = h
        .fs_read(&entry.output_path)
        .map_err(|e| anyhow::anyhow!("process-done: read output failed: {e}"))?
        .as_deref()
        .map(output_tail);
    state["last"] = json!({
        "cli": cli,
        "action": active["action"],
        "command": active["command"],
        "ok": ok,
        "cancelled": cancelled,
        "exitCode": event.exit_code,
        "timedOut": event.timed_out,
        "error": if ok {
            Value::Null
        } else {
            format!("exit={:?} timed_out={}", event.exit_code, event.timed_out).into()
        },
        "output": output,
        "finishedAt": now_ms(&h).unwrap_or(0),
    });
    write_state(&h, &state);
    h.log_info(&log_line);
    emit(&h, &state);

    // 尽力清理输出文件，防 runs 目录堆积
    let _ = h.fs_delete(&entry.output_path);

    // 完成后自动全量重探测：卡片版本/安装方式随实际结果刷新（尽力而为）
    if let Err(e) = detect::spawn_all(&h) {
        h.log_warn(&format!("process-done: post-install re-detect failed: {e}"));
    }
    Ok(())
}

/// 停用兜底：终止在途 run 并落 cancelled 终态（进程可能已退出，kill 尽力而为）
pub(crate) fn abort_active(h: &WasmHost) -> anyhow::Result<()> {
    let mut state = read_state(h);
    if !state["active"].is_object() {
        return Ok(());
    }
    let Some(run_id) = state["active"]["runId"].as_str().map(|s| s.to_string()) else {
        state["active"] = json!(null);
        write_state(h, &state);
        return Ok(());
    };
    let _ = h.process_kill(&run_id);
    let mut last = state["active"].take();
    last["ok"] = json!(false);
    last["cancelled"] = json!(true);
    last["error"] = json!("deactivated while running");
    state["last"] = last;
    write_state(h, &state);
    emit(h, &state);
    Ok(())
}

/// 输出尾部截断（char boundary 安全）
fn output_tail(s: &str) -> String {
    if s.len() <= OUTPUT_TAIL_BYTES {
        return s.to_string();
    }
    let mut start = s.len() - OUTPUT_TAIL_BYTES;
    while start < s.len() && !s.is_char_boundary(start) {
        start += 1;
    }
    s[start..].to_string()
}

// ==================== Tests（纯函数单测，双平台形态覆盖） ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 执行包装：unix 脚本必须带 PATH 引导（回归锁——npm 类安装/卸载此前裸
    /// 跑登录 shell，nvm 用户 npm 找不到 → exit 127，卸载"完成"却毫无效果，
    /// 卡片仍显示已安装）；Windows cmd /C 原样透传
    #[test]
    fn exec_script_unix_carries_path_bootstrap() {
        let unix = exec_script("npm uninstall -g @openai/codex".to_string(), false);
        assert!(unix.starts_with(path_bootstrap_unix()));
        assert!(unix.ends_with("npm uninstall -g @openai/codex"));

        assert_eq!(
            exec_script("npm install -g pi".to_string(), true),
            "npm install -g pi"
        );
    }

    /// 输出尾部截断：小文件原样；大文件取尾部且 char boundary 安全
    #[test]
    fn output_tail_truncates() {
        assert_eq!(output_tail("hello"), "hello");
        let big = "你".repeat(OUTPUT_TAIL_BYTES); // 3 bytes/char，必然截在多字节中间
        let tail = output_tail(&big);
        assert!(tail.len() <= OUTPUT_TAIL_BYTES + 3);
        assert_eq!(tail, big[big.len() - tail.len()..]);
    }

    // ==================== 探测前置判定（三态口径） ====================

    /// `unavailable`（探测没结论）→ 拦下并给业务码，**不得**落到 recipe 构造
    /// （否则报成「unsupported install method: unknown」，把用户引向手动安装）
    #[test]
    fn probe_guard_blocks_unavailable_only() {
        assert_eq!(probe_guard("unavailable"), ProbeGuard::Unavailable);
        // 有效结论照常放行
        assert_eq!(probe_guard("ok"), ProbeGuard::Proceed);
        assert_eq!(probe_guard("not-installed"), ProbeGuard::Proceed);
        assert_eq!(probe_guard("idle"), ProbeGuard::Proceed);
        assert_eq!(probe_guard("detecting"), ProbeGuard::Proceed);
    }

    /// 两条失败面分得开：探测**有结论**但方式确实未知 → 交给 recipe 拒绝
    /// （`unsupported … install method`，用户该去手动安装）；探测**没结论** →
    /// probe_guard 拦下（用户该去重试检测）。命令面本身要宿主 storage，native
    /// 不可调，故在这里锁判据与 recipe 的分工。
    #[test]
    fn probe_unavailable_is_distinct_from_unknown_method() {
        assert_eq!(probe_guard("ok"), ProbeGuard::Proceed);
        let recipe_err = build_install_script("claude", "unknown", false, false)
            .err()
            .unwrap_or_default();
        assert!(
            recipe_err.contains("unsupported") && recipe_err.contains("unknown"),
            "有结论 + 方式未知应落 recipe 拒绝，实际：{recipe_err}"
        );
        assert_eq!(probe_guard("unavailable"), ProbeGuard::Unavailable);
    }

    // ==================== 环境前置判定（node 三态口径） ====================

    /// 缺 node + recipe 依赖 npm → `nodeMissing`（前端据此弹链式引导）；
    /// standalone（官方自更新）不受 node 影响；有 node 一律放行
    #[test]
    fn node_guard_matrix() {
        assert_eq!(node_guard(true, true), NodeGuard::Proceed);
        assert_eq!(node_guard(true, false), NodeGuard::Proceed);
        assert_eq!(node_guard(false, false), NodeGuard::Proceed);
        assert_eq!(node_guard(false, true), NodeGuard::Missing);
    }
}
