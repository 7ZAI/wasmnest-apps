<script setup lang="ts">
/**
 * 工具审计面板（共享组件，双端同构 · 票 13 / spec §5.9）
 *
 * 设置页里的「审计」区：查看 / 导出 / 清空每次工具调用的一行摘要。
 * 这里只读 `assistant.audit-list` 与 `assistant.audit-clear`；写入归工具运行时。
 * 摘要列不展示参数 / 返回值原文（审计本就不存原文，spec §6）。
 */
import { onMounted, ref } from 'vue'
import {
  ASSISTANT_AUDIT_CLEAR_COMMAND,
  ASSISTANT_AUDIT_LIST_COMMAND,
  ASSISTANT_SETTINGS_SET_COMMAND,
  TOOL_TEST_TOOLS_SETTING,
  type AuditRow,
} from '@nest-shared/tools/audit'
import { ASSISTANT_SETTINGS_GET_COMMAND, type AssistantInvoke } from '@nest-shared/types'

const props = defineProps<{
  invoke: AssistantInvoke
  t: (key: string) => string
}>()

const entries = ref<AuditRow[]>([])
const loading = ref(false)
const error = ref('')
const clearArmed = ref(false)
const testToolsEnabled = ref(false)
const testToolsSaving = ref(false)

/** 审计 ts 是 epoch 毫秒字符串（落库口径）；显示时转本地时间，解析失败原样显示 */
function formatTs(ts: string): string {
  const n = Number(ts)
  return Number.isFinite(n) && n > 0 ? new Date(n).toLocaleString() : ts
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await props.invoke<{ entries: AuditRow[] }>(ASSISTANT_AUDIT_LIST_COMMAND, {
      limit: 200,
    })
    entries.value = res?.entries ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadTestToolsSetting(): Promise<void> {
  try {
    const res = await props.invoke<{ value: string | null }>(ASSISTANT_SETTINGS_GET_COMMAND, {
      key: TOOL_TEST_TOOLS_SETTING,
    })
    testToolsEnabled.value = res?.value === '1'
  } catch (e) {
    // 读取失败按关闭处理，但把原因显示出来（不静默）
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function toggleTestTools(): Promise<void> {
  const next = !testToolsEnabled.value
  testToolsSaving.value = true
  error.value = ''
  try {
    await props.invoke(ASSISTANT_SETTINGS_SET_COMMAND, {
      key: TOOL_TEST_TOOLS_SETTING,
      value: next ? '1' : '0',
    })
    testToolsEnabled.value = next
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    testToolsSaving.value = false
  }
}

async function clear(): Promise<void> {
  if (!clearArmed.value) {
    clearArmed.value = true
    return
  }
  clearArmed.value = false
  error.value = ''
  try {
    await props.invoke(ASSISTANT_AUDIT_CLEAR_COMMAND)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

/** 导出为 JSON 文件（只含摘要；走 Blob 下载，不触发网络 / 文件原语） */
function exportJson(): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    entries: entries.value,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nest-audit-${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 延后释放：部分 WebView 在 click 后同步 revoke 会中断下载
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

onMounted(() => {
  void load()
  void loadTestToolsSetting()
})
</script>

<template>
  <section class="nest-audit" data-testid="nest-audit">
    <header class="nest-audit__head">
      <h3 class="nest-audit__title">{{ t('assistant.audit.title') }}</h3>
      <div class="nest-audit__actions">
        <button type="button" data-testid="nest-audit-refresh" @click="load">
          {{ t('assistant.audit.refresh') }}
        </button>
        <button
          type="button"
          data-testid="nest-audit-export"
          :disabled="entries.length === 0"
          @click="exportJson"
        >
          {{ t('assistant.audit.export') }}
        </button>
        <button
          type="button"
          class="nest-audit__danger"
          data-testid="nest-audit-clear"
          :disabled="entries.length === 0"
          @click="clear"
        >
          {{ clearArmed ? t('assistant.audit.clearConfirm') : t('assistant.audit.clear') }}
        </button>
      </div>
    </header>

    <p v-if="error" class="nest-audit__error" data-testid="nest-audit-error">{{ error }}</p>
    <p v-if="loading" class="nest-audit__muted">{{ t('assistant.audit.loading') }}</p>
    <p v-else-if="entries.length === 0" class="nest-audit__muted" data-testid="nest-audit-empty">
      {{ t('assistant.audit.empty') }}
    </p>

    <ul v-else class="nest-audit__list">
      <li v-for="row in entries" :key="row.id" class="nest-audit__row" data-testid="nest-audit-row">
        <div class="nest-audit__line">
          <span class="nest-audit__time">{{ formatTs(row.ts) }}</span>
          <span class="nest-audit__tool">{{ row.tool_id }}</span>
          <span v-if="row.app_id" class="nest-audit__app">{{ row.app_id }}</span>
          <span class="nest-audit__risk" :class="`nest-audit__risk--${row.risk}`">{{
            row.risk
          }}</span>
          <span class="nest-audit__decision" :class="`nest-audit__decision--${row.decision}`">
            {{ row.decision }}
          </span>
        </div>
        <div class="nest-audit__line nest-audit__line--sub">
          <span class="nest-audit__command">{{ row.command }}</span>
          <span class="nest-audit__digest">{{ row.args_digest ?? '—' }}</span>
          <span class="nest-audit__digest">{{ row.result_digest ?? '—' }}</span>
        </div>
      </li>
    </ul>

    <label class="nest-audit__toggle">
      <input
        type="checkbox"
        data-testid="nest-audit-test-tools"
        :checked="testToolsEnabled"
        :disabled="testToolsSaving"
        @change="toggleTestTools"
      />
      <span>{{ t('assistant.audit.testTools') }}</span>
    </label>
    <p class="nest-audit__hint">{{ t('assistant.audit.testToolsHint') }}</p>
  </section>
</template>

<style scoped>
.nest-audit {
  border-top: 1px solid var(--nest-border, #3a4150);
  padding-top: 14px;
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nest-audit__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.nest-audit__title {
  margin: 0;
  font-size: 13px;
}

.nest-audit__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.nest-audit__actions button {
  border: 1px solid var(--nest-border, #3a4150);
  background: transparent;
  color: var(--nest-text, #e8eaf0);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.nest-audit__actions button:disabled {
  opacity: 0.45;
  cursor: default;
}

.nest-audit__danger {
  border-color: var(--nest-error, #c0392b) !important;
  color: var(--nest-error-text, #f0b4ae) !important;
}

.nest-audit__muted,
.nest-audit__hint {
  margin: 0;
  font-size: 12px;
  color: var(--nest-muted, #8a8f98);
  line-height: 1.6;
}

.nest-audit__error {
  margin: 0;
  font-size: 12px;
  color: var(--nest-error-text, #f0b4ae);
}

.nest-audit__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}

.nest-audit__row {
  border: 1px solid var(--nest-border, #3a4150);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 11px;
}

.nest-audit__line {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.nest-audit__line--sub {
  margin-top: 3px;
  color: var(--nest-muted, #8a8f98);
}

.nest-audit__tool {
  font-weight: 600;
}

.nest-audit__app,
.nest-audit__digest,
.nest-audit__command,
.nest-audit__time {
  font-family: ui-monospace, monospace;
}

.nest-audit__risk--write {
  color: var(--nest-warn, #d8a657);
}

.nest-audit__risk--danger,
.nest-audit__decision--rejected,
.nest-audit__decision--stopped,
.nest-audit__decision--error {
  color: var(--nest-error-text, #f0b4ae);
}

.nest-audit__decision--approved,
.nest-audit__decision--auto {
  color: var(--nest-ok, #6fbf73);
}

.nest-audit__toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--nest-text, #e8eaf0);
}
</style>
