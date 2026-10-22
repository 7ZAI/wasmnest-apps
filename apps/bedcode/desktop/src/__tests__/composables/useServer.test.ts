/**
 * useServer 测试
 *
 * 覆盖可纯逻辑测部分：状态加载、生命周期命令参数构造、网络配置、
 * 指标轮询（含 60 条历史上限）、轮询定时器启停。
 * 事件监听（listen）不在本 composable 中，无需 mock。
 * 注 1：status 为模块级共享 ref，beforeEach 中重置，保证用例相互隔离。
 * 注 2：pollMetrics 未从 useServer 导出（仅内部 setInterval 使用），
 *       轮询行为统一通过 startPolling + fake timers 驱动验证。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logger } from '@/utils/frontendLogger'
import { useServer } from '@/composables/useServer'
import {
  makeServerStatusInfo,
  makeNetworkConfig,
  makeServerMetrics,
} from '@/__tests__/fixtures/server'

// Mock Tauri invoke
const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}))

// 取数自 fixtures 工厂（与 Rust DTO 字段对齐，见 fixtures/server.ts 文件头）
const statusInfo = makeServerStatusInfo()
const networkConfig = makeNetworkConfig()
const metrics = makeServerMetrics()

let consoleWarnSpy: ReturnType<typeof vi.spyOn>
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

describe('useServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // useServer 的 onUnmounted 在非组件上下文调用会触发 Vue warning，先静音再实例化
    consoleWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    // 重置模块级共享 status，并清理上一个用例遗留的轮询定时器
    const s = useServer()
    s.status.value = 'stopped'
    s.stopPolling()
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('should initialize with defaults', () => {
      const server = useServer()

      expect(server.status.value).toBe('stopped')
      expect(server.port.value).toBe(8765)
      expect(server.localIps.value).toEqual([])
      expect(server.metrics.value).toBeNull()
      expect(server.metricsHistory.value).toEqual([])
      expect(server.networkConfig.value).toBeNull()
    })
  })

  describe('loadStatus', () => {
    it('should fetch server status and update state', async () => {
      mockInvoke.mockResolvedValueOnce(statusInfo)

      const server = useServer()
      await server.loadStatus()

      expect(mockInvoke).toHaveBeenCalledWith('get_server_status')
      expect(server.status.value).toBe('running')
      expect(server.port.value).toBe(9000)
      expect(server.localIps.value).toEqual(['192.168.1.5', '127.0.0.1'])
    })

    it('should keep state unchanged on failure', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('backend down'))

      const server = useServer()
      server.status.value = 'starting'
      await server.loadStatus()

      expect(server.status.value).toBe('starting')
      expect(server.port.value).toBe(8765)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load server status:',
        expect.any(Error),
      )
    })
  })

  describe('config commands', () => {
    it('updatePort should pass the new port to backend and update local state', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)

      const server = useServer()
      await server.updatePort(9999)

      expect(mockInvoke).toHaveBeenCalledWith('update_server_port', { port: 9999 })
      expect(server.port.value).toBe(9999)
    })
  })

  describe('network config', () => {
    it('loadNetworkConfig should fetch and sync port/autoStart', async () => {
      mockInvoke.mockResolvedValueOnce(networkConfig)

      const server = useServer()
      await server.loadNetworkConfig()

      expect(mockInvoke).toHaveBeenCalledWith('get_server_network_config')
      expect(server.networkConfig.value).toEqual(networkConfig)
      expect(server.port.value).toBe(9000)
    })

    it('loadNetworkConfig should keep state on failure', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('no config'))

      const server = useServer()
      await server.loadNetworkConfig()

      expect(server.networkConfig.value).toBeNull()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load network config:',
        expect.any(Error),
      )
    })

    it('resetNetworkConfig should return the reset config and sync state', async () => {
      const reset = { ...networkConfig, port: 8765, auto_start: true }
      mockInvoke.mockResolvedValueOnce(reset)

      const server = useServer()
      const result = await server.resetNetworkConfig()

      expect(mockInvoke).toHaveBeenCalledWith('reset_server_network_config')
      expect(result).toEqual(reset)
      expect(server.networkConfig.value).toEqual(reset)
      expect(server.port.value).toBe(8765)
    })
  })

  describe('metrics polling', () => {
    it('should skip polling when server is not running', async () => {
      vi.useFakeTimers()

      const server = useServer()
      server.status.value = 'stopped'
      server.startPolling()
      await vi.advanceTimersByTimeAsync(2000)

      expect(mockInvoke).not.toHaveBeenCalledWith('get_server_metrics')
      expect(server.metrics.value).toBeNull()
      server.stopPolling()
    })

    it('should record metrics with timestamp entry', async () => {
      vi.useFakeTimers()
      mockInvoke.mockResolvedValue(metrics)

      const server = useServer()
      server.status.value = 'running'
      server.startPolling()
      await vi.advanceTimersByTimeAsync(2000)

      expect(mockInvoke).toHaveBeenCalledWith('get_server_metrics')
      expect(server.metrics.value).toEqual(metrics)
      expect(server.metricsHistory.value).toEqual([
        {
          timestamp_secs: 120,
          ws_sent_rate: 1.5,
          ws_recv_rate: 2.5,
        },
      ])
      server.stopPolling()
    })

    it('should cap history at 60 entries', async () => {
      vi.useFakeTimers()
      mockInvoke.mockResolvedValue(metrics)

      const server = useServer()
      server.status.value = 'running'
      server.startPolling()
      // 61 次轮询，超过 60 条上限后最旧条目被丢弃
      await vi.advanceTimersByTimeAsync(2000 * 61)

      expect(server.metricsHistory.value).toHaveLength(60)
      expect(server.metricsHistory.value[59].timestamp_secs).toBe(120)
      server.stopPolling()
    })

    it('should swallow polling errors silently and recover on next poll', async () => {
      vi.useFakeTimers()
      // 预挂 handler 消费 rejected promise，避免 unhandled rejection 干扰 fake timers 微任务队列
      const rejection = Promise.reject(new Error('metrics unavailable'))
      rejection.catch(() => {})
      mockInvoke.mockReturnValueOnce(rejection)
      mockInvoke.mockResolvedValue(metrics)

      const server = useServer()
      server.status.value = 'running'
      server.startPolling()

      // 第一次轮询失败：错误被静默吞掉，metrics 保持 null
      await vi.advanceTimersByTimeAsync(2000)
      expect(server.metrics.value).toBeNull()

      // 第二次轮询恢复正常
      await vi.advanceTimersByTimeAsync(2000)
      expect(server.metrics.value).toEqual(metrics)
      expect(server.metricsHistory.value).toHaveLength(1)
      server.stopPolling()
    })

    it('should poll on interval and stopPolling should stop', async () => {
      vi.useFakeTimers()
      mockInvoke.mockResolvedValue(metrics)

      const server = useServer()
      server.status.value = 'running'
      server.startPolling()

      await vi.advanceTimersByTimeAsync(2000)
      expect(mockInvoke).toHaveBeenCalledWith('get_server_metrics')
      expect(server.metricsHistory.value).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(4000)
      expect(server.metricsHistory.value).toHaveLength(3)

      server.stopPolling()
      const callCount = mockInvoke.mock.calls.length
      await vi.advanceTimersByTimeAsync(6000)
      expect(mockInvoke.mock.calls.length).toBe(callCount)
    })
  })
})
