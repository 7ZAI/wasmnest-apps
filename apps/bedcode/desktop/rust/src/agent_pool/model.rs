//! Agent 池 wire 模型与输入校验（纯逻辑，native 可测）。
//!
//! 池成员 = 「一次可派发的 agent 人格」：CLI 是执行载体，模型 / 思考等级是
//! 运行参数，标签 / 擅长 / 职责描述是编排匹配语义。CLI 清单与安装状态由
//! Agent 管理域提供，本域只引用、不另造 CLI 事实。
//!
//! 校验是**纯函数**：安装状态经 [`CliFacts`] 注入，native 单测不碰宿主；
//! wasm 命令层负责从 hub 取真实事实。

use serde::{Deserialize, Serialize};

use crate::run::agent_control::{profile_for, safe_token};

/// 池成员数量上限（planner roster 的输入上限：防止 prompt 无界增长）
pub(crate) const MAX_PROFILES: usize = 50;
pub(crate) const NAME_MAX: usize = 48;
pub(crate) const DESCRIPTION_MAX: usize = 1000;
pub(crate) const TAG_MAX: usize = 24;
pub(crate) const SPECIALTY_MAX: usize = 40;
pub(crate) const LIST_MAX: usize = 8;

/// 一条池成员（wire 形状即私有库投影）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProfile {
    pub id: String,
    pub name: String,
    pub cli: String,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub tags: Vec<String>,
    pub specialties: Vec<String>,
    pub description: String,
    /// 是否允许被选为编排 Agent（创建编排时选择）
    pub can_orchestrate: bool,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl AgentProfile {
    /// 派发时使用的快照（计划 / 节点 / planner 各持一份）。
    pub(crate) fn snapshot(&self) -> crate::orchestration::model::AgentSnapshot {
        crate::orchestration::model::AgentSnapshot {
            profile_id: self.id.clone(),
            name: self.name.clone(),
            cli: self.cli.clone(),
            model: self.model.clone(),
            thinking_level: self.thinking_level.clone(),
        }
    }
}

/// 列表视图：池成员 + CLI 就绪态（由 hub 安装事实计算，不落库）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProfileView {
    #[serde(flatten)]
    pub profile: AgentProfile,
    pub ready: bool,
}

/// 创建 / 更新输入（`id` / 时间戳由命令层持有，不接受前端伪造）。
///
/// **不启用 `deny_unknown_fields`**：宿主会给每个命令 args 注入
/// `resource_dir` 等运行期字段；严格形状会把宿主元数据当成前端错误拒掉。
/// 池字段仍由本结构逐一白名单化，未知业务字段不会进入存储。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileInput {
    pub name: String,
    pub cli: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub thinking_level: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub specialties: Vec<String>,
    pub description: String,
    #[serde(default)]
    pub can_orchestrate: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

/// CLI 事实（安装 / 桥接能力）；由 wasm 命令层注入。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CliFacts {
    pub installed: bool,
    pub bridge_capable: bool,
}

/// 校验通过后的归一值（id / created_at 由调用方补齐）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProfileDraft {
    pub name: String,
    pub cli: String,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub tags: Vec<String>,
    pub specialties: Vec<String>,
    pub description: String,
    pub can_orchestrate: bool,
    pub enabled: bool,
}

/// 校验失败：`code` 是稳定错误码（前端 i18n 的 key），message 只作诊断。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProfileError {
    pub code: &'static str,
    pub message: String,
}

impl ProfileError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub(crate) fn as_message(&self) -> String {
        format!("{}: {}", self.code, self.message)
    }
}

/// 校验并归一一条池成员输入。
///
/// `others` 是除自身外的现存成员（名称唯一性用）；`facts` 是 CLI 安装 / 桥接事实。
/// **禁用中的成员不要求 CLI 已安装**：卸载后仍可保留配置并显性标灰，而不是逼用户
/// 删掉再重建。
pub(crate) fn validate(
    input: &ProfileInput,
    others: &[AgentProfile],
    facts: CliFacts,
) -> Result<ProfileDraft, ProfileError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(ProfileError::new("profile-name-required", "name must not be empty"));
    }
    if name.chars().count() > NAME_MAX {
        return Err(ProfileError::new(
            "profile-name-invalid",
            format!("name must be at most {NAME_MAX} characters"),
        ));
    }
    if name.chars().any(char::is_control) {
        return Err(ProfileError::new(
            "profile-name-invalid",
            "name must not contain control characters",
        ));
    }
    if others
        .iter()
        .any(|profile| profile.name.eq_ignore_ascii_case(name))
    {
        return Err(ProfileError::new(
            "profile-name-taken",
            format!("an agent named `{name}` already exists"),
        ));
    }

    let cli = input.cli.trim();
    let control = profile_for(cli).ok_or_else(|| {
        ProfileError::new("profile-cli-unknown", format!("unknown agent CLI `{cli}`"))
    })?;
    if !facts.bridge_capable {
        return Err(ProfileError::new(
            "profile-cli-not-orchestratable",
            format!("agent CLI `{cli}` has no bridge; it cannot be dispatched by orchestration"),
        ));
    }
    if input.enabled && !facts.installed {
        return Err(ProfileError::new(
            "profile-cli-not-installed",
            format!("agent CLI `{cli}` is not installed"),
        ));
    }

    let model = normalize_optional(input.model.as_deref());
    if let Some(model) = model.as_deref() {
        if !safe_token(model) {
            return Err(ProfileError::new(
                "profile-model-invalid",
                "model must be a single token (no spaces or control characters)",
            ));
        }
    }

    let thinking_level = normalize_optional(input.thinking_level.as_deref());
    if let Some(level) = thinking_level.as_deref() {
        if control.thinking_levels.is_empty() {
            return Err(ProfileError::new(
                "profile-thinking-unsupported",
                format!("agent CLI `{cli}` has no independent thinking level"),
            ));
        }
        if !control.thinking_levels.iter().any(|known| *known == level) {
            return Err(ProfileError::new(
                "profile-thinking-unknown",
                format!(
                    "thinking level `{level}` is not supported by `{cli}` (supported: {})",
                    control.thinking_levels.join(", ")
                ),
            ));
        }
    }

    let tags = normalize_list(
        &input.tags,
        TAG_MAX,
        "profile-tags-invalid",
        "tag",
    )?;
    let specialties = normalize_list(
        &input.specialties,
        SPECIALTY_MAX,
        "profile-specialties-invalid",
        "specialty",
    )?;

    let description = input.description.trim();
    if description.is_empty() {
        return Err(ProfileError::new(
            "profile-description-required",
            "description must not be empty (the orchestrator matches tasks against it)",
        ));
    }
    if description.chars().count() > DESCRIPTION_MAX {
        return Err(ProfileError::new(
            "profile-description-invalid",
            format!("description must be at most {DESCRIPTION_MAX} characters"),
        ));
    }
    // description 会进 planner roster prompt：控制字符不能像 name 一样放过（L6）。
    if description.chars().any(char::is_control) {
        return Err(ProfileError::new(
            "profile-description-invalid",
            "description must not contain control characters",
        ));
    }

    Ok(ProfileDraft {
        name: name.to_string(),
        cli: cli.to_string(),
        model,
        thinking_level,
        tags,
        specialties,
        description: description.to_string(),
        can_orchestrate: input.can_orchestrate,
        enabled: input.enabled,
    })
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_list(
    values: &[String],
    max_len: usize,
    code: &'static str,
    label: &str,
) -> Result<Vec<String>, ProfileError> {
    let mut out: Vec<String> = Vec::new();
    for raw in values {
        let value = raw.trim();
        if value.is_empty() {
            continue;
        }
        if value.chars().count() > max_len {
            return Err(ProfileError::new(
                code,
                format!("{label} `{value}` exceeds {max_len} characters"),
            ));
        }
        if value.chars().any(char::is_control) {
            return Err(ProfileError::new(
                code,
                format!("{label} `{value}` contains control characters"),
            ));
        }
        if !out.iter().any(|existing| existing.eq_ignore_ascii_case(value)) {
            out.push(value.to_string());
        }
    }
    if out.len() > LIST_MAX {
        return Err(ProfileError::new(
            code,
            format!("at most {LIST_MAX} {label}s are allowed"),
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests;
