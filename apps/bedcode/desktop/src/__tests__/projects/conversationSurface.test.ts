/**
 * 对话面组件契约（ADR 0004 / issue #23 M3 Seam 3）
 *
 * 只断言外部行为：**事件进 → 渲染出；交互 → 事件出**。挂载真组件（happy-dom）
 * + 假 context（key 直返的 i18n 桩），按 spec 的 Seam 3 清单逐 kind 断言：
 * 工具卡状态机、thinking 默认折叠、patch 文件列表、权限只读形态、镜像模式
 * 标记、截断提示、空态、排队气泡、发送 / 停止 / 重试出口。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import ConversationSurface from '@/components/chat/ConversationSurface.vue'
import type { PendingMessage, RunEvent } from '@/composables/useRunEvents'

const t = (key: string, params?: Record<string, unknown>) => {
  if (!params || Object.keys(params).length === 0) return key
  const flat = Object.entries(params)
    .map(([name, value]) => `${name}=${value}`)
    .join(',')
  return `${key}(${flat})`
}

function makeContext(): PluginContext {
  return { i18n: { t, getI18n: () => ({ global: { t } }) } } as unknown as PluginContext
}

function event(seq: number, kind: string, payload: Record<string, unknown>, source = 'bridge'): RunEvent {
  return { seq, at: '2026-10-30T10:00:00Z', kind, payload, source }
}

/** 默认活运行 + 桥接在线的基线 props（逐用例覆盖差异字段） */
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'r-1',
    runActive: true,
    agentId: 'opencode',
    events: [] as RunEvent[],
    pending: [] as PendingMessage[],
    truncated: false,
    bridgeConnected: true as boolean | null,
    loadError: null,
    loading: false,
    sending: false,
    ...overrides,
  }
}

function mountSurface(props: Record<string, unknown> = {}) {
  return mount(ConversationSurface, {
    props: baseProps(props),
    global: { provide: { pluginContext: makeContext() } },
  })
}

describe('ConversationSurface（12 类 kind 的渲染）', () => {
  it('user.message → 用户气泡；assistant.text → markdown 正文（含流式标记）', () => {
    const wrapper = mountSurface({
      events: [
        event(1, 'user.message', { text: '跑下测试' }),
        event(2, 'assistant.text', { text: '**完成** 了', streaming: true, messageId: 'm1' }),
      ],
    })
    expect(wrapper.find('[data-testid="chat-row-user"]').text()).toContain('跑下测试')
    const textRow = wrapper.find('[data-testid="chat-row-text"]')
    expect(textRow.html()).toContain('<strong>完成</strong>')
    expect(textRow.attributes('data-streaming')).toBe('true')
    expect(wrapper.find('[data-testid="chat-streaming"]').exists()).toBe(true)
  })

  it('thinking 默认折叠：只渲染开关；点开才出现正文', async () => {
    const wrapper = mountSurface({
      events: [event(1, 'assistant.thinking', { text: '推理草稿', redacted: false })],
    })
    expect(wrapper.find('[data-testid="chat-row-thinking"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-thinking-body"]').exists()).toBe(false)

    await wrapper.find('[data-testid="chat-row-thinking"] button').trigger('click')
    expect(wrapper.find('[data-testid="chat-thinking-body"]').text()).toContain('推理草稿')
  })

  it('工具卡状态机：pending → done；出错卡显示错误文本；输出默认可见（短输出）', async () => {
    const wrapper = mountSurface({
      events: [event(1, 'tool.call', { callId: 'c1', name: 'bash', args: { command: 'ls' }, status: 'pending' })],
    })
    let card = wrapper.find('[data-testid="chat-row-tool"]')
    expect(card.attributes('data-state')).toBe('pending')
    expect(card.find('[data-testid="chat-tool-state"]').text()).toBe('project.chat.toolState.pending')
    expect(card.text()).toContain('bash')

    // 同 callId 的 result 到达（数据层保证同 seq 替换 / 新 seq 追加，组件只认合并后的事件）
    await wrapper.setProps({
      events: [
        event(1, 'tool.call', { callId: 'c1', name: 'bash', args: { command: 'ls' }, status: 'running' }),
        event(2, 'tool.result', { callId: 'c1', output: 'a.txt', error: '', exitCode: 0 }),
      ],
    })
    card = wrapper.find('[data-testid="chat-row-tool"]')
    expect(wrapper.findAll('[data-testid="chat-row-tool"]')).toHaveLength(1, 'callId 归并成一张卡')
    expect(card.attributes('data-state')).toBe('done')
    expect(card.find('[data-testid="chat-tool-output"]').text()).toContain('a.txt')

    await wrapper.setProps({
      events: [
        event(1, 'tool.call', { callId: 'c1', name: 'bash', args: {}, status: 'pending' }),
        event(2, 'tool.result', { callId: 'c1', output: '', error: 'boom', exitCode: 1 }),
      ],
    })
    card = wrapper.find('[data-testid="chat-row-tool"]')
    expect(card.attributes('data-state')).toBe('error')
    expect(card.find('[data-testid="chat-tool-error"]').text()).toContain('boom')
  })

  it('长工具输出默认折叠：点「展开输出」才出现全文', async () => {
    const long = 'x'.repeat(500)
    const wrapper = mountSurface({
      events: [
        event(1, 'tool.call', { callId: 'c1', name: 'bash', args: {}, status: 'pending' }),
        event(2, 'tool.result', { callId: 'c1', output: long, error: '' }),
      ],
    })
    expect(wrapper.find('[data-testid="chat-tool-output"]').exists()).toBe(false)
    await wrapper.findAll('button').find((b) => b.text() === 'project.chat.expandOutput')!.trigger('click')
    expect(wrapper.find('[data-testid="chat-tool-output"]').text()).toBe(long)
  })

  it('patch 卡：文件列表可见；diff 默认收起、点开显示', async () => {
    const wrapper = mountSurface({
      events: [event(1, 'patch', { files: ['src/a.ts', 'src/b.ts'], diff: '--- a\n+++ b' })],
    })
    const card = wrapper.find('[data-testid="chat-row-patch"]')
    expect(card.text()).toContain('src/a.ts')
    expect(card.text()).toContain('src/b.ts')
    expect(card.text()).toContain('project.chat.patchFiles(n=2)')
    expect(wrapper.find('[data-testid="chat-patch-diff"]').exists()).toBe(false)

    await card.findAll('button')[0]!.trigger('click')
    expect(wrapper.find('[data-testid="chat-patch-diff"]').text()).toContain('+++ b')
  })

  it('plan 卡：待办项随状态渲染', () => {
    const wrapper = mountSurface({
      events: [
        event(1, 'plan', {
          items: [
            { text: '写实现', status: 'completed' },
            { text: '跑测试', status: 'in_progress' },
          ],
        }),
      ],
    })
    const items = wrapper.findAll('[data-testid="chat-row-plan"] li')
    expect(items).toHaveLength(2)
    expect(items[0]!.attributes('data-status')).toBe('completed')
    expect(items[1]!.text()).toContain('跑测试')
  })

  it('权限卡：只读提示条（无按钮），决定到达后随行显示', async () => {
    const wrapper = mountSurface({
      events: [event(1, 'permission.request', { requestId: 'pr1', tool: 'bash', input: { command: 'rm' }, canReply: false })],
    })
    const card = wrapper.find('[data-testid="chat-row-permission"]')
    expect(card.exists()).toBe(true)
    expect(card.find('[data-testid="chat-permission-readonly"]').exists()).toBe(true)
    expect(card.findAll('button')).toHaveLength(0, 'M3 权限卡不给可点按钮（不代裁）')
    expect(wrapper.find('[data-testid="chat-permission-decision"]').exists()).toBe(false)

    await wrapper.setProps({
      events: [
        event(1, 'permission.request', { requestId: 'pr1', tool: 'bash', input: {}, canReply: false }),
        event(2, 'permission.replied', { requestId: 'pr1', decision: 'once', by: 'user' }),
      ],
    })
    expect(wrapper.find('[data-testid="chat-permission-decision"]').text()).toBe('once')
  })

  it('error → 错误条（正文 + code）；status → 执行状态指示（busy 占行，idle 不占）', async () => {
    const wrapper = mountSurface({
      events: [
        event(1, 'error', { code: 'ProviderAuthError', message: 'bad key' }),
        event(2, 'status', { state: 'busy' }),
      ],
    })
    const errorRow = wrapper.find('[data-testid="chat-row-error"]')
    expect(errorRow.text()).toContain('bad key')
    expect(wrapper.find('[data-testid="chat-agent-state"]').text()).toContain(
      'project.chat.agentState.busy',
    )

    await wrapper.setProps({ events: [event(1, 'error', { code: 'X', message: 'x' }), event(2, 'status', { state: 'idle' })] })
    expect(wrapper.find('[data-testid="chat-agent-state"]').exists()).toBe(false)
  })

  it('session.meta 不进时间线', () => {
    const wrapper = mountSurface({
      events: [event(1, 'session.meta', { agentSessionId: 'ses_1', title: '修登录' })],
    })
    expect(wrapper.find('[data-testid="chat-empty"]').exists()).toBe(true, '没有可渲染的对话行')
  })
})

describe('ConversationSurface（排队气泡与空态）', () => {
  it('pending → 「排队中」气泡；事件流回显后由数据层摘除（这里只认 props）', () => {
    const wrapper = mountSurface({
      events: [event(1, 'user.message', { text: '上一条' })],
      pending: [{ id: 1, text: '刚发的' }],
    })
    const pendingRow = wrapper.find('[data-testid="chat-row-pending"]')
    expect(pendingRow.exists()).toBe(true)
    expect(pendingRow.text()).toContain('刚发的')
    expect(pendingRow.text()).toContain('project.chat.queued')
  })

  it('空态：有运行给发消息引导；没运行给启动引导', () => {
    const withRun = mountSurface({})
    expect(withRun.find('[data-testid="chat-empty"]').exists()).toBe(true)
    expect(withRun.find('[data-testid="chat-empty"]').text()).toContain('project.chat.emptyTitle')

    const noRun = mountSurface({ runId: null })
    expect(noRun.find('[data-testid="chat-empty"]').text()).toContain('project.chat.emptyNoRun')
  })
})

describe('ConversationSurface（降级面）', () => {
  it('镜像模式：横幅 + 输入禁用并说明原因 + 发送按钮禁用；不发 send', async () => {
    const wrapper = mountSurface({
      events: [event(1, 'user.message', { text: '历史' })],
      bridgeConnected: false,
    })
    expect(wrapper.find('[data-testid="chat-mirror-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-mirror-banner"]').text()).toContain(
      'project.chat.mirrorHint',
    )
    expect(wrapper.find('[data-testid="chat-input-reason"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(false)

    const send = wrapper.find('[data-testid="chat-send"]')
    expect(send.attributes('disabled')).toBeDefined()
    await send.trigger('click')
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('pi 未授信：镜像横幅换成「需在终端授予项目信任」文案', () => {
    const wrapper = mountSurface({ agentId: 'pi', bridgeConnected: false })
    expect(wrapper.find('[data-testid="chat-mirror-banner"]').text()).toContain(
      'project.chat.mirrorPiTrust',
    )
  })

  it('终态运行：输入禁用并说明「运行已结束」；停止按钮不出现', () => {
    const wrapper = mountSurface({ runActive: false })
    expect(wrapper.find('[data-testid="chat-input-reason"]').text()).toContain(
      'project.chat.runEnded',
    )
    expect(wrapper.find('[data-testid="chat-stop"]').exists()).toBe(false)
  })

  it('截断横幅：truncated=true 时显示', () => {
    const wrapper = mountSurface({ truncated: true })
    expect(wrapper.find('[data-testid="chat-truncated-banner"]').exists()).toBe(true)
  })

  it('读取失败：错误横幅 + 重试按钮（点击 emit retry）', async () => {
    const wrapper = mountSurface({ loadError: 'run not found' })
    expect(wrapper.find('[data-testid="chat-load-error"]').exists()).toBe(true)
    await wrapper.find('[data-testid="chat-retry"]').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})

describe('ConversationSurface（发送与停止）', () => {
  it('输入 + 点发送 → emit send（trim 后文本）；发送中不再发', async () => {
    const wrapper = mountSurface({})
    await wrapper.find('[data-testid="chat-input"]').setValue('  再来一轮  ')
    await wrapper.find('[data-testid="chat-send"]').trigger('click')
    expect(wrapper.emitted('send')).toEqual([['再来一轮']])

    await wrapper.setProps({ sending: true })
    await wrapper.find('[data-testid="chat-input"]').setValue('第二条')
    await wrapper.find('[data-testid="chat-send"]').trigger('click')
    expect(wrapper.emitted('send')).toHaveLength(1, 'sending 在途时不再发')
  })

  it('Enter 发送 / Shift+Enter 换行；空文本不发', async () => {
    const wrapper = mountSurface({})
    const input = wrapper.find('[data-testid="chat-input"]')
    await input.setValue('第一条')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')).toEqual([['第一条']])

    await input.setValue('第二条')
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('send')).toHaveLength(1)

    await input.setValue('   ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  it('活运行显示停止按钮：点击 emit stop', async () => {
    const wrapper = mountSurface({})
    expect(wrapper.find('[data-testid="chat-stop"]').exists()).toBe(true)
    await wrapper.find('[data-testid="chat-stop"]').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
  })
})
