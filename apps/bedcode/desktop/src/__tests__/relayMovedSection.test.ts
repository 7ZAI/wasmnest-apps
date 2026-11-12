/**
 * RelayMovedSection 行为契约（T18 §5）
 *
 * - 只读：展示中心当前状态（地址数量 + 来源），不提供任何编辑控件；
 * - 失败可见：中心读取失败 → 显性错误（不显示「未配置」）；
 * - 降级可见：`source=cache` / `centerError` 必须上屏；
 * - 迁移失败可见：`{state:"failed"}` 必须提示重新导入；
 * - 入口：按钮经 `context.navigate('/network')` 跳转；旧宿主无该能力时显性提示。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import i18n from '@/i18n'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import RelayMovedSection from '@/components/RelayMovedSection.vue'

const t = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(`com.wasmnest.bedcode.${key}`, params ?? {})

interface Options {
  config?: Record<string, unknown> | Error
  migration?: Record<string, unknown> | Error
  navigate?: (path: string) => boolean
}

function makeContext(options: Options = {}): PluginContext {
  return {
    id: 'com.wasmnest.bedcode',
    i18n: {
      t,
      getI18n: () => i18n,
      registerMessages: vi.fn(),
    },
    commands: {
      execute: vi.fn(async (command: string) => {
        if (command === 'session.relay.config') {
          if (options.config instanceof Error) throw options.config
          return (
            options.config ?? {
              configured: true,
              relayAddrs: ['/dns4/relay.example.com/tcp/4001/p2p/12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H'],
              source: 'center',
              centerError: null,
            }
          )
        }
        if (command === 'session.relay.migration') {
          if (options.migration instanceof Error) throw options.migration
          return options.migration ?? { state: 'none' }
        }
        throw new Error(`unexpected command: ${command}`)
      }),
    },
    storage: { get: vi.fn(async () => undefined), set: vi.fn(async () => {}) },
    events: { on: () => ({ dispose() {} }), emit: vi.fn() },
    navigate: options.navigate ?? (() => true),
  } as unknown as PluginContext
}

async function mountSection(context: PluginContext): Promise<VueWrapper> {
  const wrapper = mount(RelayMovedSection, {
    global: {
      plugins: [i18n],
      provide: { pluginContext: context },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('只读状态与入口', () => {
  it('已配置：显示地址数量与来源，且不渲染编辑控件', async () => {
    const wrapper = await mountSection(makeContext())
    expect(wrapper.get('[data-testid="relay-moved-state"]').text()).toBe(
      t('relay.moved.configured', { count: 1, source: t('relay.moved.sourceCenter') }),
    )
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('未配置：显示空态（不是错误）', async () => {
    const wrapper = await mountSection(
      makeContext({ config: { configured: false, relayAddrs: [], source: 'center', centerError: null } }),
    )
    expect(wrapper.get('[data-testid="relay-moved-state"]').text()).toBe(t('relay.moved.empty'))
    expect(wrapper.find('[data-testid="relay-moved-load-error"]').exists()).toBe(false)
  })

  it('已配置但业务注册表关闭外网：状态显式标注（区分「未配置」与「关闭」）', async () => {
    const wrapper = await mountSection(
      makeContext({
        config: {
          configured: true,
          relayAddrs: ['/dns4/relay.example.com/tcp/4001/p2p/12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H'],
          source: 'center',
          centerError: null,
          allowWan: false,
        },
      }),
    )
    expect(wrapper.find('[data-testid="relay-moved-wan-disabled"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="relay-moved-state"]').text()).toContain(
      t('relay.moved.wanDisabled'),
    )
  })

  it('读取失败：显性报错，不显示「未配置」', async () => {
    const wrapper = await mountSection(makeContext({ config: new Error('centre down') }))
    const error = wrapper.get('[data-testid="relay-moved-load-error"]')
    expect(error.text()).toContain('centre down')
    expect(wrapper.find('[data-testid="relay-moved-state"]').exists()).toBe(false)
  })

  it('按钮经 context.navigate 跳 /network；旧宿主无能力时显性提示', async () => {
    const navigate = vi.fn(() => true)
    const wrapper = await mountSection(makeContext({ navigate }))
    await wrapper.get('[data-testid="relay-moved-open"]').trigger('click')
    expect(navigate).toHaveBeenCalledWith('/network')
    expect(wrapper.find('[data-testid="relay-moved-open-unavailable"]').exists()).toBe(false)

    const legacy = await mountSection(makeContext({ navigate: () => false }))
    await legacy.get('[data-testid="relay-moved-open"]').trigger('click')
    expect(legacy.find('[data-testid="relay-moved-open-unavailable"]').exists()).toBe(true)
  })
})

describe('降级与迁移失败可见', () => {
  it('中心不可用、正在用缓存：中心错误上屏', async () => {
    const wrapper = await mountSection(
      makeContext({
        config: {
          configured: true,
          relayAddrs: ['/dns4/relay.example.com/tcp/4001/p2p/12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H'],
          source: 'cache',
          centerError: 'api call host error: timeout',
        },
      }),
    )
    expect(wrapper.get('[data-testid="relay-moved-center-error"]').text()).toContain('timeout')
    expect(wrapper.get('[data-testid="relay-moved-state"]').text()).toContain(
      t('relay.moved.sourceCache'),
    )
  })

  it('迁移失败：提示重新导入并带出原因', async () => {
    const wrapper = await mountSection(
      makeContext({ migration: { state: 'failed', detail: 'version unsupported: 7' } }),
    )
    const alert = wrapper.get('[data-testid="relay-moved-migration-error"]')
    expect(alert.text()).toContain('version unsupported: 7')
    expect(alert.attributes('role')).toBe('alert')
  })

  it('迁移状态读不到不影响当前配置呈现（附加信息降级）', async () => {
    const wrapper = await mountSection(makeContext({ migration: new Error('kv locked') }))
    expect(wrapper.find('[data-testid="relay-moved-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="relay-moved-migration-error"]').exists()).toBe(false)
  })

  it('WAN 注册表读不到：原因上屏（策略按默认 true 继续）', async () => {
    const wrapper = await mountSection(
      makeContext({
        config: {
          configured: true,
          relayAddrs: [
            '/dns4/relay.example.com/tcp/4001/p2p/12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H',
          ],
          source: 'center',
          centerError: null,
          allowWan: true,
          wanPolicyError: 'wan policy unreadable: timeout',
        },
      }),
    )
    const warning = wrapper.get('[data-testid="relay-moved-wan-policy-error"]')
    expect(warning.text()).toContain('timeout')
    expect(wrapper.get('[data-testid="relay-moved-state"]').text()).toContain(
      t('relay.moved.sourceCenter'),
    )
  })
})
