<script setup lang="ts">
/**
 * Nest 输入区（共享组件，双端同构）
 *
 * 胶囊输入框 + 自适应高度；流式进行中显示停止。前置条件失败（无 provider /
 * 保险库未解锁等）在框上方点名，不静默。
 */
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{
  /** 流式进行中：发送禁用、显示停止 */
  streaming: boolean
  /** 外部禁用（锁定 / 未就绪） */
  busy?: boolean
  /** 前置条件错误（点名缺什么） */
  errorMessage?: string
  /** 受控输入；不传时组件内部自持 */
  modelValue?: string
  t: (key: string) => string
}>()

const emit = defineEmits<{
  send: [text: string]
  stop: []
  stopAndLock: []
  'update:modelValue': [text: string]
}>()

const inner = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)

const text = computed({
  get: () => props.modelValue ?? inner.value,
  set: (value: string) => {
    inner.value = value
    emit('update:modelValue', value)
  },
})

const disabled = computed(() => Boolean(props.busy) || props.streaming)
const canSend = computed(() => text.value.trim().length > 0 && !disabled.value)

function autosize(): void {
  const element = inputRef.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`
}

watch(text, () => void nextTick(autosize))

function submit(): void {
  const content = text.value.trim()
  if (!content || disabled.value) return
  emit('send', content)
  if (props.modelValue === undefined) inner.value = ''
  else emit('update:modelValue', '')
}

function onKeydown(event: KeyboardEvent): void {
  // Enter 发送，Shift+Enter 换行；组字中不发送
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    submit()
  }
}

function focus(): void {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div class="nest-composer">
    <p v-if="errorMessage" class="nest-composer__error" data-testid="nest-composer-error">
      {{ errorMessage }}
    </p>
    <div class="nest-composer__row">
      <textarea
        ref="inputRef"
        v-model="text"
        class="nest-composer__input"
        data-testid="nest-composer-input"
        :placeholder="t('assistant.chat.placeholder')"
        rows="1"
        :disabled="disabled"
        @input="autosize"
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
        v-if="streaming"
        type="button"
        class="nest-composer__stop-lock"
        data-testid="nest-composer-stop-lock"
        @click="emit('stopAndLock')"
      >
        {{ t('assistant.tool.stopAndLock') }}
      </button>
      <button
        v-else
        type="button"
        class="nest-composer__send"
        data-testid="nest-composer-send"
        :disabled="!canSend"
        :aria-label="t('assistant.chat.send')"
        :title="t('assistant.chat.send')"
        @click="submit"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M4.5 12h14M13 6.5 18.5 12 13 17.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.nest-composer {
  border-top: 1px solid var(--nest-border);
  padding: 12px 16px 16px;
  background: var(--nest-bg);
}

.nest-composer__error {
  margin: 0 0 8px;
  font-size: var(--nest-font-sm);
  color: var(--nest-danger-ink);
}

.nest-composer__row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  max-width: 800px;
  margin: 0 auto;
}

.nest-composer__input {
  flex: 1;
  min-height: 44px;
  max-height: 160px;
  resize: none;
  border-radius: var(--nest-radius-pill);
  border: 1px solid var(--nest-border-input);
  background: var(--nest-input);
  color: var(--nest-text);
  padding: 11px 16px;
  font-size: var(--nest-font-lg);
  font-family: inherit;
  line-height: 1.5;
  transition:
    border-color var(--nest-motion-fast) ease,
    box-shadow var(--nest-motion-fast) ease;
}

.nest-composer__input::placeholder {
  color: var(--nest-faint);
}

.nest-composer__input:focus {
  outline: none;
  border-color: var(--nest-accent);
  box-shadow: var(--nest-shadow-focus);
}

.nest-composer__send,
.nest-composer__stop {
  flex-shrink: 0;
  border: none;
  border-radius: var(--nest-radius-pill);
  height: 44px;
  padding: 0 16px;
  font-size: var(--nest-font-lg);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.nest-composer__send {
  width: 44px;
  padding: 0;
  background: var(--nest-accent);
  color: var(--nest-on-accent);
}

.nest-composer__send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.nest-composer__send:focus-visible {
  outline: var(--nest-focus-width) solid var(--nest-focus);
  outline-offset: var(--nest-focus-offset);
}

.nest-composer__stop {
  background: var(--nest-danger);
  color: var(--nest-on-accent);
}

.nest-composer__stop-lock {
  height: 44px;
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--nest-danger);
  border-radius: var(--nest-radius-pill);
  color: var(--nest-danger-ink);
  padding: 0 14px;
  font-size: var(--nest-font-md);
  cursor: pointer;
}

@media (max-width: 760px) {
  .nest-composer {
    padding: 10px 12px 14px;
  }
}
</style>