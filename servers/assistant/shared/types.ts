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

// ==================== 票 08：对话主链路 ====================

/** 对话流式命令（前端构建 provider 请求 → Rust 校验透传 → 宿主流式推送） */
export const ASSISTANT_CHAT_STREAM_COMMAND = 'assistant.chat-stream'

/** 流事件通道前缀（与 Rust chat.rs STREAM_EVENT_PREFIX 同值，双端一致） */
export const ASSISTANT_STREAM_EVENT_PREFIX = 'assistant:stream:'

/** 由 streamId 派生流事件通道名 */
export function assistantStreamEvent(streamId: string): string {
  return `${ASSISTANT_STREAM_EVENT_PREFIX}${streamId}`
}

/** 生成 streamId（crypto.getRandomValues 为唯一随机源，与 vault 同口径） */
export function newStreamId(): string {
  const arr = new Uint8Array(12)
  crypto.getRandomValues(arr)
  let out = ''
  for (const b of arr) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * 流式 HTTP 请求载荷（`host.http_fetch` raw 模式，spec §3.2 / §5.2）
 *
 * 方言知识（OpenAI 兼容等）在 `shared/providers/`，本形状是宿主契约，
 * Rust 侧只校验 method / url / stream / streamEvent。
 */
export interface ChatStreamRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  stream: true
  /** 必须等于 `assistant:stream:<streamId>`（Rust 精确匹配校验） */
  streamEvent: string
}

/** `assistant.chat-stream` 命令入参 */
export interface ChatStreamInput {
  streamId: string
  request: ChatStreamRequest
}

/** 宿主流式受理结果（宿主铸造 streamId 并回显事件通道名） */
export interface ChatStreamAccepted {
  streamId: string
  streamEvent: string
}

/**
 * 宿主流事件载荷（宿主 http 流式契约，egress.rs execute_streaming_http）
 *
 * - `{ chunk, done: false }`：raw 字节块（UTF-8 文本，消费侧自行切分 SSE）
 * - `{ done: true }`：流正常终止
 * - `{ error, done: true }`：流失败（非 2xx / 连接中断等）
 */
export type ChatStreamEventPayload =
  | { chunk: string; done: false }
  | { done: true; error?: undefined }
  | { error: string; done: true }

// ==================== 供应商（provider 记录 + 密钥槽） ====================

/** provider 请求方言（M1：OpenAI 兼容，含自定义 baseURL / 本地端点；D17） */
export type ProviderApiStyle = 'openai-compatible'

/** provider 记录（`assistant_providers` 表；**不存密钥**，密钥在保险库密钥槽） */
export interface ProviderRecord {
  id: string
  name: string
  apiStyle: ProviderApiStyle
  baseUrl: string
  model: string
  isDefault: boolean
}

/** 供应商命令 */
export const ASSISTANT_PROVIDERS_LIST_COMMAND = 'assistant.providers-list'
export const ASSISTANT_PROVIDERS_UPSERT_COMMAND = 'assistant.providers-upsert'
export const ASSISTANT_PROVIDERS_SET_DEFAULT_COMMAND = 'assistant.providers-set-default'
export const ASSISTANT_PROVIDERS_DELETE_COMMAND = 'assistant.providers-delete'

/** 密钥槽命令（spec §5.8：vault.getSecret('provider:<id>') 仅在构建请求时取用） */
export const ASSISTANT_VAULT_SET_SECRET_COMMAND = 'assistant.vault-set-secret'
export const ASSISTANT_VAULT_GET_SECRET_COMMAND = 'assistant.vault-get-secret'
export const ASSISTANT_VAULT_DELETE_SECRET_COMMAND = 'assistant.vault-delete-secret'

/** 供应商密钥槽键名（spec §5.8 口径） */
export function providerSecretKey(providerId: string): string {
  return `provider:${providerId}`
}

/** 密钥槽写操作入参（nonce 由前端 crypto.getRandomValues 生成） */
export interface VaultSetSecretInput {
  key: string
  value: string
  nonce: string
  ts?: string
}

/** 密钥槽读操作返回 */
export interface VaultSecretValue {
  key: string
  value: string
}

// ==================== 会话 / 消息（UI 侧形状） ====================

/** 会话记录（`assistant_conversations` 表） */
export interface ConversationRecord {
  id: string
  title: string
  kind: 'companion' | 'task'
  createdAt: string
  updatedAt: string
  archived: boolean
}

/** 消息记录（`assistant_messages` 表；content 已解密） */
export interface MessageRecord {
  id: string
  conversationId: string
  seq: number
  role: 'user' | 'assistant'
  content: string
  meta: Record<string, unknown>
  createdAt: string
}

/** UI 消息卡状态（流式 / 错误可重试 / 完成） */
export type ChatMessageStatus = 'done' | 'streaming' | 'error' | 'aborted'

/** UI 消息（历史加载与实时流式共用形状） */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: ChatMessageStatus
  /** 思考内容（折叠展示；流式增量累加） */
  thinking?: string
  /** 错误 / 中止原因（用户可见文案，技术细节只进日志） */
  errorMessage?: string
  /** 本轮模型与用量（结束后填充） */
  model?: string
  createdAt: string
}

/** 会话命令 */
export const ASSISTANT_CONVERSATIONS_LIST_COMMAND = 'assistant.conversations-list'
export const ASSISTANT_CONVERSATIONS_CREATE_COMMAND = 'assistant.conversations-create'
export const ASSISTANT_CONVERSATIONS_RENAME_COMMAND = 'assistant.conversations-rename'
/** 归档 / 恢复会话（票 09；默认陪伴会话受 Rust 侧守卫保护，不可归档） */
export const ASSISTANT_CONVERSATIONS_ARCHIVE_COMMAND = 'assistant.conversations-archive'
export const ASSISTANT_MESSAGES_LIST_COMMAND = 'assistant.messages-list'
export const ASSISTANT_MESSAGES_APPEND_COMMAND = 'assistant.messages-append'
/** 消息计数命令（票 09：摘要阈值判定依据，只读轻量查询） */
export const ASSISTANT_MESSAGES_COUNT_COMMAND = 'assistant.messages-count'
/** 设置读取命令（值可为 null） */
export const ASSISTANT_SETTINGS_GET_COMMAND = 'assistant.settings-get'

// ==================== 多会话（票 09 / spec §5.3、§5.7） ====================

/**
 * 默认长期陪伴会话 id（固定值，Rust 侧归档守卫同值）。
 *
 * 该会话随激活幂等建立（Rust `activate` + 前端 `ensureDefaultCompanion` 双保险），
 * 不可归档；是「记忆跨会话共享」的默认落点（spec D15）。
 */
export const DEFAULT_COMPANION_ID = 'nest-companion'

/** 冷启动上下文恢复：加载最近 N 条消息（缺省 20，票内记录默认值） */
export const CONTEXT_LIMIT_SETTING = 'conversation.contextLimit'
export const DEFAULT_CONTEXT_LIMIT = 20

/**
 * 冷启动上下文恢复：消息总数超过阈值时依赖会话摘要补上下文
 * （缺省 40，票内记录默认值）。摘要的生成归票 12，本票只留注入钩子。
 */
export const SUMMARY_THRESHOLD_SETTING = 'conversation.summaryThreshold'
export const DEFAULT_SUMMARY_THRESHOLD = 40
