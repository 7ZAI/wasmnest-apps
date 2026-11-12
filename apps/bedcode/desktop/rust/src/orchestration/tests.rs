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
