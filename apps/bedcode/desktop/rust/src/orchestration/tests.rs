use super::TICK_COMMAND;

/// 命令面注册是契约：`lib.rs` 匹配臂、`plugin.json`、前端调用名三处必须同步。
/// 匹配臂由本文件的常量与 lib.rs 的分派守卫锁住；这里锁 manifest 声明。
#[test]
fn manifest_declares_the_orchestration_command_surface() {
    let raw = include_str!("../../../plugin.json");
    let manifest: serde_json::Value = serde_json::from_str(raw).expect("plugin.json must parse");
    let declared: Vec<&str> = manifest["contributes"]["commands"]
        .as_array()
        .expect("contributes.commands")
        .iter()
        .filter_map(|command| command["id"].as_str())
        .collect();

    for command in [
        "orchestration.meta",
        "orchestration.list",
        "orchestration.get",
        "orchestration.create",
        "orchestration.plan",
        "orchestration.update-plan",
        "orchestration.approve",
        "orchestration.start",
        "orchestration.pause",
        "orchestration.resume",
        "orchestration.cancel",
        "orchestration.retry-node",
        "orchestration.skip-node",
        "orchestration.events",
        TICK_COMMAND,
    ] {
        assert!(
            declared.contains(&command),
            "manifest missing command `{command}`"
        );
    }
}

/// 信封形状锁：与 SDK `user_facing_string` 逐字一致（宿主桥按此形状透传）。
#[test]
fn business_error_string_matches_the_sdk_envelope_shape() {
    let code = "com.wasmnest.bedcode.orchestration.reason.node-failed";
    assert_eq!(
        super::business_error_string(code),
        wasmnest_plugin_api::user_facing_string(code, serde_json::Value::Null),
    );
}

#[test]
fn command_error_maps_reason_prefixes_to_registered_i18n_keys() {
    let mapped = super::command_error("plan-invalid: nodes[0].key is empty".to_string());
    assert_eq!(
        mapped,
        super::business_error_string("com.wasmnest.bedcode.orchestration.reason.plan-invalid"),
    );
    // 信封不得携带技术详情
    assert!(!mapped.contains("nodes[0]"), "{mapped}");
}

#[test]
fn command_error_leaves_non_reason_errors_plain() {
    for error in [
        "orchestration.get: id required",
        "orchestration-not-found: o1",
        "unknown orchestration command: bogus",
    ] {
        assert_eq!(super::command_error(error.to_string()), error);
    }
}
