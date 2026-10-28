//! 环境引导域（Node.js + npm 一键引导）
//!
//! 探测修好之后（P0），干净机器上的真实状态是「四个 agent 未安装 + 没有
//! node/npm」——本模块把「装不了」变成「能装」。对外仍叫「安装 Node.js」，
//! 「引导」只用于 node（见 `GLOSSARY.md`）。
//!
//! # 流水线
//!
//! ```text
//! preflight → downloading → verifying → extracting → registering → reprobing → done
//!                                        ↘ failed(phase, code, detail)
//! 任意阶段 → cancelled
//! ```
//!
//! - **preflight**（同步，一次进程）：架构 / 工具可用性 / 磁盘空间；已有
//!   node ≥ 22 直接 `already-ready`（一个字节都不下）
//! - **downloading**（异步）：三来源 × 平台工具链逐个尝试，落 `cache/*.part`
//! - **verifying**（同步）：sha256 必须与常量表一致；不一致即删文件换来源
//! - **extracting**（异步）：解压到 `runtime/node/.tmp-<seq>`，落位 `runtime/node/<ver>`
//! - **registering**（同步宿主原语）：`host-app.register-path` 登记用户级 PATH
//! - **reprobing**（异步）：触发一次全量探测，等 `env.node` 变成期望版本
//!
//! # 失败与回滚
//!
//! 任一阶段失败只清临时物（`.tmp-*` / `.part`），**不动**已生效目录、PATH 与
//! npm 全局目录。落位成功即视为「已落位」，登记失败不回滚落位（重试只重跑登记）。
//!
//! # 装完即可用
//!
//! 所有 `host-process` 脚本统一经 [`prepend_env`] 注入 PATH 与
//! `npm_config_prefix`（detect / install / skills / usage 亦然）：装完不用重启
//! 应用，后续探测与 CLI 安装立刻用上新 node。

mod layout;
mod phases;
mod platform;
mod sources;
mod state;

pub(crate) use phases::{Code, Failure, Phase};

use super::{host, pending, PendingRun};
use crate::hub::detect;
use crate::hub::install;
use crate::hub::util::{is_windows, shell_invocation};
use layout::Layout;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU32, Ordering};
use wasmnest_plugin_api::events::ProcessDoneEvent;
use wasmnest_plugin_api::host::{
    HostApp, HostFs, HostLog, HostProcess, HostStorage, ProcessSyncResult,
};
use wasmnest_plugin_api::wasm_host::WasmHost;

/// 下载上限：36~58 MB 在慢网下的容忍值（超时按失败处理并 kill 进程树）
const DOWNLOAD_TIMEOUT_MS: u64 = 600_000;
/// 校验 / 解压上限（解压含落位后的自检，见 `finish_extract`）
const VERIFY_TIMEOUT_MS: u64 = 180_000;
const EXTRACT_TIMEOUT_MS: u64 = 180_000;
/// preflight（架构 / 工具 / 磁盘）只是几条短命令
const PREFLIGHT_TIMEOUT_MS: u64 = 60_000;
/// 落位 / 登记等短命令
const SHORT_TIMEOUT_MS: u64 = 30_000;
/// 磁盘下限：产物 36~58 MB + 解压后约 100 MB，留一倍余量
const MIN_FREE_BYTES: u64 = 300 * 1024 * 1024;

/// 引导自身进程序号（临时目录名 / 输出文件名）
static RUN_SEQ: AtomicU32 = AtomicU32::new(0);

// ==================== 命令入口（P3 挂 lib.rs 分派） ====================

/// 读引导状态（前端挂载 / 重连时拉取）+ 不启动流水线的「计划」。
///
/// `plan` 是确认弹窗的数据源：版本 / 目标平台 / 来源 URL / 文件大小 / 校验值
/// 必须在用户点「开始」**之前**可见（安全约束：不做静默下载）。架构取自
/// 已完成的探测采集（`env.arch`），因此这里不需要跑任何进程。
pub(crate) fn get_state(h: &WasmHost) -> anyhow::Result<Value> {
    Ok(json!({ "state": state::read(h), "plan": plan(h) }))
}

/// 引导计划（读探测状态里的 `env.arch`）
pub(crate) fn plan(h: &WasmHost) -> Value {
    let arch = h
        .storage_get(super::STATE_KEY)
        .ok()
        .flatten()
        .and_then(|s| s["env"]["arch"].as_str().map(|a| a.to_string()));
    plan_for(is_windows(), arch.as_deref())
}

/// 计划构造（纯函数，可测）：未知 / 缺失架构 → 目标字段全 null（前端显性降级）
fn plan_for(windows: bool, arch: Option<&str>) -> Value {
    let targets = arch
        .and_then(|a| sources::targets(windows, a).ok())
        .unwrap_or_default();
    let primary = targets.first().copied();
    json!({
        "version": sources::NODE_VERSION,
        "windows": windows,
        "arch": arch,
        "platform": primary.map(|t| t.platform),
        "file": primary.map(|t| t.file),
        "sha256": primary.map(|t| t.sha256),
        "bytes": primary.map(|t| t.size),
        "archive": primary.map(|t| t.archive.as_str()),
        "sources": primary.map(|t| sources::source_urls(t.file)).unwrap_or_default(),
        // 兜底产物（Linux .tar.xz）一并告知：确认弹窗与实际尝试一致，不藏第二发
        "fallbackFile": targets.get(1).map(|t| t.file),
        "minNodeMajor": sources::MIN_NODE_MAJOR,
    })
}

/// 是否在途（与 `install.active` 互斥判定用；两条域共享「同实例串行」语义）
pub(crate) fn is_active(h: &WasmHost) -> bool {
    state::read(h)["active"] == json!(true)
}

/// 启动引导。
///
/// 三条前置判定（**不信任前端传参**）：
/// - 已有引导在途 / CLI 安装在进行 → 业务码 `busy`
/// - 已有可用 node（主版本 ≥ 22）→ 直接 `already-ready`，不产生任何下载任务
pub(crate) fn start(h: &WasmHost) -> anyhow::Result<Value> {
    if is_active(h) {
        wasmnest_plugin_api::bail_with_code!("com.wasmnest.bedcode.hub.boot.error.busy");
    }
    if install::is_active(h) {
        wasmnest_plugin_api::bail_with_code!("com.wasmnest.bedcode.hub.boot.error.busy");
    }

    let mut st = state::default_state();
    st["startedAt"] = json!(state::started_now(h));

    // 本插件落位过的版本：旧版本 = 升级分支（即使机器上 node 可用也要换到钉住版本）
    let prev = state::read(h);
    let managed = prev["placedVersion"].as_str().map(|v| v.to_string());
    let detected = detection_node(h);
    // 失败 / 取消时旧运行时仍在用：先把「装过哪个版本」写进状态，收尾成功才换新值
    st["placedVersion"] = json!(managed);
    // 升级收尾要靠它：上次失败（如 registering）后重试时也要能摘掉旧版本
    st["previousVersion"] = prev["previousVersion"].clone();

    // 失败续跑：产物已是钉住版本、上次止步于登记 / 重探测 → 不重下、不重解压
    let resume = resume_after_place(managed.as_deref(), prev["error"]["phase"].as_str());

    // 已有可用 node（且不是「我们自己装了个旧版本」、也不是登记失败重试）：
    // 不下载、不改 PATH，直接 done
    if !resume && already_ready(managed.as_deref(), detected.as_deref()) {
        st["phase"] = json!(Phase::Done.as_str());
        st["alreadyReady"] = json!(true);
        st["detectedVersion"] = json!(detected.unwrap_or_default());
        st["finishedAt"] = json!(state::started_now(h));
        h.log_info("env bootstrap skipped: node already available");
        return Ok(state::push_and_return(h, &mut st));
    }
    if managed
        .as_deref()
        .is_some_and(|v| v != sources::NODE_VERSION)
    {
        // 升级：成功后摘旧版本 PATH 条目 + 删旧目录（失败进 cleanupPending）
        st["previousVersion"] = json!(managed);
        h.log_info(&format!(
            "env bootstrap upgrading from {} to {}",
            managed.as_deref().unwrap_or(""),
            sources::NODE_VERSION
        ));
    }

    let Some(layout) = layout() else {
        return Err(anyhow::anyhow!(
            "bootstrap: data dir unavailable (activate incomplete)"
        ));
    };
    if !layout.script_paths_safe() {
        return Ok(fail(
            h,
            &mut st,
            Failure::new(
                Phase::Preflight,
                Code::UnsupportedPlatform,
                format!("data dir is not script-safe: {}", layout.data_dir),
            ),
        ));
    }

    if resume {
        // 上次已经落位成功（preflight / 下载 / 校验 / 解压都过了）：只重跑剩余步骤
        h.log_info("env bootstrap resuming at register/reprobe (runtime already placed)");
        return Ok(register_and_reprobe(h, &layout, &mut st, sources::NODE_VERSION));
    }

    st["active"] = json!(true);
    st["phase"] = json!(Phase::Preflight.as_str());
    state::push(h, &mut st);
    h.log_info(&format!(
        "env bootstrap preflight started (version = {})",
        sources::NODE_VERSION
    ));

    let pre = match run_preflight(h, &layout) {
        Ok(pre) => pre,
        Err(f) => return Ok(fail(h, &mut st, f)),
    };
    h.log_info(&format!(
        "env bootstrap preflight: arch = {}, tools = [{}], free = {} bytes",
        pre.arch,
        pre.tools.join(", "),
        pre.free_bytes
    ));

    let targets = match sources::targets(layout.windows, &pre.arch) {
        Ok(t) => t,
        Err(e) => {
            return Ok(fail(
                h,
                &mut st,
                Failure::new(Phase::Preflight, Code::UnsupportedPlatform, e),
            ))
        }
    };
    if !pre.can_download(layout.windows) {
        return Ok(fail(
            h,
            &mut st,
            Failure::new(
                Phase::Preflight,
                Code::UnsupportedPlatform,
                "no download tool available (curl / wget / powershell / certutil)",
            ),
        ));
    }
    if !pre.can_verify(layout.windows) {
        return Ok(fail(
            h,
            &mut st,
            Failure::new(
                Phase::Preflight,
                Code::UnsupportedPlatform,
                "no sha256 tool available (certutil / powershell / sha256sum / shasum / openssl)",
            ),
        ));
    }
    if !pre.can_extract(layout.windows) {
        return Ok(fail(
            h,
            &mut st,
            Failure::new(
                Phase::Preflight,
                Code::UnsupportedPlatform,
                "no extraction tool available (tar / powershell)",
            ),
        ));
    }
    if pre.free_bytes > 0 && pre.free_bytes < MIN_FREE_BYTES {
        return Ok(fail(
            h,
            &mut st,
            Failure::new(
                Phase::Preflight,
                Code::InsufficientSpace,
                format!(
                    "free {} MB < required {} MB",
                    pre.free_bytes / 1024 / 1024,
                    MIN_FREE_BYTES / 1024 / 1024
                ),
            ),
        ));
    }

    // 目录先建好（后续 rename / move 的父目录必须存在）
    let mut dirs = vec![layout.cache_dir(), layout.runtime_root()];
    if layout.windows {
        dirs.push(layout.npm_global());
    }
    if let Err(e) = run_script_sync(
        h,
        platform::mkdir_script(layout.windows, &dirs),
        layout.windows,
        SHORT_TIMEOUT_MS,
    ) {
        return Ok(fail(
            h,
            &mut st,
            Failure::new(Phase::Preflight, Code::ExtractFailed, format!("mkdir failed: {e}")),
        ));
    }

    st["tools"] = json!(pre.tools);
    st["targets"] = json!(targets
        .iter()
        .map(|t| json!({
            "platform": t.platform,
            "file": t.file,
            "sha256": t.sha256,
            "bytes": t.size,
            "archive": t.archive.as_str(),
        }))
        .collect::<Vec<_>>());
    apply_target(&mut st, 0);

    // 缓存命中：校验通过就直接解压（重装 / 登记失败重试不必重下 36~58 MB）
    let file = st["file"].as_str().unwrap_or_default().to_string();
    let cache = layout.cache_file(&file);
    if cache_hit(h, &layout, &cache) {
        match verify_cache(h, &layout, &st, &cache) {
            Ok(()) => {
                h.log_info("env bootstrap reusing verified cached archive");
                st["phase"] = json!(Phase::Verifying.as_str());
                st["cachePath"] = json!(cache);
                state::push(h, &mut st);
                if let Err(e) = begin_extract(h, &layout, &mut st, &cache) {
                    return Ok(fail(
                        h,
                        &mut st,
                        Failure::new(Phase::Extracting, Code::ExtractFailed, e.to_string()),
                    ));
                }
                return Ok(json!({ "state": state::read(h) }));
            }
            Err(e) => {
                h.log_warn(&format!(
                    "bootstrap: cached archive unusable ({e}); re-downloading"
                ));
                let _ = run_script_sync(
                    h,
                    platform::cleanup_script(layout.windows, &[cache]),
                    layout.windows,
                    SHORT_TIMEOUT_MS,
                );
            }
        }
    }

    match spawn_download(h, &layout, &mut st) {
        Ok(v) => Ok(v),
        Err(e) => Ok(fail(
            h,
            &mut st,
            Failure::new(Phase::Downloading, Code::DownloadFailed, e.to_string()),
        )),
    }
}

/// 取消在途引导：kill 进程 + 清临时物，幂等
pub(crate) fn cancel(h: &WasmHost) -> anyhow::Result<Value> {
    let mut st = state::read(h);
    if st["active"] != json!(true) {
        return Ok(json!({ "state": st, "cancelled": false }));
    }
    if let Some(run_id) = st["runId"].as_str() {
        let _ = h.process_kill(run_id);
    }
    if let Some(layout) = layout() {
        cleanup(h, &layout, &st);
    }
    st["phase"] = json!(Phase::Cancelled.as_str());
    st["active"] = json!(false);
    st["runId"] = Value::Null;
    st["finishedAt"] = json!(state::started_now(h));
    st["error"] = Failure::new(Phase::Cancelled, Code::Cancelled, "cancelled by user").to_json();
    h.log_info("env bootstrap cancelled");
    Ok(state::push_and_return(h, &mut st))
}

/// 移除本插件安装的 Node.js 运行时（P4）。
///
/// 只动「我们自己装的东西」：
/// - 摘除 `runtime/node/v*` 的 PATH 条目（Windows 上 `npm-global` 条目**保留**）；
/// - 删 `runtime/node/v*` 目录（删不掉的进 `cleanupPending`，不谎报成功）；
/// - **保留** `npm-global/`（用户已装的全局 CLI）与 `cache/`（重装免下载）。
///
/// 幂等：没装过时返回成功且不改状态（重复点「移除」不产生副作用）。
pub(crate) fn remove(h: &WasmHost) -> anyhow::Result<Value> {
    if is_active(h) || install::is_active(h) {
        wasmnest_plugin_api::bail_with_code!("com.wasmnest.bedcode.hub.boot.error.busy");
    }
    let Some(layout) = layout() else {
        return Err(anyhow::anyhow!(
            "remove-env: data dir unavailable (activate incomplete)"
        ));
    };

    let entries = dir_entries(h, &layout, &layout.runtime_root());
    let versions: Vec<String> = entries
        .iter()
        .filter(|n| platform::is_version_dir_name(n))
        .cloned()
        .collect();
    let temps: Vec<String> = entries
        .iter()
        .filter(|n| n.starts_with(".tmp-"))
        .cloned()
        .collect();
    if versions.is_empty() && temps.is_empty() {
        h.log_info("env remove: no managed runtime found; nothing to do");
        return Ok(json!({ "state": state::read(h), "removed": false, "pending": [] }));
    }

    // 先摘 PATH 再删目录：新开终端立刻不再指向即将消失的目录
    for version in &versions {
        let bin = layout.native(&layout.bin_dir(version));
        if let Err(e) = h.path_unregister(&bin) {
            h.log_warn(&format!(
                "env remove: unregister-path {bin} failed: {}",
                e.message
            ));
        }
    }

    let mut targets: Vec<String> = versions
        .iter()
        .map(|v| layout.native(&layout.node_dir(v)))
        .collect();
    targets.extend(
        temps
            .iter()
            .map(|t| layout.native(&format!("{}/{}", layout.runtime_root(), t))),
    );
    if let Err(e) = run_script_sync(
        h,
        platform::cleanup_script(layout.windows, &targets),
        layout.windows,
        EXTRACT_TIMEOUT_MS,
    ) {
        h.log_warn(&format!("env remove: delete failed: {e}"));
    }

    // 删完再核对：还被占用的目录进 cleanupPending（不谎报「已移除」）
    let pending: Vec<String> = dir_entries(h, &layout, &layout.runtime_root())
        .iter()
        .filter(|n| platform::is_version_dir_name(n) || n.starts_with(".tmp-"))
        .map(|n| layout.native(&format!("{}/{}", layout.runtime_root(), n)))
        .collect();

    let mut st = state::read(h);
    st["active"] = json!(false);
    st["phase"] = json!(Phase::Idle.as_str());
    st["runId"] = Value::Null;
    st["placedVersion"] = Value::Null;
    st["previousVersion"] = Value::Null;
    st["registered"] = json!([]);
    st["cleanupPending"] = json!(pending);
    st["removedAt"] = json!(state::started_now(h));
    st["detectedVersion"] = Value::Null;
    st["error"] = Value::Null;
    h.log_info(&format!(
        "env removed ({} version dirs, {} pending)",
        versions.len(),
        pending.len()
    ));
    let out = state::push_and_return(h, &mut st);

    // 重探测：环境条要立刻从「node 可用」回到「未检测到 Node.js」
    if let Err(e) = detect::spawn_all(h) {
        h.log_warn(&format!("env remove: re-detect failed: {e}"));
    }
    Ok(json!({ "state": out["state"], "removed": true, "pending": pending }))
}

/// 停用兜底：终止在途进程并落 cancelled 终态（进程可能已退出，kill 尽力而为）
pub(crate) fn abort_active(h: &WasmHost) -> anyhow::Result<()> {
    let mut st = state::read(h);
    if st["active"] != json!(true) {
        return Ok(());
    }
    if let Some(run_id) = st["runId"].as_str() {
        let _ = h.process_kill(run_id);
    }
    if let Some(layout) = layout() {
        cleanup(h, &layout, &st);
    }
    st["phase"] = json!(Phase::Cancelled.as_str());
    st["active"] = json!(false);
    st["runId"] = Value::Null;
    st["finishedAt"] = json!(state::started_now(h));
    st["error"] = Failure::new(Phase::Cancelled, Code::Cancelled, "deactivated while running")
        .to_json();
    state::write(h, &st);
    state::emit(h, &st);
    Ok(())
}

/// 进程完成回灌（lib.rs 按 pending kind 分派；只消费本轮 run）
pub(crate) fn handle_process_done(event: &ProcessDoneEvent) -> anyhow::Result<()> {
    let h = host();
    let removed = pending()
        .lock()
        .map_err(|e| anyhow::anyhow!("bootstrap: poisoned pending map: {e}"))?
        .remove(&event.run_id);
    let Some(entry) = removed else {
        return Ok(());
    };
    if entry.kind != "bootstrap" {
        return Ok(());
    }
    let output = h.fs_read(&entry.output_path).ok().flatten().unwrap_or_default();
    let _ = h.fs_delete(&entry.output_path);

    let mut st = state::read(&h);
    if st["runId"].as_str() != Some(event.run_id.as_str()) {
        // 迟到的旧 run（取消后 / 重试后）：只丢弃输出，不动状态
        h.log_warn("bootstrap: stale run finished; ignored");
        return Ok(());
    }
    match st["phase"].as_str().unwrap_or("") {
        "downloading" => on_download_done(&h, &mut st, event, &output),
        "extracting" => on_extract_done(&h, &mut st, event, &output),
        other => {
            h.log_warn(&format!("bootstrap: run finished in unexpected phase {other}"));
            Ok(())
        }
    }
}

/// 环境探测完成钩子（detect 在 env 段回灌后调用）：`reprobing` 阶段的收敛判据
pub(crate) fn on_env_probe(h: &WasmHost, detection: &Value) {
    let mut st = state::read(h);
    if st["phase"] != json!(Phase::Reprobing.as_str()) {
        return;
    }
    let node = detection["env"]["node"].as_str();
    match node.and_then(sources::node_major) {
        Some(major) if major >= sources::MIN_NODE_MAJOR => {
            st["phase"] = json!(Phase::Done.as_str());
            st["active"] = json!(false);
            st["runId"] = Value::Null;
            st["finishedAt"] = json!(state::started_now(h));
            st["error"] = Value::Null;
            st["detectedVersion"] = json!(node);
            h.log_info(&format!(
                "env bootstrap done (node = {})",
                node.unwrap_or("")
            ));
            // 升级收尾：旧版本已验证让位，摘旧 PATH 条目 + 删旧目录（失败进 cleanupPending）
            finish_upgrade(h, &mut st);
            state::push(h, &mut st);
        }
        _ => {
            let detail = format!(
                "envStatus={} node={}",
                detection["envStatus"].as_str().unwrap_or("unknown"),
                node.unwrap_or("null")
            );
            fail(
                h,
                &mut st,
                Failure::new(Phase::Reprobing, Code::ReprobeFailed, detail),
            );
        }
    }
}

// ==================== 脚本 env 注入 ====================

/// 后续 `host-process` 脚本的 PATH / npm prefix 前缀。
///
/// **为什么不用 `host-process` 的 `env` 字段**：`env` 只是把变量覆盖成给定值，
/// 拿不到「继承的原 PATH」再拼（写 `%PATH%` / `$PATH` 不会被展开），会直接把
/// 用户的 PATH 清空。脚本内前缀是唯一能「前置而不是替换」的形态。
///
/// 返回的串**自带结尾分隔符**（unix 换行 / Windows ` & `），可直接拼在脚本头。
pub(crate) fn shell_env_prefix(windows: bool) -> String {
    // activate 尚未落定目录（理论不可达：命令面在 activate 成功后才可用）→ 不加前缀
    match state::dirs() {
        Some((data, home)) => env_prefix_for(windows, &data, &home),
        None => String::new(),
    }
}

/// 前缀构造（纯函数，双平台可测）：目录不可安全进脚本时返回空串
pub(crate) fn env_prefix_for(windows: bool, data_dir: &str, home: &str) -> String {
    let l = Layout::new(windows, data_dir, home);
    if !l.script_paths_safe() {
        return String::new();
    }
    let bin = l.native(&l.bin_dir(sources::NODE_VERSION));
    if windows {
        let prefix = l.native(&l.npm_prefix());
        format!(
            "set \"PATH={bin};{prefix};%PATH%\" & set \"npm_config_prefix={prefix}\" & "
        )
    } else {
        let prefix_bin = format!("{}/bin", l.npm_prefix());
        format!(
            "export PATH=\"{bin}:{prefix_bin}:$PATH\"\nexport npm_config_prefix=\"{}\"\n",
            l.npm_prefix()
        )
    }
}

/// 给任意脚本加 env 前缀（detect 之外的域统一走它）
pub(crate) fn prepend_env(script: String, windows: bool) -> String {
    let prefix = shell_env_prefix(windows);
    if prefix.is_empty() {
        script
    } else {
        format!("{prefix}{script}")
    }
}

// ==================== 流水线实现 ====================

fn layout() -> Option<Layout> {
    let (data, home) = state::dirs()?;
    Some(Layout::new(is_windows(), &data, &home))
}

/// 探测状态里的 node 版本（未就绪 / 未安装 → None）
fn detection_node(h: &WasmHost) -> Option<String> {
    let state = h
        .storage_get(super::STATE_KEY)
        .ok()
        .flatten()
        .unwrap_or(Value::Null);
    state["env"]["node"].as_str().map(|s| s.to_string())
}

/// 是否短路为 `already-ready`（纯函数，可测）。
///
/// - 本插件落位的是**旧版本**（`managed != 钉住版本`）→ 升级，不短路；
/// - 没装过 / 已装钉住版本 → 探测到 node 主版本 ≥ `MIN_NODE_MAJOR` 即复用，
///   一个字节都不下（升级后的版本可能来自系统 node，同样不需要再装）。
fn already_ready(managed: Option<&str>, detected: Option<&str>) -> bool {
    if managed.is_some_and(|v| v != sources::NODE_VERSION) {
        return false;
    }
    detected
        .and_then(sources::node_major)
        .is_some_and(|m| m >= sources::MIN_NODE_MAJOR)
}

/// 失败重试续跑判定（纯函数，可测）。
///
/// 产物已是钉住版本、上次止步于 `registering` / `reprobing`（落位成功之后的
/// 两步）→ 只重跑登记与重探测，不必重下 36~58 MB、也不必重解压。
fn resume_after_place(placed: Option<&str>, last_error_phase: Option<&str>) -> bool {
    placed == Some(sources::NODE_VERSION)
        && matches!(last_error_phase, Some("registering") | Some("reprobing"))
}

/// 当前目标产物（从状态里读；索引越界 = 状态损坏 → None）
fn current_target(st: &Value) -> Option<&Value> {
    let idx = st["targetIndex"].as_u64().unwrap_or(0) as usize;
    st["targets"].get(idx)
}

fn archive_of(target: &Value) -> sources::Archive {
    match target["archive"].as_str().unwrap_or("zip") {
        "tar.gz" => sources::Archive::TarGz,
        "tar.xz" => sources::Archive::TarXz,
        _ => sources::Archive::Zip,
    }
}

/// 把第 `index` 个产物写进状态（file / sha256 / sources 一并重置游标）
fn apply_target(st: &mut Value, index: usize) {
    let (platform, file, sha256, bytes) = {
        let t = &st["targets"][index];
        (
            t["platform"].clone(),
            t["file"].as_str().unwrap_or_default().to_string(),
            t["sha256"].clone(),
            t["bytes"].clone(),
        )
    };
    st["targetIndex"] = json!(index);
    st["platform"] = platform;
    st["file"] = json!(file);
    st["sha256"] = sha256;
    st["bytes"] = bytes;
    st["sources"] = json!(sources::source_urls(&file));
    st["sourceIndex"] = json!(0);
    st["attemptIndex"] = json!(0);
    st["sourceUrl"] = Value::Null;
    st["extractIndex"] = json!(0);
    st["extractError"] = Value::Null;
}

/// 从状态里还原 preflight 结论（工具可用性）
fn preflight_from_state(st: &Value) -> platform::Preflight {
    platform::Preflight {
        arch: st["platform"].as_str().unwrap_or("").to_string(),
        tools: st["tools"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        free_bytes: 0,
    }
}

fn run_preflight(h: &WasmHost, layout: &Layout) -> Result<platform::Preflight, Failure> {
    let script = platform::preflight_script(layout.windows);
    let (program, args) = shell_invocation(script, layout.windows);
    let req = json!({
        "command": program,
        "args": args,
        "timeout_ms": PREFLIGHT_TIMEOUT_MS,
    });
    let res = h
        .process_run_sync(&req.to_string())
        .map_err(|e| Failure::new(Phase::Preflight, Code::UnsupportedPlatform, e.message))?;
    if res.timed_out {
        return Err(Failure::new(
            Phase::Preflight,
            Code::UnsupportedPlatform,
            "preflight timed out",
        ));
    }
    Ok(platform::parse_preflight(&format!(
        "{}{}",
        res.stdout, res.stderr
    )))
}

/// 同步跑一条命令并捕获输出（失败 → 错误描述，含 stderr 尾部）
fn run_cmd_sync(
    h: &WasmHost,
    cmd: &platform::Cmd,
    timeout_ms: u64,
) -> Result<ProcessSyncResult, String> {
    let req = json!({
        "command": cmd.program,
        "args": cmd.args,
        "timeout_ms": timeout_ms,
    });
    h.process_run_sync(&req.to_string())
        .map_err(|e| e.message.clone())
}

/// 同步跑一段脚本文本（shell 分派同 detect / install）
fn run_script_sync(
    h: &WasmHost,
    script: String,
    windows: bool,
    timeout_ms: u64,
) -> Result<ProcessSyncResult, String> {
    let (program, args) = shell_invocation(script, windows);
    let cmd = platform::Cmd {
        program,
        args,
    };
    run_cmd_sync(h, &cmd, timeout_ms)
}

fn output_of(res: &ProcessSyncResult) -> String {
    format!("{}{}", res.stdout, res.stderr)
}

/// 组装失败明细：原始退出码 + 输出尾部（含命令名，排障时知道是谁失败）
fn detail_of(step: &str, exit_code: Option<i32>, timed_out: bool, output: &str) -> String {
    let tail = output.trim();
    if tail.is_empty() {
        format!("{step}: exit={exit_code:?} timed_out={timed_out}")
    } else {
        format!("{step}: exit={exit_code:?} timed_out={timed_out}\n{tail}")
    }
}

/// 落失败终态：清临时物、推送、写 error 日志
fn fail(h: &WasmHost, st: &mut Value, f: Failure) -> Value {
    if let Some(layout) = layout() {
        cleanup(h, &layout, st);
    }
    h.log_error(&format!(
        "env bootstrap failed (phase = {}, code = {}, detail = {})",
        f.phase.as_str(),
        f.code.as_str(),
        f.detail
    ));
    st["phase"] = json!(Phase::Failed.as_str());
    st["active"] = json!(false);
    st["runId"] = Value::Null;
    st["finishedAt"] = json!(state::started_now(h));
    st["error"] = f.to_json();
    state::push_and_return(h, st)
}

/// 清理临时物（`.tmp-*` / `.part`）；尽力而为，失败只记 warn
fn cleanup(h: &WasmHost, layout: &Layout, st: &Value) {
    let mut paths: Vec<String> = Vec::new();
    if let Some(tmp) = st["tmpDir"].as_str() {
        if !tmp.is_empty() {
            paths.push(layout.native(tmp));
        }
    }
    if let Some(file) = st["file"].as_str() {
        if !file.is_empty() {
            paths.push(layout.native(&layout.part_file(file)));
        }
    }
    if paths.is_empty() {
        return;
    }
    if let Err(e) = run_script_sync(
        h,
        platform::cleanup_script(layout.windows, &paths),
        layout.windows,
        SHORT_TIMEOUT_MS,
    ) {
        h.log_warn(&format!("bootstrap: cleanup failed: {e}"));
    }
}

// ---------------- 缓存 ----------------

/// 缓存文件是否已存在（shell 判定：`~/.wasmnest/bedcode/hub/cache` 不在宿主
/// 第一方免审清单里，走 `fs_exists` 会弹一次目录授权框）
fn cache_hit(h: &WasmHost, layout: &Layout, path: &str) -> bool {
    match run_script_sync(
        h,
        platform::file_exists_script(layout.windows, path),
        layout.windows,
        SHORT_TIMEOUT_MS,
    ) {
        Ok(res) => output_of(&res).contains(platform::FILE_EXISTS_MARK),
        Err(e) => {
            h.log_warn(&format!("bootstrap: cache probe failed: {e}"));
            false
        }
    }
}

/// 缓存文件 sha256 校验（多工具兜底序列）：`Ok(())` = 与常量表一致。
///
/// 每个校验工具都试一次：工具存在但跑失败（权限 / 文件被占用）时换下一个，
/// 全部拿不到哈希也按失败处理（**不得**把「算不出来」当「校验通过」）。
fn verify_cache(h: &WasmHost, layout: &Layout, st: &Value, cache: &str) -> Result<(), String> {
    let pre = preflight_from_state(st);
    let expected = st["sha256"].as_str().unwrap_or_default().to_string();
    let mut last = String::from("no sha256 tool produced a hash");
    for cmd in platform::verify_attempts(layout.windows, &pre, cache) {
        match run_cmd_sync(h, &cmd, VERIFY_TIMEOUT_MS) {
            Ok(res) => {
                let out = output_of(&res);
                match platform::parse_sha256(&out) {
                    Some(actual) if actual.eq_ignore_ascii_case(&expected) => return Ok(()),
                    Some(actual) => {
                        last = format!("sha256 mismatch: expected {expected}, got {actual}")
                    }
                    None => last = detail_of("sha256", res.exit_code, res.timed_out, &out),
                }
            }
            Err(e) => last = format!("sha256 tool failed: {e}"),
        }
    }
    Err(last)
}

// ---------------- 下载 ----------------

/// spawn 当前游标指向的下载尝试；游标越界则推进计划
fn spawn_download(h: &WasmHost, layout: &Layout, st: &mut Value) -> anyhow::Result<Value> {
    let windows = layout.windows;
    let pre = preflight_from_state(st);
    let Some(target) = current_target(st) else {
        let f = Failure::new(Phase::Downloading, Code::DownloadFailed, "target table missing");
        return Ok(fail(h, st, f));
    };
    let file = target["file"].as_str().unwrap_or_default().to_string();
    let source_index = st["sourceIndex"].as_u64().unwrap_or(0) as usize;
    let attempt_index = st["attemptIndex"].as_u64().unwrap_or(0) as usize;
    let url = st["sources"]
        .get(source_index)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let Some(url) = url else {
        return Ok(advance_download(
            h,
            layout,
            st,
            "no source left",
            Code::DownloadFailed,
        ));
    };
    if let Err(e) = sources::validate_source(&url) {
        return Ok(advance_download(h, layout, st, &e, Code::DownloadFailed));
    }

    let part = layout.part_file(&file);
    let attempts = platform::download_attempts(windows, &pre, &url, &part);
    let Some(cmd) = attempts.get(attempt_index) else {
        return Ok(advance_download(
            h,
            layout,
            st,
            &format!("download tool not available (attempt {attempt_index})"),
            Code::DownloadFailed,
        ));
    };

    let seq = RUN_SEQ.fetch_add(1, Ordering::Relaxed);
    let output_path = format!("{}/boot-download-{seq}.log", layout.runs_dir());
    let request = json!({
        "command": cmd.program,
        "args": cmd.args,
        "output_path": output_path,
        "timeout_ms": DOWNLOAD_TIMEOUT_MS,
    });
    let run_id = h
        .process_run(&request.to_string())
        .map_err(|e| anyhow::anyhow!("bootstrap: spawn download failed: {e}"))?;

    pending()
        .lock()
        .map_err(|e| anyhow::anyhow!("bootstrap: poisoned pending map: {e}"))?
        .insert(
            run_id.clone(),
            PendingRun {
                kind: "bootstrap".to_string(),
                output_path,
                cli: None,
                source: None,
            },
        );

    st["phase"] = json!(Phase::Downloading.as_str());
    st["runId"] = json!(run_id);
    st["sourceUrl"] = json!(url);
    st["cachePath"] = json!(part);
    st["tmpDir"] = Value::Null;
    h.log_info(&format!(
        "env bootstrap downloading ({} via {} / source {} attempt {})",
        file,
        cmd.program,
        source_index + 1,
        attempt_index + 1
    ));
    Ok(state::push_and_return(h, st))
}

/// 推进下载游标：同源换工具 → 换来源 → 换产物格式 → 失败。
///
/// `fail_code` 只在「全部打光」时生效：下载失败落 `download-failed`，
/// 校验不匹配落 `verify-failed`（用户看到的是两件不同的事）。
fn advance_download(
    h: &WasmHost,
    layout: &Layout,
    st: &mut Value,
    detail: &str,
    fail_code: Code,
) -> Value {
    let windows = layout.windows;
    let pre = preflight_from_state(st);
    let source_index = st["sourceIndex"].as_u64().unwrap_or(0) as usize;
    let attempt_index = st["attemptIndex"].as_u64().unwrap_or(0) as usize;
    let sources_len = st["sources"].as_array().map(|a| a.len()).unwrap_or(0);
    let file = st["file"].as_str().unwrap_or_default().to_string();
    let attempts_len = if sources_len > 0 {
        let url = st["sources"][source_index]
            .as_str()
            .unwrap_or_default()
            .to_string();
        platform::download_attempts(windows, &pre, &url, &layout.part_file(&file)).len()
    } else {
        0
    };
    let target_index = st["targetIndex"].as_u64().unwrap_or(0) as usize;
    let targets_len = st["targets"].as_array().map(|a| a.len()).unwrap_or(0);

    match phases::next_plan(
        sources_len,
        attempts_len,
        source_index,
        attempt_index,
        target_index > 0,
        targets_len > target_index + 1,
    ) {
        phases::Plan::Retry { source, attempt } => {
            st["sourceIndex"] = json!(source);
            st["attemptIndex"] = json!(attempt);
            h.log_warn(&format!("bootstrap: download retry ({detail})"));
            spawn_download(h, layout, st)
                .unwrap_or_else(|e| fail(h, st, Failure::new(Phase::Downloading, Code::DownloadFailed, e.to_string())))
        }
        phases::Plan::Fallback => {
            h.log_warn(&format!(
                "bootstrap: primary archive exhausted; falling back ({detail})"
            ));
            apply_target(st, target_index + 1);
            spawn_download(h, layout, st)
                .unwrap_or_else(|e| fail(h, st, Failure::new(Phase::Downloading, Code::DownloadFailed, e.to_string())))
        }
        phases::Plan::Exhausted => {
            h.log_error(&format!("bootstrap: all download attempts failed ({detail})"));
            fail(h, st, Failure::new(Phase::Downloading, fail_code, detail))
        }
    }
}

/// 下载完成：重命名 `.part` → 缓存文件 → 校验 sha256
fn on_download_done(
    h: &WasmHost,
    st: &mut Value,
    event: &ProcessDoneEvent,
    output: &str,
) -> anyhow::Result<()> {
    let Some(layout) = layout() else {
        fail(h, st, Failure::new(Phase::Downloading, Code::DownloadFailed, "layout unavailable"));
        return Ok(());
    };
    let windows = layout.windows;
    let file = st["file"].as_str().unwrap_or_default().to_string();

    if event.timed_out || event.exit_code != Some(0) {
        let detail = detail_of("download", event.exit_code, event.timed_out, output);
        advance_download(h, &layout, st, &detail, Code::DownloadFailed);
        return Ok(());
    }

    // 下载成功：先落正式缓存文件（后续重试 / 重装都复用该文件）
    let part = layout.part_file(&file);
    let cache = layout.cache_file(&file);
    if let Err(e) = run_script_sync(
        h,
        platform::rename_script(windows, &part, &cache),
        windows,
        SHORT_TIMEOUT_MS,
    ) {
        advance_download(
            h,
            &layout,
            st,
            &format!("rename .part failed: {e}"),
            Code::DownloadFailed,
        );
        return Ok(());
    }
    st["cachePath"] = json!(cache.clone());
    st["phase"] = json!(Phase::Verifying.as_str());
    st["runId"] = Value::Null;
    state::push(h, st);
    h.log_info(&format!("env bootstrap verifying {file}"));

    match verify_cache(h, &layout, st, &cache) {
        Ok(()) => return begin_extract(h, &layout, st, &cache),
        Err(last_detail) => {
            // 校验不通过：删掉该文件，换下一个来源重下（安全约束：不匹配立即中止）
            let _ = run_script_sync(
                h,
                platform::cleanup_script(windows, &[cache]),
                windows,
                SHORT_TIMEOUT_MS,
            );
            h.log_warn(&format!("bootstrap: {last_detail}"));
            advance_download(h, &layout, st, &last_detail, Code::VerifyFailed);
            Ok(())
        }
    }
}

// ---------------- 解压 ----------------

/// 校验通过 → 解压到临时目录（异步；解压大包可能数十秒）
fn begin_extract(
    h: &WasmHost,
    layout: &Layout,
    st: &mut Value,
    cache: &str,
) -> anyhow::Result<()> {
    let seq = RUN_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = layout.tmp_dir(seq);
    // 解压目标目录必须先存在（tar -C / Expand-Archive 都不会自己建）
    if let Err(e) = run_script_sync(
        h,
        platform::mkdir_script(layout.windows, &[tmp.clone()]),
        layout.windows,
        SHORT_TIMEOUT_MS,
    ) {
        fail(
            h,
            st,
            Failure::new(Phase::Extracting, Code::ExtractFailed, format!("mkdir tmp failed: {e}")),
        );
        return Ok(());
    }
    st["tmpDir"] = json!(tmp);
    st["extractIndex"] = json!(0);
    st["phase"] = json!(Phase::Extracting.as_str());
    spawn_extract(h, layout, st, cache)
}

fn spawn_extract(
    h: &WasmHost,
    layout: &Layout,
    st: &mut Value,
    cache: &str,
) -> anyhow::Result<()> {
    let windows = layout.windows;
    let pre = preflight_from_state(st);
    let Some(target) = current_target(st).cloned() else {
        fail(h, st, Failure::new(Phase::Extracting, Code::ExtractFailed, "target missing"));
        return Ok(());
    };
    let archive = archive_of(&target);
    let tmp = st["tmpDir"].as_str().unwrap_or_default().to_string();
    let index = st["extractIndex"].as_u64().unwrap_or(0) as usize;
    let attempts = platform::extract_attempts(windows, &pre, archive, cache, &tmp);
    let Some(cmd) = attempts.get(index) else {
        let detail = st["extractError"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("no extraction command available (attempt {index})"));
        fail(h, st, Failure::new(Phase::Extracting, Code::ExtractFailed, detail));
        return Ok(());
    };

    let seq = RUN_SEQ.fetch_add(1, Ordering::Relaxed);
    let output_path = format!("{}/boot-extract-{seq}.log", layout.runs_dir());
    let request = json!({
        "command": cmd.program,
        "args": cmd.args,
        "output_path": output_path,
        "timeout_ms": EXTRACT_TIMEOUT_MS,
    });
    match h.process_run(&request.to_string()) {
        Ok(run_id) => {
            pending()
                .lock()
                .map_err(|e| anyhow::anyhow!("bootstrap: poisoned pending map: {e}"))?
                .insert(
                    run_id.clone(),
                    PendingRun {
                        kind: "bootstrap".to_string(),
                        output_path,
                        cli: None,
                        source: None,
                    },
                );
            st["runId"] = json!(run_id);
            st["phase"] = json!(Phase::Extracting.as_str());
            state::push(h, st);
            h.log_info(&format!(
                "env bootstrap extracting ({}) to {tmp}",
                cmd.program
            ));
            Ok(())
        }
        Err(e) => {
            let f = Failure::new(
                Phase::Extracting,
                Code::ExtractFailed,
                format!("spawn extract failed: {e}"),
            );
            fail(h, st, f);
            Ok(())
        }
    }
}

fn on_extract_done(
    h: &WasmHost,
    st: &mut Value,
    event: &ProcessDoneEvent,
    output: &str,
) -> anyhow::Result<()> {
    let Some(layout) = layout() else {
        fail(h, st, Failure::new(Phase::Extracting, Code::ExtractFailed, "layout unavailable"));
        return Ok(());
    };
    if event.timed_out || event.exit_code != Some(0) {
        // 记下原始失败输出：解压链打光时它就是最终 detail（不吞成「无命令可用」）
        st["extractError"] = json!(detail_of(
            "extract",
            event.exit_code,
            event.timed_out,
            output
        ));
        st["extractIndex"] = json!(st["extractIndex"].as_u64().unwrap_or(0) + 1);
        st["runId"] = Value::Null;
        let cache = st["cachePath"].as_str().unwrap_or_default().to_string();
        // 换下一个解压形态（Windows：tar → Expand-Archive）；没有则失败
        return spawn_extract(h, &layout, st, &cache);
    }
    finish_extract(h, &layout, st)
}

/// 解压成功 → 落位（rename 到 `runtime/node/<ver>`）→ 自检 → 登记 PATH → 重探测
fn finish_extract(h: &WasmHost, layout: &Layout, st: &mut Value) -> anyhow::Result<()> {
    let windows = layout.windows;
    let version = sources::NODE_VERSION;
    let Some(target) = current_target(st).cloned() else {
        fail(h, st, Failure::new(Phase::Extracting, Code::ExtractFailed, "target missing"));
        return Ok(());
    };
    let top = sources::top_dir_for(target["platform"].as_str().unwrap_or(""));
    let tmp = layout.native(st["tmpDir"].as_str().unwrap_or_default());
    let dst = layout.native(&layout.node_dir(version));

    let script = platform::place_script(windows, &tmp, &top, &dst);
    match run_script_sync(h, script, windows, EXTRACT_TIMEOUT_MS) {
        Ok(res) if !res.timed_out && res.exit_code == Some(0) => {}
        Ok(res) => {
            let detail = detail_of("place", res.exit_code, res.timed_out, &output_of(&res));
            fail(h, st, Failure::new(Phase::Extracting, Code::ExtractFailed, detail));
            return Ok(());
        }
        Err(e) => {
            fail(
                h,
                st,
                Failure::new(Phase::Extracting, Code::ExtractFailed, format!("place failed: {e}")),
            );
            return Ok(());
        }
    }

    // 自检：直接跑解压出来的 node（产物损坏 / 杀软隔离都在这一步暴露）
    let probe = platform::node_probe_cmd(windows, &dst);
    let version_out = match run_cmd_sync(h, &probe, SHORT_TIMEOUT_MS) {
        Ok(res) if !res.timed_out && res.exit_code == Some(0) => res.stdout.trim().to_string(),
        Ok(res) => {
            let detail = detail_of("node --version", res.exit_code, res.timed_out, &output_of(&res));
            fail(h, st, Failure::new(Phase::Extracting, Code::ExtractFailed, detail));
            return Ok(());
        }
        Err(e) => {
            fail(
                h,
                st,
                Failure::new(Phase::Extracting, Code::ExtractFailed, format!("node self-check failed: {e}")),
            );
            return Ok(());
        }
    };
    h.log_info(&format!("env bootstrap extracted node {version_out} -> {dst}"));

    // 临时目录已 move 走，清掉空壳（尽力而为）
    let _ = run_script_sync(
        h,
        platform::cleanup_script(windows, &[tmp]),
        windows,
        SHORT_TIMEOUT_MS,
    );

    // 落位成功即视为「已落位」：登记失败不回滚落位（重试只重跑登记）。
    // 剩余两步与失败续跑（`resume_after_place`）共用同一个函数。
    let _ = register_and_reprobe(h, layout, st, version);
    Ok(())
}

/// 落位成功后的剩余两步：登记用户级 PATH → 触发重探测（由 `on_env_probe` 收敛）。
///
/// 首次安装（[`finish_extract`] 尾部）与失败续跑（上次止步于 `registering` /
/// `reprobing`）共用——保证「重试只重跑该步」而不是整条流水线重来。
fn register_and_reprobe(
    h: &WasmHost,
    layout: &Layout,
    st: &mut Value,
    version: &str,
) -> Value {
    let windows = layout.windows;
    // 目录可能在上次失败后被清理：`register-path` 要求目录存在（宿主侧 is_dir 校验）
    let mut dirs = vec![layout.runtime_root()];
    if windows {
        dirs.push(layout.npm_global());
    }
    let _ = run_script_sync(
        h,
        platform::mkdir_script(windows, &dirs),
        windows,
        SHORT_TIMEOUT_MS,
    );

    // `placedVersion` 是移除环境 / 升级分支的真源；`registered` 记下自己写进
    // PATH 的精确条目，升级与移除据此只摘自己的，不碰用户原有项。
    st["active"] = json!(true);
    st["phase"] = json!(Phase::Registering.as_str());
    st["runId"] = Value::Null;
    st["tmpDir"] = Value::Null;
    st["placedVersion"] = json!(version);
    st["registered"] = json!(registered_paths(layout, version));
    state::push(h, st);

    if let Err(e) = register_paths(h, layout, version) {
        return fail(
            h,
            st,
            Failure::new(Phase::Registering, Code::RegisterPathFailed, e),
        );
    }

    // 重探测：等 env.node 变成期望版本（在途探测完成时由 on_env_probe 收敛）
    st["phase"] = json!(Phase::Reprobing.as_str());
    state::push(h, st);
    if let Err(e) = detect::spawn_all(h) {
        return fail(
            h,
            st,
            Failure::new(Phase::Reprobing, Code::ReprobeFailed, e.to_string()),
        );
    }
    json!({ "state": state::read(h) })
}

/// 用户级 PATH 登记（`host-app.register-path`，权限 `app:path`）。
///
/// - Windows：node 版本目录 + `npm-global`（npm 全局 shim 落点）
/// - Linux：`runtime/node/<ver>/bin`（宿主侧在 `~/.local/bin` 建 symlink）
fn register_paths(h: &WasmHost, layout: &Layout, version: &str) -> Result<(), String> {
    for path in registered_paths(layout, version) {
        h.path_register(&path)
            .map_err(|e| format!("register-path {path} failed: {}", e.message))?;
    }
    Ok(())
}

/// 本插件写进用户 PATH 的条目（系统原生形态，Windows 反斜杠）。
///
/// Windows 两次（版本目录 + `npm-global` 的 npm 全局 shim 落点）；
/// Linux 一次（版本目录的 `bin/`，宿主侧在 `~/.local/bin` 建 symlink）。
fn registered_paths(layout: &Layout, version: &str) -> Vec<String> {
    let mut paths = vec![layout.native(&layout.bin_dir(version))];
    if layout.windows {
        paths.push(layout.native(&layout.npm_global()));
    }
    paths
}

// ---------------- 升级收尾 ----------------

/// 升级收尾（`reprobing` → `done` 时调用）：新版本已被重探测确认可用。
///
/// - 摘旧版本的 PATH 条目（精确条目；`npm-global` 条目不动）；
/// - 删旧版本目录：删不掉（Windows 上 node.exe 被占用 / 杀软）记 `cleanupPending`，
///   **不回滚**已生效的新版本（P4：保留并提示「重启应用后可清理」）；
/// - 缓存只留当前钉住版本的产物（旧 zip/tgz 一并清理）。
fn finish_upgrade(h: &WasmHost, st: &mut Value) {
    let Some(layout) = layout() else {
        return;
    };
    let previous = st["previousVersion"]
        .as_str()
        .filter(|v| *v != sources::NODE_VERSION)
        .map(|v| v.to_string());

    if let Some(prev) = previous.as_deref() {
        let bin = layout.native(&layout.bin_dir(prev));
        if let Err(e) = h.path_unregister(&bin) {
            h.log_warn(&format!(
                "env upgrade: unregister-path {bin} failed: {}",
                e.message
            ));
        }
        let dir = layout.native(&layout.node_dir(prev));
        if let Err(e) = run_script_sync(
            h,
            platform::cleanup_script(layout.windows, &[dir.clone()]),
            layout.windows,
            EXTRACT_TIMEOUT_MS,
        ) {
            h.log_warn(&format!("env upgrade: delete {dir} failed: {e}"));
        }
        // 删完核对：目录还在（占用）→ 进 cleanupPending，UI 提示重启后再清
        if installed_versions(h, &layout).iter().any(|v| v == prev) {
            h.log_warn(&format!(
                "env upgrade: {dir} still present (in use?); marked cleanup-pending"
            ));
            let mut pending = st["cleanupPending"].as_array().cloned().unwrap_or_default();
            if !pending.iter().any(|p| p.as_str() == Some(dir.as_str())) {
                pending.push(json!(dir));
            }
            st["cleanupPending"] = Value::Array(pending);
        }
    }

    st["previousVersion"] = Value::Null;
    prune_cache(h, &layout, st);
}

/// 缓存只保留当前钉住版本的产物（旧版本 zip/tgz 与 `.part` 一并清掉）。
///
/// 尽力而为：清不掉只记 warn（缓存不是正确性的一部分）。
fn prune_cache(h: &WasmHost, layout: &Layout, st: &Value) {
    let keep: Vec<String> = st["targets"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t["file"].as_str().map(|f| f.to_string()))
                .collect()
        })
        .unwrap_or_default();
    if keep.is_empty() {
        // 产物表缺失（失败续跑 / 状态损坏）时**不删**缓存：宁可再生下载，也不盲删
        h.log_warn("env: cache prune skipped (target file list unavailable)");
        return;
    }
    let stale: Vec<String> = dir_entries(h, layout, &layout.cache_dir())
        .iter()
        .filter(|name| !keep.contains(name))
        .map(|name| layout.native(&layout.cache_file(name)))
        .collect();
    if stale.is_empty() {
        return;
    }
    if let Err(e) = run_script_sync(
        h,
        platform::cleanup_script(layout.windows, &stale),
        layout.windows,
        SHORT_TIMEOUT_MS,
    ) {
        h.log_warn(&format!("env: prune cache failed: {e}"));
    }
    h.log_info(&format!("env: pruned {} stale cache entries", stale.len()));
}

/// 列举目录条目名（shell 实现：数据目录不在宿主第一方免审清单里，
/// 走 `host-fs` 会弹目录授权框）
fn dir_entries(h: &WasmHost, layout: &Layout, dir: &str) -> Vec<String> {
    match run_script_sync(
        h,
        platform::list_dir_script(layout.windows, dir),
        layout.windows,
        SHORT_TIMEOUT_MS,
    ) {
        Ok(res) => platform::parse_dir_names(&output_of(&res)),
        Err(e) => {
            h.log_warn(&format!("env: list dir {dir} failed: {e}"));
            Vec::new()
        }
    }
}

/// 当前 `runtime/node` 下的版本目录（只认 `v*`）
fn installed_versions(h: &WasmHost, layout: &Layout) -> Vec<String> {
    dir_entries(h, layout, &layout.runtime_root())
        .into_iter()
        .filter(|name| platform::is_version_dir_name(name))
        .collect()
}

// ==================== Tests（纯函数单测，双平台形态覆盖） ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 计划构造：Windows 单产物无兜底；Linux 带 .tar.xz 兜底；未知架构全 null
    #[test]
    fn plan_for_platforms() {
        let win = plan_for(true, Some("AMD64"));
        assert_eq!(win["platform"], json!("win-x64"));
        assert_eq!(win["version"], json!(sources::NODE_VERSION));
        assert_eq!(win["sources"].as_array().unwrap().len(), 3);
        assert!(win["fallbackFile"].is_null());
        assert_eq!(win["minNodeMajor"], json!(sources::MIN_NODE_MAJOR));

        let linux = plan_for(false, Some("x86_64"));
        assert_eq!(linux["platform"], json!("linux-x64"));
        assert_eq!(
            linux["fallbackFile"],
            json!("node-v24.22.1-linux-x64.tar.xz")
        );

        // 探测未采集到架构 / 架构不支持：不给假计划
        let unknown = plan_for(false, None);
        assert!(unknown["platform"].is_null());
        assert_eq!(unknown["sources"], json!([]));
        assert!(plan_for(true, Some("x86"))["platform"].is_null());
    }

    /// 目标切换：索引 / 文件名 / sha256 / 来源游标一起重置（重下不会串味）
    #[test]
    fn apply_target_resets_cursor() {
        let mut st = json!({
            "targets": [
                {"platform": "linux-x64", "file": "a.tar.gz", "sha256": "aa", "bytes": 1, "archive": "tar.gz"},
                {"platform": "linux-x64", "file": "a.tar.xz", "sha256": "bb", "bytes": 2, "archive": "tar.xz"},
            ],
            "targetIndex": 0,
            "sourceIndex": 2,
            "attemptIndex": 1,
            "sourceUrl": "https://x",
        });
        apply_target(&mut st, 1);
        assert_eq!(st["targetIndex"], json!(1));
        assert_eq!(st["file"], json!("a.tar.xz"));
        assert_eq!(st["sha256"], json!("bb"));
        assert_eq!(st["sourceIndex"], json!(0));
        assert_eq!(st["attemptIndex"], json!(0));
        assert!(st["sourceUrl"].is_null());
        assert_eq!(st["sources"].as_array().unwrap().len(), 3);
        assert_eq!(st["sources"][0], json!(sources::source_urls("a.tar.xz")[0]));
    }

    /// 归档格式解析：未知值退回 zip（Windows 形态），不 panic
    #[test]
    fn archive_parsing() {
        assert_eq!(archive_of(&json!({"archive": "tar.gz"})), sources::Archive::TarGz);
        assert_eq!(archive_of(&json!({"archive": "tar.xz"})), sources::Archive::TarXz);
        assert_eq!(archive_of(&json!({"archive": "zip"})), sources::Archive::Zip);
        assert_eq!(archive_of(&json!({})), sources::Archive::Zip);
    }

    /// 状态还原的 preflight：只保留工具集合（arch/free 不参与后续判定）
    #[test]
    fn preflight_from_state_keeps_tools() {
        let st = json!({"platform": "linux-x64", "tools": ["curl", "tar", "sha256sum"]});
        let pre = preflight_from_state(&st);
        assert!(pre.has("curl"));
        assert!(pre.has("tar"));
        assert!(!pre.has("wget"));
        assert_eq!(pre.free_bytes, 0);
    }

    /// 失败明细：空输出也要保留退出码；非空输出带尾部原文
    #[test]
    fn detail_includes_exit_and_tail() {
        let empty = detail_of("download", Some(1), false, "   ");
        assert_eq!(empty, "download: exit=Some(1) timed_out=false");
        let with_tail = detail_of("download", Some(1), false, "curl: (6) Could not resolve host\n");
        assert!(with_tail.contains("Could not resolve host"));
        assert!(with_tail.starts_with("download: exit=Some(1)"));
    }

    /// 平台分派锁（spec §9「windows=true/false 两种断言」）：前缀形态只由入参
    /// 决定，与测试跑在哪台机器无关。Windows 走 `set`（`& ` 收尾，可直接拼进
    /// 单行 cmd 链）；unix 走 `export`（换行收尾，PATH 里追加 `~/.local/bin`）。
    #[test]
    fn env_prefix_forms_follow_argument() {
        let win = env_prefix_for(true, "C:/Users/u/.wasmnest/bedcode/hub", "C:/Users/u");
        assert!(
            win.starts_with(
                "set \"PATH=C:\\Users\\u\\.wasmnest\\bedcode\\hub\\runtime\\node\\v24.22.1;"
            ),
            "Windows 前缀必须先登记版本目录：{win}"
        );
        assert!(win.contains(";C:\\Users\\u\\.wasmnest\\bedcode\\hub\\npm-global;%PATH%\""));
        assert!(win
            .contains("& set \"npm_config_prefix=C:\\Users\\u\\.wasmnest\\bedcode\\hub\\npm-global\" & "));
        assert!(win.ends_with(" & "), "Windows 前缀要能直接拼在 cmd 链头：{win}");
        assert!(!win.contains("export "), "Windows 形态不得出现 POSIX 语法");

        let unix = env_prefix_for(false, "/home/u/.wasmnest/bedcode/hub", "/home/u");
        assert!(unix.starts_with(
            "export PATH=\"/home/u/.wasmnest/bedcode/hub/runtime/node/v24.22.1/bin:/home/u/.local/bin:$PATH\"\n"
        ));
        assert!(unix.ends_with("export npm_config_prefix=\"/home/u/.local\"\n"));
        assert!(!unix.contains("set "), "unix 形态不得出现 cmd 语法");
        assert!(!unix.contains('\\'), "unix 前缀不应出现反斜杠");

        // 目录含能逃出引号的字符 → 不给前缀（宁可少前缀，也不拼出可注入的脚本）
        assert_eq!(
            env_prefix_for(false, "/home/a'b/.wasmnest/bedcode/hub", "/home/a'b"),
            String::new()
        );
        assert_eq!(
            env_prefix_for(true, "C:/Users/100%/.wasmnest/bedcode/hub", "C:/Users/100%"),
            String::new()
        );

        // native 单测不启宿主 → DATA_DIR 未落定，prepend 退回原脚本（不丢命令）
        assert_eq!(prepend_env("echo hi".to_string(), true), "echo hi");
    }

    /// 网络冒烟（手动触发：`cargo test -- --ignored`）：真下载 → 真校验 → 真解压
    /// → 真跑 `node --version`。验收单里的那条 `#[ignore]` 用例就住在这里。
    ///
    /// 走的是 `platform.rs` 的真实命令链（而不是 mock），因此能抓到「命令拼得对
    /// 但机器上跑不通」的问题；Windows 形态由纯函数单测覆盖（本机无 Windows）。
    #[test]
    #[ignore = "network: downloads ~58 MB from nodejs.org"]
    fn linux_real_download_verify_extract() {
        if !cfg!(target_os = "linux") {
            return;
        }
        let arch = match std::env::consts::ARCH {
            "x86_64" => "x86_64",
            "aarch64" => "aarch64",
            other => panic!("unsupported arch: {other}"),
        };
        let target = sources::targets(false, arch)
            .expect("target mapping")
            .remove(0);

        // preflight 用真机工具（不 mock）：拿不到就跳过，避免伪失败
        let out = std::process::Command::new("/bin/bash")
            .args(["-lc", &platform::preflight_script(false)])
            .output()
            .expect("run preflight");
        let pre = platform::parse_preflight(&String::from_utf8_lossy(&out.stdout));
        assert!(pre.can_download(false), "本机没有 curl / wget");
        assert!(pre.can_verify(false), "本机没有 sha256 工具");
        assert!(pre.can_extract(false), "本机没有 tar");

        let root = std::env::temp_dir().join(format!("bedcode-hub-smoke-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let cache = root.join("cache");
        let tmp = root.join("tmp");
        std::fs::create_dir_all(&cache).expect("mkdir cache");
        std::fs::create_dir_all(&tmp).expect("mkdir tmp");
        let part = cache.join(format!("{}.part", target.file));
        let cache_file = cache.join(target.file);
        let part_s = part.to_string_lossy().to_string();
        let cache_s = cache_file.to_string_lossy().to_string();
        let tmp_s = tmp.to_string_lossy().to_string();

        let run = |cmd: &platform::Cmd| {
            std::process::Command::new(&cmd.program)
                .args(&cmd.args)
                .output()
                .unwrap_or_else(|e| panic!("spawn {} failed: {e}", cmd.program))
        };

        // 下载（首个来源 + 首选工具）
        let url = sources::source_urls(target.file)
            .into_iter()
            .next()
            .expect("source url");
        let dl = platform::download_attempts(false, &pre, &url, &part_s);
        let res = run(dl.first().expect("download command"));
        assert!(
            res.status.success(),
            "download failed: {}{}",
            String::from_utf8_lossy(&res.stdout),
            String::from_utf8_lossy(&res.stderr)
        );
        std::fs::rename(&part, &cache_file).expect("rename .part");

        // 校验：多工具兜底，任意一个能给出哈希即可
        let expected = target.sha256;
        let mut actual: Option<String> = None;
        for cmd in platform::verify_attempts(false, &pre, &cache_s) {
            let res = run(&cmd);
            let out = format!(
                "{}{}",
                String::from_utf8_lossy(&res.stdout),
                String::from_utf8_lossy(&res.stderr)
            );
            if let Some(hash) = platform::parse_sha256(&out) {
                actual = Some(hash);
                break;
            }
        }
        assert_eq!(actual.as_deref(), Some(expected), "sha256 mismatch");

        // 解压 + 落位 + 自检
        let ex = platform::extract_attempts(false, &pre, target.archive, &cache_s, &tmp_s);
        let res = run(ex.first().expect("extract command"));
        assert!(res.status.success(), "extract failed");
        let top = sources::top_dir_for(target.platform);
        let dst = root.join("runtime").join(sources::NODE_VERSION);
        let place = platform::place_script(
            false,
            &tmp_s,
            &top,
            &dst.to_string_lossy(),
        );
        let res = std::process::Command::new("/bin/bash")
            .args(["-lc", &place])
            .output()
            .expect("run place");
        assert!(res.status.success(), "place failed");
        let probe = platform::node_probe_cmd(false, &dst.to_string_lossy());
        let res = run(&probe);
        assert!(res.status.success(), "node --version failed");
        let version = String::from_utf8_lossy(&res.stdout);
        assert!(
            version.trim().starts_with(sources::NODE_VERSION),
            "unexpected node version: {version}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 短路判定（升级分支的核心）：插件装的旧版本必须升级，即便机器上 node 可用
    #[test]
    fn already_ready_matrix() {
        // 没装过 + 系统 node ≥ 22 → 复用，不下载
        assert!(already_ready(None, Some("v24.22.1")));
        // 没装过 + 系统 node 过旧 / 未探测到 → 要装
        assert!(!already_ready(None, Some("v20.11.0")));
        assert!(!already_ready(None, None));
        // 已装钉住版本 + 仍能探测到 → 复用（目录在，不重复下载）
        assert!(already_ready(Some(sources::NODE_VERSION), Some("v24.22.1")));
        // 已装钉住版本 + 探测不到（用户删了目录）→ 重装
        assert!(!already_ready(Some(sources::NODE_VERSION), None));
        // 插件装的是旧版本 → 升级，不短路（哪怕探测到可用 node）
        assert!(!already_ready(Some("v22.0.0"), Some("v22.0.0")));
    }

    /// 失败续跑：只有「产物已是钉住版本 + 上次止步于登记/重探测」才跳过下载解压
    #[test]
    fn resume_only_after_placed_runtime() {
        assert!(resume_after_place(
            Some(sources::NODE_VERSION),
            Some("registering")
        ));
        assert!(resume_after_place(
            Some(sources::NODE_VERSION),
            Some("reprobing")
        ));
        // 解压 / 下载阶段失败：产物不完整，必须重走流水线（缓存命中会省下载）
        assert!(!resume_after_place(
            Some(sources::NODE_VERSION),
            Some("extracting")
        ));
        assert!(!resume_after_place(Some(sources::NODE_VERSION), None));
        // 上升级路径时旧版本已落位，但新版本还没：不能续跑
        assert!(!resume_after_place(Some("v22.0.0"), Some("registering")));
        assert!(!resume_after_place(None, Some("registering")));
    }

    /// PATH 条目形态：Windows 版本目录 + npm-global；Linux 只登记 bin/（symlink 落点）
    #[test]
    fn registered_paths_forms() {
        let win = Layout::new(true, "C:/u/.wasmnest/bedcode/hub", "C:/u");
        assert_eq!(
            registered_paths(&win, "v24.22.1"),
            vec![
                "C:\\u\\.wasmnest\\bedcode\\hub\\runtime\\node\\v24.22.1".to_string(),
                "C:\\u\\.wasmnest\\bedcode\\hub\\npm-global".to_string(),
            ]
        );
        let unix = Layout::new(false, "/home/u/.wasmnest/bedcode/hub", "/home/u");
        assert_eq!(
            registered_paths(&unix, "v24.22.1"),
            vec!["/home/u/.wasmnest/bedcode/hub/runtime/node/v24.22.1/bin".to_string()]
        );
    }

    /// 取消 / 失败清理的目标集合：临时目录 + `.part`（不动已生效目录）
    #[test]
    fn cleanup_targets_only_temp_artifacts() {
        let l = Layout::new(false, "/d", "/h");
        let st = json!({"tmpDir": "/d/runtime/node/.tmp-3", "file": "x.tar.gz"});
        let mut paths = vec![st["tmpDir"].as_str().unwrap().to_string()];
        paths.push(l.part_file(st["file"].as_str().unwrap()));
        assert_eq!(paths[0], "/d/runtime/node/.tmp-3");
        assert_eq!(paths[1], "/d/cache/x.tar.gz.part");
    }

}
