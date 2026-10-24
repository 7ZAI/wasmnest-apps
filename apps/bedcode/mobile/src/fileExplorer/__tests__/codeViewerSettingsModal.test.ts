/**
 * CodeViewerSettingsModal 脏稿守卫契约测试（issue #16）
 *
 * 与终端设置弹窗同一守卫语义：干净状态遮罩点击直接关；有草稿先弹丢弃确认
 * （ConfirmDialog，danger），确认后才丢弃。头部关闭与底部取消是显式意图，不设守卫。
 *
 * 组件根为 Teleport(to=body)，断言走 document；fileExplorer host fallback 的
 * t 回显 key，丢弃确认以 codeViewer.discardChangesTitle 文本定位。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'

import CodeViewerSettingsModal from '../components/CodeViewerSettingsModal.vue'
import { useCodeViewerStore } from '../stores/codeViewer'

/** 丢弃确认弹窗面板（含 discardChangesTitle 文案；设置弹窗本体不含该 key） */
function discardDialogPanel(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('.modal-panel')].find((p) =>
      p.textContent!.includes('codeViewer.discardChangesTitle'),
    ) ?? null
  )
}

async function clickDiscardButton(index: number) {
  const panel = discardDialogPanel()
  expect(panel, '丢弃确认弹窗应已挂载').toBeTruthy()
  panel!.querySelectorAll('button')[index].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await nextTick()
}

/** 点击遮罩（bubbles:false 使 target === currentTarget，等价 @click.self 命中） */
async function clickOverlay() {
  const overlay = document.querySelector('.settings-modal-overlay')
  expect(overlay).toBeTruthy()
  overlay!.dispatchEvent(new MouseEvent('click', { bubbles: false }))
  await nextTick()
  await nextTick()
}

/** 改动排版页字号（第 2 个步进按钮 = 字号「+」）制造脏稿 */
async function makeDirty() {
  const plus = [...document.querySelectorAll('.size-btn')][1]
  plus.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await nextTick()
}

describe('CodeViewerSettingsModal 脏稿守卫（#16）', () => {
  let wrapper: ReturnType<typeof mount>

  beforeEach(() => {
    localStorage.clear()
    const pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(CodeViewerSettingsModal, {
      props: { visible: true },
      global: {
        plugins: [pinia],
        provide: {
          safeArea: ref({ top: 0, bottom: 0 }),
        },
      },
    })
  })

  afterEach(() => {
    wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('干净状态：遮罩点击直接关（close），不弹丢弃确认', async () => {
    await clickOverlay()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(discardDialogPanel()).toBeNull()
  })

  it('有草稿：遮罩点击只弹丢弃确认，不丢稿；确认后才 close', async () => {
    await makeDirty()
    await clickOverlay()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(discardDialogPanel()).not.toBeNull()

    await clickDiscardButton(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(discardDialogPanel()).toBeNull()
    // 丢弃 = 不落库：store 保持默认字号
    expect(useCodeViewerStore().settings.fontSize).toBe(8)
  })

  it('有草稿：丢弃确认点取消 → 草稿保留，再次遮罩点击守卫仍生效', async () => {
    await makeDirty()
    await clickOverlay()
    await clickDiscardButton(0)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(discardDialogPanel()).toBeNull()

    await clickOverlay()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(discardDialogPanel()).not.toBeNull()
  })
})
