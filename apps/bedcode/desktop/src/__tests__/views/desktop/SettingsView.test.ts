/**
 * 设置页渲染契约（业务分组；桌面 UI 宿主修正 2026-10-17 改写）
 *
 * 被测行为（外部可见输出）：
 * - 渲染两个业务分组（配对 / 会话），标题 = app 域命名空间文案，顺序 = order
 *   升序（配对 200 → 会话 400）；
 * - 分组正文经注入的 app 直连上下文取数（与旧贡献分组的 provide 形态同构）；
 * - 平台分组（外观 / 链路加密 / 系统 / 日志 / 授权 / 关于）不再在本页渲染——
 *   归宿主系统页 /sys/settings（SysSettingsView）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import SettingsView from '@/views/SettingsView.vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { invoke } from '@tauri-apps/api/core'

// Mock Tauri APIs（业务分组经注入上下文取数，无宿主 store 依赖）
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: vi.fn((p: string) => p),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}))

/** 业务分组的标题序列（顺序与静态表一一对应：配对 200 → 会话 400） */
const SECTION_TITLES = [
  i18n.global.t('com.wasmnest.terminal-session.pairing.settings.title'),
  i18n.global.t('com.wasmnest.terminal-session.session.settings.title'),
]

/** app 直连上下文（配对 / 会话两分组经 inject('pluginContext') 取数与取文案） */
function makeContext(): PluginContext {
  return {
    id: 'com.wasmnest.terminal-session',
    i18n: {
      t: (key: string) => i18n.global.t(`com.wasmnest.terminal-session.${key}`),
      getI18n: () => i18n,
    },
    commands: { execute: vi.fn(async () => ({})) },
    storage: { get: vi.fn(async () => undefined), set: vi.fn(async () => {}) },
    events: { on: () => ({ dispose() {} }), emit: vi.fn() },
  } as unknown as PluginContext
}

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(SettingsView, {
    global: {
      plugins: [createPinia(), i18n],
      provide: { pluginContext: makeContext() },
    },
  })
  await flushPromises()
  return wrapper
}

/** 渲染出的分组标题文本（按 DOM 顺序） */
function titles(wrapper: VueWrapper): string[] {
  return wrapper.findAll('h3.wb-section-title').map((h) => h.text().trim())
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.mocked(invoke).mockClear()
})

describe('SettingsView 业务分组渲染', () => {
  it('渲染两个业务分组，标题序列 = order 升序（配对 → 会话）', async () => {
    const wrapper = await mountView()
    expect(titles(wrapper)).toEqual(SECTION_TITLES)
  })

  it('不渲染平台分组（外观 / 链路加密 / 系统 / 日志 / 授权 / 关于归宿主系统页）', async () => {
    const wrapper = await mountView()
    const text = wrapper.text()
    expect(text).not.toContain(i18n.global.t('settings.ui.title'))
    expect(text).not.toContain(i18n.global.t('settings.linkCrypto.title'))
    expect(text).not.toContain(i18n.global.t('settings.about.title'))
  })

  it('业务分组正文经注入上下文渲染（不因缺 provide 白屏）', async () => {
    const wrapper = await mountView()
    // 配对分组正文：二维码有效期行（文案经注入上下文解析）
    expect(wrapper.text()).toContain(
      i18n.global.t('com.wasmnest.terminal-session.pairing.settings.qrValidity'),
    )
    // 会话分组正文：默认执行环境行
    expect(wrapper.text()).toContain(
      i18n.global.t('com.wasmnest.terminal-session.session.settings.defaultEnvironment'),
    )
  })
})
