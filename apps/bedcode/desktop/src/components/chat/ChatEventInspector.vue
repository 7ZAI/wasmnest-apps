<script setup lang="ts">
/**
 * 检查器「事件」页签：账本原始归一事件的只读视图（ADR 0004 / issue #23 M3）
 *
 * 与中栏对话面的分工：对话面吃渲染模型（12 类 kind 的展示规则），本页签
 * 直接列账本行（seq / kind / source / 时间 / payload JSON）——排障时判断
 * 「哪条通道给了什么」用（spec 用户故事 40）。只读，不提供任何写操作。
 */
import { inject, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { RunEvent } from '@/composables/useRunEvents'

const props = defineProps<{
  events: RunEvent[]
  loading: boolean
  loadError: string | null
}>()

const emit = defineEmits<{ retry: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

/** 展开的 payload（按 seq 记：账本行身份稳定，跨轮询不串） */
const expanded = ref<Set<number>>(new Set())

function toggle(seq: number): void {
  const next = new Set(expanded.value)
  if (next.has(seq)) next.delete(seq)
  else next.add(seq)
  expanded.value = next
}

/**
 * 展开态维护：只剔除已不存在的 seq，**不清空整个集合**（issue #25 M2）。
 * 流式期间事件数组每拍换引用，若逢变更即清空，展开的 payload 会被轮询反复收起；
 * 按 seq 记的集合天然跨轮询稳定。换运行时账本数组清空，全部 seq 失活 → 集合
 * 自然归零，等价于「换运行才重置」。
 */
watch(
  () => props.events,
  (events) => {
    if (expanded.value.size === 0) return
    const live = new Set(events.map((event) => event.seq))
    const kept = [...expanded.value].filter((seq) => live.has(seq))
    if (kept.length !== expanded.value.size) expanded.value = new Set(kept)
  },
)

const PAYLOAD_COLLAPSE_CHARS = 120

/** payload 的单行摘要（折叠态）与完整 JSON（展开态） */
function payloadText(event: RunEvent): string {
  try {
    return JSON.stringify(event.payload)
  } catch {
    return String(event.payload)
  }
}

function isLong(event: RunEvent): boolean {
  return payloadText(event).length > PAYLOAD_COLLAPSE_CHARS
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="inspector-events-raw">
    <div v-if="loadError" class="cei-error" data-testid="inspector-events-error">
      <span class="min-w-0 flex-1 truncate" :title="loadError">
        {{ t('project.chat.loadFailed') }}
      </span>
      <button class="underline underline-offset-2" data-testid="inspector-events-retry" @click="emit('retry')">
        {{ t('project.chat.retry') }}
      </button>
    </div>

    <div
      v-if="events.length === 0 && !loading"
      class="flex flex-1 items-center justify-center px-6 text-center"
      data-testid="inspector-events-empty"
    >
      <p class="text-[calc(11.5px*var(--ui-scale))] text-[var(--text-secondary)]">
        {{ t('project.inspector.eventsEmpty') }}
      </p>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto py-1.5" data-testid="inspector-events-list">
      <div
        v-for="event in events"
        :key="event.seq"
        class="border-b border-[var(--border)] px-3 py-1.5 last:border-b-0"
        data-testid="inspector-event-row"
        :data-kind="event.kind"
        :data-source="event.source"
      >
        <div class="flex items-center gap-2">
          <span class="font-mono shrink-0 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]">
            #{{ event.seq }}
          </span>
          <span class="font-mono text-[calc(10.5px*var(--ui-scale))] text-[var(--text-primary)]">
            {{ event.kind }}
          </span>
          <span
            class="font-mono rounded border border-[var(--border-strong)] px-1 text-[calc(9.5px*var(--ui-scale))] text-[var(--text-secondary)]"
          >
            {{ event.source }}
          </span>
          <span class="ml-auto font-mono shrink-0 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]">
            {{ event.at }}
          </span>
        </div>
        <div
          v-if="isLong(event) && !expanded.has(event.seq)"
          class="mt-1 truncate font-mono text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
        >
          {{ payloadText(event) }}
        </div>
        <pre
          v-else-if="expanded.has(event.seq)"
          class="cei-payload font-mono"
        >{{ payloadText(event) }}</pre>
        <button
          v-if="isLong(event)"
          class="mt-0.5 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)] underline underline-offset-2 hover:text-[var(--text-secondary)]"
          :aria-expanded="expanded.has(event.seq)"
          @click="toggle(event.seq)"
        >
          {{ expanded.has(event.seq) ? t('project.chat.collapse') : t('project.chat.expandPayload') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cei-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  font-size: calc(11px * var(--ui-scale));
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.cei-payload {
  margin: 4px 0 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-page);
  color: var(--text-secondary);
  font-size: calc(10px * var(--ui-scale));
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
