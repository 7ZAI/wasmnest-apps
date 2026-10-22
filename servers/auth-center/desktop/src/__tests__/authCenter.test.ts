/**
 * AuthCenterView 契约测试（挂载包组件级）
 *
 * 只断言**外部可观察行为**：三态渲染、原因上屏、失败态不被当成「未就位」、
 * 缺失字段渲染 `—`、六个数据面的取数/动作接线、锚点存在。不测内部实现（不 mock
 * 内部模块，只按命令名路由假宿主）。
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

function makeContext(appInvoke: (command: string, ...args: unknown[]) => Promise<unknown>) {
  return {
    id: 'com.wasmnest.auth-center',
    appInvoke,
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

/** 六域默认空数据（只测某一个面时，其余面给「确实没有」而不是抛错） */
function defaults(status: CenterStatus = payload()): Record<string, Handler> {
  return {
    'auth-center.status': () => status,
    'auth-center.pairing-code.status': () => null,
    'auth-center.qr-code.status': () => null,
    'auth-center.trust.list': () => ({ devices: [], peerError: null }),
    'auth-center.devices.list': () => [],
    'auth-center.keys.status': () => ({ kid: 'g1', previousKid: null }),
  }
}

async function mountWith(appInvoke: (command: string, ...args: unknown[]) => Promise<unknown>) {
  const wrapper = mount(AuthCenterView, {
    global: {
      plugins: [i18n],
      provide: { pluginContext: makeContext(appInvoke) },
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
    expect(wrapper.get('[data-testid="auth-center-banner"]').text()).toContain('已就位')
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
    expect(wrapper.get('[data-testid="auth-center-banner"]').text()).toContain('读不到')
    expect(wrapper.get('[data-testid="auth-center-error"]').text()).toContain('host not ready')

    await wrapper.get('[data-testid="auth-center-retry"]').trigger('click')
    await flushPromises()

    expect(calls.filter((c) => c.command === 'auth-center.status')).toHaveLength(2)
    expect(wrapper.get('[data-testid="auth-center-state"]').attributes('data-state')).toBe(
      'registered',
    )
    expect(wrapper.get('[data-testid="auth-center-banner"]').text()).toContain('已就位')
    expect(wrapper.find('[data-testid="auth-center-error"]').exists()).toBe(false)
  })

  it('未接管区块只剩决策计数（其余四块已接线，不再留占位）', async () => {
    const wrapper = await mountWith(route(defaults(payload({ methods: [] }))).appInvoke)
    expect(wrapper.find('[data-testid="auth-center-pending-counters"]').exists()).toBe(true)
    for (const section of ['pairing', 'trust', 'history', 'policy']) {
      expect(wrapper.find(`[data-testid="auth-center-pending-${section}"]`).exists()).toBe(false)
    }
    expect(wrapper.get('[data-testid="auth-center-methods-empty"]').text()).toBe('—')
  })
})

describe('配对码 / 二维码卡片', () => {
  it('生成后码与剩余秒数上屏；清除后回落 —（不是空串）', async () => {
    let current: unknown = null
    const { appInvoke, calls } = route({
      ...defaults(),
      'auth-center.pairing-code.generate': () => {
        current = { code: '123456', created_at: '2026-10-22T00:00:00Z', expires_in: 60 }
        return current
      },
      'auth-center.pairing-code.clear': () => {
        current = null
        return { cleared: true }
      },
    })
    const wrapper = await mountWith(appInvoke)

    expect(wrapper.get('[data-testid="auth-center-pairing-code"]').text()).toBe('—')

    await wrapper.get('[data-testid="auth-center-pairing-generate"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="auth-center-pairing-code"]').text()).toBe('123456')
    expect(wrapper.get('[data-testid="auth-center-pairing-code-remaining"]').text()).toContain('60')

    await wrapper.get('[data-testid="auth-center-pairing-clear"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="auth-center-pairing-code"]').text()).toBe('—')
    expect(calls.some((c) => c.command === 'auth-center.pairing-code.clear')).toBe(true)
  })

  it('生成失败：原因上屏且不伪造码', async () => {
    const { appInvoke } = route({
      ...defaults(),
      'auth-center.pairing-code.generate': () => {
        throw new Error('no entropy')
      },
    })
    const wrapper = await mountWith(appInvoke)

    await wrapper.get('[data-testid="auth-center-pairing-generate"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="auth-center-pairing-code-error"]').text()).toContain(
      'no entropy',
    )
    expect(wrapper.get('[data-testid="auth-center-pairing-code"]').text()).toBe('—')
  })

  it('QR：生成后 token 上屏，剩余秒数取自 remaining', async () => {
    const { appInvoke } = route({
      ...defaults(),
      'auth-center.qr-code.generate': () => ({ token: 'abcdef', ttl: 300, remaining: 299 }),
    })
    const wrapper = await mountWith(appInvoke)

    await wrapper.get('[data-testid="auth-center-qr-generate"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="auth-center-qr-token"]').text()).toBe('abcdef')
    expect(wrapper.get('[data-testid="auth-center-qr-remaining"]').text()).toContain('299')
  })
})

describe('可信设备卡片', () => {
  it('两种来源分别上屏（kind 判别可见），撤销按 id 调用并重新取数', async () => {
    let revoked = false
    const { appInvoke, calls } = route({
      ...defaults(),
      'auth-center.trust.list': () => ({
        devices: [
          // 撤销后 pairing 段不再包含它（软删即从活跃集合消失），peer 段不受影响
          ...(revoked
            ? []
            : [
                {
                  kind: 'pairing',
                  id: 'p-1',
                  name: 'Pixel',
                  fingerprint: 'fp-1',
                  addedAt: '2026-10-01T00:00:00Z',
                },
              ]),
          {
            kind: 'peer',
            id: 'aabb',
            name: 'Laptop',
            fingerprintShort: 'aabbccdd',
            addedAt: '2026-10-02T00:00:00Z',
          },
        ],
        peerError: null,
      }),
      'auth-center.trust.revoke': () => {
        revoked = true
        return { removed: true, kind: 'pairing' }
      },
    })
    const wrapper = await mountWith(appInvoke)

    expect(wrapper.get('[data-testid="auth-center-trust-item-p-1"]').attributes('data-kind')).toBe(
      'pairing',
    )
    expect(wrapper.get('[data-testid="auth-center-trust-item-aabb"]').attributes('data-kind')).toBe(
      'peer',
    )
    expect(wrapper.get('[data-testid="auth-center-trust-count"]').text()).toContain('2')

    await wrapper.get('[data-testid="auth-center-trust-revoke-p-1"]').trigger('click')
    await flushPromises()

    expect(calls.find((c) => c.command === 'auth-center.trust.revoke')?.args).toEqual({ id: 'p-1' })
    expect(wrapper.find('[data-testid="auth-center-trust-item-p-1"]').exists()).toBe(false)
  })

  it('列表为空显示「暂无可信设备」；读取失败显示原因并保留上一次数据', async () => {
    let fail = false
    const { appInvoke } = route({
      ...defaults(),
      'auth-center.trust.list': () => {
        if (fail) throw new Error('records unavailable')
        return {
          devices: [{ kind: 'pairing', id: 'p-1', name: 'Pixel', addedAt: '2026-10-01T00:00:00Z' }],
          peerError: null,
        }
      },
    })
    const wrapper = await mountWith(appInvoke)

    fail = true
    await wrapper.get('[data-testid="auth-center-trust-refresh"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="auth-center-trust-error"]').text()).toContain(
      'records unavailable',
    )
    expect(wrapper.find('[data-testid="auth-center-trust-item-p-1"]').exists()).toBe(true)
  })

  it('peer 段失败：原因单独上屏，pairing 段照常展示', async () => {
    const { appInvoke } = route({
      ...defaults(),
      'auth-center.trust.list': () => ({
        devices: [{ kind: 'pairing', id: 'p-1', name: 'Pixel', addedAt: '2026-10-01T00:00:00Z' }],
        peerError: 'peer engine not started',
      }),
    })
    const wrapper = await mountWith(appInvoke)

    expect(wrapper.get('[data-testid="auth-center-trust-peer-error"]').text()).toContain(
      'peer engine not started',
    )
    expect(wrapper.find('[data-testid="auth-center-trust-item-p-1"]').exists()).toBe(true)
  })
})

describe('连接历史卡片', () => {
  const device = {
    id: 'p-1',
    deviceName: 'Pixel',
    deviceFingerprint: 'fp-1',
    pairedAt: '2026-10-01T00:00:00Z',
    connectCount: 3,
  }

  it('设备为空：显示「暂无已配对设备」而不是历史空表', async () => {
    const wrapper = await mountWith(route(defaults()).appInvoke)
    expect(wrapper.get('[data-testid="auth-center-history-empty-devices"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="auth-center-history-no-events"]').exists()).toBe(false)
  })

  it('选中设备即取该设备历史；清空按 deviceId 调用', async () => {
    let cleared = false
    const { appInvoke, calls } = route({
      ...defaults(),
      'auth-center.devices.list': () => [device],
      'auth-center.history.list': (args) => {
        if (cleared) return []
        expect(args).toEqual({ deviceId: 'p-1' })
        return [
          {
            deviceId: 'p-1',
            authMethod: 'pairing_code',
            result: 'success',
            address: '192.168.1.5:9000',
            connectedAt: '2026-10-10T00:00:00Z',
          },
        ]
      },
      'auth-center.history.clear': () => {
        cleared = true
        return { cleared: true }
      },
    })
    const wrapper = await mountWith(appInvoke)

    const items = wrapper.findAll('[data-testid="auth-center-history-item"]')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-result')).toBe('success')
    expect(items[0].text()).toContain('配对码')

    await wrapper.get('[data-testid="auth-center-history-clear"]').trigger('click')
    await flushPromises()

    expect(calls.find((c) => c.command === 'auth-center.history.clear')?.args).toEqual({
      deviceId: 'p-1',
    })
    expect(wrapper.find('[data-testid="auth-center-history-no-events"]').exists()).toBe(true)
  })

  it('历史读取失败：原因上屏（不冒充「没有记录」）', async () => {
    const { appInvoke } = route({
      ...defaults(),
      'auth-center.devices.list': () => [device],
      'auth-center.history.list': () => {
        throw new Error('history store degraded')
      },
    })
    const wrapper = await mountWith(appInvoke)

    expect(wrapper.get('[data-testid="auth-center-history-error"]').text()).toContain(
      'history store degraded',
    )
    expect(wrapper.find('[data-testid="auth-center-history-no-events"]').exists()).toBe(false)
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
  function previewEnv(appInvoke: AppPreviewEnv['appInvoke']): AppPreviewEnv {
    return { appId: 'com.wasmnest.auth-center', appInvoke, appStorageGet: async () => undefined, locale: 'zh-CN', theme: 'dark' }
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
