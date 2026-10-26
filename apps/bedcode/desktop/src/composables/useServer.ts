/**
 * Server Management Composable
 *
 * 服务器状态 / 指标 / 端口与网络配置的只读与配置面。
 *
 * 启停由宿主应用界面租约驱动（service-leases）：打开应用界面即持有
 * `net.transport`，关闭最后一个界面即停播。本 composable 不再提供
 * start / stop / restart / auto-start —— 对应的宿主命令已退役。
 */
import { ref, onUnmounted } from 'vue'
import { logger } from '@/utils/frontendLogger'
import { invoke } from '@tauri-apps/api/core'

/** 服务器状态 */
export type ServerStatus = 'stopped' | 'starting' | 'running'

/** 服务器状态信息 */
export interface ServerStatusInfo {
  status: ServerStatus
  port: number
  local_ips: string[]
  /** 运行时长（秒）；服务器从未启动时为 null（Rust Option<u64> 恒序列化） */
  uptime_secs: number | null
}

/** 网络配置 — Actix Web + WebSocket 参数 */
export interface NetworkConfig {
  port: number
  auto_start: boolean
  prevent_sleep: boolean
  workers: number
  keep_alive_secs: number
  client_request_timeout_secs: number
  client_disconnect_timeout_secs: number
  max_connections: number
  backlog: number
  tcp_nodelay: boolean
  shutdown_timeout_secs: number
  ws_max_frame_size_kb: number
  ws_max_message_size_mb: number
  /** 服务器性能监控采集总开关（默认关闭） */
  metrics_enabled: boolean
}

/** 服务器性能指标 */
export interface ServerMetrics {
  uptime_secs: number
  connections: number
  total_http_requests: number
  http_requests_per_sec: number
  ws_messages_sent: number
  ws_messages_received: number
  ws_sent_rate: number
  ws_recv_rate: number
  cpu_usage_percent: number
  memory_usage_bytes: number
}

/** 带时间戳的指标（ECharts 时序图用） */
export interface TimestampedMetrics {
  timestamp_secs: number
  ws_sent_rate: number
  ws_recv_rate: number
}

const MAX_HISTORY = 60

/** 服务器状态单例 — 所有 useServer() 调用者共享，确保 Sidebar / ServerView 等组件状态同步 */
const status = ref<ServerStatus>('stopped')

export function useServer() {
  const port = ref(8765)
  const localIps = ref<string[]>([])
  const metrics = ref<ServerMetrics | null>(null)
  const metricsHistory = ref<TimestampedMetrics[]>([])
  const networkConfig = ref<NetworkConfig | null>(null)

  let pollTimer: ReturnType<typeof setInterval> | null = null

  /** 加载服务器状态 */
  async function loadStatus() {
    try {
      const info: ServerStatusInfo = await invoke('get_server_status')
      status.value = info.status
      port.value = info.port
      localIps.value = info.local_ips
    } catch (e) {
      logger.error('Failed to load server status:', e)
    }
  }

  /** 更新端口配置（下次传输面启动时生效；当前监听不热切端口） */
  async function updatePort(newPort: number) {
    await invoke('update_server_port', { port: newPort })
    port.value = newPort
  }

  /** 加载网络配置 */
  async function loadNetworkConfig() {
    try {
      const config: NetworkConfig = await invoke('get_server_network_config')
      networkConfig.value = config
      port.value = config.port
    } catch (e) {
      logger.error('Failed to load network config:', e)
    }
  }

  /** 重置网络配置为默认值（下次传输面启动时生效） */
  async function resetNetworkConfig(): Promise<NetworkConfig> {
    const config: NetworkConfig = await invoke('reset_server_network_config')
    networkConfig.value = config
    port.value = config.port
    return config
  }

  /** 轮询指标 */
  async function pollMetrics() {
    if (status.value !== 'running') return
    try {
      const m: ServerMetrics = await invoke('get_server_metrics')
      metrics.value = m

      const entry: TimestampedMetrics = {
        timestamp_secs: m.uptime_secs,
        ws_sent_rate: m.ws_sent_rate,
        ws_recv_rate: m.ws_recv_rate,
      }
      metricsHistory.value.push(entry)
      if (metricsHistory.value.length > MAX_HISTORY) {
        metricsHistory.value.shift()
      }
    } catch {
      // 忽略轮询错误
    }
  }

  /** 开始轮询 */
  function startPolling() {
    stopPolling()
    pollTimer = setInterval(pollMetrics, 2000)
  }

  /** 停止轮询 */
  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  onUnmounted(() => {
    stopPolling()
  })

  return {
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
  }
}
