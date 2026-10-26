/**
 * TerminalSettingsModal 即改即存契约测试（issue #17）
 *
 * 范式统一后组件完全受控：props 即真源（父层 TerminalSettings 状态），每次交互
 * 立即 emit('change', 全量设置) 由父层持久化并应用；无草稿、无确认 footer——
 * 遮罩/关闭钮直接 close，不存在丢稿路径。Tab 停留页跨开关保留。
 *
 * 组件根为 Teleport(to=body)，断言走 document；SDK swipe-tabs 替身（不驱动滑动）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { installMockMobileApi, uninstallMockMobileApi } from './testKit'

vi.mock('@binblink/wasmnest-plugin-sdk-mobile/ui/swipe-tabs', () => ({
  useSwipeTabs: () => ({
    onTouchStart: () => {},
    onTouchMove: () => {},
    onTouchEnd: () => {},
  }),
}))

import TerminalSettingsModal from '../components/TerminalSettingsModal.vue'
import type { ToolbarItemConfig } from '../components/TerminalSettingsModal.vue'
import { TERMINAL_THEMES } from '../config/themes'

const ALL_TOOLBAR_ITEMS: ToolbarItemConfig[] = [
  { key: 'task', label: 'terminal.toolbarTask', icon: 'task' },
  { key: 'folder', label: 'terminal.toolbarFolder', icon: 'folder' },
]

const BASE_PROPS = {
  visible: true,
  fontSize: 14,
  theme: 'dark',
  isThemeUserSet: false,
  letterSpacing: 0,
  quickBarCount: 6,
  toolbarItems: ['folder'],
  allToolbarItems: ALL_TOOLBAR_ITEMS,
  onboardingPending: false,
}

function mountModal() {
  return mount(TerminalSettingsModal, { props: { ...BASE_PROPS } })
}

/** 最后一次 change 事件载荷（无则 null） */
function lastChange(wrapper: ReturnType<typeof mount>) {
  const emitted = wrapper.emitted('change')
  return emitted ? emitted[emitted.length - 1][0] : null
}

async function click(selector: string, index = 0) {
  const els = document.querySelectorAll(selector)
  expect(els.length, `${selector} 应存在`).toBeGreaterThan(index)
  els[index].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await nextTick()
}

async function clickOverlay() {
  const sheetRoot = document.querySelector('.fixed.inset-0')!
  sheetRoot.dispatchEvent(new MouseEvent('click', { bubbles: false }))
  await nextTick()
  await nextTick()
}

describe('TerminalSettingsModal 即改即存（#17）', () => {
  let wrapper: ReturnType<typeof mount>

  beforeEach(() => {
    installMockMobileApi()
    wrapper = mountModal()
  })

  afterEach(() => {
    wrapper.unmount()
    document.body.innerHTML = ''
    uninstallMockMobileApi()
  })

  it('字号步进：点「+」立即 change 全量设置（其余字段原样带回）', async () => {
    await click('.size-btn', 1) // 外观页：[0]=字号- [1]=字号+
    const payload = lastChange(wrapper)
    expect(payload).toMatchObject({ fontSize: 15, letterSpacing: 0, quickBarCount: 6, toolbarItems: ['folder'], onboardingPending: false })
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('字号到上限 24：步进按钮进入禁用态', async () => {
    await wrapper.setProps({ fontSize: 24 })
    await nextTick()
    const plus = [...document.querySelectorAll('.size-btn')][1] as HTMLButtonElement
    // 只断言禁用态：合成事件（dispatchEvent）会绕过浏览器对 disabled 的点击拦截
    expect(plus.disabled).toBe(true)
  })

  it('主题选择：具名主题锁定用户指定；system 折算当前外观并解除指定', async () => {
    // 主题序以 TERMINAL_THEMES 键序为准（测试不硬编码具体主题名）
    const keys = Object.keys(TERMINAL_THEMES)
    const namedIdx = keys.findIndex((k) => k !== 'system')
    await click('.theme-btn', namedIdx)
    expect(lastChange(wrapper)).toMatchObject({ theme: keys[namedIdx], isThemeUserSet: true })

    await click('.theme-btn', keys.indexOf('system')) // system → isDark=false 折算 light
    expect(lastChange(wrapper)).toMatchObject({ theme: 'light', isThemeUserSet: false })
  })

  it('工具栏多选：点选即在列表中增删该项（父层回灌后可继续增删）', async () => {
    await click('.segmented-btn', 1)
    await click('.toolbar-toggle-btn', 0) // task 芯片：增
    const first = lastChange(wrapper)!.toolbarItems
    expect(first).toEqual(['folder', 'task'])

    // 受控组件契约：父层把 change 载荷回灌 props 后，再点 folder 芯片删
    await wrapper.setProps({ toolbarItems: first })
    await nextTick()
    await click('.toolbar-toggle-btn', 1)
    expect(lastChange(wrapper)?.toolbarItems).toEqual(['task'])
  })

  it('遮罩点击直接 close：无守卫（即改即存下不存在丢稿）', async () => {
    await click('.size-btn', 1) // 先产生一次变更
    await clickOverlay()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('Tab 停留页跨开关保留：切到杂项再关闭重开，仍停杂项', async () => {
    await click('.segmented-btn', 1)
    await wrapper.setProps({ visible: false })
    await nextTick()
    await wrapper.setProps({ visible: true })
    await nextTick()
    const active = document.querySelector('.segmented-btn.active')
    expect(active?.textContent?.trim()).toBe('terminal.tabMisc')
  })
})
