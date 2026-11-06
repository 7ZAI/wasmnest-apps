<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/composables/useAppI18n'
import type { EvidenceView } from '@/composables/orchestration/types'

const props = defineProps<{ evidence: EvidenceView[] }>()
const t = useAppI18n()

interface Group {
  key: string
  nodeKey: string
  attempt: number
  items: EvidenceView[]
}

const groups = computed<Group[]>(() => {
  const map = new Map<string, Group>()
  for (const item of props.evidence) {
    const key = `${item.nodeKey}#${item.attempt}`
    let group = map.get(key)
    if (!group) {
      group = { key, nodeKey: item.nodeKey, attempt: item.attempt, items: [] }
      map.set(key, group)
    }
    group.items.push(item)
  }
  return [...map.values()]
})

function kindLabel(kind: string): string {
  const key = `orchestration.evidence.${kind}`
  const text = t(key)
  return text === key ? kind : text
}

function files(item: EvidenceView): string[] {
  const value = item.payload.files
  return Array.isArray(value) ? (value as string[]) : []
}

function violations(item: EvidenceView): string[] {
  const value = item.payload.scopeViolations
  return Array.isArray(value) ? (value as string[]) : []
}
</script>

<template>
  <div
    :class="
      groups.length ? 'rounded-card border border-[var(--border)] bg-[var(--bg-card)] p-2' : ''
    "
    data-testid="orchestration-evidence"
  >
    <div v-if="groups.length === 0" class="py-1.5 text-xs text-[var(--text-tertiary)]">
      {{ t('orchestration.evidence.empty') }}
    </div>
    <div v-else class="max-h-72 space-y-2 overflow-auto pr-0.5">
      <details
        v-for="group in groups"
        :key="group.key"
        class="group overflow-hidden rounded-btn border border-[var(--border)] bg-[var(--bg-card)]"
      >
        <summary
          class="flex cursor-pointer items-center gap-2 rounded-btn px-2.5 py-2 text-[calc(11.5px*var(--ui-scale))] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          <svg
            class="h-3 w-3 shrink-0 text-[var(--text-tertiary)] transition-transform duration-150 group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span class="wb-mono text-[var(--text-primary)]">{{ group.nodeKey }}</span>
          <span class="wb-mono text-[var(--text-tertiary)]">#{{ group.attempt }}</span>
          <span class="flex-1"></span>
          <span class="wb-mono text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]">{{
            group.items.length
          }}</span>
        </summary>
        <div class="space-y-2 border-t border-[var(--border)] p-2">
          <div
            v-for="(item, index) in group.items"
            :key="index"
            class="rounded-btn bg-[var(--bg-hover)] p-2.5 text-[calc(11px*var(--ui-scale))]"
          >
            <div class="wb-mono text-[calc(10px*var(--ui-scale))] text-[var(--text-secondary)]">
              {{ kindLabel(item.kind) }}
            </div>
            <template v-if="item.kind === 'diff'">
              <div v-if="files(item).length" class="mt-1 space-y-0.5">
                <div v-for="file in files(item)" :key="file" class="wb-mono truncate">
                  {{ file }}
                </div>
              </div>
              <div v-else class="mt-1 text-[var(--text-tertiary)]">—</div>
              <div
                v-if="violations(item).length"
                class="mt-1 text-[var(--color-danger-ink)]"
                data-testid="orchestration-evidence-violation"
              >
                <div v-for="file in violations(item)" :key="file" class="wb-mono truncate">
                  {{ file }}
                </div>
              </div>
            </template>
            <template v-else-if="item.kind === 'command'">
              <div class="wb-mono mt-1 text-[var(--text-primary)]">
                {{ t('orchestration.evidence.exitCode') }}:
                {{ item.payload.exitCode ?? t('orchestration.evidence.signal') }}
                <span v-if="item.payload.timedOut" class="text-[var(--color-warning-ink)]">
                  · {{ t('orchestration.evidence.timeout') }}
                </span>
              </div>
              <pre
                v-if="item.payload.outputTail"
                class="wb-mono mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-btn bg-[var(--bg-card)] p-2 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]"
                >{{ item.payload.outputTail }}</pre>
            </template>
            <template v-else-if="item.kind === 'verdict'">
              <div class="wb-mono mt-1 text-[var(--text-primary)]">
                {{ t('orchestration.evidence.verdict') }}:
                {{ item.payload.verdict ?? '—' }}
              </div>
            </template>
            <pre
              v-else
              class="wb-mono mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-btn bg-[var(--bg-card)] p-2 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]"
              >{{ JSON.stringify(item.payload, null, 2) }}</pre>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
summary {
  list-style: none;
}

summary::-webkit-details-marker {
  display: none;
}
</style>
