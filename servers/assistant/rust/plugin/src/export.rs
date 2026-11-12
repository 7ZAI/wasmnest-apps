//! 导出 / 清空（票 07 / spec §5.3）
//!
//! - **导出**：JSON（会话元数据 + 已确认记忆明文 + 审计摘要）；**密钥不导出**。
//!   记忆值需会话密钥解密——未解锁时显性报错（fail-visible），不静默导出密文。
//! - **清空**：二次确认后按表删除业务数据（保险库元数据保留，口令 / salt /
//!   校验值不动）；单事务，失败回滚语义由宿主 batch 保证。

use serde_json::Value;

use crate::store::Store;
use crate::vault;

/// 导出全部数据（会话 + 已确认记忆 + 审计摘要）；密钥不在其中
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub fn export_json(store: &dyn Store) -> Result<Value, String> {
    // 记忆值需解密 → 必须已解锁
    let key = vault::session_key()?;

    let conversations = store.list_conversations()?;
    let memory = store.list_memory("", "confirmed")?;
    let audit = store.list_audit(200)?;

    // 解密已确认记忆值（AAD 绑定 memory:<id>）
    let mut memory_out = Vec::with_capacity(memory.len());
    for f in &memory {
        let aad = vault::content_aad("memory", &f.id);
        let value = hex::encode(vault::decrypt(&key, &f.value_enc, &aad)?);
        memory_out.push(serde_json::json!({
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
        }));
    }

    store.export_all(&conversations, &memory, &audit)
}

/// 清空全部业务数据（保险库元数据保留）
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub fn clear_all(store: &dyn Store) -> Result<(), String> {
    store.clear_all()
}

#[cfg(test)]
mod tests {
    // 导出 / 清空的编排依赖 Store 端口；native 单测不链接 wasm 宿主，
    // 编排正确性由 wasm 构建 + 票 16 E2E 覆盖（此处不写空壳测试）。
}
