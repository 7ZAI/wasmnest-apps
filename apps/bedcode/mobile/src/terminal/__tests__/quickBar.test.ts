/**
 * QuickBar 结构契约（issue #19）：纯展示 + select 事件，category → 样式类映射。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import QuickBar from '../components/terminal-input/QuickBar.vue'

const items = [
  { type: 'shortcut', key: 'escape', label: 'Esc', category: 'shortcut' },
  { type: 'shortcut', key: 'enter', label: 'Enter', category: 'enter' },
  { type: 'command', key: 'c1', label: 'npm test', category: 'custom' },
] as never

describe('QuickBar', () => {
  it('无项目时不渲染（不占高度）', () => {
    const wrapper = mount(QuickBar, { props: { items: [] } })
    expect(wrapper.find('.quick-bar').exists()).toBe(false)
  })

  it('按 category 映射样式类', () => {
    const wrapper = mount(QuickBar, { props: { items } })
    const buttons = wrapper.findAll('.quick-bar-btn')
    expect(buttons).toHaveLength(3)
    expect(buttons[0].classes()).toContain('quick-bar-shortcut')
    expect(buttons[1].classes()).toContain('quick-bar-enter')
    expect(buttons[2].classes()).toContain('quick-bar-custom')
  })

  it('点击发出 select 事件并带回原项目', async () => {
    const wrapper = mount(QuickBar, { props: { items } })
    await wrapper.findAll('.quick-bar-btn')[2].trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ key: 'c1', type: 'command' })
  })
})
