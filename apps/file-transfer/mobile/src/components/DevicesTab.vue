<script setup lang="ts">
/**
 * DevicesTab — 探索连接（附近设备）一级页面
 *
 * 结构（v3，底部导航版）：
 *   1. 顶部「扫描带」——雷达图元 + 状态文案 + 重新扫描；扫描进行中雷达转动，
 *      没有设备时雷达放大成整页主视觉。用户任何时刻都能看出「在搜 / 搜完了」。
 *   2. 分组列表——已连接（含活跃对端标记）与附近设备分开，连接动作就近呈现。
 *   3. 尾部——信任说明。
 *
 * 本页是**纯发现层**（形态改造 2026-11-16）：设备只来自中继自动发现 + mDNS；
 * 「添加远程设备」（扫码 / 粘贴）与「我的设备」入口已从本页下线——身份信息与
 * 穿透配置统一收敛到设置页，发现流里不再混入手工配对与配置管理。
 * 跨网状态卡只在异常 / 待处置时出现；中继「已就绪」不渲染卡片区域。
 *
 * 纯展示：行状态由 usePeerDevices 派生的 rows 传入，操作以事件上抛。
 */
import { computed, inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type {
  DeviceRow,
  DialFailureCode,
  RelayCardAction,
  RelayCardModel,
} from '../composables/deviceState'
import ScanRadar from './ScanRadar.vue'

type Translate = (key: string, params?: Record<string, any>) => string

const props = defineProps<{
  rows: DeviceRow[]
  /** 探索发现进行中（雷达转动、按钮转 spinner、防重复点击） */
  scanning: boolean
  t: Translate

  /** 跨网状态卡模型（P0-2；父级经 deriveRelayCard 产出） */
  relayCard?: RelayCardModel | null
}>()

const emit = defineEmits<{
  (e: 'connect', nodeId: string): void
  /** 外网入口：跳过 LAN 候选直接拨 relay（显式点击，不回退；T20 §4.2） */
  (e: 'retry-relay-only', nodeId: string): void
  (e: 'disconnect', nodeId: string): void
  (e: 'set-active', nodeId: string): void
  /** 移除历史手动配对的远程设备 */
  (e: 'remove-remote', nodeId: string): void
  /** 直达发送（T23）：未连接时先连后选文件；已连接时切活跃 + 选文件 */
  (e: 'send', nodeId: string): void
  (e: 'scan'): void
}>()

const t = props.t
const context = inject<PluginContext>('pluginContext')!

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

// ==================== 状态卡 ====================

/** 状态卡操作 → 文案 key（none 不渲染） */
const RELAY_ACTION_KEYS: Record<RelayCardAction, string> = {
  'share-config': 'transfer.relayCard.actionShareConfig',
  refresh: 'transfer.relayCard.actionRefresh',
  'open-center': 'transfer.relayCard.actionCenter',
  'open-settings': 'transfer.relayCard.actionSettings',
  none: '',
}

/**
 * 移动端没有配置中心：分享 / 检测都落到本应用设置页「内网穿透」区块
 * （扫码导入 + 状态展示），不跳宿主设置页。
 */
function handleRelayAction(action: RelayCardAction): void {
  switch (action) {
    case 'share-config':
    case 'open-center':
    case 'open-settings':
      context.ui.openPage('settings')
      break
    case 'refresh':
      emit('scan')
      break
    default:
      break
  }
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
    <!-- 跨网状态卡（P0-2）：仅异常/处置态渲染；已就绪时不占卡片区域 -->
    <div
      v-if="props.relayCard"
      class="fv2-relay-card"
      :class="`fv2-relay-card--${props.relayCard.tone}`"
      data-testid="mobile-relay-card"
    >
      <div class="fv2-relay-card-head">
        <span class="fv2-relay-card-title" data-testid="mobile-relay-card-title">
          {{ t(props.relayCard.title) }}
        </span>
      </div>
      <p class="fv2-relay-card-body" data-testid="mobile-relay-card-body">
        {{ t(props.relayCard.body, props.relayCard.params) }}
      </p>
      <p
        v-if="props.relayCard.stale"
        class="fv2-relay-card-stale"
        data-testid="mobile-relay-card-stale"
      >
        {{ t('transfer.relayCard.stale') }}
      </p>
      <p
        v-if="props.relayCard.roomHint"
        class="fv2-relay-card-hint"
        data-testid="mobile-relay-card-room-hint"
      >
        {{ t('transfer.relayCard.roomHint') }}
      </p>
      <div class="fv2-relay-card-actions">
        <button
          v-if="props.relayCard.primary !== 'none'"
          class="fv2-btn-primary"
          data-testid="mobile-relay-card-primary"
          @click="handleRelayAction(props.relayCard.primary)"
        >
          {{ t(RELAY_ACTION_KEYS[props.relayCard.primary]) }}
        </button>
        <button
          v-if="props.relayCard.secondary !== 'none'"
          class="fv2-btn-text"
          data-testid="mobile-relay-card-secondary"
          @click="handleRelayAction(props.relayCard.secondary)"
        >
          {{ t(RELAY_ACTION_KEYS[props.relayCard.secondary]) }}
        </button>
      </div>
    </div>

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
          {{ scanning ? t('transfer.devices.discovering') : t('transfer.devices.discover') }}
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
          {{ t('transfer.devices.discover') }}
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
                  <!-- 连接方式标注：内网+外网 / 仅内网 / 仅外网（不把单一通路说成通用可达） -->
                  <span
                    v-if="row.fileTransfer"
                    class="fv2-device-tag"
                    :class="{ 'fv2-device-tag--wan': row.wanAvailable }"
                    data-testid="mobile-dev-relay-badge"
                  >
                    {{
                      row.connectionModes === 'both'
                        ? t('transfer.devices.modeBoth')
                        : row.connectionModes === 'lan'
                          ? t('transfer.devices.modeLanOnly')
                          : row.connectionModes === 'wan'
                            ? t('transfer.devices.modeWanOnly')
                            : t('transfer.devices.modeNone')
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
                  <!-- 无任何候选：不猜路径，给「等重新发现」的显性说明 -->
                  <span
                    v-if="row.connectionModes === 'none'"
                    class="fv2-device-meta"
                    data-testid="mobile-dev-no-endpoint"
                  >
                    {{ t('transfer.devices.modeNoneHint') }}
                  </span>
                  <!-- 内网入口（默认路径；LAN 失败后不自动切外网） -->
                  <button
                    v-if="row.lanAvailable"
                    class="fv2-btn-text"
                    :class="{ 'fv2-btn-text--accent': !row.relayOnlyRecommended }"
                    :disabled="!row.fileTransfer"
                    :title="t('transfer.devices.connectLanHint')"
                    data-testid="mobile-dev-connect-lan"
                    @click="emit('connect', row.nodeId)"
                  >
                    {{ t('transfer.devices.connectLan') }}
                  </button>
                  <!-- 外网入口：显式点击才经中继（relay-only，不回退 LAN） -->
                  <button
                    v-if="row.wanAvailable"
                    class="fv2-btn-text"
                    :class="{
                      'fv2-btn-text--accent': row.relayOnlyRecommended || !row.lanAvailable,
                    }"
                    :disabled="!row.fileTransfer"
                    :title="t('transfer.devices.connectWanHint')"
                    data-testid="mobile-dev-connect-wan"
                    @click="emit('retry-relay-only', row.nodeId)"
                  >
                    {{ t('transfer.devices.connectWan') }}
                  </button>
                </template>
              </div>
            </div>
          </div>
        </section>

        <!-- 尾部：信任说明（列表短时无需滚动即可见） -->
        <p class="fv2-trust-hint">{{ t('transfer.devices.trustHint') }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fv2-relay-card {
  margin: 8px 12px 4px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border-color, #3a3f47);
  background: var(--surface-secondary, rgba(255, 255, 255, 0.03));
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fv2-relay-card--progress {
  border-color: rgba(120, 170, 255, 0.45);
}
.fv2-relay-card--warn {
  border-color: rgba(255, 190, 90, 0.5);
}
.fv2-relay-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fv2-relay-card-title {
  font-weight: 600;
  font-size: 0.9rem;
}
.fv2-relay-card-body,
.fv2-relay-card-stale,
.fv2-relay-card-hint {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--text-secondary, #a4a9b3);
}
.fv2-relay-card-stale {
  color: var(--warning, #e5b567);
}
.fv2-relay-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
