/**
 * AI Chatbox 多任务卡片只读预览面单测（apps 仓 spec 2026-10-20 · Testing Decisions Seam 4）
 *
 * 覆盖外部可观察行为：
 * ① 正常数据渲染（最近对话标题 + 供应商/模型 + 最近 3 条消息摘要）；
 * ② 未配置供应商 / 无对话 / 命令失败 → 诚实空态且不抛；
 * ③ 只读无副作用（无 interval / 全局 listener / 写存储 / 真实模型请求）；
 * ④ 卸载清理（晚到数据不写已卸载预览面；mountPreview 卸载后容器清空）；
 * ⑤ 预览 DOM 无可聚焦控件（ready / 空态 / 骨架）；
 * ⑥ `mountPreview` 不等待数据即返回句柄（首帧先骨架）；
 * ⑦ `entry.ts` 源码导出 `mountPreview` 且契约关键字段在场（L5 drift 锁的 app 侧前提）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import i18n from '../i18n'
import PreviewCard from '../preview/PreviewCard.vue'
import { mountPreview, type AppPreviewEnv } from '../entry'
import type { ChatMessage, ConversationMeta } from '../types'
// 源码扫描用：Vite `?raw` 读原文（避免引入 node fs，tsconfig 无 @types/node）
import entrySource from '../entry.ts?raw'
import previewCardSource from '../preview/PreviewCard.vue?raw'

/** 可聚焦控件选择器（spec Seam 4 逐字） */
const FOCUSABLE_SELECTOR =
  'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const DEFAULT_PROVIDERS = JSON.stringify([{ id: 'p1', name: 'DeepSeek' }])

const CONVERSATIONS: ConversationMeta[] = [
  {
    id: 'conv-old',
    title: '旧对话',
    createdAt: '2026-10-17T08:00:00Z',
    updatedAt: '2026-10-18T10:00:00Z',
    providerId: 'p1',
    providerName: 'DeepSeek',
    model: 'deepseek-chat',
  },
  {
    id: 'conv-new',
    title: '周会纪要',
    createdAt: '2026-10-19T08:00:00Z',
    updatedAt: '2026-10-20T09:00:00Z',
    providerId: 'p1',
    providerName: 'DeepSeek',
    model: 'deepseek-chat',
  },
]

const MESSAGES: ChatMessage[] = [
  { role: 'user', content: '第一条很早的消息', timestamp: '2026-10-20T08:00:00Z' },
  { role: 'assistant', content: '第二条回答', timestamp: '2026-10-20T08:01:00Z' },
  { role: 'user', content: '第三条比较新的问题', timestamp: '2026-10-20T08:02:00Z' },
  {
    role: 'assistant',
    content: '第四条最新的回答，内容略长一些用于摘要展示',
    timestamp: '2026-10-20T08:03:00Z',
  },
]

type ListHandler = () => Promise<{ conversations?: ConversationMeta[] }>
type MessagesHandler = (args: unknown[]) => Promise<{ messages?: ChatMessage[] }>

interface EnvOptions {
  providers?: unknown
  listConversations?: ListHandler
  getMessages?: MessagesHandler
  storageGet?: (key: string) => Promise<unknown>
  lastRoute?: string
  locale?: string
  theme?: string
}

interface EnvHarness {
  env: AppPreviewEnv
  calls: { command: string; args: unknown[] }[]
  storageReads: string[]
}

/** 构造只读预览环境（与宿主注入面同形：无 invoke / 无写存储 / 无事件出口） */
function makeEnv(options: EnvOptions = {}): EnvHarness {
  const calls: { command: string; args: unknown[] }[] = []
  const storageReads: string[] = []
  const providers = 'providers' in options ? options.providers : DEFAULT_PROVIDERS

  const env: AppPreviewEnv = {
    appId: 'com.wasmnest.ai-chatbox',
    lastRoute: options.lastRoute,
    locale: options.locale ?? 'zh-CN',
    theme: options.theme ?? 'light',
    platform: 'desktop',
    appStorageGet: async <T = unknown,>(key: string): Promise<T | undefined> => {
      storageReads.push(key)
      if (options.storageGet) return (await options.storageGet(key)) as T
      return providers as T
    },
    appInvoke: async <T = unknown,>(command: string, ...args: unknown[]): Promise<T> => {
      calls.push({ command, args })
      if (command === 'ai-chatbox.list-conversations') {
        const result = options.listConversations
          ? await options.listConversations()
          : { conversations: [] }
        return result as T
      }
      if (command === 'ai-chatbox.get-messages') {
        const result = options.getMessages ? await options.getMessages(args) : { messages: [] }
        return result as T
      }
      throw new Error(`预览不得调用该命令: ${command}`)
    },
  }

  return { env, calls, storageReads }
}

async function mountCard(env: AppPreviewEnv) {
  const wrapper = mount(PreviewCard, {
    props: { env },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return wrapper
}

function expectNoFocusable(root: ParentNode): void {
  expect(root.querySelectorAll(FOCUSABLE_SELECTOR)).toHaveLength(0)
}

beforeEach(() => {
  i18n.global.locale.value = 'zh-CN'
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('PreviewCard 正常数据', () => {
  it('渲染最近对话标题、供应商/模型与最近 3 条消息摘要', async () => {
    const { env } = makeEnv({
      listConversations: async () => ({ conversations: CONVERSATIONS }),
      getMessages: async () => ({ messages: MESSAGES }),
    })
    const wrapper = await mountCard(env)

    expect(wrapper.attributes('data-state')).toBe('ready')
    const text = wrapper.text()
    expect(text).toContain('最近对话')
    expect(text).toContain('周会纪要')
    expect(text).toContain('DeepSeek · deepseek-chat')
    // 只展示最近 3 条：更早的第一条不出现，末 3 条按顺序都在
    expect(text).toContain('第二条回答')
    expect(text).toContain('第三条比较新的问题')
    expect(text).toContain('第四条最新的回答')
    expect(text).not.toContain('第一条很早的消息')
    expect(wrapper.findAll('.ai-chatbox-preview__msg')).toHaveLength(3)
    // 角色标签（用户 / AI）
    expect(text).toContain('我')
    expect(text).toContain('AI')

    wrapper.unmount()
  })

  it('lastRoute 末段命中对话 id 时优先展示该对话（只作线索，不替代真实数据）', async () => {
    const { env, calls } = makeEnv({
      lastRoute: '/chat/conv-old',
      listConversations: async () => ({ conversations: CONVERSATIONS }),
      getMessages: async () => ({ messages: MESSAGES }),
    })
    const wrapper = await mountCard(env)

    // conv-old 虽然更新更早，但 lastRoute 点名了它
    expect(wrapper.text()).toContain('旧对话')
    expect(wrapper.text()).not.toContain('周会纪要')
    const messageCall = calls.find((c) => c.command === 'ai-chatbox.get-messages')
    expect(messageCall?.args[0]).toEqual({ conversationId: 'conv-old' })
    expect(wrapper.text()).toContain('上次停留：/chat/conv-old')

    wrapper.unmount()
  })

  it('未命名对话的 i18n key 标题渲染为本地化文案（不显示原始 key）', async () => {
    const { env } = makeEnv({
      listConversations: async () => ({
        conversations: [{ ...CONVERSATIONS[1], title: 'com.wasmnest.ai-chatbox.newConversation' }],
      }),
      getMessages: async () => ({ messages: [] }),
    })
    const wrapper = await mountCard(env)

    expect(wrapper.text()).toContain('新对话')
    expect(wrapper.text()).not.toContain('com.wasmnest.ai-chatbox.newConversation')

    wrapper.unmount()
  })
})

describe('PreviewCard 诚实空态', () => {
  it('未配置供应商 → 空态文案，且不调用会话命令', async () => {
    const { env, calls, storageReads } = makeEnv({ providers: '[]' })
    const wrapper = await mountCard(env)

    expect(wrapper.attributes('data-state')).toBe('no-provider')
    expect(wrapper.text()).toContain('尚未配置模型供应商')
    expect(storageReads).toEqual(['apiProviders'])
    expect(calls).toHaveLength(0)

    wrapper.unmount()
  })

  it('已配置供应商但无对话 → 空态文案', async () => {
    const { env } = makeEnv({ listConversations: async () => ({ conversations: [] }) })
    const wrapper = await mountCard(env)

    expect(wrapper.attributes('data-state')).toBe('no-conversation')
    expect(wrapper.text()).toContain('还没有对话')

    wrapper.unmount()
  })

  it('对话命令失败 → 诚实「预览暂不可用」且不抛错、不弹窗', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { env } = makeEnv({
      listConversations: async () => {
        throw new Error('boom')
      },
    })
    const wrapper = await mountCard(env)

    expect(wrapper.attributes('data-state')).toBe('unavailable')
    expect(wrapper.text()).toContain('预览暂不可用')
    expect(warn).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('KV 读取失败 → 诚实「预览暂不可用」，不编造数据', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { env } = makeEnv({
      storageGet: async () => {
        throw new Error('storage denied')
      },
    })
    const wrapper = await mountCard(env)

    expect(wrapper.attributes('data-state')).toBe('unavailable')
    expect(wrapper.text()).toContain('预览暂不可用')

    wrapper.unmount()
  })

  it('对话无消息 → 空态摘要提示（不伪造消息）', async () => {
    const { env } = makeEnv({
      listConversations: async () => ({ conversations: CONVERSATIONS }),
      getMessages: async () => ({ messages: [] }),
    })
    const wrapper = await mountCard(env)

    expect(wrapper.attributes('data-state')).toBe('ready')
    expect(wrapper.text()).toContain('这段对话还没有消息')
    expect(wrapper.findAll('.ai-chatbox-preview__msg')).toHaveLength(0)

    wrapper.unmount()
  })
})

describe('PreviewCard 只读无副作用', () => {
  it('不启动 interval / 全局监听，只调用只读命令，不碰写存储与模型请求', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const windowListenerSpy = vi.spyOn(window, 'addEventListener')
    const documentListenerSpy = vi.spyOn(document, 'addEventListener')
    const { env, calls } = makeEnv({
      listConversations: async () => ({ conversations: CONVERSATIONS }),
      getMessages: async () => ({ messages: MESSAGES }),
    })

    const wrapper = await mountCard(env)

    expect(intervalSpy).not.toHaveBeenCalled()
    expect(timeoutSpy).not.toHaveBeenCalled()
    expect(windowListenerSpy).not.toHaveBeenCalled()
    expect(documentListenerSpy).not.toHaveBeenCalled()
    // 只读命令白名单：无 chat-complete / chat-stream（预览不发真实模型请求）
    expect(calls.map((c) => c.command).sort()).toEqual([
      'ai-chatbox.get-messages',
      'ai-chatbox.list-conversations',
    ])
    // 预览环境是收窄面（宿主机契约）：没有宿主 invoke / 写存储 / 事件出口
    expect('invoke' in env).toBe(false)
    expect('appStorageSet' in env).toBe(false)
    expect('appStorageDelete' in env).toBe(false)
    expect('onEvent' in env).toBe(false)

    wrapper.unmount()
  })

  it('预览组件源码不含写存储 / 定时器 / 全局监听 / 模型命令调用', () => {
    const source = previewCardSource
    expect(source).not.toMatch(/appStorageSet|appStorageDelete/)
    expect(source).not.toMatch(/setInterval|setTimeout/)
    expect(source).not.toMatch(/addEventListener/)
    expect(source).not.toMatch(/ai-chatbox\.chat-(complete|stream)/)
    // 只读命令确实只用这两条
    expect(source).toContain('ai-chatbox.list-conversations')
    expect(source).toContain('ai-chatbox.get-messages')
  })
})

describe('PreviewCard 卸载清理', () => {
  it('卸载后晚到数据不写入已卸载预览面，也不报错', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let resolveMessages!: (value: { messages: ChatMessage[] }) => void
    const pendingMessages = new Promise<{ messages: ChatMessage[] }>((resolve) => {
      resolveMessages = resolve
    })
    const { env } = makeEnv({
      listConversations: async () => ({ conversations: CONVERSATIONS }),
      getMessages: () => pendingMessages,
    })
    const wrapper = mount(PreviewCard, {
      props: { env },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    await flushPromises()
    // 数据未到时先渲染骨架，不阻塞挂载
    expect(wrapper.attributes('data-state')).toBe('loading')
    expect(wrapper.text()).toContain('最近对话')

    wrapper.unmount()
    expect(document.querySelector('.ai-chatbox-preview')).toBeNull()

    resolveMessages({ messages: MESSAGES })
    await flushPromises()

    // 晚到结果被 disposed 标志丢弃：不重建 DOM、不写状态、不报警
    expect(document.querySelector('.ai-chatbox-preview')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('卸载时无残留定时器 / 监听（重建后计数不增长）', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const windowListenerSpy = vi.spyOn(window, 'addEventListener')
    const { env } = makeEnv({
      listConversations: async () => ({ conversations: CONVERSATIONS }),
      getMessages: async () => ({ messages: MESSAGES }),
    })

    const wrapper = await mountCard(env)
    wrapper.unmount()

    expect(intervalSpy).not.toHaveBeenCalled()
    expect(windowListenerSpy).not.toHaveBeenCalled()
  })
})

describe('PreviewCard 无障碍：预览面无可聚焦控件', () => {
  it('ready 状态无可聚焦控件', async () => {
    const { env } = makeEnv({
      listConversations: async () => ({ conversations: CONVERSATIONS }),
      getMessages: async () => ({ messages: MESSAGES }),
    })
    const wrapper = await mountCard(env)

    expectNoFocusable(wrapper.element)
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.findAll('a[href]')).toHaveLength(0)

    wrapper.unmount()
  })

  it('空态 / 骨架状态同样无可聚焦控件', async () => {
    const empty = await mountCard(makeEnv({ providers: '[]' }).env)
    expectNoFocusable(empty.element)
    empty.unmount()

    let resolveMessages!: (value: { messages: ChatMessage[] }) => void
    const pending = new Promise<{ messages: ChatMessage[] }>((resolve) => {
      resolveMessages = resolve
    })
    const skeleton = mount(PreviewCard, {
      props: { env: makeEnv({ listConversations: async () => ({ conversations: CONVERSATIONS }), getMessages: () => pending }).env },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(skeleton.attributes('data-state')).toBe('loading')
    expectNoFocusable(skeleton.element)
    skeleton.unmount()
    resolveMessages({ messages: MESSAGES })
    await flushPromises()
  })
})

describe('mountPreview 入口契约', () => {
  it('不等待数据就返回句柄（首帧先骨架，数据后到）', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    let resolveList!: (value: { conversations?: ConversationMeta[] }) => void
    const pendingList = new Promise<{ conversations?: ConversationMeta[] }>((resolve) => {
      resolveList = resolve
    })
    const { env } = makeEnv({
      listConversations: () => pendingList,
      getMessages: async () => ({ messages: MESSAGES }),
    })

    // 数据仍 pending 时 handle 必须已返回
    const handle = await mountPreview(root, env)
    expect(typeof handle.unmount).toBe('function')
    expect(root.querySelector('.ai-chatbox-preview')).not.toBeNull()
    expect(root.textContent).toContain('最近对话')

    resolveList({ conversations: CONVERSATIONS })
    await flushPromises()
    expect(root.textContent).toContain('周会纪要')

    await handle.unmount()
    expect(root.childElementCount).toBe(0)
  })

  it('env.locale 适配：英文环境渲染英文预览文案', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { env } = makeEnv({ providers: '[]', locale: 'en' })

    const handle = await mountPreview(root, env)
    await flushPromises()
    expect(root.textContent).toContain('No model provider configured')

    await handle.unmount()
  })

  it('entry.ts 源码导出 mountPreview 且含契约关键字段（L5 app 侧前提）', () => {
    const source = entrySource

    expect(source).toMatch(/export async function mountPreview\(/)
    for (const token of [
      'AppPreviewEnv',
      'AppPreviewHandle',
      'MountPreview',
      'appId',
      'lastRoute',
      'appInvoke',
      'appStorageGet',
      'locale',
      'theme',
    ]) {
      expect(source).toContain(token)
    }
    // 预览面必须走专用组件，不复用主 App / 主 router
    expect(source).toContain("'./preview/PreviewCard.vue'")
  })
})
