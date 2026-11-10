use super::{normalize_scope, scopes_overlap, topological_order, validate};
use crate::orchestration::model::{Acceptance, Plan, PlanMode, Role, MAX_NODES};

fn assert_code(plan: &Plan, expected: &str) {
    assert_code_for(plan, PlanMode::Manual, expected);
}

fn assert_code_for(plan: &Plan, mode: PlanMode, expected: &str) {
    let errors = validate(plan, mode).unwrap_err();
    assert!(
        errors.iter().any(|error| error.code == expected),
        "expected {expected}, got {errors:?}"
    );
}

fn golden_plan() -> Plan {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/fixtures/orchestration-plan.v2.json"
    )))
    .expect("golden fixture parses")
}

#[test]
fn valid_golden_plan_passes_validation() {
    assert_eq!(validate(&golden_plan(), PlanMode::Manual), Ok(()));
}

#[test]
fn write_scopes_are_normalized_to_relative_prefixes() {
    for (raw, expected) in [
        ("./src/", "src"),
        ("src//lib/", "src/lib"),
        ("src\\lib\\", "src/lib"),
        (".", "."),
        ("./", "."),
    ] {
        assert_eq!(
            normalize_scope(raw).as_deref(),
            Ok(expected),
            "normalizing {raw:?}"
        );
    }
}

#[test]
fn scopes_overlap_by_path_prefix_and_ignore_read_only_nodes() {
    let scope = |value: &str| vec![value.to_string()];
    assert!(scopes_overlap(&scope("src"), &scope("src")));
    assert!(scopes_overlap(&scope("src"), &scope("src/lib")));
    assert!(scopes_overlap(&scope("src/lib"), &scope("src")));
    assert!(scopes_overlap(&scope("."), &scope("src")));
    assert!(!scopes_overlap(&scope("src"), &scope("src2")));
    assert!(!scopes_overlap(&scope("src"), &scope("lib")));
    assert!(!scopes_overlap(&[], &scope("src")));
    assert!(!scopes_overlap(&scope("src"), &[]));
}

#[test]
fn topological_order_is_stable_and_puts_dependencies_first() {
    let mut plan = golden_plan();
    plan.nodes.swap(0, 1);

    assert_eq!(
        topological_order(&plan).unwrap(),
        vec!["n1".to_string(), "n2".to_string()]
    );
}

#[test]
fn auto_plans_only_allow_whitelisted_acceptance_commands() {
    assert_eq!(validate(&golden_plan(), PlanMode::Auto), Ok(()));

    let mut destructive = golden_plan();
    destructive.nodes[0].acceptance = Acceptance::Command {
        command: vec!["rm".into(), "-rf".into(), "/".into()],
        cwd: None,
        timeout_sec: None,
    };
    assert_code_for(&destructive, PlanMode::Auto, "command-not-allowed");
    assert_eq!(validate(&destructive, PlanMode::Manual), Ok(()));

    let mut path_program = golden_plan();
    path_program.nodes[0].acceptance = Acceptance::Command {
        command: vec!["/usr/bin/pnpm".into(), "run".into(), "test:run".into()],
        cwd: None,
        timeout_sec: None,
    };
    assert_code_for(&path_program, PlanMode::Auto, "command-not-allowed");
}

#[test]
fn acceptance_commands_must_be_non_empty_argv() {
    let mut plan = golden_plan();
    plan.nodes[0].acceptance = Acceptance::Command {
        command: vec![],
        cwd: None,
        timeout_sec: None,
    };
    assert_code(&plan, "invalid-acceptance-command");
}

#[test]
fn acceptance_cwd_must_stay_inside_the_project() {
    let mut plan = golden_plan();
    plan.nodes[0].acceptance = Acceptance::Command {
        command: vec!["pnpm".into(), "run".into(), "test:run".into()],
        cwd: Some("../outside".into()),
        timeout_sec: None,
    };
    assert_code(&plan, "invalid-acceptance-cwd");
}

#[test]
fn plan_rejects_scope_escape() {
    for raw in ["../x", "/abs", "~/x"] {
        let mut plan = golden_plan();
        plan.nodes[0].write_scope = vec![raw.into()];
        assert_code(&plan, "invalid-write-scope");
    }
}

#[test]
fn write_scopes_reject_absolute_and_escaping_paths() {
    for raw in ["/abs", "../x", "src/../x", "~/x", "C:\\x", "C:x", ".."] {
        let error = normalize_scope(raw).unwrap_err();
        assert_eq!(error.code, "invalid-write-scope", "scope {raw:?}");
    }
}

#[test]
fn reviewer_and_observer_are_read_only_with_independent_acceptance() {
    let mut reviewer_writes = golden_plan();
    reviewer_writes.nodes[1].write_scope = vec!["apps/file-transfer/desktop/src/".into()];
    assert_code(&reviewer_writes, "readonly-role-write-scope");

    for role in [Role::Reviewer, Role::Observer] {
        let mut plan = golden_plan();
        plan.nodes[1].role = role;
        plan.nodes[1].acceptance = Acceptance::None;
        assert_code(&plan, "readonly-role-acceptance");
    }
}

#[test]
fn node_retry_limits_are_enforced() {
    for max_attempts in [0, 4] {
        let mut plan = golden_plan();
        plan.nodes[0].max_attempts = max_attempts;
        assert_code(&plan, "invalid-max-attempts");
    }
}

#[test]
fn node_keys_are_unique_and_well_formed() {
    let mut duplicate = golden_plan();
    duplicate.nodes[1].key = "n1".into();
    duplicate.nodes[1].depends_on.clear();
    assert_code(&duplicate, "duplicate-node-key");

    for key in ["", "N1", "a_b", "with space", &"x".repeat(33)] {
        let mut plan = golden_plan();
        plan.nodes[0].key = key.to_string();
        plan.nodes[1].depends_on = vec![key.to_string()];
        assert_code(&plan, "invalid-node-key");
    }
}

#[test]
fn plan_version_size_and_parallel_limits_are_enforced() {
    let mut wrong_version = golden_plan();
    wrong_version.version = 1;
    assert_code(&wrong_version, "unsupported-version");

    let mut no_nodes = golden_plan();
    no_nodes.nodes.clear();
    assert_code(&no_nodes, "invalid-node-count");

    let mut too_many_nodes = golden_plan();
    while too_many_nodes.nodes.len() <= MAX_NODES {
        let mut node = too_many_nodes.nodes[0].clone();
        node.key = format!("extra-{}", too_many_nodes.nodes.len());
        node.depends_on.clear();
        too_many_nodes.nodes.push(node);
    }
    assert_code(&too_many_nodes, "invalid-node-count");

    for max_parallel in [0, 5] {
        let mut plan = golden_plan();
        plan.max_parallel = max_parallel;
        assert_code(&plan, "invalid-max-parallel");
    }
}

#[test]
fn dependencies_must_exist_and_not_self_reference() {
    let mut unknown = golden_plan();
    unknown.nodes[0].depends_on = vec!["ghost".into()];
    let errors = validate(&unknown, PlanMode::Manual).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|error| error.code == "unknown-dependency"
                && error.node_key.as_deref() == Some("n1")),
        "expected unknown-dependency, got {errors:?}"
    );

    let mut this_node = golden_plan();
    this_node.nodes[0].depends_on = vec!["n1".into()];
    let errors = validate(&this_node, PlanMode::Manual).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|error| error.code == "self-dependency"
                && error.node_key.as_deref() == Some("n1")),
        "expected self-dependency, got {errors:?}"
    );
}

#[test]
fn dependency_cycles_are_rejected() {
    let mut plan = golden_plan();
    plan.nodes[0].depends_on = vec!["n2".into()];
    plan.nodes[1].depends_on = vec!["n1".into()];

    let errors = validate(&plan, PlanMode::Manual).unwrap_err();
    assert!(
        errors.iter().any(|error| error.code == "dependency-cycle"),
        "expected dependency-cycle, got {errors:?}"
    );
}

#[test]
fn agents_outside_bridge_allowlist_are_rejected() {
    for cli in ["claude", "codex", ""] {
        let mut plan = golden_plan();
        let snapshot = plan.nodes[0]
            .agent
            .as_mut()
            .expect("fixture has a snapshot");
        snapshot.cli = cli.into();
        let errors = validate(&plan, PlanMode::Manual).unwrap_err();
        assert!(
            errors.iter().any(|error| error.code == "agent-unsupported"),
            "agent {cli:?}: {errors:?}"
        );
    }
}

fn test_profile(id: &str, name: &str, enabled: bool) -> crate::agent_pool::model::AgentProfile {
    crate::agent_pool::model::AgentProfile {
        id: id.into(),
        name: name.into(),
        cli: "pi".into(),
        model: Some("m".into()),
        thinking_level: Some("low".into()),
        tags: vec![],
        specialties: vec![],
        description: "实现".into(),
        enabled,
        created_at: "t".into(),
        updated_at: "t".into(),
    }
}

#[test]
fn bind_agents_resolves_the_ref_and_overwrites_frontend_snapshots() {
    use super::bind_agents;

    let profile = test_profile("ap-real", "真实实现", true);
    let mut plan = golden_plan();
    plan.nodes.truncate(1);
    plan.nodes[0].agent_ref = "ap-real".into();
    plan.nodes[0].agent = None;
    let errors = bind_agents(&mut plan, std::slice::from_ref(&profile));
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        plan.nodes[0].agent.as_ref().unwrap().name,
        "真实实现",
        "server-side snapshot wins"
    );
    assert_eq!(plan.nodes[0].agent.as_ref().unwrap().cli, "pi");
}

#[test]
fn bind_agents_reports_unknown_and_disabled_members() {
    use super::bind_agents;

    let mut plan = golden_plan();
    let errors = bind_agents(&mut plan, &[]);
    assert_eq!(errors.len(), 2);
    assert!(errors.iter().all(|error| error.code == "unknown-agent"));

    let mut plan = golden_plan();
    plan.nodes.truncate(1);
    let errors = bind_agents(&mut plan, &[test_profile("ap-frontend", "实现", false)]);
    assert_eq!(errors[0].code, "agent-disabled");
}

#[test]
fn acceptance_timeouts_are_bounded() {
    for timeout in [0u64, 901] {
        let mut plan = golden_plan();
        if let Acceptance::Command { timeout_sec, .. } = &mut plan.nodes[0].acceptance {
            *timeout_sec = Some(timeout);
        }
        assert_code(&plan, "invalid-acceptance-timeout");
    }

    let mut verdict_timeout = golden_plan();
    verdict_timeout.nodes[1].acceptance = Acceptance::Verdict {
        timeout_sec: Some(901),
    };
    assert_code(&verdict_timeout, "invalid-acceptance-timeout");
}

#[test]
fn auto_plans_reject_node_eval_and_script_paths() {
    let commands: Vec<Vec<String>> = vec![
        vec![
            "node".into(),
            "-e".into(),
            "require('fs').rmSync('/tmp/x', {recursive:true})".into(),
        ],
        vec!["node".into(), "--eval".into(), "process.exit(1)".into()],
        vec!["node".into(), "scripts/check.js".into()],
        vec!["node".into(), "/tmp/evil.js".into()],
    ];
    for command in commands {
        let mut plan = golden_plan();
        plan.nodes[0].acceptance = Acceptance::Command {
            command,
            cwd: None,
            timeout_sec: None,
        };
        assert_code_for(&plan, PlanMode::Auto, "command-not-allowed");
        // 手动计划仍由人工批准，白名单不适用
        assert_eq!(validate(&plan, PlanMode::Manual), Ok(()));
    }
}
