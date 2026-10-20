import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import MonitorView from '../components/MonitorView.vue'
import { makeContext, info, metrics, snapshot } from './fixtures'

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mountView(context: ReturnType<typeof makeContext>) {
  const wrapper = mount(MonitorView, {
    global: { provide: { pluginContext: context } },
  })
  mounted.push(wrapper)
  return wrapper
}

describe('MonitorView（桌面界面契约）', () => {
  it('成功态渲染 KPI / 插件卡 / 宿主维度段', async () => {
    const execute = vi.fn(async () =>
      snapshot(
        {
          'com.wasmnest.monitor': metrics(),
          'com.wasmnest.ai-chatbox': metrics({
            calls_total: 12,
            calls_in_flight: 2,
            memory_current_bytes: 512,
            memory_peak_bytes: 1024,
            quota: { memory_bytes: 2048 },
            trap_reasons: { fuel_exhausted: 1 },
          }),
        },
        { task: { jobsActive: 3 } },
      ),
    )
    const hostInvoke = vi.fn(async () => [
      info({ id: 'com.wasmnest.monitor', name: 'Monitor' }),
      info({ id: 'com.wasmnest.ai-chatbox', name: 'AI Chatbox' }),
    ])
    const wrapper = mountView(makeContext(execute, hostInvoke))

    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-view"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="monitor-plugin-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="monitor-plugin-com.wasmnest.ai-chatbox"]').exists()).toBe(
      true,
    )
    expect(wrapper.find('[data-testid="monitor-traps-com.wasmnest.ai-chatbox"]').text()).toContain(
      'monitor.trap.fuel_exhausted',
    )
    expect(wrapper.find('[data-testid="monitor-system-task"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="monitor-kpi-calls"]').text()).toContain('12')
    // 1s 轮询只发一次初始请求（后续定时器由用例卸载清理）
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('指标失败：显示明确错误与重试，不出空表（fail-visible）', async () => {
    const execute = vi.fn(async () => {
      throw new Error('metrics:read denied')
    })
    const wrapper = mountView(makeContext(execute))

    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="monitor-error"]').text()).toContain('metrics:read denied')
    expect(wrapper.find('[data-testid="monitor-plugin-list"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="monitor-empty"]').exists()).toBe(false)
  })

  it('宿主清单不可用：运行中数量显示 —（不把查不到说成 0），并给出降级提示', async () => {
    const execute = vi.fn(async () => snapshot({ 'com.wasmnest.a': metrics() }))
    const hostInvoke = vi.fn(async () => {
      throw new Error('registry unavailable')
    })
    const wrapper = mountView(makeContext(execute, hostInvoke))

    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-kpi-plugins"]').text()).toContain('running=—')
    expect(wrapper.find('[data-testid="monitor-host-warning"]').exists()).toBe(true)
  })

  it('空快照：显示诚实空态而不是错误', async () => {
    const execute = vi.fn(async () => snapshot({}))
    const wrapper = mountView(makeContext(execute, async () => []))

    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="monitor-error"]').exists()).toBe(false)
  })

  it('卸载后停止轮询（定时器不活过组件）', async () => {
    vi.useFakeTimers()
    const execute = vi.fn(async () => snapshot({ a: metrics() }))
    const wrapper = mountView(makeContext(execute, async () => []))

    await vi.advanceTimersByTimeAsync(0)
    expect(execute).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(execute).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    mounted.pop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('错误后点重试：恢复成功态并清除错误', async () => {
    let fail = true
    const execute = vi.fn(async () => {
      if (fail) throw new Error('denied')
      return snapshot({ a: metrics() })
    })
    const wrapper = mountView(makeContext(execute, async () => []))

    await flushPromises()
    expect(wrapper.find('[data-testid="monitor-error"]').exists()).toBe(true)

    fail = false
    await wrapper.find('[data-testid="monitor-error-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="monitor-plugin-list"]').exists()).toBe(true)
  })
})
