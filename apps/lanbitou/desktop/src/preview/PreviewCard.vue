<script setup lang="ts">
/**
 * Lanbitou 多任务卡片只读预览面（`mountPreview` 契约 · ADR 0057）
 *
 * 只读边界：仅调用只读命令 `lanbitou.list-notes`，不写存储、不发通知、不起
 * 定时器 / 全局监听；挂载先出骨架并在 `onMounted` 异步取一次，立即返回 handle。
 * DOM 内无可聚焦控件（卡片本身是唯一动作层）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import { toPlainExcerpt } from './excerpt'
import type { AppPreviewEnv } from '../entry'
import type { Note } from '../types'

const props = defineProps<{ env: AppPreviewEnv }>()

const EXCERPT_MAX = 72

type PreviewState = 'loading' | 'empty' | 'unavailable' | 'ready'

const state = ref<PreviewState>('loading')
const notes = ref<Note[]>([])
let disposed = false

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
}

const latest = computed<Note | null>(() => notes.value[0] ?? null)

const displayTitle = computed(() => {
  const note = latest.value
  if (!note) return ''
  const raw = note.title?.trim()
  return raw && raw !== 'Untitled' ? raw : t('untitled')
})

const excerpt = computed(() => toPlainExcerpt(latest.value?.content ?? '', EXCERPT_MAX))

async function load(): Promise<void> {
  try {
    const result = await props.env.appInvoke<Note[]>('lanbitou.list-notes')
    if (disposed) return
    notes.value = Array.isArray(result) ? result : []
    state.value = notes.value.length > 0 ? 'ready' : 'empty'
  } catch (e) {
    if (disposed) return
    state.value = 'unavailable'
    console.warn('[Lanbitou] preview data unavailable:', e)
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
  <div class="lanbitou-preview" :data-state="state" data-testid="lanbitou-preview">
    <div class="lanbitou-preview__head">
      <div class="lanbitou-preview__eyebrow">{{ t('previewRecentNote') }}</div>
      <div v-if="state === 'ready'" class="lanbitou-preview__title">{{ displayTitle }}</div>
      <div v-else-if="state === 'loading'" class="lanbitou-preview__title-bone" />
      <div v-if="state === 'ready'" class="lanbitou-preview__meta">
        {{ t('previewNoteCount', { count: notes.length }) }}
      </div>
    </div>

    <div class="lanbitou-preview__body">
      <div v-if="state === 'loading'" class="lanbitou-preview__skeleton">
        <span v-for="i in 3" :key="i" class="lanbitou-preview__bone" />
      </div>

      <div v-else-if="state === 'empty'" class="lanbitou-preview__empty">
        <div class="lanbitou-preview__empty-title">{{ t('previewNoNote') }}</div>
        <div class="lanbitou-preview__empty-hint">{{ t('previewNoNoteHint') }}</div>
      </div>

      <div v-else-if="state === 'unavailable'" class="lanbitou-preview__empty">
        <div class="lanbitou-preview__empty-title">{{ t('previewNoNoteHint') }}</div>
      </div>

      <p v-else class="lanbitou-preview__excerpt">{{ excerpt || t('previewNoNoteHint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.lanbitou-preview {
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

.lanbitou-preview__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.lanbitou-preview__eyebrow {
  font-size: var(--font-size-xs, 9px);
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary, #736b58);
}

.lanbitou-preview__title {
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

.lanbitou-preview__title-bone,
.lanbitou-preview__bone {
  display: block;
  border-radius: var(--radius-tag, 6px);
  background: var(--bg-hover, #e7e4dc);
}

.lanbitou-preview__title-bone {
  width: 62%;
  height: 14px;
}

.lanbitou-preview__meta {
  font-family: var(--font-mono, monospace);
  font-size: var(--font-size-xs, 9px);
  line-height: 1.3;
  color: var(--text-secondary, #5e584c);
}

.lanbitou-preview__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.lanbitou-preview__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lanbitou-preview__skeleton .lanbitou-preview__bone {
  height: 12px;
  opacity: 0.7;
}

.lanbitou-preview__empty {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  text-align: center;
}

.lanbitou-preview__empty-title {
  font-size: var(--font-size-base, 12px);
  font-weight: 500;
  color: var(--text-secondary, #5e584c);
}

.lanbitou-preview__empty-hint {
  font-size: var(--font-size-xs, 9px);
  line-height: 1.4;
  color: var(--text-tertiary, #736b58);
}

.lanbitou-preview__excerpt {
  margin: 0;
  font-size: var(--font-size-base, 12px);
  line-height: 1.5;
  color: var(--text-secondary, #5e584c);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  word-break: break-word;
}
</style>
