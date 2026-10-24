/**
 * TerminalSettingsModal 脏稿守卫契约测试（issue #16）
 *
 * 修复前遮罩是 @click.self="cancel"：调了若干项后误触弹窗边缘 = 未确认修改
 * 静默全丢。守卫语义：干净状态遮罩点击直接关；有草稿先弹丢弃确认（ConfirmDialog），
 * 确认后才丢弃。头部关闭与底部取消是显式用户意图，不设守卫（对话框惯例）。
 *
 * 组件根为 Teleport(to=body)，断言一律走 document（wrapper.find 看不进传送门）；
 * host fallback 的 t 回显 key，丢弃确认弹窗内容以 i18n key 文本定位。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { installMockMobileApi, uninstallMockMobileApi } from './testKit'

// 触摸滑动切 Tab 替身：本测试不驱动滑动
vi.mock('@binblink/wasmnest-plugin-sdk-mobile/ui/swipe-tabs', () => ({
  useSwipeTabs: () => ({
    onTouchStart: () => {},
    onTouchMove: () => {},
    onTouchEnd: () => {},
  }),
}))

import TerminalSettingsModal from '../components/TerminalSettingsModal.vue'
import type { ToolbarItemConfig } from '../components/TerminalSettingsModal.vue'

const ALL_TOOLBAR_ITEMS: ToolbarItemConfig[] = [
  { key: 'task', label: 'terminal.toolbarTask', icon: 'task' },
  { key: 'folder', label: 'terminal.toolbarFolder', icon: 'folder' },
]

function mountModal() {
  return mount(TerminalSettingsModal, {
    props: {
      visible: true,
      fontSize: 14,
      theme: 'dark',
      isThemeUserSet: false,
      letterSpacing: 0,
      quickBarCount: 6,
      toolbarItems: ['folder'],
      allToolbarItems: ALL_TOOLBAR_ITEMS,
      onboardingPending: false,
      safeAreaStyle: {},
    },
  })
}

/** 丢弃确认弹窗面板（body 里含 discardChangesTitle 文案的 modal-panel；设置弹窗本体不含该 key） */
function discardDialogPanel(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('.modal-panel')].find((p) =>
      p.textContent!.includes('terminal.discardChangesTitle'),
    ) ?? null
  )
}

/** 点击丢弃确认弹窗里的按钮（DOM 序：[0]=取消 [1]=确认） */
async function clickDiscardButton(index: number) {
  const panel = discardDialogPanel()
  expect(panel, '丢弃确认弹窗应已挂载').toBeTruthy()
  panel!.querySelectorAll('button')[index].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await nextTick()
}

/** 点击设置弹窗遮罩（bubbles:false 使 target === currentTarget，等价 @click.self 命中） */
async function clickOverlay() {
  const overlay = document.querySelector('.settings-modal-overlay')
  expect(overlay).toBeTruthy()
  overlay!.dispatchEvent(new MouseEvent('click', { bubbles: false }))
  await nextTick()
  await nextTick()
}

/** 改动字号（外观页第 2 个步进按钮 = 字号「+」）制造脏稿 */
async function makeDirty() {
  const plus = [...document.querySelectorAll('.size-btn')][1]
  plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await nextTick()
}

describe('TerminalSettingsModal 脏稿守卫（#16）', () => {
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

  it('干净状态：遮罩点击直接关（cancel），不弹丢弃确认', async () => {
    await clickOverlay()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(discardDialogPanel()).toBeNull()
  })

  it('有草稿：遮罩点击只弹丢弃确认，不丢稿；确认后才 cancel', async () => {
    await makeDirty()
    await clickOverlay()
    // 未丢弃：cancel 未发出，确认弹窗在场
    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(discardDialogPanel()).not.toBeNull()

    await clickDiscardButton(1)
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(discardDialogPanel()).toBeNull()
  })

  it('有草稿：丢弃确认点取消 → 弹窗保留草稿，再次遮罩点击守卫仍生效', async () => {
    await makeDirty()
    await clickOverlay()
    await clickDiscardButton(0)
    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(discardDialogPanel()).toBeNull()

    // 草稿仍在：再点遮罩守卫再次弹出（而非直接关）
    await clickOverlay()
    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(discardDialogPanel()).not.toBeNull()
  })
})
