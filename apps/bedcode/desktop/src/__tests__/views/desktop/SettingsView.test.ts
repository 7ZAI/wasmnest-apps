/**
 * 设置页渲染契约（业务分组；设置归属修正 2026-10-19 改写）
 *
 * 被测行为（外部可见输出）：
 * - 渲染四个应用分组（外观 / 配对 / 链路加密 / 会话），标题 = app 域或宿主机制
 *   文案副本，顺序 = order 升序（外观 100 → 配对 200 → 链路加密 300 → 会话 400）；
 * - 分组正文经注入的 app 直连上下文 / 宿主 env 取数（与旧贡献分组的 provide 形态同构）；
 * - 宿主平台分组（系统 / 日志 / 关于）不在本页渲染——仍归宿主系统页 /sys/settings。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import SettingsView from '@/views/SettingsView.vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { AppMountEnv } from '@/entry'
import { invoke } from '@tauri-apps/api/core'

// Mock Tauri APIs（业务分组经注入上下文取数，无宿主 store 依赖）
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: vi.fn((p: string) => p),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}))

/** 业务分组的标题序列（顺序与静态表一一对应：外观 100 → 配对 200 → 链路加密 300 → 会话 400） */
const SECTION_TITLES = [
  i18n.global.t('com.wasmnest.bedcode.appearance.settings.title'),
  i18n.global.t('com.wasmnest.bedcode.pairing.settings.title'),
  i18n.global.t('com.wasmnest.bedcode.linkCrypto.title'),
  i18n.global.t('com.wasmnest.bedcode.session.settings.title'),
]

/** app 直连上下文（配对 / 会话两分组经 inject('pluginContext') 取数与取文案） */
function makeContext(): PluginContext {
  return {
    id: 'com.wasmnest.bedcode',
    i18n: {
      t: (key: string) => i18n.global.t(`com.wasmnest.bedcode.${key}`),
      getI18n: () => i18n,
    },
    commands: { execute: vi.fn(async () => ({})) },
    storage: { get: vi.fn(async () => undefined), set: vi.fn(async () => {}) },
    events: { on: () => ({ dispose() {} }), emit: vi.fn() },
  } as unknown as PluginContext
}

/** 宿主挂载环境（链路加密分组经 inject('appEnv') 调宿主面命令） */
function makeEnv(): AppMountEnv {
  return {
    appId: 'com.wasmnest.bedcode',
    invoke: vi.fn(async () => undefined),
    appInvoke: vi.fn(async () => undefined),
    appStorageGet: vi.fn(async () => undefined),
    appStorageSet: vi.fn(async () => {}),
    appStorageDelete: vi.fn(async () => {}),
    locale: 'zh-CN',
    theme: 'light',
    initialRoute: '/settings',
  } as unknown as AppMountEnv
}

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(SettingsView, {
    global: {
      plugins: [createPinia(), i18n],
      provide: { pluginContext: makeContext(), appEnv: makeEnv() },
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
  it('渲染四个应用分组，标题序列 = order 升序（外观 → 配对 → 链路加密 → 会话）', async () => {
    const wrapper = await mountView()
    expect(titles(wrapper)).toEqual(SECTION_TITLES)
  })

  it('不渲染宿主平台分组（系统 / 日志 / 关于仍归宿主系统页）', async () => {
    const wrapper = await mountView()
    const text = wrapper.text()
    expect(text).not.toContain(i18n.global.t('settings.system.title'))
    expect(text).not.toContain(i18n.global.t('settings.log.title'))
    expect(text).not.toContain(i18n.global.t('settings.about.title'))
  })

  it('业务分组正文经注入上下文渲染（不因缺 provide 白屏）', async () => {
    const wrapper = await mountView()
    // 配对分组正文：二维码有效期行（文案经注入上下文解析）
    expect(wrapper.text()).toContain(
      i18n.global.t('com.wasmnest.bedcode.pairing.settings.qrValidity'),
    )
    // 会话分组正文：默认执行环境行
    expect(wrapper.text()).toContain(
      i18n.global.t('com.wasmnest.bedcode.session.settings.defaultEnvironment'),
    )
    // 外观分组正文：主题色板行（应用自持）
    expect(wrapper.text()).toContain(i18n.global.t('com.wasmnest.bedcode.appearance.palette'))
  })
})
