/**
 * 工具审计：命令面 + 摘要（票 13 / spec §5.3、§5.9、§6）
 *
 * 审计每行只存**摘要**：参数原文与返回值原文一律不落库、不进日志。
 * 摘要 = sha256 前 12 位 hex（与 Rust `audit::digest` 同口径），仅可关联不可还原。
 *
 * 写入经 `assistant.audit-record`（Rust 落 `assistant_audit` 表，并向宿主
 * `HostLog` 打一行同名 audit 事件用于排障）；查看 / 导出 / 清空在设置页。
 */
import type { AssistantInvoke } from '../types'
import type { AuditRecordInput } from './types'

/** 设置写入命令（票 13 测试工具开关用；与 Rust `settings-set` 同字面） */
export const ASSISTANT_SETTINGS_SET_COMMAND = 'assistant.settings-set'

/** 审计命令（与 Rust `lib.rs` / `plugin.json` 同字面） */
export const ASSISTANT_AUDIT_LIST_COMMAND = 'assistant.audit-list'
export const ASSISTANT_AUDIT_RECORD_COMMAND = 'assistant.audit-record'
export const ASSISTANT_AUDIT_CLEAR_COMMAND = 'assistant.audit-clear'

/**
 * 测试工具开关（默认关）：开启后模型会看到 `test.echo`（write）与
 * `test.danger`（danger），用于人工验证四档确认与急停（票 13 验收口径）。
 */
export const TOOL_TEST_TOOLS_SETTING = 'tools.testToolsEnabled'

/** 审计行（`assistant_audit` 表原样；字段为 snake_case，与 Rust serde 同形） */
export interface AuditRow {
  id: string
  ts: string
  tool_id: string
  app_id: string | null
  command: string
  risk: string
  decision: string
  args_digest: string | null
  result_digest: string | null
  user_visible: boolean
}

/**
 * 摘要输入规范化：字符串原样，其余 JSON 序列化（`undefined` → `'null'`）。
 *
 * 序列化失败（循环引用等）明确抛错，由调用方降级为 `null` 摘要并告警，
 * 不静默写一个假摘要。
 */
function canonical(value: unknown): string {
  if (typeof value === 'string') return value
  const json = JSON.stringify(value ?? null)
  if (json === undefined) throw new Error('无法序列化审计摘要输入')
  return json
}

/**
 * sha256 前 12 位 hex（WebCrypto；Tauri / Android WebView / Node 测试环境均可用）。
 *
 * 不可用时不伪造摘要：抛错由调用方记 `null` 并点名，审计仍落行。
 */
export async function auditDigest(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('WebCrypto 不可用，无法计算审计摘要')
  const bytes = new TextEncoder().encode(canonical(value))
  const hash = await subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 写一行审计；返回 Rust 生成的 id（失败抛错，由运行时点名后继续对话） */
export async function recordAudit(
  invoke: AssistantInvoke,
  input: AuditRecordInput,
): Promise<string> {
  const res = await invoke<{ id?: string }>(ASSISTANT_AUDIT_RECORD_COMMAND, { ...input })
  const id = res?.id
  if (!id) throw new Error('审计写入失败：命令未返回 id')
  return id
}

/** 读审计（按 ts 倒序；limit 缺省 200） */
export async function listAudit(invoke: AssistantInvoke, limit = 200): Promise<AuditRow[]> {
  const res = await invoke<{ entries: AuditRow[] }>(ASSISTANT_AUDIT_LIST_COMMAND, { limit })
  return res?.entries ?? []
}

/** 清空审计（UI 二次确认后调用）；返回删除行数 */
export async function clearAudit(invoke: AssistantInvoke): Promise<number> {
  const res = await invoke<{ deleted: number }>(ASSISTANT_AUDIT_CLEAR_COMMAND)
  return res?.deleted ?? 0
}
