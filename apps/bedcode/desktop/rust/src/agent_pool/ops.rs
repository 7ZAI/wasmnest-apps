//! Agent 池命令实现（纯逻辑，依赖 [`AgentPoolStore`] 端口）。
//!
//! 名称唯一性、上限、时间戳、id 生成都收敛在这里；CLI 安装事实经 [`CliFacts`]
//! 注入，native 单测不碰 wasm。

use super::model::{
    validate, AgentProfile, CliFacts, ProfileDraft, ProfileError, ProfileInput, MAX_PROFILES,
};
use super::store::AgentPoolStore;

fn invalid(error: ProfileError) -> String {
    error.as_message()
}

fn now_id() -> Result<String, String> {
    crate::config::model::new_config_id()
}

fn check_capacity(profiles: &[AgentProfile], replacing: Option<&str>) -> Result<(), String> {
    let count = profiles
        .iter()
        .filter(|profile| Some(profile.id.as_str()) != replacing)
        .count();
    if count >= MAX_PROFILES {
        return Err(format!(
            "profile-capacity: at most {MAX_PROFILES} agents are allowed"
        ));
    }
    Ok(())
}

fn build(
    id: String,
    draft: ProfileDraft,
    created_at: String,
    updated_at: String,
) -> AgentProfile {
    AgentProfile {
        id,
        name: draft.name,
        cli: draft.cli,
        model: draft.model,
        thinking_level: draft.thinking_level,
        tags: draft.tags,
        specialties: draft.specialties,
        description: draft.description,
        can_orchestrate: draft.can_orchestrate,
        enabled: draft.enabled,
        created_at,
        updated_at,
    }
}

pub(crate) fn list(store: &impl AgentPoolStore) -> Result<Vec<AgentProfile>, String> {
    store.list()
}

pub(crate) fn get(store: &impl AgentPoolStore, id: &str) -> Result<Option<AgentProfile>, String> {
    store.get(id)
}

pub(crate) fn create(
    store: &impl AgentPoolStore,
    input: &ProfileInput,
    facts: CliFacts,
    now: &str,
) -> Result<AgentProfile, String> {
    let existing = store.list()?;
    check_capacity(&existing, None)?;
    let draft = validate(input, &existing, facts).map_err(invalid)?;
    let profile = build(now_id()?, draft, now.to_string(), now.to_string());
    store.put(&profile)?;
    Ok(profile)
}

pub(crate) fn update(
    store: &impl AgentPoolStore,
    id: &str,
    input: &ProfileInput,
    facts: CliFacts,
    now: &str,
) -> Result<AgentProfile, String> {
    let existing = store
        .get(id)?
        .ok_or_else(|| format!("profile-not-found: no agent with id `{id}`"))?;
    let others: Vec<AgentProfile> = store
        .list()?
        .into_iter()
        .filter(|profile| profile.id != existing.id)
        .collect();
    let draft = validate(input, &others, facts).map_err(invalid)?;
    let profile = build(
        existing.id.clone(),
        draft,
        existing.created_at.clone(),
        now.to_string(),
    );
    store.put(&profile)?;
    Ok(profile)
}

pub(crate) fn delete(store: &impl AgentPoolStore, id: &str) -> Result<bool, String> {
    store.delete(id)
}

#[cfg(test)]
mod tests;
