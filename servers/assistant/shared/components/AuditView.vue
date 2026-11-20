<script setup lang="ts">
/**
 * 审计页（票 13 / spec §5.6、§5.7）
 *
 * 每次工具调用一行：工具 / 目标应用 / 命令 / 风险 / 决定 / 参数与结果摘要。
 * 只存摘要不存原文（spec §6 日志红线）。用户可查看、清空（二次确认）；
 * 导出走应用级「导出」（含审计摘要，密钥不导出）。
 *
 * 纯展示组件：命令经 props.invoke 注入，保持端无关（D3）。
 */
import { onMounted, ref } from 'vue'
import { ASSISTANT_AUDIT_CLEAR_COMMAND, ASSISTANT_AUDIT_LIST_COMMAND, type AuditEntry } from '../types'

const props = defineProps<{
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  t: (key: string) => string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const entries = ref<AuditEntry[]>([])
const errorMessage = ref('')
const notice = ref('')
/** 清空二次确认：第一次点击进入确认态，第二次执行 */
const clearArmed = ref(false)

async function refresh(): Promise<void> {
  errorMessage.value = ''
  try {
    const res = await props.invoke<{ entries: AuditEntry[] }>(ASSISTANT_AUDIT_LIST_COMMAND, {
      limit: 100,
    })
    entries.value = res?.entries ?? []
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

function flash(msg: string): void {
  notice.value = msg
  window.setTimeout(() => {
    if (notice.value === msg) notice.value = ''
  }, 2500)
}

async function onClear(): Promise<void> {
  if (!clearArmed.value) {
    clearArmed.value = true
    return
  }
  try {
    await props.invoke(ASSISTANT_AUDIT_CLEAR_COMMAND, {})
    clearArmed.value = false
    await refresh()
    flash(props.t('assistant.audit.clearDone'))
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

function decisionLabel(decision: string): string {
  return decision === 'allowed' ? props.t('assistant.audit.decisionAllowed') : props.t('assistant.audit.decisionDenied')
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="nest-audit" data-testid="nest-audit-view">
    <header class="nest-audit__head">
      <div>
        <strong class="nest-audit__title">{{ t('assistant.audit.title') }}</strong>
        <p class="nest-audit__subtitle">{{ t('assistant.audit.subtitle') }}</p>
      </div>
      <button type="button" class="nest-audit__close" data-testid="nest-audit-close" @click="emit('close')">
        {{ t('assistant.settings.close') }}
      </button>
    </header>

    <div v-if="errorMessage" class="nest-audit__error">{{ errorMessage }}</div>
    <div v-if="notice" class="nest-audit__notice">{{ notice }}</div>

    <ul v-if="entries.length > 0" class="nest-audit__list" data-testid="nest-audit-list">
      <li v-for="e in entries" :key="e.id" class="nest-audit__item" data-testid="nest-audit-item">
        <div class="nest-audit__row">
          <span class="nest-audit__tool">{{ e.toolId }}</span>
          <span v-if="e.appId" class="nest-audit__app">{{ e.appId }}</span>
          <span class="nest-audit__decision" :data-decision="e.decision">{{ decisionLabel(e.decision) }}</span>
          <span class="nest-audit__time">{{ e.ts }}</span>
        </div>
        <div class="nest-audit__meta">
          <span>{{ t('assistant.audit.command') }}：{{ e.command }}</span>
          <span>{{ t('assistant.audit.risk') }}：{{ e.risk }}</span>
        </div>
        <div v-if="e.argsDigest" class="nest-audit__digest">{{ e.argsDigest }}</div>
      </li>
    </ul>
    <p v-else class="nest-audit__empty" data-testid="nest-audit-empty">{{ t('assistant.audit.empty') }}</p>

    <div class="nest-audit__clear">
      <button
        type="button"
        class="nest-audit__btn"
        data-testid="nest-audit-clear"
        @click="onClear"
      >
        {{ t('assistant.audit.clear') }}
      </button>
      <span v-if="clearArmed" class="nest-audit__confirm">{{ t('assistant.audit.clearConfirm') }}</span>
    </div>
  </div>
</template>

<style scoped>
.nest-audit {
  position: absolute;
  inset: 0;
  z-index: 10;
  overflow-y: auto;
  padding: 16px;
  background: var(--nest-surface);
  color: var(--nest-text);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.nest-audit__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.nest-audit__title {
  font-size: 15px;
}

.nest-audit__subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--nest-muted);
}

.nest-audit__close {
  border: 1px solid var(--nest-border);
  background: transparent;
  color: var(--nest-text);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}

.nest-audit__error {
  border: 1px solid #b91c1c;
  color: #fca5a5;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
}

.nest-audit__notice {
  border: 1px solid var(--nest-accent);
  color: var(--nest-accent);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
}

.nest-audit__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nest-audit__item {
  border: 1px solid var(--nest-border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--nest-surface-2);
  font-size: 12px;
}

.nest-audit__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.nest-audit__tool {
  font-weight: 600;
}

.nest-audit__app,
.nest-audit__time {
  color: var(--nest-muted);
}

.nest-audit__decision {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid;
}

.nest-audit__decision[data-decision='allowed'] {
  border-color: var(--nest-accent);
  color: var(--nest-accent);
}

.nest-audit__decision[data-decision='denied'] {
  border-color: #b91c1c;
  color: #fca5a5;
}

.nest-audit__meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  color: var(--nest-muted);
}

.nest-audit__digest {
  margin-top: 4px;
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: var(--nest-muted);
  word-break: break-all;
}

.nest-audit__empty {
  margin: 8px 0;
  font-size: 13px;
  color: var(--nest-muted);
}

.nest-audit__clear {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 10px;
}

.nest-audit__btn {
  border: 1px solid #b91c1c;
  background: transparent;
  color: #fca5a5;
  border-radius: 8px;
  padding: 5px 12px;
  cursor: pointer;
  font-size: 12px;
}

.nest-audit__confirm {
  font-size: 12px;
  color: #fca5a5;
}
</style>
