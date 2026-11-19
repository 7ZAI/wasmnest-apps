//! 源 / 圈子 / 凭据的写路径与导出。
//!
//! 校验判据都放在这里（而不是插件层）：表单、助手工具、导入将来都走同一份规则，
//! 不允许两套校验各自漂移。

use crate::adapters::{self, AuthSecret};
use crate::domain::{
    error_kind, Circle, CredentialSummary, Source, SourceKind, UNGROUPED_CIRCLE_ID,
};
use crate::ports::{PortError, Ports};
use crate::store;
use crate::urlutil;
use crate::views;
use serde::{Deserialize, Serialize};

/// 新建源入参。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewSource {
    pub name: String,
    pub kind: String,
    pub url: String,
    #[serde(default)]
    pub circle_id: Option<String>,
    #[serde(default)]
    pub weight: Option<f64>,
    #[serde(default)]
    pub auth_id: Option<String>,
}

/// 更新源入参（整份提交，避免「部分字段改了、部分没改」的歧义）。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSource {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub circle_id: Option<String>,
    pub weight: f64,
    pub enabled: bool,
    #[serde(default)]
    pub auth_id: Option<String>,
}

/// 新建 / 更新圈子入参。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CircleInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub weight: Option<f64>,
}

/// 保存凭据入参。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CredentialInput {
    #[serde(default)]
    pub id: Option<String>,
    pub kind: String,
    pub label: String,
    pub secret: AuthSecret,
}

/// 校验并归一化源地址。
fn normalize_source_url(kind: SourceKind, raw: &str) -> Result<String, PortError> {
    let url = raw.trim();
    if url.is_empty() {
        return Err(store::invalid("source url is required"));
    }
    let canonical = adapters::canonical_source_url(kind, url)
        .ok_or_else(|| store::invalid("source url is not usable for this source kind"))?;
    urlutil::normalize_url(&canonical)
        .ok_or_else(|| store::invalid("source url must be an absolute http(s) url"))
}

/// 新建源。
pub fn create_source(p: &Ports<'_>, input: &NewSource, now_ms: i64) -> Result<Source, PortError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(store::invalid("source name is required"));
    }
    let kind = SourceKind::parse(input.kind.trim())
        .ok_or_else(|| store::invalid(format!("unknown source kind '{}'", input.kind)))?;
    if !kind.user_selectable() {
        return Err(store::invalid(
            "this source kind is reserved for built-in sources",
        ));
    }
    let url = normalize_source_url(kind, &input.url)?;

    let existing = store::load_sources(p)?;
    if existing.iter().any(|s| s.url == url) {
        return Err(store::invalid("this url is already registered"));
    }
    if let Some(circle_id) = &input.circle_id {
        let circles = store::load_circles(p)?;
        if !circles.iter().any(|c| &c.id == circle_id) {
            return Err(store::invalid(format!("circle {circle_id} does not exist")));
        }
    }
    if kind.needs_auth() && input.auth_id.as_deref().unwrap_or("").is_empty() {
        return Err(store::invalid(
            "experimental sources require credentials; add them before saving",
        ));
    }

    let id = format!("src-{}", short_id(&format!("{url}#{now_ms}")));
    let weight = views::clamp_weight(input.weight.unwrap_or(views::WEIGHT_DEFAULT));
    store::insert_source(
        p,
        &id,
        name,
        kind.as_str(),
        &url,
        input.circle_id.as_deref(),
        weight,
        input.auth_id.as_deref(),
        now_ms,
    )?;
    store::load_source(p, &id)?
        .ok_or_else(|| PortError::with_detail(error_kind::INVALID_ARGUMENT, "source insert lost"))
}

/// 更新源。
pub fn update_source(p: &Ports<'_>, input: &UpdateSource, now_ms: i64) -> Result<Source, PortError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(store::invalid("source name is required"));
    }
    let current = store::load_source(p, &input.id)?
        .ok_or_else(|| store::invalid(format!("source {} does not exist", input.id)))?;
    let kind = SourceKind::parse(&current.kind)
        .ok_or_else(|| store::invalid(format!("unknown source kind '{}'", current.kind)))?;
    let url = normalize_source_url(kind, &input.url)?;

    if input.circle_id.is_some() && input.circle_id.as_deref() != Some(UNGROUPED_CIRCLE_ID) {
        let circles = store::load_circles(p)?;
        if !circles
            .iter()
            .any(|c| Some(&c.id) == input.circle_id.as_ref())
        {
            return Err(store::invalid("circle does not exist"));
        }
    }
    let circle_id = match input.circle_id.as_deref() {
        Some(UNGROUPED_CIRCLE_ID) | None => None,
        Some(id) => Some(id),
    };
    let weight = views::clamp_weight(input.weight);
    store::update_source(
        p,
        &input.id,
        name,
        &url,
        circle_id,
        weight,
        input.enabled,
        input.auth_id.as_deref(),
        now_ms,
    )?;
    store::load_source(p, &input.id)?
        .ok_or_else(|| store::invalid("source disappeared during update"))
}

/// 删除源（来源归属同步删除，条目保留）。
pub fn delete_source(p: &Ports<'_>, id: &str) -> Result<(), PortError> {
    store::load_source(p, id)?
        .ok_or_else(|| store::invalid(format!("source {id} does not exist")))?;
    store::delete_source(p, id)
}

/// 新建圈子。
pub fn create_circle(
    p: &Ports<'_>,
    input: &CircleInput,
    now_ms: i64,
) -> Result<Circle, PortError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(store::invalid("circle name is required"));
    }
    let existing = store::load_circles(p)?;
    if existing
        .iter()
        .any(|c| c.name.eq_ignore_ascii_case(name))
    {
        return Err(store::invalid("a circle with this name already exists"));
    }
    let sort_order = existing
        .iter()
        .map(|c| c.sort_order)
        .max()
        .unwrap_or(-1)
        + 1;
    let id = format!("circle-{}", short_id(&format!("{name}#{now_ms}")));
    let weight = views::clamp_weight(input.weight.unwrap_or(views::WEIGHT_DEFAULT));
    store::insert_circle(p, &id, name, weight, sort_order, now_ms)?;
    store::load_circles(p)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| store::invalid("circle disappeared during insert"))
}

/// 更新圈子。
pub fn update_circle(p: &Ports<'_>, input: &CircleInput) -> Result<Circle, PortError> {
    let id = input
        .id
        .as_deref()
        .ok_or_else(|| store::invalid("circle id is required"))?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err(store::invalid("circle name is required"));
    }
    let circles = store::load_circles(p)?;
    let current = circles
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| store::invalid(format!("circle {id} does not exist")))?;
    if circles
        .iter()
        .any(|c| c.id != id && c.name.eq_ignore_ascii_case(name))
    {
        return Err(store::invalid("a circle with this name already exists"));
    }
    let weight = views::clamp_weight(input.weight.unwrap_or(current.weight));
    store::update_circle(p, id, name, weight)?;
    store::load_circles(p)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| store::invalid("circle disappeared during update"))
}

/// 删除圈子（其下源回到「未分组」，条目保留）。
pub fn delete_circle(p: &Ports<'_>, id: &str) -> Result<(), PortError> {
    let circles = store::load_circles(p)?;
    if !circles.iter().any(|c| c.id == id) {
        return Err(store::invalid(format!("circle {id} does not exist")));
    }
    store::delete_circle(p, id)
}

/// 保存凭据。
pub fn save_credential(
    p: &Ports<'_>,
    input: &CredentialInput,
    now_ms: i64,
) -> Result<CredentialSummary, PortError> {
    if input.secret.is_empty() {
        return Err(store::invalid(
            "credential needs a cookie or a bearer token",
        ));
    }
    let label = input.label.trim();
    if label.is_empty() {
        return Err(store::invalid("credential label is required"));
    }
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("cred-{}", short_id(&format!("{label}#{now_ms}"))));
    let secret_json = serde_json::to_string(&input.secret)
        .map_err(|e| store::invalid(format!("credential serialization failed: {e}")))?;
    store::save_credential(p, &id, input.kind.trim(), label, &secret_json, now_ms)?;
    store::list_credentials(p)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| store::invalid("credential disappeared during save"))
}

/// 删除凭据。
pub fn delete_credential(p: &Ports<'_>, id: &str, now_ms: i64) -> Result<(), PortError> {
    store::delete_credential(p, id, now_ms)
}

/// 导出 JSON：包含源、圈子、已读与收藏状态，**排除凭据与 AI 密钥**。
pub fn export_json(p: &Ports<'_>, now_ms: i64) -> Result<String, PortError> {
    let sources: Vec<serde_json::Value> = store::load_sources(p)?
        .into_iter()
        .map(|s| {
            serde_json::json!({
                "id": s.id,
                "name": s.name,
                "kind": s.kind,
                "url": s.url,
                "circleId": s.circle_id,
                "weight": s.weight,
                "enabled": s.enabled,
            })
        })
        .collect();
    let circles: Vec<serde_json::Value> = store::load_circles(p)?
        .into_iter()
        .map(|c| {
            serde_json::json!({
                "id": c.id,
                "name": c.name,
                "weight": c.weight,
                "sortOrder": c.sort_order,
            })
        })
        .collect();
    let settings = store::load_settings(p)?;
    let read = store::load_read_flags(p)?;
    let favorites = store::load_favorite_flags(p)?;
    let payload = serde_json::json!({
        "version": 1,
        "exportedAt": now_ms,
        "circles": circles,
        "sources": sources,
        "readItemIds": read,
        "favoriteItemIds": favorites,
        "settings": {
            "aiEnabled": settings.ai_enabled,
            "aiBaseUrl": settings.ai_base_url,
            "aiModel": settings.ai_model,
        },
    });
    serde_json::to_string_pretty(&payload)
        .map_err(|e| store::invalid(format!("export serialization failed: {e}")))
}

fn short_id(seed: &str) -> String {
    urlutil::item_id(seed)[..12].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn youtube_url_is_normalized_to_feed_address() {
        let url = normalize_source_url(
            SourceKind::YoutubeRss,
            "https://www.youtube.com/channel/UCabc",
        )
        .unwrap();
        assert_eq!(
            url,
            "https://www.youtube.com/feeds/videos.xml?channel_id=UCabc"
        );
    }

    #[test]
    fn reddit_short_form_becomes_json_endpoint() {
        let url = normalize_source_url(SourceKind::Reddit, "r/worldnews").unwrap();
        assert_eq!(url, "https://www.reddit.com/r/worldnews.json");
    }

    #[test]
    fn non_http_urls_are_rejected() {
        assert!(normalize_source_url(SourceKind::Rss, "ftp://e.com/a").is_err());
        assert!(normalize_source_url(SourceKind::Rss, "not a url").is_err());
        assert!(normalize_source_url(SourceKind::Rss, "").is_err());
    }

    #[test]
    fn tracking_parameters_are_trimmed_on_save() {
        let url = normalize_source_url(
            SourceKind::Rss,
            "https://example.com/feed.xml?utm_source=x",
        )
        .unwrap();
        assert_eq!(url, "https://example.com/feed.xml");
    }
}
