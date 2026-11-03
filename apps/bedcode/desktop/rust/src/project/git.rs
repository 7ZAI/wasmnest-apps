//! 项目 Git 提交图（`project.git-log`，桌面命令面）
//!
//! 项目工作台的「Git」页签展示提交历史与分支 DAG：一次读面返回按拓扑序排列的
//! 提交（含父提交 / 引用装饰），图形布局由前端纯函数完成（见
//! `src/utils/gitGraph.ts`）——后端只负责**取数与解析**，不关心像素。
//!
//! 取数口径：`git log --all --topo-order`，显式排除 stash / notes 引用
//! （它们不属于提交历史，混进来会多画一条与项目无关的线）。
//!
//! 为什么不新增宿主能力：git 同步执行端口已经存在（[`GitPort`]，走
//! `host-process run-sync`，权限 `process:run`，与 file_browse 的分支 / 状态 /
//! checkout 同一条通道）。本域只是把「读提交历史」这组只读 git 命令编排进来，
//! containment / 授权 / 非仓库判定与 [`super::files`] 同口径。

use crate::file_browse::ops;
use crate::file_browse::source::{FsPort, GitPort};

/// 默认返回提交数（一次拉太多在窄面板里没有意义；刷新可重取）
pub const DEFAULT_LIMIT: usize = 300;
/// 单次请求上限（防御异常入参把 git log 拉成整库扫描）
pub const MAX_LIMIT: usize = 1000;

/// 字段分隔符（与 `--pretty` 的 `%x1f` 对应）
const FIELD_SEP: char = '\u{1f}';
/// 记录分隔符（与 `--pretty` 的 `%x1e` 对应）
const RECORD_SEP: char = '\u{1e}';

/// 单条提交的 pretty 格式：hash / 短 hash / 父 hash / 作者 / 邮箱 / 作者时间 /
/// 引用装饰 / 标题（最后两个字段的顺序用于截断判断，不要随意调换）
const PRETTY_FORMAT: &str = "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1e";

/// 工作目录是否是一个 git 仓库（`.git` 目录或 worktree / submodule 的 `.git` 文件）
///
/// 与 HTTP 面 `git/branches` 的预检同判据：不跑 git，先挡掉「目录只是普通文件夹」
/// 这种最常见输入；真正的仓库性由后续 git 命令自证。
pub fn is_git_repo(fs: &impl FsPort, working_dir: &str) -> bool {
    fs.exists(&ops::join_path(working_dir, ".git"))
        .unwrap_or(false)
}

/// `git log` 的入参（`limit + 1` 是为了精确判断窗口是否被截断）
///
/// `--all` 包含 `refs/stash` 与 `refs/notes/*`——它们不是提交历史的一部分，
/// 混进来会多出整条「分支」线；显式排除（`--exclude` 作用域是紧随其后的 `--all`）。
fn log_args(limit: usize) -> Vec<String> {
    vec![
        "log".to_string(),
        "--exclude=refs/stash*".to_string(),
        "--exclude=refs/notes/*".to_string(),
        "--all".to_string(),
        "--topo-order".to_string(),
        "--decorate=short".to_string(),
        "--no-color".to_string(),
        PRETTY_FORMAT.to_string(),
        format!("--max-count={}", limit.saturating_add(1)),
    ]
}

/// 解析 `git log` 输出为提交列表（纯函数）
///
/// 空记录（尾部 `%x1e` 之后的新行）直接跳过；字段数不足的记录按空串补齐，
/// 不因为一条畸形记录丢整页历史。`refs` 保留 git 的装饰原文
/// （`HEAD -> dev` / `tag: v1.0.0` / `origin/dev`），分类与配色由前端决定。
pub fn parse_log(output: &str) -> Vec<serde_json::Value> {
    output
        .split(RECORD_SEP)
        .filter_map(|record| {
            let record = record.trim_matches('\n');
            if record.is_empty() {
                return None;
            }
            let mut fields = record.split(FIELD_SEP);
            let hash = fields.next().unwrap_or("").trim();
            if hash.is_empty() {
                return None;
            }
            let short_hash = fields.next().unwrap_or("");
            let parents_raw = fields.next().unwrap_or("");
            let author = fields.next().unwrap_or("");
            let email = fields.next().unwrap_or("");
            let date = fields.next().unwrap_or("");
            let refs_raw = fields.next().unwrap_or("");
            let subject = fields.next().unwrap_or("");

            let parents: Vec<&str> = parents_raw.split_whitespace().collect();
            let refs: Vec<&str> = refs_raw
                .split(',')
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .collect();

            Some(serde_json::json!({
                "hash": hash,
                "shortHash": if short_hash.is_empty() {
                    hash.chars().take(7).collect::<String>()
                } else {
                    short_hash.to_string()
                },
                "parents": parents,
                "author": author,
                "email": email,
                "date": date,
                "refs": refs,
                "subject": subject,
            }))
        })
        .collect()
}

/// 拉取提交历史（`limit` 会被夹到 `[1, MAX_LIMIT]`）
///
/// 返回 `{commits, truncated}`：多取一条只用于判定截断，返回的列表始终 ≤ limit。
/// git 非零退出 / 超时一律显性上抛——把「读不到历史」伪装成空仓库会让用户以为
/// 代码没提交过。
pub fn log(
    git: &impl GitPort,
    working_dir: &str,
    limit: usize,
) -> Result<serde_json::Value, String> {
    let limit = limit.clamp(1, MAX_LIMIT);
    let args = log_args(limit);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let result = git.run(working_dir, &arg_refs)?;

    if result.timed_out {
        return Err("git log timed out".to_string());
    }
    if result.exit_code != Some(0) {
        let stderr = result.stderr.trim();
        return Err(if stderr.is_empty() {
            "git log failed".to_string()
        } else {
            format!("git log failed: {stderr}")
        });
    }

    let mut commits = parse_log(&result.stdout);
    let truncated = commits.len() > limit;
    if truncated {
        commits.truncate(limit);
    }
    Ok(serde_json::json!({
        "commits": commits,
        "truncated": truncated,
    }))
}

/// 当前分支（detached HEAD / git 不可用 / 空输出 → `None`）
///
/// 只影响页签头部的分支徽标，失败不值得让整页历史报错。
pub fn current_branch(git: &impl GitPort, working_dir: &str) -> Option<String> {
    let result = git.run(working_dir, &["branch", "--show-current"]).ok()?;
    if result.timed_out || result.exit_code != Some(0) {
        return None;
    }
    result
        .stdout
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
}

// ==================== wasm：项目解析 + 授权 + 端口 ====================

/// 项目提交图：`{projectId, limit?}` → `{isGitRepo, currentBranch, commits, truncated}`
#[cfg(target_arch = "wasm32")]
pub fn graph_via_host(project_id: &str, limit: Option<usize>) -> Result<serde_json::Value, String> {
    use wasmnest_plugin_api::wasm_host::WasmHost;

    let root = super::files::authorized_working_dir(project_id)?;
    if !is_git_repo(&WasmHost, &root) {
        // 非仓库不是错误：前端给引导态（与 file_browse 的 git/branches 同格）
        return Ok(serde_json::json!({
            "isGitRepo": false,
            "currentBranch": serde_json::Value::Null,
            "commits": [],
            "truncated": false,
        }));
    }
    let mut data = log(&WasmHost, &root, limit.unwrap_or(DEFAULT_LIMIT))?;
    data["isGitRepo"] = serde_json::json!(true);
    data["currentBranch"] = match current_branch(&WasmHost, &root) {
        Some(branch) => serde_json::json!(branch),
        None => serde_json::Value::Null,
    };
    Ok(data)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn graph_via_host(
    _project_id: &str,
    _limit: Option<usize>,
) -> Result<serde_json::Value, String> {
    Err("project git log unavailable outside wasm runtime".to_string())
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_browse::source::tests::MockGit;
    use std::collections::HashMap;
    use wasmnest_plugin_api::host::ProcessSyncResult;

    fn record(hash: &str, parents: &str, refs: &str, subject: &str) -> String {
        format!(
            "{hash}\u{1f}{}\u{1f}{parents}\u{1f}Alice\u{1f}a@example.com\u{1f}2026-11-01T10:00:00+08:00\u{1f}{refs}\u{1f}{subject}\u{1e}\n",
            &hash[..7.min(hash.len())]
        )
    }

    fn log_key(cwd: &str, limit: usize) -> (String, String) {
        (cwd.to_string(), log_args(limit).join(" "))
    }

    #[test]
    fn parse_log_covers_fields_refs_and_parents() {
        let output = format!(
            "{}{}",
            record(
                "aaaaaaa1111",
                "bbbbbbb2222 ccccccc3333",
                "HEAD -> dev, tag: v0.1.0",
                "fix: 合并提交"
            ),
            record("bbbbbbb2222", "", "origin/dev", "feat: 首个提交"),
        );
        let commits = parse_log(&output);
        assert_eq!(commits.len(), 2);

        assert_eq!(commits[0]["hash"], "aaaaaaa1111");
        assert_eq!(commits[0]["shortHash"], "aaaaaaa");
        assert_eq!(
            commits[0]["parents"],
            serde_json::json!(["bbbbbbb2222", "ccccccc3333"])
        );
        assert_eq!(
            commits[0]["refs"],
            serde_json::json!(["HEAD -> dev", "tag: v0.1.0"])
        );
        assert_eq!(commits[0]["subject"], "fix: 合并提交");
        assert_eq!(commits[0]["author"], "Alice");
        assert_eq!(commits[1]["refs"], serde_json::json!(["origin/dev"]));
        assert_eq!(commits[1]["parents"], serde_json::json!([]));
    }

    #[test]
    fn parse_log_skips_empty_and_malformed_records() {
        let output = "\n\u{1e}\n".to_string();
        assert!(parse_log(&output).is_empty());
        // 只有 hash 的畸形记录仍可读出 hash（字段按空串补齐），不吞整页
        let commits = parse_log("abcdef1");
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0]["hash"], "abcdef1");
        assert_eq!(commits[0]["shortHash"], "abcdef1");
        assert_eq!(commits[0]["date"], "");
    }

    #[test]
    fn log_requests_all_branches_topologically_and_reports_truncation() {
        let cwd = "/srv/app";
        let mut outputs = HashMap::new();
        // limit=2 → 多取一条（3 条），截断判定为 true，只回前 2 条
        let output = format!(
            "{}{}{}",
            record("aaaaaaa1111", "bbbbbbb2222", "", "c1"),
            record("bbbbbbb2222", "ccccccc3333", "", "c2"),
            record("ccccccc3333", "", "", "c3"),
        );
        outputs.insert(log_key(cwd, 2), output);

        let git = MockGit::new(outputs);
        let data = log(&git, cwd, 2).unwrap();
        assert_eq!(data["truncated"], true);
        assert_eq!(data["commits"].as_array().unwrap().len(), 2);

        let calls = git.calls.lock().unwrap();
        let args = &calls[0].1;
        assert_eq!(calls[0].0, cwd);
        assert!(args.contains(&"--all".to_string()));
        // stash / notes 不算提交历史：显式排除，避免多画一条无关分支
        assert!(args.contains(&"--exclude=refs/stash*".to_string()));
        assert!(args.contains(&"--exclude=refs/notes/*".to_string()));
        assert!(args.contains(&"--topo-order".to_string()));
        assert!(args.contains(&"--max-count=3".to_string()));
        assert!(args.contains(&PRETTY_FORMAT.to_string()));
    }

    #[test]
    fn log_under_limit_is_not_truncated_and_clamps_limit() {
        let cwd = "/srv/app";
        let mut outputs = HashMap::new();
        outputs.insert(log_key(cwd, 5), record("aaaaaaa1111", "", "", "only"));
        // 超上限入参 10000 → 夹到 MAX_LIMIT，max-count = MAX_LIMIT + 1
        let key = log_key(cwd, MAX_LIMIT);
        outputs.insert(key, record("aaaaaaa1111", "", "", "only"));

        let git = MockGit::new(outputs);
        let data = log(&git, cwd, 10_000).unwrap();
        assert_eq!(data["truncated"], false);
        assert_eq!(data["commits"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn log_surfaces_git_failure_instead_of_empty_history() {
        let cwd = "/srv/app";
        let args = log_args(10);
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let git = MockGit::fail_with(
            cwd,
            &arg_refs,
            ProcessSyncResult {
                exit_code: Some(128),
                stdout: String::new(),
                stderr: "fatal: not a git repository".to_string(),
                timed_out: false,
            },
        );

        let err = log(&git, cwd, 10).unwrap_err();
        assert!(err.contains("git log failed"), "{err}");
        assert!(err.contains("not a git repository"), "{err}");
    }

    #[test]
    fn log_reports_timeout() {
        let cwd = "/srv/app";
        let args = log_args(10);
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let git = MockGit::fail_with(
            cwd,
            &arg_refs,
            ProcessSyncResult {
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                timed_out: true,
            },
        );

        assert_eq!(log(&git, cwd, 10).unwrap_err(), "git log timed out");
    }

    #[test]
    fn current_branch_trims_output_and_rejects_failures() {
        let cwd = "/srv/app";
        let mut outputs = HashMap::new();
        outputs.insert(
            (cwd.to_string(), "branch --show-current".to_string()),
            "dev\n".to_string(),
        );
        let git = MockGit::new(outputs);
        assert_eq!(current_branch(&git, cwd).as_deref(), Some("dev"));

        let args = ["branch", "--show-current"];
        let failing = MockGit::fail_with(
            cwd,
            &args,
            ProcessSyncResult {
                exit_code: Some(1),
                stdout: "ignored\n".to_string(),
                stderr: String::new(),
                timed_out: false,
            },
        );
        assert_eq!(current_branch(&failing, cwd), None);
    }

    #[test]
    fn is_git_repo_checks_dot_git_entry() {
        use crate::file_browse::source::tests::MockFs;

        let dir = tempfile::tempdir().expect("tempdir");
        assert!(!is_git_repo(&MockFs, &dir.path().to_string_lossy()));

        std::fs::create_dir(dir.path().join(".git")).expect("create .git");
        assert!(is_git_repo(&MockFs, &dir.path().to_string_lossy()));
    }
}
