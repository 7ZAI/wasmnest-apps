//! 删除 / 卸载 skill（规范库 + 全部分发副本）
//!
//! 真源模型是「规范库 + 逐文件复制到各 CLI 私有目录」（见父模块文档）。
//! 只删规范库会让 `~/.claude/skills/<dir>`、`~/.pi/agent/skills/<dir>` 变成
//! 无人清理的孤儿副本——CLI 仍能读到该 skill，等于没删掉。故本命令的语义
//! 是**卸载**：规范库目录与全部分发目标副本一并删除，相关 agent 立即失去
//! 该 skill。
//!
//! WIT host-fs 只有单文件 `fs_delete`、没有删目录原语，故目录删除经
//! host-process 走平台分派 shell（unix `rm -rf --`、Windows `rmdir /s /q`；
//! 路径经 `sh_quote` 转义，入口再拒绝控制字符与 `"` / `%`）。成败不靠退出码
//! （Windows `&` 串联只反映最后一条），回灌时逐路径 `fs_exists` 复查：
//! 全部消失才从域状态移除条目，随后触发重扫对齐磁盘。

use super::scan::scan;
use super::SCAN_TIMEOUT_MS;
use super::{emit_and_return, read_state, target_roots, write_state, LIBRARY_SEG, RUN_SEQ};
use crate::hub::install::now_ms;
use crate::hub::util::{is_windows, path_rejected_for_script, sh_quote, shell_invocation};
use crate::hub::{host, pending, PendingRun, DATA_DIR, HOME};
use serde_json::{json, Value};
use std::sync::atomic::Ordering as AtomicOrdering;
use wasmnest_plugin_api::events::ProcessDoneEvent;
use wasmnest_plugin_api::host::{HostFs, HostLog, HostProcess};
use wasmnest_plugin_api::wasm_host::WasmHost;

// ==================== 纯函数：删除目标与脚本 ====================

/// 删除目标路径表：`("lib", 规范库目录)` + 各分发目标 `(目标名, 副本目录)`。
///
/// 名只用于回灌时的归因（残留哪一侧、清理了几个副本），不参与路径拼接。
pub(super) fn delete_paths(home: &str, dir: &str) -> Vec<(&'static str, String)> {
    let mut paths: Vec<(&'static str, String)> =
        vec![("lib", format!("{home}/{LIBRARY_SEG}/{dir}"))];
    paths.extend(
        target_roots(home)
            .into_iter()
            .map(|(name, root)| (name, format!("{root}/{dir}"))),
    );
    paths
}

/// 删除脚本（双平台分派）：unix 一条 `rm -rf --` 带全部路径；Windows 逐条
/// `rmdir /s /q` 用 `&` 串联（目录不存在时 `2>nul` 抑制噪音）。
///
/// 路径经 `sh_quote` 单引号转义（与 scan / import 同一安全底线），Windows 侧
/// 的 `"` 与 `%` 已由调用方 `path_rejected_for_script` 拒绝。
pub(super) fn delete_script(paths: &[String], windows: bool) -> String {
    if windows {
        paths
            .iter()
            .map(|p| format!("rmdir /s /q \"{p}\" 2>nul"))
            .collect::<Vec<_>>()
            .join(" & ")
    } else {
        format!(
            "rm -rf -- {}",
            paths
                .iter()
                .map(|p| sh_quote(p))
                .collect::<Vec<_>>()
                .join(" ")
        )
    }
}

// ==================== 异步流：删除 / 卸载 ====================

/// 删除 skill：校验目录名 → 组装「规范库 + 各目标副本」路径 → spawn 删除
/// 进程（异步）。`state.deleting` 置为待删目录名（前端据此禁用重复删除）。
///
/// 目录名必须已出现在库列表：拒绝把任意字符串当删除目标（与 dir 形态校验
/// 互补的第二道闸），也避免对尚未扫描的库做破坏性操作。
pub(crate) fn delete_skill(h: &WasmHost, args: &Value) -> anyhow::Result<Value> {
    let dir = args
        .get("dir")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("delete-skill: missing dir"))?;
    // dir 为库根下单段目录名：拒绝路径分隔符，防拼接逃逸
    if dir.is_empty() || dir.contains('/') || dir.contains('\\') || dir.contains("..") {
        return Err(anyhow::anyhow!("delete-skill: invalid dir"));
    }
    let home = HOME
        .get()
        .map(|s| s.as_str())
        .ok_or_else(|| anyhow::anyhow!("delete-skill: home unavailable"))?;

    let mut state = read_state(h);
    let known = state["skills"]
        .as_array()
        .map(|skills| skills.iter().any(|s| s["dir"] == json!(dir)))
        .unwrap_or(false);
    if !known {
        return Err(anyhow::anyhow!(
            "delete-skill: unknown skill {dir}（请先扫描）"
        ));
    }
    if state
        .get("deleting")
        .and_then(|v| v.as_str())
        .map(|d| !d.is_empty())
        .unwrap_or(false)
    {
        return Err(anyhow::anyhow!("delete-skill: another delete in progress"));
    }

    let paths: Vec<String> = delete_paths(home, dir)
        .into_iter()
        .map(|(_, p)| p)
        .collect();
    if let Some(bad) = paths.iter().find(|p| path_rejected_for_script(p)) {
        return Err(anyhow::anyhow!(
            "delete-skill: path contains characters unsupported by shell scripts: {bad}"
        ));
    }

    let windows = is_windows();
    let (command, args_vec) = shell_invocation(delete_script(&paths, windows), windows);
    let data_dir = DATA_DIR
        .get()
        .ok_or_else(|| anyhow::anyhow!("delete-skill: data dir unavailable"))?;
    let seq = RUN_SEQ.fetch_add(1, AtomicOrdering::Relaxed);
    let output_path = format!("{data_dir}/runs/skills-delete-{seq}.log");
    let request = json!({
        "command": command,
        "args": args_vec,
        "output_path": output_path,
        "timeout_ms": SCAN_TIMEOUT_MS,
    });
    let run_id = h
        .process_run(&request.to_string())
        .map_err(|e| anyhow::anyhow!("delete-skill: spawn failed: {e}"))?;

    pending()
        .lock()
        .map_err(|e| anyhow::anyhow!("skills: poisoned pending map: {e}"))?
        .insert(
            run_id,
            PendingRun {
                kind: "skills-delete".to_string(),
                output_path,
                cli: None,
                source: Some(dir.to_string()),
            },
        );

    state["deleting"] = json!(dir);
    write_state(h, &state);
    h.log_info(&format!("skills delete started (dir = {dir})"));
    emit_and_return(h, &state)
}

/// 删除进程回灌：逐路径复查磁盘（不采信 shell 退出码）→ 全部消失才从
/// `state.skills` 移除条目 → 结果落 `state.delete.last` → 触发重扫。
///
/// 有残留时条目保留（其分发状态随重扫按磁盘现状重算），错误必须可见
/// （fail-visible：不静默当成删除成功）。
pub(super) fn handle_delete_done(
    event: &ProcessDoneEvent,
    output_path: &str,
    dir: &str,
) -> anyhow::Result<()> {
    let h = host();
    let mut state = read_state(&h);
    state["deleting"] = json!(null);

    // 防御：回灌路径独立于命令入口，dir 为空会退化成「删整个库 / 整个 skills 根」。
    // 在途条目异常时只留痕、不动磁盘（fail-visible），不猜目标。
    let home = HOME.get().map(|s| s.as_str()).unwrap_or("");
    if dir.is_empty()
        || dir.contains('/')
        || dir.contains('\\')
        || dir.contains("..")
        || home.is_empty()
    {
        h.log_warn(&format!(
            "skills delete: invalid pending dir {dir:?} / home; skipped disk checks"
        ));
        write_state(&h, &state);
        return emit_and_return(&h, &state).map(|_| ());
    }

    let output = h
        .fs_read(output_path)
        .map_err(|e| anyhow::anyhow!("skills: read delete output failed: {e}"))?
        .unwrap_or_default();
    let _ = h.fs_delete(output_path);

    let name = state["skills"]
        .as_array()
        .and_then(|skills| skills.iter().find(|s| s["dir"] == json!(dir)))
        .and_then(|s| s["name"].as_str().map(|v| v.to_string()))
        .unwrap_or_else(|| dir.to_string());

    let mut removed: Vec<&'static str> = Vec::new();
    let mut remaining: Vec<String> = Vec::new();
    for (target, path) in delete_paths(home, dir) {
        match h.fs_exists(&path) {
            Ok(false) => removed.push(target),
            Ok(true) => remaining.push(format!("{target}: {path}")),
            // 复查本身失败：不能判定已删，按残留处理
            Err(e) => remaining.push(format!("{target}: {path} (check failed: {e})")),
        }
    }

    let ok = remaining.is_empty();
    if ok {
        if let Some(skills) = state["skills"].as_array_mut() {
            skills.retain(|s| s["dir"] != json!(dir));
        }
    }

    let mut error: Option<String> = None;
    if !remaining.is_empty() {
        let detail = if output.trim().is_empty() {
            remaining.join(", ")
        } else {
            format!("{} | {}", remaining.join(", "), output.trim())
        };
        error = Some(format!("residual paths: {detail}"));
    }
    if event.timed_out {
        error = Some(match error {
            Some(prev) => format!("delete timed out; {prev}"),
            None => "delete timed out".to_string(),
        });
    }

    let library_removed = removed.contains(&"lib");
    let removed_targets: Vec<&'static str> =
        removed.iter().copied().filter(|n| *n != "lib").collect();

    // 旧持久化状态没有 delete 段：显式建槽，避免对 null 逐层索引
    if state.get("delete").is_none() {
        state["delete"] = json!({ "last": null });
    }
    state["delete"]["last"] = json!({
        "ok": ok,
        "dir": dir,
        "name": name,
        "libraryRemoved": library_removed,
        "targets": removed_targets,
        "error": error,
        "at": now_ms(&h).unwrap_or(0),
    });
    write_state(&h, &state);
    if ok {
        h.log_info(&format!(
            "skills delete done (dir = {dir}, removed = {})",
            removed.len()
        ));
    } else {
        h.log_warn(&format!(
            "skills delete incomplete (dir = {dir}, residual = {})",
            remaining.len()
        ));
    }
    emit_and_return(&h, &state)?;

    // 库列表与分发状态按磁盘现状重建（尽力而为；失败不影响删除结论）
    if let Err(e) = scan(&h) {
        h.log_warn(&format!("skills: post-delete rescan failed: {e}"));
    }
    Ok(())
}

// ==================== Tests（纯函数单测） ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hub::agents;

    /// 删除面 = 规范库 + 注册表声明的全部 skills 目标（一处删净，不留孤儿副本）
    #[test]
    fn delete_paths_cover_library_and_targets() {
        let paths = delete_paths("/home/u", "code-review");
        let names: Vec<&str> = paths.iter().map(|(n, _)| *n).collect();
        let expected: Vec<&str> = std::iter::once("lib")
            .chain(
                agents::all()
                    .iter()
                    .filter_map(|a| a.skills_seg().map(|_| a.id())),
            )
            .collect();
        assert_eq!(names, expected);
        assert_eq!(paths[0].1, "/home/u/.agents/skills/code-review");
        assert!(paths
            .iter()
            .skip(1)
            .all(|(_, p)| p.ends_with("/code-review") && !p.starts_with("/home/u/.agents")));
    }

    /// unix 形态：单条 rm -rf -- 带全部路径，单引号转义不逃逸
    #[test]
    fn delete_script_unix_quotes_paths() {
        let paths = vec![
            "/home/u/.agents/skills/a b".to_string(),
            "/home/u/.claude/skills/it's".to_string(),
        ];
        assert_eq!(
            delete_script(&paths, false),
            "rm -rf -- '/home/u/.agents/skills/a b' '/home/u/.claude/skills/it'\\''s'"
        );
        let injected = delete_script(&["/tmp/$(rm -rf ~);x".to_string()], false);
        assert_eq!(injected, "rm -rf -- '/tmp/$(rm -rf ~);x'");
    }

    /// Windows 形态：逐条 rmdir /s /q 双引号包裹 + 2>nul，& 串联
    #[test]
    fn delete_script_windows_shape() {
        let paths = vec![
            "C:\\Users\\u\\.agents\\skills\\a".to_string(),
            "C:\\Users\\u\\.claude\\skills\\a".to_string(),
        ];
        assert_eq!(
            delete_script(&paths, true),
            "rmdir /s /q \"C:\\Users\\u\\.agents\\skills\\a\" 2>nul & rmdir /s /q \"C:\\Users\\u\\.claude\\skills\\a\" 2>nul"
        );
    }
}
