/**
 * 运行事件账本读取面（ADR 0004 / issue #23 M3 对话面）
 *
 * 唯一数据通路是 `run.events {runId, afterId, limit}`：游标 `cursor` 由后端
 * 给出（= 本批最大**写入 id**），事件按 `seq`（逻辑位置）排序渲染。后端对同一
 * 身份的事件做原地更新（换新写入 id、保留 seq），因此增量批里会同时出现
 * 「新位置的新事件」与「老位置的新内容」——合并规则是纯函数 [`mergeEvents`]：
 * 同 seq 就地替换、新 seq 按序插入，UI 侧的流式正文靠它原地刷新而不是追加。
 *
 * **降级状态随事件一起回**（`bridge.connected` / `truncated`），不需要额外读
 * `run.list`；读取失败（运行不存在 / 私有库损坏）落在 `loadError` 里显性上浮，
 * 不伪装成「没有事件」（spec 用户故事 39）。
 *
 * **发送**走 `run.send`（后端显性拒绝镜像模式与终态运行）：成功后先把消息以
 * 「排队中」气泡本地呈现（spec 用户故事 18），agent 事件流回显同一文本的
 * `user.message` 时（[`consumeEchoes`]）再收掉本地气泡。
 *
 * 本模块只做「取数 + 合并 + 编排」，不含文案与弹窗：错误上抛由视图层转成
 * 用户可见提示。
 */
import { computed, ref, watch, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** 账本里的一条归一事件（`run.events` 的 events[] 项，与 `events::list_json` 同形） */
export interface RunEvent {
  /** 逻辑位置（渲染排序键；同身份更新保留） */
  seq: number
  at: string
  kind: string
  payload: Record<string, unknown>
  /** bridge / mirror / local */
  source: string
}

/** 桥接在线状态（随 `run.events` 响应回） */
export interface BridgeState {
  connected: boolean
  lastSeenAt: string | null
}

/** `run.events` 响应（只取 UI 需要的字段） */
interface RunEventsResponse {
  runId?: string
  truncated?: boolean
  cursor?: number
  events?: {
    seq?: unknown
    at?: unknown
    kind?: unknown
    payload?: unknown
    source?: unknown
  }[]
  bridge?: { connected?: unknown; lastSeenAt?: unknown }
}

/** 「排队中」的本地消息（发送已被命令队列接住、尚未在事件流回显） */
export interface PendingMessage {
  id: number
  text: string
}

/** 轮询参数（测试可注入；默认 1s 与镜像轮询节奏一致） */
export interface UseRunEventsOptions {
  /** 运行是否非终态：false 时停止轮询（终态前补最后一拍） */
  active?: Ref<boolean>
  intervalMs?: number
  limit?: number
}

/**
 * 增量合并（纯函数）：同 seq 就地替换（原地更新的新内容），新 seq 按序插入
 *
 * 输入不保证有序（按写入 id 选出的行按 seq 排序，但跨批仍可能交错）；输出
 * 恒按 seq 升序。返回新数组（不改入参），调用方整体替换响应式引用。
 */
export function mergeEvents(existing: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const bySeq = new Map<number, RunEvent>()
  for (const event of existing) bySeq.set(event.seq, event)
  for (const event of incoming) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

/**
 * 回显消费（纯函数）：事件流里每条 `user.message` 收掉一条同文本的排队气泡
 *
 * 发送成功 ≠ agent 已接：气泡要等到 agent 自己把这条消息作为事件发回来才能
 * 摘掉。文本比对取 trim 后全等——桥接对正文不做改写（opencode part 原文 /
 * pi content 原文），改写场景出现时再引入 id 级协议。
 */
export function consumeEchoes(
  pending: PendingMessage[],
  incoming: RunEvent[],
): { kept: PendingMessage[]; echoed: number } {
  const queue = [...pending]
  let echoed = 0
  for (const event of incoming) {
    if (event.kind !== 'user.message') continue
    const text = typeof event.payload?.text === 'string' ? event.payload.text.trim() : ''
    if (!text) continue
    const index = queue.findIndex((item) => item.text.trim() === text)
    if (index >= 0) {
      queue.splice(index, 1)
      echoed += 1
    }
  }
  return { kept: queue, echoed }
}

export function useRunEvents(
  context: PluginContext,
  runId: Ref<string | null>,
  options: UseRunEventsOptions = {},
) {
  const intervalMs = options.intervalMs ?? 1000
  const limit = options.limit ?? 500
  const active = options.active ?? ref(true)

  const events = ref<RunEvent[]>([])
  const truncated = ref(false)
  const bridge = ref<BridgeState | null>(null)
  /** 账本读取失败（运行不存在 / 库损坏）：显性上浮，不伪装成空账本 */
  const loadError = ref<string | null>(null)
  /** 首屏加载中（增量轮询不置位：流式期间不该闪加载态） */
  const loading = ref(false)
  const pending = ref<PendingMessage[]>([])

  const eventCount = computed(() => events.value.length)
  const lastEvent = computed(() => events.value[events.value.length - 1] ?? null)

  let cursor = 0
  /** 请求代际：换运行 / 重置后丢弃在途旧响应，防止串账本 */
  let generation = 0
  let timer: ReturnType<typeof setInterval> | null = null
  /**
   * 在途拉取的代际集合：同一代际同时只允许一拍在跑（防重叠轮询）；
   * **不跨代际互斥**——旧代际的慢请求在途时，换运行的新一代必须立刻能开拍
   */
  const activeGenerations = new Set<number>()
  let pendingId = 0

  function reset(): void {
    generation += 1
    cursor = 0
    events.value = []
    truncated.value = false
    bridge.value = null
    loadError.value = null
    pending.value = []
  }

  /** 解析响应的事件行（形状不对的行丢弃：账本损坏不该炸掉整个对话面） */
  function parseEvents(raw: RunEventsResponse['events']): RunEvent[] {
    if (!Array.isArray(raw)) return []
    const parsed: RunEvent[] = []
    for (const item of raw) {
      const seq = typeof item?.seq === 'number' ? item.seq : Number.NaN
      const kind = typeof item?.kind === 'string' ? item.kind : ''
      if (!Number.isFinite(seq) || !kind) continue
      parsed.push({
        seq,
        at: typeof item.at === 'string' ? item.at : '',
        kind,
        payload:
          item.payload && typeof item.payload === 'object'
            ? (item.payload as Record<string, unknown>)
            : {},
        source: typeof item.source === 'string' ? item.source : 'bridge',
      })
    }
    return parsed
  }

  /**
   * 拉取一拍：满页时立刻续拉（账本尾部长于单页 limit 时一拍吃不完）
   *
   * 返回「这一拍新到的事件」（含原地更新的老位置新内容），供回显消费与
   * 调用方观察；游标永远取响应给的 `cursor`，不由前端自行推算。
   */
  async function fetchOnce(myGeneration: number): Promise<RunEvent[]> {
    const response = (await context.commands.execute('run.events', {
      runId: runId.value,
      afterId: cursor,
      limit,
    })) as RunEventsResponse | null
    // 响应回来前换了运行 / 重置：这批属于旧账本，丢弃
    if (myGeneration !== generation) return []
    const incoming = parseEvents(response?.events)
    cursor = typeof response?.cursor === 'number' ? response.cursor : cursor
    truncated.value = response?.truncated === true
    if (response?.bridge && typeof response.bridge === 'object') {
      bridge.value = {
        connected: response.bridge.connected === true,
        lastSeenAt:
          typeof response.bridge.lastSeenAt === 'string' ? response.bridge.lastSeenAt : null,
      }
    }
    if (incoming.length > 0) {
      events.value = mergeEvents(events.value, incoming)
      const { kept } = consumeEchoes(pending.value, incoming)
      pending.value = kept
    }
    loadError.value = null
    return incoming
  }

  /** 一拍 = 拉到不满页为止（满页说明尾部还有积压） */
  async function poll(): Promise<void> {
    const myGeneration = generation
    if (activeGenerations.has(myGeneration) || !runId.value) return
    activeGenerations.add(myGeneration)
    try {
      for (let pages = 0; pages < 64; pages += 1) {
        const incoming = await fetchOnce(myGeneration)
        if (myGeneration !== generation) break
        if (incoming.length < limit) break
      }
    } catch (error) {
      if (myGeneration === generation) {
        loadError.value = error instanceof Error ? error.message : String(error)
      }
    } finally {
      activeGenerations.delete(myGeneration)
    }
  }

  async function pollInitial(): Promise<void> {
    const myGeneration = generation
    loading.value = true
    try {
      await poll()
    } finally {
      // 期间换了运行：loading 归新一轮的首屏，不在这里关
      if (myGeneration === generation) loading.value = false
    }
  }

  function startPolling(): void {
    if (timer !== null) return
    timer = setInterval(() => {
      if (active.value) void poll()
    }, intervalMs)
  }

  function stopPolling(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  watch(
    runId,
    (id) => {
      reset()
      if (!id) {
        stopPolling()
        return
      }
      void pollInitial()
      startPolling()
    },
    { immediate: true },
  )

  // 终态前补最后一拍：轮询停在「active 翻假」之前，最后一拨事件（收尾正文 /
  // 状态）可能还没进账本——停拍前再拉一次，把尾巴收干净
  watch(active, (isActive) => {
    if (!isActive && runId.value) void poll()
  })

  /**
   * 发送一条消息（`run.send`）：成功先落「排队中」气泡，事件流回显后摘除
   *
   * 失败原样上抛（镜像模式 / 运行已结束 / agent 无桥接）：由视图层转成
   * 可读提示——后端拒绝的理由不同，文案归视图层。
   */
  async function sendText(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || !runId.value) return
    const raw = (await context.commands.execute('run.send', {
      runId: runId.value,
      text: trimmed,
    })) as { commandId?: unknown } | null
    if (!raw || typeof raw.commandId === 'undefined') {
      throw new Error('run.send returned no commandId')
    }
    pending.value = [...pending.value, { id: (pendingId += 1), text: trimmed }]
  }

  /** 手动重试（读取失败横幅的按钮）：清错误态、从当前游标续拉 */
  async function retry(): Promise<void> {
    loadError.value = null
    await poll()
  }

  function dispose(): void {
    stopPolling()
    generation += 1
  }

  return {
    events,
    pending,
    truncated,
    bridge,
    loadError,
    loading,
    eventCount,
    lastEvent,
    sendText,
    retry,
    dispose,
  }
}

export type RunEventsDomain = ReturnType<typeof useRunEvents>
