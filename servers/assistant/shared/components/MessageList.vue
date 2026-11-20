<script setup lang="ts">
/**
 * Nest 消息流（共享组件，双端同构）
 *
 * 用户消息保留右对齐气泡；助手消息改为限宽文本流并渲染轻量 Markdown。内容列
 * 在宽窗口下居中，避免长回复贴左、右侧大面积留白。事件经 emit 上交父级。
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { ChatMessage } from '@nest-shared/types'
import MarkdownBlock from './MarkdownBlock.vue'
import NestMascot from './NestMascot.vue'
import type { MascotState } from '../ui/mascot-state'

const props = defineProps<{
  messages: ChatMessage[]
  /** 是否正在流式生成（决定光标与滚动行为） */
  streaming: boolean
  t: (key: string) => string
  /** 小窗紧凑排版 */
  compact?: boolean
  /** 空态展示的形象状态 */
  mascotState?: MascotState
}>()

const emit = defineEmits<{ retry: [] }>()

const scroller = ref<HTMLElement | null>(null)

/**
 * 播报文本：只在一条助手消息完成后更新，流式增量不进入 live region，
 * 避免读屏器被逐字打断。
 */
const liveText = computed(() => {
  const last = [...props.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.status === 'done')
  return last ? last.content.slice(0, 240) : ''
})

/** 新消息 / 流式增量后滚到底（用户自己上翻时不强行拉回） */
async function maybeScroll(): Promise<void> {
  await nextTick()
  const el = scroller.value
  if (!el) return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  if (nearBottom) el.scrollTop = el.scrollHeight
}

watch(
  () => [props.messages.length, props.messages.map((m) => m.content).join('').length, props.streaming],
  () => void maybeScroll(),
)
watch(() => props.messages.length, () => void maybeScroll())
</script>

<template>
  <div ref="scroller" class="nest-messages" :class="{ 'nest-messages--compact': compact }" data-testid="nest-messages">
    <div class="nest-messages__column">
      <div v-if="messages.length === 0" class="nest-messages__empty" data-testid="nest-messages-empty">
        <NestMascot :state="mascotState ?? 'idle'" :size="72" />
        <p>{{ t('assistant.chat.empty') }}</p>
      </div>

      <div
        v-for="m in messages"
        :key="m.id"
        class="nest-msg"
        :class="`nest-msg--${m.role}`"
        :data-testid="`nest-msg-${m.role}`"
      >
        <div class="nest-msg__bubble" :class="{ 'nest-msg__bubble--error': m.status === 'error' }">
          <!-- 思考折叠（仅助手） -->
          <details v-if="m.thinking" class="nest-msg__thinking" data-testid="nest-msg-thinking">
            <summary>{{ t('assistant.chat.thinking') }}</summary>
            <pre class="nest-msg__thinking-body">{{ m.thinking }}</pre>
          </details>

          <!-- 正文：助手走 Markdown，用户保持纯文本 -->
          <MarkdownBlock v-if="m.role === 'assistant'" :source="m.content" :compact="compact" />
          <span v-else class="nest-msg__text">{{ m.content }}</span>
          <span v-if="m.status === 'streaming'" class="nest-msg__cursor" aria-hidden="true">▍</span>

          <!-- 错误卡：可重试 -->
          <div v-if="m.status === 'error'" class="nest-msg__error" data-testid="nest-msg-error">
            <span class="nest-msg__error-text">{{ m.errorMessage ?? t('assistant.chat.error') }}</span>
            <button
              type="button"
              class="nest-msg__retry"
              data-testid="nest-msg-retry"
              @click="emit('retry')"
            >
              {{ t('assistant.chat.retry') }}
            </button>
          </div>

          <!-- 中止卡 -->
          <div v-if="m.status === 'aborted'" class="nest-msg__aborted" data-testid="nest-msg-aborted">
            {{ m.errorMessage ?? t('assistant.chat.stopped') }}
          </div>
        </div>
      </div>
    </div>

    <div class="nest-sr-only" aria-live="polite" data-testid="nest-live">{{ liveText }}</div>
  </div>
</template>

<style scoped>
.nest-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  display: flex;
  justify-content: center;
}

.nest-messages__column {
  width: 100%;
  max-width: 800px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.nest-messages--compact .nest-messages__column {
  max-width: 100%;
}

.nest-messages__empty {
  margin: auto;
  color: var(--nest-muted);
  text-align: center;
  font-size: var(--nest-font-md);
  line-height: 1.6;
  max-width: 360px;
}

.nest-msg {
  display: flex;
  width: 100%;
}

.nest-msg--user {
  justify-content: flex-end;
}

.nest-msg--assistant {
  justify-content: flex-start;
}

.nest-msg__bubble {
  max-width: 78%;
  color: var(--nest-text);
}

.nest-msg--assistant .nest-msg__bubble {
  max-width: 100%;
  width: 100%;
  padding: 0;
  background: transparent;
}

.nest-msg--user .nest-msg__bubble {
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--nest-accent);
  color: var(--nest-on-accent);
  font-size: var(--nest-font-lg);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.nest-msg--assistant .nest-msg__bubble--error {
  padding: 12px 14px;
  border: 1px solid var(--nest-danger);
  border-radius: var(--nest-radius-card);
  background: var(--nest-danger-bg);
}

.nest-msg__text {
  white-space: pre-wrap;
  word-break: break-word;
}

.nest-msg__thinking {
  margin-bottom: 8px;
  font-size: var(--nest-font-sm);
  color: var(--nest-muted);
}

.nest-msg__thinking summary {
  cursor: pointer;
  user-select: none;
}

.nest-msg__thinking-body {
  margin: 6px 0 0;
  white-space: pre-wrap;
  font-family: inherit;
}

.nest-msg__cursor {
  animation: nest-blink 1s step-start infinite;
  margin-left: 1px;
  color: var(--nest-accent);
}

@keyframes nest-blink {
  50% {
    opacity: 0;
  }
}

.nest-msg__error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.nest-msg__error-text {
  font-size: var(--nest-font-sm);
  color: var(--nest-danger-ink);
}

.nest-msg__retry {
  border: 1px solid var(--nest-danger);
  background: transparent;
  color: var(--nest-danger-ink);
  border-radius: var(--nest-radius-ctl);
  padding: 4px 12px;
  font-size: var(--nest-font-sm);
  cursor: pointer;
}

.nest-msg__retry:hover {
  background: var(--nest-danger-bg);
}

.nest-msg__aborted {
  margin-top: 6px;
  font-size: var(--nest-font-sm);
  color: var(--nest-muted);
}

.nest-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 760px) {
  .nest-messages {
    padding: 56px 16px 16px;
  }
}
</style>