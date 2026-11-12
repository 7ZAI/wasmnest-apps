<script setup lang="ts">
/**
 * PeerDevicesPanel — 附近设备面板（自绘，替代旧「在线设备切换下拉」）
 *
 * 列出全部发现的 WasmNest 节点：已连接 / 连接中 / 未连接三态可区分，
 * 拨号失败按分类给可操作出路（T20：仅经中继 / 打开中继 / 重新添加）；
 * 已连接设备可断开、可设为当前活跃对端；无传输能力节点可见但不可连接。
 * 纯展示组件：状态由 usePeerDevices 派生的 rows 传入，操作以事件上抛。
 */
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { DeviceRow, DialFailureCode } from '../composables/deviceState'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const props = defineProps<{
  rows: DeviceRow[]
  /** 探索发现进行中（扫描按钮转 spinner、防重复点击） */
  scanning?: boolean
}>()

const emit = defineEmits<{
  connect: [nodeId: string]
  /** 手动「尝试外网」：只在有 relay 候选且用户显式点击时纳入 relay（§4.9） */
  retryWan: [nodeId: string]
  /** 仅经中继：跳过 LAN 候选直接拨 relay（T20 §4.2） */
  retryRelayOnly: [nodeId: string]
  disconnect: [nodeId: string]
  setActive: [nodeId: string]
  /** 打开「添加远程设备」连接串输入（T12） */
  addRemote: []
  /** 打开「我的设备」：本机连接串 / 外网接入（T21） */
  myDevice: []
  /** 移除手动添加的远程设备（T12） */
  removeRemote: [nodeId: string]
  /** 探索发现：重新扫描同网节点（父组件负责调 query-peer 并维护 scanning 态） */
  scan: []
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
      <!-- 探索发现：主动重新扫描同网节点；扫描中转 spinner 防重复发起 -->
      <button
        class="ft-text-btn ft-dev-scan-btn"
        :disabled="props.scanning"
        :title="t('transfer.devices.scan')"
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
        {{ props.scanning ? t('transfer.devices.scanning') : t('transfer.devices.scan') }}
      </button>
      <!-- 我的设备：生成连接串 / 配置本机外网接入（T21，不依赖其它应用） -->
      <button
        class="ft-text-btn ft-dev-scan-btn"
        :title="t('transfer.devices.myDevice')"
        data-testid="ft-my-device-open"
        @click="emit('myDevice')"
      >
        {{ t('transfer.devices.myDevice') }}
      </button>
      <!-- 添加远程设备：粘贴连接串（无摄像头场景；T12） -->
      <button
        class="ft-text-btn ft-dev-scan-btn"
        :title="t('transfer.devices.addRemote')"
        data-testid="ft-remote-add"
        @click="emit('addRemote')"
      >
        + {{ t('transfer.devices.addRemote') }}
      </button>
    </div>

    <!-- 空态：发现缓存无节点 -->
    <div v-if="rows.length === 0" class="ft-dev-empty" data-testid="ft-peer-empty">
      {{ t('transfer.devices.empty') }}
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
            <span v-if="row.paired" class="ft-dev-tag" data-testid="ft-dev-remote-tag">
              {{ t('transfer.devices.remote') }}
            </span>
            <span v-if="row.isActive" class="ft-dev-tag ft-dev-tag--active">
              {{ t('transfer.devices.activeCurrent') }}
            </span>
            <span v-else-if="!row.fileTransfer" class="ft-dev-tag">
              {{ t('transfer.devices.capNone') }}
            </span>
            <!-- T20：跨网能力小徽标（有 relay 候选 = 可跨网，仅内网 = 需重新配对） -->
            <span
              v-if="row.fileTransfer"
              class="ft-dev-tag"
              :class="{ 'ft-dev-tag--wan': row.wanAvailable }"
              data-testid="ft-dev-relay-badge"
            >
              {{
                row.wanAvailable ? t('transfer.devices.hasRelay') : t('transfer.devices.lanOnly')
              }}
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
              {{ t('transfer.devices.connecting') }}
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
            <!-- 失败后主入口：「仅经中继」（LAN 失败 + 有 relay 候选；T20 §4.2） -->
            <button
              v-if="row.relayOnlyRecommended"
              class="ft-text-btn ft-text-btn--primary"
              :disabled="!row.fileTransfer"
              :title="t('transfer.devices.relayOnlyHint')"
              data-testid="ft-dev-try-relay-only"
              @click="emit('retryRelayOnly', row.nodeId)"
            >
              {{ t('transfer.devices.relayOnly') }}
            </button>
            <!-- 手动「尝试外网」：仅存在 relay 候选时给入口；不自动切换（§4.9） -->
            <button
              v-if="row.wanAvailable"
              class="ft-text-btn"
              :disabled="!row.fileTransfer"
              :title="t('transfer.devices.tryWanHint')"
              data-testid="ft-dev-try-wan"
              @click="emit('retryWan', row.nodeId)"
            >
              {{ t('transfer.devices.tryWan') }}
            </button>
            <button
              class="ft-text-btn"
              :class="{ 'ft-text-btn--primary': !row.relayOnlyRecommended }"
              :disabled="!row.fileTransfer"
              @click="emit('connect', row.nodeId)"
            >
              {{ t('transfer.devices.connect') }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <div class="ft-dev-hint">{{ t('transfer.devices.trustHint') }}</div>
  </div>
</template>

<style scoped>
/* 头部新增「我的设备」后共三个动作；窄面板允许换行，不挤掉标题 */
.ft-dev-head {
  flex-wrap: wrap;
  row-gap: 6px;
}
</style>
