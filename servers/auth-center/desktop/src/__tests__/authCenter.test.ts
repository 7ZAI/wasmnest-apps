/**
 * AuthCenterView 契约测试（挂载包组件级）
 *
 * 只断言**外部可观察行为**：三态渲染、原因上屏、失败态不被当成「未就位」、
 * 缺失字段渲染 `—`、接入应用与密钥代次的取数/动作接线、锚点存在。不测内部实现
 * （不 mock 内部模块，只按命令名路由假宿主）。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AuthCenterView from '../components/AuthCenterView.vue'
import PreviewCard from '../preview/PreviewCard.vue'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import type { AppPreviewEnv } from '../entry'
import type { CenterStatus } from '../types'

/** 与 appContext 同口径的 t()（页面只经 context.i18n.t 取文案） */
function translate(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
}

type Handler = (args?: Record<string, unknown>) => unknown

function makeContext(
  appInvoke: (command: string, ...args: unknown[]) => Promise<unknown>,
  hostInvoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> = vi.fn(
    async () => [],
  ),
) {
  return {
    id: 'com.wasmnest.auth-center',
    appInvoke,
    hostInvoke,
    storage: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    i18n: { t: translate },
    locale: () => 'zh-CN',
  }
}

/**
 * 命令路由假宿主：未登记的命令直接抛错——「页面调了不存在的命令」必须当场可见，
 * 不能靠兜底返回值把接线错误吃掉。
 */
function route(handlers: Record<string, Handler>) {
  const calls: { command: string; args?: unknown }[] = []
  const appInvoke = vi.fn(async (command: string, ...rest: unknown[]) => {
    const args = rest[0] as Record<string, unknown> | undefined
    calls.push({ command, args })
    const handler = handlers[command]
    if (!handler) throw new Error(`unexpected command: ${command}`)
    return handler(args)
  })
  return { appInvoke, calls }
}

function payload(overrides: Partial<CenterStatus> = {}): CenterStatus {
  return {
    state: 'not_ready',
    reason: 'registration denied by host',
    owner: null,
    centerId: null,
    methods: [
      { id: 'pairing_code', available: false },
      { id: 'qr', available: false },
      { id: 'biometric', available: false },
      { id: 'jwt', available: false },
    ],
    version: '0.0.1',
    ...overrides,
  }
}

/** 页面仍会挂载的卡片默认空数据（只测某一个面时，其余面给「确实没有」而不是抛错） */
function defaults(status: CenterStatus = payload()): Record<string, Handler> {
  return {
    'auth-center.status': () => status,
    'auth-center.keys.status': () => ({ kid: 'g1', previousKid: null }),
  }
}

async function mountWith(
  appInvoke: (command: string, ...args: unknown[]) => Promise<unknown>,
  hostInvoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
  const wrapper = mount(AuthCenterView, {
    global: {
      plugins: [i18n],
      provide: { pluginContext: makeContext(appInvoke, hostInvoke) },
    },
  })
  await flushPromises()
  return wrapper
}

describe('AuthCenterView 就位三态', () => {
  it('registered：显示「已就位」并把属主与可用方式上屏', async () => {
    const wrapper = await mountWith(
      route(
        defaults(
          payload({
            state: 'registered',
            reason: null,
            owner: 'com.wasmnest.auth-center',
            methods: [{ id: 'pairing_code', available: true }],
          }),
        ),
      ).appInvoke,
    )

    const state = wrapper.get('[data-testid="auth-center-state"]')
    expect(state.attributes('data-state')).toBe('registered')
    expect(state.text()).toContain('已就位')
    expect(wrapper.get('[data-testid="auth-center-owner"]').text()).toContain(
      'com.wasmnest.auth-center',
    )
    expect(
      wrapper.get('[data-testid="auth-center-method-pairing_code"]').attributes('data-available'),
    ).toBe('yes')
  })

  it('not_ready：与「读不到」区分开，原因码必须上屏', async () => {
    const wrapper = await mountWith(route(defaults()).appInvoke)

    const state = wrapper.get('[data-testid="auth-center-state"]')
    expect(state.attributes('data-state')).toBe('not_ready')
    expect(state.text()).toContain('确知未就位')
    expect(wrapper.get('[data-testid="auth-center-reason"]').text()).toBe(
      'registration denied by host',
    )
    // 未就位时方式一律「不可用」（不能把声明当成能用）
    expect(
      wrapper.get('[data-testid="auth-center-method-qr"]').attributes('data-available'),
    ).toBe('no')
  })

  it('缺失字段渲染 —（不用 0 / 空串冒充）', async () => {
    const wrapper = await mountWith(
      route(defaults(payload({ state: 'registered', reason: null, owner: null }))).appInvoke,
    )
    expect(wrapper.get('[data-testid="auth-center-owner"]').text()).toBe('—')
  })

  it('未知状态值不被猜成 not_ready，落 unknown', async () => {
    const wrapper = await mountWith(
      route(defaults(payload({ state: 'weird' as never }))).appInvoke,
    )
    expect(wrapper.get('[data-testid="auth-center-state"]').attributes('data-state')).toBe(
      'unknown',
    )
  })

  it('命令失败：落 unknown + 原因上屏 + 重试会再次调用（不静默成「未就位」）', async () => {
    let failFirst = true
    const { appInvoke, calls } = route({
      ...defaults(),
      'auth-center.status': () => {
        if (failFirst) {
          failFirst = false
          throw new Error('host not ready')
        }
        return payload({ state: 'registered', reason: null, owner: 'com.wasmnest.auth-center' })
      },
    })
    const wrapper = await mountWith(appInvoke)

    expect(wrapper.get('[data-testid="auth-center-state"]').attributes('data-state')).toBe(
      'unknown',
    )
    expect(wrapper.get('[data-testid="auth-center-error"]').text()).toContain('host not ready')

    await wrapper.get('[data-testid="auth-center-retry"]').trigger('click')
    await flushPromises()

    expect(calls.filter((c) => c.command === 'auth-center.status')).toHaveLength(2)
    expect(wrapper.get('[data-testid="auth-center-state"]').attributes('data-state')).toBe(
      'registered',
    )
    expect(wrapper.find('[data-testid="auth-center-error"]').exists()).toBe(false)
  })

  it('「尚未接管的区块」占位卡已删除（不再显示决策计数留位）', async () => {
    const wrapper = await mountWith(route(defaults(payload({ methods: [] }))).appInvoke)
    expect(wrapper.find('[data-testid="auth-center-pending"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="auth-center-pending-counters"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="auth-center-methods-empty"]').text()).toBe('—')
  })
})

describe('接入应用卡片', () => {
  const BEDCODE = 'com.wasmnest.terminal-session'
  const FILE_TRANSFER = 'com.wasmnest.file-transfer'

  function hostRoute(infos: unknown[] | (() => never)) {
    return vi.fn(async (command: string) => {
      expect(command).toBe('plugin_list_loaded')
      if (typeof infos === 'function') return infos()
      return infos
    })
  }

  it('列出声明的消费方；运行态与降级原因均上屏', async () => {
    const wrapper = await mountWith(
      route(defaults(payload({ methods: [] }))).appInvoke,
      hostRoute([
        { id: BEDCODE, state: { state: 'activated' } },
        { id: FILE_TRANSFER, state: { state: 'degraded', error: 'peer engine down' } },
      ]),
    )

    expect(wrapper.get(`[data-testid="auth-center-consumer-${BEDCODE}"]`).attributes('data-state')).toBe(
      'activated',
    )
    expect(
      wrapper.get(`[data-testid="auth-center-consumer-state-${FILE_TRANSFER}"]`).attributes('data-state'),
    ).toBe('degraded')
    expect(wrapper.get(`[data-testid="auth-center-consumer-state-${FILE_TRANSFER}"]`).text()).toContain(
      '已降级',
    )
    expect(
      wrapper.get(`[data-testid="auth-center-consumer-error-${FILE_TRANSFER}"]`).text(),
    ).toContain('peer engine down')
    expect(
      wrapper.get(`[data-testid="auth-center-consumer-surface-${FILE_TRANSFER}-consent"]`).text(),
    ).toContain('首连确认')
    expect(wrapper.get('[data-testid="auth-center-consumers-count"]').text()).toContain('2')
  })

  it('清单里没有的消费方落「未安装」；状态值不可判读落「读不到」', async () => {
    const wrapper = await mountWith(
      route(defaults()).appInvoke,
      hostRoute([
        { id: BEDCODE, state: { state: 'weird-value' } },
        // FILE_TRANSFER 不在清单里 = 未安装
      ]),
    )

    expect(wrapper.get(`[data-testid="auth-center-consumer-state-${BEDCODE}"]`).attributes('data-state')).toBe(
      'unknown',
    )
    expect(
      wrapper.get(`[data-testid="auth-center-consumer-state-${FILE_TRANSFER}"]`).attributes('data-state'),
    ).toBe('missing')
    expect(wrapper.get(`[data-testid="auth-center-consumer-state-${FILE_TRANSFER}"]`).text()).toContain(
      '未安装',
    )
  })

  it('宿主清单读不到：原因上屏且整列 unknown（不冒充「未安装」）', async () => {
    const wrapper = await mountWith(
      route(defaults()).appInvoke,
      hostRoute(() => {
        throw new Error('host bridge closed')
      }),
    )

    expect(wrapper.get('[data-testid="auth-center-consumers-error"]').text()).toContain(
      'host bridge closed',
    )
    for (const id of [BEDCODE, FILE_TRANSFER]) {
      expect(wrapper.get(`[data-testid="auth-center-consumer-state-${id}"]`).attributes('data-state')).toBe(
        'unknown',
      )
    }
  })

  it('刷新会重新读取宿主清单', async () => {
    const hostInvoke = hostRoute([{ id: BEDCODE, state: { state: 'activated' } }])
    const wrapper = await mountWith(route(defaults()).appInvoke, hostInvoke)

    expect(hostInvoke).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-testid="auth-center-consumers-refresh"]').trigger('click')
    await flushPromises()
    expect(hostInvoke).toHaveBeenCalledTimes(2)
  })
})

describe('入场密钥代次卡片', () => {
  it('显示当前与上一代；轮换后重新取数并给出提示', async () => {
    let rotated = false
    const { appInvoke, calls } = route({
      ...defaults(),
      'auth-center.keys.status': () =>
        rotated ? { kid: 'g2', previousKid: 'g1' } : { kid: 'g1', previousKid: null },
      'auth-center.keys.rotate': () => {
        rotated = true
        return { rotated: true, kid: 'g2', previousKid: 'g1' }
      },
    })
    const wrapper = await mountWith(appInvoke)

    expect(wrapper.get('[data-testid="auth-center-keys-kid"]').text()).toBe('g1')
    expect(wrapper.get('[data-testid="auth-center-keys-previous"]').text()).toBe('无')

    await wrapper.get('[data-testid="auth-center-keys-rotate"]').trigger('click')
    await flushPromises()

    expect(calls.some((c) => c.command === 'auth-center.keys.rotate')).toBe(true)
    expect(wrapper.get('[data-testid="auth-center-keys-kid"]').text()).toBe('g2')
    expect(wrapper.get('[data-testid="auth-center-keys-previous"]').text()).toBe('g1')
    expect(wrapper.get('[data-testid="auth-center-keys-notice"]').text()).toContain('g2')
  })

  it('轮换失败：原因上屏且代次保持不变（不伪造成功）', async () => {
    const { appInvoke } = route({
      ...defaults(),
      'auth-center.keys.rotate': () => {
        throw new Error('secret-store unavailable')
      },
    })
    const wrapper = await mountWith(appInvoke)

    await wrapper.get('[data-testid="auth-center-keys-rotate"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="auth-center-keys-error"]').text()).toContain(
      'secret-store unavailable',
    )
    expect(wrapper.get('[data-testid="auth-center-keys-kid"]').text()).toBe('g1')
    expect(wrapper.find('[data-testid="auth-center-keys-notice"]').exists()).toBe(false)
  })
})

describe('PreviewCard 卡片预览面（只读）', () => {
  function previewEnv(
    appInvoke: (command: string, ...args: unknown[]) => Promise<unknown>,
  ): AppPreviewEnv {
    return {
      appId: 'com.wasmnest.auth-center',
      appInvoke: appInvoke as AppPreviewEnv['appInvoke'],
      appStorageGet: async () => undefined,
      locale: 'zh-CN',
      theme: 'dark',
    }
  }

  it('已就位 → 卡片显示「已就位」', async () => {
    const wrapper = mount(PreviewCard, {
      props: {
        env: previewEnv(async () => payload({ state: 'registered', reason: null })),
      },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(wrapper.get('[data-testid="auth-center-preview"]').attributes('data-testid')).toBe(
      'auth-center-preview',
    )
    expect(wrapper.get('.ac-preview-state').attributes('data-state')).toBe('registered')
  })

  it('命令失败 → 落 unknown（不冒充「确知未就位」），且不抛错', async () => {
    const wrapper = mount(PreviewCard, {
      props: {
        env: previewEnv(async () => {
          throw new Error('boom')
        }),
      },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(wrapper.get('.ac-preview-state').attributes('data-state')).toBe('unknown')
  })
})
