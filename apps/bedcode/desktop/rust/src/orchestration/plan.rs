//! 计划契约：校验、路径归一、依赖无环（纯函数）。

use std::collections::{HashMap, HashSet};

use super::model::{
    Acceptance, Plan, PlanError, PlanErrorCode, PlanMode, Role, MAX_ATTEMPTS, MAX_NODES,
    MAX_PARALLEL, PLAN_VERSION,
};
use crate::agent_pool::model::AgentProfile;
use crate::run::bridge::supports_bridge;

/// 把计划节点的 `agentRef` 解析为派发快照（服务端权威，覆盖前端传入值）。
///
/// 返回逐节点的解析错误；**调用方必须在 `validate` 之前先跑本函数**：
/// `validate` 只检查已解析快照的形状与桥接能力，不读池子。
pub(crate) fn bind_agents(plan: &mut Plan, profiles: &[AgentProfile]) -> Vec<PlanError> {
    let mut errors = Vec::new();
    for node in &mut plan.nodes {
        let reference = node.agent_ref.trim();
        let resolved = profiles.iter().find(|profile| profile.id == reference);
        match resolved {
            None => {
                node.agent = None;
                errors.push(PlanError {
                    code: PlanErrorCode::UnknownAgent.as_str().into(),
                    node_key: Some(node.key.clone()),
                    message: format!("agentRef `{reference}` does not match any agent in the pool"),
                });
            }
            Some(profile) if !profile.enabled => {
                node.agent = None;
                errors.push(PlanError {
                    code: PlanErrorCode::AgentDisabled.as_str().into(),
                    node_key: Some(node.key.clone()),
                    message: format!("agent `{}` is disabled", profile.name),
                });
            }
            Some(profile) if !supports_bridge(&profile.cli) => {
                node.agent = None;
                errors.push(PlanError {
                    code: PlanErrorCode::AgentUnsupported.as_str().into(),
                    node_key: Some(node.key.clone()),
                    message: format!(
                        "agent `{}` uses `{}`, which has no bridge; orchestration supports pi / opencode",
                        profile.name, profile.cli
                    ),
                });
            }
            Some(profile) => {
                node.agent = Some(profile.snapshot());
            }
        }
    }
    errors
}

pub(crate) fn validate(plan: &Plan, mode: PlanMode) -> Result<(), Vec<PlanError>> {
    let mut errors = Vec::new();

    if plan.version != PLAN_VERSION {
        errors.push(PlanError {
            code: PlanErrorCode::UnsupportedVersion.as_str().into(),
            node_key: None,
            message: format!(
                "plan version {} is not supported (expected {PLAN_VERSION})",
                plan.version
            ),
        });
    }
    if plan.nodes.is_empty() || plan.nodes.len() > MAX_NODES {
        errors.push(PlanError {
            code: PlanErrorCode::InvalidNodeCount.as_str().into(),
            node_key: None,
            message: format!("plan must contain 1..={MAX_NODES} nodes"),
        });
    }
    if !(1..=MAX_PARALLEL).contains(&plan.max_parallel) {
        errors.push(PlanError {
            code: PlanErrorCode::InvalidMaxParallel.as_str().into(),
            node_key: None,
            message: format!("maxParallel must be in 1..={MAX_PARALLEL}"),
        });
    }

    let mut keys = HashSet::new();
    for node in &plan.nodes {
        if !is_valid_node_key(&node.key) {
            errors.push(PlanError {
                code: PlanErrorCode::InvalidNodeKey.as_str().into(),
                node_key: Some(node.key.clone()),
                message: format!("node key `{}` must match [a-z0-9-]{{1,32}}", node.key),
            });
        }
        if !keys.insert(node.key.as_str()) {
            errors.push(PlanError {
                code: PlanErrorCode::DuplicateNodeKey.as_str().into(),
                node_key: Some(node.key.clone()),
                message: format!("node key `{}` is duplicated", node.key),
            });
        }
        if !(1..=MAX_ATTEMPTS).contains(&node.max_attempts) {
            errors.push(PlanError {
                code: PlanErrorCode::InvalidMaxAttempts.as_str().into(),
                node_key: Some(node.key.clone()),
                message: format!("maxAttempts must be in 1..={MAX_ATTEMPTS}"),
            });
        }
        for scope in &node.write_scope {
            if let Err(mut error) = normalize_scope(scope) {
                error.node_key = Some(node.key.clone());
                errors.push(error);
            }
        }
        let acceptance_timeout = match &node.acceptance {
            Acceptance::Command { timeout_sec, .. } | Acceptance::Verdict { timeout_sec } => {
                *timeout_sec
            }
            Acceptance::None => None,
        };
        if let Some(timeout) = acceptance_timeout {
            if !(1..=900).contains(&timeout) {
                errors.push(PlanError {
                    code: PlanErrorCode::InvalidAcceptanceTimeout.as_str().into(),
                    node_key: Some(node.key.clone()),
                    message: "acceptance timeoutSec must be in 1..=900".into(),
                });
            }
        }
        if let Acceptance::Command { command, cwd, .. } = &node.acceptance {
            if command.is_empty() {
                errors.push(PlanError {
                    code: PlanErrorCode::InvalidAcceptanceCommand.as_str().into(),
                    node_key: Some(node.key.clone()),
                    message: "acceptance command must be a non-empty argv array".into(),
                });
            } else if mode == PlanMode::Auto && !auto_command_allowed(command) {
                errors.push(PlanError {
                    code: PlanErrorCode::CommandNotAllowed.as_str().into(),
                    node_key: Some(node.key.clone()),
                    message: format!(
                        "acceptance command `{}` is not allowed for auto plans",
                        command.join(" ")
                    ),
                });
            }
            if let Some(cwd) = cwd {
                if let Err(mut error) = normalize_scope(cwd) {
                    error.code = PlanErrorCode::InvalidAcceptanceCwd.as_str().into();
                    error.node_key = Some(node.key.clone());
                    errors.push(error);
                }
            }
        }
        if matches!(node.role, Role::Reviewer | Role::Observer) {
            if !node.write_scope.is_empty() {
                errors.push(PlanError {
                    code: PlanErrorCode::ReadonlyRoleWriteScope.as_str().into(),
                    node_key: Some(node.key.clone()),
                    message: format!(
                        "role `{:?}` must be read-only; writeScope must be empty",
                        node.role
                    ),
                });
            }
            if matches!(node.acceptance, Acceptance::None) {
                errors.push(PlanError {
                    code: PlanErrorCode::ReadonlyRoleAcceptance.as_str().into(),
                    node_key: Some(node.key.clone()),
                    message: format!(
                        "role `{:?}` needs an independent acceptance (verdict or command)",
                        node.role
                    ),
                });
            }
        }
    }

    for node in &plan.nodes {
        for dep in &node.depends_on {
            if dep == &node.key {
                errors.push(PlanError {
                    code: PlanErrorCode::SelfDependency.as_str().into(),
                    node_key: Some(node.key.clone()),
                    message: format!("node `{}` depends on itself", node.key),
                });
            } else if !keys.contains(dep.as_str()) {
                errors.push(PlanError {
                    code: PlanErrorCode::UnknownDependency.as_str().into(),
                    node_key: Some(node.key.clone()),
                    message: format!("node `{}` depends on unknown node `{dep}`", node.key),
                });
            }
        }
    }

    if let Err(error) = topological_order(plan) {
        errors.push(error);
    }

    for node in &plan.nodes {
        if node.agent_ref.trim().is_empty() {
            errors.push(PlanError {
                code: PlanErrorCode::UnknownAgent.as_str().into(),
                node_key: Some(node.key.clone()),
                message: "agentRef must not be empty".into(),
            });
            continue;
        }
        match &node.agent {
            None => errors.push(PlanError {
                code: PlanErrorCode::UnknownAgent.as_str().into(),
                node_key: Some(node.key.clone()),
                message: format!(
                    "agentRef `{}` was not resolved; save the plan again",
                    node.agent_ref
                ),
            }),
            Some(snapshot) if snapshot.profile_id != node.agent_ref => errors.push(PlanError {
                code: PlanErrorCode::UnknownAgent.as_str().into(),
                node_key: Some(node.key.clone()),
                message: format!(
                    "agent snapshot `{}` does not match agentRef `{}`",
                    snapshot.profile_id, node.agent_ref
                ),
            }),
            Some(snapshot) if !supports_bridge(&snapshot.cli) => errors.push(PlanError {
                code: PlanErrorCode::AgentUnsupported.as_str().into(),
                node_key: Some(node.key.clone()),
                message: format!(
                    "agent `{}` is not bridge-capable; supported agents: pi, opencode",
                    snapshot.cli
                ),
            }),
            Some(_) => {}
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// 自动计划的验收命令白名单：程序名固定、子命令只读（手动计划不走此门）。
fn auto_command_allowed(argv: &[String]) -> bool {
    let Some(program) = argv.first() else {
        return false;
    };
    if program.contains('/') || program.contains('\\') {
        return false;
    }
    let subcommand = argv.get(1).map(String::as_str);
    match program.as_str() {
        "pnpm" | "npm" => matches!(subcommand, Some("run" | "test" | "ci")),
        "cargo" => matches!(subcommand, Some("test" | "check" | "clippy")),
        // `node` 不进白名单：`-e` / `--eval` / `-p` 以及任意脚本路径都能执行
        // 任意代码，argv 形状无法证明只读；`node <script>` 同样拒绝。
        // 自动计划在 requireApproval=false 时会直接执行，必须堵死这条路。
        "git" => matches!(
            subcommand,
            Some("status" | "diff" | "log" | "show" | "rev-parse" | "ls-files")
        ),
        _ => false,
    }
}

/// 写集前缀归一：统一分隔符、折叠 `.` 与重复斜杠、去尾斜杠；
/// 绝对路径 / `..` / `~` 一律拒绝，不做静默修正。
pub(crate) fn normalize_scope(raw: &str) -> Result<String, PlanError> {
    let invalid = |message: String| PlanError {
        code: PlanErrorCode::InvalidWriteScope.as_str().into(),
        node_key: None,
        message,
    };

    let slashed = raw.replace('\\', "/");
    if slashed.is_empty() {
        return Err(invalid("write scope must not be empty".into()));
    }
    if slashed.starts_with('/') || slashed.starts_with('~') {
        return Err(invalid(format!("write scope `{raw}` must be relative")));
    }
    let bytes = slashed.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(invalid(format!(
            "write scope `{raw}` must not use a drive path"
        )));
    }

    let mut parts = Vec::new();
    for part in slashed.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                return Err(invalid(format!(
                    "write scope `{raw}` must not escape the project directory"
                )))
            }
            part => parts.push(part),
        }
    }

    if parts.is_empty() {
        Ok(".".into())
    } else {
        Ok(parts.join("/"))
    }
}

/// 两个写集是否重叠（前缀包含）；只读（空写集）永不占租约。
pub(crate) fn scopes_overlap(a: &[String], b: &[String]) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    a.iter()
        .any(|left| b.iter().any(|right| prefixes_overlap(left, right)))
}

fn prefixes_overlap(a: &str, b: &str) -> bool {
    a == "." || b == "." || a == b || is_prefix_of(b, a) || is_prefix_of(a, b)
}

fn is_prefix_of(prefix: &str, path: &str) -> bool {
    path.strip_prefix(prefix)
        .is_some_and(|rest| rest.starts_with('/'))
}

fn is_valid_node_key(key: &str) -> bool {
    (1..=32).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// 依赖图的稳定拓扑序（同层按声明顺序）；发现环即失败。
pub(crate) fn topological_order(plan: &Plan) -> Result<Vec<String>, PlanError> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Mark {
        Unvisited,
        Visiting,
        Done,
    }

    let index: HashMap<&str, usize> = plan
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| (node.key.as_str(), i))
        .collect();
    let mut marks = vec![Mark::Unvisited; plan.nodes.len()];
    let mut order = Vec::with_capacity(plan.nodes.len());

    fn visit(
        i: usize,
        plan: &Plan,
        index: &HashMap<&str, usize>,
        marks: &mut [Mark],
        order: &mut Vec<String>,
    ) -> Result<(), PlanError> {
        match marks[i] {
            Mark::Done => return Ok(()),
            Mark::Visiting => {
                return Err(PlanError {
                    code: PlanErrorCode::DependencyCycle.as_str().into(),
                    node_key: Some(plan.nodes[i].key.clone()),
                    message: format!("dependency cycle reaches node `{}`", plan.nodes[i].key),
                })
            }
            Mark::Unvisited => {}
        }

        marks[i] = Mark::Visiting;
        for dep in &plan.nodes[i].depends_on {
            if let Some(&dep_index) = index.get(dep.as_str()) {
                visit(dep_index, plan, index, marks, order)?;
            }
        }
        marks[i] = Mark::Done;
        order.push(plan.nodes[i].key.clone());
        Ok(())
    }

    for i in 0..plan.nodes.len() {
        visit(i, plan, &index, &mut marks, &mut order)?;
    }

    Ok(order)
}

#[cfg(test)]
mod tests;
