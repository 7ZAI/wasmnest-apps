<script setup lang="ts">
/**
 * 问答小窗
 *
 * 只承载当前会话：消息流 + 输入区 + 展开 / 关闭。管理页留在整页，小窗不出现
 * 设置、记忆、审计入口。保险库锁定时只给出展开解锁的出口。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Composer from './Composer.vue'
import MessageList from './MessageList.vue'
import NestMascot from './NestMascot.vue'
import type { MascotState } from '../ui/mascot-state'
import type { ChatMessage } from '@nest-shared/types'

defineProps<{
  messages: ChatMessage[]
  streaming: boolean
  mascotState: MascotState
  locked: boolean
  busy?: boolean
  errorMessage?: string
  motionEnabled?: boolean
  t: (key: string) => string
}>()

const emit = defineEmits<{
  close: []
  expand: []
  send: [text: string]
  stop: []
  stopAndLock: []
  retry: []
}>()

const composer = ref<InstanceType<typeof Composer> | null>(null)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void nextTick(() => composer.value?.focus())
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <aside
    class="nest-quickpanel"
    data-testid="nest-quickpanel"
    role="dialog"
    aria-modal="false"
    :aria-label="t('assistant.float.title')"
  >
    <header class="nest-quickpanel__head">
      <NestMascot :state="mascotState" :size="32" :motion-enabled="motionEnabled ?? true" />
      <span class="nest-quickpanel__title">{{ t('assistant.float.title') }}</span>
      <button
        type="button"
        class="nest-quickpanel__icon"
        data-testid="nest-quickpanel-expand"
        :aria-label="t('assistant.float.expand')"
        :title="t('assistant.float.expand')"
        @click="emit('expand')"
      >
        ⤢
      </button>
      <button
        type="button"
        class="nest-quickpanel__icon"
        data-testid="nest-quickpanel-close"
        :aria-label="t('assistant.float.close')"
        :title="t('assistant.float.close')"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>

    <div v-if="locked" class="nest-quickpanel__locked" data-testid="nest-quickpanel-locked">
      <NestMascot state="locked" :size="64" :motion-enabled="motionEnabled ?? true" />
      <p>{{ t('assistant.float.locked') }}</p>
      <button
        type="button"
        class="nest-quickpanel__primary"
        data-testid="nest-quickpanel-unlock"
        @click="emit('expand')"
      >
        {{ t('assistant.float.unlock') }}
      </button>
    </div>

    <template v-else>
      <MessageList
        :messages="messages"
        :streaming="streaming"
        :mascot-state="mascotState"
        :t="t"
        compact
        @retry="emit('retry')"
      />
      <Composer
        ref="composer"
        :streaming="streaming"
        :busy="busy"
        :error-message="errorMessage"
        :t="t"
        @send="emit('send', $event)"
        @stop="emit('stop')"
        @stop-and-lock="emit('stopAndLock')"
      />
    </template>
  </aside>
</template>

<style scoped>
.nest-quickpanel {
  position: absolute;
  right: 16px;
  bottom: 84px;
  z-index: 41;
  width: 380px;
  max-width: calc(100% - 32px);
  height: 520px;
  max-height: calc(100% - 100px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--nest-border);
  border-radius: calc(var(--nest-radius-card) + 4px);
  background: var(--nest-surface);
  color: var(--nest-text);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
}

.nest-quickpanel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--nest-border);
}

.nest-quickpanel__title {
  flex: 1;
  font-size: var(--nest-font-lg);
  font-weight: 600;
}

.nest-quickpanel__icon {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--nest-radius-ctl);
  background: transparent;
  color: var(--nest-muted);
  cursor: pointer;
}

.nest-quickpanel__icon:hover {
  background: var(--nest-surface-2);
  color: var(--nest-text);
}

.nest-quickpanel__locked {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
  text-align: center;
  color: var(--nest-muted);
  font-size: var(--nest-font-md);
}

.nest-quickpanel__primary {
  border: none;
  border-radius: var(--nest-radius-pill);
  background: var(--nest-accent);
  color: var(--nest-on-accent);
  padding: 9px 18px;
  font-size: var(--nest-font-md);
  cursor: pointer;
}

@media (max-width: 760px) {
  .nest-quickpanel {
    left: 8px;
    right: 8px;
    bottom: 76px;
    width: auto;
    max-width: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nest-quickpanel {
    transition: none;
  }
}
</style>