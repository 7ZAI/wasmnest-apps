/**
 * WasmNest OpenCode Bridge Plugin
 *
 * opencode 插件（部署名 `wasmnest_bridge.ts`）：一条通道做两件事——
 * 1. **事件上行**：把 opencode 事件总线的消息 / 思考 / 工具 / 会话事件推给
 *    BedCode 的唯一归一入口；任务状态仍按原状态机推 `task-status`；
 * 2. **命令下行**：轮询 `run-commands` 并执行（发送消息），回执 `run-commands-ack`。
 *
 * 由 opencode 自动加载（无需注册配置）。
 *
 * 事件映射（对应 Claude Code hooks 的状态机，payload 与 opencode 源码
 * packages/schema/src/session-event.ts / session-status-event.ts / v1/permission.ts 对齐）：
 *   session.created            → idle（opencode 启动会话后推送，宿主据此放行
 *                                waiting 态队列任务，等价 SessionStart）
 *   session.next.prompted      → in_progress（用户提交 prompt，等价 UserPromptSubmit）
 *   session.next.tool.called   → in_progress（工具被调用，等价 PostToolUse 前置信号）
 *   session.status(busy/retry) → in_progress / retrying（响应运行中/自动重试。
 *                                重试是过渡态：推 retrying 而非 in_progress，
 *                                宿主按非终态处理，不触发队列调度）
 *   session.status(idle)       → completed（run 完全收敛：子 agent / 后台工具均结束后
 *                                状态回 idle，天然等价 Stop + background_tasks 判定，
 *                                无 claude 的提前终态风险）
 *   session.idle               → completed（session.status 的 deprecated 前身，兼容回退）
 *   permission.asked           → asking（仅当规则评估需要用户决策时发布，
 *                                等价 Notification(permission_prompt)）
 *   permission.replied         → in_progress（用户已回复授权请求）
 *   session.error              → interrupted（用户中断 MessageAbortedError，
 *                                以及鉴权/额度/配置类**不可重试**错误——opencode
 *                                不会自动重试它们，保持活动态只会让任务永远停在
 *                                「重试中」，随后 session.idle 还会把它推成 completed）；
 *                                可重试错误（429/超时/网络/5xx）推 retrying，
 *                                保持任务活动，绝不标记中断
 *   session.next.step.failed   → retrying（步骤失败会触发自动重试，任务仍在进行）
 *
 * 生效条件：仅当 WASMNEST_SESSION_ID 环境变量存在时推送状态。
 * WasmNest 启动的 PTY 终端会自动注入此变量（pty_process.rs），
 * 外部终端不会设置，因此插件在 WasmNest 管理的终端外保持静默。
 *
 * HTTP 说明：
 * - 固定使用 127.0.0.1（Windows localhost IPv6 回退会卡 ~2 秒，见
 *   auto_task_hook.py 同名注释）
 * - 终态推送（completed/interrupted）为队列调度链的唯一触发信号，
 *   失败自动重试 3 次，避免静默丢终态卡死调度
 * - payload 携带 event_time（UTC，毫秒 3 位固定宽度），宿主据此拒绝
 *   迟到的旧事件推送（与宿主 SQLite 毫秒格式一致，字典序比较正确）
 *
 * 注意：
 * - opencode 子 agent（Task 工具）与主 agent 同进程运行，事件共享同一
 *   session；子 agent 步骤保持 busy，session.status 回 idle 即整个 run
 *   收敛，无需 pi 扩展那样的子进程静默判定
 * - 插件仅收到 location.directory 与启动目录匹配的会话事件（opencode
 *   按目录路由），天然限定在 WasmNest 注入 WASMNEST_SESSION_ID 的会话
 * - 自动授权不在此实现：opencode 用 permissions 配置（opencode.json
 *   的 allow 列表）声明式放行，比 hook 拦截更简单
 */

import type { Plugin } from '@opencode-ai/plugin'

// 部署时由宿主按当前端口改写（hooks.rs replace_opencode_plugin_port），勿手改
const WASMNEST_PORT = 8765 // @wasmnest-port
// 模板版本标记：内容升级时递增，宿主据此对旧部署副本自动重部署（hooks.rs）
// @wasmnest-template-version 12

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

/** 截断过长的 prompt 用于 reason */
function promptPreview(text: string): string {
  return text.length > 100 ? `${text.slice(0, 100)}...` : text
}

/**
 * 可重试错误判定（与 pi 适配器的 RETRYABLE_ERROR_PATTERN 同源的压缩子集）
 *
 * 为什么要分类：`session.error` 若一律推 retrying，鉴权失败 / 额度耗尽 / 配置错误
 * 这类 opencode **不会自动重试**的错误也会被标成「重试中」，任务永远停在活动态；
 * 而 run 结束后 session 仍会回 idle → `completed`，失败任务被标成成功。
 * 故下方 `isRetryableError` 先排除限额/额度类（[`NON_RETRYABLE_LIMIT_PATTERN`]），
 * 再查本表。
 */
const RETRYABLE_ERROR_PATTERN =
  /\b429\b|rate\s?limit|too many requests|overloaded|\b5\d\d\b|service\s?unavailable|server\s?error|network\s?error|connection\s?(?:error|refused|lost)|socket\s?hang|fetch failed|getaddrinfo|ENOTFOUND|EAI_AGAIN|timed?\s?out|timeout|stream\s?ended/i

/** opencode `session.error` 的 error 载荷形状（name + 可选 message） */
interface SessionErrorPayload {
  name?: string
  data?: { message?: string }
}

/**
 * 不可重试的限额/额度类错误（与 pi 适配器的 NON_RETRYABLE_LIMIT_PATTERN 同源）
 *
 * 与 pi 内核的 NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN 同口径：这类错误
 * opencode 同样**不会自动重试**，必须先行排除——否则 `429 {"code":
 * "insufficient_quota"}` 这类载荷（同时命中 429 与本表）会被推成 retrying，
 * 任务停在等一个永远不会到来的重试成功事件。
 */
const NON_RETRYABLE_LIMIT_PATTERN =
  /insufficient_quota|quota\s?exceeded|out\s?of\s?budget|usage\s?limit|monthly\s+usage\s+limit|available\s+balance|billing/i

/** 是否可重试：先排除限额/额度类，再查错误名或 message 里的可重试特征 */
function isRetryableError(error: SessionErrorPayload): boolean {
  const text = `${error.name ?? ''} ${error.data?.message ?? ''}`
  if (NON_RETRYABLE_LIMIT_PATTERN.test(text)) return false
  return RETRYABLE_ERROR_PATTERN.test(text)
}

/**
 * 推送任务状态到 WasmNest 桌面端 HTTP API
 * 失败不阻塞主流程，仅记录日志；终态推送自动重试。
 *
 * `runId` 显式传入：共享服务架构下本扩展活在 opencode 服务进程，进程 env 的
 * WASMNEST_SESSION_ID 是启动快照（陈旧/缺失），不能当运行身份用。
 */
async function push(
  runId: string | null,
  status: string,
  reason: string,
  questions?: unknown,
): Promise<void> {
  if (!runId) return

  // 宿主以 wasmnest 运行 id 键控任务行（on_input_submitted / 队列出队写入），
  // session_id 与运行 id 同值即可命中（见 state.rs handle_update_task_status）
  const payload: Record<string, unknown> = {
    session_id: runId,
    status,
    reason: reason || '',
    event_time: eventTime(),
    wasmnest_session_id: runId,
  }
  if (questions) payload.questions = questions

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
// attach 重试节流（无可认领运行 / 宿主未起时按会话去重后至少隔这么久再试）
const BRIDGE_ATTACH_RETRY_MS = 3000

interface BridgeRawEvent {
  type: string
  [key: string]: unknown
}

interface BridgeCommand {
  id: number
  kind: string
  payload: unknown
}

// ==================== 运行身份与多路复用（ADR 0004 run-attach） ====================
//
// V1（vanilla opencode，本地起 server）：env 注入 runId，一实例一运行 —— RUN_ID
// 直接可用。
// V2（opencode 2.x 共享服务）：扩展实例活在服务进程，env 是启动快照（可能陈旧
// 泄漏 / 缺失），且一个实例可能服务同项目多条运行 —— 运行身份经 `run-attach`
// 握手按 agent 会话绑定：后端按 cwd 解析项目，把未绑定且 PTY 在场的最旧运行
// 认领给该会话（绑定即认领，幂等重绑）。队列/心跳按 runId 分桶。

/** 运行身份解析面：V1 用 env 单运行；V2 按会话绑定多路复用 */
interface BridgeRuntime {
  /** 事件归属的运行 id（未知会话 / 未绑定 → null，调用方丢弃该事件） */
  runIdFor(sessionId: string): string | null
  /** 会话建立事件上保证绑定（V2 在此做 attach 握手；V1 恒已绑定） */
  ensureBinding(sessionId: string): Promise<boolean>
  /** 会话身份登记（V1 维护单运行 fallback；V2 登记子会话 → 根会话归并） */
  noteSession(sessionId: string, parentId?: string): void
}

// 队列按运行分桶：普通事件逐桶 FIFO（后端按 rev 挡旧快照），流式快照按桶内
// 身份（part / message + contentIndex）只保留最新一帧
const bridgeQueue = new Map<string, BridgeRawEvent[]>()
const bridgeStreaming = new Map<string, Map<string, BridgeRawEvent>>()
let bridgeTimer: ReturnType<typeof setTimeout> | null = null
let bridgeDisabled = false
let bridgeFlushDelay = BRIDGE_FLUSH_MS
/** 各运行上次 attach 空手而归的时刻（节流重试） */
const attachRetryAt = new Map<string, number>()

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
  return !bridgeDisabled
}

function scheduleBridgeFlush(delay = BRIDGE_FLUSH_MS): void {
  if (bridgeTimer) return
  bridgeTimer = setTimeout(() => {
    bridgeTimer = null
    void flushBridge()
  }, delay)
}

/** 普通事件入队（后到先发不影响：后端按 rev 挡旧快照） */
function enqueueEvent(runId: string, raw: BridgeRawEvent): void {
  if (!bridgeEnabled()) return
  if (bridgeEventTooLarge(raw)) return
  const bucket = bridgeQueue.get(runId) ?? []
  bucket.push({ ...raw, time: raw.time ?? Date.now() })
  if (bucket.length > BRIDGE_MAX_QUEUE) {
    bucket.splice(0, bucket.length - BRIDGE_MAX_QUEUE)
  }
  bridgeQueue.set(runId, bucket)
  scheduleBridgeFlush()
}

/** 流式快照：同一身份（part / message + contentIndex）只保留最新一帧 */
function enqueueStream(runId: string, key: string, raw: BridgeRawEvent): void {
  if (!bridgeEnabled()) return
  if (bridgeEventTooLarge(raw)) return
  const bucket = bridgeStreaming.get(runId) ?? new Map()
  bucket.set(key, { ...raw, time: Date.now() })
  if (bucket.size > BRIDGE_MAX_QUEUE) {
    const oldest = bucket.keys().next().value
    if (oldest) bucket.delete(oldest)
  }
  bridgeStreaming.set(runId, bucket)
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
  if (bridgeQueue.size === 0 && bridgeStreaming.size === 0) return
  // 逐运行出桶：同一运行的普通事件 + 流式快照合成一批（后端按 runId 归一）
  for (const [runId, bucket] of [...bridgeQueue.entries()]) {
    const streams = bridgeStreaming.get(runId)
    if (bucket.length === 0 && (!streams || streams.size === 0)) {
      bridgeQueue.delete(runId)
      continue
    }
    const batch = [...bucket, ...(streams ? streams.values() : [])]
    bridgeQueue.delete(runId)
    bridgeStreaming.delete(runId)
    try {
      const resp = await bridgePost('run-events', { runId, events: batch })
      if (resp.status === 409) {
        // 该 agent 没有桥接适配：运行期内不会好转，停用避免刷屏
        bridgeDisabled = true
        console.warn('[wasmnest] agent has no bridge adapter, event relay disabled')
        return
      }
      if (resp.status === 400 || resp.status === 413 || resp.status === 422) {
        // 协议错 / 体量超限：重试同一批永远不会成功，丢弃这一批（终端仍是真源）
        console.warn(`[wasmnest] bridge dropped one batch (HTTP ${resp.status})`)
        continue
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      bridgeFlushDelay = BRIDGE_FLUSH_MS
    } catch (e) {
      // 回环暂时不可用：保留本批（有界）并退避重试；Run 不存在时上面已停用
      bridgeQueue.set(runId, batch.concat(bridgeQueue.get(runId) ?? []).slice(-BRIDGE_MAX_QUEUE))
      if (streams && streams.size > 0) bridgeStreaming.set(runId, streams)
      bridgeFlushDelay = Math.min(bridgeFlushDelay * 2, 2000)
      scheduleBridgeFlush(bridgeFlushDelay)
      console.warn(`[wasmnest] event flush failed, retrying in ${bridgeFlushDelay}ms: ${e}`)
      return
    }
  }
  // 只剩流式桶（无普通事件）的运行同样要冲刷
  for (const [runId, streams] of [...bridgeStreaming.entries()]) {
    if (streams.size === 0) {
      bridgeStreaming.delete(runId)
      continue
    }
    const batch = [...streams.values()]
    bridgeStreaming.delete(runId)
    try {
      const resp = await bridgePost('run-events', { runId, events: batch })
      if (resp.status === 409) {
        bridgeDisabled = true
        return
      }
      if (resp.status === 400 || resp.status === 413 || resp.status === 422) continue
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      bridgeFlushDelay = BRIDGE_FLUSH_MS
    } catch (e) {
      bridgeStreaming.set(runId, streams)
      bridgeFlushDelay = Math.min(bridgeFlushDelay * 2, 2000)
      scheduleBridgeFlush(bridgeFlushDelay)
      console.warn(`[wasmnest] stream flush failed, retrying in ${bridgeFlushDelay}ms: ${e}`)
      return
    }
  }
}

type CommandExecutor = (command: BridgeCommand, runId: string) => Promise<void>

/** 命令轮询（每条已绑定运行一趟）：既是下行通道，也是各自的心跳（后端据此判镜像模式） */

/** 进程内去重集的容量上限（issue #25 L5）：长驻 serve 进程里无界增长会拖内存。
 *  重投窗口只有 30s 回收窗，这个量级远超任何真实在途命令数，FIFO 淘汰即可 */
const EXECUTED_COMMAND_CAP = 512

function startCommandLoop(pollTargets: () => string[], execute: CommandExecutor): ReturnType<typeof setInterval> | null {
  if (!bridgeEnabled()) return null
  const executedCommands = new Set<string>()
  let polling = false
  const tick = async (): Promise<void> => {
    if (!bridgeEnabled() || polling) return
    const runIds = pollTargets()
    if (runIds.length === 0) return
    polling = true
    try {
      for (const runId of runIds) {
        const resp = await bridgePost('run-commands', { runId })
        if (resp.status === 409) {
          bridgeDisabled = true
          return
        }
        // 404 = 运行行还没写入（启动竞态）或已被移除：下一拍再试，不能永久停用
        if (!resp.ok) continue
        const body = (await resp.json().catch(() => null)) as
          | { data?: { commands?: BridgeCommand[] }; commands?: BridgeCommand[] }
          | null
        const commands = body?.data?.commands ?? body?.commands ?? []
        if (!Array.isArray(commands) || commands.length === 0) continue
        const results: Array<Record<string, unknown>> = []
        for (const command of commands) {
          // 回执丢失后同一命令会被重投（至少一次语义）：本进程内按 run+id 去重，
          // 避免「消息已发出但 ack 没送到」时重复发送；进程重启意味着运行已终态，
          // 不会再有重投窗口。
          const commandKey = `${runId}:${command.id}`
          if (executedCommands.has(commandKey)) {
            results.push({ id: command.id, ok: true })
            continue
          }
          executedCommands.add(commandKey)
          // FIFO 淘汰最老一条（Set 迭代序 = 插入序），长驻进程不无界增长
          if (executedCommands.size > EXECUTED_COMMAND_CAP) {
            const oldest = executedCommands.values().next().value
            if (oldest !== undefined) executedCommands.delete(oldest)
          }
          try {
            await execute(command, runId)
            results.push({ id: command.id, ok: true })
          } catch (e) {
            results.push({
              id: command.id,
              ok: false,
              error: String((e as Error)?.message ?? e),
            })
          }
        }
        await bridgePost('run-commands-ack', { runId, results })
      }
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

/**
 * permission.asked → PluginQuestion 兼容格式（复用宿主提问面板 DTO）：
 * 权限请求没有选项结构，按 notification 的 Allow/Deny 双选项构造。
 */
function permissionQuestions(properties: Record<string, unknown>): unknown[] {
  const permission = String(properties.permission ?? '')
  if (!permission) return []
  return [
    {
      question: `Permission requested: ${permission}`,
      header: 'opencode permission',
      multi_select: false,
      options: [
        { label: 'Allow', description: 'Approve the request' },
        { label: 'Deny', description: 'Reject the request' },
      ],
    },
  ]
}

// ==================== 桥接核（V1 / V2 共享） ====================
// 状态与归一逻辑与运行时形态无关；两类形态只是「运行身份」与「事件投递」不同：
// - V1（vanilla opencode）：env 单运行（RUN_ID），hooks.event 投递，client.session 发送；
// - V2（opencode 2.x，含共享服务架构）：`run-attach` 按会话绑定多路复用，
//   ctx.event 的 AsyncIterable 投递（官方 opencode.ai/v2/docs/build/plugins/server），
//   ctx.session 发送。

/** V1 的单运行 fallback 会话 id（send 命令缺 agentSessionId 时的目标） */
let agentSessionID: string | null = null
const messageRoles = new Map<string, string>()
let bridgeCommandLoop: ReturnType<typeof setInterval> | null = null
/** 同进程防双引导（V1 hooks 与 V2 setup 理论上可能同时在场） */
let bridgeBooted = false

/** run-attach（列表态）：项目目录 → 全部可服务运行 id（心跳 + 命令轮询的对象）。
 *  空数组 = 无可服务运行（运行未落行 / 都已终态），下拍重试。 */
async function listOwnableRuns(cwd: string): Promise<string[]> {
  try {
    const resp = await bridgePost('run-attach', { cwd })
    if (!resp.ok) return []
    const body = (await resp.json().catch(() => null)) as
      | { data?: { runIds?: unknown }; runIds?: unknown }
      | null
    const runIds = body?.data?.runIds ?? body?.runIds
    return Array.isArray(runIds) ? runIds.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** run-attach（绑定价）：目录 + agent 会话 → 运行 id（null = 暂无可绑定运行，稍后重试）。
 * claim=false 为重绑模式（引导补绑用）：只命中已绑定运行，绝不开新认领。 */
async function attachRun(
  cwd: string,
  agentSessionId: string,
  claim: boolean,
): Promise<string | null> {
  const now = Date.now()
  const last = attachRetryAt.get(agentSessionId) ?? 0
  if (now - last < BRIDGE_ATTACH_RETRY_MS) return null
  attachRetryAt.set(agentSessionId, now)
  try {
    const resp = await bridgePost('run-attach', { cwd, agentSessionId, claim })
    if (!resp.ok) return null
    const body = (await resp.json().catch(() => null)) as
      | { data?: { runId?: string | null }; runId?: string | null }
      | null
    const runId = body?.data?.runId ?? body?.runId ?? null
    return typeof runId === 'string' && runId ? runId : null
  } catch {
    return null
  }
}

/** 回执等待上限：prompt 可能跑到整段生成结束——10s 内被接受即回 ok，
 * 生成期失败由 session.error 事件兜底（interrupted / retrying） */
const PROMPT_ACK_WAIT_MS = 10_000

/** 发送命令执行：两类 session API 形状都兼容——
 * - `parts`（V1，vanilla opencode 的 SDK client）：`prompt({sessionID, parts})`，
 *   旧版回退 `chat({path:{id}, body})`；
 * - `text`（V2，2.x 服务端 action API，schema 要求根级 `text`，2026-10-31 探针实证）：
 *   `prompt({sessionID, text})`。 */
async function executeSendCommand(
  command: BridgeCommand,
  sessionApi: Record<string, unknown> | undefined,
  fallbackSessionId: string | null,
  style: 'parts' | 'text',
): Promise<void> {
  if (command.kind !== 'send') throw new Error(`unsupported command: ${command.kind}`)
  const text = String((command.payload as { text?: unknown } | null)?.text ?? '')
  if (!text) throw new Error('empty message')
  const payload = command.payload as { agentSessionId?: string } | null
  const targetSession = payload?.agentSessionId ?? fallbackSessionId
  if (!targetSession) throw new Error('agent session id unknown (no session event yet)')
  const send = async (): Promise<void> => {
    if (sessionApi && typeof sessionApi.prompt === 'function') {
      await (sessionApi.prompt as (input: unknown) => Promise<unknown>)(
        style === 'text'
          ? { sessionID: targetSession, text }
          : { sessionID: targetSession, parts: [{ type: 'text', text }] },
      )
      return
    }
    if (style === 'parts' && sessionApi && typeof sessionApi.chat === 'function') {
      await (sessionApi.chat as (input: unknown) => Promise<unknown>)({
        path: { id: targetSession },
        body: { parts: [{ type: 'text', text }] },
      })
      return
    }
    throw new Error('opencode session API has no supported send method')
  }
  await Promise.race([
    send(),
    new Promise<void>((resolve) => setTimeout(resolve, PROMPT_ACK_WAIT_MS)),
  ])
}

/** 现场建会话并绑定到运行（opencode 会话是懒创建的：首条消息还没有任何会话）。
 * 建好的会话事件经 bindings 归到本运行；后端 meta 回填随后落 agent_session_id。 */
async function createSessionForRun(
  sessionApi: Record<string, unknown>,
  runId: string,
  bindings: Map<string, string>,
): Promise<string | null> {
  const create = (sessionApi as { create?: (input?: unknown) => Promise<unknown> }).create
  if (typeof create !== 'function') return null
  try {
    const created = (await create.call(sessionApi, {})) as { id?: unknown } | null
    const id = typeof (created as { id?: unknown } | null)?.id === 'string' ? String((created as { id: unknown }).id) : null
    if (id) bindings.set(id, runId)
    return id
  } catch {
    return null
  }
}

async function handleBridgeEvent(event: BridgeRawEvent, runtime: BridgeRuntime): Promise<void> {
  const properties = (event.properties ?? {}) as Record<string, unknown>
  const info = properties.info as
    | { id?: string; sessionID?: string; role?: string; parentID?: string }
    | undefined
  const part = properties.part as
    | { id?: string; messageID?: string; sessionID?: string; type?: string }
    | undefined
  const sessionID =
    String(properties.sessionID ?? info?.sessionID ?? part?.sessionID ?? '') ||
    (event.type === 'session.updated' || event.type === 'session.created'
      ? String(info?.id ?? '')
      : '')
  if (sessionID) {
    const parentId =
      typeof properties.parentID === 'string'
        ? properties.parentID
        : typeof info?.parentID === 'string'
          ? info.parentID
          : undefined
    runtime.noteSession(sessionID, parentId)
  }

  // 会话建立 / 消息事件先保证绑定（V2 在此做 attach 握手；V1 恒已绑定）。
  // message.updated 也触发：插件重载落在会话中段时，下一条消息即可恢复绑定。
  // 无可认领运行（他项目会话 / 无活跃运行 / 节流窗口）→ 丢弃，稍后的事件再试。
  if (
    sessionID &&
    (event.type === 'session.created' ||
      event.type === 'session.updated' ||
      event.type === 'message.updated')
  ) {
    if (!(await runtime.ensureBinding(sessionID))) return
  }
  const runId = sessionID ? runtime.runIdFor(sessionID) : null
  if (!runId) {
    // 未绑定运行的事件（子会话先于父到达等）：父绑定后其后续事件自然恢复
    return
  }

  switch (event.type) {
    // 会话启动 → idle：宿主据此放行 waiting 态队列任务
    case 'session.created':
      void push(runId, 'idle', 'Session started')
      enqueueEvent(runId, { type: event.type, properties, time: Date.now() })
      break

    // 用户提交 prompt（含队列自动投递）→ 任务进入执行状态
    case 'session.next.prompted': {
      const text = (properties.prompt as { text?: string } | undefined)?.text ?? ''
      void push(runId, 'in_progress', `User submitted: ${promptPreview(text)}`)
      break
    }

    // 工具被调用 → 任务进行中
    case 'session.next.tool.called': {
      const tool = String(properties.tool ?? '')
      void push(runId, 'in_progress', `Tool ${tool} called`)
      break
    }

    // run 状态机：busy/retry 运行中，idle 为完全收敛（终态由 Stop 等价语义判定）
    case 'session.status': {
      enqueueEvent(runId, { type: event.type, properties, time: Date.now() })
      const status = (properties.status as { type?: string } | undefined)?.type
      if (status === 'idle') {
        void push(runId, 'completed', 'Task completed')
      } else if (status === 'retry') {
        void push(runId, 'retrying', 'Auto retry in progress')
      } else {
        void push(runId, 'in_progress', 'Response running')
      }
      break
    }

    // session.status 的 deprecated 前身：兼容旧版 opencode
    case 'session.idle':
      void push(runId, 'completed', 'Task completed')
      enqueueEvent(runId, { type: event.type, properties, time: Date.now() })
      break

    // 权限请求需要用户决策 → asking（自动放行的请求不会发布此事件）
    case 'permission.asked': {
      const questions = permissionQuestions(properties)
      void push(runId, 'asking', 'Waiting for user permission', questions)
      break
    }

    // 用户已回复授权 → 恢复执行
    case 'permission.replied':
      void push(runId, 'in_progress', 'User replied to permission')
      break

    // 用户中断（Ctrl+C / Esc）→ interrupted；可重试错误 → retrying（agent 会自动重试）；
    // 其余（鉴权/额度/配置）opencode 不会重试 → interrupted（不留在活动态等一个不会来的重试）
    case 'session.error': {
      enqueueEvent(runId, { type: event.type, properties, time: Date.now() })
      const error = (properties.error ?? {}) as SessionErrorPayload
      if (error.name === 'MessageAbortedError') {
        void push(runId, 'interrupted', 'User interrupted the run')
      } else if (isRetryableError(error)) {
        void push(runId, 'retrying', `Run error, auto retrying: ${error.name ?? 'unknown'}`)
      } else {
        void push(runId, 'interrupted', `Run failed, not retryable: ${error.name ?? 'unknown'}`)
      }
      break
    }

    // 步骤失败会触发自动重试 → retrying（过渡态，任务仍在进行）
    case 'session.next.step.failed':
      void push(runId, 'retrying', 'Step failed, auto retrying')
      break

    // ==================== 桥接：会话事件上行 ====================
    case 'session.updated':
    case 'message.updated': {
      if (event.type === 'message.updated' && info?.id && info.role) {
        messageRoles.set(info.id, info.role)
        if (messageRoles.size > 500) {
          const oldest = messageRoles.keys().next().value
          if (oldest) messageRoles.delete(oldest)
        }
      }
      // summary.diffs 是历史快照（可达数百 KB），归一不需要：剥离后再上行
      const { summary: _summary, ...leanInfo } = info ?? {}
      enqueueEvent(runId, {
        type: event.type,
        properties: info ? { ...properties, info: leanInfo } : properties,
        time: Date.now(),
      })
      break
    }

    // 流式快照按 part id 合并；用户消息的 text part 由桥接补 role
    //（opencode part 本身不带角色，后端据此把用户正文归到 user.message）
    case 'message.part.updated': {
      if (!part?.id) break
      const role = part.messageID ? messageRoles.get(part.messageID) : undefined
      const enriched = role === 'user' ? { ...part, role: 'user' } : part
      enqueueStream(runId, `part:${part.id}`, {
        type: event.type,
        properties: { ...properties, part: enriched },
        time: Date.now(),
      })
      break
    }
  }
}

function stopBridge(): void {
  if (bridgeCommandLoop) {
    clearInterval(bridgeCommandLoop)
    bridgeCommandLoop = null
  }
  bridgeBooted = false
}

// ==================== V1（vanilla opencode）：命名导出插件 ====================

let v1Runtime: BridgeRuntime | null = null

export const WasmNestBridge: Plugin = async ({ client }) => {
  if (!bridgeBooted) {
    bridgeBooted = true
    const sessionApi = (client as unknown as { session?: Record<string, unknown> } | null)?.session
    v1Runtime = {
      runIdFor: () => RUN_ID,
      ensureBinding: async () => RUN_ID !== '',
      noteSession: (sessionId) => {
        agentSessionID = sessionId
      },
    }
    bridgeCommandLoop = bridgeEnabled()
      ? startCommandLoop(() => (RUN_ID ? [RUN_ID] : []), (command) =>
          executeSendCommand(command, sessionApi, agentSessionID, 'parts'),
        )
      : null
  }
  return {
    dispose: async () => {
      stopBridge()
      await flushBridge()
    },
    event: async ({ event }) => {
      await handleBridgeEvent(event as BridgeRawEvent, v1Runtime!)
    },
  }
}

// ==================== V2（opencode 2.x）：setup 引导 ====================
// 2.x 构建在模块级校验 `default` 导出形状 `{ id, effect | setup, server? }`，
// 命名导出会被拒载（"Plugin must export a default definition"，2026-10-31 E2E
// 实证）。本构建是共享服务架构（TUI 连常驻 serve 进程，扩展实例活在服务进程），
// 进程 env 拿不到当前运行 —— 运行身份经 run-attach 握手按会话绑定，事件按
// `location.directory` 过滤（服务总线是全量的，只转发本项目的会话事件），
// 发送走 ctx.session。env 缺失/外部终端不影响该路径；无项目目录时静默不引导。

/** opencode 2.x setup 上下文里桥接用到的最小面（类型仅本文件自持，不依赖包） */
interface BridgeV2Context {
  location?: { directory?: string }
  event: { subscribe(options?: { signal?: AbortSignal }): AsyncIterable<BridgeV2RawEvent> }
  session: Record<string, unknown>
}

/** 2.x 事件流条目（载荷在 `data`，顶层 `location.directory` 标注来源项目） */
interface BridgeV2RawEvent {
  type: string
  location?: { directory?: string } | null
  data?: Record<string, unknown> | null
}

/** 2.x 载荷 → 桥接核的 V1 形状（message/info/part 缺外壳时按字段特征补包） */
function adaptV2Event(raw: BridgeV2RawEvent, cwd: string): BridgeRawEvent | null {
  // 服务总线是全量的：只放行本项目的会话事件（location 由 opencode 按会话标注）
  const directory = raw.location?.directory
  if (directory && directory !== cwd) return null
  const data = raw.data ?? {}
  let properties: Record<string, unknown> = data
  const flat = data as { id?: unknown; role?: unknown; type?: unknown; messageID?: unknown }
  if (data.info === undefined && typeof flat.id === 'string' && flat.role !== undefined) {
    properties = { ...data, info: data }
  } else if (
    data.part === undefined &&
    typeof flat.type === 'string' &&
    typeof flat.id === 'string' &&
    typeof flat.messageID === 'string'
  ) {
    properties = { ...data, part: data }
  }
  return { type: raw.type, properties }
}

async function setupBridgeV2(ctx: BridgeV2Context): Promise<() => void> {
  if (bridgeBooted) return () => {}
  const cwd = ctx.location?.directory ?? ''
  if (!cwd) return () => {}
  bridgeBooted = true

  // 会话 → 运行绑定（root 会话键）；子会话经 childParents 归并到根
  const bindings = new Map<string, string>()
  const childParents = new Map<string, string>()
  // 心跳 / 命令轮询的对象集合（每拍经 run-attach 列表态刷新）
  const ownableRuns = new Set<string>()
  const rootOf = (sessionId: string): string => {
    let root = sessionId
    for (let hops = 0; hops < 8 && childParents.has(root); hops += 1) {
      root = childParents.get(root)!
    }
    return root
  }
  const runtime: BridgeRuntime = {
    runIdFor: (sessionId) => bindings.get(rootOf(sessionId)) ?? null,
    ensureBinding: async (sessionId) => {
      const root = rootOf(sessionId)
      if (bindings.has(root)) return true
      const runId = await attachRun(cwd, root, true)
      if (!runId) return false
      bindings.set(root, runId)
      return true
    },
    noteSession: (sessionId, parentId) => {
      if (parentId && !bindings.has(sessionId)) childParents.set(sessionId, parentId)
    },
  }
  const reverseTarget = (runId: string): string | null => {
    for (const [sessionId, bound] of bindings) {
      if (bound === runId) return sessionId
    }
    return null
  }
  const boundRuns = (): string[] => {
    // 心跳与命令轮询的对象 = 项目内全部可服务运行（opencode 会话是懒创建的，
    // 首条消息前没有任何会话事件——输入解锁靠心跳，不能等绑定）
    void listOwnableRuns(cwd).then((runIds) => {
      for (const runId of runIds) ownableRuns.add(runId)
      for (const runId of [...ownableRuns]) {
        if (!runIds.includes(runId)) ownableRuns.delete(runId)
      }
    })
    return [...ownableRuns]
  }
  bridgeCommandLoop = startCommandLoop(boundRuns, async (command, runId) => {
    const fallback = reverseTarget(runId) ?? (await createSessionForRun(ctx.session, runId, bindings))
    await executeSendCommand(command, ctx.session, fallback, 'text')
  })

  // 引导补绑（重绑模式）：插件（重）加载时把**已绑定**的会话接回来（bridge
  // 掉线重启场景）。历史未绑定会话绝不在此认领——死会话不能抢活运行，
  // 新认领只属于事件驱动路径（session.created / message.updated）。
  void (async () => {
    try {
      const list = await (ctx.session as { list?: () => Promise<{ data?: Array<Record<string, unknown>> }> })
        .list?.()
      for (const session of list?.data ?? []) {
        const directory = String(session.directory ?? '')
        if (directory && directory !== cwd) continue
        const id = String(session.id ?? '')
        if (!id || session.parentID) continue
        const runId = await attachRun(cwd, id, false)
        // 补绑成功必须写回映射（issue #25 M4）：不写回则重载后 reverseTarget
        // 找不到既有会话，send 命令会对同一条运行错开新会话
        if (runId) bindings.set(id, runId)
      }
    } catch {
      // 列举失败：事件流照常增量绑定
    }
  })()

  const controller = new AbortController()
  void (async () => {
    try {
      for await (const raw of ctx.event.subscribe({ signal: controller.signal })) {
        const event = adaptV2Event(raw, cwd)
        if (event) await handleBridgeEvent(event, runtime)
      }
    } catch (e) {
      if (!bridgeDisabled) console.warn(`[wasmnest] event stream failed: ${e}`)
    }
  })()
  return () => {
    controller.abort()
    stopBridge()
    void flushBridge()
  }
}

export default {
  id: 'wasmnest-bridge',
  server: WasmNestBridge,
  setup: setupBridgeV2,
}
