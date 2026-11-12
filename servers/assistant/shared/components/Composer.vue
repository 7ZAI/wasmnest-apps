<script setup lang="ts">
/**
 * Nest 输入区（共享组件，双端同构 · 票 08）
 *
 * 文本框 + 发送 / 停止。流式进行中显示「停止」；前置条件失败（无 provider /
 * 保险库未解锁等）在框上方点名，不静默。
 */
import { ref } from 'vue'

const props = defineProps<{
  /** 流式进行中：发送禁用、显示停止 */
  streaming: boolean
  /** 前置条件错误（点名缺什么） */
  errorMessage?: string
  t: (key: string) => string
}>()

const emit = defineEmits<{ send: [text: string]; stop: [] }>()

const text = ref('')

function submit(): void {
  const content = text.value.trim()
  if (!content || props.streaming) return
  emit('send', content)
  text.value = ''
}

function onKeydown(e: KeyboardEvent): void {
  // Enter 发送，Shift+Enter 换行
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="nest-composer">
    <p v-if="errorMessage" class="nest-composer__error" data-testid="nest-composer-error">
      {{ errorMessage }}
    </p>
    <div class="nest-composer__row">
      <textarea
        v-model="text"
        class="nest-composer__input"
        data-testid="nest-composer-input"
        :placeholder="t('assistant.chat.placeholder')"
        rows="1"
        :disabled="streaming"
        @keydown="onKeydown"
      />
      <button
        v-if="streaming"
        type="button"
        class="nest-composer__stop"
        data-testid="nest-composer-stop"
        @click="emit('stop')"
      >
        {{ t('assistant.chat.stop') }}
      </button>
      <button
        v-else
        type="button"
        class="nest-composer__send"
        data-testid="nest-composer-send"
        :disabled="!text.trim()"
        @click="submit"
      >
        {{ t('assistant.chat.send') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.nest-composer {
  border-top: 1px solid var(--nest-border, #3a4150);
  padding: 12px 16px;
  background: var(--nest-surface, #232833);
}

.nest-composer__error {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--nest-error-text, #f0b4ae);
}

.nest-composer__row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.nest-composer__input {
  flex: 1;
  resize: none;
  border-radius: 12px;
  border: 1px solid var(--nest-border, #3a4150);
  background: var(--nest-surface-2, #2a2f3a);
  color: var(--nest-text, #e8eaf0);
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  max-height: 160px;
}

.nest-composer__input:focus {
  outline: none;
  border-color: var(--nest-accent, #4f7cff);
}

.nest-composer__send,
.nest-composer__stop {
  border: none;
  border-radius: 12px;
  padding: 10px 18px;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.nest-composer__send {
  background: var(--nest-accent, #4f7cff);
  color: #fff;
}

.nest-composer__send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.nest-composer__stop {
  background: var(--nest-error, #c0392b);
  color: #fff;
}
</style>
