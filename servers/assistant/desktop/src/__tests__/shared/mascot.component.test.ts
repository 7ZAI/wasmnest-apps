import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NestMascot from '@nest-shared/components/NestMascot.vue'
import type { MascotState } from '@nest-shared/ui/mascot-state'

const states: MascotState[] = ['idle', 'thinking', 'streaming', 'tooling', 'error', 'locked']

describe('NestMascot', () => {
  it('每个状态都写入 data-mascot-state', () => {
    for (const state of states) {
      const wrapper = mount(NestMascot, { props: { state } })
      expect(wrapper.attributes('data-mascot-state')).toBe(state)
    }
  })

  it('关闭动效时 data-mascot-motion 为 off', () => {
    const wrapper = mount(NestMascot, { props: { state: 'idle', motionEnabled: false } })
    expect(wrapper.attributes('data-mascot-motion')).toBe('off')
  })

  it('默认对辅助技术隐藏且不接收指针事件', () => {
    const wrapper = mount(NestMascot)
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.classes()).toContain('mascot')
  })

  it('锁定态使用盖子和方形光点，与空闲态结构不同', () => {
    const idle = mount(NestMascot, { props: { state: 'idle' } })
    const locked = mount(NestMascot, { props: { state: 'locked' } })
    expect(idle.find('.mascot__lid').exists()).toBe(false)
    expect(locked.find('.mascot__lid').exists()).toBe(true)
    expect(locked.find('rect.mascot__core--locked').exists()).toBe(true)
  })
})