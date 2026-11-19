<script setup lang="ts">
/**
 * Nest 消息流（共享组件，双端同构 · 票 08）
 *
 * 渲染会话消息卡：用户气泡 / 助手气泡（流式光标、思考折叠、错误卡可重试、
 * 中止卡）。端无关：只吃 `messages` 与翻译函数，事件经 emit 上交父级。
 */
import { nextTick, ref, watch } from 'vue'
import type { ChatMessage } from '@nest-shared/types'

const props = defineProps<{
  messages: ChatMessage[]
  /** 是否正在流式生成（决定光标与滚动行为） */
  streaming: boolean
  t: (key: string) => string
}>()

const emit = defineEmits<{ retry: [] }>()

const scroller = ref<HTMLElement | null>(null)

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
  <div ref="scroller" class="nest-messages" data-testid="nest-messages">
    <div v-if="messages.length === 0" class="nest-messages__empty" data-testid="nest-messages-empty">
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

        <!-- 正文 -->
        <span class="nest-msg__text">{{ m.content }}</span>
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
</template>

<style scoped>
.nest-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.nest-messages__empty {
  margin: auto;
  color: var(--nest-muted, #8a8f98);
  text-align: center;
  font-size: 14px;
  line-height: 1.6;
  max-width: 360px;
}

.nest-msg {
  display: flex;
  max-width: 100%;
}

.nest-msg--user {
  justify-content: flex-end;
}

.nest-msg--assistant {
  justify-content: flex-start;
}

.nest-msg__bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--nest-surface-2, #2a2f3a);
  color: var(--nest-text, #e8eaf0);
}

.nest-msg--user .nest-msg__bubble {
  background: var(--nest-accent, #4f7cff);
  color: #fff;
}

.nest-msg__bubble--error {
  background: var(--nest-error-bg, #3a2426);
  border: 1px solid var(--nest-error, #c0392b);
}

.nest-msg__thinking {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--nest-muted, #8a8f98);
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
  font-size: 13px;
  color: var(--nest-error-text, #f0b4ae);
}

.nest-msg__retry {
  border: 1px solid var(--nest-error, #c0392b);
  background: transparent;
  color: var(--nest-error-text, #f0b4ae);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
}

.nest-msg__retry:hover {
  background: rgba(192, 57, 43, 0.15);
}

.nest-msg__aborted {
  margin-top: 6px;
  font-size: 12px;
  color: var(--nest-muted, #8a8f98);
}
</style>
