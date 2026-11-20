//! 口令保险库
//!
//! - **派生**：Argon2id（参数 m / t / p 随保险库元数据存储，init 时由前端给定）。
//!   默认 m=32 MiB / t=3 / p=1：宿主给单插件线性内存的硬顶是 64 MiB，而 Argon2
//!   除 m 指定的工作区外还要分配少量缓冲；m=64 MiB 会顶到硬顶直接 OOM trap。
//! - **加解密**：XChaCha20-Poly1305（AEAD）。密文落库形态 = `hex(nonce[24] ‖ 密文+tag)`，
//!   AAD 绑定上下文（防密文串用）。
//! - **随机数**：salt / nonce 一律由前端 `crypto.getRandomValues` 生成后传入，
//!   wasm guest **不为随机源新增宿主能力**（spec §5.8）。改密时内容密文**复用原 nonce**
//!   换新密钥重加密（同 nonce 不同密钥不构成重放，省去批量随机）。
//! - **会话密钥**：只存 Rust 进程内存（全局 `Mutex<Option<[u8;32]>>`），不落盘、
//!   不进日志；锁定 / 进程重启即清空，重启后必须重新解锁。
//!
//! 本模块为纯密码学 + 生命周期，不碰 SQLite（元数据读写归 [`crate::store`]），
//! 可被 native 单测完整覆盖。

use std::sync::Mutex;

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};

/// 会话密钥长度（XChaCha20-Poly1305 的 256-bit 密钥）
const KEY_LEN: usize = 32;
/// nonce 长度（XChaCha20 的 192-bit nonce）
pub const NONCE_LEN: usize = 24;
/// salt 长度
const SALT_LEN: usize = 16;
/// Argon2 内存档上限（KiB）。
///
/// 宿主对单插件线性内存的硬顶是 64 MiB；Argon2 在 m 指定的工作区外还要分配少量
/// 缓冲，参数必须留出余量。超过上限时在派生入口返回错误，避免 Rust OOM abort
/// 把可读失败变成 wasm trap。
const MAX_KDF_M_KIB: u32 = 48 * 1024;
/// 保险库校验值明文（常量；解锁时解密比对，证明口令正确）
const VERIFIER_PLAINTEXT: &[u8] = b"assistant-vault-verifier-v1";
/// 校验值 AAD（绑定用途，防把校验值密文挪作他用）
const VERIFIER_AAD: &[u8] = b"assistant:vault:verifier";

/// Argon2id 派生参数（随保险库元数据存储；init 时前端给定）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KdfParams {
    /// 内存档（KiB）。默认 32 * 1024 = 32 MiB：在宿主 64 MiB 线性内存硬顶下
    /// 为 Argon2 工作区之外的缓冲留出余量；超过 `MAX_KDF_M_KIB` 会被显性拒绝。
    pub m: u32,
    /// 时间档
    pub t: u32,
    /// 并行度
    pub p: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        // 宿主单插件线性内存硬顶 64 MiB；m 再大就会在 Argon2 分配时 OOM trap
        Self {
            m: 32 * 1024,
            t: 3,
            p: 1,
        }
    }
}

/// 保险库元数据（`assistant_vault_meta` 单行）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VaultMeta {
    /// KDF 名称（当前仅 "argon2id"）
    pub kdf: String,
    /// salt（hex）
    pub salt_hex: String,
    /// 派生参数（JSON 串，落库形态）
    pub params_json: String,
    /// 校验值密文（hex）
    pub verifier_enc_hex: String,
    /// 创建时间
    pub created_at: String,
}

impl VaultMeta {
    /// 解析 params_json 为 KdfParams
    pub fn params(&self) -> Result<KdfParams, String> {
        serde_json::from_str(&self.params_json).map_err(|e| format!("保险库参数解析失败: {e}"))
    }
}

/// 会话密钥（进程内存，锁定即清）
static SESSION: Mutex<Option<[u8; KEY_LEN]>> = Mutex::new(None);

/// 取当前会话密钥；未解锁返回显性错误（fail-visible，不静默返回空）
pub fn session_key() -> Result<[u8; KEY_LEN], String> {
    SESSION
        .lock()
        .map_err(|_| "保险库会话锁中毒".to_string())?
        .ok_or_else(|| "保险库未解锁：请先输入口令解锁".to_string())
}

/// 是否已解锁（只读探测，不取密钥）
pub fn is_unlocked() -> bool {
    SESSION.lock().map(|k| k.is_some()).unwrap_or(false)
}

/// 写入会话密钥（init / unlock / change-password 后调用）
pub fn set_session_key(key: [u8; KEY_LEN]) {
    if let Ok(mut guard) = SESSION.lock() {
        *guard = Some(key);
    }
}

/// 清空会话密钥（lock / 进程卸载）
pub fn clear_session_key() {
    if let Ok(mut guard) = SESSION.lock() {
        *guard = None;
    }
}

// ==================== 密码学原语 ====================

/// Argon2id 派生会话密钥
pub fn derive_key(
    password: &str,
    salt_hex: &str,
    params: &KdfParams,
) -> Result<[u8; KEY_LEN], String> {
    if params.m > MAX_KDF_M_KIB {
        return Err(format!(
            "Argon2 内存参数过大（{} KiB，上限 {} KiB）：继续派生会耗尽插件内存",
            params.m, MAX_KDF_M_KIB
        ));
    }
    let salt = hex::decode(salt_hex).map_err(|e| format!("salt 非合法 hex: {e}"))?;
    if salt.len() != SALT_LEN {
        return Err(format!(
            "salt 长度须为 {SALT_LEN} 字节，实际 {}",
            salt.len()
        ));
    }
    let argon = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(params.m, params.t, params.p, Some(KEY_LEN))
            .map_err(|e| format!("Argon2 参数非法: {e}"))?,
    );
    let mut key = [0u8; KEY_LEN];
    argon
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| format!("Argon2 派生失败: {e}"))?;
    Ok(key)
}

/// AEAD 加密：返回 `hex(nonce ‖ 密文+tag)`
pub fn encrypt(
    key: &[u8; KEY_LEN],
    nonce_hex: &str,
    plaintext: &[u8],
    aad: &[u8],
) -> Result<String, String> {
    let nonce_bytes = hex::decode(nonce_hex).map_err(|e| format!("nonce 非合法 hex: {e}"))?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err(format!(
            "nonce 长度须为 {NONCE_LEN} 字节，实际 {}",
            nonce_bytes.len()
        ));
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|e| format!("密钥非法: {e}"))?;
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|e| format!("AEAD 加密失败: {e}"))?;
    let mut blob = Vec::with_capacity(NONCE_LEN + ct.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ct);
    Ok(hex::encode(blob))
}

/// AEAD 解密：输入 `hex(nonce ‖ 密文+tag)`，AAD 须与加密时一致
pub fn decrypt(key: &[u8; KEY_LEN], blob_hex: &str, aad: &[u8]) -> Result<Vec<u8>, String> {
    let blob = hex::decode(blob_hex).map_err(|e| format!("密文非合法 hex: {e}"))?;
    // nonce(24) + tag(16) 至少
    if blob.len() < NONCE_LEN + 16 {
        return Err("密文长度不足（缺 nonce 或 tag）".to_string());
    }
    let nonce = &blob[..NONCE_LEN];
    let ct = &blob[NONCE_LEN..];
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|e| format!("密钥非法: {e}"))?;
    cipher
        .decrypt(XNonce::from_slice(nonce), Payload { msg: ct, aad })
        .map_err(|e| format!("AEAD 解密失败（口令错误或密文损坏）: {e}"))
}

/// 内容密文 AAD：绑定表与行标识，防跨行串用
pub fn content_aad(scope: &str, id: &str) -> Vec<u8> {
    format!("assistant:{scope}:{id}").into_bytes()
}

// ==================== 保险库生命周期 ====================

/// 保险库本体：持有元数据，提供 init / unlock / change-password
pub struct Vault {
    meta: VaultMeta,
}

impl Vault {
    /// 首次使用：设口令建库
    ///
    /// `salt_hex` / `verifier_nonce_hex` 由前端 `crypto.getRandomValues` 生成。
    /// 建库即解锁（会话密钥写入内存）。
    pub fn init(
        password: &str,
        salt_hex: &str,
        verifier_nonce_hex: &str,
        params: KdfParams,
        created_at: &str,
    ) -> Result<VaultMeta, String> {
        if password.is_empty() {
            return Err("口令不能为空".to_string());
        }
        let key = derive_key(password, salt_hex, &params)?;
        let verifier_enc = encrypt(&key, verifier_nonce_hex, VERIFIER_PLAINTEXT, VERIFIER_AAD)?;
        let meta = VaultMeta {
            kdf: "argon2id".to_string(),
            salt_hex: salt_hex.to_string(),
            params_json: serde_json::to_string(&params)
                .map_err(|e| format!("参数序列化失败: {e}"))?,
            verifier_enc_hex: verifier_enc,
            created_at: created_at.to_string(),
        };
        set_session_key(key);
        Ok(meta)
    }

    /// 从已存元数据构造
    pub fn from_meta(meta: VaultMeta) -> Self {
        Self { meta }
    }

    /// 元数据（只读）
    #[allow(dead_code)] // 保险库 API 面，命令层按需取用
    pub fn meta(&self) -> &VaultMeta {
        &self.meta
    }

    /// 解锁：口令派生密钥 → 校验值比对 → 会话密钥入内存
    pub fn unlock(&self, password: &str) -> Result<(), String> {
        let params = self.meta.params()?;
        let key = derive_key(password, &self.meta.salt_hex, &params)?;
        let verifier = decrypt(&key, &self.meta.verifier_enc_hex, VERIFIER_AAD)?;
        if verifier != VERIFIER_PLAINTEXT {
            return Err("口令错误".to_string());
        }
        set_session_key(key);
        Ok(())
    }

    /// 锁定：清空会话密钥（元数据不动）
    #[allow(dead_code)] // 命令层 cmd_vault_lock 直接清会话；本方法供 API 面 / 测试
    pub fn lock(&self) {
        clear_session_key();
    }

    /// 改口令：验旧 → 派生新密钥 → 返回新元数据（内容密文重加密归 store，
    /// 复用原 nonce 换新密钥，单事务）
    pub fn change_password(
        &self,
        old_password: &str,
        new_password: &str,
        new_salt_hex: &str,
        new_verifier_nonce_hex: &str,
    ) -> Result<(VaultMeta, [u8; KEY_LEN], [u8; KEY_LEN]), String> {
        if new_password.is_empty() {
            return Err("新口令不能为空".to_string());
        }
        // 1. 验旧口令（用旧 salt / 旧参数派生旧密钥，解密校验值）
        let old_params = self.meta.params()?;
        let old_key = derive_key(old_password, &self.meta.salt_hex, &old_params)?;
        let verifier = decrypt(&old_key, &self.meta.verifier_enc_hex, VERIFIER_AAD)?;
        if verifier != VERIFIER_PLAINTEXT {
            return Err("原口令错误".to_string());
        }
        // 2. 派生新密钥（新 salt，参数沿用）
        let new_key = derive_key(new_password, new_salt_hex, &old_params)?;
        // 3. 新校验值密文
        let new_verifier_enc = encrypt(
            &new_key,
            new_verifier_nonce_hex,
            VERIFIER_PLAINTEXT,
            VERIFIER_AAD,
        )?;
        // 4. 新元数据
        let new_meta = VaultMeta {
            kdf: self.meta.kdf.clone(),
            salt_hex: new_salt_hex.to_string(),
            params_json: self.meta.params_json.clone(),
            verifier_enc_hex: new_verifier_enc,
            created_at: self.meta.created_at.clone(),
        };
        Ok((new_meta, old_key, new_key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    /// 会话密钥是进程全局状态，涉及它的测试必须串行（并行会互相清 / 写）
    static TEST_SERIAL: Mutex<()> = Mutex::new(());
    fn serial() -> MutexGuard<'static, ()> {
        TEST_SERIAL.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 固定 salt / nonce（单测用，非生产随机源）
    const TEST_SALT: &str = "000102030405060708090a0b0c0d0e0f";
    const TEST_NONCE: &str = "000102030405060708090a0b0c0d0e0f1011121314151617";

    fn fast_params() -> KdfParams {
        // 单测用极小档，跑得快
        KdfParams {
            m: 8 * 1024,
            t: 1,
            p: 1,
        }
    }

    #[test]
    fn init_unlock_lock_roundtrip() {
        let _g = serial();
        let meta = Vault::init("pw1", TEST_SALT, TEST_NONCE, fast_params(), "2026-01-01")
            .expect("init 成功");
        assert_eq!(meta.kdf, "argon2id");
        assert!(is_unlocked(), "init 后应已解锁");

        // 错误口令解锁失败，且不改动会话
        Vault::from_meta(meta.clone()).lock();
        assert!(!is_unlocked());
        assert!(Vault::from_meta(meta.clone()).unlock("wrong").is_err());
        assert!(!is_unlocked(), "错误口令不得解锁");

        // 正确口令解锁
        Vault::from_meta(meta.clone())
            .unlock("pw1")
            .expect("正确口令解锁");
        assert!(is_unlocked());

        // 锁定后会话清空
        Vault::from_meta(meta.clone()).lock();
        assert!(!is_unlocked());
        assert!(session_key().is_err(), "锁定后取密钥须显性报错");
    }

    #[test]
    fn encrypt_decrypt_roundtrip_with_aad() {
        let key = derive_key("pw", TEST_SALT, &fast_params()).unwrap();
        let blob = encrypt(&key, TEST_NONCE, b"hello nest", b"assistant:message:c1:1").unwrap();
        let pt = decrypt(&key, &blob, b"assistant:message:c1:1").unwrap();
        assert_eq!(pt, b"hello nest");

        // AAD 不一致 → 解密失败（防串用）
        assert!(decrypt(&key, &blob, b"assistant:message:c1:2").is_err());
        // 错误密钥 → 解密失败
        let other = derive_key("pw2", TEST_SALT, &fast_params()).unwrap();
        assert!(decrypt(&other, &blob, b"assistant:message:c1:1").is_err());
    }

    #[test]
    fn change_password_old_key_decrypts_old_new_key_decrypts_new() {
        let _g = serial();
        let meta = Vault::init("old", TEST_SALT, TEST_NONCE, fast_params(), "2026-01-01").unwrap();
        let vault = Vault::from_meta(meta);
        // 内容密文（旧密钥加密）
        let old_key = derive_key("old", TEST_SALT, &fast_params()).unwrap();
        let blob = encrypt(&old_key, TEST_NONCE, b"secret", b"assistant:memory:m1").unwrap();

        let (new_meta, old_k, new_k) = vault
            .change_password("old", "new", TEST_SALT, TEST_NONCE)
            .unwrap();
        assert_ne!(old_k, new_k, "新旧密钥必须不同");
        // 旧密钥仍能解旧密文（重加密前）
        assert_eq!(
            decrypt(&old_k, &blob, b"assistant:memory:m1").unwrap(),
            b"secret"
        );
        // 新密钥解新校验值
        let v = Vault::from_meta(new_meta.clone());
        v.unlock("new").expect("新口令解锁");
        // 新密钥解内容密文（store 重加密后形态：复用 nonce 换新密钥）
        let reenc = encrypt(&new_k, TEST_NONCE, b"secret", b"assistant:memory:m1").unwrap();
        assert_eq!(
            decrypt(&new_k, &reenc, b"assistant:memory:m1").unwrap(),
            b"secret"
        );
        // 旧口令不再可用
        assert!(Vault::from_meta(new_meta).unlock("old").is_err());
    }

    #[test]
    fn salt_and_nonce_length_enforced() {
        let params = fast_params();
        assert!(derive_key("pw", "tooshort", &params).is_err());
        assert!(encrypt(&[0u8; KEY_LEN], "short", b"x", b"aad").is_err());
    }

    #[test]
    fn default_kdf_params_fit_plugin_memory_budget() {
        let params = KdfParams::default();
        assert_eq!(params.m, 32 * 1024);
        assert!(params.m <= MAX_KDF_M_KIB);
    }

    #[test]
    fn derive_key_rejects_oversized_memory_params() {
        let params = KdfParams {
            m: MAX_KDF_M_KIB + 1,
            t: 1,
            p: 1,
        };
        let err = derive_key("pw", TEST_SALT, &params).unwrap_err();
        assert!(err.contains("内存参数过大"), "unexpected error: {err}");
    }
}
