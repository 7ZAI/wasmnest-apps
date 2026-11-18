<template>
  <div class="archive-list" data-testid="archive-list">
    <div
      v-if="loading && archives.length === 0"
      class="px-4 py-6 text-center text-[length:var(--font-size-sm)] text-[var(--text-tertiary)]"
    >
      {{ t('loading') }}
    </div>

    <div
      v-else-if="archives.length === 0"
      class="px-4 py-8 text-center text-[length:var(--font-size-sm)] text-[var(--text-tertiary)]"
      data-testid="archive-empty"
    >
      <p class="mb-1">{{ t('noArchives') }}</p>
      <p class="text-[length:var(--font-size-xs)]">{{ t('noArchivesHint') }}</p>
    </div>

    <template v-else>
      <div
        v-for="archive in archives"
        :key="archive.id"
        class="group relative w-full cursor-pointer border-b border-[var(--border)] px-3 py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
        :class="{ 'bg-[var(--bg-hover)]': archive.id === activeId }"
        role="button"
        tabindex="0"
        :aria-current="archive.id === activeId ? 'true' : undefined"
        :data-testid="`archive-item-${archive.id}`"
        @click="$emit('select', archive.id)"
        @keydown.enter.prevent="$emit('select', archive.id)"
        @keydown.space.prevent="$emit('select', archive.id)"
      >
        <span
          v-if="archive.id === activeId"
          class="absolute inset-y-0 left-0 w-[3px] bg-[var(--color-primary)]"
          aria-hidden="true"
        />
        <div class="flex items-baseline justify-between gap-2">
          <span
            class="truncate text-[length:var(--font-size-base)] font-medium text-[var(--text-primary)]"
          >
            {{ archive.title }}
          </span>
          <span class="shrink-0 text-[length:var(--font-size-xs)] text-[var(--text-tertiary)]">
            {{ formatArchiveSize(archive.size) }}
          </span>
        </div>
        <div class="mt-1 text-[length:var(--font-size-xs)] text-[var(--text-tertiary)]">
          {{ subtitle(archive) }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { archiveRange, formatArchiveSize } from '../archive'
import { useI18n } from '../composables/useI18n'
import type { Archive } from '../types'

defineProps<{
  archives: Archive[]
  activeId: string | null
  loading?: boolean
}>()

defineEmits<{
  select: [id: string]
}>()

const { t } = useI18n()

/** 副标题：跨天归档显示「起 → 止」，单日只标只读 */
function subtitle(archive: Archive): string {
  const readOnly = t('archiveReadOnly')
  const range = archiveRange(archive.id)
  if (!range || range.start === range.end) return readOnly
  return `${range.start} → ${range.end} · ${readOnly}`
}
</script>
