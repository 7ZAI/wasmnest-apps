/**
 * RelaySettingsSection 行为契约（T14）
 *
 * 契约清单：
 * - R1 无配置时显示空态；有配置时展示 PeerId / 指纹 / 准入 / 配额 / 地址；
 * - R2 填写对外域名后生成部署文本（形态切换生效）；非法输入显性报错；
 * - R3 复制 / 下载 compose 走前端能力，失败显性提示；
 * - R4 导入非法载荷报错且不写存储；合法载荷写入插件 KV `network.relay`；
 * - R5 存储损坏时只报错、不静默清除；显式移除才删键；
 * - R6 连通性探测在宿主未装配时**不可伪装可用**：按钮禁用 + 显性说明 + doctor 出路。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import i18n from '@/i18n'
import type { AppMountEnv } from '@/entry'
import { RELAY_CONTROL_PROTOCOL } from '@/relay/relayImport'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => toastMock }))

import RelaySettingsSection from '@/components/RelaySettingsSection.vue'

const t = (key: string) => i18n.global.t(`com.wasmnest.bedcode.${key}`)

/** 测试夹具：仅公钥派生的 PeerId / 指纹（无密钥材料） */
const PEER_ID = '12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H'
const FINGERPRINT = 'd842779d48acb8694b01b0091b72e4b81f7a52bad4bca0ee03cf14e3c689cadb'
const ADDR = `/dns4/relay.example.com/tcp/4001/p2p/${PEER_ID}`

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

interface EnvOptions {
  stored?: unknown
  getError?: Error
}

function makeEnv(options: EnvOptions = {}): AppMountEnv {
  return {
    appId: 'com.wasmnest.bedcode',
    invoke: vi.fn(async () => undefined),
    appInvoke: vi.fn(async () => undefined),
    appStorageGet: vi.fn(async () => {
      if (options.getError) throw options.getError
      return options.stored
    }),
    appStorageSet: vi.fn(async () => {}),
    appStorageDelete: vi.fn(async () => {}),
    locale: 'zh-CN',
    theme: 'light',
    initialRoute: '/settings',
  } as unknown as AppMountEnv
}

async function mountSection(env: AppMountEnv): Promise<VueWrapper> {
  const wrapper = mount(RelaySettingsSection, {
    global: {
      plugins: [i18n],
      provide: { appEnv: env },
    },
  })
  // 读取分支包含 WebCrypto 指纹复算（真正的异步任务，flushPromises 不保证等到），
  // 等状态落定再断言。
  await vi.waitFor(() => {
    const settled =
      wrapper.find('[data-testid="relay-state-empty"]').exists() ||
      wrapper.find('[data-testid="relay-state-configured"]').exists() ||
      wrapper.find('[data-testid="relay-load-error"]').exists()
    if (!settled) throw new Error('relay settings still loading')
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('R1 当前配置展示', () => {
  it('无存储时显示空态，不渲染配置摘要', async () => {
    const wrapper = await mountSection(makeEnv())
    expect(wrapper.find('[data-testid="relay-state-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="relay-current"]').exists()).toBe(false)
  })

  it('已存配置回显 PeerId / 指纹 / 准入 / 配额 / 地址', async () => {
    const wrapper = await mountSection(
      makeEnv({
        stored: {
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
        },
      }),
    )
    expect(wrapper.find('[data-testid="relay-state-configured"]').text()).toContain('1')
    expect(wrapper.get('[data-testid="relay-current-peer-id"]').text()).toBe(PEER_ID)
    expect(wrapper.get('[data-testid="relay-current-fingerprint"]').text()).toBe(FINGERPRINT)
    expect(wrapper.get('[data-testid="relay-current-access"]').text()).toBe(
      t('relay.current.accessAllowlist'),
    )
    expect(wrapper.get('[data-testid="relay-current-quota"]').text()).toContain('1,073,741,824')
    expect(wrapper.get('[data-testid="relay-current-addrs"]').text()).toContain(ADDR)
  })

  it('存储不可解析时显性报错且不清除（不写删除）', async () => {
    const env = makeEnv({ stored: { version: 99, relayAddrs: 'nope' } })
    const wrapper = await mountSection(env)
    expect(wrapper.get('[data-testid="relay-load-error"]').text()).toBe(
      t('relay.import.loadFailed'),
    )
    expect(env.appStorageDelete).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="relay-current"]').exists()).toBe(false)
  })

  it('存储里的指纹与 PeerId 本地复算不一致时同样显性报错（不假标已校验）', async () => {
    const env = makeEnv({
      stored: {
        version: 1,
        relayAddrs: [ADDR],
        peerId: PEER_ID,
        peerIdSha256: 'a'.repeat(64),
        accessMode: 'open',
        relayVersion: null,
        controlProtocol: RELAY_CONTROL_PROTOCOL,
        quota: null,
        importedAt: '2026-11-08T00:00:00.000Z',
        source: 'json',
      },
    })
    const wrapper = await mountSection(env)
    expect(wrapper.get('[data-testid="relay-load-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="relay-current"]').exists()).toBe(false)
    expect(env.appStorageDelete).not.toHaveBeenCalled()
  })
})

describe('R2 部署文本生成', () => {
  it('填写对外域名后生成 Compose 文本，切换形态生效', async () => {
    const wrapper = await mountSection(makeEnv())
    expect(wrapper.find('[data-testid="relay-deploy-empty"]').exists()).toBe(true)

    await wrapper.get('[data-testid="relay-deploy-advertise"]').setValue('relay.example.com')
    await flushPromises()
    const compose = wrapper.get('[data-testid="relay-deploy-output"]').text()
    expect(compose).toContain('ghcr.io/7zai/wasmnest-relay:0.0.1')
    expect(compose).toContain('"4001:4001/tcp"')
    expect(compose).toContain('--advertise relay.example.com')

    await wrapper.get('[data-testid="relay-deploy-mode-docker"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="relay-deploy-output"]').text()).toContain('Docker 单命令')
    expect(wrapper.find('[data-testid="relay-deploy-download"]').exists()).toBe(false)

    await wrapper.get('[data-testid="relay-deploy-mode-systemd"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="relay-deploy-output"]').text()).toContain(
      './install.sh --advertise relay.example.com',
    )
  })

  it('非法对外域名显性报错且不产出文本', async () => {
    const wrapper = await mountSection(makeEnv())
    await wrapper.get('[data-testid="relay-deploy-advertise"]').setValue('/bad')
    await flushPromises()
    expect(wrapper.get('[data-testid="relay-deploy-error"]').text()).toBe(
      t('relay.deploy.invalidAdvertise'),
    )
    expect(wrapper.find('[data-testid="relay-deploy-output"]').exists()).toBe(false)
  })

  it('复制失败不谎报成功', async () => {
    const wrapper = await mountSection(makeEnv())
    await wrapper.get('[data-testid="relay-deploy-advertise"]').setValue('relay.example.com')
    await flushPromises()
    // happy-dom 默认没有 clipboard：复制必须走失败提示
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    await wrapper.get('[data-testid="relay-deploy-copy"]').trigger('click')
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith(t('relay.deploy.copyFailed'))
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('复制成功提示已复制', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const wrapper = await mountSection(makeEnv())
    await wrapper.get('[data-testid="relay-deploy-advertise"]').setValue('relay.example.com')
    await flushPromises()
    await wrapper.get('[data-testid="relay-deploy-copy"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('relay.example.com'))
    expect(toastMock.success).toHaveBeenCalledWith(t('relay.deploy.copied'))
  })
})

describe('R4 / R5 导入与移除', () => {
  it('非法载荷报错且不写存储', async () => {
    const env = makeEnv()
    const wrapper = await mountSection(env)
    await wrapper.get('[data-testid="relay-import-input"]').setValue('hello world')
    await wrapper.get('[data-testid="relay-import-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="relay-import-error"]').text()).toContain(
      t('relay.error.line'),
    )
    expect(env.appStorageSet).not.toHaveBeenCalled()
  })

  it('合法 JSON 写入插件 KV network.relay，并展示配置摘要', async () => {
    const env = makeEnv()
    const wrapper = await mountSection(env)
    await wrapper.get('[data-testid="relay-import-input"]').setValue(JSON.stringify(payload()))
    await wrapper.get('[data-testid="relay-import-submit"]').trigger('click')
    await flushPromises()

    expect(env.appStorageSet).toHaveBeenCalledTimes(1)
    const [key, value] = vi.mocked(env.appStorageSet).mock.calls[0]
    expect(key).toBe('network.relay')
    expect(value).toMatchObject({
      version: 1,
      relayAddrs: [ADDR],
      peerId: PEER_ID,
      peerIdSha256: FINGERPRINT,
      accessMode: 'open',
      source: 'json',
    })
    expect(wrapper.find('[data-testid="relay-import-ok"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="relay-current-addrs"]').text()).toContain(ADDR)
    expect(wrapper.get('[data-testid="relay-import-input"]').element).toHaveProperty('value', '')
  })

  it('保存失败显性报错（不显示已保存假象）', async () => {
    const env = makeEnv()
    vi.mocked(env.appStorageSet).mockRejectedValueOnce(new Error('nope'))
    const wrapper = await mountSection(env)
    await wrapper.get('[data-testid="relay-import-input"]').setValue(JSON.stringify(payload()))
    await wrapper.get('[data-testid="relay-import-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="relay-import-error"]').text()).toContain(
      t('relay.import.saveFailed'),
    )
    expect(wrapper.find('[data-testid="relay-import-ok"]').exists()).toBe(false)
  })

  it('显式移除才删存储并回到空态', async () => {
    const env = makeEnv()
    const wrapper = await mountSection(env)
    await wrapper.get('[data-testid="relay-import-input"]').setValue(JSON.stringify(payload()))
    await wrapper.get('[data-testid="relay-import-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="relay-current"]').exists()).toBe(true)

    await wrapper.get('[data-testid="relay-import-clear"]').trigger('click')
    await flushPromises()
    expect(env.appStorageDelete).toHaveBeenCalledWith('network.relay')
    expect(wrapper.find('[data-testid="relay-current"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="relay-state-empty"]').exists()).toBe(true)
    expect(toastMock.success).toHaveBeenCalledWith(t('relay.import.cleared'))
  })
})

describe('R6 连通性探测（宿主未装配）', () => {
  it('按钮禁用并显性说明原因，给出 doctor 出路', async () => {
    const wrapper = await mountSection(makeEnv())
    const button = wrapper.get('[data-testid="relay-probe-button"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="relay-probe-unsupported"]').text()).toBe(
      t('relay.probe.unsupported'),
    )
    expect(wrapper.get('[data-testid="relay-probe-doctor"]').text()).toContain(
      'wasmnest-relay doctor',
    )
  })
})
