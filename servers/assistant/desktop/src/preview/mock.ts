/**
 * 预览环境的助手命令 mock
 *
 * 只服务界面渲染审查：保险库视为已解锁，会话 / 消息 / 记忆 / 审计返回固定
 * 演示数据；不模拟加密、权限与真实网络。流式命令按 OpenAI 兼容 SSE 分片推给
 * 本地事件总线，用于验证光标、Markdown 增量与形象状态。
 */
import { emitLocalEvent } from './event-shim'

const NOW = '2026-11-20T09:30:00.000Z'

export interface MockOptions {
  /** chat | locked | panel | floatball | apps-unavailable */
  state: string
}

interface Conversation {
  id: string
  title: string
  kind: 'companion' | 'task'
  createdAt: string
  updatedAt: string
  archived: boolean
}

interface Message {
  id: string
  conversationId: string
  seq: number
  role: 'user' | 'assistant'
  content: string
  meta: Record<string, unknown>
  createdAt: string
}

const LONG_ANSWER = `下午好，我已经把四次会议的记录合并成一份摘要。

## 本周结论

- **桌面宿主**：插件热重载链路已经稳定，下一步补真实设备验收。
- **文件传输**：局域网与中继两条路径都已跑通，剩余问题是取消路径不写历史。
- **新闻阅读器**：正文抓取已经可用，默认入口仍待确认。

## 需要你跟进

1. 确认桌面端常驻浮层入口的形态，这会决定本周的界面改动范围。
2. 给移动端补一次真机回归，覆盖解锁、发送与工具确认。
3. 决定本周发布还是顺延到下周。

整体上风险集中在「发布前没有真实宿主目验」这一项，其他事项都可以并行推进。建议先把三件跟进事项拆成可验收的切片，再决定发布窗口。

\`\`\`ts
const next = await decideReleaseWindow()
if (!next.verified) postpone(next)
\`\`\`

如果时间不够，最小闭环是：先确认浮层形态，再安排一次真机回归，最后冻结发布窗口。`

const conversations: Conversation[] = [
  {
    id: 'nest-companion',
    title: '长期陪伴',
    kind: 'companion',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-20T09:28:00.000Z',
    archived: false,
  },
  {
    id: 'c-meeting',
    title: '整理本周会议记录',
    kind: 'task',
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-20T08:10:00.000Z',
    archived: false,
  },
  {
    id: 'c-wasm',
    title: '解释 WebAssembly 组件模型',
    kind: 'task',
    createdAt: '2026-11-18T13:00:00.000Z',
    updatedAt: '2026-11-19T16:40:00.000Z',
    archived: false,
  },
  {
    id: 'c-archive',
    title: '上周的发布检查清单',
    kind: 'task',
    createdAt: '2026-11-12T09:00:00.000Z',
    updatedAt: '2026-11-13T18:20:00.000Z',
    archived: true,
  },
]

const messages: Record<string, Message[]> = {
  'nest-companion': [
    {
      id: 'm-1',
      conversationId: 'nest-companion',
      seq: 1,
      role: 'user',
      content: '下午好。帮我把这周的会议记录整理成要点，顺便看看有没有需要我跟进的事项。',
      meta: {},
      createdAt: '2026-11-20T09:20:00.000Z',
    },
    {
      id: 'm-2',
      conversationId: 'nest-companion',
      seq: 2,
      role: 'assistant',
      content: LONG_ANSWER,
      meta: { model: 'deepseek-chat' },
      createdAt: '2026-11-20T09:21:00.000Z',
    },
    {
      id: 'm-3',
      conversationId: 'nest-companion',
      seq: 3,
      role: 'user',
      content: '把需要我跟进的三件事单独列出来，按优先级排序。',
      meta: {},
      createdAt: '2026-11-20T09:26:00.000Z',
    },
    {
      id: 'm-4',
      conversationId: 'nest-companion',
      seq: 4,
      role: 'assistant',
      content:
        '1. **最高**：确认桌面端常驻浮层入口的形态，这会决定本周的界面改动范围。\n2. **其次**：安排一次移动端真机回归，覆盖解锁、发送与工具确认。\n3. **最后**：决定发布窗口；如果本周发布，需要在发布前补一次真实宿主目验。',
      meta: { model: 'deepseek-chat' },
      createdAt: '2026-11-20T09:27:00.000Z',
    },
  ],
  'c-meeting': [
    {
      id: 'm-10',
      conversationId: 'c-meeting',
      seq: 1,
      role: 'user',
      content: '把本周会议记录整理成要点。',
      meta: {},
      createdAt: '2026-11-20T08:00:00.000Z',
    },
    {
      id: 'm-11',
      conversationId: 'c-meeting',
      seq: 2,
      role: 'assistant',
      content: '已整理：三条结论、两项待跟进，详见完整纪要。',
      meta: { model: 'deepseek-chat' },
      createdAt: '2026-11-20T08:10:00.000Z',
    },
  ],
  'c-wasm': [],
  'c-archive': [],
}

const facts = [
  {
    id: 'f-1',
    scope: 'global',
    scopeRef: null,
    key: '偏好回复语言',
    value: '简体中文，先给结论再给依据',
    sourceConversationId: 'nest-companion',
    sourceMessageId: 'm-1',
    status: 'confirmed',
    createdAt: '2026-11-10T09:00:00.000Z',
    updatedAt: '2026-11-10T09:00:00.000Z',
  },
  {
    id: 'f-2',
    scope: 'global',
    scopeRef: null,
    key: '当前项目',
    value: 'WasmNest 桌面与移动宿主、应用仓并行开发',
    sourceConversationId: 'nest-companion',
    sourceMessageId: 'm-2',
    status: 'confirmed',
    createdAt: '2026-11-14T09:00:00.000Z',
    updatedAt: '2026-11-14T09:00:00.000Z',
  },
  {
    id: 'f-3',
    scope: 'conversation',
    scopeRef: 'nest-companion',
    key: '本周发布窗口',
    value: '可能在周五，尚未确认',
    sourceConversationId: 'nest-companion',
    sourceMessageId: 'm-4',
    status: 'pending',
    createdAt: '2026-11-20T09:27:00.000Z',
    updatedAt: '2026-11-20T09:27:00.000Z',
  },
]

const audit = [
  {
    id: 'a-1',
    ts: '2026-11-20T09:22:00.000Z',
    toolId: 'app.list',
    appId: null,
    command: 'app.list',
    risk: 'read',
    decision: 'auto',
    argsDigest: null,
    resultDigest: '3f9a0c1b7d2e',
    userVisible: true,
  },
  {
    id: 'a-2',
    ts: '2026-11-20T09:23:00.000Z',
    toolId: 'app.open',
    appId: 'file-transfer',
    command: 'open',
    risk: 'ui',
    decision: 'approved',
    argsDigest: '9b1d4e7a2c30',
    resultDigest: 'c4a8e2f61b09',
    userVisible: true,
  },
]

const settings = new Map<string, string>([
  ['firstRun.noticeShown', '1'],
  ['memory.enabled', '1'],
  ['memory.extractEnabled', '1'],
  ['conversation.contextLimit', '20'],
  ['conversation.summaryThreshold', '40'],
])

const providers = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiStyle: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    isDefault: true,
  },
]

function argsOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function streamReply(streamEvent: string, text: string): void {
  const pieces = text.match(/[\s\S]{1,18}/g) ?? []
  let index = 0
  const tick = () => {
    if (index >= pieces.length) {
      emitLocalEvent(streamEvent, { chunk: 'data: [DONE]\n\n', done: false })
      emitLocalEvent(streamEvent, { done: true })
      return
    }
    const delta = { choices: [{ delta: { content: pieces[index++] } }] }
    emitLocalEvent(streamEvent, { chunk: `data: ${JSON.stringify(delta)}\n\n`, done: false })
    setTimeout(tick, 40)
  }
  setTimeout(tick, 60)
}

export function createMockInvoke(options: MockOptions): (command: string, args?: unknown) => Promise<unknown> {
  const locked = options.state === 'locked'

  return async (command, rawArgs) => {
    const args = argsOf(rawArgs)
    switch (command) {
      case 'assistant.vault-status':
        return { exists: true, unlocked: !locked, createdAt: NOW }
      case 'assistant.vault-init':
      case 'assistant.vault-unlock':
      case 'assistant.vault-change-password':
        return { ok: true, unlocked: true }
      case 'assistant.vault-lock':
        return { ok: true, unlocked: false }
      case 'assistant.vault-set-secret':
      case 'assistant.vault-delete-secret':
        return { ok: true }
      case 'assistant.vault-get-secret':
        return { key: String(args.key ?? ''), value: 'preview-secret' }
      case 'assistant.providers-list':
        return { providers }
      case 'assistant.providers-upsert':
        return { id: String(args.id ?? 'deepseek') }
      case 'assistant.providers-set-default':
      case 'assistant.providers-delete':
        return { ok: true }
      case 'assistant.settings-get':
        return { value: settings.get(String(args.key ?? '')) ?? null }
      case 'assistant.settings-set':
        settings.set(String(args.key ?? ''), String(args.value ?? ''))
        return { ok: true }
      case 'assistant.conversations-list':
        return { conversations }
      case 'assistant.conversations-create': {
        const id = String(args.id ?? `c-${conversations.length + 1}`)
        conversations.push({
          id,
          title: String(args.title ?? '新任务'),
          kind: args.kind === 'companion' ? 'companion' : 'task',
          createdAt: NOW,
          updatedAt: NOW,
          archived: false,
        })
        return { id }
      }
      case 'assistant.conversations-rename': {
        const target = conversations.find((item) => item.id === args.id)
        if (target) target.title = String(args.title ?? target.title)
        return { ok: true }
      }
      case 'assistant.conversations-archive': {
        const target = conversations.find((item) => item.id === args.id)
        if (target) target.archived = Boolean(args.archived)
        return { ok: true }
      }
      case 'assistant.messages-list': {
        const id = String(args.conversationId ?? '')
        const limit = Number(args.limit ?? 20)
        const list = messages[id] ?? []
        return { messages: list.slice(Math.max(0, list.length - limit)) }
      }
      case 'assistant.messages-count':
        return { count: (messages[String(args.conversationId ?? '')] ?? []).length }
      case 'assistant.messages-append': {
        const id = String(args.conversationId ?? '')
        const list = messages[id] ?? (messages[id] = [])
        list.push({
          id: `m-${Date.now()}`,
          conversationId: id,
          seq: Number(args.seq ?? list.length + 1),
          role: args.role === 'user' ? 'user' : 'assistant',
          content: String(args.content ?? ''),
          meta: {},
          createdAt: NOW,
        })
        return { ok: true }
      }
      case 'assistant.memory-list': {
        const status = typeof args.status === 'string' ? args.status : null
        return { facts: status ? facts.filter((fact) => fact.status === status) : facts }
      }
      case 'assistant.memory-upsert':
        return { id: String(args.id ?? `f-${facts.length + 1}`) }
      case 'assistant.memory-delete':
      case 'assistant.memory-set-status':
        return { ok: true }
      case 'assistant.memory-clear':
        return { deleted: facts.length }
      case 'assistant.audit-list':
        return { entries: audit }
      case 'assistant.audit-record':
        return { id: `a-${audit.length + 1}` }
      case 'assistant.audit-clear':
        return { deleted: audit.length }
      case 'assistant.chat-stream': {
        const streamId = String(args.streamId ?? 'preview')
        const streamEvent = `assistant:stream:${streamId}`
        streamReply(streamEvent, '这是预览环境生成的流式回复，用于验证光标与 Markdown 增量渲染。')
        return { streamId, streamEvent }
      }
      case 'assistant.ping':
        return { ok: true, appId: 'com.wasmnest.assistant' }
      case 'assistant.export':
      case 'assistant.clear-data':
        return { ok: true }
      default:
        throw new Error(`[preview] 未模拟命令："${command}"`)
    }
  }
}