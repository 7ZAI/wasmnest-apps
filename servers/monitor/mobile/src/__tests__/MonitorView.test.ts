import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import MonitorView from '../components/MonitorView.vue'
import { makeContext, makeI18n, metrics, snapshot } from './fixtures'

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mountView(context: ReturnType<typeof makeContext>) {
  const wrapper = mount(MonitorView, {
    global: {
      plugins: [makeI18n()],
      provide: { pluginContext: context },
    },
  })
  mounted.push(wrapper)
  return wrapper
}

describe('MonitorView（移动界面契约）', () => {
  it('成功态渲染 KPI / 插件卡；task 段按端裁剪', async () => {
    const execute = vi.fn(async () =>
      snapshot(
        {
          'com.wasmnest.monitor': metrics(),
          'com.wasmnest.ai-chatbox': metrics({
            calls_total: 6,
            trap_reasons: { fuel_exhausted: 1 },
          }),
        },
        { task: { jobsActive: 3 } },
      ),
    )
    const wrapper = mountView(makeContext(execute))

    await flushPromises()

    expect(wrapper.find('[data-testid="mobile-monitor-view"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mobile-monitor-plugin-list"]').exists()).toBe(true)
    expect(
      wrapper.find('[data-testid="mobile-monitor-plugin-com.wasmnest.ai-chatbox"]').exists(),
    ).toBe(true)
    expect(wrapper.text()).toContain('燃料耗尽')
    expect(wrapper.find('[data-testid="mobile-monitor-kpi-calls"]').text()).toContain('6')
    expect(wrapper.find('[data-testid="mobile-monitor-system-list"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mobile-monitor-live"]').exists()).toBe(true)
  })

  it('宿主进程卡片与 wasm 指标分开：PSS / CPU / WebView 不可归属 / JS 堆', async () => {
    const execute = vi.fn(async () =>
      snapshot(
        { 'com.wasmnest.monitor': metrics({ memory_current_bytes: 1024 }) },
        {
          process: {
            available: true,
            cpuWindowMs: 1000,
            cores: 8,
            self: {
              pid: 1000,
              name: 'wasmnest-mobile',
              role: 'host',
              rssBytes: 300,
              pssBytes: 204800,
              cpuPercent: 12.5,
            },
            webview: {
              present: false,
              reason: 'not-a-child-process',
              processCount: 0,
              rssBytes: 0,
              pssBytes: null,
              cpuPercent: null,
              processes: [],
            },
            otherChildren: {
              processCount: 0,
              rssBytes: 0,
              pssBytes: 0,
              cpuPercent: 0,
              processes: [],
            },
            tree: { processCount: 1, rssBytes: 300, pssBytes: 204800, cpuPercent: 12.5 },
          },
        },
      ),
    )
    const wrapper = mountView(makeContext(execute))

    await flushPromises()

    const card = wrapper.find('[data-testid="mobile-monitor-process"]')
    expect(card.exists()).toBe(true)
    // 自身 PSS / CPU
    expect(wrapper.find('[data-testid="mobile-monitor-process-self"]').text()).toContain('200 KiB')
    expect(card.text()).toContain('12.5%')
    // WebView 不可归属：显式文案，不显示 0 字节
    expect(wrapper.find('[data-testid="mobile-monitor-process-webview"]').text()).toContain(
      '不可归属',
    )
    // 树合计的边界说明在场
    expect(wrapper.find('[data-testid="mobile-monitor-process-tree-note"]').text()).toContain(
      '不含 WebView',
    )
    // 与 wasm 台账同时在场（两块各说各的事实）
    expect(wrapper.find('[data-testid="mobile-monitor-plugin-list"]').exists()).toBe(true)
  })

  it('Chromium 自报 JS 堆：量化值照实标注', async () => {
    const execute = vi.fn(async () => snapshot({ a: metrics() }, { process: { available: true } }))
    const wrapper = mountView(makeContext(execute))
    await flushPromises()
    // happy-dom 没有 performance.memory → 这一行不出现（不伪造 0）
    expect(wrapper.find('[data-testid="mobile-monitor-process-heap"]').exists()).toBe(false)
  })

  it('Chromium 自报 JS 堆在场时：显示用量与量化标注', async () => {
    const scope = globalThis as unknown as { performance: Record<string, unknown> }
    const original = scope.performance.memory
    scope.performance.memory = {
      usedJSHeapSize: 10_000_000,
      totalJSHeapSize: 10_000_000,
      jsHeapSizeLimit: 1_530_000_000,
    }
    try {
      const execute = vi.fn(async () =>
        snapshot({ a: metrics() }, { process: { available: true, self: { pid: 1 } } }),
      )
      const wrapper = mountView(makeContext(execute))
      await flushPromises()
      const heap = wrapper.find('[data-testid="mobile-monitor-process-heap"]')
      expect(heap.exists()).toBe(true)
      expect(heap.text()).toContain('9.54 MiB')
      expect(heap.text()).toContain('量化')
    } finally {
      if (original === undefined) delete scope.performance.memory
      else scope.performance.memory = original
    }
  })

  it('版面顺序：平台总览 → 宿主进程 → 台账', async () => {
    const execute = vi.fn(async () =>
      snapshot({ 'com.wasmnest.monitor': metrics() }, { process: { available: true } }),
    )
    const wrapper = mountView(makeContext(execute))

    await flushPromises()

    const all = Array.from(wrapper.element.querySelectorAll('*'))
    const indexOf = (testid: string): number =>
      all.findIndex((el) => el instanceof Element && el.getAttribute('data-testid') === testid)
    const positions = [
      'mobile-monitor-overview',
      'mobile-monitor-process',
      'mobile-monitor-plugin-list',
    ].map(indexOf)
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('旧宿主没有 process 段：卡片显示「未提供」，不拿 0 冒充', async () => {
    const execute = vi.fn(async () => snapshot({ a: metrics() }))
    const wrapper = mountView(makeContext(execute))

    await flushPromises()

    expect(wrapper.find('[data-testid="mobile-monitor-process"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mobile-monitor-process-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mobile-monitor-process-self"]').exists()).toBe(false)
  })

  it('正常态不靠标题命名区块：hero 无 lead 时改用 aria-label，不留悬空 aria-labelledby', async () => {
    const execute = vi.fn(async () =>
      snapshot({
        'com.wasmnest.monitor': metrics(),
        'com.wasmnest.ai-chatbox': metrics({ calls_total: 6 }),
      }),
    )
    const wrapper = mountView(makeContext(execute))

    await flushPromises()

    expect(wrapper.find('#mnm-lead').exists()).toBe(false)
    const hero = wrapper.find('.mnm-hero')
    expect(hero.attributes('aria-labelledby')).toBeUndefined()
    expect(hero.attributes('aria-label')).toBe('运行监控')
  })

  it('指标失败：明确错误 + 重试，不叠加空表', async () => {
    const execute = vi.fn(async () => {
      throw new Error('metrics:read denied')
    })
    const wrapper = mountView(makeContext(execute))

    await flushPromises()

    expect(wrapper.find('[data-testid="mobile-monitor-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('metrics:read denied')
    expect(wrapper.find('[data-testid="mobile-monitor-empty"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mobile-monitor-live"]').exists()).toBe(false)
  })

  it('刷新失败但保留旧数据：隐藏实时徽章并显示过期标记', async () => {
    vi.useFakeTimers()
    let fail = false
    const execute = vi.fn(async () => {
      if (fail) throw new Error('metrics:read denied')
      return snapshot({ a: metrics() })
    })
    const wrapper = mountView(makeContext(execute))

    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="mobile-monitor-live"]').exists()).toBe(true)

    fail = true
    await vi.advanceTimersByTimeAsync(1000)

    expect(wrapper.find('[data-testid="mobile-monitor-stale"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mobile-monitor-live"]').exists()).toBe(false)
  })

  it('后台轮询不驱动刷新按钮加载态（不闪动弹跳）', async () => {
    vi.useFakeTimers()
    let release!: (value: unknown) => void
    const execute = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ a: metrics() }))
      .mockImplementationOnce(
        () =>
          new Promise<unknown>((resolve) => {
            release = resolve
          }),
      )
    const wrapper = mountView(makeContext(execute))

    await vi.advanceTimersByTimeAsync(0)
    const button = wrapper.find('[data-testid="mobile-monitor-refresh"]')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.find('.mnm-refresh-icon').classes()).not.toContain('is-spinning')

    await vi.advanceTimersByTimeAsync(1000)
    expect(execute).toHaveBeenCalledTimes(2)
    // 后台请求挂起期间：按钮保持空闲态，文案 / 禁用 / 图标都不随轮询变化
    const labels = button.find('.mnm-refresh-label').findAll('span')
    expect(labels[0].classes()).not.toContain('is-hidden')
    expect(labels[1].classes()).toContain('is-hidden')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.find('.mnm-refresh-icon').classes()).not.toContain('is-spinning')

    release(snapshot({ a: metrics() }))
    await flushPromises()
  })

  it('手动刷新期间按钮进入「刷新中…」态并恢复', async () => {
    vi.useFakeTimers()
    let release!: (value: unknown) => void
    const execute = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ a: metrics() }))
      .mockImplementationOnce(
        () =>
          new Promise<unknown>((resolve) => {
            release = resolve
          }),
      )
    const wrapper = mountView(makeContext(execute))

    await vi.advanceTimersByTimeAsync(0)
    const button = wrapper.find('[data-testid="mobile-monitor-refresh"]')
    await button.trigger('click')

    expect(execute).toHaveBeenCalledTimes(2)
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.find('.mnm-refresh-icon').classes()).toContain('is-spinning')
    const labels = button.find('.mnm-refresh-label').findAll('span')
    expect(labels[0].classes()).toContain('is-hidden')
    expect(labels[1].classes()).not.toContain('is-hidden')

    release(snapshot({ a: metrics() }))
    await flushPromises()

    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.attributes('aria-busy')).toBeUndefined()
    expect(labels[0].classes()).not.toContain('is-hidden')
    expect(labels[1].classes()).toContain('is-hidden')
  })

  it('空快照：诚实空态', async () => {
    const wrapper = mountView(makeContext(vi.fn(async () => snapshot({}))))

    await flushPromises()

    expect(wrapper.find('[data-testid="mobile-monitor-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mobile-monitor-error"]').exists()).toBe(false)
  })

  it('卸载后停止轮询', async () => {
    vi.useFakeTimers()
    const execute = vi.fn(async () => snapshot({ a: metrics() }))
    const wrapper = mountView(makeContext(execute))

    await vi.advanceTimersByTimeAsync(0)
    expect(execute).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    mounted.pop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('插件台账按需展开：折叠时不渲染详情，展开后出现完整指标', async () => {
    const wrapper = mountView(
      makeContext(vi.fn(async () => snapshot({ 'com.wasmnest.a': metrics({ calls_total: 9 }) }))),
    )
    await flushPromises()

    const details = wrapper.find('details')
    expect(details.exists()).toBe(true)
    expect(wrapper.find('.mnm-detail').exists()).toBe(false)

    ;(details.element as HTMLDetailsElement).open = true
    await details.trigger('toggle')
    await nextTick()

    expect(wrapper.find('.mnm-detail').exists()).toBe(true)
    expect(wrapper.find('.mnm-detail').text()).toContain('调用总数')
  })

  it('平台总览：合计内存 / 配额比例 / 计算负载；高占用进入 hero 提示', async () => {
    const execute = vi.fn(async () =>
      snapshot({
        'com.wasmnest.a': metrics({
          memory_current_bytes: 900,
          memory_peak_bytes: 950,
          quota: { memory_bytes: 1000 },
          fuel_consumed_total: 1200,
        }),
      }),
    )
    const wrapper = mountView(makeContext(execute))
    await flushPromises()

    expect(wrapper.find('[data-testid="mobile-monitor-overview"]').exists()).toBe(true)
    const memory = wrapper.find('[data-testid="mobile-monitor-overview-memory"]')
    expect(memory.text()).toContain('900 B')
    expect(memory.text()).toContain('90.0%')
    // 首个采样没有速率基线：诚实显示 —（不是 0）
    expect(wrapper.find('[data-testid="mobile-monitor-overview-compute"]').text()).toContain('—')
    // 90% ≥ 80% → hero 提示内存占用
    expect(wrapper.find('#mnm-lead').text()).toContain('平台内存占用 90.0%')
  })
})
