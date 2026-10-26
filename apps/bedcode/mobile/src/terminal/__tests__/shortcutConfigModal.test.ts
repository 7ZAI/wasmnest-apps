/**
 * ShortcutConfigModal 破坏性操作确认契约测试（issue #16）
 *
 * 修复前的严重度倒挂：删除单个自定义快捷键有确认，而「恢复默认」一键清空
 * 全部自定义与内置可见性配置却无确认。收敛后：删除与恢复默认统一走
 * ConfirmDialog（danger）——点入口只弹确认、不动数据，确认后才执行。
 *
 * 组件根为 Teleport(to=body)，断言走 document；host fallback 的 t 回显 key，
 * 确认弹窗以 i18n key 文本定位（.modal-panel 内含 resetConfirmMessage / deleteConfirmTitle）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { installFakeHost, installMockMobileApi, uninstallFakeHost, uninstallMockMobileApi } from './testKit'

// ShortcutHelpModal（本弹窗子组件）消费 vue-i18n 的 locale
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'zh-CN' } }),
}))
// 触摸滑动切 Tab 替身：本测试不驱动滑动
vi.mock('@binblink/wasmnest-plugin-sdk-mobile/ui/swipe-tabs', () => ({
  useSwipeTabs: () => ({
    onTouchStart: () => {},
    onTouchMove: () => {},
    onTouchEnd: () => {},
  }),
}))

import ShortcutConfigModal from '../components/ShortcutConfigModal.vue'
import { useInputAssistantStore } from '../inputAssistant'

/** 找到包含指定 key 文案的确认弹窗面板（确认/取消按钮按 DOM 序 [0]=取消 [1]=确认） */
function confirmPanel(marker: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('.modal-panel')].find((p) =>
      p.textContent!.includes(marker),
    ) ?? null
  )
}

async function clickPanelButton(panel: HTMLElement, index: number) {
  panel.querySelectorAll('button')[index].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await nextTick()
}

async function clickSelector(selector: string) {
  const el = document.querySelector(selector)
  expect(el, `${selector} 应存在`).toBeTruthy()
  el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await nextTick()
}

describe('ShortcutConfigModal 破坏性操作确认（#16）', () => {
  let wrapper: ReturnType<typeof mount>
  let store: ReturnType<typeof useInputAssistantStore>

  beforeEach(() => {
    installFakeHost()
    installMockMobileApi()
    const pinia = createPinia()
    setActivePinia(pinia)
    store = useInputAssistantStore()
    wrapper = mount(ShortcutConfigModal, {
      props: { visible: true },
      global: { plugins: [pinia] },
    })
  })

  afterEach(() => {
    wrapper.unmount()
    document.body.innerHTML = ''
    uninstallFakeHost()
    uninstallMockMobileApi()
  })

  it('「恢复默认」点击只弹确认：数据不动；确认后才清空自定义并恢复可见性', async () => {
    store.addShortcut('ctrl+z', 'Ctrl+Z')
    store.toggleShortcutVisibility('escape')
    await nextTick()
    const hadCustom = store.shortcutConfig.some((s) => s.code === 'ctrl+z')
    const escapeHidden = !store.shortcutConfig.find((s) => s.code === 'escape')!.visible
    expect(hadCustom && escapeHidden).toBe(true)

    await clickSelector('.ghost-btn')
    // 入口点击不动数据
    expect(store.shortcutConfig.some((s) => s.code === 'ctrl+z')).toBe(true)
    expect(!store.shortcutConfig.find((s) => s.code === 'escape')!.visible).toBe(true)
    const panel = confirmPanel('shortcutConfig.resetConfirmMessage')
    expect(panel).not.toBeNull()

    await clickPanelButton(panel!, 1)
    expect(store.shortcutConfig.some((s) => !s.builtin)).toBe(false)
    expect(store.shortcutConfig.find((s) => s.code === 'escape')!.visible).toBe(true)
    expect(confirmPanel('shortcutConfig.resetConfirmMessage')).toBeNull()
  })

  it('「恢复默认」确认弹窗点取消：配置保持不变', async () => {
    store.addShortcut('ctrl+z', 'Ctrl+Z')
    await nextTick()

    await clickSelector('.ghost-btn')
    const panel = confirmPanel('shortcutConfig.resetConfirmMessage')
    expect(panel).not.toBeNull()

    await clickPanelButton(panel!, 0)
    expect(store.shortcutConfig.some((s) => s.code === 'ctrl+z')).toBe(true)
    expect(confirmPanel('shortcutConfig.resetConfirmMessage')).toBeNull()
  })

  it('删除自定义快捷键：取消保留、确认删除（ConfirmDialog danger 承接）', async () => {
    store.addShortcut('ctrl+z', 'Ctrl+Z')
    await nextTick()
    expect(document.querySelector('.delete-btn')).toBeTruthy()

    await clickSelector('.delete-btn')
    let panel = confirmPanel('shortcutConfig.deleteConfirmTitle')
    expect(panel).not.toBeNull()

    await clickPanelButton(panel!, 0)
    expect(store.shortcutConfig.some((s) => s.code === 'ctrl+z')).toBe(true)
    expect(confirmPanel('shortcutConfig.deleteConfirmTitle')).toBeNull()

    await clickSelector('.delete-btn')
    panel = confirmPanel('shortcutConfig.deleteConfirmTitle')
    expect(panel).not.toBeNull()
    await clickPanelButton(panel!, 1)
    expect(store.shortcutConfig.some((s) => s.code === 'ctrl+z')).toBe(false)
    expect(confirmPanel('shortcutConfig.deleteConfirmTitle')).toBeNull()
  })
})
