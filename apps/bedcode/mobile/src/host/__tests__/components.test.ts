/**
 * 宿主页两个区块组件 挂载契约测试
 * （票 2026-10-09 首版；2026-10-15 按「旧宿主形态还原」重写契约）
 *
 * 被测：`DevicesSection.vue`（经 `pluginContext` provide 驱动）。
 * 项目页（`ProjectsPage.vue`）的契约测试见 `src/projects/__tests__/projectsPage.test.ts`。
 * 形态背景：设备页已按旧宿主 `Views/DevicesView.vue` 还原——
 * 页头 + 底部双 CTA + 弹出式认证（配对码弹窗 / 生物弹窗）+ 发现面板 + 二次确认弹窗。
 *
 * | 契约 | 来源 | 规则 | 预期 |
 * |---|---|---|---|
 * | C-C1 | 连接页底部 CTA | 未连接 | 二维码连接 + 手动连接按钮 + 页头雷达按钮在场 |
 * | C-C2 | 连接历史区块 | 有历史 | 名称 / 地址 / 相对时间 / 清除入口在场；单项 × 触发移除 |
 * | C-C3 | 已认证设备卡 | isPaired | 名称 + 地址 + 断开 + 会话入口在场 |
 * | C-C7 | 已连未认证 | status=connected、paired=false | 自动进入认证流程（请求配对命令 + 配对弹窗） |
 * | C-C8 | 手动连接 | 点手动连接 → 弹层提交 | connectDevice 收到默认端口补齐的目标 |
 * | C-C9 | 手动粘贴连接串 | 输入 `wasmnest://pair/…` | 与扫码同解析同路径（结果卡 + token 认证）；坏串显性报错 |
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { messagesZhCN } from '../i18n'
import DevicesSection from '../components/DevicesSection.vue'
import { installMockMobileApi, uninstallMockMobileApi, type MockMobileApi } from '../../terminal/__tests__/testKit'

// 扫码面板内嵌 html5-qrcode（浏览器库）：挂载测试不触碰相机，仅替身掉模块加载
vi.mock('html5-qrcode', () => ({ Html5Qrcode: class {} }))

/** 最小插件上下文（i18n 回显 key；commands 一律受理） */
function makePluginContext() {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>()
  return {
    id: 'com.wasmnest.bedcode',
    commands: { execute: vi.fn(async () => ({})) },
    events: {
      on: (event: string, handler: (payload?: unknown) => void) => {
        let set = listeners.get(event)
        if (!set) {
          set = new Set()
          listeners.set(event, set)
        }
        set.add(handler)
        return { dispose: () => set!.delete(handler) }
      },
    },
    i18n: { t: (key: string) => key },
    dialogs: { showToast: vi.fn(), showConfirm: vi.fn(async () => true) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as PluginContext
}

/** 展平文案树（宿主 registerMessages 的展平口径：整棵树挂插件 id 前缀） */
function flatten(
  source: Record<string, unknown>,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value as Record<string, unknown>, path, out)
    else out[path] = value as string
  }
  return out
}

/** 真 i18n 上下文（本域文案按插件前缀注册），用于钉「渲染文案而非裸 key」 */
function makeRealI18nContext(): PluginContext {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    messages: { 'zh-CN': flatten(messagesZhCN as unknown as Record<string, unknown>, 'com.wasmnest.bedcode') },
  })
  return {
    ...makePluginContext(),
    i18n: {
      t: (key: string, params?: Record<string, unknown>) =>
        i18n.global.t(`com.wasmnest.bedcode.${key}`, params as never),
    },
  } as unknown as PluginContext
}

let api: MockMobileApi
let ctx: PluginContext

/** 挂载组件（provide pluginContext：与 PluginViewHost 生产路径同款） */
function mountSection(component: unknown) {
  return mount(component as never, {
    global: { provide: { pluginContext: ctx } },
  })
}

/** 等异步编排（宿主投影 + 命令面）落定 */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve()
  await nextTick()
}

/** 连接串编码（与桌面「复制连接串」同形：wasmnest://pair/<base64url(json)>） */
function encodePairUri(json: string): string {
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
  return `wasmnest://pair/${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** 在手动连接弹层里填入文本并确认（Teleport 到 body，只能走 document 查询） */
async function submitManualInput(value: string): Promise<void> {
  const input = document.querySelector('input[placeholder="hub.addressPlaceholder"]') as HTMLInputElement
  expect(input, '未找到手动地址输入框').toBeTruthy()
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
  const confirmBtn = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('hub.actionConfirm'),
  ) as HTMLButtonElement
  confirmBtn.click()
  await settle()
}

beforeEach(() => {
  api = installMockMobileApi({})
  ctx = makePluginContext()
})

afterEach(() => {
  uninstallMockMobileApi()
  document.body.innerHTML = ''
})

describe('C-C1/C-C2/C-C3/C-C7/C-C8 连接页形态与流程契约', () => {
  it('should_renderBottomCtasAndRadar_when_notConnected', () => {
    const wrapper = mountSection(DevicesSection)

    expect(wrapper.text()).toContain('hub.qrConnect')
    expect(wrapper.text()).toContain('hub.manualConnect')
    expect(wrapper.find('button[title="hub.discoverDevices"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('should_renderHistoryRowWithTimeAndRemoveEntry_when_historyFilled', async () => {
    api.connectionHistory.value = [
      { address: '10.0.0.9:8765', name: 'desk-9', lastConnected: new Date().toISOString() },
    ]
    api.removeFromConnectionHistory = vi.fn(async () => {})
    const wrapper = mountSection(DevicesSection)

    expect(wrapper.text()).toContain('desk-9')
    expect(wrapper.text()).toContain('10.0.0.9:8765')
    // 相对时间（刚刚）：旧实现 formatLastConnected 的落点
    expect(wrapper.text()).toContain('hub.timeJustNow')

    await wrapper.find('button[aria-label="hub.remove"]').trigger('click')
    expect(api.removeFromConnectionHistory).toHaveBeenCalledWith('10.0.0.9:8765')
    wrapper.unmount()
  })

  it('should_renderDeviceCardWithDisconnectAndSessionsEntry_when_authenticated', () => {
    api.isConnected.value = true
    api.isPaired.value = true
    api.connectionStatus.value = 'paired'
    api.currentDevice.value = { address: '10.0.0.9', port: 8765, name: 'desk-9' }
    const wrapper = mountSection(DevicesSection)

    expect(wrapper.text()).toContain('desk-9')
    expect(wrapper.text()).toContain('10.0.0.9:8765')
    expect(wrapper.text()).toContain('hub.disconnect')
    expect(wrapper.text()).toContain('hub.projects')
    wrapper.unmount()
  })

  it('should_enterAuthFlowWithPairingDialog_when_connectedButNotPaired', async () => {
    // 回归：传输层连上不算可用（受保护端点 401），必须给出认证入口。
    // 旧实现由连接流程主动弹认证弹窗；本页对「挂载时已连未认证」（重连恢复）也走同一路径。
    api.isConnected.value = true
    api.isPaired.value = false
    api.connectionStatus.value = 'connected'
    api.currentDevice.value = { address: '10.0.0.9', port: 8765, name: 'desk-9' }

    const wrapper = mountSection(DevicesSection)
    await settle()

    expect(ctx.commands.execute).toHaveBeenCalledWith('bedcode.request-pairing')
    // 配对弹窗 Teleport 到 body
    expect(document.body.textContent).toContain('hub.pairingCodeTitle')
    wrapper.unmount()
  })

  // 回归锁（2026-10-15 真机：背景卡片连接每次都要重新输入配置码）：历史 / 发现连接允许
  // 用宿主持有的存量凭据静默换新；换新成功必须**不再**弹配对口——否则 JWT 还在有效期内，
  // 用户却被要求重新配对。
  it('should_skipPairingDialog_when_historyConnectSilentlyReauths', async () => {
    api.connectionHistory.value = [
      { address: '10.0.0.9:8765', name: 'desk-9', lastConnected: new Date().toISOString() },
    ]
    const connectDevice = vi.fn(async () => {})
    api.connectDevice = connectDevice
    // 静默换新成功，但 ws_paired 事件尚未到达（isPaired 仍为 false）——竞态窗口
    api.authenticateWithStoredToken = vi.fn(async () => true)
    api.isPaired.value = false
    api.connectionStatus.value = 'disconnected'

    const wrapper = mountSection(DevicesSection)
    const row = wrapper.findAll('button').find((b) => b.text().includes('desk-9'))
    expect(row, '未找到连接历史卡片').toBeTruthy()
    await row!.trigger('click')
    await settle()

    expect(connectDevice).toHaveBeenCalledWith({ address: '10.0.0.9', port: 8765, name: 'desk-9' })
    expect(api.authenticateWithStoredToken).toHaveBeenCalledTimes(1)
    expect(ctx.commands.execute).not.toHaveBeenCalledWith('bedcode.request-pairing')
    expect(document.body.textContent).not.toContain('hub.pairingCodeTitle')
    wrapper.unmount()
  })

  it('should_openPairingDialog_when_historyConnectHasNoUsableStoredCredential', async () => {
    api.connectionHistory.value = [
      { address: '10.0.0.9:8765', name: 'desk-9', lastConnected: new Date().toISOString() },
    ]
    api.connectDevice = vi.fn(async () => {})
    // 存量凭据被拒 / 不存在：必须回落到配对口，不能静默失败
    api.authenticateWithStoredToken = vi.fn(async () => false)
    api.isPaired.value = false
    api.connectionStatus.value = 'disconnected'

    const wrapper = mountSection(DevicesSection)
    const row = wrapper.findAll('button').find((b) => b.text().includes('desk-9'))
    expect(row, '未找到连接历史卡片').toBeTruthy()
    await row!.trigger('click')
    await settle()

    expect(ctx.commands.execute).toHaveBeenCalledWith('bedcode.request-pairing')
    expect(document.body.textContent).toContain('hub.pairingCodeTitle')
    wrapper.unmount()
  })

  it('should_connectWithDefaultPort_when_manualAddressHasNoPort', async () => {
    const connectDevice = vi.fn(async () => {})
    api.connectDevice = connectDevice
    api.mobileSettings.value = { defaultPort: 9000 }

    const wrapper = mountSection(DevicesSection)
    const manualBtn = wrapper.findAll('button').find((b) => b.text().includes('hub.manualConnect'))
    expect(manualBtn, '未找到手动连接按钮').toBeTruthy()
    await manualBtn!.trigger('click')
    await nextTick()

    // BottomSheet 也是 Teleport 到 body 的组件：经组件实例拿输入框
    const input = document.querySelector('input[placeholder="hub.addressPlaceholder"]') as HTMLInputElement
    expect(input, '未找到手动地址输入框').toBeTruthy()
    input.value = '10.0.0.5'
    input.dispatchEvent(new Event('input'))
    await nextTick()

    const confirmBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('hub.actionConfirm'),
    ) as HTMLButtonElement
    confirmBtn.click()
    await settle()

    expect(connectDevice).toHaveBeenCalledWith({ address: '10.0.0.5', port: 9000, name: '10.0.0.5' })
    // 手动连接必须走认证流程（不允许静默用存量凭据）
    expect(ctx.commands.execute).toHaveBeenCalledWith('bedcode.request-pairing')
    wrapper.unmount()
  })
})

describe('C-C9 手动粘贴连接串（与扫码共用一套解析）', () => {
  it('should_openScanResultCardAndUseQrAuth_when_manualInputIsPairLink', async () => {
    // 桌面「复制连接串」→ 移动手动粘贴：解析走 parseQrText，连接后的认证路径与扫码一致
    api.connectDevice = async () => {
      api.isConnected.value = true
      api.connectionStatus.value = 'connected'
    }
    ctx.commands.execute = vi.fn(async (id: string) =>
      id === 'bedcode.authenticate-with-qr' ? { accepted: true } : {},
    )
    const link = encodePairUri(
      JSON.stringify({ host: '10.0.0.9', port: 8765, token: 'one-shot' }),
    )

    const wrapper = mountSection(DevicesSection)
    const manualBtn = wrapper.findAll('button').find((b) => b.text().includes('hub.manualConnect'))
    expect(manualBtn, '未找到手动连接按钮').toBeTruthy()
    await manualBtn!.trigger('click')
    await nextTick()

    await submitManualInput(link)

    // 与扫码同款结果卡（没有为连接串另开一条直连旁路）
    const resultCard = wrapper.findAll('button').find((b) => b.text().includes('10.0.0.9:8765'))
    expect(resultCard, '未找到连接串解析出的结果卡').toBeTruthy()
    await resultCard!.trigger('click')
    await settle()

    expect(ctx.commands.execute).toHaveBeenCalledWith('bedcode.authenticate-with-qr', {
      token: 'one-shot',
    })
    expect(ctx.commands.execute).not.toHaveBeenCalledWith('bedcode.request-pairing')
    wrapper.unmount()
  })

  it('should_rejectWithVisibleError_when_pairLinkMalformed', async () => {
    const connectDevice = vi.fn(async () => {})
    api.connectDevice = connectDevice

    const wrapper = mountSection(DevicesSection)
    const manualBtn = wrapper.findAll('button').find((b) => b.text().includes('hub.manualConnect'))
    await manualBtn!.trigger('click')
    await nextTick()

    await submitManualInput('wasmnest://pair/@@not-base64@@')

    const dialogs = ctx.dialogs as unknown as { showToast: ReturnType<typeof vi.fn> }
    expect(dialogs.showToast).toHaveBeenCalledWith('hub.pairLinkInvalid', 'error')
    expect(connectDevice).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('C-C10 扫码认证路径（自持 token，不走配对码兜底）', () => {
  it('should_authenticateWithQrAndSkipPairingRequest_when_scanResultConfirmed', async () => {
    // 扫码途中状态会短暂落在 connected 且未认证：兜底 watch 不得抢先请求配对码
    api.connectDevice = async () => {
      api.isConnected.value = true
      api.connectionStatus.value = 'connected'
    }
    ctx.commands.execute = vi.fn(async (id: string) =>
      id === 'bedcode.authenticate-with-qr' ? { accepted: true } : {},
    )

    const wrapper = mountSection(DevicesSection)
    const scanBtn = wrapper.findAll('button').find((b) => b.text().includes('hub.qrConnect'))
    expect(scanBtn, '未找到二维码连接按钮').toBeTruthy()
    await scanBtn!.trigger('click')
    await nextTick()

    // 模拟取景器识别到合法载荷
    const scanPanel = wrapper.findComponent({ name: 'ScanPanel' })
    scanPanel.vm.$emit('scan-result', { host: '10.0.0.9', port: 8765, token: 'one-shot' })
    await nextTick()

    // 扫描结果卡（点击卡片即连接 + 用 token 认证）
    const resultCard = wrapper.findAll('button').find((b) => b.text().includes('10.0.0.9:8765'))
    expect(resultCard, '未找到扫描结果卡').toBeTruthy()
    await resultCard!.trigger('click')
    await settle()

    expect(ctx.commands.execute).toHaveBeenCalledWith('bedcode.authenticate-with-qr', {
      token: 'one-shot',
    })
    expect(ctx.commands.execute).not.toHaveBeenCalledWith('bedcode.request-pairing')
    wrapper.unmount()
  })
})

describe('C-C11 首选认证方式（设置项驱动的弹窗选择）', () => {
  it('should_openBiometricDialog_when_preferredAuthIsBiometricAndBound', async () => {
    api.mobileSettings.value = { preferredAuthMethod: 'biometric' }
    api.getBiometricKeyStatus = async () => ({ deviceSupported: true, deviceReason: 0, hasKey: true })
    api.isConnected.value = true
    api.connectionStatus.value = 'connected'
    api.currentDevice.value = { address: '10.0.0.9', port: 8765, name: 'desk-9' }

    const wrapper = mountSection(DevicesSection)
    await settle()

    expect(ctx.commands.execute).toHaveBeenCalledWith('bedcode.authenticate-with-biometric')
    expect(ctx.commands.execute).not.toHaveBeenCalledWith('bedcode.request-pairing')
    expect(document.body.textContent).toContain('hub.authBiometric')
    wrapper.unmount()
  })

  it('should_fallBackToPairing_when_preferredAuthIsBiometricButNotBound', async () => {
    // 首选生物但本机没绑定：旧实现在此回落配对码（不能弹一个点不动的空指纹窗）
    api.mobileSettings.value = { preferredAuthMethod: 'biometric' }
    api.getBiometricKeyStatus = async () => ({ deviceSupported: true, deviceReason: 0, hasKey: false })
    api.isConnected.value = true
    api.connectionStatus.value = 'connected'
    api.currentDevice.value = { address: '10.0.0.9', port: 8765, name: 'desk-9' }

    const wrapper = mountSection(DevicesSection)
    await settle()

    expect(ctx.commands.execute).toHaveBeenCalledWith('bedcode.request-pairing')
    expect(ctx.commands.execute).not.toHaveBeenCalledWith('bedcode.authenticate-with-biometric')
    wrapper.unmount()
  })
})
