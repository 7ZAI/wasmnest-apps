<script setup lang="ts">
/**
 * 多任务卡片只读预览面（mountPreview · 2026-10-20）
 *
 * 应用自绘的点时刻缩略摘要：最近可见对端 + 当前传输任务 / 速度。
 * 只读：仅经 `env.appInvoke` 调三条既有只读命令（get-device-snapshot /
 * list-tasks / list-receiving），不写存储、不发事件、不订阅、无定时器、
 * 不启动通知、不依赖主 AppRoot / router / pinia / 模块级单例。
 * 卡片缩略区是装饰层：DOM 内不得有可聚焦控件（交互归外层卡片覆盖按钮）。
 *
 * 数据拿不到 / 命令失败 → 诚实空态（暂无对端 / 暂无任务），不编造运行中内容。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppPreviewEnv } from '../entry'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import { formatBytes } from '../utils/format'

const props = defineProps<{ env: AppPreviewEnv }>()

const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})

/** 缩略摘要最多展示的行数（预览不是完整应用） */
const MAX_ROWS = 3

/** wire 条目里只读消费的字段（引擎 camelCase 形状；不引入主 composables） */
interface WireDeviceEntry {
  nodeId?: unknown
  deviceName?: unknown
}
interface WireTaskEntry {
  batchId?: unknown
  peerName?: unknown
  direction?: unknown
  status?: unknown
  files?: unknown
  totalBytes?: unknown
  transferredBytes?: unknown
  rateBps?: unknown
}

interface PreviewPeer {
  id: string
  name: string
}
interface PreviewTask {
  id: string
  name: string
  peerName: string
  stateKey: string
  rateBps: number
  percent: number
}

/** 活跃（非终态）任务状态：与主界面 useTasks / useReceiving 口径一致 */
const ACTIVE_STATES = new Set(['running', 'transferring', 'pending', 'paused'])

const loading = ref(true)
const peers = ref<PreviewPeer[]>([])
const tasks = ref<PreviewTask[]>([])

/** 卸载标志：晚到的命令结果直接丢弃，不再写响应式状态（无残留渲染） */
let disposed = false

const themeAttr = computed(() => (props.env.theme === 'light' ? 'light' : 'dark'))
const visiblePeers = computed(() => peers.value.slice(0, MAX_ROWS))
const morePeers = computed(() => Math.max(0, peers.value.length - visiblePeers.value.length))
const visibleTasks = computed(() => tasks.value.slice(0, MAX_ROWS))
const moreTasks = computed(() => Math.max(0, tasks.value.length - visibleTasks.value.length))
const activeCount = computed(() => tasks.value.length)
const totalSpeed = computed(() =>
  tasks.value.reduce(
    (sum, task) => (task.stateKey === 'transfer.task.state.transferring' ? sum + task.rateBps : sum),
    0,
  ),
)

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** `get-device-snapshot` → `{ devices: SnapshotEntry[] }`；只取身份 + 名称 */
function mapPeers(raw: unknown): PreviewPeer[] {
  const devices = raw && typeof raw === 'object' ? (raw as { devices?: unknown }).devices : undefined
  if (!Array.isArray(devices)) return []
  const out: PreviewPeer[] = []
  for (const entry of devices) {
    if (!entry || typeof entry !== 'object') continue
    const device = entry as WireDeviceEntry
    const id = asString(device.nodeId)
    if (!id) continue
    // 设备名缺失回退短 nodeId（与主界面 peerDisplayName 同口径）
    out.push({ id, name: asString(device.deviceName).trim() || id.slice(0, 8) })
  }
  return out
}

/** 展示名：首文件名（多文件追加 +N），与主界面任务卡同口径 */
function fileNameOf(files: unknown): string {
  const list = Array.isArray(files) ? files : []
  const first = list[0]
  const raw =
    first && typeof first === 'object'
      ? asString((first as { path?: unknown }).path) ||
        asString((first as { relativePath?: unknown }).relativePath)
      : ''
  if (!raw) return '—'
  const name = raw.split('/').filter(Boolean).pop() ?? raw
  const extra = Math.max(0, list.length - 1)
  return extra > 0 ? `${name} +${extra}` : name
}

/** send 方向 pending = 等待对端确认；receive 方向 pending = 待应答（预览不出现，兜底排队） */
function stateKeyOf(status: string, direction: string): string {
  if (status === 'running' || status === 'transferring') return 'transfer.task.state.transferring'
  if (status === 'pending') {
    return direction === 'send'
      ? 'transfer.task.state.awaitingPeer'
      : 'transfer.task.state.queued'
  }
  return 'transfer.task.state.paused'
}
function stateRank(stateKey: string): number {
  return stateKey === 'transfer.task.state.transferring' ? 0 : 1
}

/** `list-tasks` / `list-receiving` → 当前活跃任务（终态不进预览） */
function mapTasks(raw: unknown): PreviewTask[] {
  if (!Array.isArray(raw)) return []
  const out: PreviewTask[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const task = entry as WireTaskEntry
    const status = asString(task.status)
    if (!ACTIVE_STATES.has(status)) continue
    const total = asNumber(task.totalBytes)
    const done = asNumber(task.transferredBytes)
    out.push({
      id: asString(task.batchId) || `task-${out.length}`,
      name: fileNameOf(task.files),
      peerName: asString(task.peerName),
      stateKey: stateKeyOf(status, asString(task.direction)),
      rateBps: asNumber(task.rateBps),
      percent: total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : 0,
    })
  }
  return out.sort((a, b) => stateRank(a.stateKey) - stateRank(b.stateKey) || b.rateBps - a.rateBps)
}

/**
 * 点时刻取一次数据：三条只读命令并行，单个失败不拖垮其余；
 * 全部失败 → 空态（不抛错、不弹 toast）。
 */
async function load(): Promise<void> {
  const [snapshot, sendTasks, receivingTasks] = await Promise.allSettled([
    props.env.appInvoke('file-transfer.get-device-snapshot', {}),
    props.env.appInvoke('file-transfer.list-tasks', {}),
    props.env.appInvoke('file-transfer.list-receiving', {}),
  ])
  // 卸载后晚到：丢弃结果，不再写状态（无残留渲染 / 无未处理 rejection）
  if (disposed) return
  peers.value = snapshot.status === 'fulfilled' ? mapPeers(snapshot.value) : []
  const merged: PreviewTask[] = []
  if (sendTasks.status === 'fulfilled') merged.push(...mapTasks(sendTasks.value))
  if (receivingTasks.status === 'fulfilled') merged.push(...mapTasks(receivingTasks.value))
  tasks.value = merged
  loading.value = false
}

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <div class="ft-preview" :data-preview-theme="themeAttr">
    <header class="ft-preview-head">
      <span class="ft-preview-title">{{ t('transfer.sidebar.title') }}</span>
      <span v-if="activeCount > 0" class="ft-preview-chip">
        {{ t('transfer.summary.active', { count: activeCount }) }}
      </span>
    </header>

    <section class="ft-preview-block">
      <p class="ft-preview-block-title">{{ t('transfer.preview.peersTitle') }}</p>
      <p v-if="loading" class="ft-preview-hint">{{ t('transfer.table.loading') }}</p>
      <p v-else-if="peers.length === 0" class="ft-preview-hint">
        {{ t('transfer.preview.noPeers') }}
      </p>
      <ul v-else class="ft-preview-list">
        <li v-for="peer in visiblePeers" :key="peer.id" class="ft-preview-row">
          <span class="ft-preview-dot" aria-hidden="true" />
          <span class="ft-preview-row-name">{{ peer.name }}</span>
          <span class="ft-preview-row-meta">{{ t('transfer.devices.recentSeen') }}</span>
        </li>
        <li v-if="morePeers > 0" class="ft-preview-more">
          {{ t('transfer.preview.morePeers', { count: morePeers }) }}
        </li>
      </ul>
    </section>

    <section class="ft-preview-block ft-preview-block--grow">
      <div class="ft-preview-block-head">
        <p class="ft-preview-block-title">{{ t('transfer.preview.tasksTitle') }}</p>
        <span v-if="totalSpeed > 0" class="ft-preview-speed">
          {{ t('transfer.summary.speed', { speed: formatBytes(totalSpeed) }) }}
        </span>
      </div>
      <p v-if="loading" class="ft-preview-hint">{{ t('transfer.table.loading') }}</p>
      <p v-else-if="tasks.length === 0" class="ft-preview-hint">
        {{ t('transfer.task.empty') }}
      </p>
      <ul v-else class="ft-preview-list">
        <li v-for="task in visibleTasks" :key="task.id" class="ft-preview-task">
          <div class="ft-preview-task-line">
            <span class="ft-preview-task-name">{{ task.name }}</span>
            <span class="ft-preview-task-state">{{ t(task.stateKey) }}</span>
          </div>
          <div class="ft-preview-task-line ft-preview-task-line--meta">
            <span class="ft-preview-task-peer">{{ task.peerName }}</span>
            <span class="ft-preview-task-stats">
              <span>{{ task.percent }}%</span>
              <span v-if="task.rateBps > 0">{{ formatBytes(task.rateBps) }}/s</span>
            </span>
          </div>
          <div class="ft-preview-progress" aria-hidden="true">
            <span class="ft-preview-progress-bar" :style="{ width: `${task.percent}%` }" />
          </div>
        </li>
        <li v-if="moreTasks > 0" class="ft-preview-more">
          {{ t('transfer.preview.moreTasks', { count: moreTasks }) }}
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
/* 填满卡片缩略区；跟随宿主明暗主题（app 既有 CSS 变量），不写全局选择器 */
.ft-preview {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  overflow: hidden;
  background: var(--bg-page);
  color: var(--text-primary);
  font-size: var(--font-size-label);
  line-height: 1.5;
}

.ft-preview-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}

.ft-preview-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-body);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.ft-preview-chip {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: var(--radius-tag);
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--font-size-tag);
  white-space: nowrap;
}

.ft-preview-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.ft-preview-block--grow {
  flex: 1 1 auto;
  overflow: hidden;
}

.ft-preview-block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.ft-preview-block-title {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  font-size: var(--font-size-tag);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.ft-preview-speed {
  flex-shrink: 0;
  color: var(--color-primary);
  font-size: var(--font-size-tag);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ft-preview-hint {
  margin: 0;
  padding: 4px 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-tag);
}

.ft-preview-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  min-height: 0;
  overflow: hidden;
  list-style: none;
}

.ft-preview-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-tag);
  background: var(--bg-card);
}

.ft-preview-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
  /* 快照只证明「最近可见」，不宣称已连接（与主界面 reachable 同视觉） */
  opacity: 0.45;
}

.ft-preview-row-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ft-preview-row-meta {
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-tag);
  white-space: nowrap;
}

.ft-preview-more {
  padding-top: 1px;
  color: var(--text-tertiary);
  font-size: var(--font-size-tag);
}

.ft-preview-task {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-tag);
  background: var(--bg-card);
}

.ft-preview-task-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.ft-preview-task-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ft-preview-task-state {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-tag);
  white-space: nowrap;
}

.ft-preview-task-line--meta {
  color: var(--text-tertiary);
  font-size: var(--font-size-tag);
  font-variant-numeric: tabular-nums;
}

.ft-preview-task-peer {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ft-preview-task-stats {
  display: inline-flex;
  flex-shrink: 0;
  gap: 8px;
  white-space: nowrap;
}

.ft-preview-progress {
  height: 3px;
  border-radius: 2px;
  background: var(--bg-hover);
  overflow: hidden;
}

.ft-preview-progress-bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
}
</style>
