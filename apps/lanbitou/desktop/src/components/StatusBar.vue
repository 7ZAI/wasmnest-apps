<template>
  <div
    class="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-card)] px-3 text-[length:var(--font-size-xs)] text-[var(--text-tertiary)]"
    data-testid="status-bar"
  >
    <span data-testid="word-count">{{ t('wordCount', { count: wordCount }) }}</span>
    <span data-testid="char-count">{{ t('charCount', { count: charCount }) }}</span>
    <span class="flex-1" />
    <span v-if="toast" class="text-[var(--color-primary)]" data-testid="status-toast">{{
      toast
    }}</span>
    <span v-if="errorText" class="text-[var(--color-danger-ink)]" data-testid="status-error">
      {{ errorText }}
    </span>
    <span data-testid="last-modified">
      {{ updatedAt ? t('lastModified', { time: formattedUpdatedAt }) : t('never') }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'

const props = defineProps<{
  charCount: number
  wordCount: number
  updatedAt: number | null
  toast?: string
  errorText?: string
}>()

const { t, ctx } = useI18n()

const formattedUpdatedAt = computed(() => {
  if (!props.updatedAt) return ''
  const locale = ctx?.i18n.getI18n()?.global?.locale?.value ?? 'zh-CN'
  return new Date(props.updatedAt).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
})
</script>
