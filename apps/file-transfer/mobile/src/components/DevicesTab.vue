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
import type { DeviceRow } from '../composables/deviceState'
import {
  parseRemotePeerLink,
  type RemotePeerLink,
  type RemotePeerLinkError,
} from '../utils/pairingLink'
import ScanRadar from './ScanRadar.vue'
import ScanPanel from './ScanPanel.vue'

type Translate = (key: string, params?: Record<string, any>) => string

const props = defineProps<{
  rows: DeviceRow[]
  /** 探索发现进行中（雷达转动、按钮转 spinner、防重复点击） */
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

const t = props.t

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
const addText = ref('')
const addError = ref<RemotePeerLinkError | null>(null)
/** 扫码面板（相机路径；与粘贴共用同一解析） */
const scanOpen = ref(false)

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

function closeAddRemote(): void {
  addOpen.value = false
  addError.value = null
}

/** 扫码成功：与粘贴同一落点（父级设备缓存），关闭两个面板 */
function onScanned(link: RemotePeerLink): void {
  scanOpen.value = false
  addOpen.value = false
  addText.value = ''
  addError.value = null
  emit('add-remote', link)
}

// ==================== 行内文案 ====================

/** 传输形态文案（宿主 transport 词表；未知形态不渲染） */
function transportLabel(row: DeviceRow): string {
  if (row.transport === 'lan-direct') return t('transfer.devices.transportLan')
  if (row.transport === 'wan-relay') return t('transfer.devices.transportWan')
  return ''
}

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
  <div class="fv2-page">
    <!-- 扫码添加远程设备（相机路径；fixed 全屏取景） -->
    <ScanPanel v-if="scanOpen" :t="t" @link="onScanned" @close="scanOpen = false" />

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
                  <span v-if="row.isActive" class="fv2-device-tag fv2-device-tag--active">
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
                    >{{ transportLabel(row) }}</span
                  >
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
        <p class="fv2-trust-hint">{{ t('transfer.devices.trustHint') }}</p>
      </div>
    </template>

    <!-- 添加远程设备（底部弹层：贴触发点出现，不顶走列表位置） -->
    <div v-if="addOpen" class="fv2-sheet-mask" @click.self="closeAddRemote">
      <div
        class="fv2-sheet"
        data-testid="mobile-remote-panel"
        :style="{ paddingBottom: `calc(1rem + ${sheetBottomInset}px)` }"
      >
        <div class="fv2-sheet-head">
          <h3 class="fv2-sheet-title">{{ t('transfer.devices.addRemote') }}</h3>
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
        <div class="fv2-sheet-actions">
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
      </div>
    </div>
  </div>
</template>
