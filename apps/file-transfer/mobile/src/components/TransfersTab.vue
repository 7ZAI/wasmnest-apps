<script setup lang="ts">
/**
 * TransfersTab — 传输列表 tab
 *
 * 结构：顶部四等分分段控件（全部 / 发送 / 接收 / 历史，占满整宽，滑块指示
 * 当前段）+ 传输列表。「全部」为发送队列 ∪ 接收中（计数与展示同口径，
 * 历史归档单独成段）。领域模型由本层映射为 TaskCard 的纯展示 props
 * （文案格式化在此完成，卡内不含逻辑）。列表空但存在活跃对端时，空态直接给
 * 「发送文件」主按钮——传输页没有任务时仍要有下一步动作。
 *
 * 状态呈现仍走 spec 9.3 四色体系（ft-color-* / ft-progress-*）。
 * 列表入场走 TransitionGroup 错峰浮入（fv2-card-in-*），筛选切换时剩余
 * 卡片平滑让位；位移/透明度之外的属性不动，减弱动效下退化为直显。
 */
import { computed, ref } from 'vue'
import type { Task, ReceivingTask, HistoryEntry } from '../types'
import {
  TASK_STATE_KEYS,
  TASK_STATE_COLOR_CLASS,
  TASK_STATE_PROGRESS_CLASS,
  isTerminalState,
} from '../types'
import { formatBytes, formatSpeed, progressPercent } from '../utils/format'
import { nextFilterKey } from '../utils/filterSwipe'
import type { TaskAction, TransferFilter } from '../types'
import TaskCard from './TaskCard.vue'
import EmptyState from './EmptyState.vue'

type Translate = (key: string, params?: Record<string, any>) => string

const props = defineProps<{
  tasks: Task[]
  receiving: ReceivingTask[]
  history: HistoryEntry[]
  /** 空态主 CTA：发送文件（有活跃对端时才给动作） */
  uploadLabel: string
  canUpload: boolean
  t: Translate
}>()

const emit = defineEmits<{
  (e: 'cancel', id: string): void
  (e: 'retry', id: string): void
  (e: 'pause', id: string): void
  (e: 'resume', id: string): void
  (e: 'resumeAll'): void
  (e: 'cancel-receiving', sessionId: string): void
  (e: 'clear-history'): void
  (e: 'open-location', id: string): void
  (e: 'upload'): void
}>()

const t = props.t

/** 当前筛选 */
const filter = ref<TransferFilter>('all')

/** 显示名：远端相对路径取 basename */
function basename(path: string): string {
  return path.split('/').pop() || path
}

/** 发送 tab：仅本端发出的批 */
const sendingTasks = computed(() => props.tasks.filter((tk) => tk.direction === 'upload'))

/** 各筛选的条目数（chip 角标；全部 = 发送队列 ∪ 接收中，历史归档不计入） */
const counts = computed(() => ({
  all: props.tasks.length + props.receiving.length,
  sending: sendingTasks.value.length,
  receiving: props.receiving.length,
  history: props.history.length,
}))

/**
 * 展示集合（与 chip 计数同口径）：
 * 「全部」渲染发送队列卡 + 接收卡；「发送/接收」单筛各自只取自己的集合。
 */
const visibleQueue = computed(() => {
  if (filter.value === 'sending') return sendingTasks.value
  if (filter.value === 'receiving') return []
  return props.tasks
})

const receivingCards = computed(() =>
  filter.value === 'receiving' || filter.value === 'all' ? props.receiving : [],
)

/** 活动传输区是否整体为空（决定空态显隐） */
const listEmpty = computed(
  () => visibleQueue.value.length === 0 && receivingCards.value.length === 0,
)

const FILTERS = computed<Array<{ key: TransferFilter; labelKey: string; count: number }>>(() => [
  { key: 'all', labelKey: 'transfer.v2.filter.all', count: counts.value.all },
  { key: 'sending', labelKey: 'transfer.v2.filter.sending', count: counts.value.sending },
  { key: 'receiving', labelKey: 'transfer.v2.filter.receiving', count: counts.value.receiving },
  { key: 'history', labelKey: 'transfer.v2.filter.history', count: counts.value.history },
])

/**
 * 分段控件滑块位置：四个筛选等分整宽，滑块按索引平移自身宽度（100% = 一格）。
 * 用 transform 而非改 left，位移走合成层；索引与格宽都由同一份 FILTERS 决定，
 * 增删筛选项不会出现滑块与文字错位。
 */
const filterIndex = computed(() => {
  const index = FILTERS.value.findIndex((f) => f.key === filter.value)
  return index < 0 ? 0 : index
})

const indicatorStyle = computed(() => ({ transform: `translateX(${filterIndex.value * 100}%)` }))

/**
 * 手势步进一格筛选（父级横滑手势转调，本组件自持筛选状态不外包）。
 *
 * @returns true = 本次滑动已消费（换了段）；false = 已在首/尾段，父级据此翻一级页面
 */
function stepFilter(dir: 'left' | 'right'): boolean {
  const next = nextFilterKey(
    FILTERS.value.map((f) => f.key),
    filter.value,
    dir,
  )
  if (!next) return false
  filter.value = next
  return true
}

// 页内横滑的入口：手势仍由 FileTransferView 的横滑区统一持有（触摸与 dev-shell
// 鼠标拖动共用一套阈值/方向逻辑），这里只暴露「能不能再切一段」
defineExpose({ stepFilter })

/** 空态图标（按当前筛选给不同语义图标） */
const emptyIcon = computed(() => {
  switch (filter.value) {
    case 'receiving':
      return 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-5.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293H4'
    case 'history':
      return 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
    default:
      return 'M13 10V3L4 14h7v7l9-11h-7z'
  }
})

/** 空态文案 */
const emptyTitle = computed(() => {
  if (filter.value === 'history') return t('transfer.history.empty')
  if (filter.value === 'receiving') return t('transfer.task.empty')
  return t('transfer.task.empty')
})

// ==================== 发送 / 全部（Task → 卡片） ====================

/** 上传批等待对端确认（接收策略 ask 的应答窗口；插件在首个进度事件前沿用 pending） */
function isAwaitingPeer(task: Task): boolean {
  return task.direction === 'upload' && task.state === 'pending'
}

/** 状态 chip 文案：pending 的发送批等待确认，按方向给友好文案 */
function taskStateLabel(task: Task): string {
  return isAwaitingPeer(task)
    ? t('transfer.task.state.awaitingPeer')
    : t(TASK_STATE_KEYS[task.state])
}

/** 任务元信息：已传/总大小 + 速率（仅传输中带速率；等待确认时无字节可报） */
function taskMeta(task: Task): string {
  if (isAwaitingPeer(task)) return ''
  const size =
    task.size > 0
      ? `${formatBytes(task.offset, t)} / ${formatBytes(task.size, t)}`
      : formatBytes(task.offset, t)
  return task.state === 'transferring' ? `${size} · ${formatSpeed(task.rateBps ?? 0, t)}` : size
}

/** 卡面进度：等待确认/终态不显示进度条 */
function taskProgress(task: Task): number | null {
  if (isAwaitingPeer(task) || isTerminalState(task.state)) return null
  return progressPercent(task.offset, task.size) ?? 0
}

/** 等待确认的友好提示行（非错误态，单独样式） */
function taskHint(task: Task): string | null {
  return isAwaitingPeer(task) ? t('transfer.task.awaitingPeerHint') : null
}

/** 失败/拒绝原因文案（reason wire → 展示文案 key） */
function taskReason(task: Task): string | null {
  if (task.state !== 'failed' && task.state !== 'rejected') return null
  switch (task.reason) {
    case 'duplicate-name':
    case 'DuplicateName':
      return t('transfer.task.reason.duplicateName')
    case 'remote-changed':
      return t('transfer.task.reason.remoteChanged')
    case 'no-roots':
      return t('transfer.task.reason.noRoots')
    case 'local file not found':
      return t('transfer.task.reason.localNotFound')
    case 'user-rejected':
      return t('transfer.error.rejectedByUser')
    case 'timeout':
      return t('transfer.error.noResponse')
    case 'policy-denied':
      return t('transfer.error.policyDenied')
    default:
      return task.reason ? String(task.reason) : t('transfer.task.reason.unknown')
  }
}

/** 任务操作：终态不可取消；failed/rejected/interrupted 可重试 */
function taskActions(task: Task): TaskAction[] {
  const btns: TaskAction[] = []
  if (task.state === 'failed' || task.state === 'rejected' || task.state === 'interrupted') {
    btns.push({ kind: 'retry', label: t('transfer.task.retry'), variant: 'tint' })
  }
  if (task.state === 'transferring') {
    btns.push({ kind: 'pause', label: t('transfer.task.pause'), variant: 'neutral' })
  }
  if (task.state === 'paused') {
    btns.push({ kind: 'resume', label: t('transfer.task.resume'), variant: 'tint' })
  }
  if (!isTerminalState(task.state)) {
    btns.push({ kind: 'cancel', label: t('transfer.task.cancel'), variant: 'neutral' })
  }
  return btns
}

/** 是否存在已暂停任务（「全部继续」按钮可见性） */
function hasPaused(tasks: Task[]): boolean {
  return tasks.some((task) => task.state === 'paused')
}

// ==================== 接收中（ReceivingTask → 卡片） ====================

/** 接收中状态文案（running/transferring → 正在接收；paused → 已暂停；终态 → 结果文案） */
function receivingStateKey(task: ReceivingTask): string {
  if (task.state === 'running' || task.state === 'transferring') return 'transfer.task.receiving'
  switch (task.state) {
    case 'paused':
      return 'transfer.task.state.paused'
    case 'completed':
      return 'transfer.history.results.completed'
    case 'failed':
      return 'transfer.history.results.failed'
    case 'rejected':
      return 'transfer.history.results.rejected'
    case 'cancelled':
      return 'transfer.history.results.cancelled'
    default:
      return 'transfer.history.results.failed'
  }
}

function receivingStateClass(task: ReceivingTask): string {
  if (task.state === 'running' || task.state === 'transferring') return 'ft-color-active'
  if (task.state === 'paused') return 'ft-color-paused'
  if (task.state === 'completed') return 'ft-color-completed'
  if (task.state === 'cancelled') return 'ft-color-cancelled'
  return 'ft-color-failed'
}

const RECEIVING_TERMINAL = new Set(['completed', 'failed', 'rejected', 'cancelled'])

// ==================== 历史（HistoryEntry → 卡片） ====================

/** 相对时间：刚刚 / N 分钟前 / N 小时前；>24 小时回退 MM-DD（历史跨天不写年份） */
function historyTime(ms: number): string {
  if (!ms) return ''
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60000))
  if (mins < 1) return t('transfer.time.justNow')
  if (mins < 60) return t('transfer.time.minutesAgo', { count: mins })
  if (mins < 1440) return t('transfer.time.hoursAgo', { count: Math.floor(mins / 60) })
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function historyStateKey(state: string): string {
  switch (state) {
    case 'completed':
      return 'transfer.history.results.completed'
    case 'failed':
      return 'transfer.history.results.failed'
    case 'rejected':
      return 'transfer.history.results.rejected'
    case 'cancelled':
      return 'transfer.history.results.cancelled'
    default:
      return 'transfer.history.results.failed'
  }
}

function historyStateClass(state: string): string {
  if (state === 'completed') return 'ft-color-completed'
  if (state === 'cancelled') return 'ft-color-cancelled'
  return 'ft-color-failed'
}

/** 接收任务操作：传输中可暂停（拉取发起方门控对端推流），已暂停可继续，
 * 非终态可取消（与发送方向同语义；push 接收由对端发送会话门控） */
function receivingActions(task: ReceivingTask): TaskAction[] {
  const btns: TaskAction[] = []
  if (task.state === 'running' || task.state === 'transferring') {
    btns.push({ kind: 'pause', label: t('transfer.task.pause'), variant: 'neutral' })
  }
  if (task.state === 'paused') {
    btns.push({ kind: 'resume', label: t('transfer.task.resume'), variant: 'tint' })
  }
  if (!RECEIVING_TERMINAL.has(task.state)) {
    btns.push({ kind: 'cancel-receiving', label: t('transfer.task.cancel'), variant: 'neutral' })
  }
  return btns
}

/** 取消原因码 → i18n（兼容旧引擎本地化文本 wire：'cancelled by sender' 等） */
function cancelledReason(reason: string): string {
  switch (reason) {
    case 'cancelled-by-sender':
    case 'cancelled by sender':
      return t('transfer.task.reason.cancelledBySender')
    case 'cancelled-by-receiver':
    case 'cancelled by receiver':
      return t('transfer.task.reason.cancelledByReceiver')
    case 'cancelled-by-self':
    case 'cancelled by self':
      return t('transfer.task.reason.cancelledBySelf')
    default:
      return reason
  }
}

/** 接收卡原因文案（wire detail → i18n；未知回退原文） */
function receivingReason(task: ReceivingTask): string | null {
  if (!task.reason) return null
  return cancelledReason(String(task.reason))
}

/** 历史条目原因文案（取消码 i18n 化；failed detail 保留原文） */
function historyReason(entry: HistoryEntry): string | null {
  if (!entry.reason) return null
  return cancelledReason(String(entry.reason))
}

function historyMeta(entry: HistoryEntry): string {
  const time = historyTime(entry.updatedAt)
  return time ? `${formatBytes(entry.size, t)} · ${time}` : formatBytes(entry.size, t)
}

/** 历史条目操作：下载完成 → 打开所在位置；发起方失败/被拒/中断且可重试 → 重试
 *（终态归档历史后，重试入口从发送列表迁到历史） */
function historyActions(entry: HistoryEntry): TaskAction[] {
  const btns: TaskAction[] = []
  if (entry.direction === 'download' && entry.state === 'completed') {
    btns.push({
      kind: 'open-location',
      label: t('transfer.v2.history.openFolder'),
      variant: 'tint',
    })
  }
  if (
    entry.retryable &&
    (entry.state === 'failed' || entry.state === 'rejected' || entry.state === 'interrupted')
  ) {
    btns.push({ kind: 'retry', label: t('transfer.task.retry'), variant: 'tint' })
  }
  return btns
}

/** 操作分发：kind → 对应 emit */
function onCardAction(kind: TaskAction['kind'], id: string): void {
  switch (kind) {
    case 'cancel':
      emit('cancel', id)
      break
    case 'retry':
      emit('retry', id)
      break
    case 'pause':
      emit('pause', id)
      break
    case 'resume':
      emit('resume', id)
      break
    case 'cancel-receiving':
      emit('cancel-receiving', id)
      break
    case 'clear-history':
      emit('clear-history')
      break
    case 'open-location':
      emit('open-location', id)
      break
  }
}
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col">
    <!-- 分段控件：四等分占满整宽（全部 / 发送 / 接收 / 历史），滑块指示当前段。
         计数只在 >0 时渲染，tabular-nums 防宽度跳动 -->
    <div class="fv2-seg-wrap">
      <div class="fv2-seg" role="tablist" :aria-label="t('transfer.queue.title')">
        <span class="fv2-seg-indicator" :style="indicatorStyle" aria-hidden="true"></span>
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          role="tab"
          class="fv2-seg-btn"
          :class="{ 'fv2-seg-btn--active': filter === f.key }"
          :aria-selected="filter === f.key"
          :aria-pressed="filter === f.key"
          :data-testid="`mobile-ft-filter-${f.key}`"
          @click="filter = f.key"
        >
          <span class="fv2-seg-label">{{ t(f.labelKey) }}</span>
          <span v-if="f.count > 0" class="fv2-seg-count">{{ f.count }}</span>
        </button>
      </div>
    </div>

    <!-- 全部继续（存在已暂停任务时；独立操作按钮） -->
    <div v-if="hasPaused(tasks)" class="fv2-resume-all">
      <button type="button" class="fv2-resume-all-btn" @click="emit('resumeAll')">
        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"
          />
        </svg>
        {{ t('transfer.task.resumeAll') }}
      </button>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto overscroll-behavior-none px-4 pb-2">
      <!-- 全部 / 发送 / 接收：活动传输区（全部 = 发送队列 ∪ 接收中）。
           TransitionGroup：卡片错峰浮入 + 列表变化平滑让位（样式见 styles.css
           .fv2-card-in-*；--card-i 为错峰索引，第 7 张起不再递增避免长列表久等） -->
      <template v-if="filter !== 'history'">
        <div v-if="listEmpty" class="h-full flex flex-col">
          <!-- 空态主 CTA：发送文件（有活跃对端才可点；无对端引导走探索连接） -->
          <EmptyState
            :icon="emptyIcon"
            :title="emptyTitle"
            :hint="t('transfer.minibar.noActive')"
            :action-label="canUpload ? uploadLabel : undefined"
            action-icon="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            action-variant="primary"
            @action="emit('upload')"
          />
        </div>
        <TransitionGroup v-else tag="div" name="fv2-card-in" appear class="flex flex-col">
          <TaskCard
            v-for="(task, i) in visibleQueue"
            :id="task.id"
            :key="task.id"
            :style="{ '--card-i': Math.min(i, 6) }"
            :direction="task.direction"
            :name="basename(task.remotePath)"
            :meta="taskMeta(task)"
            :state-label="taskStateLabel(task)"
            :state-class="TASK_STATE_COLOR_CLASS[task.state]"
            :progress="taskProgress(task)"
            :progress-class="TASK_STATE_PROGRESS_CLASS[task.state]"
            :reason="taskReason(task)"
            :hint="taskHint(task)"
            :actions="taskActions(task)"
            @action="onCardAction"
          />
          <TaskCard
            v-for="(task, i) in receivingCards"
            :id="task.sessionId"
            :key="task.sessionId"
            :style="{ '--card-i': Math.min(i, 6) }"
            direction="download"
            :name="basename(task.remotePath)"
            :meta="
              task.size > 0
                ? `${formatBytes(task.offset ?? 0, t)} / ${formatBytes(task.size, t)}`
                : formatBytes(task.size, t)
            "
            :state-label="t(receivingStateKey(task))"
            :state-class="receivingStateClass(task)"
            :progress="
              RECEIVING_TERMINAL.has(task.state)
                ? null
                : (progressPercent(task.offset ?? 0, task.size) ?? null)
            "
            progress-class="ft-progress-active"
            :indeterminate="
              (task.state === 'running' || task.state === 'transferring') &&
              (task.offset ?? 0) === 0
            "
            :reason="receivingReason(task)"
            :actions="receivingActions(task)"
            @action="onCardAction"
          />
        </TransitionGroup>
      </template>

      <!-- 历史：只读 + 清空 -->
      <template v-else>
        <div v-if="history.length === 0" class="h-full flex flex-col">
          <EmptyState :icon="emptyIcon" :title="emptyTitle" />
        </div>
        <template v-else>
          <div class="flex justify-end pb-1">
            <button class="fv2-btn-text" @click="emit('clear-history')">
              <svg
                class="w-4 h-4 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              {{ t('transfer.history.clear') }}
            </button>
          </div>
          <TransitionGroup tag="div" name="fv2-card-in" appear class="flex flex-col">
            <TaskCard
              v-for="(entry, i) in history"
              :id="entry.id"
              :key="entry.id"
              :style="{ '--card-i': Math.min(i, 6) }"
              :direction="entry.direction"
              :name="entry.fileName"
              :meta="historyMeta(entry)"
              :state-label="t(historyStateKey(entry.state))"
              :state-class="historyStateClass(entry.state)"
              :progress="null"
              :reason="historyReason(entry)"
              :actions="historyActions(entry)"
              @action="onCardAction"
            />
          </TransitionGroup>
        </template>
      </template>
    </div>
  </div>
</template>
