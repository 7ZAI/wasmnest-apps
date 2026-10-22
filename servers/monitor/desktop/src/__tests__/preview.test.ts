import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PreviewCard from '../preview/PreviewCard.vue'
import type { AppPreviewEnv } from '../entry'
import { metrics, snapshot } from './fixtures'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function makeEnv(overrides: Partial<AppPreviewEnv> = {}): AppPreviewEnv {
  return {
    appId: 'com.wasmnest.monitor',
    appInvoke: vi.fn(async () =>
      snapshot({
        a: metrics({ calls_total: 8, calls_in_flight: 1, memory_peak_bytes: 2048 }),
        b: metrics({ trap_reasons: { other: 1 } }),
      }),
    ) as AppPreviewEnv['appInvoke'],
    appStorageGet: vi.fn(async () => undefined),
    locale: 'zh-CN',
    theme: 'light',
    ...overrides,
  }
}

describe('PreviewCard（多任务卡片只读预览面）', () => {
  it('一次取数后展示摘要；不轮询、不写存储', async () => {
    vi.useFakeTimers()
    const env = makeEnv()
    const wrapper = mount(PreviewCard, { props: { env } })

    await flushPromises()
    expect(env.appInvoke).toHaveBeenCalledTimes(1)
    const values = wrapper.findAll('.mnpv-value').map((node) => node.text())
    // 顺序：插件数 / 调用总数 / 在飞 / Trap / 内存峰值合计
    expect(values).toEqual(['2', '8', '1', '1', '2.00 KiB'])

    await vi.advanceTimersByTimeAsync(5000)
    expect(env.appInvoke).toHaveBeenCalledTimes(1)
    expect(env.appStorageGet).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('命令失败：诚实空态 + 无可聚焦控件', async () => {
    const env = makeEnv({
      appInvoke: vi.fn(async () => {
        throw new Error('denied')
      }),
    })
    const wrapper = mount(PreviewCard, { props: { env } })

    await flushPromises()
    expect(wrapper.text()).toContain('指标不可读')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('a[href]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('零插件是合法空快照：显示「暂无 wasm」，不与读取失败混淆', async () => {
    const env = makeEnv({
      appInvoke: vi.fn(async () => snapshot({})) as AppPreviewEnv['appInvoke'],
    })
    const wrapper = mount(PreviewCard, { props: { env } })

    await flushPromises()
    expect(wrapper.text()).toContain('暂无 wasm')
    expect(wrapper.text()).not.toContain('指标不可读')
    wrapper.unmount()
  })

  it('卸载后晚到数据不写回已卸载组件', async () => {
    let resolveInvoke: ((value: unknown) => void) | undefined
    const env = makeEnv({
      appInvoke: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveInvoke = resolve
          }),
      ) as AppPreviewEnv['appInvoke'],
    })
    const wrapper = mount(PreviewCard, { props: { env } })
    await flushPromises()

    wrapper.unmount()
    expect(wrapper.element.isConnected).toBe(false)

    // 晚到结果被 disposed 挡掉：不写回、不抛错
    expect(() =>
      resolveInvoke?.(snapshot({ a: metrics({ calls_total: 99, memory_peak_bytes: 4096 }) })),
    ).not.toThrow()
    await flushPromises()
    expect(wrapper.element.isConnected).toBe(false)
  })
})
