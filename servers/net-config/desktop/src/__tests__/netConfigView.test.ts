/**
 * NetConfigView 行为契约（T18，自 T14 的 RelaySettingsSection 契约迁移 + 注册表扩展）
 *
 * 契约清单：
 * - R1 未配置显示空态；已配置展示 PeerId / 指纹 / 准入 / 配额 / 地址 / 导入来源；
 * - R2 填写对外域名后生成部署文本（形态切换生效）；非法输入显性报错；
 * - R3 复制 / 下载走前端能力，失败显性提示（不谎报成功）；
 * - R4 导入非法载荷报错且不写存储；合法载荷经 `net-config.relay.save` 写入；
 * - R5 中心读取失败 / 指纹不一致时只报错、不显示「未配置」；显式移除才删键；
 * - R6 连通性探测在宿主未装配时不可伪装可用：按钮禁用 + 显性说明 + doctor 出路；
 * - R7 业务注册表：只列业务应用（服务型 wasm 不出现）、逐业务开关、显示更新时间。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import i18n from '@/i18n'
import type { NetConfigContext } from '@/appContext'
import { RELAY_CONTROL_PROTOCOL } from '@/relay/relayImport'
import type { StoredRelaySettings, WanPolicy } from '@/types'

import NetConfigView from '@/components/NetConfigView.vue'

const t = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(`com.wasmnest.net-config.${key}`, params ?? {})

/** 测试夹具：仅公钥派生的 PeerId / 指纹（无密钥材料） */
const PEER_ID = '12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H'
const FINGERPRINT = 'd842779d48acb8694b01b0091b72e4b81f7a52bad4bca0ee03cf14e3c689cadb'
const ADDR = `/dns4/relay.example.com/tcp/4001/p2p/${PEER_ID}`
const BEDCODE = 'com.wasmnest.bedcode'
const AUTH_CENTER = 'com.wasmnest.auth-center'

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kind: 'wasmnest-relay',
    relay_version: '0.0.1',
    peer_id: PEER_ID,
    peer_id_sha256: FINGERPRINT,
    control_protocol: RELAY_CONTROL_PROTOCOL,
    addrs: [ADDR],
    access: { mode: 'open' },
    quota: { max_circuit_bytes: 1073741824, max_circuit_duration_secs: 3600 },
    ...overrides,
  }
}

function stored(overrides: Partial<StoredRelaySettings> = {}): StoredRelaySettings {
  return {
    version: 1,
    relayAddrs: [ADDR],
    peerId: PEER_ID,
    peerIdSha256: FINGERPRINT,
    accessMode: 'allowlist',
    relayVersion: '0.0.1',
    controlProtocol: RELAY_CONTROL_PROTOCOL,
    quota: { maxCircuitBytes: 1073741824, maxCircuitDurationSecs: 3600 },
    importedAt: '2026-11-08T00:00:00.000Z',
    source: 'json',
    ...overrides,
  }
}

function emptyPolicy(): WanPolicy {
  return { version: 1, apps: {} }
}

function policyWith(pluginId: string, allowWan: boolean, updatedAt: string): WanPolicy {
  return {
    version: 1,
    apps: { [pluginId]: { allowWan, note: '', updatedAt } },
  }
}

interface EnvOptions {
  /** `net-config.relay.get` 的回执；`Error` = 命令失败 */
  relay?: StoredRelaySettings | null | Error
  policy?: WanPolicy | Error
  /** `net-config.relay.save` 是否失败 */
  saveError?: Error
  /** `net-config.relay.clear` 是否失败 */
  clearError?: Error
  /** `net-config.wan-policy.set` 是否失败 */
  policySetError?: Error
  hosts?: Array<Record<string, unknown>>
}

interface Harness {
  context: NetConfigContext
  appInvoke: ReturnType<typeof vi.fn>
  hostInvoke: ReturnType<typeof vi.fn>
  calls: Array<{ command: string; args: unknown }>
}

function makeHarness(options: EnvOptions = {}): Harness {
  const calls: Array<{ command: string; args: unknown }> = []
  let policy = options.policy instanceof Error ? null : (options.policy ?? emptyPolicy())

  const appInvoke = vi.fn(async (command: string, ...args: unknown[]) => {
    calls.push({ command, args: args[0] })
    switch (command) {
      case 'net-config.relay.get': {
        const value = options.relay
        if (value instanceof Error) throw value
        return { configured: value != null, config: value ?? null }
      }
      case 'net-config.relay.save': {
        if (options.saveError) throw options.saveError
        return (args[0] as { config: StoredRelaySettings }).config
      }
      case 'net-config.relay.clear': {
        if (options.clearError) throw options.clearError
        return { cleared: true }
      }
      case 'net-config.wan-policy.get': {
        if (options.policy instanceof Error) throw options.policy
        return policy
      }
      case 'net-config.wan-policy.set': {
        if (options.policySetError) throw options.policySetError
        const arg = args[0] as { pluginId: string; allowWan: boolean }
        policy = {
          version: 1,
          apps: {
            ...(policy?.apps ?? {}),
            [arg.pluginId]: {
              allowWan: arg.allowWan,
              note: '',
              updatedAt: '2026-11-09T00:00:00Z',
            },
          },
        }
        return policy
      }
      case 'net-config.status':
        return {
          configured: false,
          relayAddrsCount: 0,
          relayError: null,
          wanApps: 0,
          wanError: null,
          version: '0.0.1',
        }
      default:
        throw new Error(`unexpected command: ${command}`)
    }
  })

  const hostInvoke = vi.fn(async (command: string) => {
    if (command !== 'plugin_list_loaded') throw new Error(`unexpected host command: ${command}`)
    return (
      options.hosts ?? [
        { id: BEDCODE, name: 'BedCode', kind: 'business-app' },
        { id: AUTH_CENTER, name: 'Auth Center', kind: 'internal-business' },
      ]
    )
  })

  const context: NetConfigContext = {
    id: 'com.wasmnest.net-config',
    appInvoke: appInvoke as unknown as NetConfigContext['appInvoke'],
    hostInvoke: hostInvoke as unknown as NetConfigContext['hostInvoke'],
    i18n: { t },
    locale: () => 'zh-CN',
  }

  return { context, appInvoke, hostInvoke, calls }
}

async function mountView(harness: Harness): Promise<VueWrapper> {
  const wrapper = mount(NetConfigView, {
    global: {
      plugins: [i18n],
      provide: { pluginContext: harness.context },
    },
  })
  // 读取分支包含 WebCrypto 指纹复算（真正的异步任务），等状态落定再断言。
  await vi.waitFor(() => {
    const settled =
      wrapper.find('[data-testid="net-config-state-empty"]').exists() ||
      wrapper.find('[data-testid="net-config-state-configured"]').exists() ||
      wrapper.find('[data-testid="net-config-load-error"]').exists()
    if (!settled) throw new Error('net-config still loading')
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('R1 当前配置展示', () => {
  it('未配置时显示空态，不渲染配置摘要', async () => {
    const wrapper = await mountView(makeHarness({ relay: null }))
    expect(wrapper.find('[data-testid="net-config-state-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="net-config-current"]').exists()).toBe(false)
  })

  it('已配置时回显 PeerId / 指纹 / 准入 / 配额 / 地址 / 来源', async () => {
    const wrapper = await mountView(makeHarness({ relay: stored() }))
    expect(wrapper.get('[data-testid="net-config-state-configured"]').text()).toContain('1')
    expect(wrapper.get('[data-testid="net-config-current-peer-id"]').text()).toBe(PEER_ID)
    expect(wrapper.get('[data-testid="net-config-current-fingerprint"]').text()).toBe(FINGERPRINT)
    expect(wrapper.get('[data-testid="net-config-current-verified"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="net-config-current-access"]').text()).toBe(
      t('relay.current.accessAllowlist'),
    )
    expect(wrapper.get('[data-testid="net-config-current-quota"]').text()).toContain('1,073,741,824')
    expect(wrapper.get('[data-testid="net-config-current-addrs"]').text()).toContain(ADDR)
    expect(wrapper.get('[data-testid="net-config-current-source"]').text()).toBe(
      t('relay.current.sourceJson'),
    )
  })

  it('中心命令失败时显性报错且不显示「未配置」', async () => {
    const wrapper = await mountView(makeHarness({ relay: new Error('center unavailable') }))
    const error = wrapper.get('[data-testid="net-config-load-error"]')
    expect(error.text()).toContain(t('relay.import.loadFailed'))
    expect(error.text()).toContain('center unavailable')
    expect(wrapper.find('[data-testid="net-config-state-empty"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="net-config-current"]').exists()).toBe(false)
  })

  it('存储里的指纹与 PeerId 本地复算不一致时同样显性报错（不假标已校验）', async () => {
    const wrapper = await mountView(
      makeHarness({ relay: stored({ peerIdSha256: 'a'.repeat(64) }) }),
    )
    expect(wrapper.get('[data-testid="net-config-load-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="net-config-current"]').exists()).toBe(false)
  })
})

describe('R2 部署文本生成', () => {
  it('填写对外域名后生成 Compose 文本，切换形态生效', async () => {
    const wrapper = await mountView(makeHarness())
    expect(wrapper.find('[data-testid="net-config-deploy-empty"]').exists()).toBe(true)

    await wrapper.get('[data-testid="net-config-deploy-advertise"]').setValue('relay.example.com')
    await flushPromises()
    const compose = wrapper.get('[data-testid="net-config-deploy-output"]').text()
    expect(compose).toContain('ghcr.io/7zai/wasmnest-relay:0.0.1')
    expect(compose).toContain('"4001:4001/tcp"')
    expect(compose).toContain('--advertise relay.example.com')

    await wrapper.get('[data-testid="net-config-deploy-mode-docker"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="net-config-deploy-output"]').text()).toContain('Docker 单命令')
    expect(wrapper.find('[data-testid="net-config-deploy-download"]').exists()).toBe(false)

    await wrapper.get('[data-testid="net-config-deploy-mode-systemd"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="net-config-deploy-output"]').text()).toContain(
      './install.sh --advertise relay.example.com',
    )
  })

  it('非法对外域名显性报错且不产出文本', async () => {
    const wrapper = await mountView(makeHarness())
    await wrapper.get('[data-testid="net-config-deploy-advertise"]').setValue('/bad')
    await flushPromises()
    expect(wrapper.get('[data-testid="net-config-deploy-error"]').text()).toBe(
      t('relay.deploy.invalidAdvertise'),
    )
    expect(wrapper.find('[data-testid="net-config-deploy-output"]').exists()).toBe(false)
  })

  it('复制失败不谎报成功', async () => {
    const wrapper = await mountView(makeHarness())
    await wrapper.get('[data-testid="net-config-deploy-advertise"]').setValue('relay.example.com')
    await flushPromises()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    await wrapper.get('[data-testid="net-config-deploy-copy"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="net-config-deploy-copy-failed"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="net-config-deploy-copied"]').exists()).toBe(false)
  })

  it('复制成功提示已复制', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const wrapper = await mountView(makeHarness())
    await wrapper.get('[data-testid="net-config-deploy-advertise"]').setValue('relay.example.com')
    await flushPromises()
    await wrapper.get('[data-testid="net-config-deploy-copy"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('relay.example.com'))
    expect(wrapper.find('[data-testid="net-config-deploy-copied"]').exists()).toBe(true)
  })
})

describe('R4 / R5 导入与移除', () => {
  it('非法载荷报错且不调用保存命令', async () => {
    const harness = makeHarness()
    const wrapper = await mountView(harness)
    await wrapper.get('[data-testid="net-config-import-input"]').setValue('hello world')
    await wrapper.get('[data-testid="net-config-import-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="net-config-import-error"]').text()).toContain(
      t('relay.error.line'),
    )
    expect(harness.calls.some((c) => c.command === 'net-config.relay.save')).toBe(false)
  })

  it('合法 JSON 经中心保存命令写入，并展示配置摘要', async () => {
    const harness = makeHarness()
    const wrapper = await mountView(harness)
    await wrapper.get('[data-testid="net-config-import-input"]').setValue(JSON.stringify(payload()))
    await wrapper.get('[data-testid="net-config-import-submit"]').trigger('click')
    // 指纹复算走 WebCrypto（真正的异步任务），不能只 flush 一次 microtask
    await vi.waitFor(() => {
      expect(harness.calls.filter((c) => c.command === 'net-config.relay.save')).toHaveLength(1)
    })

    const saves = harness.calls.filter((c) => c.command === 'net-config.relay.save')
    const config = (saves[0].args as { config: StoredRelaySettings }).config
    expect(config).toMatchObject({
      version: 1,
      relayAddrs: [ADDR],
      peerId: PEER_ID,
      peerIdSha256: FINGERPRINT,
      accessMode: 'open',
      source: 'json',
    })
    expect(wrapper.find('[data-testid="net-config-import-ok"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="net-config-current-addrs"]').text()).toContain(ADDR)
    expect(wrapper.get('[data-testid="net-config-import-input"]').element).toHaveProperty(
      'value',
      '',
    )
  })

  it('保存失败显性报错（不显示已保存假象）', async () => {
    const harness = makeHarness({ saveError: new Error('nope') })
    const wrapper = await mountView(harness)
    await wrapper.get('[data-testid="net-config-import-input"]').setValue(JSON.stringify(payload()))
    await wrapper.get('[data-testid="net-config-import-submit"]').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="net-config-import-error"]').exists()).toBe(true)
    })
    expect(wrapper.get('[data-testid="net-config-import-error"]').text()).toContain(
      t('relay.import.saveFailed'),
    )
    expect(wrapper.find('[data-testid="net-config-import-ok"]').exists()).toBe(false)
  })

  it('显式移除才调用删除命令并回到空态', async () => {
    const harness = makeHarness({ relay: stored() })
    const wrapper = await mountView(harness)
    expect(wrapper.find('[data-testid="net-config-current"]').exists()).toBe(true)

    await wrapper.get('[data-testid="net-config-import-clear"]').trigger('click')
    await flushPromises()
    expect(harness.calls.some((c) => c.command === 'net-config.relay.clear')).toBe(true)
    expect(wrapper.find('[data-testid="net-config-current"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="net-config-state-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="net-config-relay-cleared"]').exists()).toBe(true)
  })

  it('移除失败保留配置并显性报错（用「移除失败」语义，不是保存失败）', async () => {
    const harness = makeHarness({ relay: stored(), clearError: new Error('locked') })
    const wrapper = await mountView(harness)
    await wrapper.get('[data-testid="net-config-import-clear"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="net-config-current"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="net-config-relay-cleared"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="net-config-import-error"]').text()).toContain(
      t('relay.import.clearFailed'),
    )
  })
})

describe('R6 连通性探测（宿主未装配）', () => {
  it('按钮禁用并显性说明原因，给出 doctor 出路', async () => {
    const wrapper = await mountView(makeHarness())
    const button = wrapper.get('[data-testid="net-config-probe-button"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="net-config-probe-unsupported"]').text()).toBe(
      t('relay.probe.unsupported'),
    )
    expect(wrapper.get('[data-testid="net-config-probe-doctor"]').text()).toContain(
      'wasmnest-relay doctor',
    )
  })
})

describe('R7 业务注册表', () => {
  it('未登记业务的生效值是「允许」（与后端默认一致）', async () => {
    const wrapper = await mountView(makeHarness())
    expect(wrapper.find(`[data-testid="net-config-wan-row-${BEDCODE}"]`).exists()).toBe(true)
    expect(wrapper.find(`[data-testid="net-config-wan-row-${AUTH_CENTER}"]`).exists()).toBe(false)
    expect(wrapper.get(`[data-testid="net-config-wan-state-${BEDCODE}"]`).text()).toBe(
      t('wan.state.allowed'),
    )
    expect(
      wrapper.get(`[data-testid="net-config-wan-state-${BEDCODE}"]`).attributes('data-allowed'),
    ).toBe('true')
    expect(wrapper.get('[data-testid="net-config-wan-count"]').text()).toContain('1 / 1')
  })

  it('未登记业务首次切换写入显式 false（不是写回原本生效的 true）', async () => {
    const harness = makeHarness()
    const wrapper = await mountView(harness)
    await wrapper.get(`[data-testid="net-config-wan-toggle-${BEDCODE}"]`).trigger('click')
    await flushPromises()

    const sets = harness.calls.filter((c) => c.command === 'net-config.wan-policy.set')
    expect(sets).toHaveLength(1)
    expect(sets[0].args).toEqual({ pluginId: BEDCODE, allowWan: false })
    expect(wrapper.get(`[data-testid="net-config-wan-state-${BEDCODE}"]`).text()).toBe(
      t('wan.state.blocked'),
    )
  })

  it('逐业务开关写注册表，其他业务不受影响', async () => {
    const harness = makeHarness({
      policy: policyWith(BEDCODE, false, '2026-11-08T00:00:00Z'),
    })
    const wrapper = await mountView(harness)
    await wrapper.get(`[data-testid="net-config-wan-toggle-${BEDCODE}"]`).trigger('click')
    await flushPromises()

    const sets = harness.calls.filter((c) => c.command === 'net-config.wan-policy.set')
    expect(sets).toHaveLength(1)
    expect(sets[0].args).toEqual({ pluginId: BEDCODE, allowWan: true })
    expect(wrapper.get(`[data-testid="net-config-wan-state-${BEDCODE}"]`).text()).toBe(
      t('wan.state.allowed'),
    )
    expect(wrapper.get(`[data-testid="net-config-wan-updated-${BEDCODE}"]`).text()).toBe(
      '2026-11-09T00:00:00Z',
    )
  })

  it('注册表里已有但未安装的业务仍然可见（不被宿主清单吞掉）', async () => {
    const wrapper = await mountView(
      makeHarness({
        policy: policyWith('com.wasmnest.file-transfer', true, '2026-11-08T00:00:00Z'),
        hosts: [],
      }),
    )
    expect(
      wrapper.find('[data-testid="net-config-wan-row-com.wasmnest.file-transfer"]').exists(),
    ).toBe(true)
  })

  it('已配置地址但所有业务都禁止外网时给出显性区分提示', async () => {
    const wrapper = await mountView(
      makeHarness({
        relay: stored(),
        policy: policyWith(BEDCODE, false, '2026-11-09T00:00:00Z'),
      }),
    )
    expect(wrapper.find('[data-testid="net-config-wan-off-hint"]').exists()).toBe(true)
  })

  it('已配置地址且存在未登记业务时不提示「全部关闭」（默认允许）', async () => {
    const wrapper = await mountView(makeHarness({ relay: stored() }))
    expect(wrapper.find('[data-testid="net-config-wan-off-hint"]').exists()).toBe(false)
  })

  it('切换失败保留旧状态并显性报错', async () => {
    const harness = makeHarness({ policySetError: new Error('denied') })
    const wrapper = await mountView(harness)
    await wrapper.get(`[data-testid="net-config-wan-toggle-${BEDCODE}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="net-config-wan-error"]').text()).toContain('denied')
    expect(wrapper.get(`[data-testid="net-config-wan-state-${BEDCODE}"]`).text()).toBe(
      t('wan.state.allowed'),
    )
  })
})
