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
    expect(wrapper.find('[data-testid="monitor-live"]').exists()).toBe(true)
    // 1s 轮询只发一次初始请求（后续定时器由用例卸载清理）
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('宿主进程段与 wasm 台账分开展示：WebView 内存 / CPU 走独立面板', async () => {
    const execute = vi.fn(async () =>
      snapshot(
        {
          'com.wasmnest.monitor': metrics({
            memory_current_bytes: 1024,
            quota: { memory_bytes: 2048 },
          }),
        },
        {
          process: {
            available: true,
            cpuWindowMs: 1000,
            cores: 8,
            self: {
              pid: 1000,
              name: 'wasmnest-desktop',
              role: 'host',
              rssBytes: 300,
              pssBytes: 200,
              cpuPercent: 4,
            },
            webview: {
              present: true,
              processCount: 1,
              rssBytes: 614400,
              pssBytes: 307200,
              cpuPercent: 12.5,
              processes: [
                {
                  pid: 1001,
                  name: 'WebKitWebProces',
                  role: 'webview',
                  rssBytes: 614400,
                  pssBytes: 307200,
                  cpuPercent: 12.5,
                },
              ],
            },
            otherChildren: {
              processCount: 0,
              rssBytes: 0,
              pssBytes: 0,
              cpuPercent: 0,
              processes: [],
            },
            tree: { processCount: 2, rssBytes: 614700, pssBytes: 307400, cpuPercent: 16.5 },
          },
        },
      ),
    )
    const wrapper = mountView(makeContext(execute, async () => []))

    await flushPromises()

    // 两个口径各占一块：wasm 台账段 + 宿主进程面板（互不覆盖）
    expect(wrapper.find('[data-testid="monitor-plugin-list"]').exists()).toBe(true)
    const panel = wrapper.find('[data-testid="monitor-process"]')
    expect(panel.exists()).toBe(true)

    const webview = wrapper.find('[data-testid="monitor-process-webview"]')
    expect(webview.text()).toContain('300 KiB') // PSS 优先显示
    expect(webview.text()).toContain('12.5%')
    expect(wrapper.find('[data-testid="monitor-process-self"]').text()).toContain('200 B')
    expect(wrapper.find('[data-testid="monitor-process-tree"]').text()).toContain('600 KiB')
    // WebView 明细行：内核截断后的进程名原样透传
    expect(wrapper.find('[data-testid="monitor-process-list-webview"]').text()).toContain(
      'WebKitWebProces',
    )
    // 不是原始键名列表：process 段不进 SystemPanel
    expect(wrapper.find('[data-testid="monitor-system-process"]').exists()).toBe(false)
  })

  it('旧宿主没有 process 段：面板显示「未提供」，不拿 0 冒充', async () => {
    const execute = vi.fn(async () => snapshot({ a: metrics() }))
    const wrapper = mountView(makeContext(execute, undefined))

    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-process-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="monitor-process-webview"]').exists()).toBe(false)
  })

  it('WebView 不在进程树内（present=false）：显式标注，不当 0 字节', async () => {
    const execute = vi.fn(async () =>
      snapshot(
        { a: metrics() },
        {
          process: {
            available: true,
            cores: 8,
            self: {
              pid: 1000,
              name: 'host',
              role: 'host',
              rssBytes: 300,
              pssBytes: 200,
              cpuPercent: 1,
            },
            webview: {
              present: false,
              reason: 'no-webview-child-process',
              processCount: 0,
              processes: [],
            },
            tree: { processCount: 1, rssBytes: 300, pssBytes: 200, cpuPercent: 1 },
          },
        },
      ),
    )
    const wrapper = mountView(makeContext(execute, async () => []))

    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-process-note-webview"]').text()).toContain(
      'monitor.process.webviewAbsent',
    )
  })

  it('正常态不靠标题命名区块：hero 无 lead 时改用 aria-label，不留悬空 aria-labelledby', async () => {
    const execute = vi.fn(async () =>
      snapshot({
        'com.wasmnest.monitor': metrics(),
        'com.wasmnest.ai-chatbox': metrics({ calls_total: 4 }),
      }),
    )
    const hostInvoke = vi.fn(async () => [
      info({ id: 'com.wasmnest.monitor', name: 'Monitor' }),
      info({ id: 'com.wasmnest.ai-chatbox', name: 'AI Chatbox' }),
    ])
    const wrapper = mountView(makeContext(execute, hostInvoke))

    await flushPromises()

    // 一切正常 → 不渲染 lead 标题（仪表本身即结论）
    expect(wrapper.find('#monitor-lead').exists()).toBe(false)
    const hero = wrapper.find('.mn-hero')
    expect(hero.attributes('aria-labelledby')).toBeUndefined()
    expect(hero.attributes('aria-label')).toBe('monitor.title')
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
    // 失败时不得同时宣称「实时」
    expect(wrapper.find('[data-testid="monitor-live"]').exists()).toBe(false)
  })

  it('刷新失败但保留旧数据：隐藏实时徽章并显示过期标记', async () => {
    vi.useFakeTimers()
    let fail = false
    const execute = vi.fn(async () => {
      if (fail) throw new Error('metrics:read denied')
      return snapshot({ a: metrics() })
    })
    const wrapper = mountView(makeContext(execute, async () => []))

    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="monitor-live"]').exists()).toBe(true)

    fail = true
    await vi.advanceTimersByTimeAsync(1000)

    expect(wrapper.find('[data-testid="monitor-stale"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="monitor-live"]').exists()).toBe(false)
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
  it('服务角色可见：角色徽标 / 角色摘要，未就绪插件显示无运行时指标', async () => {
    const execute = vi.fn(async () =>
      snapshot({ 'com.wasmnest.monitor': metrics({ calls_total: 3 }) }),
    )
    const hostInvoke = vi.fn(async () => [
      info({ id: 'com.wasmnest.monitor', name: 'Monitor', kind: 'business-app' }),
      info({
        id: 'com.wasmnest.auth-center',
        name: 'Auth Center',
        kind: 'internal-business',
        pluginType: 'full',
        state: { state: 'error', error: 'auth center not registered' },
      }),
    ])
    const wrapper = mountView(makeContext(execute, hostInvoke))
    await flushPromises()

    // 运行中应用 ↑ 先于错误服务；错误服务不能被快照缺席吞掉
    const serviceRow = wrapper.find('[data-testid="monitor-plugin-com.wasmnest.auth-center"]')
    expect(serviceRow.exists()).toBe(true)
    expect(serviceRow.attributes('data-metrics-available')).toBe('false')
    expect(serviceRow.find('[data-testid="monitor-role-com.wasmnest.auth-center"]').text()).toBe(
      'monitor.role.internalBusiness',
    )
    // 应用行不出服务徽标；角色分布由筛选按钮计数表达（不再单列文字摘要）
    expect(wrapper.find('[data-testid="monitor-role-com.wasmnest.monitor"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="monitor-kpi-unavailable"]').text()).toBe(
      'monitor.kpi.pluginsUnavailable(n=1)',
    )
    // 错误态服务是确定性事实 → 立即出预警（比「需关注」更具体），hero 按预警计数
    expect(wrapper.find('#monitor-lead').text()).toContain('monitor.hero.alertsCritical(count=1)')
    expect(
      wrapper.find('[data-testid="monitor-alert-plugin-state:com.wasmnest.auth-center"]').exists(),
    ).toBe(true)

    // 选中未就绪服务：明确无指标，不显示一排零值
    await serviceRow.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="monitor-inspector"]').attributes('data-plugin-id')).toBe(
      'com.wasmnest.auth-center',
    )
    expect(wrapper.find('[data-testid="monitor-metrics-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('auth center not registered')
    expect(wrapper.find('[data-testid="monitor-inflight-com.wasmnest.auth-center"]').exists()).toBe(
      false,
    )
  })

  it('选择台账另一行：详情切换到该插件', async () => {
    const execute = vi.fn(async () =>
      snapshot({
        'com.wasmnest.a': metrics({ calls_total: 1 }),
        'com.wasmnest.b': metrics({ calls_total: 2 }),
      }),
    )
    const hostInvoke = vi.fn(async () => [
      info({ id: 'com.wasmnest.a', name: 'A' }),
      info({ id: 'com.wasmnest.b', name: 'B' }),
    ])
    const wrapper = mountView(makeContext(execute, hostInvoke))
    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-inspector"]').attributes('data-plugin-id')).toBe(
      'com.wasmnest.a',
    )

    await wrapper.find('[data-testid="monitor-plugin-com.wasmnest.b"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-inspector"]').attributes('data-plugin-id')).toBe(
      'com.wasmnest.b',
    )
    expect(wrapper.find('[data-testid="monitor-inspector"]').text()).toContain('com.wasmnest.b')
  })

  it('平台总览：合计内存 / 配额比例 / 内存排行，无越界时显示诚实空态', async () => {
    const execute = vi.fn(async () =>
      snapshot({
        'com.wasmnest.a': metrics({
          memory_current_bytes: 600,
          memory_peak_bytes: 800,
          quota: { memory_bytes: 1000 },
        }),
        'com.wasmnest.b': metrics({
          memory_current_bytes: 400,
          memory_peak_bytes: 500,
          quota: { memory_bytes: 1000 },
        }),
      }),
    )
    const hostInvoke = vi.fn(async () => [
      info({ id: 'com.wasmnest.a', name: 'Alpha' }),
      info({ id: 'com.wasmnest.b', name: 'Beta' }),
    ])
    const wrapper = mountView(makeContext(execute, hostInvoke))
    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-overview"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="monitor-overview-memory"]').text()).toContain('1000 B')
    expect(wrapper.find('[data-testid="monitor-overview-memory-ratio"]').text()).toBe('50.0%')
    // 排行按当前占用降序（Alpha 600 > Beta 400）
    const consumers = wrapper.findAll('.mn-consumer-row')
    expect(consumers).toHaveLength(2)
    expect(consumers[0].text()).toContain('Alpha')
    expect(consumers[1].text()).toContain('Beta')
    // 无越界：预警区出空态（不是空白 / 错误）
    expect(wrapper.find('[data-testid="monitor-alerts-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="monitor-alerts-empty"]').text()).toBe('monitor.alerts.empty')
  })

  it('平台内存连续越界 → 预警卡片 + hero 提示（去抖后升警）', async () => {
    vi.useFakeTimers()
    const execute = vi.fn(async () =>
      snapshot({
        a: metrics({
          memory_current_bytes: 300 * 1024 * 1024,
          quota: { memory_bytes: 4096 * 1024 * 1024 },
        }),
      }),
    )
    const wrapper = mountView(makeContext(execute, async () => []))

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.find('[data-testid="monitor-alert-platform-memory:-"]').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    const card = wrapper.find('[data-testid="monitor-alert-platform-memory:-"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('monitor.alerts.level.warning')
    expect(wrapper.find('#monitor-lead').text()).toContain('monitor.hero.alertsWarning')
    expect(wrapper.find('[data-testid="monitor-alerts-empty"]').exists()).toBe(false)
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
    const wrapper = mountView(makeContext(execute, async () => []))

    await vi.advanceTimersByTimeAsync(0)
    const button = wrapper.find('[data-testid="monitor-refresh"]')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.find('.mn-refresh-icon').classes()).not.toContain('is-spinning')

    await vi.advanceTimersByTimeAsync(1000)
    expect(execute).toHaveBeenCalledTimes(2)
    // 后台请求挂起期间：按钮保持空闲态，文案 / 禁用 / 图标都不随轮询变化
    const labels = button.find('.mn-refresh-label').findAll('span')
    expect(labels[0].classes()).not.toContain('is-hidden')
    expect(labels[1].classes()).toContain('is-hidden')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.attributes('aria-busy')).toBeUndefined()
    expect(button.find('.mn-refresh-icon').classes()).not.toContain('is-spinning')

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
    const wrapper = mountView(makeContext(execute, async () => []))

    await vi.advanceTimersByTimeAsync(0)
    const button = wrapper.find('[data-testid="monitor-refresh"]')
    await button.trigger('click')

    expect(execute).toHaveBeenCalledTimes(2)
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.find('.mn-refresh-icon').classes()).toContain('is-spinning')
    const labels = button.find('.mn-refresh-label').findAll('span')
    expect(labels[0].classes()).toContain('is-hidden')
    expect(labels[1].classes()).not.toContain('is-hidden')

    release(snapshot({ a: metrics() }))
    await flushPromises()

    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.attributes('aria-busy')).toBeUndefined()
    expect(labels[0].classes()).not.toContain('is-hidden')
    expect(labels[1].classes()).toContain('is-hidden')
  })

  it('预警设置改动经 KV 落盘（键名 / 值都归一化）', async () => {
    const execute = vi.fn(async () => snapshot({ a: metrics() }))
    const context = makeContext(execute, async () => [])
    const set = vi.fn(async () => {})
    ;(context.storage as unknown as { set: typeof set }).set = set
    const wrapper = mountView(context)
    await flushPromises()

    const notify = wrapper.find('[data-testid="monitor-alert-notify"]')
    expect(notify.exists()).toBe(true)
    await notify.setValue(false)
    await flushPromises()

    expect(set).toHaveBeenCalledTimes(1)
    const [key, value] = set.mock.calls[0] as unknown as [string, { notify: boolean }]
    expect(key).toBe('monitor.alertSettings.v1')
    expect(value.notify).toBe(false)
  })
})
