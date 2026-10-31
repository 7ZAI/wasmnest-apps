/**
 * WasmNest Pi Bridge Extension
 *
 * pi 扩展（部署名 `wasmnest_bridge.ts`）：一条通道做两件事——
 * 1. **事件上行**：把 pi 的原生事件（消息 / 思考 / 工具 / 状态）推给 BedCode 的
 *    唯一归一入口，对话面据此渲染；任务状态仍按原状态机推 `task-status`；
 * 2. **命令下行**：轮询 `run-commands` 并执行（发送消息），回执 `run-commands-ack`。
 *
 * 由 pi 自动发现加载（无需注册配置）；项目未被信任时 pi 不加载项目级扩展，
 * 后端届时显示「镜像模式 / 需在终端授予项目信任」。
 *
 * 事件映射（对应 Claude Code hooks 的状态机）：
 *   session_start        → idle（pi 启动 / /new 重建会话后推送，
 *                          宿主据此放行 waiting 态队列任务，等价 SessionStart）
 *   before_agent_start   → in_progress（用户提交 prompt，等价 UserPromptSubmit）
 *   tool_execution_end   → in_progress（工具执行结束，等价 PostToolUse）
 *   after_provider_response / agent_end(error)
 *                        → retrying（LLM 调用返回可重试 HTTP 错误（429/5xx）或
 *                          run 以 error 结束 → pi 进入自动重试，任务保持活动，
 *                          宿主按过渡态处理，不触发队列调度）
 *   agent_settled        → completed / interrupted（run 完全收敛后触发。
 *                          agent_settled 只在全部自动工作（重试/压缩/排队续跑）
 *                          结束后触发一次，LLM 报错重试耗尽或用户中断时照样到达，
 *                          不能无条件视为完成——须结合 agent_end 记录的最后一条
 *                          assistant 消息的 stopReason/errorMessage 判定成败）
 *   session_shutdown     → interrupted（仅 quit：退出 pi 时任务未完成视为中断；
 *                          new/fork/resume 只是会话切换，pi 仍运行，不推送）
 *
 * 重试语义：pi 对 429/5xx/网络错误等瞬时故障自动指数退避重试（见
 * core/agent-session.js retryAssistantCall）。重试期间推送 retrying 过渡态，
 * 任务绝不被标记中断；终态判定只在 agent_settled（所有自动重试结束后）做出——
 * 重试成功 → completed，重试耗尽 → interrupted。
 * 限额/额度类错误（insufficient_quota / quota exceeded / billing …）pi 内核
 * **不重试**（NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN 先行排除），故本扩展
 * 也不把它们推成 retrying——推了就是等一个永远不会到来的重试事件。
 *
 * 生效条件：仅当 WASMNEST_SESSION_ID 环境变量存在时推送状态。
 * WasmNest 启动的 PTY 终端会自动注入此变量（pty_process.rs），
 * 外部终端不会设置，因此扩展在 WasmNest 管理的终端外保持静默。
 *
 * HTTP 说明：
 * - 固定使用 127.0.0.1（Windows localhost IPv6 回退会卡 ~2 秒，见
 *   auto_task_hook.py 同名注释）
 * - 终态推送（completed/interrupted）为队列调度链的唯一触发信号，
 *   失败自动重试 3 次，避免静默丢终态卡死调度
 * - payload 携带 event_time（UTC，毫秒 3 位固定宽度），宿主据此拒绝
 *   迟到的旧事件推送（与宿主 SQLite 毫秒格式一致，字典序比较正确）
 *
 * 注意：pi 仅在项目被信任后加载项目级扩展（--approve / trust 流程），
 * 首次启动需用户在终端确认信任。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

// 部署时由宿主按当前端口改写（hooks.rs replace_pi_extension_port），勿手改
const WASMNEST_PORT = 8765 // @wasmnest-port
// 模板版本标记：内容升级时递增，宿主据此对旧部署副本自动重部署（hooks.rs）
// @wasmnest-template-version 9

const PLUGIN_ID = 'com.wasmnest.bedcode'
const HOST = '127.0.0.1'
const HTTP_TIMEOUT_MS = 3000
// 终态推送（completed/interrupted）丢失会中断队列调度链，必须重试保证送达
const HTTP_RETRY_ATTEMPTS = 3
const HTTP_RETRY_DELAY_MS = 500

/** 事件发生时刻（UTC，毫秒精度、固定宽度）：与宿主 SQLite strftime 格式一致 */
function eventTime(): string {
  const now = new Date()
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  return `${now.toISOString().slice(0, 19).replace('T', ' ')}.${ms}`
}

/**
 * subagent 子进程检测：subagent 扩展以 `pi --mode json -p --no-session`
 * 派生独立 pi 进程执行委派任务（继承 WASMNEST_SESSION_ID 并同样加载本扩展）。
 * 其会话生命周期与主会话任务无关——session_start/agent_settled/进程退出
 * 会把主任务状态污染（subagent 结束时 completed+interrupted 毫秒级连推，
 * 提前落终态且误标中断），故子进程中本扩展整体静默。
 */
const IS_SUBAGENT_PROCESS = process.argv.includes('--no-session')

/**
 * 推送任务状态到 WasmNest 桌面端 HTTP API
 * 失败不阻塞主流程，仅记录日志；终态推送自动重试。
 */
async function push(status: string, reason: string): Promise<void> {
  // 仅在 WasmNest 启动的 PTY 终端中生效（外部终端无此环境变量）
  const wasmnestSessionId = process.env.WASMNEST_SESSION_ID
  if (!wasmnestSessionId) return

  // subagent 子进程整体静默（见 IS_SUBAGENT_PROCESS 注释）
  if (IS_SUBAGENT_PROCESS) return

  // 宿主以 wasmnest 会话 ID 键控任务行（on_input_submitted / 队列出队写入），
  // session_id 与 wasmnest_session_id 同值即可命中（见 state.rs handle_update_task_status）
  const payload = {
    session_id: wasmnestSessionId,
    status,
    reason: reason || '',
    event_time: eventTime(),
    wasmnest_session_id: wasmnestSessionId,
  }

  for (let attempt = 1; attempt <= HTTP_RETRY_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(
        `http://${HOST}:${WASMNEST_PORT}/api/plugin/${PLUGIN_ID}/task-status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        },
      )
      if (!resp.ok) {
        console.warn(`[wasmnest] push failed (${resp.status}): ${await resp.text()}`)
      }
      return
    } catch (e) {
      if (attempt < HTTP_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, HTTP_RETRY_DELAY_MS))
      } else {
        console.warn(`[wasmnest] push failed after ${HTTP_RETRY_ATTEMPTS} attempts: ${e}`)
      }
    }
  }
}


// ==================== 桥接：事件上行 + 命令下行（ADR 0004） ====================
//
// 事件：agent 原生事件按批（150ms 合批 / 流式快照按身份合并）POST 到插件回环
// `run-events`，由后端唯一归一入口去重、分配 seq、落库；未知类型由后端计数。
// 命令：每 500ms 轮询 `run-commands`（同时是桥接心跳），执行完回执
// `run-commands-ack`。任务状态仍走既有 `task-status` 端点（同一扩展、两条通道）。
//
// 生效条件：仅当 WASMNEST_SESSION_ID 存在（WasmNest 启动的 PTY）；外部终端静默。
// 后端判定桥接离线（镜像模式）时，发送入口会被显性拒绝——这里不吞错误。

const RUN_ID = process.env.WASMNEST_SESSION_ID ?? ''
const BRIDGE_BASE = `http://${HOST}:${WASMNEST_PORT}/api/plugin/${PLUGIN_ID}`
const BRIDGE_FLUSH_MS = 150
const BRIDGE_POLL_MS = 500
const BRIDGE_MAX_QUEUE = 200
const BRIDGE_MAX_EVENT_BYTES = 1_000_000

interface BridgeRawEvent {
  type: string
  [key: string]: unknown
}

interface BridgeCommand {
  id: number
  kind: string
  payload: unknown
}

let bridgeQueue: BridgeRawEvent[] = []
let bridgeStreaming = new Map<string, BridgeRawEvent>()
let bridgeTimer: ReturnType<typeof setTimeout> | null = null
let bridgeDisabled = false
let bridgeFlushDelay = BRIDGE_FLUSH_MS

/** 单条事件超过 1MB 直接丢弃并留痕：宿主 HTTP 体量有限，阻塞整批更糟 */
function bridgeEventTooLarge(raw: BridgeRawEvent): boolean {
  try {
    if (JSON.stringify(raw).length <= BRIDGE_MAX_EVENT_BYTES) return false
  } catch {
    // 循环引用等序列化失败同样视为不可发送
  }
  console.warn('[wasmnest] bridge event too large, dropped (see terminal tab)')
  return true
}

function bridgeEnabled(): boolean {
  // subagent 子进程继承 WASMNEST_SESSION_ID 且同样加载本扩展：它的会话生命周期
  // 与主会话无关，整体静默（否则会把主运行的事件 / 状态污染）
  return RUN_ID !== '' && !bridgeDisabled && !IS_SUBAGENT_PROCESS
}

function scheduleBridgeFlush(delay = BRIDGE_FLUSH_MS): void {
  if (bridgeTimer) return
  bridgeTimer = setTimeout(() => {
    bridgeTimer = null
    void flushBridge()
  }, delay)
}

/** 普通事件入队（后到先发不影响：后端按 rev 挡旧快照） */
function enqueueEvent(raw: BridgeRawEvent): void {
  if (!bridgeEnabled()) return
  if (bridgeEventTooLarge(raw)) return
  bridgeQueue.push({ ...raw, time: raw.time ?? Date.now() })
  if (bridgeQueue.length > BRIDGE_MAX_QUEUE) {
    bridgeQueue.splice(0, bridgeQueue.length - BRIDGE_MAX_QUEUE)
  }
  scheduleBridgeFlush()
}

/** 流式快照：同一身份（part / message + contentIndex）只保留最新一帧 */
function enqueueStream(key: string, raw: BridgeRawEvent): void {
  if (!bridgeEnabled()) return
  if (bridgeEventTooLarge(raw)) return
  bridgeStreaming.set(key, { ...raw, time: Date.now() })
  if (bridgeStreaming.size > BRIDGE_MAX_QUEUE) {
    const oldest = bridgeStreaming.keys().next().value
    if (oldest) bridgeStreaming.delete(oldest)
  }
  scheduleBridgeFlush()
}

async function bridgePost(path: string, payload: unknown): Promise<Response> {
  return fetch(`${BRIDGE_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
}

async function flushBridge(): Promise<void> {
  if (!bridgeEnabled()) return
  if (bridgeQueue.length === 0 && bridgeStreaming.size === 0) return
  const batch = [...bridgeQueue, ...bridgeStreaming.values()]
  bridgeQueue = []
  bridgeStreaming = new Map()
  try {
    const resp = await bridgePost('run-events', { runId: RUN_ID, events: batch })
    if (resp.status === 409) {
      // 该 agent 没有桥接适配：运行期内不会好转，停用避免刷屏
      bridgeDisabled = true
      console.warn('[wasmnest] agent has no bridge adapter, event relay disabled')
      return
    }
    if (resp.status === 400 || resp.status === 413 || resp.status === 422) {
      // 协议错 / 体量超限：重试同一批永远不会成功，丢弃这一批（终端仍是真源）
      console.warn(`[wasmnest] bridge dropped one batch (HTTP ${resp.status})`)
      return
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    bridgeFlushDelay = BRIDGE_FLUSH_MS
  } catch (e) {
    // 回环暂时不可用：保留本批（有界）并退避重试；Run 不存在时上面已停用
    bridgeQueue = batch.concat(bridgeQueue).slice(-BRIDGE_MAX_QUEUE)
    bridgeFlushDelay = Math.min(bridgeFlushDelay * 2, 2000)
    scheduleBridgeFlush(bridgeFlushDelay)
    console.warn(`[wasmnest] event flush failed, retrying in ${bridgeFlushDelay}ms: ${e}`)
  }
}

type CommandExecutor = (command: BridgeCommand) => Promise<void>

/** 命令轮询：既是下行通道，也是桥接心跳（后端据此判「镜像模式」） */
function startCommandLoop(execute: CommandExecutor): ReturnType<typeof setInterval> | null {
  if (!bridgeEnabled()) return null
  const executedCommands = new Set<number>()
  let polling = false
  const tick = async (): Promise<void> => {
    if (!bridgeEnabled() || polling) return
    polling = true
    try {
      const resp = await bridgePost('run-commands', { runId: RUN_ID })
      if (resp.status === 409) {
        bridgeDisabled = true
        return
      }
      // 404 = 运行行还没写入（启动竞态）或已被移除：下一拍再试，不能永久停用
      if (!resp.ok) return
      const body = (await resp.json().catch(() => null)) as
        | { data?: { commands?: BridgeCommand[] }; commands?: BridgeCommand[] }
        | null
      const commands = body?.data?.commands ?? body?.commands ?? []
      if (!Array.isArray(commands) || commands.length === 0) return
      const results: Array<Record<string, unknown>> = []
      for (const command of commands) {
        // 回执丢失后同一命令会被重投（至少一次语义）：本进程内按 id 去重，
        // 避免「消息已发出但 ack 没送到」时重复发送；进程重启意味着运行已终态，
        // 不会再有重投窗口。
        if (executedCommands.has(command.id)) {
          results.push({ id: command.id, ok: true })
          continue
        }
        executedCommands.add(command.id)
        try {
          await execute(command)
          results.push({ id: command.id, ok: true })
        } catch (e) {
          results.push({
            id: command.id,
            ok: false,
            error: String((e as Error)?.message ?? e),
          })
        }
      }
      await bridgePost('run-commands-ack', { runId: RUN_ID, results })
    } catch {
      // 下一拍重试；心跳失败不阻塞 agent 本身
    } finally {
      polling = false
    }
  }
  void tick()
  return setInterval(() => {
    void tick()
  }, BRIDGE_POLL_MS)
}

/** 截断过长的 prompt 用于 reason */
function promptPreview(prompt: string): string {
  return prompt.length > 100 ? `${prompt.slice(0, 100)}...` : prompt
}

/**
 * 可重试 LLM 错误判定（与 pi 内核 retryAssistantCall 的
 * RETRYABLE_PROVIDER_ERROR_PATTERN 同源的压缩子集）：命中才推送 retrying，
 * 避免把计费/额度类不可重试错误也标成重试中。
 *
 * 状态码必须加词边界（`\b5\d\d\b`）：否则「512 tokens」「52000」这类数字片段
 * 也会命中，把不可重试的失败误标成重试中（`50[234]` 是 `5\d\d` 的子集，已删）。
 */
const RETRYABLE_ERROR_PATTERN =
  /\b429\b|rate\s?limit|too many requests|overloaded|\b5\d\d\b|service\s?unavailable|server\s?error|network\s?error|connection\s?(?:error|refused|lost)|socket\s?hang|fetch failed|getaddrinfo|ENOTFOUND|EAI_AGAIN|reset before headers|timed?\s?out|timeout|stream\s?ended|retry delay|you can retry|try your request again/i

/** 可重试 HTTP 状态码：429 限流、408 超时、5xx 服务器错误（含 520/524） */
function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500
}

/**
 * 不可重试的限额/额度类错误（与 pi 内核 NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN
 * 同源的压缩子集）。
 *
 * **必须有**：pi 内核先查这张表再查可重试表——命中即**不重试**（run 立即收敛，
 * 随后 agent_settled 推终态）。宿主侧若只查可重试表，这类错误会被推成 `retrying`，
 * 而实际没有任何重试在进行：任务停在「重试中」等一个永远不会到来的重试成功事件。
 * 2026-10-03 现场：`429 {"code":"insufficient_quota"}` 同时命中 `\b429\b` 与本表，
 * 任务被误标重试中逾 8 小时、队列整条停摆。
 *
 * 命中时**不推 retrying**（保持当前状态），终态仍由 agent_settled 按
 * lastRunFailure 判定——不在此处重复推终态，避免与 agent_settled 的判断分叉。
 */
const NON_RETRYABLE_LIMIT_PATTERN =
  /insufficient_quota|quota\s?exceeded|out\s?of\s?budget|usage\s?limit|monthly\s+usage\s+limit|available\s+balance|billing/i

/** 是否可重试：先排除限额/额度类（内核口径：这类不重试），再查可重试特征 */
function isRetryableErrorMessage(message: string): boolean {
  if (NON_RETRYABLE_LIMIT_PATTERN.test(message)) return false
  return RETRYABLE_ERROR_PATTERN.test(message)
}

/** 最近一次 agent loop 结束时记录的失败信息（null = 正常结束） */
interface LastRunFailure {
  /** 用户主动中断（Esc/Ctrl+C）；false = LLM 报错重试耗尽 */
  aborted: boolean
  errorMessage: string
}
/** agent_end 与 agent_settled 之间共享的最近一次 run 失败状态 */
let lastRunFailure: LastRunFailure | null = null

/**
 * 从 agent_end 消息中提取最后一条 assistant 消息的失败状态。
 *
 * 自动重试进行中时中间 agent_end 也可能带 error 消息，但本结果只在
 * agent_settled（run 完全收敛，含全部重试）时消费——重试成功后最终
 * agent_end 的末条 assistant stopReason 已是正常值，自动覆盖旧记录。
 */
function recordLastRunFailure(messages: unknown): void {
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i--) {
    const msg = list[i] as { role?: string; stopReason?: string; errorMessage?: string } | null
    if (msg?.role !== 'assistant') continue
    if (msg.stopReason === 'error') {
      lastRunFailure = { aborted: false, errorMessage: msg.errorMessage || 'unknown LLM error' }
    } else if (msg.stopReason === 'aborted') {
      lastRunFailure = { aborted: true, errorMessage: msg.errorMessage || '' }
    } else {
      lastRunFailure = null
    }
    return
  }
  lastRunFailure = null
}

export default function (pi: ExtensionAPI) {
  let agentBusy = false
  let bridgeLoop: ReturnType<typeof setInterval> | null = null
  if (bridgeEnabled()) {
    bridgeLoop = startCommandLoop(async (command) => {
      if (command.kind !== 'send') throw new Error(`unsupported command: ${command.kind}`)
      const text = String((command.payload as { text?: unknown } | null)?.text ?? '')
      if (!text) throw new Error('empty message')
      // ADR 0004：空闲起 turn，忙时排队（followUp），不另起第二会话
      if (agentBusy) await pi.sendUserMessage(text, { deliverAs: 'followUp' })
      else await pi.sendUserMessage(text)
    })
  }

  // 会话启动 / 重建（/new 后 pi 重新加载扩展并再次触发 session_start）：
  // 推送 idle，宿主驱动 waiting 态队列任务放行
  pi.on('session_start', (event) => {
    agentBusy = false
    void push('idle', 'Session started')
    enqueueEvent({ type: 'session_start', reason: event.reason })
  })

  // 用户提交 prompt（含队列自动投递）→ 任务进入执行状态
  pi.on('before_agent_start', (event) => {
    agentBusy = true
    void push('in_progress', `User submitted: ${promptPreview(event.prompt)}`)
    enqueueEvent({ type: 'before_agent_start' })
  })

  // LLM 调用返回可重试 HTTP 错误（429 限流 / 408 / 5xx）→ pi 将自动重试：
  // 推送 retrying 过渡态，任务保持活动，绝不被标记中断
  pi.on('after_provider_response', (event) => {
    if (isRetryableHttpStatus(event.status)) {
      void push('retrying', `Provider returned HTTP ${event.status}, auto retrying`)
    }
  })

  // 工具执行结束（成功/失败均视为任务进行中，与 PostToolUse 语义一致）
  pi.on('tool_execution_end', (event) => {
    void push('in_progress', `Tool ${event.toolName} completed`)
    enqueueEvent({
      type: 'tool_execution_end',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      result: event.result,
      isError: event.isError,
      durationMs: event.durationMs,
    })
  })

  // ==================== 桥接：会话事件上行 ====================
  pi.on('turn_start', (event) => {
    agentBusy = true
    enqueueEvent({ type: 'turn_start', turnIndex: event.turnIndex, timestamp: event.timestamp })
  })

  pi.on('message_start', (event) => {
    // assistant 的正文走 message_update / message_end；只上行用户消息（避免重复整包快照）
    if ((event.message as { role?: string }).role !== 'user') return
    enqueueEvent({ type: 'message_start', message: event.message })
  })

  pi.on('message_update', (event) => {
    // 去掉累积快照里的 partial（与 pi JSON 协议同口径）：归一入口只用 message
    // 快照 + delta 元数据，不必每帧重复传一份 partial
    const delta = { ...(event.assistantMessageEvent as any) }
    delete delta.partial
    const message = event.message as { timestamp?: number }
    enqueueStream(
      `pi:${message.timestamp ?? '?'}:${String(delta.contentIndex ?? '')}`,
      { type: 'message_update', message: event.message, assistantMessageEvent: delta },
    )
  })

  pi.on('message_end', (event) => {
    enqueueEvent({ type: 'message_end', message: event.message })
  })

  pi.on('tool_execution_start', (event) => {
    enqueueEvent({
      type: 'tool_execution_start',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
    })
  })

  // agent loop 结束：记录末条 assistant 消息的成败状态，供 agent_settled 判定终态
  // （扩展层拿不到 auto_retry_start/end 事件，stopReason/errorMessage 是唯一错误信号）。
  // 错误结果可能触发 pi 自动重试（网络错误无 HTTP 状态码，此处补推 retrying）；
  // 终态仍只在 agent_settled 判定——中间 agent_end 的错误会被后续成功重试覆盖
  pi.on('agent_end', (event) => {
    recordLastRunFailure(event.messages)
    if (
      lastRunFailure &&
      !lastRunFailure.aborted &&
      isRetryableErrorMessage(lastRunFailure.errorMessage)
    ) {
      void push('retrying', `LLM error, auto retrying: ${lastRunFailure.errorMessage}`)
    }
  })

  // run 完全收敛（自动重试/压缩/排队续跑均结束）。agent_settled 在 finally 中发出，
  // 失败收敛（429 等重试耗尽 / 用户中断）也会到达——按最近一次 run 成败判定终态：
  // 正常结束才 completed；LLM 报错或用户中断推 interrupted，否则失败任务被误标完成、
  // 队列立即调度下一项（宿主 valid_statuses 无 failed，interrupted 是唯一的失败终态）
  pi.on('agent_settled', (event) => {
    agentBusy = false
    enqueueEvent({ type: 'agent_settled', aborted: event.aborted })
    if (lastRunFailure) {
      const { aborted, errorMessage } = lastRunFailure
      lastRunFailure = null
      void push(
        'interrupted',
        aborted ? `Task aborted: ${errorMessage}` : `Task failed: ${errorMessage}`,
      )
      return
    }
    void push('completed', 'Task completed')
  })

  // 退出 pi → 会话中断；new/fork/resume 仅切换会话（pi 仍运行），不推送
  pi.on('session_shutdown', (event) => {
    agentBusy = false
    enqueueEvent({ type: 'session_shutdown', reason: event.reason })
    if (bridgeLoop) clearInterval(bridgeLoop)
    void flushBridge()
    if (event.reason === 'quit') {
      void push('interrupted', 'Session ended: quit')
    }
  })
}
