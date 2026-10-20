<script setup lang="ts">
/**
 * BedCode 多任务卡片只读预览面（`mountPreview` 契约 · apps 仓 spec 2026-10-20）
 *
 * 应用在宿主多任务卡片的缩略区**自绘**一张点时刻的只读摘要：当前 / 最近会话
 * 标题、运行状态、工作区路径、并行会话列表；无会话 / 命令失败 → 诚实空态。
 *
 * 边界（宿主 spec D2 / D4 / D11）：
 * - 只用 `env.appInvoke` 的**只读**面调两条既有命令：`session.list`（运行态视图）
 *   与 `session.config.list`（工作区配置），不新增命令 / 权限位；
 * - 不写存储、不发事件、不订阅、无定时器 / 轮询 / 全局监听；不启动会话、不开终端
 *   窗口、不弹通知；
 * - 挂载即先出骨架（`loading`），数据在 `onMounted` 里异步取一次 —— `mountPreview`
 *   因此能立刻返回 handle，慢命令不会把整张卡拖成宿主 3s 超时回退；
 * - 不碰主 `App.vue` / 主 router / 主 pinia / 模块级 `vueApp`：当前前台应用的卡
 *   也会挂预览，预览实例必须与主实例并存而不互相踩；
 * - DOM 内无任何可聚焦控件（`button` / `a[href]` / `input` / `select` /
 *   `textarea` / 可 tab 元素），交互全部由外层卡片覆盖层承接；
 * - 卸载置 `disposed` 标志，晚到的命令结果不再写状态。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import type { AppPreviewEnv } from '../entry'

const props = defineProps<{ env: AppPreviewEnv }>()

/** 缩略摘要最多展示的会话行数（预览不是完整应用） */
const MAX_ROWS = 3

/** wire 条目里只读消费的字段（插件命令 channel 的 camelCase 形状） */
interface WireSession {
  id?: unknown
  configId?: unknown
  name?: unknown
  status?: unknown
  startedAt?: unknown
  createdAt?: unknown
}

interface WireConfig {
  id?: unknown
  workingDir?: unknown
}

interface PreviewSession {
  id: string
  name: string
  status: string
  configId: string
}

type PreviewState = 'loading' | 'ready' | 'empty' | 'unavailable'

const state = ref<PreviewState>('loading')
const sessions = ref<PreviewSession[]>([])
const workspaceDirs = ref<Record<string, string>>({})

/** 卸载后晚到的异步结果一律丢弃（不对已卸载卡片写状态） */
let disposed = false

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 运行中口径与主界面 `isRunningStatus` 同源：只有 stopped / error 不算运行中 */
function isRunning(status: string): boolean {
  return status !== 'stopped' && status !== 'error'
}

/** `session.list` → 只保留预览需要的字段（不引入主 composables） */
function mapSessions(raw: unknown): PreviewSession[] {
  const list =
    raw && typeof raw === 'object' ? (raw as { sessions?: unknown }).sessions : undefined
  if (!Array.isArray(list)) return []
  const out: PreviewSession[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const session = entry as WireSession
    const id = asString(session.id)
    if (!id) continue
    out.push({
      id,
      name: asString(session.name).trim() || id.slice(0, 8),
      status: asString(session.status) || 'unknown',
      configId: asString(session.configId),
    })
  }
  return out
}

/** `session.config.list` → session.configId → 工作区路径（预览只读工作区状态） */
function mapWorkspaceDirs(raw: unknown): Record<string, string> {
  const list = Array.isArray(raw) ? raw : []
  const out: Record<string, string> = {}
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const config = entry as WireConfig
    const id = asString(config.id)
    const dir = asString(config.workingDir)
    if (id && dir) out[id] = dir
  }
  return out
}

/** `lastRoute` 末段若恰好是会话 id（终端窗口深链），视为用户上次停留的会话 */
function sessionIdFromRoute(route: string | undefined): string {
  if (!route) return ''
  const tail = route.split(/[?#]/)[0].split('/').filter(Boolean).pop()
  return tail ?? ''
}

/** 展示序：运行中的在前，其余按启动 / 创建时间倒序（点时刻快照，不轮询） */
function rankOf(session: PreviewSession): number {
  return isRunning(session.status) ? 0 : 1
}

const rows = computed<PreviewSession[]>(() =>
  [...sessions.value].sort((a, b) => rankOf(a) - rankOf(b)).slice(0, MAX_ROWS),
)

/** 当前会话：lastRoute 点名优先，否则第一条运行中（= 用户最可能在看的那个） */
const current = computed<PreviewSession | null>(() => {
  const routedId = sessionIdFromRoute(props.env.lastRoute)
  if (routedId) {
    const hit = sessions.value.find((s) => s.id === routedId)
    if (hit) return hit
  }
  return sessions.value.find((s) => isRunning(s.status)) ?? sessions.value[0] ?? null
})

const runningCount = computed(() => sessions.value.filter((s) => isRunning(s.status)).length)

/** 当前会话的工作区路径（配置缺失就不显示，不编造） */
const currentWorkspace = computed(() => {
  const configId = current.value?.configId
  return configId ? (workspaceDirs.value[configId] ?? '') : ''
})

/** 状态文案：复用主界面同一套 `session.status.*`（不新增业务词汇） */
function statusKey(status: string): string {
  if (status === 'running') return 'session.status.running'
  if (status === 'waitingInput') return 'session.status.asking'
  if (status === 'starting') return 'session.status.starting'
  if (status === 'error') return 'session.status.error'
  if (status === 'stopped') return 'session.status.stopped'
  if (status === 'idle') return 'session.preview.status.idle'
  if (status === 'stopping') return 'session.preview.status.stopping'
  return 'session.status.unknown'
}

function statusLabel(status: string): string {
  return t(statusKey(status))
}

/** 状态色档（CSS 按 data-status 取 token；未知态用中性色） */
function statusTone(status: string): string {
  if (status === 'running') return 'running'
  if (status === 'waitingInput') return 'waiting'
  if (status === 'starting' || status === 'stopping') return 'busy'
  if (status === 'error') return 'error'
  if (status === 'stopped' || status === 'idle') return 'idle'
  return 'unknown'
}

const lastRouteLabel = computed(() =>
  props.env.lastRoute ? t('session.preview.lastRoute', { path: props.env.lastRoute }) : '',
)

/**
 * 一次性只读取数（点时刻，不轮询）。
 * 任一命令失败 → `unavailable` 诚实空态；本函数不抛错、不弹 toast。
 */
async function load(): Promise<void> {
  try {
    const rawSessions = await props.env.appInvoke<unknown>('session.list', {})
    if (disposed) return
    const list = mapSessions(rawSessions)
    if (list.length === 0) {
      sessions.value = []
      state.value = 'empty'
      return
    }
    sessions.value = list

    // 工作区路径只是附加信息：配置读失败不让整张卡变「不可用」
    try {
      const rawConfigs = await props.env.appInvoke<unknown>('session.config.list', {})
      if (disposed) return
      workspaceDirs.value = mapWorkspaceDirs(rawConfigs)
    } catch (e) {
      if (disposed) return
      console.warn('[BedCode] Preview workspace unavailable:', e)
    }

    state.value = 'ready'
  } catch (e) {
    if (disposed) return
    state.value = 'unavailable'
    // 预览是识别辅助，不是功能闸门：失败只留日志，不弹窗、不影响卡片打开
    console.warn('[BedCode] Preview data unavailable:', e)
  }
}

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <div
    class="bc-preview"
    :data-state="state"
    :data-theme="env.theme === 'light' ? 'light' : 'dark'"
    :data-locale="env.locale"
  >
    <div class="bc-preview__head">
      <div class="bc-preview__eyebrow">{{ t('session.preview.eyebrow') }}</div>

      <div v-if="state === 'ready' && current" class="bc-preview__title">
        {{ current.name }}
      </div>
      <div v-else-if="state === 'loading'" class="bc-preview__title-bone" />

      <div v-if="state === 'ready' && current" class="bc-preview__status-row">
        <span class="bc-preview__status" :data-status="statusTone(current.status)">
          {{ statusLabel(current.status) }}
        </span>
        <span v-if="runningCount" class="bc-preview__count">
          {{ t('session.preview.runningCount', { count: runningCount }) }}
        </span>
      </div>

      <div v-if="state === 'ready' && currentWorkspace" class="bc-preview__workspace">
        <span class="bc-preview__label">{{ t('session.preview.workspace') }}</span>
        <span class="bc-preview__path">{{ currentWorkspace }}</span>
      </div>
    </div>

    <div class="bc-preview__body">
      <!-- 骨架：mountPreview 立刻返回，数据晚到再替换 -->
      <div v-if="state === 'loading'" class="bc-preview__skeleton">
        <span v-for="i in 3" :key="i" class="bc-preview__bone" />
      </div>

      <!-- 诚实空态：还没有会话 / 数据不可用 -->
      <div v-else-if="state === 'empty'" class="bc-preview__empty">
        <div class="bc-preview__empty-title">{{ t('session.preview.empty') }}</div>
        <div class="bc-preview__empty-hint">{{ t('session.preview.emptyHint') }}</div>
      </div>

      <div v-else-if="state === 'unavailable'" class="bc-preview__empty">
        <div class="bc-preview__empty-title">{{ t('session.preview.unavailable') }}</div>
      </div>

      <ul v-else class="bc-preview__rows">
        <li v-for="row in rows" :key="row.id" class="bc-preview__row">
          <span class="bc-preview__dot" :data-status="statusTone(row.status)" />
          <span class="bc-preview__row-name">{{ row.name }}</span>
          <span class="bc-preview__row-status">{{ statusLabel(row.status) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="state === 'ready' && lastRouteLabel" class="bc-preview__foot">
      {{ lastRouteLabel }}
    </div>
  </div>
</template>

<style scoped>
/* 填满宿主卡片缩略容器；预览是装饰层，不接收任何指针事件 / 文本选择 */
.bc-preview {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100%;
  overflow: hidden;
  contain: layout paint;
  padding: 14px 16px;
  pointer-events: none;
  user-select: none;
  text-align: left;
  background: var(--bg-page, #f5f4f0);
  color: var(--text-primary, #26231b);
}

.bc-preview__head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.bc-preview__eyebrow {
  font-size: var(--font-size-xs, 9px);
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary, #736b58);
}

.bc-preview__title {
  font-size: var(--font-size-lg, 14px);
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary, #26231b);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.bc-preview__title-bone,
.bc-preview__bone {
  display: block;
  border-radius: var(--radius-tag, 6px);
  background: var(--bg-hover, #e7e4dc);
}

.bc-preview__title-bone {
  width: 58%;
  height: 14px;
}

.bc-preview__status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.bc-preview__status {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border, #e4e1d8);
  font-size: var(--font-size-xs, 9px);
  line-height: 1.5;
  color: var(--text-secondary, #5e584c);
}

.bc-preview__status[data-status='running'] {
  border-color: color-mix(in srgb, var(--color-success, #2f7d4f) 42%, transparent);
  color: var(--color-success-ink, var(--color-success, #2f7d4f));
}

.bc-preview__status[data-status='waiting'],
.bc-preview__status[data-status='busy'] {
  border-color: color-mix(in srgb, var(--color-warning, #9a6a12) 42%, transparent);
  color: var(--color-warning-ink, var(--color-warning, #9a6a12));
}

.bc-preview__status[data-status='error'] {
  border-color: color-mix(in srgb, var(--color-danger, #a3342c) 42%, transparent);
  color: var(--color-danger-ink, var(--color-danger, #a3342c));
}

.bc-preview__count {
  font-size: var(--font-size-xs, 9px);
  color: var(--text-tertiary, #736b58);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bc-preview__workspace {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.bc-preview__label {
  flex-shrink: 0;
  font-size: var(--font-size-xs, 9px);
  color: var(--text-tertiary, #736b58);
}

.bc-preview__path {
  font-family: var(--font-mono, monospace);
  font-size: var(--font-size-xs, 9px);
  line-height: 1.3;
  color: var(--text-secondary, #5e584c);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bc-preview__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.bc-preview__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bc-preview__skeleton .bc-preview__bone {
  height: 40px;
  opacity: 0.7;
}

.bc-preview__empty {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  text-align: center;
}

.bc-preview__empty-title {
  font-size: var(--font-size-base, 12px);
  font-weight: 500;
  line-height: 1.35;
  color: var(--text-secondary, #5e584c);
}

.bc-preview__empty-hint {
  font-size: var(--font-size-xs, 9px);
  line-height: 1.4;
  color: var(--text-tertiary, #736b58);
}

.bc-preview__rows {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
}

.bc-preview__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
  min-height: 0;
  padding: 9px 10px;
  border: 1px solid var(--border, #e4e1d8);
  border-radius: var(--radius-button, 8px);
  background: var(--bg-card, #fdfcfa);
}

.bc-preview__dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary, #736b58);
}

.bc-preview__dot[data-status='running'] {
  background: var(--color-success, #2f7d4f);
}

.bc-preview__dot[data-status='waiting'],
.bc-preview__dot[data-status='busy'] {
  background: var(--color-warning, #9a6a12);
}

.bc-preview__dot[data-status='error'] {
  background: var(--color-danger, #a3342c);
}

.bc-preview__row-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--font-size-base, 12px);
  line-height: 1.4;
  color: var(--text-primary, #26231b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bc-preview__row-status {
  flex-shrink: 0;
  font-size: var(--font-size-xs, 9px);
  color: var(--text-tertiary, #736b58);
}

.bc-preview__foot {
  flex-shrink: 0;
  font-size: var(--font-size-xs, 9px);
  line-height: 1.3;
  color: var(--text-tertiary, #736b58);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 深色主题：卡片表面再提一档（与主界面同一色板变量；不做全局选择器） */
.bc-preview[data-theme='dark'] .bc-preview__row {
  background: color-mix(in srgb, var(--bg-card, #232220) 88%, #ffffff 12%);
}
</style>
