/**
 * 设置页生物认证绑定行 渲染与交互契约测试
 *
 * 被测：`src/settings/SettingsPage.vue` 认证分组内的生物绑定行 + `useBiometricBinding`。
 * 替身边界：只 mock 宿主生物凭证引擎面（getMobileApi 的 getBiometricKeyStatus /
 * bindBiometricCredential / unbindBiometricCredential / isPaired）与 KV 桥。
 * 隔离：useAppSettings 持模块级共享状态，每用例 `vi.resetModules()` 重建。
 *
 * | 契约 | 场景 | 预期 |
 * |---|---|---|
 * | C-BB1 设备不支持 | deviceSupported=false reason=12 | 无绑定/解绑按钮，状态文案 noHardware |
 * | C-BB2 未认证闸门 | 支持 + 未绑定 + isPaired=false | 绑定按钮 disabled，状态 needPaired |
 * | C-BB3 绑定闭环 | 支持 + 已认证 + 未绑定 → 点绑定 | 调 bindBiometricCredential，刷新后转已绑定，success toast |
 * | C-BB4 绑定失败 | bind 抛错 | error toast，不假装成功 |
 * | C-BB5 解绑确认 | 已绑定 → 点解绑 | confirm=false 不调用；confirm=true 调 unbindBiometricCredential |
 * | C-BB6 探测失败 | getBiometricKeyStatus 抛错 | 状态置空、无按钮、不崩 |
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'

const readAllSettings = vi.fn(async () => ({}))
const writeSetting = vi.fn(async () => undefined)
const getBiometricKeyStatus = vi.fn()
const bindBiometricCredential = vi.fn()
const unbindBiometricCredential = vi.fn()
const isPaired = ref(false)
const showToast = vi.fn()
const showConfirm = vi.fn(async () => true)

vi.mock('@binblink/wasmnest-plugin-sdk-mobile', async () => {
  const actual = await vi.importActual<typeof import('@binblink/wasmnest-plugin-sdk-mobile')>(
    '@binblink/wasmnest-plugin-sdk-mobile',
  )
  return {
    ...actual,
    getMobileApi: () => ({
      readAllSettings,
      writeSetting,
      getBiometricKeyStatus,
      bindBiometricCredential,
      unbindBiometricCredential,
      isPaired,
    }),
  }
})

let SettingsPage: (typeof import('../SettingsPage.vue'))['default']

function makePluginContext() {
  return {
    id: 'com.wasmnest.bedcode',
    i18n: { t: (key: string) => key },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    dialogs: { showToast, showConfirm },
  } as unknown as PluginContext
}

async function mountPage() {
  const wrapper = mount(SettingsPage, {
    global: { provide: { pluginContext: makePluginContext() } },
  })
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
  return wrapper
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bindBtn(wrapper: any) {
  return wrapper.find('[data-testid="mobile-settings-biometric-bind"]')
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unbindBtn(wrapper: any) {
  return wrapper.find('[data-testid="mobile-settings-biometric-unbind"]')
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function statusText(wrapper: any) {
  const el = wrapper.find('[data-testid="mobile-settings-biometric-status"]')
  return el.exists() ? el.text() : ''
}

beforeEach(async () => {
  vi.resetModules()
  ;({ default: SettingsPage } = await import('../SettingsPage.vue'))
  getBiometricKeyStatus.mockReset()
  bindBiometricCredential.mockReset()
  unbindBiometricCredential.mockReset()
  showToast.mockReset()
  showConfirm.mockReset()
  showConfirm.mockResolvedValue(true)
  isPaired.value = false
})

describe('SettingsPage 生物认证绑定行', () => {
  it('C-BB1：设备不支持（无硬件）→ 无动作按钮，状态点名原因', async () => {
    getBiometricKeyStatus.mockResolvedValue({
      deviceSupported: false,
      deviceReason: 12,
      hasKey: false,
    })
    const wrapper = await mountPage()
    expect(bindBtn(wrapper).exists()).toBe(false)
    expect(unbindBtn(wrapper).exists()).toBe(false)
    expect(statusText(wrapper)).toBe('settings.biometric.noHardware')
    wrapper.unmount()
  })

  it('C-BB2：支持但未认证 → 绑定按钮禁用，提示先认证', async () => {
    getBiometricKeyStatus.mockResolvedValue({
      deviceSupported: true,
      deviceReason: 0,
      hasKey: false,
    })
    isPaired.value = false
    const wrapper = await mountPage()
    expect(bindBtn(wrapper).exists()).toBe(true)
    expect(bindBtn(wrapper).attributes('disabled')).toBeDefined()
    expect(statusText(wrapper)).toBe('settings.biometric.needPaired')
    wrapper.unmount()
  })

  it('C-BB3：支持+已认证+未绑定 → 点绑定调用引擎面并刷新转已绑定', async () => {
    getBiometricKeyStatus.mockResolvedValue({
      deviceSupported: true,
      deviceReason: 0,
      hasKey: false,
    })
    isPaired.value = true
    bindBiometricCredential.mockResolvedValue(true)
    const wrapper = await mountPage()
    expect(bindBtn(wrapper).attributes('disabled')).toBeUndefined()

    // 绑定成功后宿主已持有密钥：刷新读到 hasKey=true
    getBiometricKeyStatus.mockResolvedValue({
      deviceSupported: true,
      deviceReason: 0,
      hasKey: true,
    })
    await bindBtn(wrapper).trigger('click')
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(bindBiometricCredential).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('settings.biometric.bindDone', 'success')
    expect(unbindBtn(wrapper).exists()).toBe(true)
    expect(statusText(wrapper)).toBe('settings.biometric.bound')
    wrapper.unmount()
  })

  it('C-BB4：绑定抛错 → error toast，不假装成功', async () => {
    getBiometricKeyStatus.mockResolvedValue({
      deviceSupported: true,
      deviceReason: 0,
      hasKey: false,
    })
    isPaired.value = true
    bindBiometricCredential.mockRejectedValue(new Error('Not connected'))
    const wrapper = await mountPage()
    await bindBtn(wrapper).trigger('click')
    await nextTick()
    await Promise.resolve()
    await nextTick()
    expect(showToast).toHaveBeenCalledWith('settings.biometric.failed', 'error')
    wrapper.unmount()
  })

  it('C-BB5：已绑定 → 解绑需确认；取消不调用，确认才调用引擎面', async () => {
    getBiometricKeyStatus.mockResolvedValue({
      deviceSupported: true,
      deviceReason: 0,
      hasKey: true,
    })
    isPaired.value = true
    unbindBiometricCredential.mockResolvedValue(true)
    const wrapper = await mountPage()
    expect(unbindBtn(wrapper).exists()).toBe(true)

    // 取消确认 → 不调解绑
    showConfirm.mockResolvedValueOnce(false)
    await unbindBtn(wrapper).trigger('click')
    await nextTick()
    expect(unbindBiometricCredential).not.toHaveBeenCalled()

    // 确认 → 调解绑并刷新转未绑定
    getBiometricKeyStatus.mockResolvedValue({
      deviceSupported: true,
      deviceReason: 0,
      hasKey: false,
    })
    await unbindBtn(wrapper).trigger('click')
    await nextTick()
    await Promise.resolve()
    await nextTick()
    expect(unbindBiometricCredential).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('settings.biometric.unbindDone', 'success')
    wrapper.unmount()
  })

  it('C-BB6：状态探测失败 → 置空、无按钮、不崩', async () => {
    getBiometricKeyStatus.mockRejectedValue(new Error('keystore unavailable'))
    const wrapper = await mountPage()
    expect(bindBtn(wrapper).exists()).toBe(false)
    expect(unbindBtn(wrapper).exists()).toBe(false)
    expect(statusText(wrapper)).toBe('')
    wrapper.unmount()
  })
})
