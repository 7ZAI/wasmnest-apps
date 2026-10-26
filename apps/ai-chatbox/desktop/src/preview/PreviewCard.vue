<script setup lang="ts">
/**
 * AI Chatbox 多任务卡片只读预览面（`mountPreview` 契约 · apps 仓 spec 2026-10-20）
 *
 * 应用在宿主多任务卡片的缩略区**自绘**一张点时刻的只读摘要：最近对话标题 +
 * 最近 2–3 条消息摘要；未配置供应商 / 无对话 / 命令失败 → 诚实空态。
 *
 * 边界（D2 / D4 / D11）：
 * - 只用 `env.appStorageGet` / `env.appInvoke` 的**只读**面：读 KV `apiProviders`
 *   判断是否已配置供应商，读既有只读命令 `list-conversations` / `get-messages`；
 * - **不发真实模型请求**（不碰 `chat-complete` / `chat-stream`）、不写存储、不订阅
 *   事件、不起定时器 / 全局监听 / 轮询；拿不到数据就说拿不到，不编造「运行中」；
 * - 挂载即先出骨架（`loading`），数据在 `onMounted` 里异步取一次 —— `mountPreview`
 *   因此能立刻返回 handle，不会把慢命令拖成宿主 3s 超时回退；
 * - DOM 内无任何可聚焦控件（`button` / `a[href]` / `input` / `select` / `textarea` /
 *   可 tab 元素），交互全部由外层卡片覆盖层承接；
 * - 卸载置 `disposed` 标志，晚到的命令结果不再写状态。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import type { AppPreviewEnv } from '../entry'
import type { ChatMessage, ConversationMeta } from '../types'

const props = defineProps<{ env: AppPreviewEnv }>()

/** 预览数据源：本 app 既有只读面（KV 供应商配置 key，见 useAiConfig.ts） */
const STORAGE_PROVIDERS = 'apiProviders'
/** 预览只展示最近 N 条消息摘要 */
const PREVIEW_MESSAGE_LIMIT = 3
/** 单条消息摘要字符上限（缩略卡不展示全文） */
const EXCERPT_MAX = 72

type PreviewState = 'loading' | 'no-provider' | 'no-conversation' | 'unavailable' | 'ready'

interface PreviewMessage {
  role: ChatMessage['role']
  excerpt: string
}

const state = ref<PreviewState>('loading')
const conversation = ref<ConversationMeta | null>(null)
const messages = ref<PreviewMessage[]>([])

/** 卸载后晚到的异步结果一律丢弃（不对已卸载卡片写状态） */
let disposed = false

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
}

/** 供应商配置可能是 JSON 字符串（旧版本 storage 形态）也可能是数组；无法解析按未配置处理 */
function providerCount(raw: unknown): number {
  let value: unknown = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return 0
    }
  }
  return Array.isArray(value) ? value.length : 0
}

function timeOf(iso: string | undefined): number {
  const ts = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ts) ? ts : 0
}

/** `lastRoute` 末段若恰好是对话 id，视为「上次停在的那个对话」（只作线索，不强制） */
function conversationIdFromRoute(route: string | undefined): string {
  if (!route) return ''
  const tail = route.split(/[?#]/)[0].split('/').filter(Boolean).pop()
  return tail ?? ''
}

/** 选对话：lastRoute 命中优先，否则取最近更新的对话 */
function pickConversation(list: ConversationMeta[]): ConversationMeta {
  const routedId = conversationIdFromRoute(props.env.lastRoute)
  if (routedId) {
    const hit = list.find((c) => c.id === routedId)
    if (hit) return hit
  }
  return [...list].sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt))[0]
}

function excerptOf(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX)}…` : flat
}

/** 只取最近这几条非空消息的摘要（顺序保持不变，便于「最近说了什么」一眼可读） */
function toPreviewMessages(list: ChatMessage[]): PreviewMessage[] {
  return list
    .filter((m) => m && typeof m.content === 'string' && m.content.trim() !== '')
    .slice(-PREVIEW_MESSAGE_LIMIT)
    .map((m) => ({ role: m.role, excerpt: excerptOf(m.content) }))
}

/** 标题可能是 i18n key（未命名对话存的是 `com.wasmnest.ai-chatbox.newConversation`） */
const displayTitle = computed(() => {
  const raw = conversation.value?.title ?? ''
  if (!raw) return ''
  return raw.startsWith(`${MESSAGE_NAMESPACE}.`) ? i18n.global.t(raw) : raw
})

/** 供应商 / 模型元信息（两者都缺时整行不渲染，不编造） */
const providerMeta = computed(() => {
  const meta = conversation.value
  if (!meta) return ''
  return [meta.providerName, meta.model].filter((v) => typeof v === 'string' && v !== '').join(' · ')
})

/** 上次停留页面（宿主注入；应用未自报过路由时为空，不伪造） */
const lastRouteLabel = computed(() =>
  props.env.lastRoute ? t('previewLastRoute', { path: props.env.lastRoute }) : '',
)

function roleLabel(role: ChatMessage['role']): string {
  if (role === 'user') return t('previewRoleUser')
  if (role === 'system') return t('previewRoleSystem')
  return t('previewRoleAssistant')
}

/**
 * 一次性只读取数（点时刻，不轮询）。
 * 任一命令失败 → `unavailable` 诚实空态；本函数不抛错、不弹 toast。
 */
async function load(): Promise<void> {
  try {
    const rawProviders = await props.env.appStorageGet<unknown>(STORAGE_PROVIDERS)
    if (disposed) return
    if (providerCount(rawProviders) === 0) {
      state.value = 'no-provider'
      return
    }

    const listResult = await props.env.appInvoke<{ conversations?: ConversationMeta[] }>(
      'ai-chatbox.list-conversations',
      {},
    )
    if (disposed) return
    const conversations = Array.isArray(listResult?.conversations) ? listResult.conversations : []
    if (conversations.length === 0) {
      state.value = 'no-conversation'
      return
    }

    const picked = pickConversation(conversations)
    const messageResult = await props.env.appInvoke<{ messages?: ChatMessage[] }>(
      'ai-chatbox.get-messages',
      { conversationId: picked.id },
    )
    if (disposed) return

    conversation.value = picked
    messages.value = toPreviewMessages(
      Array.isArray(messageResult?.messages) ? messageResult.messages : [],
    )
    state.value = 'ready'
  } catch (e) {
    if (disposed) return
    state.value = 'unavailable'
    // 预览是识别辅助，不是功能闸门：失败只留日志，不弹窗、不影响卡片打开
    console.warn('[AI Chatbox] Preview data unavailable:', e)
  }
}

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <div
    class="ai-chatbox-preview"
    :data-state="state"
    :data-theme="env.theme || 'light'"
    :data-locale="env.locale"
  >
    <div class="ai-chatbox-preview__head">
      <div class="ai-chatbox-preview__eyebrow">{{ t('previewRecentConversation') }}</div>
      <div v-if="state === 'ready' && displayTitle" class="ai-chatbox-preview__title">
        {{ displayTitle }}
      </div>
      <div v-else-if="state === 'loading'" class="ai-chatbox-preview__title-bone" />
      <div v-if="providerMeta" class="ai-chatbox-preview__meta">{{ providerMeta }}</div>
    </div>

    <div class="ai-chatbox-preview__body">
      <!-- 骨架：mountPreview 立刻返回，数据晚到再替换 -->
      <div v-if="state === 'loading'" class="ai-chatbox-preview__skeleton">
        <span v-for="i in 3" :key="i" class="ai-chatbox-preview__bone" />
      </div>

      <!-- 诚实空态：未配置供应商 / 无对话 / 数据不可用 -->
      <div v-else-if="state === 'no-provider'" class="ai-chatbox-preview__empty">
        <div class="ai-chatbox-preview__empty-title">{{ t('previewNoProvider') }}</div>
        <div class="ai-chatbox-preview__empty-hint">{{ t('previewNoProviderHint') }}</div>
      </div>

      <div v-else-if="state === 'no-conversation'" class="ai-chatbox-preview__empty">
        <div class="ai-chatbox-preview__empty-title">{{ t('previewNoConversation') }}</div>
        <div class="ai-chatbox-preview__empty-hint">{{ t('previewNoConversationHint') }}</div>
      </div>

      <div v-else-if="state === 'unavailable'" class="ai-chatbox-preview__empty">
        <div class="ai-chatbox-preview__empty-title">{{ t('previewUnavailable') }}</div>
      </div>

      <div v-else-if="messages.length === 0" class="ai-chatbox-preview__empty">
        <div class="ai-chatbox-preview__empty-title">{{ t('previewMessagesEmpty') }}</div>
      </div>

      <ul v-else class="ai-chatbox-preview__messages">
        <li
          v-for="(message, index) in messages"
          :key="index"
          class="ai-chatbox-preview__msg"
          :class="`is-${message.role}`"
        >
          <span class="ai-chatbox-preview__role">{{ roleLabel(message.role) }}</span>
          <span class="ai-chatbox-preview__text">{{ message.excerpt }}</span>
        </li>
      </ul>
    </div>

    <div v-if="state === 'ready' && lastRouteLabel" class="ai-chatbox-preview__foot">
      {{ lastRouteLabel }}
    </div>
  </div>
</template>

<style scoped>
/* 填满宿主卡片缩略容器；预览是装饰层，不接收任何指针事件 / 文本选择 */
.ai-chatbox-preview {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100%;
  overflow: hidden;
  contain: layout paint;
  padding: 14px 16px;
  pointer-events: none;
  user-select: none;
  text-align: left;
  background: var(--bg-page, #f5f4f0);
  color: var(--text-primary, #26231b);
}

/* 主题适配：宿主同时切换 <html class="dark"> 与注入的 env.theme；深色下气泡再提一档表面色 */
.ai-chatbox-preview[data-theme='dark'] .ai-chatbox-preview__msg {
  background: color-mix(in srgb, var(--bg-card, #232220) 88%, #ffffff 12%);
}

.ai-chatbox-preview__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.ai-chatbox-preview__eyebrow {
  font-size: var(--font-size-xs, 9px);
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary, #736b58);
}

.ai-chatbox-preview__title {
  font-size: var(--font-size-lg, 14px);
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary, #26231b);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.ai-chatbox-preview__title-bone,
.ai-chatbox-preview__bone {
  display: block;
  border-radius: var(--radius-tag, 6px);
  background: var(--bg-hover, #e7e4dc);
}

.ai-chatbox-preview__title-bone {
  width: 62%;
  height: 14px;
}

.ai-chatbox-preview__meta {
  font-family: var(--font-mono, monospace);
  font-size: var(--font-size-xs, 9px);
  line-height: 1.3;
  color: var(--text-secondary, #5e584c);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-chatbox-preview__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.ai-chatbox-preview__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-chatbox-preview__skeleton .ai-chatbox-preview__bone {
  height: 38px;
  opacity: 0.7;
}

.ai-chatbox-preview__empty {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  text-align: center;
}

.ai-chatbox-preview__empty-title {
  font-size: var(--font-size-base, 12px);
  font-weight: 500;
  line-height: 1.35;
  color: var(--text-secondary, #5e584c);
}

.ai-chatbox-preview__empty-hint {
  font-size: var(--font-size-xs, 9px);
  line-height: 1.4;
  color: var(--text-tertiary, #736b58);
}

.ai-chatbox-preview__messages {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
}

.ai-chatbox-preview__msg {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 0 1 auto;
  min-height: 0;
  padding: 8px 10px;
  border: 1px solid var(--border, #e4e1d8);
  border-radius: var(--radius-button, 8px);
  background: var(--bg-card, #fdfcfa);
}

.ai-chatbox-preview__msg.is-user {
  border-color: var(--border-strong, #d6d2c4);
}

.ai-chatbox-preview__role {
  font-size: var(--font-size-xs, 9px);
  line-height: 1.2;
  letter-spacing: 0.04em;
  color: var(--text-tertiary, #736b58);
}

.ai-chatbox-preview__text {
  font-size: var(--font-size-base, 12px);
  line-height: 1.45;
  color: var(--text-primary, #26231b);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.ai-chatbox-preview__foot {
  flex-shrink: 0;
  font-size: var(--font-size-xs, 9px);
  line-height: 1.3;
  color: var(--text-tertiary, #736b58);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
