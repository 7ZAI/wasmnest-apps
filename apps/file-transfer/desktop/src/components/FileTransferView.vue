<script setup lang="ts">
/**
 * FileTransferView — 文件传输双栏工作台（host-peer 契约版）
 *
 * 顶栏（对端 pill + 发送/下载所选/刷新/设置）+ 左栏 RemoteFileTable
 * （对端共享根 → 根内目录两级浏览）+ 右栏 TaskPanel（批级队列）。
 * 发送 = 系统选择器多选直发；接收 = 浏览勾选拉取；设备列表由
 * devices-changed 事件驱动。
 */
import { ref, computed, watch, inject, onMounted, onUnmounted } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import RemoteFileTable from './RemoteFileTable.vue'
import TaskPanel from './TaskPanel.vue'
import SettingsPanel from './SettingsPanel.vue'
import PeerDevicesPanel from './PeerDevicesPanel.vue'
import BatchRequestDialog from './BatchRequestDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useTasks } from '../composables/useTasks'
import { useReceiving } from '../composables/useReceiving'
import { useRemoteFs } from '../composables/useRemoteFs'
import { useSettings } from '../composables/useSettings'
import { usePeerDevices } from '../composables/usePeerDevices'
import { useBatchPrompt } from '../composables/useBatchPrompt'
import { toast } from 'vue-sonner'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const {
  rows: deviceRows,
  peers,
  peer,
  connectedIds,
  connect: connectDevice,
  disconnect: disconnectDevice,
  switchPeer,
  refresh: refreshDevices,
  start: startPeer,
  stop: stopPeer,
} = usePeerDevices(context)
const {
  tasks,
  totalSpeed,
  refresh: refreshTasks,
  sendPickedFiles,
  cancel,
  retry,
  pause,
  resume,
  resumeAll,
  start: startTasks,
  stop: stopTasks,
} = useTasks(context)
const {
  batches,
  receiving,
  history,
  toasts,
  approveBatch,
  rejectBatch,
  cancelReceiving,
  clearHistory: clearHistoryEntries,
  dismissToast,
  start: startReceiving,
  stop: stopReceiving,
} = useReceiving(context)
const {
  settings,
  rootItems,
  hasRoots,
  load: loadSettings,
  addRoot,
  removeRoot,
  pickDownloadDir,
  setReceivingPolicy,
  setApprovalTimeoutSec,
  setEncryption,
  setConcurrency,
} = useSettings(context)
/** 插件自身对等连接：存在任一已建立的对等连接（≠ 宿主主连接） */
const peerConnected = computed(() => connectedIds.value.size > 0)

const fs = useRemoteFs(context, () => peer.value.id)

const showSettings = ref(false)

/** 传输队列面板是否展开 */
const queueVisible = ref(false)

/** 对端显示名 */
const peerDisplayName = computed(() => {
  if (peer.value.name) return peer.value.name
  const withName = tasks.value.find((x) => x.peer?.name)
  if (withName?.peer?.name) return withName.peer.name
  if (peer.value.id) return peer.value.id
  if (peerConnected.value) return '—'
  return t('transfer.peer.unpaired')
})

const selectedCount = computed(() => fs.selectedNames.value.length)

/** 队列合计速率：发送方向 + 接收方向（下载中接收任务同样计入） */
const panelTotalSpeed = computed(
  () => totalSpeed.value + receiving.value.reduce((sum, r) => sum + (r.rateBps ?? 0), 0),
)

/** 对端名映射（peerId → 展示名，批卡/接收任务展示用） */
const peerNames = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const p of peers.value) map[p.id] = p.name || p.id
  for (const tk of tasks.value) {
    if (tk.peer?.deviceId && tk.peer.name && !map[tk.peer.deviceId]) {
      map[tk.peer.deviceId] = tk.peer.name
    }
  }
  return map
})

/** 批请求应答：批准成功才弹出传输队列展示接收任务（失败无副作用，不误开队列） */
async function handleBatchApprove(batchId: string): Promise<boolean> {
  const ok = await approveBatch(batchId)
  if (ok) queueVisible.value = true
  return ok
}
function handleBatchReject(batchId: string): Promise<boolean> {
  return rejectBatch(batchId)
}

const peerStatusLabel = computed(() => {
  if (!peerConnected.value) return t('transfer.peer.offline')
  if (!peer.value.online) return t('transfer.peer.notSharing')
  return t('transfer.peer.online')
})

/** 主下载按钮可用性：当前处于共享根内且有勾选 */
const canDownload = computed(() => fs.currentRoot.value !== null && selectedCount.value > 0)

/** 空态分支优先级：共享目录 → 对端 */
const showNoRoots = computed(() => !hasRoots.value)
const showNoPeer = computed(() => !peer.value.online)
const noPeerLabel = computed(() =>
  peerConnected.value ? t('transfer.peer.notSharing') : t('transfer.empty.noPeer'),
)

/** 拉取所选文件（一次 pull_files 批调用）；成功后展开队列面板 */
async function handleDownload(): Promise<void> {
  if (!canDownload.value || !fs.currentRoot.value) return
  try {
    await context.commands.execute('file-transfer.pull-files', {
      dirId: fs.currentRoot.value.id,
      // 当前所在根内相对路径：嵌套目录勾选下载必须带上，否则对端按根目录
      // 解析文件名 → not-found（根清单层不可勾选，relPath 恒有 currentRoot 伴生）
      path: fs.relPath.value,
      files: fs.selectedNames.value,
    })
    fs.clearSelection()
    queueVisible.value = true
  } catch (e) {
    console.error('[File Transfer] pull-files failed:', e)
  }
}

/** 顶栏刷新：任务 + 当前目录层级 + 设备缓存清扫 */
async function handleRefresh(): Promise<void> {
  await Promise.all([refreshTasks(), fs.refresh(), refreshDevices()])
}

/** 发送到手机：系统多文件选择器直发活跃对端（失败 → 友好 toast，原文只进日志） */
async function handleUpload(): Promise<void> {
  if (!peer.value.online) return
  const r = await sendPickedFiles()
  if (r.error) {
    toast.error(r.error)
    return
  }
  if (r.sent > 0) queueVisible.value = true
}

/** 下载完成 → 打开本地所在目录（插件自有命令 → 宿主原语 host-platform.reveal-in-dir） */
async function handleOpenFolder(path: string): Promise<void> {
  try {
    await context.commands.execute('file-transfer.reveal-in-dir', { path })
  } catch (e) {
    console.error('[File Transfer] open folder failed:', e)
  }
}

/** 附近设备面板开合（点击外部关闭，见 onMounted 文档监听） */
const devPanelOpen = ref(false)
const devPanelWrap = ref<HTMLElement | null>(null)

/** 已连接设备数（顶栏入口角标语义：可互传的设备数） */
const connectedCount = computed(
  () => deviceRows.value.filter((r) => r.status === 'connected').length,
)

function handleConnectDevice(nodeId: string): void {
  void connectDevice(nodeId)
}

function handleDisconnectDevice(nodeId: string): void {
  void disconnectDevice(nodeId)
}

/** 探索发现进行中（面板扫描按钮 spinner 态） */
const deviceScanning = ref(false)

/** 探索发现：重新拉取发现快照（query-peer），完成后恢复按钮态 */
async function handleScanDevices(): Promise<void> {
  if (deviceScanning.value) return
  deviceScanning.value = true
  try {
    await refreshDevices()
  } finally {
    deviceScanning.value = false
  }
}

async function handleSetActiveDevice(nodeId: string): Promise<void> {
  await switchPeer(nodeId)
}

/** 点击面板外部时收起（capture 阶段拦截，避免先触发内部点击） */
function handleDocClick(e: MouseEvent): void {
  if (!devPanelOpen.value) return
  if (devPanelWrap.value && !devPanelWrap.value.contains(e.target as Node)) {
    devPanelOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocClick, true)
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocClick, true)
})

onMounted(async () => {
  startPeer()
  startTasks()
  startReceiving()
  await Promise.all([loadSettings(), refreshTasks()])
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocClick, true)
  stopPeer()
  stopTasks()
  stopReceiving()
})

/** 激活设备变化驱动目录加载/清空 */
watch(
  () => peer.value.id,
  (id) => {
    if (id) {
      void fs.loadRoots()
    } else {
      fs.reset()
    }
  },
)

// ==================== 传入批请求弹窗（挂载包自持渲染） ====================

/**
 * 待确认批提示：useBatchPrompt 选择当前批（按创建时间先到先弹；超时批由
 * 宿主 TTL 结算后不再重复）。弹窗由 BatchRequestDialog 自持渲染——旧宿主
 * 全局弹窗（context.ui.showDialog）已随挂载包形态退役。
 */
const prompt = useBatchPrompt(batches)
/** 模板直接消费的当前批（顶层 ref 自动解包） */
const currentBatch = prompt.current
const batchTimeoutMs = computed(() => settings.value.approvalTimeoutSec * 1000)

async function acceptCurrentBatch(): Promise<void> {
  const cur = prompt.current.value
  if (!cur) return
  // 成功才标记已提示（失败保留弹窗可重试；批仍在宿主 pending 表内）
  if (await handleBatchApprove(cur.batchId)) prompt.markAnswered()
}

async function rejectCurrentBatch(): Promise<void> {
  const cur = prompt.current.value
  if (!cur) return
  if (await handleBatchReject(cur.batchId)) prompt.markAnswered()
}

/** 清空历史二次确认（破坏性操作，确认框自持渲染） */
const showClearHistoryConfirm = ref(false)

function handleClearHistoryConfirm(): void {
  showClearHistoryConfirm.value = false
  void clearHistoryEntries()
}
</script>

<template>
  <div class="ft-view" data-testid="ft-view">
    <!-- 顶栏 -->
    <div class="ft-topbar">
      <div class="ft-peer-pill">
        <span
          class="ft-dot"
          :class="
            peerConnected ? (peer.online ? 'ft-dot--online' : 'ft-dot--partial') : 'ft-dot--offline'
          "
        ></span>
        <span class="ft-peer-name">{{ peerDisplayName }}</span>
        <span class="ft-peer-meta" data-testid="ft-peer-status" :data-online="peer.online">
          {{ peerStatusLabel }}
        </span>
      </div>
      <!-- 附近设备面板：三态连接管理（自绘，禁原生 select；点击外部收起） -->
      <div ref="devPanelWrap" class="ft-peer-switch-wrap">
        <button
          class="ft-btn ft-peer-switch-btn"
          :class="{ 'ft-peer-switch-btn--open': devPanelOpen }"
          :title="t('transfer.peer.switchTitle')"
          data-testid="ft-peer-switch"
          @click="devPanelOpen = !devPanelOpen"
        >
          <svg
            class="w-3.5 h-3.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <span class="ft-btn-text">{{ connectedCount }}</span>
        </button>
        <Transition name="ft-drop">
          <PeerDevicesPanel
            v-if="devPanelOpen"
            :rows="deviceRows"
            :scanning="deviceScanning"
            data-testid="ft-peer-panel"
            @connect="handleConnectDevice"
            @disconnect="handleDisconnectDevice"
            @set-active="handleSetActiveDevice"
            @scan="handleScanDevices"
          />
        </Transition>
      </div>
      <div class="ft-spacer"></div>
      <button
        class="ft-btn"
        :disabled="!peer.online"
        :title="t('transfer.topbar.sendToPhone')"
        data-testid="ft-upload"
        @click="handleUpload"
      >
        <svg class="ft-ico-btn" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
          />
        </svg>
        <span class="ft-btn-text">{{ t('transfer.topbar.sendToPhone') }}</span>
      </button>
      <button
        class="ft-btn ft-btn--primary"
        :disabled="!canDownload"
        data-testid="ft-download"
        @click="handleDownload"
      >
        <svg class="ft-ico-btn" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
          />
        </svg>
        <span class="ft-btn-text">{{
          t('transfer.topbar.downloadSelected', { count: selectedCount })
        }}</span>
      </button>
      <button
        class="ft-btn"
        :disabled="!peer.online"
        :title="t('transfer.topbar.refresh')"
        data-testid="ft-refresh"
        @click="handleRefresh"
      >
        <svg class="ft-ico-btn" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M23 4v6h-6M1 20v-6h6"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"
          />
        </svg>
        <span class="ft-btn-text">{{ t('transfer.topbar.refresh') }}</span>
      </button>
      <!-- 传输队列开关：面板默认收起，点击展开/收起（带任务数角标） -->
      <button
        class="ft-btn"
        :class="{ 'ft-btn--queue-open': queueVisible }"
        :title="t('transfer.queue.title')"
        data-testid="ft-queue"
        @click="queueVisible = !queueVisible"
      >
        <svg class="ft-ico-btn" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 7h16M4 12h16M4 17h10"
          />
        </svg>
        <span class="ft-btn-text">{{ t('transfer.queue.title') }}</span>
        <span
          v-if="tasks.length > 0"
          class="ft-queue-count"
          :title="t('transfer.queue.count', { count: tasks.length })"
        >
          {{ tasks.length }}
        </span>
      </button>
      <button
        class="ft-btn"
        :title="t('transfer.topbar.settings')"
        data-testid="ft-settings"
        @click="showSettings = true"
      >
        <svg class="ft-ico-btn" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"
          />
        </svg>
        <span class="ft-btn-text">{{ t('transfer.topbar.settings') }}</span>
      </button>
    </div>

    <!-- 双栏工作台：左栏随状态切换（空态提示 / 文件表格）；右栏传输队列默认收起，顶栏按钮展开 -->
    <div class="ft-main" :class="{ 'ft-main--queue': queueVisible }">
      <!-- 页面切换：空态 ↔ 工作台交叉过渡（过渡类与效果变体由宿主 src/style.css 统一
           提供，本插件不再自带 .ft-page-*）。page-swap 必须单独占一格：.ft-main 是两列
           grid，若把定位上下文标在 .ft-main 上，退场的绝对定位层会脱离网格导致队列面板
           串到第一列。 -->
      <div class="page-swap">
        <Transition name="page">
          <!-- 空态：未配置共享目录 -->
          <div v-if="showNoRoots" class="ft-empty">
            <div class="ft-empty-ico">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"
                />
              </svg>
            </div>
            <div class="ft-empty-title">{{ t('transfer.empty.noRoots') }}</div>
            <div class="ft-empty-desc">{{ t('transfer.empty.noRootsHint') }}</div>
            <button class="ft-btn ft-btn--primary ft-empty-action" @click="showSettings = true">
              {{ t('transfer.topbar.settings') }}
            </button>
          </div>

          <!-- 空态：对端未连接 / 已连接但未共享 -->
          <div v-else-if="showNoPeer" class="ft-empty">
            <div class="ft-empty-ico">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="2" width="12" height="20" rx="2" ry="2" />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M11 18h2"
                />
              </svg>
            </div>
            <div class="ft-empty-title">{{ noPeerLabel }}</div>
            <div class="ft-empty-desc">{{ t('transfer.empty.noPeerHint') }}</div>
          </div>

          <!-- 空态：未设置下载目录 -->
          <div v-else-if="settings.downloadDir === ''" class="ft-empty">
            <div class="ft-empty-ico">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M12 3v12M5 12l7 7 7-7"
                />
              </svg>
            </div>
            <div class="ft-empty-title">{{ t('transfer.empty.noDownloadDir') }}</div>
            <div class="ft-empty-desc">{{ t('transfer.empty.noDownloadDirHint') }}</div>
            <button class="ft-btn ft-btn--primary ft-empty-action" @click="showSettings = true">
              {{ t('transfer.topbar.settings') }}
            </button>
          </div>

          <!-- 工作态：远端文件表格 -->
          <div v-else class="ft-browse">
            <RemoteFileTable
              :entries="fs.entries.value"
              :loading="fs.loading.value"
              :error-key="fs.errorKey.value"
              :breadcrumb="fs.breadcrumb.value"
              :selected-names="fs.selectedNames.value"
              @enter="fs.cd"
              @navigate="fs.goTo"
              @toggle="fs.toggle"
              @toggle-all="fs.toggleAll"
            />
          </div>
        </Transition>
      </div>

      <!-- 传输队列：默认收起，顶栏「传输队列」按钮展开；随网格列宽同步滑入/滑出 -->
      <Transition name="ft-queue-panel">
        <TaskPanel
          v-if="queueVisible"
          :tasks="tasks"
          :total-speed="panelTotalSpeed"
          :receiving="receiving"
          :history="history"
          :peer-names="peerNames"
          :download-dir="settings.downloadDir"
          @cancel="cancel"
          @retry="retry"
          @pause="pause"
          @resume="resume"
          @resume-all="resumeAll"
          @cancel-receiving="cancelReceiving"
          @clear-history="showClearHistoryConfirm = true"
          @open-folder="handleOpenFolder"
          @close="queueVisible = false"
        />
      </Transition>
    </div>

    <!-- 入站批请求：宿主全局弹窗退役后由挂载包自持渲染（倒计时 + 批级应答） -->
    <BatchRequestDialog
      v-if="currentBatch"
      :key="currentBatch.batchId"
      :batch="currentBatch"
      :timeout-ms="batchTimeoutMs"
      @accept="acceptCurrentBatch"
      @reject="rejectCurrentBatch"
      @timeout="prompt.markTimeout()"
    />

    <!-- 清空历史确认（破坏性操作） -->
    <ConfirmDialog
      v-if="showClearHistoryConfirm"
      :title="t('transfer.history.clearConfirmTitle')"
      :message="t('transfer.history.clearConfirmBody')"
      :confirm-label="t('transfer.history.clear')"
      :cancel-label="t('transfer.task.cancel')"
      danger
      @confirm="handleClearHistoryConfirm"
      @cancel="showClearHistoryConfirm = false"
    />

    <!-- v2：接收中 toast（batch 立即弹；per-file 3s 窗口合并去重由 composable 处理） -->
    <Teleport to="body">
      <TransitionGroup name="ft-toast" tag="div" class="ft-toasts">
        <div v-for="toast in toasts" :key="toast.id" class="ft-toast">
          <svg class="ft-toast-ico" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 19V5M5 12l7-7 7 7"
            />
          </svg>
          <span class="ft-toast-text">
            {{ t('transfer.toast.receiving', { name: toast.name || '—', count: toast.count }) }}
          </span>
          <button
            class="ft-mini-btn ft-toast-close"
            :title="t('transfer.task.cancel')"
            @click="dismissToast(toast.id)"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M18 6L6 18M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </TransitionGroup>
    </Teleport>

    <!-- 设置覆盖层（淡入 + 上滑）。注：SettingsPanel 曾因 defineEmits 缺失调用
         括号（宏未被展开，运行时 ReferenceError）导致半初始化组件毒化本层
         Transition 的更新路径（locateNonHydratedAsyncRoot 遍历遇 null subTree
         抛错），覆盖层永不出现；宏修复后 Transition 工作正常 -->
    <Transition name="ft-settings">
      <SettingsPanel
        v-if="showSettings"
        :settings="settings"
        :root-items="rootItems"
        @add-root="addRoot"
        @remove-root="removeRoot"
        @pick-download-dir="pickDownloadDir"
        @set-receiving-policy="setReceivingPolicy"
        @set-approval-timeout-sec="setApprovalTimeoutSec"
        @set-encryption="setEncryption"
        @set-concurrency="setConcurrency"
        @close="showSettings = false"
      />
    </Transition>
  </div>
</template>
