<template>
  <section
    ref="root"
    class="news-reader"
    tabindex="-1"
    data-testid="news-reader"
    aria-live="polite"
  >
    <div
      v-if="loading"
      class="news-reader-state"
      role="status"
      data-testid="news-reader-loading"
    >
      {{ t('news.reader.loading') }}
    </div>

    <div
      v-else-if="failure"
      class="news-reader-state news-reader-error"
      role="alert"
      data-testid="news-reader-error"
    >
      <p class="news-reader-error-title">{{ t(`news.error.${failure.code}`) }}</p>
      <p v-if="failure.detail" class="news-reader-error-detail">{{ failure.detail }}</p>
      <div class="news-reader-actions">
        <button
          type="button"
          class="news-reader-action"
          data-testid="news-reader-retry"
          @click="emit('retry')"
        >
          {{ t('news.reader.retry') }}
        </button>
        <button
          type="button"
          class="news-reader-action"
          data-testid="news-reader-copy"
          @click="emit('copy', itemUrl)"
        >
          {{ t('news.reader.copy') }}
        </button>
        <button
          v-if="failure.code === 'net.denied' || failure.code === 'reader.disabled'"
          type="button"
          class="news-reader-action"
          data-testid="news-reader-open-settings"
          @click="emit('open-settings')"
        >
          {{ t('news.reader.openSettings') }}
        </button>
      </div>
      <p class="news-reader-source">
        <span>{{ t('news.reader.source') }}</span>
        <span class="news-reader-url">{{ itemUrl }}</span>
      </p>
    </div>

    <template v-else-if="view">
      <p
        v-if="view.stale"
        class="news-reader-notice"
        role="status"
        data-testid="news-reader-stale"
      >
        {{ t('news.reader.stale') }}
      </p>
      <p
        v-if="view.truncated"
        class="news-reader-notice"
        data-testid="news-reader-truncated"
      >
        {{ t('news.reader.truncated') }}
      </p>

      <div class="news-reader-blocks" data-testid="news-reader-blocks">
        <template v-for="(group, index) in groups" :key="index">
          <ul v-if="group.type === 'list'" class="news-reader-list">
            <li v-for="(item, itemIndex) in group.items" :key="itemIndex">
              {{ item.text }}
            </li>
          </ul>
          <component
            :is="headingTag(group)"
            v-else-if="group.kind === 'heading'"
            class="news-reader-heading"
          >
            {{ group.text }}
          </component>
          <p v-else-if="group.kind === 'paragraph'" class="news-reader-paragraph">
            {{ group.text }}
          </p>
          <blockquote v-else-if="group.kind === 'quote'" class="news-reader-quote">
            {{ group.text }}
          </blockquote>
          <pre v-else-if="group.kind === 'code'" class="news-reader-code"><code>{{ group.text }}</code></pre>
        </template>
      </div>

      <p class="news-reader-source">
        <span>{{ t('news.reader.source') }}</span>
        <span class="news-reader-url">{{ itemUrl }}</span>
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { ReaderBlock, ReaderBlockKind, ReaderView } from '../types'
import type { NewsError } from '../utils/errors'

const props = defineProps<{
  view: ReaderView | null
  loading: boolean
  error: NewsError | null
  itemUrl: string
}>()
const emit = defineEmits<{ retry: []; copy: [url: string]; 'open-settings': [] }>()
const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)
const root = ref<HTMLElement | null>(null)

const failure = computed<NewsError | null>(() => {
  if (props.error) return props.error
  if (props.view?.state === 'failed') {
    return {
      code: props.view.errorKind ?? 'unknown',
      detail: props.view.errorDetail ?? '',
    }
  }
  return null
})

type ReaderGroup =
  | { type: 'block'; kind: ReaderBlockKind; level?: number; text: string }
  | { type: 'list'; items: ReaderBlock[] }

const groups = computed<ReaderGroup[]>(() => {
  const output: ReaderGroup[] = []
  let list: ReaderBlock[] = []
  const flush = (): void => {
    if (list.length > 0) {
      output.push({ type: 'list', items: list })
      list = []
    }
  }
  for (const block of props.view?.blocks ?? []) {
    if (block.kind === 'listItem') {
      list.push(block)
      continue
    }
    flush()
    output.push({
      type: 'block',
      kind: block.kind,
      level: block.level,
      text: block.text,
    })
  }
  flush()
  return output
})

function headingTag(block: { level?: number }): string {
  if (block.level === 1) return 'h3'
  if (block.level === 2) return 'h4'
  return 'h5'
}

function focus(): void {
  root.value?.focus()
}

defineExpose({ focus })
</script>

<style scoped>
.news-reader {
  max-width: 65ch;
  font-size: calc(1rem * var(--ui-scale, 1));
  line-height: 1.75;
  color: var(--text-primary);
  outline: none;
}
.news-reader:focus-visible {
  outline: 2px solid var(--color-info);
  outline-offset: 4px;
}
.news-reader-state {
  padding: 18px 0;
  color: var(--text-secondary);
}
.news-reader-error {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-card, 10px);
  padding: 14px 16px;
  background: var(--bg-card);
}
.news-reader-error-title {
  margin: 0 0 6px;
  font-weight: 600;
  color: var(--text-primary);
}
.news-reader-error-detail {
  margin: 0 0 12px;
  font-size: 0.85em;
  color: var(--text-tertiary);
  overflow-wrap: anywhere;
}
.news-reader-actions {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.news-reader-action {
  border: 0;
  border-bottom: 1px solid var(--border-strong);
  background: none;
  padding: 2px 0;
  color: var(--text-secondary);
  font-size: 0.9em;
  cursor: pointer;
}
.news-reader-action:hover {
  color: var(--text-primary);
  border-bottom-color: var(--text-primary);
}
.news-reader-action:focus-visible {
  outline: 2px solid var(--color-info);
  outline-offset: 2px;
}
.news-reader-notice {
  margin: 0 0 14px;
  padding: 8px 10px;
  border-radius: var(--radius-button, 8px);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 0.85em;
  line-height: 1.5;
}
.news-reader-heading {
  margin: 1.4em 0 0.55em;
  font-size: 1.15em;
  line-height: 1.35;
  font-weight: 650;
  text-wrap: balance;
}
.news-reader-heading:first-child,
.news-reader-blocks > :first-child {
  margin-top: 0;
}
.news-reader-paragraph {
  margin: 0 0 1em;
  text-wrap: pretty;
}
.news-reader-list {
  margin: 0 0 1em;
  padding-inline-start: 1.4em;
}
.news-reader-list li + li {
  margin-top: 0.35em;
}
.news-reader-quote {
  margin: 1em 0;
  padding-inline-start: 1em;
  border-inline-start: 3px solid var(--border-strong);
  color: var(--text-secondary);
  text-wrap: pretty;
}
.news-reader-code {
  margin: 1em 0;
  padding: 12px 14px;
  overflow-x: auto;
  border-radius: var(--radius-card, 10px);
  background: var(--bg-input);
  font-size: 0.85em;
  line-height: 1.6;
}
.news-reader-code code {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
}
.news-reader-source {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 1.6em 0 0;
  padding-top: 0.9em;
  border-top: 1px solid var(--border);
  font-size: 0.8em;
  color: var(--text-tertiary);
}
.news-reader-url {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  user-select: all;
}
</style>