/**
 * 检查器「事件」页签契约（issue #23 M3 / issue #25 M2）
 *
 * 只断言外部行为：展开 / 收起互斥切换；**流式增量（数组换引用）不清展开态**；
 * 换运行（账本清空后再灌新 seq）自动重置。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import ChatEventInspector from '@/components/chat/ChatEventInspector.vue'
import type { RunEvent } from '@/composables/useRunEvents'

const t = (key: string) => key

function makeContext(): PluginContext {
  return { i18n: { t, getI18n: () => ({ global: { t } }) } } as unknown as PluginContext
}

function event(seq: number, kind: string, payload: Record<string, unknown>, source = 'bridge'): RunEvent {
  return { seq, at: '2026-10-30T10:00:00Z', kind, payload, source }
}

/** payload JSON 超过折叠阈值（120 字符）的事件：渲染展开开关 */
function longEvent(seq: number, kind = 'assistant.text'): RunEvent {
  return event(seq, kind, {
    text: 'x'.repeat(200),
    messageId: `m-${seq}`,
  })
}

function mountInspector(props: Record<string, unknown> = {}) {
  return mount(ChatEventInspector, {
    props: { events: [] as RunEvent[], loading: false, loadError: null, ...props },
    global: { provide: { pluginContext: makeContext() } },
  })
}

async function expandFirst(wrapper: ReturnType<typeof mountInspector>): Promise<void> {
  await wrapper.find('[data-testid="inspector-event-row"] button').trigger('click')
}

describe('ChatEventInspector（展开态维护）', () => {
  it('长 payload 折叠呈现：点开出现完整 JSON，再点收起', async () => {
    const wrapper = mountInspector({ events: [longEvent(1)] })
    const row = wrapper.find('[data-testid="inspector-event-row"]')
    expect(row.find('pre').exists()).toBe(false)
    expect(row.text()).toContain('xxx', '折叠态给单行摘要')

    await expandFirst(wrapper)
    expect(wrapper.find('pre').exists()).toBe(true)
    expect(wrapper.find('pre').text()).toContain('m-1')

    await expandFirst(wrapper)
    expect(wrapper.find('pre').exists()).toBe(false)
  })

  it('流式增量（新事件到达、数组换引用）不清掉已展开的 payload', async () => {
    const wrapper = mountInspector({ events: [longEvent(1)] })
    await expandFirst(wrapper)
    expect(wrapper.find('pre').exists()).toBe(true)

    // 模拟增量合并：新数组引用、追加 seq 2（流式期间每秒都在发生）
    await wrapper.setProps({ events: [longEvent(1), longEvent(2, 'session.meta')] })
    expect(wrapper.find('pre').exists()).toBe(true, '展开态必须跨轮询保持')

    // 新事件的展开独立工作；已展开的仍可收起
    const buttons = wrapper.findAll('[data-testid="inspector-event-row"] button')
    await buttons[1].trigger('click')
    expect(wrapper.findAll('pre')).toHaveLength(2)
  })

  it('换运行（账本清空后灌新 seq）重置展开态', async () => {
    const wrapper = mountInspector({ events: [longEvent(1)] })
    await expandFirst(wrapper)
    expect(wrapper.find('pre').exists()).toBe(true)

    // 换运行：useRunEvents.reset() 先清空账本，再灌新运行的 seq
    await wrapper.setProps({ events: [] })
    await wrapper.setProps({ events: [longEvent(1)] })
    expect(wrapper.find('pre').exists()).toBe(false, '新运行的行不得继承旧展开态')
  })

  it('行内已不存在的 seq 被剔除：原地更新换 seq 后旧展开态不悬挂', async () => {
    const wrapper = mountInspector({ events: [longEvent(1)] })
    await expandFirst(wrapper)
    // 账本重排（如截断淘汰）：seq 1 消失，只剩 seq 9
    await wrapper.setProps({ events: [longEvent(9)] })
    expect(wrapper.findAll('pre')).toHaveLength(0)
    // seq 9 默认折叠，需重新展开
    await expandFirst(wrapper)
    expect(wrapper.findAll('pre')).toHaveLength(1)
  })
})
