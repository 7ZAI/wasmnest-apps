/**
 * ShortcutsPanel 结构契约（issue #19）
 *
 * 重点锁住两件事：
 * 1. 循环轮播的「单份页面标记」——两页 + 首尾克隆 = 4 个 slide，旧实现是
 *    把两页整段复制成 4 份标记；
 * 2. 语义事件边界——面板只发 shortcut / command / add / delete，频次记账与
 *    终端输入由父组件负责。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.mock('../inputAssistant', () => ({
  useInputAssistantStore: () => ({
    presetCommands: [{ id: 'preset-1', command: '/help', mode: 'execute', builtin: true }],
    visiblePanelShortcuts: [{ code: 'escape', label: 'Esc' }],
    shortcutConfig: [
      { code: 'enter', visible: true },
      { code: 'backspace', visible: true },
    ],
  }),
}))

import ShortcutsPanel from '../components/terminal-input/ShortcutsPanel.vue'

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(ShortcutsPanel, {
    props: {
      visible: true,
      isLandscape: false,
      customCommands: [],
      ...overrides,
    },
  })
}

describe('ShortcutsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('两页 + 首尾克隆共 4 个 slide（页面标记只有一份来源）', async () => {
    const wrapper = mountPanel()
    await nextTick()
    expect(wrapper.findAll('.carousel-slide')).toHaveLength(4)
    // 页码点只对应真实页
    expect(wrapper.findAll('.dot')).toHaveLength(2)
  })

  it('快捷键页点击发出 shortcut 事件', async () => {
    const wrapper = mountPanel()
    await nextTick()
    await wrapper.find('.shortcut-btn').trigger('click')
    expect(wrapper.emitted('shortcut')?.[0]).toEqual(['escape'])
  })

  it('命令页点击发出 command，编辑态点击不执行', async () => {
    const wrapper = mountPanel({
      customCommands: [{ id: 'c1', command: 'npm test', mode: 'execute', builtin: false }],
    })
    await nextTick()

    const cmdButtons = wrapper.findAll('.custom-cmd-btn').filter(b => !b.classes('edit-toggle-btn') && !b.classes('add-cmd-btn'))
    await cmdButtons[0].trigger('click')
    expect(wrapper.emitted('command')?.[0]?.[0]).toMatchObject({ command: '/help' })

    // 进入编辑态后点击命令不再执行
    await wrapper.find('.edit-toggle-btn').trigger('click')
    const before = wrapper.emitted('command')?.length ?? 0
    await cmdButtons[0].trigger('click')
    expect(wrapper.emitted('command')?.length ?? 0).toBe(before)
  })

  it('添加按钮只发 add 事件（弹窗由父组件持有）', async () => {
    const wrapper = mountPanel()
    await nextTick()
    await wrapper.find('.add-cmd-btn').trigger('click')
    expect(wrapper.emitted('add')).toBeTruthy()
  })

  it('自定义命令发出 delete 事件', async () => {
    const wrapper = mountPanel({
      customCommands: [{ id: 'c1', command: 'npm test', mode: 'execute', builtin: false }],
    })
    await nextTick()
    await wrapper.find('.edit-toggle-btn').trigger('click')
    await wrapper.find('.cmd-delete-btn').trigger('click')
    expect(wrapper.emitted('delete')?.[0]).toEqual(['c1'])
  })

  it('页码点切换真实页；关闭时上报高度 0', async () => {
    const wrapper = mountPanel()
    await nextTick()
    const dots = wrapper.findAll('.dot')
    await dots[1].trigger('click')
    expect(wrapper.find('.carousel-track').attributes('style')).toContain('translateX(-200%)')

    await wrapper.setProps({ visible: false })
    await nextTick()
    expect(wrapper.emitted('height')?.at(-1)).toEqual([0])
    // 关闭后面板不渲染（遮罩与面板同条件）
    expect(wrapper.find('.shortcuts-panel').exists()).toBe(false)
  })

  it('遮罩点击请求关闭', async () => {
    const wrapper = mountPanel()
    await nextTick()
    await wrapper.find('.shortcuts-overlay').trigger('mousedown')
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false])
  })
})
