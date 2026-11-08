<script setup lang="ts">
/**
 * DevicesTab — 附近设备 tab
 *
 * 与旧版功能等价（PeerDevicesSheet 的内容改为一等 tab，不再收进 bottom sheet）：
 * 已连接 / 连接中 / 未连接三态可区分，拨号失败（拒绝/不可达）行内呈现，
 * 已连接可断开、可设为当前活跃对端，无传输能力节点可见但不可连接。
 * 头部提供「探索发现」重扫，尾部统一给出信任提示。
 * 纯展示：行状态由 usePeerDevices 派生的 rows 传入，操作以事件上抛。
 */
import { ref } from 'vue'
import type { DeviceRow } from '../composables/deviceState'
import {
  parseRemotePeerLink,
  type RemotePeerLink,
  type RemotePeerLinkError,
} from '../utils/pairingLink'

type Translate = (key: string, params?: Record<string, any>) => string

const props = defineProps<{
  rows: DeviceRow[]
  /** 探索发现进行中（按钮转 spinner、防重复点击） */
  scanning: boolean
  t: Translate
}>()

const emit = defineEmits<{
  (e: 'connect', nodeId: string): void
  /** 手动「尝试外网」：只在有 relay 候选且用户显式点击时纳入 relay（§4.9） */
  (e: 'retry-wan', nodeId: string): void
  (e: 'disconnect', nodeId: string): void
  (e: 'set-active', nodeId: string): void
  /** 连接串解析成功 → 父级落设备缓存（T12） */
  (e: 'add-remote', link: RemotePeerLink): void
  /** 移除手动添加的远程设备（T12） */
  (e: 'remove-remote', nodeId: string): void
  (e: 'scan'): void
}>()

// ==================== 添加远程设备（T12：无摄像头场景粘贴连接串） ====================

const addOpen = ref(false)
const addText = ref('')
const addError = ref<RemotePeerLinkError | null>(null)

const ADD_ERROR_KEYS: Record<RemotePeerLinkError, string> = {
  malformed: 'transfer.remote.errorMalformed',
  incomplete: 'transfer.remote.errorIncomplete',
  'address-invalid': 'transfer.remote.errorAddressInvalid',
}

function submitRemote(): void {
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

function openAddRemote(): void {
  addError.value = null
  addOpen.value = true
}

/** 传输形态文案（宿主 transport 词表；未知形态不渲染） */
function transportLabel(row: DeviceRow): string {
  if (row.transport === 'lan-direct') return t('transfer.devices.transportLan')
  if (row.transport === 'wan-relay') return t('transfer.devices.transportWan')
  return ''
}

const t = props.t

/** 短指纹（前 8 位） */
function shortFingerprint(nodeId: string): string {
  return nodeId.slice(0, 8)
}

/** 状态点样式：绿=已连接、琥珀=握手中、降饱和绿=在线未连接、灰=离线/无能力 */
function dotClass(row: DeviceRow): string {
  if (row.status === 'connected') return 'fv2-dev-dot--connected'
  if (row.status === 'connecting') return 'fv2-dev-dot--connecting'
  if (row.dialError === 'unreachable') return 'fv2-dev-dot--offline'
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
      return t('transfer.devices.connecting')
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
  <div class="flex-1 min-h-0 flex flex-col">
    <!-- 标题行：标题 + 副标题 + 行尾探索发现（空态时隐藏，避免与空态内标题/CTA 重复） -->
    <div v-if="rows.length > 0" class="fv2-section-head flex-shrink-0">
      <div class="flex-1 min-w-0">
        <h2 class="fv2-section-title">{{ t('transfer.devices.title') }}</h2>
        <p class="fv2-section-sub truncate">{{ t('transfer.v2.devices.subtitle') }}</p>
      </div>
      <button
        class="fv2-btn-text fv2-btn-text--accent flex-shrink-0"
        data-testid="mobile-remote-add"
        @click="openAddRemote()"
      >
        + {{ t('transfer.devices.addRemote') }}
      </button>
      <button
        class="fv2-btn-text fv2-btn-text--accent flex-shrink-0"
        :disabled="scanning"
        @click="emit('scan')"
      >
        <svg
          v-if="scanning"
          class="w-4 h-4 flex-shrink-0 fv2-scan-icon"
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
        <svg
          v-else
          class="w-4 h-4 flex-shrink-0"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {{ scanning ? t('transfer.devices.scanning') : t('transfer.devices.scan') }}
      </button>
    </div>

    <!-- 添加远程设备：粘贴连接串（T12；解析失败按原因给可操作文案） -->
    <div v-if="addOpen" class="fv2-remote-panel" data-testid="mobile-remote-panel">
      <textarea
        v-model="addText"
        class="fv2-remote-input"
        rows="3"
        :placeholder="t('transfer.remote.placeholder')"
        data-testid="mobile-remote-input"
        @input="addError = null"
      ></textarea>
      <p v-if="addError" class="fv2-device-error" data-testid="mobile-remote-error">
        {{ t(ADD_ERROR_KEYS[addError]) }}
      </p>
      <div class="flex items-center justify-end gap-2 pt-1">
        <button class="fv2-btn-text" @click="addOpen = false">
          {{ t('transfer.remote.cancel') }}
        </button>
        <button
          class="fv2-btn-text fv2-btn-text--accent"
          :disabled="addText.trim() === ''"
          data-testid="mobile-remote-confirm"
          @click="submitRemote()"
        >
          {{ t('transfer.remote.confirm') }}
        </button>
      </div>
    </div>

    <!-- 列表滚动区 -->
    <div class="flex-1 min-h-0 overflow-y-auto overscroll-behavior-none px-4 pb-2">
      <!-- 空态：发现缓存无节点 -->
      <div v-if="rows.length === 0" class="h-full flex flex-col">
        <div class="fv2-empty">
          <div class="fv2-empty-icon">
            <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M4.72 4.39a9.5 9.5 0 0114.56 0M7.82 5.52a6.5 6.5 0 018.36 0M10.8 7.21a3.5 3.5 0 012.4 0M12 20h.01"
              />
            </svg>
          </div>
          <p class="fv2-empty-title">{{ t('transfer.devices.title') }}</p>
          <p class="fv2-empty-hint">{{ t('transfer.devices.empty') }}</p>
          <button class="fv2-empty-action fv2-btn-primary" data-testid="mobile-remote-add" @click="openAddRemote()">
            + {{ t('transfer.devices.addRemote') }}
          </button>
          <button class="fv2-empty-action" @click="emit('scan')">
            <svg
              class="w-4 h-4 flex-shrink-0"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {{ t('transfer.devices.scan') }}
          </button>
        </div>
      </div>

      <template v-else>
        <div class="fv2-device-list">
          <div v-for="row in rows" :key="row.nodeId" class="fv2-device-row">
            <!-- 状态点：绿=已连接 / 琥珀=握手中 / 淡绿=在线未连接 / 灰=离线 -->
            <span
              class="fv2-dev-dot flex-shrink-0"
              :class="dotClass(row)"
              aria-hidden="true"
            ></span>

            <div class="flex-1 min-w-0">
              <div class="fv2-device-line">
                <span class="fv2-device-name truncate">{{ row.deviceName }}</span>
                <span class="fv2-device-fp">{{ shortFingerprint(row.nodeId) }}</span>
                <span v-if="row.paired" class="fv2-device-tag" data-testid="mobile-remote-tag">
                  {{ t('transfer.devices.remote') }}
                </span>
                <span v-if="row.isActive" class="fv2-device-tag">
                  {{ t('transfer.devices.activeCurrent') }}
                </span>
              </div>
              <p class="fv2-device-meta truncate">
                {{ metaText(row) }}
                <span
                  v-if="transportLabel(row)"
                  class="fv2-device-transport"
                  :class="{ 'fv2-device-transport--wan': row.transport === 'wan-relay' }"
                  data-testid="mobile-dev-transport"
                >{{ transportLabel(row) }}</span>
              </p>
              <!-- 拨号终态反馈：拒绝 / 不可达 -->
              <p v-if="row.dialError" class="fv2-device-error">
                {{
                  row.dialError === 'denied'
                    ? t('transfer.devices.denied')
                    : t('transfer.devices.unreachable')
                }}
              </p>
            </div>

            <!-- 行内操作：连接 / 设为当前 / 断开，全部为文字按钮（44px 命中区） -->
            <div class="fv2-device-actions">
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
                {{ t('transfer.devices.connecting') }}
              </span>
              <template v-else>
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
                  class="fv2-btn-text fv2-btn-text--accent"
                  :disabled="!row.fileTransfer"
                  @click="emit('connect', row.nodeId)"
                >
                  {{ t('transfer.devices.connect') }}
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- 信任提示（列表尾部一次性说明） -->
        <p class="fv2-device-meta px-1 pt-3 pb-2 fv2-trust-hint">
          {{ t('transfer.devices.trustHint') }}
        </p>
      </template>
    </div>
  </div>
</template>
