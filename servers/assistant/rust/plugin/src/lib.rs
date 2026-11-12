//! Nest 助手插件（WASM，双端同构共享 crate · 票 08 对话主链路）
//!
//! 命令面（spec 附录 A + 票 07/08）：
//! - 保险库：`assistant.vault-status / init / unlock / lock / change-password`
//! - 保险库密钥槽：`assistant.vault-set-secret / get-secret / delete-secret`（票 08，
//!   密钥明文只经解锁后的会话密钥解密，落库为 AEAD 密文）
//! - 对话流：`assistant.chat-stream`（票 08：校验 streamEvent 与 streamId 精确
//!   匹配后 raw 流式透传宿主，方言知识在前端共享核）
//! - 记忆：`assistant.memory-list / upsert / delete`
//! - 审计：`assistant.audit-list`
//! - 供应商：`assistant.providers-list / upsert / set-default`
//! - 设置：`assistant.settings-get / set`
//! - 会话 / 消息：`assistant.conversations-*` / `assistant.messages-*`
//! - 导出 / 清空：`assistant.export` / `assistant.clear-data`
//!
//! 失败语义（spec §2.4）：未知命令、未解锁读密文、缺随机数 / 时间戳等一律
//! **点名缺什么**，不静默返回空对象冒充成功。
//!
//! 清单真源 = 桌面端 `desktop/plugin.json`（spec 附录 A 草案）；共享 crate
//! 不属于任何一端，`manifest()` 读桌面端清单（移动端同形状，仅 `platform` 字段不同）。
//!
//! 存储命令（走 `WasmHost` 的 `Store` 实现）仅在 wasm32 编译；native 单测只覆盖
//! 纯逻辑（vault 密码学 / store 映射 / 参数提取 / ping），不链接 wasm 宿主。
//! native 构建下 wasm 专用代码为死代码，按 wasm crate 惯例条件放行（wasm 构建仍全量告警）。

#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code, unused_imports, unused_variables))]

use serde_json::{json, Value};

use wasmnest_plugin_api::host::HostLog;
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::{WasmHost, WasmPlugin};

mod audit;
mod chat;
mod export;
mod store;
mod vault;

#[cfg_attr(not(target_arch = "wasm32"), allow(unused_imports))]
use crate::store::{Conversation, Message, MemoryFact, Provider, Store};
#[cfg_attr(not(target_arch = "wasm32"), allow(unused_imports))]
use crate::vault::{KdfParams, Vault};

const PLUGIN_ID: &str = "com.wasmnest.assistant";

struct AssistantPlugin;

impl WasmPlugin for AssistantPlugin {
    const ID: &'static str = PLUGIN_ID;

    fn manifest() -> PluginManifest {
        serde_json::from_str(include_str!("../../../desktop/plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        #[cfg(target_arch = "wasm32")]
        {
            // 激活即建表 + 迁移（幂等）；失败显性报错（fail-visible，不半迁移）
            WasmHost.ensure_schema().map_err(anyhow::Error::msg)?;
        }
        WasmHost.log_info("Nest assistant activated (data foundation ready)");
        Ok(())
    }

    fn deactivate() -> anyhow::Result<()> {
        // 停用即锁定保险库（会话密钥清空；数据保留，重启/再启用需重新解锁）
        vault::clear_session_key();
        WasmHost.log_info("Nest assistant deactivated (vault locked)");
        Ok(())
    }

    #[cfg_attr(not(target_arch = "wasm32"), allow(unused_variables))]
    fn invoke_command(name: &str, args: Value) -> anyhow::Result<Value> {
        let result: Result<Value, String> = match name {
            "assistant.ping" => Ok(json!({ "ok": true, "appId": PLUGIN_ID })),

            // ==================== 保险库（wasm 存储命令） ====================
            #[cfg(target_arch = "wasm32")]
            "assistant.vault-status" => cmd_vault_status(),
            #[cfg(target_arch = "wasm32")]
            "assistant.vault-init" => cmd_vault_init(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.vault-unlock" => cmd_vault_unlock(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.vault-lock" => cmd_vault_lock(),
            #[cfg(target_arch = "wasm32")]
            "assistant.vault-change-password" => cmd_vault_change_password(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.vault-set-secret" => cmd_vault_set_secret(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.vault-get-secret" => cmd_vault_get_secret(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.vault-delete-secret" => cmd_vault_delete_secret(&args),

            // ==================== 对话流（票 08） ====================
            #[cfg(target_arch = "wasm32")]
            "assistant.chat-stream" => chat::chat_stream(&args),

            // ==================== 记忆 ====================
            #[cfg(target_arch = "wasm32")]
            "assistant.memory-list" => cmd_memory_list(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.memory-upsert" => cmd_memory_upsert(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.memory-delete" => cmd_memory_delete(&args),

            // ==================== 审计 ====================
            #[cfg(target_arch = "wasm32")]
            "assistant.audit-list" => cmd_audit_list(&args),

            // ==================== 供应商 ====================
            #[cfg(target_arch = "wasm32")]
            "assistant.providers-list" => cmd_providers_list(),
            #[cfg(target_arch = "wasm32")]
            "assistant.providers-upsert" => cmd_providers_upsert(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.providers-set-default" => cmd_providers_set_default(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.providers-delete" => cmd_providers_delete(&args),

            // ==================== 设置 ====================
            #[cfg(target_arch = "wasm32")]
            "assistant.settings-get" => cmd_settings_get(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.settings-set" => cmd_settings_set(&args),

            // ==================== 会话 / 消息 ====================
            #[cfg(target_arch = "wasm32")]
            "assistant.conversations-list" => cmd_conversations_list(),
            #[cfg(target_arch = "wasm32")]
            "assistant.conversations-create" => cmd_conversations_create(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.conversations-rename" => cmd_conversations_rename(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.conversations-archive" => cmd_conversations_archive(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.messages-append" => cmd_messages_append(&args),
            #[cfg(target_arch = "wasm32")]
            "assistant.messages-list" => cmd_messages_list(&args),

            // ==================== 导出 / 清空 ====================
            #[cfg(target_arch = "wasm32")]
            "assistant.export" => cmd_export(),
            #[cfg(target_arch = "wasm32")]
            "assistant.clear-data" => cmd_clear_data(),

            other => Err(format!("Unknown assistant command: {other}")),
        };
        result.map_err(anyhow::Error::msg)
    }
}

wasmnest_plugin_api::wasm_entry!(AssistantPlugin);

// ==================== 参数提取 ====================

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn arg_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("缺参数: {key}"))
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn arg_opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn arg_i64(args: &Value, key: &str, default: i64) -> i64 {
    args.get(key).and_then(|v| v.as_i64()).unwrap_or(default)
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn arg_bool(args: &Value, key: &str, default: bool) -> bool {
    args.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

/// 自增 id（settings 计数器，无随机源依赖）
#[cfg(target_arch = "wasm32")]
fn next_id(store: &dyn Store, prefix: &str) -> Result<String, String> {
    let key = format!("idseq:{prefix}");
    let cur = store
        .get_setting(&key)?
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let next = cur + 1;
    store.set_setting(&key, &next.to_string())?;
    Ok(format!("{prefix}-{next}"))
}

// ==================== 保险库命令（wasm） ====================

#[cfg(target_arch = "wasm32")]
fn cmd_vault_status() -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let meta = store.vault_meta()?;
    Ok(json!({
        "exists": meta.is_some(),
        "unlocked": vault::is_unlocked(),
        "createdAt": meta.as_ref().map(|m| m.created_at.clone()),
    }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_vault_init(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    store.ensure_schema()?;
    if store.vault_meta()?.is_some() {
        return Err("保险库已存在：如需重置请先清空数据".to_string());
    }
    let password = arg_str(args, "password")?;
    let salt = arg_str(args, "salt")?;
    let verifier_nonce = arg_str(args, "verifierNonce")?;
    // 参数：前端给定（移动可降档），缺省用桌面默认档
    let params = KdfParams {
        m: arg_i64(args, "m", KdfParams::default().m as i64) as u32,
        t: arg_i64(args, "t", KdfParams::default().t as i64) as u32,
        p: arg_i64(args, "p", KdfParams::default().p as i64) as u32,
    };
    let ts = arg_opt_str(args, "ts").unwrap_or_else(|| "0".to_string());
    let meta = Vault::init(&password, &salt, &verifier_nonce, params, &ts)?;
    store.put_vault_meta(&meta)?;
    Ok(json!({ "ok": true, "unlocked": true }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_vault_unlock(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let meta = store
        .vault_meta()?
        .ok_or_else(|| "保险库不存在：请先完成首次设置".to_string())?;
    let password = arg_str(args, "password")?;
    Vault::from_meta(meta).unlock(&password)?;
    Ok(json!({ "ok": true, "unlocked": true }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_vault_lock() -> Result<Value, String> {
    vault::clear_session_key();
    Ok(json!({ "ok": true, "unlocked": false }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_vault_change_password(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let meta = store
        .vault_meta()?
        .ok_or_else(|| "保险库不存在".to_string())?;
    let old_password = arg_str(args, "oldPassword")?;
    let new_password = arg_str(args, "newPassword")?;
    let new_salt = arg_str(args, "newSalt")?;
    let new_verifier_nonce = arg_str(args, "newVerifierNonce")?;
    let (new_meta, old_key, new_key) = Vault::from_meta(meta)
        .change_password(&old_password, &new_password, &new_salt, &new_verifier_nonce)?;
    // 单事务重加密全部内容密文（复用原 nonce 换新密钥）
    store.reencrypt_all(&old_key, &new_key)?;
    store.put_vault_meta(&new_meta)?;
    vault::set_session_key(new_key);
    Ok(json!({ "ok": true, "unlocked": true }))
}

// ==================== 保险库密钥槽命令（票 08 · wasm） ====================

/// 密钥槽 AAD 域（与消息 / 记忆区分，密文不跨域互通）
#[cfg(target_arch = "wasm32")]
fn secret_aad(key: &str) -> Vec<u8> {
    vault::content_aad("secret", key)
}

#[cfg(target_arch = "wasm32")]
fn cmd_vault_set_secret(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let key = vault::session_key()?; // 未解锁显性报错
    let name = arg_str(args, "key")?;
    let value = arg_str(args, "value")?;
    let nonce = arg_str(args, "nonce")?;
    let ts = arg_opt_str(args, "ts").unwrap_or_else(|| "0".to_string());
    let value_enc = vault::encrypt(&key, &nonce, value.as_bytes(), &secret_aad(&name))?;
    store.put_secret(&crate::store::Secret {
        key: name.clone(),
        value_enc,
        nonce,
        updated_at: ts,
    })?;
    Ok(json!({ "ok": true, "key": name }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_vault_get_secret(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let key = vault::session_key()?; // 未解锁显性报错
    let name = arg_str(args, "key")?;
    let sec = store
        .get_secret(&name)?
        .ok_or_else(|| format!("密钥槽不存在: {name}"))?;
    let aad = secret_aad(&name);
    let value = hex::encode(vault::decrypt(&key, &sec.value_enc, &aad)?);
    Ok(json!({ "key": name, "value": value }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_vault_delete_secret(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let name = arg_str(args, "key")?;
    let deleted = store.delete_secret(&name)?;
    Ok(json!({ "ok": true, "key": name, "deleted": deleted }))
}

// ==================== 记忆命令（wasm） ====================

#[cfg(target_arch = "wasm32")]
fn cmd_memory_list(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let key = vault::session_key()?; // 未解锁显性报错
    let scope = arg_opt_str(args, "scope").unwrap_or_default();
    let status = arg_opt_str(args, "status").unwrap_or_default();
    let facts = store.list_memory(&scope, &status)?;
    let out: Vec<Value> = facts
        .iter()
        .map(|f| {
            let aad = vault::content_aad("memory", &f.id);
            let value = hex::encode(vault::decrypt(&key, &f.value_enc, &aad)?);
            Ok(json!({
                "id": f.id,
                "scope": f.scope,
                "scopeRef": f.scope_ref,
                "key": f.key,
                "value": value,
                "sourceConversationId": f.source_conversation_id,
                "sourceMessageId": f.source_message_id,
                "status": f.status,
                "createdAt": f.created_at,
                "updatedAt": f.updated_at,
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(json!({ "facts": out }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_memory_upsert(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let key = vault::session_key()?;
    let scope = arg_str(args, "scope")?;
    let key_name = arg_str(args, "key")?;
    let value = arg_str(args, "value")?;
    let nonce = arg_str(args, "nonce")?;
    let status = arg_opt_str(args, "status").unwrap_or_else(|| "pending".to_string());
    let ts = arg_opt_str(args, "ts").unwrap_or_else(|| "0".to_string());
    let id = match arg_opt_str(args, "id") {
        Some(id) => id,
        None => next_id(store, "mem")?,
    };
    let aad = vault::content_aad("memory", &id);
    let value_enc = vault::encrypt(&key, &nonce, value.as_bytes(), &aad)?;
    let fact = MemoryFact {
        id,
        scope,
        scope_ref: arg_opt_str(args, "scopeRef"),
        key: key_name,
        value_enc,
        source_conversation_id: arg_opt_str(args, "sourceConversationId"),
        source_message_id: arg_opt_str(args, "sourceMessageId"),
        status,
        created_at: ts.clone(),
        updated_at: ts,
    };
    store.upsert_memory(&fact)?;
    Ok(json!({ "ok": true, "id": fact.id }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_memory_delete(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let id = arg_str(args, "id")?;
    let deleted = store.delete_memory(&id)?;
    Ok(json!({ "ok": true, "deleted": deleted }))
}

// ==================== 审计命令（wasm） ====================

#[cfg(target_arch = "wasm32")]
fn cmd_audit_list(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let limit = arg_i64(args, "limit", 100);
    let entries = store.list_audit(limit)?;
    Ok(json!({ "entries": entries }))
}

// ==================== 供应商命令（wasm） ====================

#[cfg(target_arch = "wasm32")]
fn cmd_providers_list() -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    Ok(json!({ "providers": store.list_providers()? }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_providers_upsert(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let id = arg_str(args, "id")?;
    let p = Provider {
        id: id.clone(),
        name: arg_str(args, "name")?,
        api_style: arg_str(args, "apiStyle")?,
        base_url: arg_str(args, "baseUrl")?,
        model: arg_str(args, "model")?,
        extra_json: arg_opt_str(args, "extra").unwrap_or_else(|| "{}".to_string()),
        is_default: arg_bool(args, "isDefault", false),
    };
    store.upsert_provider(&p)?;
    if p.is_default {
        store.set_default_provider(&id)?;
    }
    Ok(json!({ "ok": true, "id": id }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_providers_set_default(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let id = arg_str(args, "id")?;
    store.set_default_provider(&id)?;
    Ok(json!({ "ok": true, "id": id }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_providers_delete(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let id = arg_str(args, "id")?;
    let deleted = store.delete_provider(&id)?;
    Ok(json!({ "ok": true, "id": id, "deleted": deleted }))
}

// ==================== 设置命令（wasm） ====================

#[cfg(target_arch = "wasm32")]
fn cmd_settings_get(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let key = arg_str(args, "key")?;
    let val = store.get_setting(&key)?;
    Ok(json!({ "key": key, "value": val }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_settings_set(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let key = arg_str(args, "key")?;
    let value = arg_str(args, "value")?;
    store.set_setting(&key, &value)?;
    Ok(json!({ "ok": true, "key": key }))
}

// ==================== 会话 / 消息命令（wasm） ====================

#[cfg(target_arch = "wasm32")]
fn cmd_conversations_list() -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    Ok(json!({ "conversations": store.list_conversations()? }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_conversations_create(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let id = match arg_opt_str(args, "id") {
        Some(id) => id,
        None => next_id(store, "conv")?,
    };
    let kind = arg_opt_str(args, "kind").unwrap_or_else(|| "companion".to_string());
    let title = arg_opt_str(args, "title").unwrap_or_else(|| "新会话".to_string());
    let ts = arg_opt_str(args, "ts").unwrap_or_else(|| "0".to_string());
    let c = Conversation {
        id: id.clone(),
        title,
        kind,
        created_at: ts.clone(),
        updated_at: ts,
        archived: false,
    };
    store.create_conversation(&c)?;
    Ok(json!({ "ok": true, "id": id }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_conversations_rename(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let id = arg_str(args, "id")?;
    let title = arg_str(args, "title")?;
    store.rename_conversation(&id, &title)?;
    Ok(json!({ "ok": true, "id": id }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_conversations_archive(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let id = arg_str(args, "id")?;
    let archived = arg_bool(args, "archived", true);
    store.archive_conversation(&id, archived)?;
    Ok(json!({ "ok": true, "id": id, "archived": archived }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_messages_append(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let key = vault::session_key()?;
    let conversation_id = arg_str(args, "conversationId")?;
    let seq = arg_i64(args, "seq", 0);
    let role = arg_str(args, "role")?;
    let content = arg_str(args, "content")?;
    let nonce = arg_str(args, "nonce")?;
    let ts = arg_opt_str(args, "ts").unwrap_or_else(|| "0".to_string());
    let id = match arg_opt_str(args, "id") {
        Some(id) => id,
        None => next_id(store, "msg")?,
    };
    let aad = vault::content_aad("message", &format!("{conversation_id}:{seq}"));
    let content_enc = vault::encrypt(&key, &nonce, content.as_bytes(), &aad)?;
    let m = Message {
        id: id.clone(),
        conversation_id: conversation_id.clone(),
        seq,
        role,
        content_enc,
        meta_json: arg_opt_str(args, "meta").unwrap_or_else(|| "{}".to_string()),
        created_at: ts.clone(),
    };
    store.append_message(&m)?;
    store.touch_conversation(&conversation_id, &ts)?;
    Ok(json!({ "ok": true, "id": id, "seq": seq }))
}

#[cfg(target_arch = "wasm32")]
fn cmd_messages_list(args: &Value) -> Result<Value, String> {
    let store = &WasmHost as &dyn Store;
    let key = vault::session_key()?;
    let conversation_id = arg_str(args, "conversationId")?;
    let limit = arg_i64(args, "limit", 50);
    let msgs = store.list_messages(&conversation_id, limit)?;
    let out: Vec<Value> = msgs
        .iter()
        .map(|m| {
            let aad = vault::content_aad("message", &format!("{}:{}", m.conversation_id, m.seq));
            let content = hex::encode(vault::decrypt(&key, &m.content_enc, &aad)?);
            Ok(json!({
                "id": m.id,
                "conversationId": m.conversation_id,
                "seq": m.seq,
                "role": m.role,
                "content": content,
                "meta": m.meta_json,
                "createdAt": m.created_at,
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(json!({ "messages": out }))
}

// ==================== 导出 / 清空（wasm） ====================

#[cfg(target_arch = "wasm32")]
fn cmd_export() -> Result<Value, String> {
    export::export_json(&WasmHost)
}

#[cfg(target_arch = "wasm32")]
fn cmd_clear_data() -> Result<Value, String> {
    export::clear_all(&WasmHost)?;
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ping 回显插件身份（双端同源，可与其它应用区分）
    #[test]
    fn ping_echoes_plugin_identity() {
        let result = AssistantPlugin::invoke_command("assistant.ping", json!({}))
            .expect("ping 必须成功");
        assert_eq!(result["ok"], json!(true));
        assert_eq!(result["appId"], json!(PLUGIN_ID));
    }

    /// 未知命令显性报错（不静默返回空）
    #[test]
    fn unknown_command_errors() {
        let err = AssistantPlugin::invoke_command("assistant.nope", json!({}))
            .expect_err("未知命令必须报错");
        assert!(err.to_string().contains("assistant.nope"));
    }

    /// 参数提取：缺必填点名
    #[test]
    fn arg_helpers_point_out_missing() {
        let args = json!({ "a": 1 });
        assert!(arg_str(&args, "missing").is_err());
        assert_eq!(arg_i64(&args, "a", 9), 1);
        assert_eq!(arg_i64(&args, "missing", 9), 9);
        assert!(arg_opt_str(&args, "missing").is_none());
    }
}
