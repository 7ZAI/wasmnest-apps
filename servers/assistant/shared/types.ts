/**
 * Nest 助手共享 TS 核 —— 类型（骨架阶段，票 05）
 *
 * spec §5.1（D3 双端同构）：助手应用的共享 TS 核住应用级 `shared/` 目录，
 * 双端只写入口与宿主适配。本文件是骨架阶段的共享类型定义；后续票
 * （07 数据底座 / 08 对话主链路 / 12 记忆 / 13 工具运行时）在此处续接，
 * 形状以 spec 为裁决面。
 *
 * 不单独发布：双端经相对路径 import，构建期各自内联进本端 bundle
 * （桌面自足挂载包；移动经 SDK vite 插件外置宿主全局）。
 */

/** 插件身份（与双端 plugin.json 的 id 一致） */
export const ASSISTANT_PLUGIN_ID = 'com.wasmnest.assistant'

/** 骨架阶段命令 id（唯一命令入口；真实命令面随对应票加入） */
export const ASSISTANT_PING_COMMAND = 'assistant.ping'

/**
 * `assistant.ping` 命令返回
 *
 * 用途：证明「前端 appInvoke → 共享 crate invoke_command → 宿主返回」链路
 * 在双端都通。骨架阶段只此一条命令；返回形状在此钉住，后续命令的形状
 * 同样在本文件定义（共享核单一类型源）。
 */
export interface AssistantPingResult {
  /** 命令执行成功 */
  ok: boolean
  /** 执行该命令的插件身份回显（双端同源，可与其它应用区分） */
  appId: string
}

/**
 * 占位页命令验证状态
 *
 * 占位页在挂载后自动跑一次 ping，把链路状态显性呈现（fail-visible：
 * 失败点名原因，不静默假装可用，spec §2.4）。
 */
export type PlaceholderPingState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; result: AssistantPingResult }
  | { status: 'error'; message: string }

// ==================== 票 07：保险库与命令面 ====================

/** 保险库状态查询命令 */
export const VAULT_STATUS_COMMAND = 'assistant.vault-status'
/** 保险库首次设置命令 */
export const VAULT_INIT_COMMAND = 'assistant.vault-init'
/** 保险库解锁命令 */
export const VAULT_UNLOCK_COMMAND = 'assistant.vault-unlock'
/** 保险库锁定命令 */
export const VAULT_LOCK_COMMAND = 'assistant.vault-lock'
/** 保险库改口令命令 */
export const VAULT_CHANGE_PASSWORD_COMMAND = 'assistant.vault-change-password'

/** 保险库状态（`assistant.vault-status` 返回） */
export interface VaultStatus {
  /** 保险库是否已建立（是否完成首次设置） */
  exists: boolean
  /** 当前是否已解锁（会话密钥在 Rust 进程内存） */
  unlocked: boolean
  /** 建立时间（未建立时缺省） */
  createdAt?: string
}

/** 保险库操作结果（init / unlock / lock / change-password 通用返回） */
export interface VaultOpResult {
  ok: boolean
  unlocked: boolean
}

/** 保险库首次设置入参（salt / verifierNonce 由前端 crypto.getRandomValues 生成） */
export interface VaultInitInput {
  password: string
  /** Argon2id 内存档（KiB）；缺省桌面 64 MiB，移动可降档 */
  m?: number
  /** 时间档；缺省 3 */
  t?: number
  /** 并行度；缺省 1 */
  p?: number
}

/** 改口令入参（newSalt / newVerifierNonce 由前端生成） */
export interface VaultChangePasswordInput {
  oldPassword: string
  newPassword: string
}

/** 命令调用抽象（桌面 appInvoke / 移动 commands.execute 同形） */
export type AssistantInvoke = <T = unknown>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>
