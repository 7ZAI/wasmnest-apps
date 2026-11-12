/**
 * Nest 移动运行面包装单测（票 08 对话主链路）
 *
 * 覆盖壳装配与命令 / 事件接线：挂载后自动执行 `assistant.vault-status`（经宿主
 * commands.execute），保险库已解锁进会话页（ChatView）、未解锁落保险库门；
 * 事件订阅绑定 `context.events.on`（宿主流式通道接线）；失败路径点名原因。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AssistantSurface from '../components/AssistantSurface.vue'
import { messages } from '../i18n'
import { ASSISTANT_PLUGIN_ID } from '@nest-shared/types'

const NAMESPACE = 'com.wasmnest.assistant'

/** 测试用 i18n：与宿主注册口径一致（插件 ID 前缀的扁平 key） */
function makeI18n(locale = 'zh-CN') {
  const prefixed: Record<string, string> = {}
  for (const [key, value] of Object.entries(messages['zh-CN'])) {
    prefixed[`${NAMESPACE}.${key}`] = value
  }
  const enPrefixed: Record<string, string> = {}
  for (const [key, value] of Object.entries(messages.en)) {
    enPrefixed[`${NAMESPACE}.${key}`] = value
  }
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'zh-CN',
    messages: { 'zh-CN': prefixed, en: enPrefixed },
  })
}

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  vi.restoreAllMocks()
})

interface FakeContext {
  id: string
  commands: { execute: (command: string, ...args: unknown[]) => Promise<unknown> }
  events: { on: (event: string, handler: (payload: unknown) => void) => { dispose: () => void } }
}

function mountSurface(
  execute: (command: string, ...args: unknown[]) => Promise<unknown>,
  events?: FakeContext['events'],
) {
  const context: FakeContext = {
    id: NAMESPACE,
    commands: { execute },
    events: events ?? { on: () => ({ dispose: () => {} }) },
  }
  const wrapper = mount(AssistantSurface, {
    global: {
      plugins: [makeI18n()],
      provide: { pluginContext: context },
    },
  })
  mounted.push(wrapper)
  return wrapper
}

describe('AssistantSurface（移动运行面接线 · 票 08 对话主链路）', () => {
  it('保险库已解锁：进会话页（ChatView），挂载后查状态与供应商', async () => {
    const execute = vi.fn(async (_command: string, _args?: unknown) => ({ exists: true, unlocked: true }))
    const wrapper = mountSurface(execute)

    await flushPromises()

    expect(execute).toHaveBeenCalledWith('assistant.vault-status', undefined)
    expect(wrapper.find('[data-testid="nest-chat"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nest-vault"]').exists()).toBe(false)
    const commands = execute.mock.calls.map((c) => c[0])
    expect(commands).toContain('assistant.providers-list')
  })

  it('保险库未解锁：落保险库门，不进对话', async () => {
    const execute = vi.fn(async () => ({ exists: true, unlocked: false }))
    const wrapper = mountSurface(execute)

    await flushPromises()

    expect(wrapper.find('[data-testid="nest-vault"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nest-chat"]').exists()).toBe(false)
  })

  it('状态查询失败：保险库门显性报错，点名原因', async () => {
    const execute = vi.fn(async () => {
      throw new Error('vault missing')
    })
    const wrapper = mountSurface(execute)

    await flushPromises()

    const errorEl = wrapper.find('[data-testid="nest-vault-error"]')
    expect(errorEl.text()).toContain('vault missing')
  })

  it('事件订阅绑定 context.events.on：发送消息后订阅流通道并渲染流式回复', async () => {
    const handlers: Array<{ event: string; handler: (payload: unknown) => void }> = []
    const on = vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.push({ event, handler })
      return { dispose: vi.fn() }
    })
    const execute = vi.fn(async (command: string) => {
      switch (command) {
        case 'assistant.vault-status':
          return { exists: true, unlocked: true }
        case 'assistant.providers-list':
          return { providers: [{ id: 'p1', name: 'Test', apiStyle: 'openai-compatible', baseUrl: 'https://example.test/v1', model: 'm1', isDefault: true }] }
        case 'assistant.vault-get-secret':
          return { key: 'provider:p1', value: 'sk-test' }
        case 'assistant.chat-stream':
          return { streamId: 's1', streamEvent: 'assistant:stream:s1' }
        case 'assistant.conversations-list':
          return { conversations: [] }
        case 'assistant.conversations-create':
          return { ok: true, id: 'c1' }
        case 'assistant.messages-append':
          return { ok: true }
        default:
          return {}
      }
    })
    const wrapper = mountSurface(execute, { on })
    await flushPromises()

    // 发送一条消息
    await wrapper.find('[data-testid="nest-composer-input"]').setValue('你好')
    await wrapper.find('[data-testid="nest-composer-send"]').trigger('click')
    await flushPromises()

    // 订阅了宿主流通道（事件名与 chat-stream 受理回显一致）
    const streamSub = handlers.find((h) => h.event === 'assistant:stream:s1')
    expect(streamSub).toBeTruthy()

    // 推送 SSE 流：正文增量 + 结束帧
    streamSub!.handler({
      chunk: 'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      done: false,
    })
    streamSub!.handler({
      chunk: 'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      done: false,
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="nest-msg-assistant"]').text()).toContain('你')

    streamSub!.handler({ done: true })
    await flushPromises()
    expect(wrapper.find('[data-testid="nest-msg-assistant"]').text()).toContain('你好')
    expect(wrapper.find('[data-testid="nest-composer-send"]').exists()).toBe(true)
  })
})
