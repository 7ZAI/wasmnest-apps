import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import QuickPanel from '@nest-shared/components/QuickPanel.vue'

const t = (key: string): string => key

const baseProps = {
  messages: [],
  streaming: false,
  mascotState: 'idle' as const,
  locked: false,
  t,
}

describe('QuickPanel', () => {
  it('以非模态 dialog 语义渲染并含输入区', () => {
    const wrapper = mount(QuickPanel, { props: baseProps })
    expect(wrapper.attributes('role')).toBe('dialog')
    expect(wrapper.attributes('aria-modal')).toBe('false')
    expect(wrapper.find('[data-testid="nest-composer-send"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nest-quickpanel-close"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nest-quickpanel-expand"]').exists()).toBe(true)
  })

  it('小窗不出现设置、记忆、审计管理入口', () => {
    const wrapper = mount(QuickPanel, { props: baseProps })
    expect(wrapper.find('[data-testid="nest-open-settings"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nest-open-memory"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nest-open-audit"]').exists()).toBe(false)
  })

  it('Esc 关闭小窗', async () => {
    const wrapper = mount(QuickPanel, { props: baseProps, attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('锁定时只给展开解锁出口，不渲染输入区', () => {
    const wrapper = mount(QuickPanel, { props: { ...baseProps, locked: true } })
    expect(wrapper.find('[data-testid="nest-quickpanel-locked"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nest-quickpanel-unlock"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nest-composer-send"]').exists()).toBe(false)
  })
})