//! CLI 探测域（票据 02）
//!
//! 经 host-process 平台分派采集（Windows / Linux 双兼容）：
//! - unix：登录 shell `bash -lc` + PATH 引导（登录 shell 不读 `~/.bashrc`，
//!   nvm 等 PATH 注入由交互子 shell 提取，见 `path_bootstrap_unix`），
//!   `which -a` 全命中
//! - Windows：`cmd /C` 链式命令（GUI 进程 PATH 来自注册表用户环境，npm shim
//!   经 PATHEXT 解析），`where` 全命中
//! - 每个 CLI：全部 PATH 命中（→ 双安装检测）+ `--version`
//! - 环境：node / npm / pnpm 版本 + 当前 npm registry
//! - 路径统一规范化为 `/` 分隔后再归类（Windows `where` 输出反斜杠）
//!
//! CLI 清单来自注册表（[`crate::agents`]）：二进制名、安装方式路径特征均由
//! 适配器声明，本模块不持有具体 id。
//!
//! 流程：spawn_all 将各项标记 detecting 并持久化推送 → 宿主进程结束回灌
//! `on_process_done` → 读输出文件解析 → 更新 storage → emit 事件推前端。
//! 状态 JSON 为唯一真源（host-storage `detection` 键），每次读-改-写。
//!
//! **平台分派必须运行期**：脚本内容按 `is_windows()`（activate 时缓存的宿主
//! `os.platform`）选择，经 `windows: bool` 参数逐层下传。编译期 `cfg!(windows)`
//! 在 wasm32-wasip3 guest 上恒为 false——用它选脚本会让 Windows 机器拿到 POSIX
//! 脚本，`cmd /C` 执行第一行 `export` 即 exit 1，五个分段标记一个都读不到，
//! 探测全线「失败」（2026-10-22 实机事故）。

use super::{host, pending, PendingRun, AUTH_KEY, DATA_DIR, STATE_KEY};
use crate::agents::{self, Agent};
use crate::util::{is_windows, os_platform, shell_invocation};
use wasmnest_plugin_api::events::ProcessDoneEvent;
use wasmnest_plugin_api::host::{HostEvents, HostFs, HostLog, HostProcess, HostStorage};
use wasmnest_plugin_api::wasm_host::WasmHost;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};

/// 探测项：注册表全部 agent + 1 个环境采集
pub(crate) const ENV_KIND: &str = "env";
/// 登录 shell + nvm 注入可能偏慢，`--version` 类采集 20s 足够
const TIMEOUT_MS: u64 = 20_000;

static RUN_SEQ: AtomicU32 = AtomicU32::new(0);
/// 状态推送序号（push_state 单调自增，前端按 seq 过滤乱序旧事件）
static STATE_SEQ: AtomicU32 = AtomicU32::new(0);

/// 「检测更新」pending 标志：`agent-hub.check-updates` 置位后触发全量重探测
/// （刷新本地已安装版本），探测收敛时由 [`maybe_run_update_check`] 自动执行
/// 最新版本查询——outdated 必须基于「当前实际安装版本」而非上次探测缓存
/// （2026-10-02 实测：pi 已更新到 1.0，但安装页检测更新仍按缓存 0.87 判旧）
static PENDING_UPDATE_CHECK: AtomicBool = AtomicBool::new(false);

/// 最近一轮探测发起的 run_id 集合：全部完成（remove 命中 + 变空）= 一次探测
/// 收敛。以「remove 命中」判定——旧轮迟到的完成事件不在集合中，不得触发后续
/// 动作（并发重探测下集合会被下一轮整体替换，旧 run 完成若误判会提前/重复
/// 执行最新版本查询）
static DETECT_RUNS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn detect_runs() -> &'static Mutex<HashSet<String>> {
    DETECT_RUNS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 批收敛判定（纯函数，可测）：run_id 属于本批且移除后集合为空 = 本批完成
fn is_batch_done(runs: &mut HashSet<String>, run_id: &str) -> bool {
    runs.remove(run_id) && runs.is_empty()
}

/// 探测收敛钩子：本批 run 完成时移除并判定收敛；本批全部完成且安装域有
/// pending 更新检查时，自动执行最新版本查询（此刻本地版本已是本轮刷新后的
/// 实测值）。非本批的迟到完成事件（remove 未命中）不触发任何动作
fn maybe_run_update_check(h: &WasmHost, run_id: &str) {
    if !PENDING_UPDATE_CHECK.load(Ordering::Relaxed) {
        return;
    }
    let mut runs = match detect_runs().lock() {
        Ok(r) => r,
        Err(_) => return,
    };
    if !is_batch_done(&mut runs, run_id) {
        return;
    }
    // 本批探测已全部收敛：清标志后执行查询（查询本身失败不影响探测结果）
    PENDING_UPDATE_CHECK.store(false, Ordering::Relaxed);
    drop(runs);
    if let Err(e) = crate::install::run_update_check(h) {
        h.log_warn(&format!("detect: post-detect update check failed: {e}"));
    }
}

/// 「检测更新」命令入口（install 域调用）：置位 pending 并触发全量重探测。
/// 探测为异步（process-done 回灌），完成时由 [`maybe_run_update_check`] 执行
/// 最新版本查询
pub(crate) fn request_update_check(h: &WasmHost) -> anyhow::Result<()> {
    PENDING_UPDATE_CHECK.store(true, Ordering::Relaxed);
    if let Err(e) = spawn_all(h) {
        // 探测未能发起：复位标志，避免残留 pending 在后续普通探测收敛时误触发
        PENDING_UPDATE_CHECK.store(false, Ordering::Relaxed);
        return Err(e);
    }
    Ok(())
}

/// 停用清理：清空批跟踪与 pending 标志，防重激活后旧标志误触发查询
pub(crate) fn clear_detect_tracking() {
    PENDING_UPDATE_CHECK.store(false, Ordering::Relaxed);
    if let Ok(mut runs) = detect_runs().lock() {
        runs.clear();
    }
}

// ==================== 状态（读-改-写） ====================

fn read_state(h: &WasmHost) -> Value {
    let mut state = h.storage_get(STATE_KEY).ok().flatten().unwrap_or_else(|| {
        json!({
            "authGranted": false,
            "envStatus": "idle",
            "env": null,
            "clis": default_clis(),
        })
    });
    // env.os 回填：旧库环境块缺该字段时补当前平台（读取即修正，后续 write 落库）
    if let Some(env) = state.get_mut("env") {
        ensure_env_os(env);
    }
    state
}

/// 环境块 `os` 字段保证：缺失时注入当前平台名，已有值不覆盖。
/// os 由宿主导入（`os.platform` 激活时缓存，见 lib.rs::os_platform），
/// 不经 shell 采集，解析层段标记契约不含该段
fn ensure_env_os(env: &mut Value) {
    if env.is_object() && env.get("os").is_none() {
        env["os"] = json!(os_platform());
    }
}

/// 默认探测状态（键集合 = 注册表 id 集合，顺序即展示顺序；契约测试锁死）
pub(crate) fn default_clis() -> Value {
    let mut map = serde_json::Map::new();
    for agent in agents::all() {
        map.insert(
            agent.id().to_string(),
            json!({
                "status": "idle",
                "installed": null,
                "version": null,
                "method": "unknown",
                "paths": [],
                "dual": false,
                "error": null,
            }),
        );
    }
    Value::Object(map)
}

fn write_state(h: &WasmHost, state: &Value) {
    if let Err(e) = h.storage_set(STATE_KEY, state) {
        h.log_warn(&format!("detect: persist state failed: {e}"));
    }
}

/// 全量状态推送前端（guest 传事件全名，与前端订阅端一致）
pub(crate) fn push_state(h: &WasmHost) {
    let mut state = read_state(h);
    // 授权状态每次以 storage 标记为准（request-auth 命令可随时改写）
    if let Some(auth) = h.storage_get(AUTH_KEY).ok().flatten() {
        state["authGranted"] = json!(auth == json!("granted"));
    }
    // 单调递增序号：探测期间多次推送全量状态，前端按 seq 过滤乱序旧事件，
    // 只接受最新全量——避免中间态（某探测项仍 detecting）覆盖最终态，
    // 导致 UI 永久"检测中"（实测复现：storage 已 ok，界面卡 detecting）
    state["seq"] = json!(STATE_SEQ.fetch_add(1, Ordering::Relaxed) + 1);
    h.emit_event("plugin:agent-hub:detection", &state);
}

fn mark_detecting(state: &mut Value) {
    state["envStatus"] = json!("detecting");
    if let Some(clis) = state["clis"].as_object_mut() {
        for agent in agents::all() {
            if let Some(info) = clis.get_mut(agent.id()) {
                info["status"] = json!("detecting");
            }
        }
    }
}

/// 探测失败落态（无结论）：`unavailable` = 「探测本身没给出结论」（进程失败 /
/// 超时 / 输出不可解析），与「探测成功且确认不存在」（`not-installed`）是两件
/// 事——后者给安装按钮，前者只能给「重试检测」。失败明细保留在 `error` 字段。
///
/// 环境采集同口径：采集进程失败 → `envStatus=unavailable` + `envError` 明细；
/// 采集成功但某字段缺失（如没装 node）→ `envStatus=ok` + 该字段 `null`
/// （**不得**整体降级为失败）。
fn set_cli_error(state: &mut Value, kind: &str, message: &str) {
    if kind == ENV_KIND {
        state["envStatus"] = json!("unavailable");
        state["envError"] = json!(message);
    } else if let Some(clis) = state["clis"].as_object_mut() {
        clis.insert(
            kind.to_string(),
            json!({
                "status": "unavailable",
                "installed": null,
                "version": null,
                "method": "unknown",
                "paths": [],
                "dual": false,
                "error": message,
            }),
        );
    }
}

// ==================== 采集入口 ====================

/// 触发全量探测：先全部标记 detecting 推送（前端即时进加载态），再逐项 spawn
pub(crate) fn spawn_all(h: &WasmHost) -> anyhow::Result<()> {
    let data_dir = DATA_DIR
        .get()
        .ok_or_else(|| anyhow::anyhow!("detect: data dir unavailable (activate incomplete)"))?;

    {
        let mut state = read_state(h);
        mark_detecting(&mut state);
        write_state(h, &state);
    }
    push_state(h);

    // 平台判定只读一次（运行期宿主 os.platform），脚本内容与执行壳共用同一口径：
    // 脚本按 windows 分派、进程也按 windows 分派，两者不一致会拿到错的执行壳
    let windows = is_windows();

    let mut kinds: Vec<(&'static str, String)> = vec![(ENV_KIND, env_detection_script(windows))];
    for agent in agents::all().iter().copied() {
        kinds.push((agent.id(), cli_detection_script(agent, windows)));
    }
    // 批跟踪：本轮发起的 run 全部收敛才算一次探测完成（旧批集合整体替换，
    // 迟到旧 run 完成事件不误触发后续动作）
    let mut runs = detect_runs()
        .lock()
        .map_err(|e| anyhow::anyhow!("detect: poisoned batch map: {e}"))?;
    runs.clear();
    let mut spawned = 0usize;
    for (kind, script) in kinds {
        let seq = RUN_SEQ.fetch_add(1, Ordering::Relaxed);
        let output_path = format!("{data_dir}/runs/{kind}-{seq}.log");
        let (command, args) = shell_invocation(script, windows);
        let request = json!({
            "command": command,
            "args": args,
            "output_path": output_path,
            "timeout_ms": TIMEOUT_MS,
        });
        match h.process_run(&request.to_string()) {
            Ok(run_id) => {
                runs.insert(run_id.clone());
                spawned += 1;
                let mut map = pending()
                    .lock()
                    .map_err(|e| anyhow::anyhow!("detect: poisoned pending map: {e}"))?;
                map.insert(
                    run_id,
                    PendingRun {
                        kind: kind.to_string(),
                        output_path,
                        cli: None,
                        source: None,
                    },
                );
            }
            Err(e) => {
                h.log_warn(&format!("detect: spawn {kind} failed: {e}"));
                let mut state = read_state(h);
                set_cli_error(&mut state, kind, &e.to_string());
                write_state(h, &state);
            }
        }
    }
    drop(runs);
    // 本批一个 run 都没发起（全部 spawn 失败）：pending 更新检查无从等待收敛，
    // 复位标志，避免残留到后续普通探测收敛时误触发
    if spawned == 0 {
        PENDING_UPDATE_CHECK.store(false, Ordering::Relaxed);
    }
    push_state(h);
    Ok(())
}

/// 进程完成回灌：按 run_id 归属 → 读输出 → 解析 → 持久化 → 推送
pub(crate) fn handle_process_done(event: &ProcessDoneEvent) -> anyhow::Result<()> {
    let h = host();
    let removed = pending()
        .lock()
        .map_err(|e| anyhow::anyhow!("process-done: poisoned pending map: {e}"))?
        .remove(&event.run_id);
    let Some(entry) = removed else {
        // 非本插件的进程回调，或停用清理后的迟到回调——放行
        return Ok(());
    };
    let kind = entry.kind;
    let output_path = entry.output_path;

    h.log_info(&format!(
        "detect: {kind} run finished (exit_code={:?}, timed_out={})",
        event.exit_code, event.timed_out
    ));

    let mut state = read_state(&h);
    if event.timed_out || event.exit_code != Some(0) {
        set_cli_error(
            &mut state,
            &kind,
            &format!("exit={:?} timed_out={}", event.exit_code, event.timed_out),
        );
    } else {
        match h.fs_read(&output_path) {
            Ok(Some(output)) => {
                apply_output(&mut state, &kind, &output);
                // 采集完成即清理输出文件，防 runs 目录堆积（尽力而为）
                let _ = h.fs_delete(&output_path);
            }
            Ok(None) => set_cli_error(&mut state, &kind, "output file missing"),
            Err(e) => set_cli_error(&mut state, &kind, &format!("read output failed: {e}")),
        }
    }
    write_state(&h, &state);
    push_state(&h);
    // 探测收敛钩子：本批 run 完成时移除判定，全部完成且安装域有 pending
    // 更新检查时自动查最新版本（本地版本此刻已刷新）
    maybe_run_update_check(&h, &event.run_id);
    // 引导重探测收敛：env 段完成即判引导结果（phase == reprobing 时才生效）
    if kind == ENV_KIND {
        crate::env::on_env_probe(&h, &state);
    }
    Ok(())
}

fn apply_output(state: &mut Value, kind: &str, output: &str) {
    if kind == ENV_KIND {
        state["envStatus"] = json!("ok");
        state["env"] = parse_env(output);
        // 系统环境行：平台名由宿主导入（os.platform，激活时缓存），非 shell 采集
        ensure_env_os(&mut state["env"]);
        // 清除历史失败残留（如修复前探测的 exit=127 envError），避免 UI 混淆
        state["envError"] = Value::Null;
    } else if let Some(agent) = agents::get(kind) {
        let mut info = parse_cli(agent, output);
        info["status"] = json!(if info["installed"] == json!(true) {
            "ok"
        } else {
            "not-installed"
        });
        state["clis"][kind] = info;
    } else {
        // 注册表已无该 id（旧版本在途 run 的迟到回灌）：fail-visible 落错误
        set_cli_error(state, kind, &format!("unknown agent: {kind}"));
    }
}

// ==================== 采集脚本（按平台分派，分段标记两端一致） ====================

/// 环境采集脚本分派（运行期平台，`windows` 由 `spawn_all` 传入）：
/// Windows 用 `cmd /C` 链式（`2>nul` 抑制未装报错）；
/// unix 用登录 shell + PATH 引导
fn env_detection_script(windows: bool) -> String {
    if windows {
        env_script_windows()
    } else {
        env_script_unix()
    }
}

/// 单 CLI 采集脚本分派（运行期平台，`windows` 由 `spawn_all` 传入）：
/// Windows `where` 全命中（`2>nul` 抑制未装报错）；
/// unix `which -a` 全命中（二进制名来自适配器，默认等于 id）
fn cli_detection_script(agent: &dyn Agent, windows: bool) -> String {
    let bin = agent.binary();
    if windows {
        cli_script_windows(bin)
    } else {
        cli_script_unix(bin)
    }
}

/// Windows 环境采集：`cmd /C` 链式命令（`2>&1` 收未装报错行，`&` 串接不因
/// 单条失败中断后续分段）。段标记与 unix 形态逐段一致，解析层不分平台。
/// 脚本头前置引导出来的 node 目录（[`crate::env::shell_env_prefix`]）：
/// 刚装完 node 的机器无需重启应用即可被探测到。
fn env_script_windows() -> String {
    format!(
        "{}{}",
        crate::env::shell_env_prefix(true),
        "echo == node == & node --version 2>&1 & echo == npm == & npm --version 2>&1 & echo == pnpm == & pnpm --version 2>&1 & echo == registry == & npm config get registry 2>&1 & echo == python == & py --version 2>&1 || python --version 2>&1 & echo == arch == & echo %PROCESSOR_ARCHITECTURE% & echo == os_version == & ver 2>&1 & echo == shell == & echo %COMSPEC%"
    )
}

/// Windows 单 CLI 采集：`where` 全命中（PATHEXT 解析 npm shim）+ 版本行
fn cli_script_windows(bin: &str) -> String {
    format!(
        "{}echo == paths == & where {bin} 2>nul & echo == version == & {bin} --version 2>&1",
        crate::env::shell_env_prefix(true)
    )
}

/// unix PATH 引导前缀：登录 shell 不读 `~/.bashrc`（其交互守卫
/// `case $- in *i*)` 在非交互 shell 下直接 return，`~/.profile` 的 source
/// 同样被拦截），nvm 等 PATH 注入因而失效，node/npm/pnpm 探测全部
/// not found。改为从交互子 shell 提取 PATH（`2>/dev/null` 吞无 tty 的
/// ioctl 警告；`tail -n 1` 取末行，防 rc 启动输出污染），再在当前非交互
/// shell 继续采集——两侧段标记契约不受影响。
pub(crate) fn path_bootstrap_unix() -> &'static str {
    "export PATH=\"$(bash -ic 'printf \"%s\\n\" \"$PATH\"' 2>/dev/null | tail -n 1)\"\n"
}

/// unix 单 CLI 采集：`which -a` 全部 PATH 命中 + 版本行；未安装时 paths 为空、
/// version 段只有 shell 报错行 → not-installed
fn cli_script_unix(bin: &str) -> String {
    format!(
        "{}{}echo '== paths =='\nwhich -a {bin} 2>/dev/null\necho '== version =='\n{bin} --version 2>&1 | head -n 2\n",
        path_bootstrap_unix(),
        crate::env::shell_env_prefix(false)
    )
}

/// unix 环境采集：node / npm / pnpm 版本 + 当前 npm registry。
/// PATH 引导之后紧接引导出来的 node 目录（覆盖 nvm 之外的干净机器场景）。
fn env_script_unix() -> String {
    format!(
        "{}{}echo '== node =='\nnode --version 2>&1\necho '== npm =='\nnpm --version 2>&1\necho '== pnpm =='\npnpm --version 2>&1\necho '== registry =='\nnpm config get registry 2>&1\necho '== python =='\npython3 --version 2>&1 || python --version 2>&1\necho '== arch =='\nuname -m\necho '== os_version =='\nuname -sr\necho '== shell =='\necho $SHELL\n",
        path_bootstrap_unix(),
        crate::env::shell_env_prefix(false)
    )
}

// ==================== 输出解析 ====================

/// 解析单 CLI 输出（分段：== paths == / == version ==）；安装方式归类与二进制名
/// 均来自适配器（注册表唯一真源）
pub(crate) fn parse_cli(agent: &dyn Agent, output: &str) -> Value {
    let mut paths: Vec<String> = vec![];
    let mut version: Option<String> = None;
    let mut section = "";
    for line in output.lines() {
        let line = line.trim();
        match line {
            "== paths ==" => {
                section = "paths";
                continue;
            }
            "== version ==" => {
                section = "version";
                continue;
            }
            _ => {}
        }
        if line.is_empty() {
            continue;
        }
        match section {
            // which/where 命中行：unix 以 `/` 开头，Windows 为盘符路径；未命中时该段为空
            "paths" => {
                if let Some(p) = normalize_path_line(line) {
                    if !paths.contains(&p) {
                        paths.push(p);
                    }
                }
            }
            "version" => {
                if version.is_none() {
                    version = extract_version(line);
                }
            }
            _ => {}
        }
    }
    let installed = !paths.is_empty() && version.is_some();
    json!({
        "status": "ok",
        "installed": installed,
        "version": version,
        "method": classify(agent, &paths),
        "paths": paths,
        "dual": paths.len() > 1,
        "error": null,
    })
}

/// 路径行识别 + 规范化：unix 以 `/` 开头；Windows 为盘符路径（`X:\...`，
/// where 输出反斜杠）。统一转 `/` 分隔存储——归类与前端展示共用
fn normalize_path_line(line: &str) -> Option<String> {
    let is_path = line.starts_with('/')
        || (line.len() >= 2
            && line.as_bytes()[0].is_ascii_alphabetic()
            && line.as_bytes()[1] == b':');
    if is_path {
        Some(line.replace('\\', "/"))
    } else {
        None
    }
}

/// 从版本行提取语义版本 token，兼容 `codex-cli 0.153.4` / `2.1.263 (Claude Code)` /
/// `0.85.1` / `opencode v2.0.29` 等形态（无 regex 依赖：取首个「至少两段、首段
/// 纯数字」的 token，允许前导 `v`/`V` 前缀——opencode 2.x 起 `--version` 输出
/// `opencode v2.0.29`，无前缀规则会把 `v2` 当非数字段而漏掉整行，CLI 已装却
/// 判未安装）
fn extract_version(line: &str) -> Option<String> {
    line.split_whitespace().find_map(|tok| {
        let core = tok
            .strip_prefix('v')
            .or_else(|| tok.strip_prefix('V'))
            .unwrap_or(tok);
        let mut parts = core.split('.');
        let Some(first) = parts.next() else {
            return None;
        };
        if first.is_empty() || !first.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let ok = parts
            .next()
            .and_then(|p| p.chars().next())
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false);
        ok.then(|| {
            core.trim_matches(|c: char| c == '(' || c == ')' || c == ',')
                .to_string()
        })
    })
}

/// 安装方式归类：以 PATH 首位（实际生效者）为准
///
/// 输入已规范化为 `/` 分隔；Windows 路径大小写不敏感，统一小写后匹配特征。
/// 顺序：适配器声明的私有路径特征（如 claude native `~/.local/bin`、
/// opencode standalone `~/.opencode/bin`）优先，未命中再走公共 npm 全局特征
/// （nvm（unix/nvm-windows）/ node 全局 bin（Windows 为 `%APPDATA%\Roaming\npm`
/// shim 目录，另含 volta、pnpm 全局目录特征））。
fn classify(agent: &dyn Agent, paths: &[String]) -> &'static str {
    let Some(primary) = paths.first() else {
        return "unknown";
    };
    let p = primary.to_lowercase();
    for &(needle, method) in agent.path_methods() {
        if p.contains(needle) {
            return method;
        }
    }
    if is_npm_global_path(&p) {
        return "npm-global";
    }
    "unknown"
}

/// 公共 npm 全局安装路径特征（大小写不敏感输入）
///
/// `npm-global` 是 agent-hub 引导 node 后的 npm 全局落点（升级 node 不改该
/// 目录）：装出来的 CLI 必须归类为 `npm-global`，否则卸载会走「方式未知」。
fn is_npm_global_path(p: &str) -> bool {
    p.contains("nvm")
        || p.contains("/node-v")
        || p.contains("node_modules")
        || p.contains("/.npm-global")
        || p.contains("/npm-global/")
        || p.contains("/.local/share/pnpm")
        || p.contains("volta")
        || p.contains("/roaming/npm/")
        || p.contains("/program files/nodejs")
}

/// 解析环境输出（分段：== node == / == npm == / == pnpm == / == registry == /
/// == python == / == arch == / == os_version == / == shell ==）；
/// 各段取首个非空行，未安装工具的 shell 报错行不算值（该字段为 null）
pub(crate) fn parse_env(output: &str) -> Value {
    let mut node: Option<String> = None;
    let mut npm: Option<String> = None;
    let mut pnpm: Option<String> = None;
    let mut registry: Option<String> = None;
    let mut python: Option<String> = None;
    let mut arch: Option<String> = None;
    let mut os_version: Option<String> = None;
    let mut shell: Option<String> = None;
    let mut section = "";
    for line in output.lines() {
        let line = line.trim();
        match line {
            "== node ==" => {
                section = "node";
                continue;
            }
            "== npm ==" => {
                section = "npm";
                continue;
            }
            "== pnpm ==" => {
                section = "pnpm";
                continue;
            }
            "== registry ==" => {
                section = "registry";
                continue;
            }
            "== python ==" => {
                section = "python";
                continue;
            }
            "== arch ==" => {
                section = "arch";
                continue;
            }
            "== os_version ==" => {
                section = "os_version";
                continue;
            }
            "== shell ==" => {
                section = "shell";
                continue;
            }
            _ => {}
        }
        if line.is_empty() {
            continue;
        }
        match section {
            "node" => {
                if node.is_none() {
                    node = section_value(line);
                }
            }
            "npm" => {
                if npm.is_none() {
                    npm = section_value(line);
                }
            }
            "pnpm" => {
                if pnpm.is_none() {
                    pnpm = section_value(line);
                }
            }
            "registry" => {
                if registry.is_none() {
                    registry = section_value(line);
                }
            }
            "python" => {
                if python.is_none() {
                    python = section_value(line);
                }
            }
            "arch" => {
                if arch.is_none() {
                    arch = Some(line.to_string());
                }
            }
            "os_version" => {
                if os_version.is_none() {
                    os_version = Some(line.to_string());
                }
            }
            "shell" => {
                if shell.is_none() {
                    shell = Some(line.to_string());
                }
            }
            _ => {}
        }
    }
    json!({ "node": node, "npm": npm, "pnpm": pnpm, "registry": registry, "python": python, "arch": arch, "osVersion": os_version, "shell": shell })
}

/// 段内取值：未安装工具的 shell 报错行不算值（→ 该字段 null）
///
/// unix 未装：`bash: node: command not found` / `sh: node: not found`；
/// Windows 未装：`'node' is not recognized as an internal or external command`
/// （英文 locale）或 `'node' 不是内部或外部命令，也不是可运行的程序或批处理文件。`
/// （中文 locale）——两者都表示「工具不存在」，不能当版本值上屏。
fn section_value(line: &str) -> Option<String> {
    if is_missing_tool_line(line) {
        None
    } else {
        Some(line.to_string())
    }
}

/// 未安装工具的报错行识别（双平台文案）：命中即「该工具不存在」，不是值
fn is_missing_tool_line(line: &str) -> bool {
    line.contains("not found")
        || line.contains("not recognized")
        || line.contains("未找到")
        || line.contains("不是内部或外部命令")
}

// ==================== Tests（native 编译下的纯函数单测） ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 经注册表取适配器（探测解析/归类的唯一入口）
    fn agent(id: &str) -> &'static dyn Agent {
        agents::get(id).unwrap_or_else(|| panic!("agent not registered: {id}"))
    }

    /// codex 形态：版本带 CLI 名前缀；本机已装 → npm-global
    #[test]
    fn parse_cli_codex() {
        let out = "== paths ==\n/home/u/.config/nvm/versions/node/v24.20.0/bin/codex\n== version ==\ncodex-cli 0.153.4\n";
        let info = parse_cli(agent("codex"), out);
        assert_eq!(info["installed"], json!(true));
        assert_eq!(info["version"], json!("0.153.4"));
        assert_eq!(info["method"], json!("npm-global"));
        assert_eq!(info["dual"], json!(false));
    }

    /// opencode 双安装：standalone 生效（PATH 首位）+ npm 并存 → dual + standalone
    #[test]
    fn parse_cli_opencode_dual_install() {
        let out = "== paths ==\n/home/u/.opencode/bin/opencode\n/home/u/.config/nvm/versions/node/v24.20.0/bin/opencode\n== version ==\nopencode 1.18.30\n";
        let info = parse_cli(agent("opencode"), out);
        assert_eq!(info["dual"], json!(true));
        assert_eq!(info["method"], json!("standalone"));
        assert_eq!(info["version"], json!("1.18.30"));
        assert_eq!(info["paths"].as_array().unwrap().len(), 2);
    }

    /// claude native：~/.local/bin 命中 + 括号后缀版本行
    #[test]
    fn parse_cli_claude_native() {
        let out = "== paths ==\n/home/u/.local/bin/claude\n== version ==\n2.1.263 (Claude Code)\n";
        let info = parse_cli(agent("claude"), out);
        assert_eq!(info["method"], json!("native"));
        assert_eq!(info["version"], json!("2.1.263"));
    }

    /// 未安装：paths 为空、version 段只有 shell 报错行 → not-installed 前置数据
    #[test]
    fn parse_cli_not_installed() {
        let out = "== paths ==\n== version ==\nbash: codex: command not found\n";
        let info = parse_cli(agent("codex"), out);
        assert_eq!(info["installed"], json!(false));
        assert_eq!(info["version"], json!(null));
        assert_eq!(info["paths"].as_array().unwrap().len(), 0);
    }

    /// pi 版本行为纯 token；版本 token 不吞括号（claude 形态）
    #[test]
    fn extract_version_variants() {
        assert_eq!(extract_version("0.85.1"), Some("0.85.1".to_string()));
        assert_eq!(
            extract_version("codex-cli 0.153.4"),
            Some("0.153.4".to_string())
        );
        assert_eq!(
            extract_version("2.1.263 (Claude Code)"),
            Some("2.1.263".to_string())
        );
        // 单段数字不是版本
        assert_eq!(extract_version("some note 42"), None);
    }

    /// opencode 2.x 形态：`--version` 输出带 v 前缀（opencode v2.0.29），
    /// 旧规则把 `v2` 当非数字段漏掉 → 已装判未安装（2026-10-20 实测回归）
    #[test]
    fn extract_version_opencode_v_prefix() {
        assert_eq!(
            extract_version("opencode v2.0.29"),
            Some("2.0.29".to_string())
        );
        assert_eq!(extract_version("opencode V2.0.29"), Some("2.0.29".to_string()));
        // 独立 v token 不干扰后续版本 token（v 2.0.29 形态：v 自身不匹配）
        assert_eq!(extract_version("v 2.0.29"), Some("2.0.29".to_string()));
        // 纯 v 不是版本；vv2.0 剥一前缀后首段仍非纯数字
        assert_eq!(extract_version("v"), None);
        assert_eq!(extract_version("vv2.0.29"), None);
    }

    /// opencode 2.x 全链路：PATH 命中 + v 前缀版本行 → installed=true、版本
    /// 剥前缀（npm-global 归类不受影响，卸载仍走 npm）
    #[test]
    fn parse_cli_opencode_v2() {
        let out = "== paths ==\n/home/u/.config/nvm/versions/node/v24.20.0/bin/opencode\n== version ==\nopencode v2.0.29\n";
        let info = parse_cli(agent("opencode"), out);
        assert_eq!(info["installed"], json!(true));
        assert_eq!(info["status"], json!("ok"));
        assert_eq!(info["version"], json!("2.0.29"));
        assert_eq!(info["method"], json!("npm-global"));
        assert_eq!(info["dual"], json!(false));
    }

    /// 环境解析：pnpm 报错行不算版本；registry 原样透传；新字段缺段时为 null
    #[test]
    fn parse_env_sections() {
        let out = "== node ==\nv24.20.0\n== npm ==\n12.0.2\n== pnpm ==\n== registry ==\nhttps://registry.npmjs.org/\n";
        let env = parse_env(out);
        assert_eq!(env["node"], json!("v24.20.0"));
        assert_eq!(env["npm"], json!("12.0.2"));
        assert_eq!(env["registry"], json!("https://registry.npmjs.org/"));
        assert_eq!(env["pnpm"], json!(null));
        assert_eq!(env["python"], json!(null));
        assert_eq!(env["arch"], json!(null));
        assert_eq!(env["osVersion"], json!(null));
        assert_eq!(env["shell"], json!(null));
    }

    /// pnpm 未安装：报错行被过滤
    #[test]
    fn parse_env_pnpm_missing() {
        let out = "== node ==\nv24.20.0\n== npm ==\n12.0.2\n== pnpm ==\nbash: pnpm: command not found\n== registry ==\nhttps://registry.npmjs.org/\n";
        let env = parse_env(out);
        assert_eq!(env["pnpm"], json!(null));
    }

    /// env.os 字段：缺失时回填平台名，已有值不被覆盖（宿主注入，非 shell 采集）
    #[test]
    fn ensure_env_os_backfills_without_overriding() {
        let mut env = json!({ "node": "v24.20.0" });
        ensure_env_os(&mut env);
        assert!(env["os"].as_str().is_some_and(|s| !s.is_empty()));

        env["os"] = json!("windows");
        ensure_env_os(&mut env);
        assert_eq!(env["os"], json!("windows"));
    }

    /// apply_output 注入 os：探测完成后 env 块携带平台名，envStatus=ok
    #[test]
    fn apply_output_env_injects_os() {
        let mut state = json!({});
        apply_output(
            &mut state,
            ENV_KIND,
            "== node ==\nv24.20.0\n== npm ==\n12.0.2\n== pnpm ==\n12.2.1\n== registry ==\nhttps://registry.npmjs.org/\n",
        );
        assert_eq!(state["envStatus"], json!("ok"));
        assert_eq!(state["env"]["node"], json!("v24.20.0"));
        assert!(state["env"]["os"].as_str().is_some_and(|s| !s.is_empty()));
        // 新字段缺段时为 null（不会 panic）
        assert_eq!(state["env"]["python"], json!(null));
        assert_eq!(state["env"]["osVersion"], json!(null));
    }

    /// Windows 形态：where 反斜杠输出规范化 + 盘符路径识别；npm 全局
    /// （Roaming/npm shim）、claude native（%USERPROFILE%\.local\bin）、
    /// opencode standalone（%USERPROFILE%\.opencode\bin）归类
    #[test]
    fn parse_cli_windows_paths() {
        let out =
            "== paths ==\nC:\\Users\\u\\AppData\\Roaming\\npm\\pi.cmd\n== version ==\n0.85.1\n";
        let info = parse_cli(agent("pi"), out);
        assert_eq!(info["installed"], json!(true));
        assert_eq!(info["method"], json!("npm-global"));
        assert_eq!(
            info["paths"][0],
            json!("C:/Users/u/AppData/Roaming/npm/pi.cmd")
        );

        let out = "== paths ==\nC:\\Users\\u\\.local\\bin\\claude.exe\n== version ==\n2.1.263 (Claude Code)\n";
        let info = parse_cli(agent("claude"), out);
        assert_eq!(info["method"], json!("native"));

        let out =
            "== paths ==\nC:\\Users\\u\\.opencode\\bin\\opencode.exe\n== version ==\n1.18.30\n";
        let info = parse_cli(agent("opencode"), out);
        assert_eq!(info["method"], json!("standalone"));
    }

    /// 脚本以 PATH 引导开头（登录 shell 不读 ~/.bashrc，nvm 注入依赖引导），
    /// 段标记保持后端解析契约不变
    #[test]
    fn scripts_carry_path_bootstrap() {
        assert!(env_script_unix().starts_with(path_bootstrap_unix()));
        assert!(cli_script_unix("pi").starts_with(path_bootstrap_unix()));
        assert!(env_script_unix().contains("== registry =="));
        assert!(cli_script_unix("pi").contains("== version =="));
        // 新增段标记存在
        assert!(env_script_unix().contains("== python =="));
        assert!(env_script_unix().contains("== arch =="));
        assert!(env_script_unix().contains("== os_version =="));
        assert!(env_script_unix().contains("== shell =="));
    }

    // ==================== 平台脚本分派（运行期，双形态断言） ====================
    //
    // 回归锁：脚本内容曾用编译期 `cfg!(windows)` 选择（wasm guest 恒 false），
    // Windows 机器因此拿到 POSIX 脚本，`cmd /C` 第一行 `export` 即 exit 1，
    // 探测全线失败（2026-10-22 实机事故）。此处**显式传参**断言两种形态，
    // 与构建平台无关——宿主机上跑 Linux 也必须能覆盖 Windows 分支。

    /// Windows 环境采集：cmd 链式 + `%PROCESSOR_ARCHITECTURE%` / `%COMSPEC%`，
    /// 不得混入 POSIX 片段（`export PATH` / `uname -m`）
    #[test]
    fn env_script_windows_form() {
        let script = env_detection_script(true);
        assert!(script.contains("%PROCESSOR_ARCHITECTURE%"));
        assert!(script.contains("%COMSPEC%"));
        assert!(script.contains("== node =="));
        assert!(script.contains("== registry =="));
        assert!(script.contains("== shell =="));
        // 不得混入 unix 形态片段
        assert!(!script.contains("export PATH"));
        assert!(!script.contains("uname -m"));
        assert!(!script.contains("which -a"));
    }

    /// unix 环境采集：登录 shell + PATH 引导 + `uname -m`，不得混入 cmd 片段
    #[test]
    fn env_script_unix_form() {
        let script = env_detection_script(false);
        assert!(script.contains("export PATH"));
        assert!(script.contains("uname -m"));
        assert!(script.contains("== node =="));
        assert!(script.contains("== registry =="));
        assert!(!script.contains("%COMSPEC%"));
        assert!(!script.contains("%PROCESSOR_ARCHITECTURE%"));
        assert!(!script.contains("where "));
    }

    /// 单 CLI 采集双形态：Windows `where` / unix `which -a`，两者互不串味
    /// （四种 CLI 各断言一次——二进制名不同，`where`/`which` 形态都需覆盖）
    #[test]
    fn cli_script_platform_forms() {
        for agent in agents::all().iter().copied() {
            let bin = agent.binary();
            let win = cli_detection_script(agent, true);
            assert!(
                win.contains(&format!("where {bin} 2>nul")),
                "cli: {bin}, got: {win}"
            );
            assert!(win.contains("== paths =="), "cli: {bin}");
            assert!(win.contains("== version =="), "cli: {bin}");
            assert!(!win.contains("export PATH"), "cli: {bin}");
            assert!(!win.contains("which -a"), "cli: {bin}");

            let unix = cli_detection_script(agent, false);
            assert!(
                unix.contains(&format!("which -a {bin}")),
                "cli: {bin}, got: {unix}"
            );
            assert!(unix.contains("== paths =="), "cli: {bin}");
            assert!(unix.contains("== version =="), "cli: {bin}");
            assert!(!unix.contains("where "), "cli: {bin}");
            assert!(!unix.contains("%COMSPEC%"), "cli: {bin}");
        }
    }

    /// 分派函数只认入参：把 `windows` 写死为 false 时 Windows 分支用例必须红
    /// （变异自检——本组断言就是该变异的探测器）
    #[test]
    fn detection_script_dispatch_follows_argument() {
        assert_eq!(
            env_detection_script(true),
            env_script_windows(),
            "windows=true 必须给 Windows 形态"
        );
        assert_eq!(
            env_detection_script(false),
            env_script_unix(),
            "windows=false 必须给 unix 形态"
        );
        assert_ne!(env_detection_script(true), env_detection_script(false));
    }

    // ==================== 三态（not-installed / ready / unavailable） ====================

    /// 探测失败 → `unavailable`（不是 `not-installed`，也不是旧的 `error`）：
    /// 「探测没结论」与「探测成功且确认不存在」是两种用户动作
    #[test]
    fn cli_probe_failure_is_unavailable() {
        let mut state = json!({ "clis": {} });
        set_cli_error(&mut state, "claude", "exit=Some(1) timed_out=false");
        let info = &state["clis"]["claude"];
        assert_eq!(info["status"], json!("unavailable"));
        assert_eq!(info["installed"], json!(null));
        assert_eq!(info["method"], json!("unknown"));
        assert_eq!(info["error"], json!("exit=Some(1) timed_out=false"));
    }

    /// 环境采集进程失败 → `envStatus=unavailable` + 明细进 `envError`
    #[test]
    fn env_probe_failure_is_unavailable() {
        let mut state = json!({});
        set_cli_error(&mut state, ENV_KIND, "exit=Some(1) timed_out=false");
        assert_eq!(state["envStatus"], json!("unavailable"));
        assert_eq!(state["envError"], json!("exit=Some(1) timed_out=false"));
    }

    /// cmd 报错行（未装）→ `not-installed`：探测**成功**且确认不存在，
    /// 与 `unavailable` 严格区分
    #[test]
    fn cmd_not_found_line_means_not_installed() {
        let out = "== paths ==\n== version ==\n'claude' 不是内部或外部命令，也不是可运行的程序或批处理文件。\n";
        let info = parse_cli(agent("claude"), out);
        assert_eq!(info["installed"], json!(false));
        assert_eq!(info["paths"].as_array().unwrap().len(), 0);
        // 解析层只给事实，终态由 apply_output 落
        let mut state = json!({ "clis": {} });
        apply_output(&mut state, "claude", out);
        assert_eq!(state["clis"]["claude"]["status"], json!("not-installed"));
    }

    /// 探测成功但没装 node → `envStatus=ok` + `env.node=null`（**不得**整体失败）
    #[test]
    fn env_missing_node_is_ok_with_null_field() {
        let out = "== node ==\n'node' 不是内部或外部命令，也不是可运行的程序或批处理文件。\n== npm ==\n== pnpm ==\n== registry ==\n";
        let mut state = json!({});
        apply_output(&mut state, ENV_KIND, out);
        assert_eq!(state["envStatus"], json!("ok"));
        assert_eq!(state["env"]["node"], json!(null));
        assert_eq!(state["env"]["npm"], json!(null));
        // 历史失败残留被一次成功探测清除
        assert_eq!(state["envError"], json!(null));
    }

    /// 历史 `unavailable` 残留被一次成功探测清除（CLI 三态同口径）
    #[test]
    fn successful_probe_clears_stale_unavailable() {
        let mut state = json!({ "clis": {} });
        set_cli_error(&mut state, "pi", "exit=Some(1) timed_out=false");
        assert_eq!(state["clis"]["pi"]["status"], json!("unavailable"));

        let out = "== paths ==\n/home/u/.local/bin/pi\n== version ==\n0.85.1\n";
        apply_output(&mut state, "pi", out);
        let info = &state["clis"]["pi"];
        assert_eq!(info["status"], json!("ok"));
        assert_eq!(info["installed"], json!(true));
        assert_eq!(info["error"], json!(null));
    }

    /// 新增段（python / arch / os_version / shell）全量解析：python 和 pnpm
    /// 同为可缺失项（报错行过滤），arch/os_version/shell 恒有输出
    #[test]
    fn parse_env_new_sections_present() {
        let out = "== node ==\nv24.20.0\n== npm ==\n12.0.2\n== pnpm ==\n12.2.1\n== registry ==\nhttps://registry.npmjs.org/\n== python ==\nbash: python3: command not found\n== arch ==\naarch64\n== os_version ==\nLinux 6.12.0-rc7+\n== shell ==\n/bin/zsh\n";
        let env = parse_env(out);
        // python 未安装：报错行被过滤，值为 null
        assert_eq!(env["python"], json!(null));
        assert_eq!(env["arch"], json!("aarch64"));
        assert_eq!(env["osVersion"], json!("Linux 6.12.0-rc7+"));
        assert_eq!(env["shell"], json!("/bin/zsh"));
    }

    /// Windows cmd：pnpm 未装的报错行（'pnpm' is not recognized）不算版本
    #[test]
    fn parse_env_pnpm_missing_windows() {
        let out = "== node ==\nv24.20.0\n== npm ==\n12.0.2\n== pnpm ==\n'pnpm' is not recognized as an internal or external command\n== registry ==\nhttps://registry.npmjs.org/\n";
        let env = parse_env(out);
        assert_eq!(env["pnpm"], json!(null));
    }

    // ==================== 探测批收敛判定 ====================

    /// 正例：本批最后一个 run 完成（remove 命中 + 集合变空）= 探测收敛
    #[test]
    fn batch_done_on_last_run() {
        let mut runs = HashSet::from(["a".to_string(), "b".to_string()]);
        assert!(!is_batch_done(&mut runs, "a"));
        assert!(is_batch_done(&mut runs, "b"));
    }

    /// 反例：run_id 不在本批（旧轮迟到的完成事件）时绝不判收敛——即使集合
    /// 恰好已空也不触发后续动作（并发重探测下集合已被下一轮整体替换）
    #[test]
    fn stale_run_never_finishes_batch() {
        let mut runs = HashSet::new();
        assert!(!is_batch_done(&mut runs, "stale-run"));
        assert!(runs.is_empty(), "remove 未命中不得改动集合");
    }
}
