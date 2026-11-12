/**
 * 终端 chrome 域（工作台终端 pane 与独立终端窗口共用）
 *
 * 只放两处**必须一致**的展示与判定：
 * - 运行状态 → 圆点颜色 / 状态文案 / 文案色（两处各写一份必然漂移）；
 * - 运行时长（从 startedAt 起算，每秒推进）；
 * - 任务域适配判定（判据取后端 `session.task.running-sessions` 的 is_supported，
 *   不在前端 hardcode agent 白名单——权威来源是 Rust 侧 AGENT_PROFILES）。
 *
 * 设置面板的取值/写回不在这里：它绑的是 `TerminalPreview` 暴露的 ref（主题/字号/
 * 字间距），由视图层用一个 writable computed 接通即可，比在这里再包一层更短。
 */
import { computed, inject, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** 运行/会话状态文案 key（后端状态字符串 → i18n key） */
const STATUS_KEY: Record<string, string> = {
  starting: 'session.status.starting',
  running: 'session.status.running',
  waitingInput: 'session.status.asking',
  error: 'session.status.error',
  stopped: 'session.status.stopped',
}

/** 状态圆点（背景色类） */
const STATUS_DOT: Record<string, string> = {
  running: 'bg-[var(--color-success)]',
  waitingInput: 'bg-[var(--color-warning)]',
  starting: 'bg-[var(--color-info)] animate-pulse',
  error: 'bg-[var(--color-danger)]',
}

/** 状态文案颜色类 */
const STATUS_TEXT: Record<string, string> = {
  running: 'text-[var(--color-success-ink)]',
  waitingInput: 'text-[var(--color-warning-ink)]',
  error: 'text-[var(--color-danger-ink)]',
  starting: 'text-[var(--color-info-ink)]',
}

/** 非终态（有存活 PTY，可看字节 / 可停止 / 可切换模型） */
export function isLiveStatus(status: string | null | undefined): boolean {
  return status === 'running' || status === 'waitingInput' || status === 'starting'
}

/** 运行时长 `h:mm:ss`；非存活或没有 startedAt 时 `--:--:--` */
export function formatUptime(
  startedAt: string | null | undefined,
  nowMs: number,
  live: boolean,
): string {
  if (!startedAt || !live) return '--:--:--'
  const diff = Math.floor((nowMs - new Date(startedAt).getTime()) / 1000)
  if (!Number.isFinite(diff) || diff < 0) return '--:--:--'
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export interface TerminalChromeOptions {
  /** 翻译（插件 i18n，已带插件前缀） */
  t: (key: string, params?: Record<string, unknown>) => string
  /** 当前运行/会话状态字符串 */
  status: Ref<string | null | undefined> | ComputedRef<string | null | undefined>
  /** 启动时刻（RFC3339；拼屏里随焦点运行变化） */
  startedAt: Ref<string | null | undefined> | ComputedRef<string | null | undefined>
  /** 会话 id（任务域判定的入参；空串 = 无会话，不显示入口） */
  sessionId: Ref<string> | ComputedRef<string>
}

export function useTerminalChrome(options: TerminalChromeOptions) {
  const context = inject<PluginContext>('pluginContext')!
  const { t } = options

  const nowTick = ref(Date.now())
  const timer = setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
  onUnmounted(() => clearInterval(timer))

  const isLive = computed(() => isLiveStatus(options.status.value))

  const statusColor = computed(() => {
    const key = options.status.value ?? ''
    return STATUS_DOT[key] ?? 'bg-[var(--text-tertiary)]'
  })

  const statusText = computed(() => {
    const key = STATUS_KEY[options.status.value ?? '']
    return key ? t(key) : t('session.status.unknown')
  })

  const statusLabelClass = computed(() => {
    const key = options.status.value ?? ''
    return STATUS_TEXT[key] ?? 'text-[var(--text-tertiary)]'
  })

  const uptimeText = computed(() =>
    formatUptime(options.startedAt.value, nowTick.value, isLive.value),
  )

  // ==================== 任务队列入口（后端判据） ====================

  const taskSupported = ref(false)
  let taskSupportSeq = 0

  /**
   * 评估当前会话是否任务域适配。
   *
   * 异步评估带序号：会话切换（拼屏换焦点）时丢弃过期结果，避免旧运行的 agent
   * 覆盖新状态。取不到判据 → 不显示入口（不猜支持）。
   */
  async function evaluateTaskSupport(): Promise<void> {
    const sessionId = options.sessionId.value
    const seq = ++taskSupportSeq
    if (!sessionId) {
      taskSupported.value = false
      return
    }
    try {
      const result = (await context.commands.execute('session.task.running-sessions')) as {
        sessions?: { session_id?: string; is_supported?: boolean }[]
      } | null
      if (seq !== taskSupportSeq) return
      const match = (result?.sessions ?? []).find((item) => item.session_id === sessionId)
      taskSupported.value = match?.is_supported ?? false
    } catch {
      if (seq === taskSupportSeq) taskSupported.value = false
    }
  }

  return {
    isLive,
    statusColor,
    statusText,
    statusLabelClass,
    uptimeText,
    taskSupported,
    evaluateTaskSupport,
  }
}
