/**
 * Monitor（移动）整页页签 + 台账角色过滤 行为锁
 *
 * 需求（spec `.scratch/2026-10-22-monitor-system-service` §4 / §5，用户 2026-10-22 修正）：
 * - 面板来源 = 宿主 `plugin_meta.monitorPanels`（未激活应用也可列）；
 * - **整页页签**：页头标题位变成「监控主页 + 各提供方面板」页签，点击切换整个页面，
 *   面板不再作为监控页内的一块分区展示；
 * - **没有应用注册 = 什么都不显示**：页签条不出现，只保留标题；
 * - 默认落在监控主页，不自动装载第一个面板；
 * - 装载走 `context.ui.mountMonitorPanel(root, appId, panelId)`（宿主中介）；
 * - 旧宿主未注入装载器 → 显性提示不支持；装载失败 → 点名 + 重试；
 * - 切换页签先卸载旧实例；monitor 卸载时销毁面板；
 * - 台账过滤只影响展示，快照仍是全量。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import MonitorView from '../components/MonitorView.vue'
import { makeContext, makeI18n, metrics, snapshot } from './fixtures'

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  vi.restoreAllMocks()
})

function mountView(context: ReturnType<typeof makeContext>) {
  const wrapper = mount(MonitorView, {
    global: { plugins: [makeI18n()], provide: { pluginContext: context } },
  })
  mounted.push(wrapper)
  return wrapper
}

function panelMounter() {
  const unmount = vi.fn(async () => {})
  const calls: Array<{ appId: string; panelId: string; root: HTMLElement }> = []
  const fn = vi.fn(async (root: HTMLElement, appId: string, panelId: string) => {
    calls.push({ appId, panelId, root })
    return { unmount }
  })
  return { fn, calls, unmount }
}

/** 快照：插件指标 + 宿主 plugin_meta（name / kind / monitorPanels） */
function snapshotWithMeta(
  plugins: string[],
  meta: Record<
    string,
    {
      name?: string
      kind?: string
      monitorPanels?: Array<{ id: string; title: string; order?: number }>
    }
  >,
  extra: Record<string, unknown> = {},
) {
  return snapshot(Object.fromEntries(plugins.map((id) => [id, metrics()])), {
    plugin_meta: meta,
    ...extra,
  })
}

describe('Monitor（移动）整页页签', () => {
  it('页签按 order 排序（缺省 100），监控主页排第一且默认选中、不预装载面板', async () => {
    const mounter = panelMounter()
    const execute = async () =>
      snapshotWithMeta(['com.wasmnest.a', 'com.wasmnest.b'], {
        'com.wasmnest.a': {
          name: 'Provider A',
          kind: 'business-app',
          monitorPanels: [
            { id: 'health', title: 'Health' },
            { id: 'latency', title: 'Latency', order: 10 },
          ],
        },
        'com.wasmnest.b': {
          name: 'Provider B',
          kind: 'business-app',
          monitorPanels: [{ id: 'usage', title: 'Usage', order: 20 }],
        },
      })
    const wrapper = mountView(makeContext(execute, mounter.fn))
    await flushPromises()

    const tabs = wrapper.findAll('[data-testid="mobile-monitor-page-tabs"] [role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['运行监控', 'Latency', 'Usage', 'Health'])
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(mounter.fn).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="mobile-monitor-panels"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mobile-monitor-page-title"]').exists()).toBe(false)
  })

  it('点面板页签 → 整页切到面板（监控主页内容消失）；点回主页 → 卸载面板', async () => {
    const mounter = panelMounter()
    const execute = async () =>
      snapshotWithMeta(['com.wasmnest.a'], {
        'com.wasmnest.a': {
          name: 'Provider A',
          kind: 'business-app',
          monitorPanels: [{ id: 'usage', title: 'Usage' }],
        },
      })
    const wrapper = mountView(makeContext(execute, mounter.fn))
    await flushPromises()

    await wrapper
      .find('[data-testid="mobile-monitor-page-tab-com.wasmnest.a-usage"]')
      .trigger('click')
    await flushPromises()

    expect(mounter.calls).toHaveLength(1)
    expect(mounter.calls[0]).toMatchObject({ appId: 'com.wasmnest.a', panelId: 'usage' })
    expect(mounter.calls[0].root.classList.contains('mnm-panel-root')).toBe(true)
    expect(wrapper.find('[data-testid="mobile-monitor-panels"]').exists()).toBe(true)
    // 整页切换：监控主页的仪表区不再渲染
    expect(wrapper.find('[data-testid="mobile-monitor-live"]').exists()).toBe(false)

    await wrapper.find('[data-testid="mobile-monitor-page-tab-monitor"]').trigger('click')
    await flushPromises()

    expect(mounter.unmount).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="mobile-monitor-panels"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mobile-monitor-live"]').exists()).toBe(true)
  })

  it('没有面板声明 → 什么都不显示：无页签条、无面板区，标题照常', async () => {
    const mounter = panelMounter()
    const execute = async () =>
      snapshotWithMeta(['com.wasmnest.a'], {
        'com.wasmnest.a': { name: 'Provider A', kind: 'business-app' },
      })
    const wrapper = mountView(makeContext(execute, mounter.fn))
    await flushPromises()

    expect(wrapper.find('[data-testid="mobile-monitor-page-tabs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mobile-monitor-panels"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mobile-monitor-page-title"]').text()).toBe('运行监控')
    expect(mounter.fn).not.toHaveBeenCalled()
  })

  it('旧宿主未注入 ui.mountMonitorPanel → 显性提示不支持（不抛 TypeError）', async () => {
    const execute = async () =>
      snapshotWithMeta(['com.wasmnest.a'], {
        'com.wasmnest.a': {
          name: 'Provider A',
          kind: 'business-app',
          monitorPanels: [{ id: 'usage', title: 'Usage' }],
        },
      })
    const wrapper = mountView(makeContext(execute))
    await flushPromises()

    await wrapper
      .find('[data-testid="mobile-monitor-page-tab-com.wasmnest.a-usage"]')
      .trigger('click')
    await flushPromises()

    const error = wrapper.find('[data-testid="mobile-monitor-panel-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('当前宿主不支持自定义监控面板')
    expect(error.text()).not.toContain('undefined')
  })

  it('装载失败 → 点名 + 重试；重试成功后清除错误', async () => {
    const unmount = vi.fn(async () => {})
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider bundle missing'))
      .mockResolvedValueOnce({ unmount })
    const execute = async () =>
      snapshotWithMeta(['com.wasmnest.a'], {
        'com.wasmnest.a': {
          name: 'Provider A',
          kind: 'business-app',
          monitorPanels: [{ id: 'usage', title: 'Usage' }],
        },
      })
    const wrapper = mountView(makeContext(execute, fn))
    await flushPromises()

    await wrapper
      .find('[data-testid="mobile-monitor-page-tab-com.wasmnest.a-usage"]')
      .trigger('click')
    await flushPromises()
    await flushPromises()

    const error = wrapper.find('[data-testid="mobile-monitor-panel-error"]')
    expect(error.text()).toContain('面板「Usage」装载失败')
    expect(error.text()).toContain('provider bundle missing')

    await error.find('button').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="mobile-monitor-panel-error"]').exists()).toBe(false)
  })

  it('切换页签先卸载旧实例；monitor 卸载时销毁当前面板', async () => {
    const unmountFirst = vi.fn(async () => {})
    const unmountSecond = vi.fn(async () => {})
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ unmount: unmountFirst })
      .mockResolvedValueOnce({ unmount: unmountSecond })
    const execute = async () =>
      snapshotWithMeta(['com.wasmnest.a'], {
        'com.wasmnest.a': {
          name: 'Provider A',
          kind: 'business-app',
          monitorPanels: [
            { id: 'health', title: 'Health', order: 10 },
            { id: 'usage', title: 'Usage', order: 20 },
          ],
        },
      })
    const wrapper = mountView(makeContext(execute, fn))
    await flushPromises()

    await wrapper
      .find('[data-testid="mobile-monitor-page-tab-com.wasmnest.a-health"]')
      .trigger('click')
    await flushPromises()
    expect(fn).toHaveBeenCalledTimes(1)

    await wrapper
      .find('[data-testid="mobile-monitor-page-tab-com.wasmnest.a-usage"]')
      .trigger('click')
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
    let resolveStale!: (handle: { unmount(): Promise<void> }) => void
    const stalePending = new Promise<{ unmount(): Promise<void> }>((resolve) => {
      resolveStale = resolve
    })
    const fn = vi
      .fn()
      .mockImplementationOnce(() => stalePending)
      .mockResolvedValueOnce({ unmount: freshUnmount })
    const execute = async () =>
      snapshotWithMeta(['com.wasmnest.a'], {
        'com.wasmnest.a': {
          name: 'Provider A',
          kind: 'business-app',
          monitorPanels: [
            { id: 'health', title: 'Health', order: 10 },
            { id: 'usage', title: 'Usage', order: 20 },
          ],
        },
      })
    const wrapper = mountView(makeContext(execute, fn))
    await flushPromises()

    await wrapper
      .find('[data-testid="mobile-monitor-page-tab-com.wasmnest.a-health"]')
      .trigger('click')
    await flushPromises()
    expect(fn).toHaveBeenCalledTimes(1) // 首个面板装载仍在途

    await wrapper
      .find('[data-testid="mobile-monitor-page-tab-com.wasmnest.a-usage"]')
      .trigger('click')
    await flushPromises()
    expect(fn).toHaveBeenCalledTimes(2)

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

describe('Monitor（移动）台账角色过滤', () => {
  it('服务过滤只列 L1/L2，应用过滤只列 L3；「全部」不丢任何行', async () => {
    const execute = async () =>
      snapshotWithMeta(
        ['com.wasmnest.auth-center', 'com.wasmnest.monitor', 'com.wasmnest.ai-chatbox'],
        {
          'com.wasmnest.auth-center': { name: 'Auth Center', kind: 'basic-service' },
          'com.wasmnest.monitor': { name: 'Monitor', kind: 'internal-business' },
          'com.wasmnest.ai-chatbox': { name: 'AI Chatbox', kind: 'business-app' },
        },
      )
    const wrapper = mountView(makeContext(execute))
    await flushPromises()

    const rowIds = () =>
      wrapper
        .findAll('[data-testid^="mobile-monitor-plugin-com.wasmnest."]')
        .map((n) => n.attributes('data-testid')!.replace('mobile-monitor-plugin-', ''))

    expect(rowIds()).toHaveLength(3)

    await wrapper.find('[data-testid="mobile-monitor-filter-services"]').trigger('click')
    expect(rowIds()).toEqual(['com.wasmnest.auth-center', 'com.wasmnest.monitor'])

    await wrapper.find('[data-testid="mobile-monitor-filter-apps"]').trigger('click')
    expect(rowIds()).toEqual(['com.wasmnest.ai-chatbox'])

    await wrapper.find('[data-testid="mobile-monitor-filter-all"]').trigger('click')
    expect(rowIds()).toHaveLength(3)
  })
})
