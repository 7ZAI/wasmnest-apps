/**
 * CodeViewerSettingsModal 即改即存契约测试（issue #17）
 *
 * 范式统一后无草稿：控件直接读写 codeViewer store，每次交互立即 saveSettings
 * 持久化（localStorage）并生效；遮罩/关闭钮直接 close。断言 store 内存态与
 * localStorage 双落点，验证「即改即存」而非仅 UI 态。
 *
 * 组件根为 Teleport(to=body)，断言走 document。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import CodeViewerSettingsModal from '../components/CodeViewerSettingsModal.vue'
import { useCodeViewerStore, CODE_THEMES } from '../stores/codeViewer'

const STORAGE_KEY = 'wasmnest-code-viewer-settings'

function readStorage(): { fontSize: number; lineHeight: number; theme: string; tabSize: number; showLineNumbers: boolean } | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

async function click(selector: string, index = 0) {
  const els = document.querySelectorAll(selector)
  expect(els.length, `${selector} 应存在`).toBeGreaterThan(index)
  els[index].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await nextTick()
}

describe('CodeViewerSettingsModal 即改即存（#17）', () => {
  let wrapper: ReturnType<typeof mount>
  let store: ReturnType<typeof useCodeViewerStore>

  beforeEach(() => {
    localStorage.clear()
    const pinia = createPinia()
    setActivePinia(pinia)
    store = useCodeViewerStore()
    wrapper = mount(CodeViewerSettingsModal, {
      props: { visible: true },
      global: { plugins: [pinia] },
    })
  })

  afterEach(() => {
    wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('字号步进：点「+」立即落 store 与 localStorage（默认 8 → 9）', async () => {
    await click('.size-btn', 1) // 排版页：[0]=字号- [1]=字号+
    expect(store.settings.fontSize).toBe(9)
    expect(readStorage()?.fontSize).toBe(9)
  })

  it('字号到上限 24：步进按钮进入禁用态', async () => {
    store.saveSettings({ ...store.settings, fontSize: 24 })
    await nextTick()
    const plus = [...document.querySelectorAll('.size-btn')][1] as HTMLButtonElement
    // 只断言禁用态：合成事件（dispatchEvent）会绕过浏览器对 disabled 的点击拦截
    expect(plus.disabled).toBe(true)
  })

  it('Tab 缩进与行号开关：点选即时生效', async () => {
    // tab-size-group 序：[2, 4, 8]，默认 4 → 选 2
    await click('.tab-size-btn', 0)
    expect(store.settings.tabSize).toBe(2)
    expect(readStorage()?.tabSize).toBe(2)

    await click('.toggle-btn') // 行号默认开 → 关
    expect(store.settings.showLineNumbers).toBe(false)
    expect(readStorage()?.showLineNumbers).toBe(false)
  })

  it('代码主题 tab：选非当前主题立即写入', async () => {
    const otherTheme = Object.keys(CODE_THEMES).find((id) => id !== store.settings.theme)
    expect(otherTheme).toBeTruthy()
    await click('.segmented-btn', 1) // 切到代码主题 tab
    const idx = Object.keys(CODE_THEMES).indexOf(otherTheme!)
    await click('.theme-btn', idx)
    expect(store.settings.theme).toBe(otherTheme)
    expect(readStorage()?.theme).toBe(otherTheme)
  })

  it('遮罩点击直接 close：无守卫（即改即存下不存在丢稿）', async () => {
    await click('.size-btn', 1) // 先产生一次变更
    const sheetRoot = document.querySelector('.fixed.inset-0')!
    sheetRoot.dispatchEvent(new MouseEvent('click', { bubbles: false }))
    await nextTick()
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
