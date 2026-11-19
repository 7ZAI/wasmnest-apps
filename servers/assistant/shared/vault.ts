/**
 * Nest 助手共享核 —— 保险库操作（票 07 / spec §5.8）
 *
 * 双端同构：桌面经 `env.appInvoke`、移动经 `context.commands.execute`，两者
 * 都收敛到 [`AssistantInvoke`] 同形抽象。salt / nonce 由前端
 * `crypto.getRandomValues` 生成后传入 Rust（wasm guest 不为随机源新增宿主能力）。
 *
 * 失败语义（spec §2.4）：Rust 侧点名缺什么（未解锁 / 口令错误 / 保险库不存在），
 * 前端原样上交，不静默吞错。
 */
import {
  VAULT_CHANGE_PASSWORD_COMMAND,
  VAULT_INIT_COMMAND,
  VAULT_LOCK_COMMAND,
  VAULT_STATUS_COMMAND,
  VAULT_UNLOCK_COMMAND,
  type AssistantInvoke,
  type VaultChangePasswordInput,
  type VaultInitInput,
  type VaultOpResult,
  type VaultStatus,
} from './types'

/** 生成指定字节数的随机 hex（salt / nonce 用；crypto.getRandomValues 为唯一随机源） */
export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  let out = ''
  for (const b of arr) out += b.toString(16).padStart(2, '0')
  return out
}

/** salt 长度（字节，与 Rust vault 一致） */
export const SALT_BYTES = 16
/** nonce 长度（字节，与 Rust vault 一致） */
export const NONCE_BYTES = 24

/** 查保险库状态 */
export async function vaultStatus(invoke: AssistantInvoke): Promise<VaultStatus> {
  return invoke<VaultStatus>(VAULT_STATUS_COMMAND)
}

/** 首次设置：设口令建库（生成 salt / verifierNonce 传入 Rust） */
export async function vaultInit(
  invoke: AssistantInvoke,
  input: VaultInitInput,
): Promise<VaultOpResult> {
  return invoke<VaultOpResult>(VAULT_INIT_COMMAND, {
    password: input.password,
    salt: randomHex(SALT_BYTES),
    verifierNonce: randomHex(NONCE_BYTES),
    m: input.m,
    t: input.t,
    p: input.p,
    ts: Date.now().toString(),
  })
}

/** 解锁 */
export async function vaultUnlock(
  invoke: AssistantInvoke,
  password: string,
): Promise<VaultOpResult> {
  return invoke<VaultOpResult>(VAULT_UNLOCK_COMMAND, { password })
}

/** 锁定（清空 Rust 进程内存会话密钥） */
export async function vaultLock(invoke: AssistantInvoke): Promise<VaultOpResult> {
  return invoke<VaultOpResult>(VAULT_LOCK_COMMAND)
}

/** 改口令（生成新 salt / verifierNonce；Rust 单事务重加密全部内容密文） */
export async function vaultChangePassword(
  invoke: AssistantInvoke,
  input: VaultChangePasswordInput,
): Promise<VaultOpResult> {
  return invoke<VaultOpResult>(VAULT_CHANGE_PASSWORD_COMMAND, {
    oldPassword: input.oldPassword,
    newPassword: input.newPassword,
    newSalt: randomHex(SALT_BYTES),
    newVerifierNonce: randomHex(NONCE_BYTES),
  })
}
