//! Agent 管理域（原 agent-hub 插件并入 bedcode）— Agent CLI 统一管理台
//!
//! 域边界：探测 / 安装更新卸载 / Node 引导 / Skills / 供应商 / 使用统计与会话日志。
//! 命令面前缀 `agent.*`（原 `agent-hub.*`），由本插件 `invoke_command` 的
//! `agent.` 守卫分支整体转发到 [`invoke_command`]；进程完成事件经
//! [`on_process_done`] 按 run_id 归属分发（宿主对所有插件进程回调广播，
//! 非 hub 的 run_id 在此放行）。
//!
//! 探测与安装均经 host-process 以平台分派的 shell 执行：unix 登录 shell
//! （`bash -lc`，与宿主 PTY 命令构建同模式，保住 nvm 等 PATH 注入），
//! Windows `cmd /C`。宿主 OS 在 activate 时经 `ConfigKey::OsPlatform`
//! 缓存（wasm 目标下 `cfg!(windows)` 恒为 false，不可用于运行时平台分派）。
//! 进程为异步执行（run-id + output_path 落盘），完成事件 `on_process_done`
//! 按 run_id 归属驱动解析 → storage 持久化 → 事件推送前端。
//!
//! 目录授权：activate 时对 CLI 配置目录 + 会话目录 + 自身数据目录做一次
//! 批量 request-auth 弹窗；拒绝**不阻断激活**，降级由概览页横幅呈现，
//! 用户可随时经 `agent.request-auth` 命令重试。批量口是唯一免逐个弹窗的出路：
//! 同一业务预见多个文件访问（扫描 N 个来源目录、供应商一次读写多个 CLI 配置）
//! 时，先一次 request-auth 把整组目录拿到手，后续逐文件访问全部前缀命中、
//! 静默放行。宿主第一方清单免审的目录（`.agents` / `.claude/skills` /
//! `.pi/agent/skills` / `.wasmnest/bedcode/hub/runs`）不进申请列。

use wasmnest_plugin_api::events::ProcessDoneEvent;
use wasmnest_plugin_api::host::{ConfigKey, HostConfig, HostFs, HostLog, HostStorage};
use wasmnest_plugin_api::wasm_host::WasmHost;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

mod agents;
mod detect;
mod env;
mod install;
mod providers;
mod skills;
mod usage;
mod usage_parse;
mod usage_sqlite;
mod util;

/// host-storage 键：探测状态 JSON（前端 `AgentHubState` wire 形状）
const STATE_KEY: &str = "detection";
/// host-storage 键：目录授权结果（"granted" | "declined"）
const AUTH_KEY: &str = "auth";
/// host-storage 键：安装/更新域复合状态（active/last/updates/mirror）
const INSTALL_KEY: &str = "install";
/// host-storage 键：Node.js 引导域状态（phase / 目标产物 / 失败明细）
const BOOTSTRAP_KEY: &str = "bootstrap";

/// 插件数据目录：`{HomeDir}/.wasmnest/bedcode/hub/`（探测/安装输出落盘）
static DATA_DIR: OnceLock<String> = OnceLock::new();
/// 用户主目录（npmrc 改写/还原用）
pub(crate) static HOME: OnceLock<String> = OnceLock::new();
/// 在途进程归属：run_id → 归属描述；on_process_done 按 run_id 分发
pub(crate) struct PendingRun {
    /// "env" | CLI 名（探测）| "install" | "uninstall" | "skills-scan" | "skills-import"
    pub kind: String,
    pub output_path: String,
    /// kind == "install" 时为 Some(cli)
    pub cli: Option<String>,
    /// kind == "skills-import" 时为 "源目录\n入库目录名"
    pub source: Option<String>,
}
static PENDING: OnceLock<Mutex<HashMap<String, PendingRun>>> = OnceLock::new();

pub(crate) fn pending() -> &'static Mutex<HashMap<String, PendingRun>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn host() -> WasmHost {
    WasmHost
}

/// 批量授权目录清单（注册表适配器声明 + 共享目录，全部为家目录绝对路径前缀）。
///
/// 宿主侧第一方清单已免审 `~/.agents`、`~/.claude/skills`、`~/.pi/agent/skills`
/// 与自身数据根的 `~/.wasmnest/bedcode/hub/runs`（回灌产物目录），不在申请列；
/// 其余每次会话都会读写的目录（CLI 配置/会话目录、npmrc、claude 当前项目
/// 配置与 usage 会话真源）由 [`agents::auth_dirs`] 一次性汇总批量申请。
/// 拒绝后 usage 域降级，扫描时仍可就「实际来源根目录」重新批量申请。
fn request_auth(h: &WasmHost, home: &str) -> bool {
    let dirs = agents::auth_dirs(home);
    let granted = h.fs_request_auth(&dirs).unwrap_or(false);
    let _ = h.storage_set(
        AUTH_KEY,
        &serde_json::json!(if granted { "granted" } else { "declined" }),
    );
    // 同步持久化 authGranted 到 detection：get-state 直接读 storage，若
    // 不写回，前端横幅恒显示"尚未授权"（push_state 只在事件 payload 更新、
    // 从不落库，实测 auth 键已 granted 但 detection.authGranted 恒 false）
    if let Ok(Some(mut state)) = h.storage_get(STATE_KEY) {
        state["authGranted"] = serde_json::json!(granted);
        let _ = h.storage_set(STATE_KEY, &state);
    }
    if granted {
        h.log_info("directory authorization granted");
    } else {
        h.log_warn("directory authorization declined; agent management degrades until granted");
    }
    granted
}

/// 域激活：由本插件 `activate` 末尾调用。解析家目录/宿主 OS 缓存、发起批量
/// 授权、幂等建供应商与用量表。失败不阻断插件整体激活（会话核心域独立于
/// 本域可用），但错误必须留痕（fail-visible）。
pub(crate) fn activate(h: &WasmHost) -> anyhow::Result<()> {
    let home = h
        .config_get(ConfigKey::HomeDir)?
        .ok_or_else(|| anyhow::anyhow!("hub activate: home_dir config unavailable"))?;
    let _ = DATA_DIR.set(format!("{home}/.wasmnest/bedcode/hub"));
    let _ = HOME.set(home.clone());
    // 宿主 OS 运行时缓存：shell 分派/安装 recipe 均依赖（wasm 下 cfg 恒 unix）
    match h.config_get(ConfigKey::OsPlatform)? {
        Some(p) => {
            let _ = util::OS_PLATFORM.set(p);
        }
        None => h.log_warn("os.platform config unavailable; falling back to compile-time os"),
    }

    // 授权拒绝不阻断激活：结果落 storage，前端横幅降级呈现
    request_auth(h, &home);

    // 供应商预设表（幂等建表）；失败不阻断激活（命令入口会重试）
    if let Err(e) = providers::ensure_schema(h) {
        h.log_warn(&format!("hub activate: providers schema init failed: {e}"));
    }
    // 使用统计三表（幂等建表）；失败不阻断激活（命令入口会重试）
    if let Err(e) = usage::ensure_schema(h) {
        h.log_warn(&format!("hub activate: usage schema init failed: {e}"));
    }
    Ok(())
}

/// 域停用：清在途归属与探测跟踪，终止在途安装/引导进程并落终态。
pub(crate) fn deactivate(h: &WasmHost) {
    // 清空在途进程归属：停用后到达的完成事件不再被误消费
    let _ = pending()
        .lock()
        .map(|mut p| p.clear())
        .map_err(|e| anyhow::anyhow!("hub deactivate: poisoned pending map: {e}"));
    // 清空探测批跟踪与「检测更新」pending 标志：防重激活后旧标志误触发
    detect::clear_detect_tracking();
    // 在途安装进程尽力终止并落终态，避免 storage 里残留永久 "running"
    if let Err(e) = install::abort_active(h) {
        h.log_warn(&format!("hub deactivate: abort active run failed: {e}"));
    }
    // 引导进程同理：kill + 清临时物 + 落 cancelled（不留半截 runtime）
    if let Err(e) = env::abort_active(h) {
        h.log_warn(&format!("hub deactivate: abort bootstrap failed: {e}"));
    }
}

/// `agent.*` 命令路由（命令名含完整 `agent.` 前缀，由本插件分派器转发）。
pub(crate) fn invoke_command(
    name: &str,
    args: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let h = host();
    match name {
        "agent.get-state" => {
            let state = h.storage_get(STATE_KEY)?;
            Ok(serde_json::json!({ "state": state }))
        }
        "agent.list-agents" => Ok(agents::describe()),
        "agent.request-auth" => {
            let home = HOME
                .get()
                .ok_or_else(|| anyhow::anyhow!("request-auth: home unavailable"))?;
            let granted = request_auth(&h, home);
            detect::push_state(&h);
            Ok(serde_json::json!({ "granted": granted }))
        }
        "agent.detect" => {
            detect::spawn_all(&h)?;
            Ok(serde_json::json!({ "started": true }))
        }
        // ==================== 安装/更新与镜像 ====================
        "agent.get-install-state" => install::get_state(&h),
        "agent.speed-test" => install::speed_test(&h),
        "agent.apply-mirror" => install::apply_mirror(&h, &args),
        "agent.add-custom-source" => install::add_custom_source(&h, &args),
        "agent.remove-custom-source" => install::remove_custom_source(&h, &args),
        "agent.restore-npmrc" => install::restore_npmrc(&h),
        "agent.check-updates" => install::check_updates(&h),
        "agent.install" => install::start(&h, &args),
        "agent.uninstall" => install::uninstall(&h, &args),
        "agent.describe-install" => install::describe_install(&h, &args),
        "agent.get-run-output" => install::run_output(&h),
        "agent.cancel-run" => install::cancel_run(&h),
        // ==================== Node.js 环境引导 ====================
        "agent.get-bootstrap-state" => env::get_state(&h),
        "agent.bootstrap-env" => env::start(&h),
        "agent.cancel-bootstrap" => env::cancel(&h),
        "agent.remove-env" => env::remove(&h),
        // ==================== Skills 管理 ====================
        "agent.get-skills-state" => skills::get_state(&h),
        "agent.scan-skills" => skills::scan(&h),
        "agent.read-skill" => skills::read_skill(&h, &args),
        "agent.save-skill" => skills::save_skill(&h, &args),
        "agent.distribute-skill" => skills::distribute(&h, &args),
        "agent.install-github-skill" => skills::install_github(&h, &args),
        "agent.import-skill" => skills::import_local(&h, &args),
        // ==================== 供应商统一管理 ====================
        "agent.get-providers-state" => providers::get_state(&h),
        "agent.save-preset" => providers::save_preset(&h, &args),
        "agent.delete-preset" => providers::delete_preset(&h, &args),
        "agent.import-providers" => providers::import_providers(&h),
        // 迁移桥：自 agent-hub 导出文件一次性导入预设（含 api_key 明文，单路径授权）
        "agent.import-presets" => providers::import_presets(&h, &args),
        "agent.fetch-models" => providers::fetch_models(&h, &args),
        "agent.apply-provider" => providers::apply_provider(&h, &args),
        // ==================== 使用统计与会话日志 ====================
        "agent.get-usage-state" => usage::get_state(&h),
        "agent.scan-usage" => usage::scan(&h),
        "agent.get-usage-stats" => usage::get_stats(&h, &args),
        "agent.list-usage-sources" => usage::list_sources(&h),
        "agent.pick-source-dir" => usage::pick_source_dir(&h),
        "agent.add-usage-source" => usage::add_source(&h, &args),
        "agent.remove-usage-source" => usage::remove_source(&h, &args),
        "agent.add-usage-source-path" => usage::add_source_path(&h, &args),
        "agent.remove-usage-source-path" => usage::remove_source_path(&h, &args),
        "agent.list-usage-sessions" => usage::list_sessions(&h, &args),
        "agent.read-usage-session" => usage::read_session(&h, &args),
        "agent.clear-usage-data" => usage::clear_data(&h),
        other => Err(anyhow::anyhow!("unknown command: {other}")),
    }
}

/// 进程完成事件按 run_id 归属分发（宿主对所有插件进程回调广播）。
pub(crate) fn on_process_done(event: &ProcessDoneEvent) -> anyhow::Result<()> {
    let kind = pending()
        .lock()
        .map_err(|e| anyhow::anyhow!("process-done: poisoned pending map: {e}"))?
        .get(&event.run_id)
        .map(|e| e.kind.clone());
    match kind.as_deref() {
        Some("install") | Some("uninstall") => install::handle_process_done(event),
        Some("bootstrap") => env::handle_process_done(event),
        Some(kind) if kind.starts_with("skills-") => skills::handle_process_done(event, kind),
        Some("usage-scan") => usage::handle_scan_done(event),
        Some(_) => detect::handle_process_done(event),
        // 非 hub 域的进程回调，或停用清理后的迟到回调——放行
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// bedcode manifest 必须覆盖 agent 命令面与新增权限（注册即契约）；
    /// include_str 自 desktop 根的 plugin.json（与宿主装载同一份）。
    #[test]
    fn manifest_covers_agent_surface() {
        let raw = include_str!("../../../plugin.json");
        let m: serde_json::Value = serde_json::from_str(raw).expect("plugin.json must parse");
        assert_eq!(m["id"], "com.wasmnest.bedcode");
        let perms = m["permissions"].as_array().expect("permissions");
        for p in ["app:path", "fs:pick", "process:run", "storage"] {
            assert!(
                perms.iter().any(|v| v.as_str() == Some(p)),
                "permission {p} missing"
            );
        }
        let commands = m["contributes"]["commands"]
            .as_array()
            .expect("contributes.commands");
        for cmd in ["agent.get-state", "agent.detect", "agent.install", "agent.uninstall"] {
            assert!(
                commands.iter().any(|c| c["id"].as_str() == Some(cmd)),
                "command {cmd} missing from manifest"
            );
        }
    }

    /// 授权目录清单（注册表派生）：家目录绝对路径前缀、覆盖四家 CLI 配置/会话落点，
    /// 且不含宿主第一方清单已免审的目录（`.claude/skills`、`.wasmnest/bedcode/hub/runs`）
    #[test]
    fn auth_dirs_cover_cli_homes() {
        let dirs = agents::auth_dirs("/home/u");
        assert_eq!(dirs.len(), 8);
        assert!(dirs.iter().all(|d| d.starts_with("/home/u/")));
        assert!(dirs.iter().any(|d| d.ends_with("/.codex")));
        assert!(dirs.iter().any(|d| d.ends_with("/.pi")));
        // usage 扫描的 claude 会话真源：不随宿主第一方免询（用户内容），须授权
        assert!(dirs.iter().any(|d| d.ends_with("/.claude/projects")));
        assert!(dirs.iter().any(|d| d.ends_with("/.claude.json")));
        // 宿主第一方清单已免审的目录不进申请列（清单：.agents / .claude/skills /
        // .pi/agent/skills / .wasmnest/bedcode/hub/runs；.agents 因技能库仍需逐文件读写）
        assert!(dirs.iter().all(|d| !d.contains("/.claude/skills")));
        assert!(dirs.iter().all(|d| !d.contains("/.wasmnest/bedcode/hub/runs")));
    }

    /// list-agents 路由：返回注册表全量（顺序/展示名/能力形状），未知命令仍然拒绝
    #[test]
    fn list_agents_route_returns_registry() {
        let out = invoke_command("agent.list-agents", serde_json::json!(null)).expect("list-agents");
        let agents = out["agents"].as_array().expect("agents array");
        let ids: Vec<&str> = agents
            .iter()
            .map(|a| a["id"].as_str().expect("id"))
            .collect();
        assert_eq!(ids, vec!["claude", "codex", "opencode", "pi"]);
        assert_eq!(agents[0]["displayName"], serde_json::json!("Claude Code"));
        assert!(agents[0]["capabilities"]["install"].is_boolean());
        assert!(invoke_command("agent.nope", serde_json::json!(null)).is_err());
    }
}
