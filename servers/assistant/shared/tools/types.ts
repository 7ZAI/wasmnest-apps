/**
 * 工具运行时：类型与风险档（票 13 / spec §5.6、§5.9）
 *
 * 工具目录每项由「声明方」给出风险档，助手只**升**不**降**：
 * - `read`：自动执行，结果卡可见；
 * - `ui`：自动执行，卡片显示「正在打开 / 切换」；
 * - `write`：暂停，内联批准 / 拒绝；
 * - `danger`：两次确认，第二次摊开影响范围。
 *
 * 这里只放纯类型与风险序，执行编排见 `runtime.ts`，审计命令面见 `audit.ts`。
 */

/** 四档风险（spec §5.9；顺序即严重度，比较只能升档） */
export type ToolRisk = 'read' | 'ui' | 'write' | 'danger'

/** 风险序：`effectiveRisk` 用它取较高档，禁止降档 */
export const RISK_ORDER: Record<ToolRisk, number> = {
  read: 0,
  ui: 1,
  write: 2,
  danger: 3,
}

/** 审计里的决策（拒绝 / 急停也各留一行，spec §5.9） */
export type ToolDecision = 'auto' | 'approved' | 'rejected' | 'stopped' | 'error'

/** 工具卡状态（UI 可见；`blocked` = 未执行，原因在 `errorMessage`） */
export type ToolCardStatus = 'pending' | 'running' | 'ok' | 'error' | 'blocked'

/**
 * 一条工具声明。
 *
 * `parameters` **原样**交给 pi 的 `AgentTool`（不二次翻译、不裁剪）：目标应用
 * 声明的 JSON Schema 就是模型看到的 schema（spec §5.2）。
 */
export interface ToolSpec {
  /** 模型可见的工具名（如 `time.now` / `app.invoke.monitor.snapshot`） */
  id: string
  /** UI 标签（工具卡显示；人话短名） */
  label: string
  /** 给模型看的能力说明（何时用、返回什么） */
  description: string
  /** 声明方给的风险档；实际执行档由 `effectiveRisk` 决定（只升不降） */
  risk: ToolRisk
  /** 目标应用 id；本应用本地工具为 null */
  appId: string | null
  /** 审计里的命令名（本地工具为 `local:<tool>`；应用工具为目标命令） */
  command: string
  /** JSON Schema（原样透传给模型 / 参数校验） */
  parameters: Record<string, unknown>
  /** 执行体：实际动作；抛错会被运行时转成 isError toolResult，不中断循环 */
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
  /** danger 档第二次确认时的影响范围文案（缺省用通用文案） */
  impact?: (args: Record<string, unknown>) => string
}

/** 工具卡（UI 读；运行时按 toolCallId 原地更新，不换数组身份） */
export interface ToolCallCard {
  toolCallId: string
  toolId: string
  label: string
  appId: string | null
  risk: ToolRisk
  status: ToolCardStatus
  /** `ui` 档的可见提示（「正在打开 / 切换」） */
  notice: 'opening' | null
  /** 失败 / 拒绝 / 急停原因（用户可见，技术细节只进日志） */
  errorMessage?: string
}

/** 一次确认请求（UI 渲染确认卡；danger 档会来两次） */
export interface ToolConfirmRequest {
  toolCallId: string
  toolId: string
  label: string
  appId: string | null
  /** 实际执行档（可能高于声明档） */
  risk: ToolRisk
  /** 声明方给的原始档（UI 可标「已提档」） */
  declaredRisk: ToolRisk
  /** 参数摘要（sha256 前 12 位；不展示参数原文） */
  argsDigest: string | null
  /** danger 第二次确认展示的影响范围 */
  impact: string
  /** 1 = 首次确认；2 = danger 的第二次确认 */
  stage: 1 | 2
}

/** 风险策略：应用声明之外，助手可再提档（spec §5.9「只升不降」） */
export interface ToolPolicy {
  /** 按工具 id 给最低档（如 `monitor.snapshot: 'write'`） */
  riskFloor?: Record<string, ToolRisk>
  /** `ui` 档是否也要求确认（设置项；开启 = 提到 write） */
  uiRequireConfirm?: boolean
}

/** 审计写入入参（只含摘要，不含参数 / 结果原文，spec §6 日志红线） */
export interface AuditRecordInput {
  toolId: string
  appId: string | null
  command: string
  risk: ToolRisk
  decision: ToolDecision
  argsDigest: string | null
  resultDigest: string | null
  userVisible: boolean
  /** epoch 毫秒字符串（与消息落库同口径，wasm 侧不引入时间源） */
  ts: string
}
