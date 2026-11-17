<script setup lang="ts">
/**
 * PeerDevicesPanel — 附近设备面板（自绘，替代旧「在线设备切换下拉」）
 *
 * 列出全部发现的 WasmNest 节点：已连接 / 连接中 / 未连接三态可区分，
 * 拨号失败按分类给可操作出路（T20：仅经中继 / 打开中继）；
 * 已连接设备可断开、可设为当前活跃对端；无传输能力节点可见但不可连接。
 * 纯展示组件：状态由 usePeerDevices 派生的 rows 传入，操作以事件上抛。
 */
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type {
  DeviceRow,
  DialFailureCode,
  RelayCardAction,
  RelayCardModel,
} from '../composables/deviceState'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const props = defineProps<{
  rows: DeviceRow[]
  /** 探索发现进行中（扫描按钮转 spinner、防重复点击） */
  scanning?: boolean
  /** 跨网状态卡模型（P0-2；父级经 deriveRelayCard 产出） */
  relayCard?: RelayCardModel | null
}>()

const emit = defineEmits<{
  connect: [nodeId: string]
  /** 外网入口：跳过 LAN 候选直接拨 relay（显式点击，不回退；T20 §4.2） */
  retryRelayOnly: [nodeId: string]
  disconnect: [nodeId: string]
  setActive: [nodeId: string]
  /** 移除历史手动配对的远程设备 */
  removeRemote: [nodeId: string]
  /** 直达发送（T23）：未连接时先连后选文件；已连接时切活跃 + 选文件 */
  send: [nodeId: string]
  /** 探索发现：重新扫描同网节点（父组件负责调 query-peer 并维护 scanning 态） */
  scan: []
  /** 状态卡操作（粘贴邀请 / 生成邀请 / 刷新 / 打开中心或设置） */
  relayAction: [action: RelayCardAction]
}>()

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

/** 状态卡操作 → 文案 key（none 不渲染） */
const RELAY_ACTION_KEYS: Record<RelayCardAction, string> = {
  'share-config': 'transfer.relayCard.actionShareConfig',
  refresh: 'transfer.relayCard.actionRefresh',
  'open-center': 'transfer.relayCard.actionCenter',
  'open-settings': 'transfer.relayCard.actionSettings',
  none: '',
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

/** 短指纹（前 8 位）展示 */
function shortFingerprint(nodeId: string): string {
  return nodeId.slice(0, 8)
}

/** 状态点样式：绿=已连接、琥珀呼吸=握手中、灰=未连接/失败 */
function dotClass(row: DeviceRow): string {
  if (row.status === 'connected') return 'ft-dot--online'
  if (row.status === 'connecting') return 'ft-dot--connecting'
  // 不可达终态：降为离线灰，消除「在线」文案与错误提示的矛盾（评审 P2）
  if (row.dialError) return 'ft-dot--offline'
  // 在线未连接：降饱和绿，与实心绿（已连接）区分（评审 P1：状态点语义）
  return 'ft-dot--reachable'
}
</script>

<template>
  <div class="ft-dev-panel">
    <div class="ft-dev-head">
      <span class="ft-dev-title">{{ t('transfer.devices.title') }}</span>
      <span class="ft-dev-subtitle">{{ t('transfer.devices.subtitle') }}</span>
      <!-- 统一发现：内网 mDNS + 外网穿透发现一起重查；扫描中转 spinner 防重复发起 -->
      <button
        class="ft-text-btn ft-dev-scan-btn"
        :disabled="props.scanning"
        :title="t('transfer.devices.discoverHint')"
        data-testid="ft-peer-scan"
        @click="emit('scan')"
      >
        <!-- 扫描中：旋转圆环占位（GPU 合成 transform） -->
        <svg
          v-if="props.scanning"
          class="ft-dev-scan-spin"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <svg v-else class="ft-dev-scan-ico" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {{ props.scanning ? t('transfer.devices.discovering') : t('transfer.devices.discover') }}
      </button>
    </div>

    <!-- 跨网状态卡（P0-2）：任何状态都有一个明确下一步 -->
    <div
      v-if="props.relayCard"
      class="ft-relay-card"
      :class="`ft-relay-card--${props.relayCard.tone}`"
      data-testid="ft-relay-card"
    >
      <div class="ft-relay-card-head">
        <span class="ft-relay-card-title" data-testid="ft-relay-card-title">
          {{ t(props.relayCard.title) }}
        </span>
        <span
          v-if="props.relayCard.count > 0"
          class="ft-relay-card-count"
          data-testid="ft-relay-card-count"
        >
          {{ props.relayCard.count }}
        </span>
      </div>
      <p class="ft-relay-card-body" data-testid="ft-relay-card-body">
        {{ t(props.relayCard.body, props.relayCard.params) }}
      </p>
      <p v-if="props.relayCard.stale" class="ft-relay-card-stale" data-testid="ft-relay-card-stale">
        {{ t('transfer.relayCard.stale') }}
      </p>
      <p
        v-if="props.relayCard.roomHint"
        class="ft-relay-card-hint"
        data-testid="ft-relay-card-room-hint"
      >
        {{ t('transfer.relayCard.roomHint') }}
      </p>
      <div class="ft-relay-card-actions">
        <button
          v-if="props.relayCard.primary !== 'none'"
          class="ft-text-btn ft-text-btn--primary"
          data-testid="ft-relay-card-primary"
          @click="emit('relayAction', props.relayCard.primary)"
        >
          {{ t(RELAY_ACTION_KEYS[props.relayCard.primary]) }}
        </button>
        <button
          v-if="props.relayCard.secondary !== 'none'"
          class="ft-text-btn"
          data-testid="ft-relay-card-secondary"
          @click="emit('relayAction', props.relayCard.secondary)"
        >
          {{ t(RELAY_ACTION_KEYS[props.relayCard.secondary]) }}
        </button>
      </div>
    </div>

    <!-- 空态：发现缓存无节点 -->
    <div v-if="rows.length === 0" class="ft-dev-empty" data-testid="ft-peer-empty">
      <p>{{ t('transfer.devices.empty') }}</p>
      <p class="ft-dev-empty-hint" data-testid="ft-peer-relay-hint">
        {{ t('transfer.devices.relayEmptyHint') }}
      </p>
    </div>

    <!-- 设备行列表 -->
    <div v-else class="ft-dev-list">
      <div
        v-for="row in rows"
        :key="row.nodeId"
        class="ft-dev-row"
        :class="{ 'ft-dev-row--active': row.isActive }"
      >
        <div class="ft-dev-info">
          <div class="ft-dev-name-line">
            <span class="ft-dot" :class="dotClass(row)"></span>
            <span class="ft-dev-name">{{ row.deviceName }}</span>
            <span class="ft-dev-fp">{{ shortFingerprint(row.nodeId) }}</span>
            <!-- 徽标组独立成组：窄面板下整组换行，避免单个徽标横向溢出压到右侧动作按钮 -->
            <span class="ft-dev-tags">
              <span v-if="row.paired" class="ft-dev-tag" data-testid="ft-dev-remote-tag">
                {{ t('transfer.devices.remote') }}
              </span>
              <span v-if="row.relay" class="ft-dev-tag" data-testid="ft-dev-relay-tag">
                {{ t('transfer.devices.relayTag') }}
              </span>
              <span v-if="row.isActive" class="ft-dev-tag ft-dev-tag--active">
                {{ t('transfer.devices.activeCurrent') }}
              </span>
              <span v-else-if="!row.fileTransfer" class="ft-dev-tag">
                {{ t('transfer.devices.capNone') }}
              </span>
              <!-- 连接方式标注：内网+外网 / 仅内网 / 仅外网（不把单一通路说成通用可达） -->
              <span
                v-if="row.fileTransfer"
                class="ft-dev-tag"
                :class="{ 'ft-dev-tag--wan': row.wanAvailable }"
                data-testid="ft-dev-relay-badge"
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
            </span>
          </div>
          <div class="ft-dev-meta">
            <template v-if="row.status === 'connected'">
              {{ t('transfer.devices.connected')
              }}<template v-if="row.addr"> · {{ row.addr }}</template>
              <span
                v-if="transportLabel(row)"
                class="ft-dev-transport"
                :class="{ 'ft-dev-transport--wan': row.transport === 'wan-relay' }"
                data-testid="ft-dev-transport"
                >{{ transportLabel(row) }}</span
              >
            </template>
            <template v-else-if="row.status === 'connecting'">
              {{ t('transfer.devices.connectingHint') }}
            </template>
            <template v-else-if="row.recent">
              {{ t('transfer.devices.recentSeen')
              }}<template v-if="row.addr"> · {{ row.addr }}</template>
            </template>
            <template v-else>
              {{ t('transfer.devices.online')
              }}<template v-if="row.addr"> · {{ row.addr }}</template>
            </template>
            <!-- T20：上次传输形态（断开后仍保留，决定下次重连默认路径） -->
            <span
              v-if="lastTransportLabel(row)"
              class="ft-dev-transport"
              :class="{ 'ft-dev-transport--wan': row.lastTransport === 'wan-relay' }"
              data-testid="ft-dev-last-transport"
              >{{ lastTransportLabel(row) }}</span
            >
          </div>
          <!-- 拨号终态反馈：按分类给可操作出路（行内错误，非全局 toast） -->
          <div v-if="row.dialError" class="ft-dev-error" data-testid="ft-dev-dial-error">
            {{ dialErrorText(row) }}
          </div>
        </div>

        <div class="ft-dev-actions">
          <!-- T23：直达发送 = 连接（如需要）+ 选文件 + 发送，不再先回设备页 -->
          <button
            class="ft-text-btn ft-text-btn--primary"
            :disabled="!row.fileTransfer || row.status === 'connecting'"
            :title="t('transfer.devices.sendFile')"
            data-testid="ft-dev-send"
            @click="emit('send', row.nodeId)"
          >
            {{ t('transfer.devices.sendFile') }}
          </button>
          <button
            v-if="row.status === 'connected' && !row.isActive"
            class="ft-text-btn"
            @click="emit('setActive', row.nodeId)"
          >
            {{ t('transfer.devices.setActive') }}
          </button>
          <button
            v-if="row.status === 'connected' && row.paired"
            class="ft-text-btn ft-text-btn--danger"
            :data-testid="`ft-dev-forget-${row.nodeId.slice(0, 8)}`"
            @click="emit('removeRemote', row.nodeId)"
          >
            {{ t('transfer.devices.removeRemote') }}
          </button>
          <button
            v-if="row.status === 'connected'"
            class="ft-text-btn ft-text-btn--danger"
            @click="emit('disconnect', row.nodeId)"
          >
            {{ t('transfer.devices.disconnect') }}
          </button>
          <span v-else-if="row.status === 'connecting'" class="ft-dev-connecting">
            {{ t('transfer.devices.connecting') }}
          </span>
          <template v-else>
            <!-- 无任何候选：不猜路径，给「等重新发现」的显性说明 -->
            <span
              v-if="row.connectionModes === 'none'"
              class="ft-dev-connecting"
              data-testid="ft-dev-no-endpoint"
            >
              {{ t('transfer.devices.modeNoneHint') }}
            </span>
            <!-- 内网入口（默认路径；LAN 失败后不自动切外网） -->
            <button
              v-if="row.lanAvailable"
              class="ft-text-btn"
              :class="{ 'ft-text-btn--primary': !row.relayOnlyRecommended }"
              :disabled="!row.fileTransfer"
              :title="t('transfer.devices.connectLanHint')"
              data-testid="ft-dev-connect-lan"
              @click="emit('connect', row.nodeId)"
            >
              {{ t('transfer.devices.connectLan') }}
            </button>
            <!-- 外网入口：显式点击才经中继（relay-only，不回退 LAN） -->
            <button
              v-if="row.wanAvailable"
              class="ft-text-btn"
              :class="{ 'ft-text-btn--primary': row.relayOnlyRecommended || !row.lanAvailable }"
              :disabled="!row.fileTransfer"
              :title="t('transfer.devices.connectWanHint')"
              data-testid="ft-dev-connect-wan"
              @click="emit('retryRelayOnly', row.nodeId)"
            >
              {{ t('transfer.devices.connectWan') }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <div class="ft-dev-hint">{{ t('transfer.devices.trustHint') }}</div>
  </div>
</template>

<style scoped>
.ft-relay-card {
  flex-shrink: 0;
  margin: 8px 0 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #3a3f47);
  background: var(--surface-secondary, rgba(255, 255, 255, 0.03));
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ft-relay-card--progress {
  border-color: rgba(120, 170, 255, 0.45);
}
.ft-relay-card--warn {
  border-color: rgba(255, 190, 90, 0.5);
}
.ft-relay-card--ok {
  border-color: rgba(90, 200, 140, 0.5);
}
.ft-relay-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ft-relay-card-title {
  font-weight: 600;
  font-size: 0.9rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ft-relay-card-count {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 0.78rem;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(90, 200, 140, 0.18);
}
.ft-relay-card-body,
.ft-relay-card-stale,
.ft-relay-card-hint {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
  color: var(--text-secondary, #a4a9b3);
}
.ft-relay-card-stale {
  color: var(--warning, #e5b567);
}
.ft-relay-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 头部新增「我的设备」后共三个动作；窄面板允许换行，不挤掉标题 */
.ft-dev-head {
  flex-wrap: wrap;
  row-gap: 6px;
}
</style>
