/**
 * Monitor 桌面「整页页签 + 提供方面板」+ 台账角色过滤 行为锁
 *
 * 需求（spec `.scratch/2026-10-22-monitor-system-service` §4 / §5，用户 2026-10-22 修正）：
 * - 面板来源 = 宿主清单 `contributes.monitorPanels`（未激活应用也可列）；
 * - **整页页签**：页头标题位变成「监控主页 + 各提供方面板」页签，点击切换整个页面，
 *   面板不再作为监控页内的一块分区展示；
 * - **没有应用注册 = 什么都不显示**：页签条不出现，只保留标题；
 * - 默认落在监控主页，不自动装载第一个面板；
 * - 装载走宿主中介 `context.mountMonitorPanel(root, appId, panelId)`，monitor 不 import
 *   他人 bundle；装载失败 = 点名 + 重试，切换页签先卸载旧实例；
 * - monitor 卸载时销毁面板；
 * - 台账过滤（全部 / 服务 / 应用）只影响展示，取数仍全量。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { MonitorPanelHandle } from '../entry'
import MonitorView from '../components/MonitorView.vue'
import { info, makeContext, metrics, snapshot } from './fixtures'

const mounted: ReturnType<typeof mount>[] = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  vi.restoreAllMocks()
})

function mountView(context: ReturnType<typeof makeContext>) {
  const wrapper = mount(MonitorView, { global: { provide: { pluginContext: context } } })
  mounted.push(wrapper)
  return wrapper
}

/** 面板装载器桩：记录调用，返回可观测卸载的句柄 */
function panelMounter() {
  const unmount = vi.fn(async () => {})
  const calls: Array<{ appId: string; panelId: string; root: HTMLElement }> = []
  const fn = vi.fn(async (root: HTMLElement, appId: string, panelId: string) => {
    calls.push({ appId, panelId, root })
    return { unmount } satisfies MonitorPanelHandle
  })
  return { fn, calls, unmount }
}

function withPanels(
  id: string,
  name: string,
  panels: Array<{ id: string; title: string; order?: number }>,
  kind = 'business-app',
) {
  return info({ id, name, kind, contributes: { monitorPanels: panels } })
}

const metricsOnly = async () => snapshot({ 'com.wasmnest.monitor': metrics() })

describe('Monitor 整页页签（提供方面板由宿主中介装载）', () => {
  it('页签按 order 排序（缺省 100），监控主页排第一且默认选中', async () => {
    const mounter = panelMounter()
    const hostInvoke = async () => [
      withPanels('com.wasmnest.b', 'Provider B', [{ id: 'usage', title: 'Usage', order: 20 }]),
      withPanels('com.wasmnest.a', 'Provider A', [
        { id: 'health', title: 'Health' },
        { id: 'latency', title: 'Latency', order: 10 },
      ]),
    ]
    const wrapper = mountView(makeContext(metricsOnly, hostInvoke, mounter.fn))
    await flushPromises()

    const tabs = wrapper.findAll('[data-testid="monitor-page-tabs"] [role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['monitor.title', 'Latency', 'Usage', 'Health'])
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    // 默认在监控主页：不预先装载任何面板
    expect(mounter.fn).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="monitor-panels"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="monitor-page-title"]').exists()).toBe(false)
  })

  it('点面板页签 → 整页切到面板（监控主页内容消失）；点回主页 → 卸载面板', async () => {
    const mounter = panelMounter()
    const hostInvoke = async () => [
      withPanels('com.wasmnest.a', 'Provider A', [{ id: 'usage', title: 'Usage' }]),
    ]
    const wrapper = mountView(makeContext(metricsOnly, hostInvoke, mounter.fn))
    await flushPromises()

    await wrapper.find('[data-testid="monitor-page-tab-com.wasmnest.a-usage"]').trigger('click')
    await flushPromises()

    expect(mounter.calls).toHaveLength(1)
    expect(mounter.calls[0]).toMatchObject({ appId: 'com.wasmnest.a', panelId: 'usage' })
    // 面板容器是宿主提供的 DOM 节点（monitor 只拿容器 + 句柄）
    expect(mounter.calls[0].root.classList.contains('mn-panel-root')).toBe(true)
    expect(wrapper.find('[data-testid="monitor-panels"]').exists()).toBe(true)
    // 整页切换：监控主页的仪表区不再渲染
    expect(wrapper.find('[data-testid="monitor-plugin-list"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="monitor-live"]').exists()).toBe(false)

    await wrapper.find('[data-testid="monitor-page-tab-monitor"]').trigger('click')
    await flushPromises()

    expect(mounter.unmount).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="monitor-panels"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="monitor-live"]').exists()).toBe(true)
  })

  it('没有应用注册 → 什么都不显示：无页签条、无面板区，标题照常', async () => {
    const mounter = panelMounter()
    const hostInvoke = async () => [withPanels('com.wasmnest.a', 'Provider A', [])]
    const wrapper = mountView(makeContext(metricsOnly, hostInvoke, mounter.fn))
    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-page-tabs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="monitor-panels"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="monitor-page-title"]').text()).toBe('monitor.title')
    expect(mounter.fn).not.toHaveBeenCalled()
  })

  it('宿主未注入装载器（旧宿主）→ 显性提示不支持，不静默空面板', async () => {
    const hostInvoke = async () => [
      withPanels('com.wasmnest.a', 'Provider A', [{ id: 'usage', title: 'Usage' }]),
    ]
    const wrapper = mountView(makeContext(metricsOnly, hostInvoke))
    await flushPromises()

    await wrapper.find('[data-testid="monitor-page-tab-com.wasmnest.a-usage"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="monitor-panel-error"]').text()).toContain(
      'monitor.panels.unsupported',
    )
  })

  it('装载失败 → 点名面板 + 错误详情 + 重试；重试成功后清除错误', async () => {
    const unmount = vi.fn(async () => {})
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider bundle missing'))
      .mockResolvedValueOnce({ unmount })
    const hostInvoke = async () => [
      withPanels('com.wasmnest.a', 'Provider A', [{ id: 'usage', title: 'Usage' }]),
    ]
    const wrapper = mountView(makeContext(metricsOnly, hostInvoke, fn))
    await flushPromises()

    await wrapper.find('[data-testid="monitor-page-tab-com.wasmnest.a-usage"]').trigger('click')
    await flushPromises()
    await flushPromises()

    const error = wrapper.find('[data-testid="monitor-panel-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('monitor.panels.failed(title=Usage)')
    expect(error.text()).toContain('provider bundle missing')

    await error.find('button').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(fn).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="monitor-panel-error"]').exists()).toBe(false)
  })

  it('切换页签先卸载旧实例；monitor 卸载时销毁当前面板', async () => {
    const unmountFirst = vi.fn(async () => {})
    const unmountSecond = vi.fn(async () => {})
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ unmount: unmountFirst })
      .mockResolvedValueOnce({ unmount: unmountSecond })
    const hostInvoke = async () => [
      withPanels('com.wasmnest.a', 'Provider A', [
        { id: 'health', title: 'Health', order: 10 },
        { id: 'usage', title: 'Usage', order: 20 },
      ]),
    ]
    const wrapper = mountView(makeContext(metricsOnly, hostInvoke, fn))
    await flushPromises()

    await wrapper.find('[data-testid="monitor-page-tab-com.wasmnest.a-health"]').trigger('click')
    await flushPromises()
    expect(fn).toHaveBeenCalledTimes(1)

    await wrapper.find('[data-testid="monitor-page-tab-com.wasmnest.a-usage"]').trigger('click')
    await flushPromises()

    expect(unmountFirst).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(expect.any(HTMLElement), 'com.wasmnest.a', 'usage')

    wrapper.unmount()
    await flushPromises()
    expect(unmountSecond).toHaveBeenCalledTimes(1)
  })

  it('快速切页签：晚到的旧实例自卸，不覆盖新句柄', async () => {
    const staleUnmount = vi.fn(async () => {})
    const freshUnmount = vi.fn(async () => {})
    let resolveStale!: (handle: MonitorPanelHandle) => void
    const stalePending = new Promise<MonitorPanelHandle>((resolve) => {
      resolveStale = resolve
    })
    const fn = vi
      .fn()
      .mockImplementationOnce(() => stalePending)
      .mockResolvedValueOnce({ unmount: freshUnmount })
    const hostInvoke = async () => [
      withPanels('com.wasmnest.a', 'Provider A', [
        { id: 'health', title: 'Health', order: 10 },
        { id: 'usage', title: 'Usage', order: 20 },
      ]),
    ]
    const wrapper = mountView(makeContext(metricsOnly, hostInvoke, fn))
    await flushPromises()

    await wrapper.find('[data-testid="monitor-page-tab-com.wasmnest.a-health"]').trigger('click')
    await flushPromises()
    expect(fn).toHaveBeenCalledTimes(1) // 首个面板装载仍在途

    // 在旧装载未完成时切到第二页签
    await wrapper.find('[data-testid="monitor-page-tab-com.wasmnest.a-usage"]').trigger('click')
    await flushPromises()
    expect(fn).toHaveBeenCalledTimes(2)

    // 旧实例晚到：自己卸掉，且不得成为当前句柄
    resolveStale({ unmount: staleUnmount })
    await flushPromises()
    await flushPromises()
    expect(staleUnmount).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    await flushPromises()
    expect(freshUnmount).toHaveBeenCalledTimes(1)
    expect(staleUnmount).toHaveBeenCalledTimes(1)
  })
})

describe('Monitor 台账角色过滤（全部 / 服务 / 应用）', () => {
  it('服务过滤只列 L1/L2，应用过滤只列 L3；「全部」不丢任何行', async () => {
    const hostInvoke = async () => [
      info({ id: 'com.wasmnest.auth-center', name: 'Auth Center', kind: 'basic-service' }),
      info({ id: 'com.wasmnest.monitor', name: 'Monitor', kind: 'internal-business' }),
      info({ id: 'com.wasmnest.ai-chatbox', name: 'AI Chatbox', kind: 'business-app' }),
    ]
    const execute = async () =>
      snapshot({
        'com.wasmnest.auth-center': metrics(),
        'com.wasmnest.monitor': metrics(),
        'com.wasmnest.ai-chatbox': metrics(),
      })
    const wrapper = mountView(makeContext(execute, hostInvoke))
    await flushPromises()

    const rowIds = () =>
      wrapper
        .findAll('[data-testid^="monitor-plugin-com.wasmnest."]')
        .map((n) => n.attributes('data-testid')!.replace('monitor-plugin-', ''))

    expect(rowIds()).toEqual([
      'com.wasmnest.auth-center',
      'com.wasmnest.monitor',
      'com.wasmnest.ai-chatbox',
    ])

    await wrapper.find('[data-testid="monitor-filter-services"]').trigger('click')
    expect(rowIds()).toEqual(['com.wasmnest.auth-center', 'com.wasmnest.monitor'])

    await wrapper.find('[data-testid="monitor-filter-apps"]').trigger('click')
    expect(rowIds()).toEqual(['com.wasmnest.ai-chatbox'])

    await wrapper.find('[data-testid="monitor-filter-all"]').trigger('click')
    expect(rowIds()).toHaveLength(3)
  })
})
