//! Agent 池：编排的「人」这一侧的唯一真源。
//!
//! 池成员不是 CLI 本身，而是「CLI + 模型 + 思考等级 + 标签 + 擅长 + 职责」的
//! 可复用配置：同一个 pi/opencode 可以派生多个职责不同的人格（前端实现 / 评审 /
//! 文档……），编排按职责描述匹配派发。CLI 安装事实仍由 Agent 管理域（`hub`）持有，
//! 本域只引用，不复制探测逻辑。
//!
//! 命令面前缀 `agent.profile.*`：与 `agent.*`（CLI 管理）同域命名空间，但在
//! `lib.rs` 的 hub 转发之前截获——池是业务实体，不是 CLI 安装台的一部分。
//!
//! 存储：插件私有库 `agent_profiles` 一张表；native 单测走内存实现。
//! 删除池成员不做引用阻断：已批准计划 / 运行中的节点持有派发快照，不会因池子
//! 变动而漂移；未批准的旧计划会在下一次校验时显性报 `unknown-agent`。

pub(crate) mod model;
pub(crate) mod ops;
pub(crate) mod store;

/// 命令面（与 `plugin.json.contributes.commands` 同步）
pub(crate) const LIST_COMMAND: &str = "agent.profile.list";
pub(crate) const CREATE_COMMAND: &str = "agent.profile.create";
pub(crate) const UPDATE_COMMAND: &str = "agent.profile.update";
pub(crate) const DELETE_COMMAND: &str = "agent.profile.delete";
pub(crate) const OPTIONS_COMMAND: &str = "agent.profile.options";

#[cfg(target_arch = "wasm32")]
mod wasm_commands {
    use serde_json::{json, Value};
    use wasmnest_plugin_api::host::{HostLog, HostPluginDatabase};
    use wasmnest_plugin_api::wasm_host::WasmHost;

    use super::model::{AgentProfile, AgentProfileView, ProfileInput};
    use super::store::AgentPoolStore;
    use super::{ops, CREATE_COMMAND, DELETE_COMMAND, LIST_COMMAND, OPTIONS_COMMAND, UPDATE_COMMAND};

    fn arg_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
        args.get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
    }

    fn require_str(args: &Value, key: &str, command: &str) -> Result<String, String> {
        arg_str(args, key)
            .map(str::to_string)
            .ok_or_else(|| format!("{command}: {key} required"))
    }

    /// CLI 安装事实（唯一真源 = hub 探测状态）+ 桥接能力（运行域注册表事实）。
    pub(super) fn cli_facts(cli: &str) -> Result<super::model::CliFacts, String> {
        let state = crate::hub::invoke_command("agent.get-state", Value::Null)
            .map_err(|e| e.to_string())?;
        let installed = state["state"]["clis"][cli]["installed"] == Value::Bool(true);
        Ok(super::model::CliFacts {
            installed,
            bridge_capable: crate::run::bridge::supports_bridge(cli),
        })
    }

    fn readiness(profiles: Vec<AgentProfile>) -> Result<Vec<AgentProfileView>, String> {
        let state = crate::hub::invoke_command("agent.get-state", Value::Null)
            .map_err(|e| e.to_string())?;
        let clis = &state["state"]["clis"];
        Ok(profiles
            .into_iter()
            .map(|profile| AgentProfileView {
                ready: clis[profile.cli.as_str()]["installed"] == Value::Bool(true),
                profile,
            })
            .collect())
    }

    fn view(profile: AgentProfile) -> Result<AgentProfileView, String> {
        let mut views = readiness(vec![profile])?;
        Ok(views.remove(0))
    }

    pub(crate) fn ensure_schema() -> Result<(), String> {
        WasmHost.ensure_schema()
    }

    pub(crate) fn list_profiles() -> Result<Vec<AgentProfile>, String> {
        WasmHost.list()
    }

    /// 池成员的展示清单（含 CLI 就绪态）；供 `/agents` 页与编排 meta 共用。
    pub(crate) fn list_views() -> Result<Vec<AgentProfileView>, String> {
        readiness(WasmHost.list()?)
    }

    pub(crate) fn invoke_command(name: &str, args: Value) -> Result<Value, String> {
        let now = crate::config::model::now_rfc3339();
        match name {
            LIST_COMMAND => Ok(json!({
                "profiles": readiness(WasmHost.list()?)?,
            })),
            CREATE_COMMAND => {
                let input: ProfileInput = serde_json::from_value(args)
                    .map_err(|e| format!("profile-invalid: {e}"))?;
                let facts = cli_facts(input.cli.trim())?;
                let profile = ops::create(&WasmHost, &input, facts, &now)?;
                WasmHost.log_info(&format!(
                    "agent profile created (id={}, cli={}, name={})",
                    profile.id, profile.cli, profile.name
                ));
                Ok(json!({ "profile": view(profile)? }))
            }
            UPDATE_COMMAND => {
                let id = require_str(&args, "id", UPDATE_COMMAND)?;
                let mut payload = args.clone();
                if let Some(object) = payload.as_object_mut() {
                    object.remove("id");
                }
                let input: ProfileInput = serde_json::from_value(payload)
                    .map_err(|e| format!("profile-invalid: {e}"))?;
                let facts = cli_facts(input.cli.trim())?;
                let profile = ops::update(&WasmHost, &id, &input, facts, &now)?;
                WasmHost.log_info(&format!(
                    "agent profile updated (id={}, cli={}, name={})",
                    profile.id, profile.cli, profile.name
                ));
                Ok(json!({ "profile": view(profile)? }))
            }
            DELETE_COMMAND => {
                let id = require_str(&args, "id", DELETE_COMMAND)?;
                let deleted = ops::delete(&WasmHost, &id)?;
                Ok(json!({ "deleted": deleted }))
            }
            OPTIONS_COMMAND => crate::run::agent_control::catalog_via_host(&args),
            other => Err(format!("unknown agent profile command: {other}")),
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) use wasm_commands::{ensure_schema, invoke_command, list_profiles, list_views};

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn ensure_schema() -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn list_profiles() -> Result<Vec<model::AgentProfile>, String> {
    Err("agent pool is only available in the wasm host".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn list_views() -> Result<Vec<model::AgentProfileView>, String> {
    Err("agent pool is only available in the wasm host".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn invoke_command(
    _name: &str,
    _args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Err("agent pool commands are only available in the wasm host".to_string())
}
