<script setup lang="ts">
/**
 * DevicesTab — 探索连接（附近设备）一级页面
 *
 * 结构（v3，底部导航版）：
 *   1. 顶部「扫描带」——雷达图元 + 状态文案 + 重新扫描；扫描进行中雷达转动，
 *      没有设备时雷达放大成整页主视觉。用户任何时刻都能看出「在搜 / 搜完了」。
 *   2. 分组列表——已连接（含活跃对端标记）与附近设备分开，连接动作就近呈现。
 *   3. 尾部——添加远程设备（连接串 / 扫码，T12）+ 信任说明。
 *
 * 添加远程设备收进底部弹层（sheet）：面板贴着触发点出现，不把用户已滚动到的
 * 列表位置顶走；扫码面板仍是全屏取景（相机预览需要整屏）。
 *
 * 纯展示：行状态由 usePeerDevices 派生的 rows 传入，操作以事件上抛。
 */
import { computed, inject, ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { DeviceRow, DialFailureCode } from '../composables/deviceState'
import {
  isConnectionInvite,
  parseConnectionInvite,
  parseRemotePeerLink,
  type ConnectionInvite,
  type ConnectionInviteError,
  type RemotePeerLink,
  type RemotePeerLinkError,
} from '../utils/pairingLink'
import { useConnectionInvite } from '../composables/useConnectionInvite'
import ScanRadar from './ScanRadar.vue'
import ScanPanel from './ScanPanel.vue'
import MyDeviceSheet from './MyDeviceSheet.vue'

type Translate = (key: string, params?: Record<string, any>) => string

const props = defineProps<{
  rows: DeviceRow[]
  /** 探索发现进行中（雷达转动、按钮转 spinner、防重复点击） */
  scanning: boolean
  t: Translate
  /** 当前经中继可见的设备数（邀请确认页展示「当前空间 N 台」） */
  relayDeviceCount?: number
}>()

const emit = defineEmits<{
  (e: 'connect', nodeId: string): void
  /** 手动「尝试外网」：只在有 relay 候选且用户显式点击时纳入 relay（§4.9） */
  (e: 'retry-wan', nodeId: string): void
  /** 仅经中继：跳过 LAN 候选直接拨 relay（T20 §4.2） */
  (e: 'retry-relay-only', nodeId: string): void
  (e: 'disconnect', nodeId: string): void
  (e: 'set-active', nodeId: string): void
  /** 连接串解析成功 → 父级落设备缓存（T12） */
  (e: 'add-remote', link: RemotePeerLink): void
  /** 邀请导入成功（T23）：设置已写入，父级负责刷新发现 */
  (e: 'invite-joined', invite: ConnectionInvite): void
  /** 移除手动添加的远程设备（T12） */
  (e: 'remove-remote', nodeId: string): void
  /** 直达发送（T23）：未连接时先连后选文件；已连接时切活跃 + 选文件 */
  (e: 'send', nodeId: string): void
  (e: 'scan'): void
}>()

const t = props.t
const context = inject<PluginContext>('pluginContext')!
/** 邀请编排：读当前空间 / 应用设置都在这里收敛（与桌面同构） */
const invites = useConnectionInvite(context)

/**
 * 底部安全区（宿主经 provide 注入，与 BottomNav 同源；dev-shell 无注入时退化 0）。
 * 弹层用 position: fixed 贴视口底，若不加系统条留白，确认按钮会被手势条盖住。
 */
const safeArea = inject<Ref<{ bottom: number; navigationBar?: number }> | undefined>(
  'safeArea',
  undefined,
)
const sheetBottomInset = computed(() => {
  const value = safeArea?.value
  return value?.navigationBar ?? value?.bottom ?? 0
})

// ==================== 分组 ====================

/**
 * 行分组：已连接 / 附近。握手中的行留在「附近」——它还没建立起可用的数据面，
 * 提前归进「已连接」会让用户以为已经能发文件。两个分组按行数自动隐显。
 */
const groups = computed(() => {
  const connected = props.rows.filter((row) => row.status === 'connected')
  const nearby = props.rows.filter((row) => row.status !== 'connected')
  return [
    { key: 'connected', title: t('transfer.v2.devices.groupConnected'), rows: connected },
    { key: 'nearby', title: t('transfer.v2.devices.groupNearby'), rows: nearby },
  ].filter((group) => group.rows.length > 0)
})

// ==================== 添加远程设备（T12：无摄像头场景粘贴连接串） ====================

const addOpen = ref(false)
/** 「我的设备」底部弹层（T21：连接串 + 外网接入） */
const myOpen = ref(false)
const addText = ref('')
const addError = ref<RemotePeerLinkError | null>(null)
const inviteError = ref<ConnectionInviteError | null>(null)
const pasteFailed = ref(false)
/** 非 null = 停在邀请确认页（此时不写任何设置） */
const pendingInvite = ref<ConnectionInvite | null>(null)
const joining = ref(false)
const joinFailed = ref(false)
/** 扫码面板（相机路径；与粘贴共用同一解析） */
const scanOpen = ref(false)

const ADD_ERROR_KEYS: Record<RemotePeerLinkError, string> = {
  malformed: 'transfer.remote.errorMalformed',
  incomplete: 'transfer.remote.errorIncomplete',
  'address-invalid': 'transfer.remote.errorAddressInvalid',
}

const INVITE_ERROR_KEYS: Record<ConnectionInviteError, string> = {
  malformed: 'transfer.invite.errorMalformed',
  'missing-room': 'transfer.invite.errorMissingRoom',
  'address-invalid': 'transfer.invite.errorAddressInvalid',
}

const inviteErrorKey = computed(() =>
  inviteError.value ? INVITE_ERROR_KEYS[inviteError.value] : '',
)

/** 「加入后看不到当前空间设备」判定（确认页必须说清楚） */
const leaveRoom = computed(() => {
  const target = pendingInvite.value
  const current = invites.current.value
  return Boolean(target && current && current.room && current.room !== target.room)
})

/** 中心冲突：移动端没有配置中心，恒 false；保留同构判据 */
const conflict = computed(() =>
  pendingInvite.value ? invites.isCenterConflict(pendingInvite.value) : false,
)

/** 空间码只展示前 8 位 */
const roomPrefix = computed(() => {
  const room = pendingInvite.value?.room ?? ''
  return room.length > 8 ? `${room.slice(0, 8)}…` : room
})

const inviteName = computed(() => pendingInvite.value?.name || t('transfer.invite.unnamed'))

/** 输入变化即清掉旧错误（设备链接 / 邀请两种解析口径共用同一输入框） */
function clearInputErrors(): void {
  addError.value = null
  inviteError.value = null
}

function submitRemote(): void {
  addError.value = null
  inviteError.value = null

  // 先试 v4 邀请（纯 v4 JSON 粘贴也能识别）
  const joined = parseConnectionInvite(addText.value)
  if (joined.ok) {
    pendingInvite.value = joined.invite
    joinFailed.value = false
    void invites.loadCurrent()
    return
  }
  // 明确是邀请前缀却解析失败：按邀请细分原因提示，不回退成「设备链接坏」
  if (isConnectionInvite(addText.value)) {
    inviteError.value = joined.reason
    return
  }

  const parsed = parseRemotePeerLink(addText.value)
  if (!parsed.ok) {
    addError.value = parsed.reason
    return
  }
  addError.value = null
  addText.value = ''
  addOpen.value = false
  emit('add-remote', parsed.link)
}

async function confirmJoinInvite(): Promise<void> {
  const target = pendingInvite.value
  if (!target || joining.value || conflict.value) return
  joining.value = true
  joinFailed.value = false
  const ok = await invites.apply(target)
  joining.value = false
  if (!ok) {
    joinFailed.value = true
    return
  }
  pendingInvite.value = null
  addText.value = ''
  addOpen.value = false
  emit('invite-joined', target)
}

function cancelInviteConfirm(): void {
  pendingInvite.value = null
  joinFailed.value = false
}

async function pasteFromClipboard(): Promise<void> {
  pasteFailed.value = false
  try {
    const value = await navigator.clipboard.readText()
    if (!value.trim()) {
      pasteFailed.value = true
      return
    }
    addText.value = value
    addError.value = null
  } catch {
    pasteFailed.value = true
  }
}

function openAddRemote(): void {
  addError.value = null
  inviteError.value = null
  pendingInvite.value = null
  joinFailed.value = false
  pasteFailed.value = false
  addOpen.value = true
}

function closeAddRemote(): void {
  addOpen.value = false
  addError.value = null
  inviteError.value = null
  pendingInvite.value = null
  joinFailed.value = false
}

/** 扫码成功：与粘贴同一落点（父级设备缓存），关闭两个面板 */
function onScanned(link: RemotePeerLink): void {
  scanOpen.value = false
  addOpen.value = false
  addText.value = ''
  addError.value = null
  emit('add-remote', link)
}

/** 扫到 v4 邀请：停在确认页，不直接改本机空间 */
function onInviteScanned(invite: ConnectionInvite): void {
  scanOpen.value = false
  addOpen.value = true
  pendingInvite.value = invite
  joinFailed.value = false
  void invites.loadCurrent()
}

// ==================== 行内文案 ====================

/** 传输形态文案（宿主 transport 词表；未知形态不渲染） */
function transportLabel(row: DeviceRow): string {
  if (row.transport === 'lan-direct') return t('transfer.devices.transportLan')
  if (row.transport === 'wan-relay') return t('transfer.devices.transportWan')
  return ''
}

/** 上次传输形态文案（T20：idle 态展示，让用户知道默认重拨会带 relay） */
function lastTransportLabel(row: DeviceRow): string {
  if (row.lastTransport === 'lan-direct') return t('transfer.devices.lastTransportLan')
  if (row.lastTransport === 'wan-relay') return t('transfer.devices.lastTransportWan')
  return ''
}

/** 拨号失败分类 → 文案 key（未识别原样展示原文，不猜成因） */
const DIAL_ERROR_KEYS: Record<DialFailureCode, string> = {
  denied: 'transfer.devices.denied',
  'no-endpoint': 'transfer.devices.errorNoEndpoint',
  'relay-disabled': 'transfer.devices.errorRelayDisabled',
  'relay-unreachable': 'transfer.devices.errorRelayUnreachable',
  'lan-unreachable': 'transfer.devices.unreachable',
  timeout: 'transfer.devices.errorTimeout',
  unknown: 'transfer.devices.errorUnknown',
}

/** 行内错误文案（unknown 带原文，其余只给分类文案） */
function dialErrorText(row: DeviceRow): string {
  const failure = row.dialError
  if (!failure) return ''
  if (failure.code === 'unknown' && failure.detail) {
    return t(DIAL_ERROR_KEYS.unknown, { detail: failure.detail })
  }
  return t(DIAL_ERROR_KEYS[failure.code])
}

/** 短指纹（前 8 位） */
function shortFingerprint(nodeId: string): string {
  return nodeId.slice(0, 8)
}

/** 状态点样式：绿=已连接、琥珀=握手中、降饱和绿=在线未连接、灰=离线/失败 */
function dotClass(row: DeviceRow): string {
  if (row.status === 'connected') return 'fv2-dev-dot--connected'
  if (row.status === 'connecting') return 'fv2-dev-dot--connecting'
  if (row.dialError) return 'fv2-dev-dot--offline'
  if (!row.fileTransfer) return 'fv2-dev-dot--nocap'
  return 'fv2-dev-dot--reachable'
}

/** 行内元信息（三态 + 地址；无能力节点优先给出能力标注 + IP 便于诊断） */
function metaText(row: DeviceRow): string {
  if (!row.fileTransfer) {
    return row.addr
      ? `${t('transfer.devices.capNone')} · ${row.addr}`
      : t('transfer.devices.capNone')
  }
  switch (row.status) {
    case 'connected':
      return row.addr
        ? `${t('transfer.devices.connected')} · ${row.addr}`
        : t('transfer.devices.connected')
    case 'connecting':
      return t('transfer.devices.connectingHint')
    default:
      if (row.recent) {
        return row.addr
          ? `${t('transfer.devices.recentSeen')} · ${row.addr}`
          : t('transfer.devices.recentSeen')
      }
      return row.addr
        ? `${t('transfer.devices.online')} · ${row.addr}`
        : t('transfer.devices.online')
  }
}
</script>

<template>
  <div class="fv2-page">
    <!-- 扫码添加远程设备（相机路径；fixed 全屏取景） -->
    <ScanPanel
      v-if="scanOpen"
      :t="t"
      @link="onScanned"
      @invite="onInviteScanned"
      @close="scanOpen = false"
    />

    <!-- 空态：雷达占主视觉，扫描 / 添加两个出口都在这里（不渲染状态带，避免重复标题） -->
    <div v-if="rows.length === 0" class="fv2-discover fv2-discover--empty">
      <ScanRadar :active="scanning" size="lg" />
      <h2 class="fv2-discover-title">
        {{
          scanning ? t('transfer.v2.devices.scanningTitle') : t('transfer.v2.devices.emptyTitle')
        }}
      </h2>
      <p class="fv2-discover-hint">
        {{ scanning ? t('transfer.v2.devices.scanningHint') : t('transfer.devices.empty') }}
      </p>
      <p v-if="!scanning" class="fv2-discover-hint" data-testid="mobile-dev-relay-hint">
        {{ t('transfer.devices.relayEmptyHint') }}
      </p>
      <div class="fv2-discover-actions">
        <button
          class="fv2-btn-primary"
          :disabled="scanning"
          data-testid="mobile-dev-scan"
          @click="emit('scan')"
        >
          <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {{ scanning ? t('transfer.devices.scanning') : t('transfer.devices.scan') }}
        </button>
        <button class="fv2-btn-text" data-testid="mobile-remote-add" @click="openAddRemote()">
          + {{ t('transfer.devices.addRemote') }}
        </button>
        <button class="fv2-btn-text" data-testid="mobile-my-device-open" @click="myOpen = true">
          {{ t('transfer.devices.myDevice') }}
        </button>
      </div>
    </div>

    <template v-else>
      <!-- 扫描带：紧凑态只占一行，扫描中雷达转动 + 文案切换 -->
      <div class="fv2-discover fv2-discover--compact">
        <ScanRadar :active="scanning" size="sm" />
        <div class="fv2-discover-copy">
          <p class="fv2-discover-title">
            {{
              scanning
                ? t('transfer.v2.devices.scanningTitle')
                : t('transfer.v2.devices.found', { count: rows.length })
            }}
          </p>
          <p class="fv2-discover-hint">
            {{
              scanning ? t('transfer.v2.devices.scanningHint') : t('transfer.v2.devices.subtitle')
            }}
          </p>
        </div>
        <button
          class="fv2-discover-btn"
          :disabled="scanning"
          data-testid="mobile-dev-scan"
          @click="emit('scan')"
        >
          <svg
            class="fv2-discover-btn-icon"
            :class="{ 'fv2-scan-icon': scanning }"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {{ t('transfer.v2.devices.rescan') }}
        </button>
      </div>

      <!-- 分组列表 -->
      <div class="fv2-page-scroll">
        <section v-for="group in groups" :key="group.key" class="fv2-group">
          <h3 class="fv2-group-title">
            {{ group.title }}
            <span class="fv2-group-count">{{ group.rows.length }}</span>
          </h3>
          <div class="fv2-device-list">
            <div v-for="row in group.rows" :key="row.nodeId" class="fv2-device-row">
              <!-- 状态点：绿=已连接 / 琥珀=握手中 / 淡绿=在线未连接 / 灰=离线 -->
              <span
                class="fv2-dev-dot flex-shrink-0"
                :class="dotClass(row)"
                aria-hidden="true"
              ></span>

              <div class="fv2-device-main">
                <div class="fv2-device-line">
                  <span class="fv2-device-name truncate">{{ row.deviceName }}</span>
                  <span class="fv2-device-fp">{{ shortFingerprint(row.nodeId) }}</span>
                  <span v-if="row.paired" class="fv2-device-tag" data-testid="mobile-remote-tag">
                    {{ t('transfer.devices.remote') }}
                  </span>
                  <span v-if="row.relay" class="fv2-device-tag" data-testid="mobile-relay-tag">
                    {{ t('transfer.devices.relayTag') }}
                  </span>
                  <span v-if="row.isActive" class="fv2-device-tag fv2-device-tag--active">
                    {{ t('transfer.devices.activeCurrent') }}
                  </span>
                  <!-- T20：跨网能力小徽标（有 relay 候选 = 可跨网，仅内网 = 需重新配对） -->
                  <span
                    v-if="row.fileTransfer"
                    class="fv2-device-tag"
                    :class="{ 'fv2-device-tag--wan': row.wanAvailable }"
                    data-testid="mobile-dev-relay-badge"
                  >
                    {{
                      row.wanAvailable
                        ? t('transfer.devices.hasRelay')
                        : t('transfer.devices.lanOnly')
                    }}
                  </span>
                </div>
                <p class="fv2-device-meta truncate">
                  {{ metaText(row) }}
                  <span
                    v-if="transportLabel(row)"
                    class="fv2-device-transport"
                    :class="{ 'fv2-device-transport--wan': row.transport === 'wan-relay' }"
                    data-testid="mobile-dev-transport"
                    >{{ transportLabel(row) }}</span
                  >
                  <!-- T20：上次传输形态（断开后仍保留，决定下次重连默认路径） -->
                  <span
                    v-if="lastTransportLabel(row)"
                    class="fv2-device-transport"
                    :class="{ 'fv2-device-transport--wan': row.lastTransport === 'wan-relay' }"
                    data-testid="mobile-dev-last-transport"
                    >{{ lastTransportLabel(row) }}</span
                  >
                </p>
                <!-- 拨号终态反馈：按分类给可操作出路（T20） -->
                <p
                  v-if="row.dialError"
                  class="fv2-device-error"
                  data-testid="mobile-dev-dial-error"
                >
                  {{ dialErrorText(row) }}
                </p>
              </div>

              <!-- 行内操作：发送 / 连接 / 设为当前 / 断开，全部为文字按钮（44px 命中区） -->
              <div class="fv2-device-actions">
                <!-- T23：直达发送 = 连接（如需要）+ 选文件 + 发送 -->
                <button
                  class="fv2-btn-text fv2-btn-text--accent"
                  :disabled="!row.fileTransfer || row.status === 'connecting'"
                  data-testid="mobile-dev-send"
                  @click="emit('send', row.nodeId)"
                >
                  {{ t('transfer.devices.sendFile') }}
                </button>
                <template v-if="row.status === 'connected'">
                  <button
                    v-if="!row.isActive"
                    class="fv2-btn-text"
                    @click="emit('set-active', row.nodeId)"
                  >
                    {{ t('transfer.devices.setActive') }}
                  </button>
                  <button
                    v-if="row.paired"
                    class="fv2-btn-text fv2-btn-text--danger"
                    @click="emit('remove-remote', row.nodeId)"
                  >
                    {{ t('transfer.devices.removeRemote') }}
                  </button>
                  <button
                    class="fv2-btn-text fv2-btn-text--danger"
                    @click="emit('disconnect', row.nodeId)"
                  >
                    {{ t('transfer.devices.disconnect') }}
                  </button>
                </template>
                <span v-else-if="row.status === 'connecting'" class="fv2-device-meta">
                  {{ t('transfer.devices.connectingHint') }}
                </span>
                <template v-else>
                  <!-- 失败后主入口：「仅经中继」（LAN 失败 + 有 relay 候选；T20 §4.2） -->
                  <button
                    v-if="row.relayOnlyRecommended"
                    class="fv2-btn-text fv2-btn-text--accent"
                    :disabled="!row.fileTransfer"
                    :title="t('transfer.devices.relayOnlyHint')"
                    data-testid="mobile-dev-try-relay-only"
                    @click="emit('retry-relay-only', row.nodeId)"
                  >
                    {{ t('transfer.devices.relayOnly') }}
                  </button>
                  <!-- 手动「尝试外网」：仅存在 relay 候选时给入口；不自动切换（§4.9） -->
                  <button
                    v-if="row.wanAvailable"
                    class="fv2-btn-text"
                    :disabled="!row.fileTransfer"
                    :title="t('transfer.devices.tryWanHint')"
                    data-testid="mobile-dev-try-wan"
                    @click="emit('retry-wan', row.nodeId)"
                  >
                    {{ t('transfer.devices.tryWan') }}
                  </button>
                  <button
                    class="fv2-btn-text"
                    :class="{ 'fv2-btn-text--accent': !row.relayOnlyRecommended }"
                    :disabled="!row.fileTransfer"
                    @click="emit('connect', row.nodeId)"
                  >
                    {{ t('transfer.devices.connect') }}
                  </button>
                </template>
              </div>
            </div>
          </div>
        </section>

        <!-- 尾部：添加远程设备 + 信任说明（列表短时无需滚动即可见） -->
        <button class="fv2-add-remote" data-testid="mobile-remote-add" @click="openAddRemote()">
          <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
              d="M12 5v14M5 12h14"
            />
          </svg>
          {{ t('transfer.devices.addRemote') }}
        </button>
        <button
          class="fv2-add-remote"
          data-testid="mobile-my-device-open-footer"
          @click="myOpen = true"
        >
          <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
              d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          {{ t('transfer.devices.myDevice') }}
        </button>
        <p class="fv2-trust-hint">{{ t('transfer.devices.trustHint') }}</p>
      </div>
    </template>

    <!-- 我的设备（T21）：连接串 + 外网接入；添加设备流程不出现中继 -->
    <MyDeviceSheet v-if="myOpen" @close="myOpen = false" />

    <!-- 添加远程设备（底部弹层：贴触发点出现，不顶走列表位置） -->
    <div v-if="addOpen" class="fv2-sheet-mask" @click.self="closeAddRemote">
      <div
        class="fv2-sheet"
        data-testid="mobile-remote-panel"
        :style="{ paddingBottom: `calc(1rem + ${sheetBottomInset}px)` }"
      >
        <div class="fv2-sheet-head">
          <h3 class="fv2-sheet-title">
            {{ pendingInvite ? t('transfer.invite.joinTitle') : t('transfer.devices.addRemote') }}
          </h3>
          <button
            class="fv2-icon-btn"
            :aria-label="t('transfer.remote.cancel')"
            @click="closeAddRemote"
          >
            <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <!-- 邀请确认页：先展示将改什么，再落设置（不直接关闭弹层） -->
        <template v-if="pendingInvite">
          <div data-testid="mobile-invite-confirm">
            <p class="fv2-md-hint" data-testid="mobile-invite-confirm-name">
              {{ t('transfer.invite.joinName', { name: inviteName }) }}
            </p>
            <div class="fv2-md-kv">
              <span>{{ t('transfer.invite.joinRelay') }}</span>
              <code data-testid="mobile-invite-confirm-relay">{{
                pendingInvite.relay.join(', ')
              }}</code>
            </div>
            <div class="fv2-md-kv">
              <span>{{ t('transfer.invite.joinRoom') }}</span>
              <code data-testid="mobile-invite-confirm-room">{{ roomPrefix }}</code>
            </div>
            <div class="fv2-md-kv">
              <span>{{ t('transfer.invite.joinDevices') }}</span>
              <strong data-testid="mobile-invite-confirm-count">{{
                props.relayDeviceCount ?? 0
              }}</strong>
            </div>
            <p
              v-if="leaveRoom"
              class="fv2-device-error"
              data-testid="mobile-invite-confirm-leave-room"
            >
              {{ t('transfer.invite.joinLeaveRoom') }}
            </p>
            <p
              v-if="joinFailed"
              class="fv2-device-error"
              data-testid="mobile-invite-confirm-save-error"
            >
              {{ t('transfer.invite.joinFailed') }}
            </p>
          </div>
          <div class="fv2-sheet-actions">
            <button
              class="fv2-btn-text"
              data-testid="mobile-invite-confirm-back"
              @click="cancelInviteConfirm()"
            >
              {{ t('transfer.remote.cancel') }}
            </button>
            <button
              class="fv2-btn-primary"
              :disabled="joining || conflict"
              data-testid="mobile-invite-join"
              @click="confirmJoinInvite()"
            >
              {{ joining ? t('transfer.invite.joining') : t('transfer.invite.join') }}
            </button>
          </div>
        </template>

        <template v-else>
          <!-- T21：连接串来源 = 对方设备的「我的设备」；T23 也接受邀请 -->
          <p class="fv2-remote-source" data-testid="mobile-remote-source">
            {{ t('transfer.invite.inputHint') }}
          </p>
          <textarea
            v-model="addText"
            class="fv2-remote-input"
            rows="3"
            :placeholder="t('transfer.invite.placeholder')"
            data-testid="mobile-remote-input"
            @input="clearInputErrors"
          ></textarea>
          <p v-if="pasteFailed" class="fv2-device-error" data-testid="mobile-remote-paste-failed">
            {{ t('transfer.remote.pasteFailed') }}
          </p>
          <p v-if="addError" class="fv2-device-error" data-testid="mobile-remote-error">
            {{ t(ADD_ERROR_KEYS[addError]) }}
          </p>
          <p v-if="inviteError" class="fv2-device-error" data-testid="mobile-invite-add-error">
            {{ t(inviteErrorKey) }}
          </p>
          <div class="fv2-sheet-actions">
            <button
              class="fv2-btn-text"
              data-testid="mobile-remote-paste"
              @click="pasteFromClipboard()"
            >
              {{ t('transfer.remote.paste') }}
            </button>
            <button
              class="fv2-btn-text"
              data-testid="mobile-remote-scan-open"
              @click="scanOpen = true"
            >
              {{ t('transfer.remote.scan') }}
            </button>
            <button class="fv2-btn-text" @click="closeAddRemote">
              {{ t('transfer.remote.cancel') }}
            </button>
            <button
              class="fv2-btn-primary"
              :disabled="addText.trim() === ''"
              data-testid="mobile-remote-confirm"
              @click="submitRemote()"
            >
              {{ t('transfer.remote.confirm') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
