<template>
  <div class="h-full overflow-y-auto bg-[var(--bg-page)]" data-testid="server-view">
    <!-- ==================== 工具栏页头：左标题+状态，右只读提示+重置 ==================== -->
    <div class="wb-toolbar sticky top-0 z-10">
      <div class="flex items-center gap-2.5">
        <h1 class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]">
          {{ t('server.title') }}
        </h1>
        <span class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">{{
          statusText
        }}</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">{{
          t('server.surfaceHint')
        }}</span>
        <button
          class="wb-btn-ghost !text-[var(--text-secondary)]"
          @click="handleResetDefaults"
        >
          {{ t('server.resetDefaults') }}
        </button>
      </div>
    </div>

    <!-- ==================== 加载态 ==================== -->
    <div v-if="initializing" class="p-5 space-y-4 max-w-5xl mx-auto">
      <div
        v-for="i in 3"
        :key="i"
        class="h-24 rounded-[10px] animate-pulse bg-[var(--bg-card)] border border-[var(--border)]"
      ></div>
    </div>

    <!-- ==================== 内容分区 ==================== -->
    <div v-else class="p-5 max-w-5xl mx-auto space-y-6">
      <!-- ---------- SECTION: STATUS ---------- -->
      <section data-testid="server-section-status">
        <h2 class="wb-section-title">{{ t('server.sectionStatus') }}</h2>
        <div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px]">
          <div class="flex items-center justify-between px-4 h-12 border-b border-[var(--border)]">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" :class="dotClass"></span>
              <span
                class="text-[calc(13px*var(--ui-scale))] font-medium text-[var(--text-primary)]"
                data-testid="server-status-text"
                >{{ statusText }}</span
              >
            </div>
            <span class="wb-mono text-[var(--text-secondary)]">
              {{ status === 'running' ? formatUptime(uptimeTick) : '-' }}
            </span>
          </div>
          <div class="grid grid-cols-3 divide-x divide-[var(--border)]">
            <div class="px-4 py-3">
              <div class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] mb-1">
                {{ t('server.connections') }}
              </div>
              <div
                class="wb-mono text-[calc(12.5px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
              >
                {{ metrics?.connections ?? '-' }}
              </div>
            </div>
            <div class="px-4 py-3">
              <div class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] mb-1">
                {{ t('server.cpuUsage') }}
              </div>
              <div
                class="wb-mono text-[calc(12.5px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
              >
                {{ metrics ? `${metrics.cpu_usage_percent.toFixed(1)}%` : '-' }}
              </div>
            </div>
            <div class="px-4 py-3">
              <div class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] mb-1">
                {{ t('server.memoryUsage') }}
              </div>
              <div
                class="wb-mono text-[calc(12.5px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
              >
                {{ metrics ? formatMemory(metrics.memory_usage_bytes) : '-' }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ---------- SECTION: NETWORK ---------- -->
      <section data-testid="server-section-network">
        <h2 class="wb-section-title">{{ t('server.sectionNetwork') }}</h2>
        <div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px] px-4">
          <div class="flex items-center justify-between h-12 border-b border-[var(--border)]">
            <span class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)]">{{
              t('server.port')
            }}</span>
            <div class="flex items-center gap-3">
              <input
                v-model.number="portInput"
                type="number"
                min="1024"
                max="65535"
                data-testid="server-port-input"
                class="w-20 h-7 px-2 wb-mono rounded-[6px] border border-[var(--border-input)] bg-[var(--bg-input)] text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]"
                @keyup.enter="handleSavePort"
              />
              <button
                class="wb-btn-ghost !h-7 !px-3 !text-[calc(11.5px*var(--ui-scale))]"
                :class="!portDirty && '!text-[var(--text-tertiary)] cursor-not-allowed'"
                :disabled="!portDirty || savingPort"
                data-testid="server-port-save"
                @click="handleSavePort"
              >
                {{ t('server.portSave') }}
              </button>
              <span class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">{{ t('server.portHint') }}</span>
            </div>
          </div>
          <div
            class="flex items-center justify-between min-h-12 py-2 border-b border-[var(--border)]"
          >
            <span class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)]">{{
              t('server.localIp')
            }}</span>
            <div class="flex flex-wrap justify-end gap-x-4 gap-y-0.5">
              <span v-for="ip in localIps" :key="ip" class="wb-mono text-[var(--text-primary)]"
                >{{ ip }}:{{ port }}</span
              >
              <span
                v-if="localIps.length === 0"
                class="text-[calc(12.5px*var(--ui-scale))] text-[var(--text-tertiary)]"
                >-</span
              >
            </div>
          </div>
        </div>
      </section>

      <!-- ---------- SECTION: CONFIG ---------- -->
      <section v-if="networkConfig" data-testid="server-section-advanced">
        <div class="flex items-center justify-between mb-2">
          <h2 class="wb-section-title mb-0">
            {{ t('server.advancedConfig').toUpperCase() }}
          </h2>
          <button
            class="text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            data-testid="server-advanced-toggle"
            :aria-expanded="advExpanded"
            @click="advExpanded = !advExpanded"
          >
            {{ advExpanded ? t('server.collapse') : t('server.expand') }}
          </button>
        </div>
        <div
          v-show="advExpanded"
          class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px] overflow-hidden"
          data-testid="server-advanced-panel"
        >
          <div class="grid grid-cols-2 md:grid-cols-3 divide-x divide-y divide-[var(--border)]">
            <div v-for="field in advFields" :key="field.key" class="px-4 py-3">
              <div class="flex items-center gap-1.5 mb-1.5">
                <span class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">{{
                  field.label
                }}</span>
                <span
                  v-if="field.hint"
                  class="text-[calc(10px*var(--ui-scale))] text-[color:color-mix(in_srgb,var(--text-tertiary)_70%,transparent)]"
                  >{{ field.hint }}</span
                >
              </div>
              <span class="wb-mono text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
                {{
                  field.type === 'toggle'
                    ? (advConfig as any)[field.key]
                      ? t('server.toggleOn')
                      : t('server.toggleOff')
                    : (advConfig as any)[field.key]
                }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- ---------- SECTION: MONITORING ---------- -->
      <section data-testid="server-section-monitoring">
        <h2 class="wb-section-title">{{ t('server.monitoring').toUpperCase() }}</h2>
        <div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px] p-4">
          <div class="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            <div v-for="m in metricRows" :key="m.key">
              <div class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] mb-1">
                {{ m.label }}
              </div>
              <div
                class="wb-mono text-[calc(12.5px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
              >
                {{ m.value }}
              </div>
            </div>
          </div>
          <div class="border-t border-[var(--border)] pt-3">
            <h3 class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] mb-2">
              {{ t('server.wsThroughput') }}
            </h3>
            <VChart :option="chartOption" style="height: 220px; width: 100%" autoresize />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 服务器管理视图 — 桌面端服务器配置与监控
 * Warm Workbench 风格：STATUS/NETWORK/CONFIG/MONITORING 分区，图表颜色跟随主题变量
 */
import { onMounted, onUnmounted, computed, watch, ref } from 'vue'
import { useAppI18n } from '@/composables/useAppI18n'
import { useServer } from '@/composables/useServer'
import { useToast } from '@/composables/useToast'
import { showUserError } from '@/utils/userError'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([TitleComponent, TooltipComponent, LegendComponent, GridComponent, LineChart, CanvasRenderer])

const t = useAppI18n()
const toast = useToast()

const {
  status,
  port,
  localIps,
  metrics,
  metricsHistory,
  networkConfig,
  loadStatus,
  updatePort,
  startPolling,
  stopPolling,
  loadNetworkConfig,
  resetNetworkConfig,
} = useServer()

/** 首次加载未完成时显示骨架屏 */
const initializing = ref(true)

const portInput = ref(8765)

/** 后端端口刷新后同步输入框（loadStatus / updatePort 等操作完成后调用） */
function syncPortInput() {
  portInput.value = port.value
}

/** 端口输入与后端当前端口不一致（有未保存的修改） */
const portDirty = computed(() => portInput.value !== port.value)

/** 端口保存进行中（按钮 disabled） */
const savingPort = ref(false)

/**
 * 保存端口：持久化到配置文件 + 更新 supervisor 内存端口。
 *
 * 传输面由应用界面租约持有，端口只在下次服务启动时绑定；当前监听不热切端口。
 */
async function handleSavePort() {
  if (!portDirty.value) return
  savingPort.value = true
  try {
    await updatePort(portInput.value)
    toast.success(t('server.portSavedDelayed'))
  } catch (e) {
    showUserError(e, { retry: handleSavePort })
  } finally {
    savingPort.value = false
  }
}

const statusText = computed(() => {
  switch (status.value) {
    case 'running':
      return t('server.status.running')
    case 'starting':
      return t('server.status.starting')
    default:
      return t('server.status.stopped')
  }
})

const dotClass = computed(() =>
  status.value === 'running'
    ? 'bg-green-500'
    : status.value === 'starting'
      ? 'bg-yellow-500'
      : 'bg-red-500',
)

/** 运行时长本地计时 — 每秒刷新，不依赖后端轮询 */
const uptimeTick = ref(0)
let uptimeTimer: ReturnType<typeof setInterval> | null = null

watch(status, (val) => {
  if (uptimeTimer) {
    clearInterval(uptimeTimer)
    uptimeTimer = null
  }
  if (val === 'running' && metrics.value) {
    uptimeTick.value = metrics.value.uptime_secs
    uptimeTimer = setInterval(() => {
      uptimeTick.value++
    }, 1000)
  }
})

watch(metrics, (m) => {
  if (m && status.value === 'running' && !uptimeTimer) {
    uptimeTick.value = m.uptime_secs
    uptimeTimer = setInterval(() => {
      uptimeTick.value++
    }, 1000)
  }
})

/** 格式化运行时长 — HH:MM:SS */
function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/** 格式化内存 */
function formatMemory(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

/** 读取当前主题 CSS 变量（图表颜色跟随亮/暗模式） */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#1D1A14'
}

/** 监控指标行 — 空数据统一显示 - */
const metricRows = computed(() => [
  {
    key: 'uptime',
    label: t('server.uptime'),
    value: status.value === 'running' ? formatUptime(uptimeTick.value) : '-',
  },
  {
    key: 'connections',
    label: t('server.connections'),
    value: metrics.value ? String(metrics.value.connections) : '-',
  },
  {
    key: 'total',
    label: t('server.totalRequests'),
    value: metrics.value ? metrics.value.total_http_requests.toLocaleString() : '-',
  },
  {
    key: 'cpu',
    label: t('server.cpuUsage'),
    value: metrics.value ? `${metrics.value.cpu_usage_percent.toFixed(1)}%` : '-',
  },
  {
    key: 'mem',
    label: t('server.memoryUsage'),
    value: metrics.value ? formatMemory(metrics.value.memory_usage_bytes) : '-',
  },
  {
    key: 'rate',
    label: t('server.requestRate'),
    value: metrics.value ? `${metrics.value.http_requests_per_sec.toFixed(1)}/s` : '-',
  },
])

/** ECharts 时序图配置（颜色取自主题变量） */
const chartOption = computed(() => {
  const history = metricsHistory.value
  const times = history.map((h) => {
    const m = Math.floor(h.timestamp_secs / 60)
    const s = h.timestamp_secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  })
  const accent = cssVar('--color-primary')
  const success = cssVar('--color-success')

  return {
    tooltip: { trigger: 'axis' as const },
    legend: {
      data: [t('server.wsSentRate'), t('server.wsRecvRate')],
      top: 0,
      textStyle: { color: cssVar('--text-secondary') },
    },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category' as const,
      boundaryGap: false,
      data: times,
      axisLabel: { color: cssVar('--text-tertiary') },
    },
    yAxis: {
      type: 'value' as const,
      name: 'msg/s',
      axisLabel: { color: cssVar('--text-tertiary') },
    },
    series: [
      {
        name: t('server.wsSentRate'),
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        itemStyle: { color: accent },
        areaStyle: { color: hexToRgba(accent, 0.1) },
        data: history.map((h) => h.ws_sent_rate.toFixed(2)),
      },
      {
        name: t('server.wsRecvRate'),
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        itemStyle: { color: success },
        areaStyle: { color: hexToRgba(success, 0.1) },
        data: history.map((h) => h.ws_recv_rate.toFixed(2)),
      },
    ],
  }
})

/** #RRGGBB → rgba(r,g,b,a) */
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** 高级配置折叠状态 — 默认展开（工作台气质，信息直接可见） */
const advExpanded = ref(true)

/** 高级配置只读视图（编辑入口在宿主设置 / config.properties；本页仅诊断） */
const advConfig = computed(() =>
  networkConfig.value
    ? {
        workers: networkConfig.value.workers,
        keep_alive_secs: networkConfig.value.keep_alive_secs,
        client_request_timeout_secs: networkConfig.value.client_request_timeout_secs,
        client_disconnect_timeout_secs: networkConfig.value.client_disconnect_timeout_secs,
        max_connections: networkConfig.value.max_connections,
        backlog: networkConfig.value.backlog,
        tcp_nodelay: networkConfig.value.tcp_nodelay,
        shutdown_timeout_secs: networkConfig.value.shutdown_timeout_secs,
        ws_max_frame_size_kb: networkConfig.value.ws_max_frame_size_kb,
        ws_max_message_size_mb: networkConfig.value.ws_max_message_size_mb,
      }
    : null,
)

/** 高级配置字段元数据 — 驱动网格渲染 */
const advFields = computed(() => [
  {
    key: 'workers',
    label: t('server.workers'),
    hint: t('server.workersHint'),
    type: 'number',
    min: 0,
    max: 64,
  },
  {
    key: 'keep_alive_secs',
    label: t('server.keepAlive'),
    hint: t('server.keepAliveHint'),
    type: 'number',
    min: 0,
    max: 300,
  },
  {
    key: 'client_request_timeout_secs',
    label: t('server.clientRequestTimeout'),
    hint: 's',
    type: 'number',
    min: 1,
    max: 120,
  },
  {
    key: 'client_disconnect_timeout_secs',
    label: t('server.clientDisconnectTimeout'),
    hint: 's',
    type: 'number',
    min: 1,
    max: 120,
  },
  {
    key: 'max_connections',
    label: t('server.maxConnections'),
    hint: t('server.maxConnectionsHint'),
    type: 'number',
    min: 1,
    max: 100000,
  },
  {
    key: 'backlog',
    label: t('server.backlog'),
    hint: '',
    type: 'number',
    min: 64,
    max: 8192,
  },
  { key: 'tcp_nodelay', label: t('server.tcpNodelay'), hint: '', type: 'toggle' },
  {
    key: 'shutdown_timeout_secs',
    label: t('server.shutdownTimeout'),
    hint: 's',
    type: 'number',
    min: 1,
    max: 300,
  },
  {
    key: 'ws_max_frame_size_kb',
    label: t('server.wsMaxFrameSize'),
    hint: t('server.wsMaxFrameSizeHint'),
    type: 'number',
    min: 1,
    max: 16384,
  },
  {
    key: 'ws_max_message_size_mb',
    label: t('server.wsMaxMessageSize'),
    hint: t('server.wsMaxMessageSizeHint'),
    type: 'number',
    min: 1,
    max: 512,
  },
])

/** 还原所有配置为默认值（下次传输面启动时生效） */
async function handleResetDefaults() {
  try {
    const defaults = await resetNetworkConfig()
    portInput.value = defaults.port
    toast.success(t('server.resetSuccess'))
  } catch (e) {
    showUserError(e)
  }
}

onMounted(async () => {
  try {
    await loadStatus()
    await loadNetworkConfig()
    syncPortInput()
    if (status.value === 'running') {
      startPolling()
    }
  } finally {
    initializing.value = false
  }
})

onUnmounted(() => {
  if (uptimeTimer) {
    clearInterval(uptimeTimer)
    uptimeTimer = null
  }
})

watch(status, (newVal) => {
  if (newVal === 'running') {
    startPolling()
  } else {
    stopPolling()
  }
})
</script>
