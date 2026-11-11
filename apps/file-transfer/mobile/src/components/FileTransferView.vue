<script setup lang="ts">
/**
 * FileTransferView — 文件传输主页面（底部导航三页 + 设置二级页）
 *
 * 布局（v3）：
 *   ┌──────────────────────────────────────┐
 *   │ AppHeader   页面标题 · 对端胶囊 · 发送 │
 *   ├──────────────────────────────────────┤
 *   │ 一级页面（可左右滑）                  │
 *   │   探索连接 / 浏览 / 传输               │
 *   ├──────────────────────────────────────┤
 *   │ SummaryBar  多选或传输中才出现         │
 *   ├──────────────────────────────────────┤
 *   │ BottomNav   探索连接 · 浏览 · 传输 · 设置 │
 *   └──────────────────────────────────────┘
 *
 * 与上一版（顶部分段）的差异只在「入口位置」与「页面顺序」，领域逻辑
 * （useTasks / usePeerDevices / useRemoteFs / useSettings）完全复用：
 *   - 一级入口从顶部分段下沉到底栏，默认落在「探索连接」——没有可用对端时
 *     传输页无事可做，先把设备找到才是第一步；
 *   - 传输页内部仍是 全部 / 发送 / 接收 / 历史 四段，宽屏下占满整宽；
 *   - 设置不再由顶栏齿轮进入（底栏第四项 → 宿主二级页整页跳转）。
 *
 * 探索连接页的扫描态由本层持有：宿主 `refresh-devices` 立即返回、mDNS 结果
 * 随后陆续到达，动画至少跑完一轮用户才能把「扫描」与「设备出现」对上，
 * 因此扫描态按「最短展示时长」收尾，而不是按命令返回时刻。
 */
import { inject, ref, onMounted, onUnmounted, computed, watch } from 'vue'
import type { PluginContext, Disposable } from '@binblink/wasmnest-plugin-sdk-mobile'
import { useSwipeTabs } from '@binblink/wasmnest-plugin-sdk-mobile/ui/swipe-tabs'
import { useTasks } from '../composables/useTasks'
import { isNeedsAllFilesAccess, promptAllFilesAccess } from '../composables/useAllFilesAccess'
import { usePeerDevices } from '../composables/usePeerDevices'
import type { RemotePeerLink } from '../utils/pairingLink'
import { useRemoteFs } from '../composables/useRemoteFs'
import { useSettings } from '../composables/useSettings'
import { formatBytes, formatSpeed } from '../utils/format'
import { resolveMainSwipe } from '../utils/mainSwipe'
import { isTerminalState } from '../types'
import type { MainTab, FooterMode } from '../types'
import AppHeader from './AppHeader.vue'
import BottomNav from './BottomNav.vue'
import TransfersTab from './TransfersTab.vue'
import BrowseTab from './BrowseTab.vue'
import DevicesTab from './DevicesTab.vue'
import SummaryBar from './SummaryBar.vue'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const tasks = useTasks(context)
const devices = usePeerDevices(context)
const fs = useRemoteFs(context)
const settings = useSettings(context)

/** 一级页面（默认探索连接：没有对端时传输页无事可做） */
const tab = ref<MainTab>('devices')

/** 传输页句柄：横滑先步进它的四段筛选，到首/尾段才翻一级页面 */
const transfersRef = ref<InstanceType<typeof TransfersTab> | null>(null)

/** 页面顺序（底栏顺序，也是滑动方向判定基准） */
const TAB_ORDER: MainTab[] = ['devices', 'browse', 'transfers']

/** 底栏 / 页面标题文案（同一份，保证标题与选中项永远一致） */
const navLabels = computed<Record<MainTab | 'settings', string>>(() => ({
  devices: t('transfer.v2.tab.devices'),
  browse: t('transfer.v2.tab.browse'),
  transfers: t('transfer.v2.tab.transfers'),
  settings: t('transfer.v2.nav.settings'),
}))

/**
 * 分段切换方向：next = 向右前进（新页自右推入、旧页向左退出），prev = 回退反向。
 * 点击底栏与左右滑都经 tab 变化统一推断，动画方向始终与手势语义一致。
 */
const slideDir = ref<'next' | 'prev'>('next')
watch(tab, (next, prev) => {
  if (prev === next) return
  slideDir.value = TAB_ORDER.indexOf(next) >= TAB_ORDER.indexOf(prev) ? 'next' : 'prev'
})

/** 方向位移量经 CSS 变量注入过渡类（styles.css .fv2-tab-*），一套类服务两个方向 */
const slideVars = computed(() =>
  slideDir.value === 'next'
    ? { '--fv2-enter-x': '16px', '--fv2-leave-x': '-16px' }
    : { '--fv2-enter-x': '-16px', '--fv2-leave-x': '16px' },
)

/** 可发送性：自建设备缓存中存在具备传输能力的节点（与旧版同构） */
watch(
  () => devices.devices.value,
  (list) => {
    tasks.peerOnline.value = list.some((d) => d.fileTransfer !== false && !!d.nodeId)
  },
  { deep: false, immediate: true },
)

/**
 * 左右滑：先在本页内步进（传输页四段筛选），到两端后才离开本页。
 *
 * 为什么先页内后翻页：传输页四个筛选是同一页里的并列视图，直接翻页会让用户
 * 无法用最自然的横滑看「发送 / 接收 / 历史」；而筛选之外仍要能一眼滑到相邻页。
 * 手势只在这里持有一次（触摸与 dev-shell 鼠标拖动共用），子页只回答「吃掉没有」。
 *
 * 两端语义（底栏顺序 devices → browse → transfers → settings）：
 *   - 首段（全部）再右滑 → 退到上一页「浏览」；
 *   - 尾段（历史）再左滑 → 前进到「设置」——设置是宿主二级页，不是第四张可滑页，
 *     所以这里走与点击底栏第四项相同的 openPage（用户不必先松手去点底栏）。
 */
function switchTab(dir: 'left' | 'right'): void {
  if (tab.value === 'transfers') {
    const transfers = transfersRef.value
    // 切页过渡 / 首帧未挂载：整轮丢弃。宁可不动，也不要因为拿不到子页状态
    // 把「历史」误判成已到端点而弹出设置页
    if (!transfers) return
    if (transfers.stepFilter(dir)) return
  }
  const action = resolveMainSwipe(TAB_ORDER, tab.value, dir)
  if (action.type === 'tab') tab.value = action.tab
  else if (action.type === 'settings') openSettingsFromSwipe()
}

/** 设置页入栈时间戳：滑动入口防连击重复入栈（连续两次 touchend 只开一次） */
let settingsNavAt = 0
/** 与底栏第四项同义的「前进到设置」 */
function openSettingsFromSwipe(): void {
  const now = Date.now()
  if (now - settingsNavAt < 600) return
  settingsNavAt = now
  context.ui.openPage('settings')
}
const { onTouchStart, onTouchMove, onTouchEnd } = useSwipeTabs(switchTab)

// dev-shell / 桌面预览回退：鼠标指针拖动驱动同一切换逻辑（浏览器无触摸事件）。
// 真机触摸走上方 touch 事件；此处按 pointerType 只认 mouse，避免双触发。
let mouseStartX = 0
let mouseStartY = 0
let mouseDX = 0
let mouseTracking = false
function onMouseDown(e: PointerEvent): void {
  if (e.pointerType !== 'mouse') return
  mouseStartX = e.clientX
  mouseStartY = e.clientY
  mouseDX = 0
  mouseTracking = true
}
function onMouseMove(e: PointerEvent): void {
  if (!mouseTracking || e.pointerType !== 'mouse') return
  const dx = e.clientX - mouseStartX
  const dy = e.clientY - mouseStartY
  mouseDX = Math.abs(dx) > Math.abs(dy) ? dx : 0
}
function onMouseUp(): void {
  if (!mouseTracking) return
  mouseTracking = false
  if (mouseDX < -48) switchTab('left')
  else if (mouseDX > 48) switchTab('right')
  mouseDX = 0
}

// ==================== 对端 / 设备 ====================

/** 对端展示名：优先活跃对端名（三态真相），回落旧任务快照/占位链 */
const peerLabel = computed(() => devices.peer.value.name || tasks.displayPeerName.value)

/**
 * 扫描最短展示时长：`refresh-devices` 是「触发宿主重查」的即时返回，
 * 结果由 mDNS 事件陆续送达。动画与命令同时结束会让用户看不到过程，
 * 因此至少跑满一轮雷达（约两圈扫描 + 一次脉冲）。
 */
const SCAN_MIN_MS = 2200

/** 探索发现进行中（雷达转动、按钮 spinner、防重复触发） */
const deviceScanning = ref(false)
let scanTimer: ReturnType<typeof setTimeout> | null = null

async function handleScanDevices(): Promise<void> {
  if (deviceScanning.value) return
  deviceScanning.value = true
  const startedAt = Date.now()
  try {
    await devices.refresh()
  } finally {
    const remain = Math.max(0, SCAN_MIN_MS - (Date.now() - startedAt))
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(() => {
      scanTimer = null
      deviceScanning.value = false
    }, remain)
  }
}

/**
 * 首次进入探索连接页自动扫一轮：真机上设备列表通常为空且用户不知道要手动点，
 * 进页面即给出「正在找」的反馈（同时是真实 refresh，不是装饰动画）。
 * 只做一次——用户自己点「重新扫描」时才再次触发，避免每次切页都打命令。
 */
let autoScanned = false
function maybeAutoScan(): void {
  if (autoScanned || tab.value !== 'devices') return
  autoScanned = true
  void handleScanDevices()
}
watch(tab, () => maybeAutoScan())

function handleDeviceConnect(nodeId: string): void {
  void devices.connect(nodeId)
}
/** 手动「尝试外网」：显式请求核内纳入 relay 候选（§4.9 不自动切） */
function handleDeviceRetryWan(nodeId: string): void {
  void devices.connect(nodeId, { wan: true })
}
/** 添加远程设备（T12）：连接串 → 设备缓存（paired 条目跨重启保留） */
function handleAddRemote(link: RemotePeerLink): void {
  devices.addRemotePeer(link)
  context.dialogs.showToast(t('transfer.remote.added'), 'success')
}
function handleRemoveRemote(nodeId: string): void {
  devices.removeRemotePeer(nodeId)
}
function handleDeviceDisconnect(nodeId: string): void {
  void devices.disconnect(nodeId)
}
function handleDeviceSetActive(nodeId: string): void {
  void devices.switchPeer(nodeId)
}

/** 历史「打开所在文件夹」：优先本地路径（wire 有 localPath，dev-shell 演示链路），
 * 否则真机凭文件名经宿主 MediaStore 按名解析（接收落点不在 wire 上） */
async function handleOpenLocation(id: string): Promise<void> {
  const entry = tasks.history.value.find((e) => e.id === id)
  if (!entry) return
  try {
    if (entry.localPath) await context.system.revealInDir(entry.localPath)
    else await context.system.revealReceivedFileLocation(entry.fileName)
  } catch (e) {
    console.error('[File Transfer] open location failed:', e)
    // 打开系统公共 Download 目录需「所有文件访问」：宿主以固定前缀 reject，
    // 弹引导对话框跳系统设置，授权后用户重试原操作即达
    if (isNeedsAllFilesAccess(e)) {
      void promptAllFilesAccess(context)
      return
    }
    context.dialogs.showToast(t('transfer.v2.history.noLocalFile'), 'error')
  }
}

// ==================== 浏览（选择 / 下载） ====================

/** 批量拉取勾选文件（当前根内相对路径拼装，一次 pull_files 调用） */
async function downloadSelected(): Promise<void> {
  if (!tasks.peerOnline.value || !fs.currentRoot.value) return
  const names = fs.selectedFiles.value
  if (names.length === 0) return
  try {
    const result = await context.commands.execute('file-transfer.pull-files', {
      dirId: fs.currentRoot.value.id,
      path: fs.currentPath.value,
      files: names,
    })
    if ((result?.count ?? 0) > 0) {
      context.dialogs.showToast(t('transfer.saveTo.enqueued'), 'success')
      fs.clearSelection()
      // 下载已入队：自动切到传输页展示任务（与上传 uploadFile 一致）
      tab.value = 'transfers'
    }
  } catch (e) {
    console.error('[File Transfer] pull-files failed:', e)
    context.dialogs.showToast(String(e), 'error')
  }
}

/**
 * 上传入口：系统文件选择器多选 → 直发活跃对端
 * （宿主 SAF 选图换算真实路径；取消静默返回）
 */
async function uploadFile(): Promise<void> {
  if (!tasks.peerOnline.value) {
    context.dialogs.showToast(t('transfer.upload.offline'), 'error')
    return
  }
  try {
    const raw = await context.commands.execute('file-transfer.pick-files', {})
    const paths: string[] = Array.isArray(raw) ? raw : []
    if (paths.length === 0) return
    // 经中继发送提示（T12 / §9.2#4）：只提示一次、可取消，不改变模式判定。
    // 阈值 0 = 每次经中继都提示；> 0 时按本批总量判定（预览失败按无阈值口径提示）
    const activeRow = devices.rows.value.find((r) => r.nodeId === devices.peer.value.id)
    if (activeRow?.transport === 'wan-relay') {
      const threshold = settings.settings.value.relayMaxBytesPerTask
      let total = 0
      if (threshold > 0) {
        try {
          const preview = await context.commands.execute('file-transfer.preview-outgoing', {
            paths,
          })
          total = typeof preview?.totalBytes === 'number' ? preview.totalBytes : 0
        } catch (e) {
          console.error('[File Transfer] preview-outgoing failed:', e)
        }
      }
      if (threshold <= 0 || total >= threshold) {
        const go = await context.dialogs.showConfirm({
          title: t('transfer.relayHint.title'),
          message: t('transfer.relayHint.body'),
          confirmText: t('transfer.relayHint.confirm'),
          cancelText: t('transfer.relayHint.cancel'),
          variant: 'warning',
        })
        if (!go) return
      }
    }
    const ok = await tasks.sendFiles(paths)
    if (ok > 0) {
      context.dialogs.showToast(t('transfer.upload.enqueued'), 'success')
      tab.value = 'transfers'
    }
  } catch (e) {
    const msg = String(e)
    if (msg.includes('cancel')) return
    console.error('[File Transfer] pick/send failed:', e)
  }
}

/**
 * 就绪的活跃对端 id（'' = 未就绪：没有活跃对端，或活跃对端未连接）。
 *
 * 浏览对端目录的准入条件 = 该值非空，与桌面端口径一致（桌面 watch peer.value.id 驱动
 * loadRoots/reset）：`file-transfer.list-remote` 按插件侧 ACTIVE_NODE 寻址（resolve_node），
 * 无活跃对端时调用必失败（no active peer）。不能用 `tasks.peerOnline` 作闸门——那只是
 * 「发现到任意具备传输能力的设备」，未连接、甚至只有快照恢复条目时也为真。
 * watch 源用 id 而非布尔：活跃对端从一个已连接节点兜底切到另一个时也要重载目录。
 */
const readyPeerId = computed(() => (devices.peer.value.online ? devices.peer.value.id : ''))

/** 活跃对端就绪状态变化驱动目录加载（就绪加载共享根，未就绪清空浏览态）；
 *  immediate：挂载时按当前状态对齐一次，替代此前挂载无条件 loadRoots（无活跃对端必失败） */
watch(
  readyPeerId,
  (id) => {
    if (id) void fs.loadRoots()
    else fs.reset()
  },
  { immediate: true },
)

// ==================== 底部行动条 ====================

/** 接收侧终态（与 TransfersTab 口径一致；ReceivingTask.state 为宿主透传字符串） */
const RECEIVING_TERMINAL = new Set(['completed', 'failed', 'rejected', 'cancelled'])

/** 活跃传输（发送队列 + 接收中；底栏「总体」与角标口径包含双向） */
const activeTasks = computed(() => [
  ...tasks.tasks.value.filter((tk) => !isTerminalState(tk.state)),
  ...tasks.receivingTasks.value.filter((rt) => !RECEIVING_TERMINAL.has(rt.state)),
])

/** 总体进度：各活跃批已传字节 / 总字节 */
const overallPercent = computed(() => {
  const list = activeTasks.value
  const total = list.reduce((sum, tk) => sum + (tk.size > 0 ? tk.size : 0), 0)
  if (total <= 0) return 0
  const done = list.reduce((sum, tk) => sum + Math.min(tk.offset, tk.size), 0)
  return Math.min(100, Math.round((done / total) * 100))
})

/** 行动条状态：多选 > 活跃传输 > idle（idle 时整条不渲染，列表多显示一张卡） */
const footerMode = computed<FooterMode>(() => {
  if (tab.value === 'browse' && fs.selectedCount.value > 0) return 'select'
  if (activeTasks.value.length > 0) return 'active'
  return 'idle'
})

const downloadLabel = computed(() =>
  t('transfer.topbar.downloadSelected', {
    count: fs.selectedCount.value,
    size: formatBytes(fs.selectedTotalSize.value, t),
  }),
)

const activeLabel = computed(() => {
  const count = activeTasks.value.length
  return count > 0 ? t('transfer.queue.active', { count }) : t('transfer.queue.title')
})

// ==================== 生命周期 ====================

let disposeBackPress: Disposable | null = null

onMounted(() => {
  tasks.start()
  devices.start()
  void settings.load()
  disposeBackPress = context.ui.onBackPressed(() => {
    // 返回键接管顺序：浏览页逐级退目录 → 回到首页（探索连接）→ 交还平台。
    // 已处理的分支返回 true（消费本次返回）：不消费则宿主壳兜底会同时退一屏，
    // 一次返回变成「退目录 + 离开应用」；走到最后返回 false 交还平台。
    if (tab.value === 'browse' && fs.crumbs.value.length > 1) {
      void fs.up()
      return true
    }
    if (tab.value === 'browse' && fs.crumbs.value.length === 1) {
      void fs.goRoot()
      return true
    }
    if (tab.value !== 'devices') {
      tab.value = 'devices'
      return true
    }
    return false
  })
  // 挂载晚于设备事件时主动探测一次
  if (!tasks.peerOnline.value) void tasks.queryPeer()
  // 首屏即探索（默认页就是探索连接）
  maybeAutoScan()
})

onUnmounted(() => {
  disposeBackPress?.dispose()
  if (scanTimer) {
    clearTimeout(scanTimer)
    scanTimer = null
  }
  devices.stop()
  tasks.stop()
})
</script>

<template>
  <!-- data-testid：真机 E2E 锚点（移动端统一 mobile- 前缀，见 docs/E2E.md §10.5 / §11.5） -->
  <div class="fv2-view mobile-ui ft-app" data-testid="mobile-ft-root">
    <!-- 顶栏：页面标题 + 活跃对端（点击 → 探索连接） + 发送入口 -->
    <AppHeader
      :title="navLabels[tab]"
      :peer-name="peerLabel"
      :online="devices.peer.value.online"
      :online-label="t('transfer.peer.online')"
      :offline-label="t('transfer.peer.offline')"
      :send-label="t('transfer.v2.upload.short')"
      :send-aria-label="t('transfer.v2.upload.cta')"
      :send-disabled="!tasks.peerOnline.value"
      @peer-tap="tab = 'devices'"
      @send="uploadFile()"
    />

    <!-- 一级页面（左右滑切换）：手势统一在本容器持有（.fv2-swipe-zone 只禁浏览器
         水平手势、保留纵向滚动）。传输页先步进页内四段筛选，到首/尾段才翻页——
         边界由 switchTab → TransfersTab.stepFilter 的返回值判定，不再经退役的宿主
         MobileSwipeContainer 协议（原 data-swipe-zone / data-zone-at-* 标记已删除）。
         :style 注入分段切换方向位移量；Transition 为方向性推入（styles.css .fv2-tab-*），
         不用 out-in——离场分支绝对定位退出文档流，进场分支同帧接管，无空窗塌陷 -->
    <div
      class="fv2-stage fv2-swipe-zone"
      :style="slideVars"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
      @pointerdown="onMouseDown"
      @pointermove="onMouseMove"
      @pointerup="onMouseUp"
      @pointercancel="onMouseUp"
    >
      <Transition name="fv2-tab">
        <!-- 探索连接（默认页）：雷达扫描 + 分组设备列表 -->
        <DevicesTab
          v-if="tab === 'devices'"
          key="devices"
          :rows="devices.rows.value"
          :scanning="deviceScanning"
          :t="t"
          @connect="handleDeviceConnect"
          @retry-wan="handleDeviceRetryWan"
          @disconnect="handleDeviceDisconnect"
          @set-active="handleDeviceSetActive"
          @add-remote="handleAddRemote"
          @remove-remote="handleRemoveRemote"
          @scan="handleScanDevices"
        />

        <!-- 浏览对端共享目录 -->
        <BrowseTab
          v-else-if="tab === 'browse'"
          key="browse"
          :entries="fs.entries.value"
          :loading="fs.loading.value"
          :error="fs.error.value"
          :notice="fs.notice.value"
          :crumbs="fs.crumbs.value"
          :current-root="fs.currentRoot.value"
          :selected="fs.selected.value"
          :selected-count="fs.selectedCount.value"
          :peer-online="readyPeerId !== ''"
          :t="t"
          @cd="(name) => fs.cd(name)"
          @up="() => fs.up()"
          @go-root="() => fs.goRoot()"
          @go-to="(i) => fs.goTo(i)"
          @toggle="(name) => fs.toggle(name)"
          @toggle-all="() => fs.toggleAll()"
          @clear-selection="() => fs.clearSelection()"
          @refresh="() => fs.refresh()"
          @query-peer="() => tasks.queryPeer()"
        />

        <!-- 传输：发送 / 接收 / 历史 -->
        <TransfersTab
          v-else
          ref="transfersRef"
          key="transfers"
          :tasks="tasks.tasks.value"
          :receiving="tasks.receivingTasks.value"
          :history="tasks.history.value"
          :upload-label="t('transfer.v2.upload.cta')"
          :can-upload="tasks.peerOnline.value"
          :t="t"
          @cancel="(id) => tasks.cancel(id)"
          @retry="(id) => tasks.retry(id)"
          @pause="(id) => tasks.pause(id)"
          @resume="(id) => tasks.resume(id)"
          @resume-all="() => tasks.resumeAll()"
          @cancel-receiving="(sessionId) => tasks.cancelReceiving(sessionId)"
          @clear-history="() => tasks.clearHistory()"
          @open-location="handleOpenLocation"
          @upload="uploadFile()"
        />
      </Transition>
    </div>

    <!-- 上下文行动条（多选批量下载 / 传输中总体进度）；空闲时整条不渲染 -->
    <SummaryBar
      v-if="footerMode !== 'idle'"
      :mode="footerMode"
      :download-label="downloadLabel"
      :clear-label="t('transfer.table.clearSelection')"
      :active-label="activeLabel"
      :speed-label="formatSpeed(tasks.totalSpeed.value, t)"
      :overall-label="t('transfer.v2.active.overall', { percent: overallPercent })"
      :overall-percent="overallPercent"
      :view-queue-label="t('transfer.v2.active.viewQueue')"
      @download="downloadSelected()"
      @clear-selection="() => fs.clearSelection()"
      @open-queue="tab = 'transfers'"
    />

    <!-- 底部导航：三个一级页面 + 设置（宿主二级页整页跳转） -->
    <BottomNav
      v-model="tab"
      :labels="navLabels"
      :active-count="activeTasks.length"
      :device-count="devices.rows.value.length"
      @settings="context.ui.openPage('settings')"
    />
  </div>
</template>
