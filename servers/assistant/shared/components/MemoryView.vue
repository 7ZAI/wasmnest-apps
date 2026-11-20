<script setup lang="ts">
/**
 * 记忆管理页（票 12 / spec §5.4、§5.7）
 *
 * 三视图：已确认 / 待确认收件箱 / 已拒绝；逐条编辑、删除、按应用过滤；
 * 收件箱逐条确认 / 拒绝；「清空全部记忆」二次确认；记忆总开关与
 * 每轮提取开关。所有写操作经 MemoryManager（共享核），UI 不直连命令。
 *
 * 纯展示组件：状态自持、命令经 props.invoke 注入，保持端无关（D3）。
 */
import { computed, onMounted, ref } from 'vue'
import { MemoryManager } from '../memory/manager'
import {
  type MemoryFact,
  type MemoryScope,
} from '../types'

const props = defineProps<{
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  t: (key: string, params?: Record<string, unknown>) => string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const manager = new MemoryManager({ invoke: props.invoke })

type Tab = 'confirmed' | 'pending' | 'rejected'
const tab = ref<Tab>('pending')

const confirmed = ref<MemoryFact[]>([])
const pending = ref<MemoryFact[]>([])
const rejected = ref<MemoryFact[]>([])
const loading = ref(false)
const errorMessage = ref('')
const notice = ref('')

/** 按应用过滤（scope = app 的条目按 scopeRef 匹配；空 = 全部） */
const appFilter = ref('')
/** 作用域过滤（空 = 全部） */
const scopeFilter = ref<MemoryScope | ''>('')

const memoryEnabled = ref(true)
const extractEnabled = ref(true)

/** 清空全部记忆：第一次点击进入确认态，第二次执行（二次确认，spec §5.4） */
const clearArmed = ref(false)

/** 编辑态：id → 草稿 */
const editingId = ref<string | null>(null)
const editKey = ref('')
const editValue = ref('')

const currentList = computed<MemoryFact[]>(() => {
  const all = tab.value === 'confirmed' ? confirmed.value : tab.value === 'pending' ? pending.value : rejected.value
  return all.filter((f) => {
    if (scopeFilter.value && f.scope !== scopeFilter.value) return false
    if (appFilter.value) {
      if (f.scope !== 'app') return false
      if (f.scopeRef !== appFilter.value) return false
    }
    return true
  })
})

async function refresh(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const [all, en, ex] = await Promise.all([
      manager.listAll(),
      manager.isMemoryEnabled(),
      manager.isExtractEnabled(),
    ])
    confirmed.value = all.confirmed
    pending.value = all.pending
    rejected.value = all.rejected
    memoryEnabled.value = en
    extractEnabled.value = ex
  } catch (e) {
    // 未解锁等显性错误原样呈现（fail-visible，spec §2.4）
    errorMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function flash(msg: string): void {
  notice.value = msg
  window.setTimeout(() => {
    if (notice.value === msg) notice.value = ''
  }, 2500)
}

async function onConfirm(id: string): Promise<void> {
  try {
    await manager.confirm(id)
    await refresh()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function onReject(id: string): Promise<void> {
  try {
    await manager.reject(id)
    await refresh()
    flash(props.t('assistant.memory.rejectedHint'))
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function onDelete(id: string): Promise<void> {
  try {
    // 「忘记这条」立即删（票面口径，无额外确认）
    await manager.delete(id)
    await refresh()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

function startEdit(f: MemoryFact): void {
  editingId.value = f.id
  editKey.value = f.key
  editValue.value = f.value
}

function cancelEdit(): void {
  editingId.value = null
  editKey.value = ''
  editValue.value = ''
}

async function saveEdit(f: MemoryFact): Promise<void> {
  try {
    await manager.upsert({
      id: f.id,
      scope: f.scope,
      scopeRef: f.scopeRef,
      key: editKey.value.trim(),
      value: editValue.value.trim(),
      status: f.status,
      sourceConversationId: f.sourceConversationId,
      sourceMessageId: f.sourceMessageId,
    })
    cancelEdit()
    await refresh()
    flash(props.t('assistant.memory.savedHint'))
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function onClearAll(): Promise<void> {
  if (!clearArmed.value) {
    clearArmed.value = true
    return
  }
  try {
    const deleted = await manager.clearAll()
    clearArmed.value = false
    await refresh()
    flash(props.t('assistant.memory.clearDone', { count: String(deleted) }))
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function toggleMemory(on: boolean): Promise<void> {
  try {
    await manager.setMemoryEnabled(on)
    memoryEnabled.value = on
    flash(on ? props.t('assistant.memory.enabledOn') : props.t('assistant.memory.enabledOff'))
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function toggleExtract(on: boolean): Promise<void> {
  try {
    await manager.setExtractEnabled(on)
    extractEnabled.value = on
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

function scopeLabel(scope: MemoryScope): string {
  const map: Record<MemoryScope, string> = {
    global: props.t('assistant.memory.scopeGlobal'),
    app: props.t('assistant.memory.scopeApp'),
    conversation: props.t('assistant.memory.scopeConversation'),
  }
  return map[scope]
}

function sourceLabel(f: MemoryFact): string {
  if (!f.sourceConversationId) return props.t('assistant.memory.sourceUnknown')
  return `${props.t('assistant.memory.source')} ${f.sourceConversationId}`
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="nest-memory" data-testid="nest-memory-view">
    <header class="nest-memory__head">
      <div>
        <strong class="nest-memory__title">{{ t('assistant.memory.title') }}</strong>
        <p class="nest-memory__subtitle">{{ t('assistant.memory.subtitle') }}</p>
      </div>
      <button type="button" class="nest-memory__close" data-testid="nest-memory-close" @click="emit('close')">
        {{ t('assistant.settings.close') }}
      </button>
    </header>

    <div class="nest-memory__switches">
      <label class="nest-memory__switch">
        <input
          type="checkbox"
          :checked="memoryEnabled"
          data-testid="nest-memory-enabled"
          @change="toggleMemory(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ t('assistant.memory.memorySwitch') }}</span>
      </label>
      <label class="nest-memory__switch">
        <input
          type="checkbox"
          :checked="extractEnabled"
          data-testid="nest-memory-extract"
          @change="toggleExtract(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ t('assistant.memory.extractSwitch') }}</span>
      </label>
    </div>
    <p class="nest-memory__hint">{{ t('assistant.memory.switchHint') }}</p>

    <div v-if="errorMessage" class="nest-memory__error" data-testid="nest-memory-error">{{ errorMessage }}</div>
    <div v-if="notice" class="nest-memory__notice" data-testid="nest-memory-notice">{{ notice }}</div>

    <div class="nest-memory__tabs" role="tablist">
      <button
        v-for="(label, key) in { confirmed: t('assistant.memory.tabConfirmed'), pending: t('assistant.memory.tabPending'), rejected: t('assistant.memory.tabRejected') }"
        :key="key"
        type="button"
        class="nest-memory__tab"
        :class="{ 'nest-memory__tab--active': tab === key }"
        :data-testid="`nest-memory-tab-${key}`"
        @click="tab = key as Tab"
      >
        {{ label }}
        <span class="nest-memory__tab-count">
          {{ key === 'confirmed' ? confirmed.length : key === 'pending' ? pending.length : rejected.length }}
        </span>
      </button>
    </div>

    <div class="nest-memory__filters">
      <select v-model="scopeFilter" class="nest-memory__select" data-testid="nest-memory-scope-filter">
        <option value="">{{ t('assistant.memory.filterAll') }}</option>
        <option value="global">{{ t('assistant.memory.scopeGlobal') }}</option>
        <option value="app">{{ t('assistant.memory.scopeApp') }}</option>
        <option value="conversation">{{ t('assistant.memory.scopeConversation') }}</option>
      </select>
      <input
        v-model="appFilter"
        class="nest-memory__input"
        :placeholder="t('assistant.memory.filterApp')"
        data-testid="nest-memory-app-filter"
      />
    </div>

    <p v-if="tab === 'pending' && pending.length > 0" class="nest-memory__inbox-hint">
      {{ t('assistant.memory.inboxHint') }}
    </p>

    <ul v-if="currentList.length > 0" class="nest-memory__list" data-testid="nest-memory-list">
      <li v-for="f in currentList" :key="f.id" class="nest-memory__item" data-testid="nest-memory-item">
        <div class="nest-memory__item-head">
          <span class="nest-memory__key" data-testid="nest-memory-item-key">{{ f.key }}</span>
          <span class="nest-memory__badge">{{ scopeLabel(f.scope) }}</span>
          <span v-if="f.scopeRef" class="nest-memory__ref">{{ f.scopeRef }}</span>
        </div>

        <template v-if="editingId === f.id">
          <input v-model="editKey" class="nest-memory__input" :placeholder="t('assistant.memory.key')" />
          <textarea v-model="editValue" class="nest-memory__textarea" rows="3"></textarea>
          <div class="nest-memory__item-actions">
            <button type="button" class="nest-memory__btn nest-memory__btn--primary" @click="saveEdit(f)">
              {{ t('assistant.memory.save') }}
            </button>
            <button type="button" class="nest-memory__btn" @click="cancelEdit">{{ t('assistant.settings.cancel') }}</button>
          </div>
        </template>
        <template v-else>
          <p class="nest-memory__value" data-testid="nest-memory-item-value">{{ f.value }}</p>
          <p class="nest-memory__source">{{ sourceLabel(f) }} · {{ f.updatedAt }}</p>
          <div class="nest-memory__item-actions">
            <template v-if="tab === 'pending'">
              <button
                type="button"
                class="nest-memory__btn nest-memory__btn--primary"
                data-testid="nest-memory-confirm"
                @click="onConfirm(f.id)"
              >
                {{ t('assistant.memory.confirm') }}
              </button>
              <button
                type="button"
                class="nest-memory__btn"
                data-testid="nest-memory-reject"
                @click="onReject(f.id)"
              >
                {{ t('assistant.memory.reject') }}
              </button>
            </template>
            <button type="button" class="nest-memory__btn" :title="t('assistant.memory.edit')" @click="startEdit(f)">
              ✎
            </button>
            <button
              type="button"
              class="nest-memory__btn nest-memory__btn--danger"
              data-testid="nest-memory-delete"
              @click="onDelete(f.id)"
            >
              {{ t('assistant.memory.delete') }}
            </button>
          </div>
        </template>
      </li>
    </ul>
    <p v-else class="nest-memory__empty" data-testid="nest-memory-empty">
      {{ loading ? '' : t('assistant.memory.empty') }}
    </p>

    <div class="nest-memory__clear">
      <button
        type="button"
        class="nest-memory__btn nest-memory__btn--danger"
        data-testid="nest-memory-clear-all"
        @click="onClearAll"
      >
        {{ t('assistant.memory.clearAll') }}
      </button>
      <span v-if="clearArmed" class="nest-memory__clear-confirm" data-testid="nest-memory-clear-confirm">
        {{ t('assistant.memory.clearConfirm') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.nest-memory {
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

.nest-memory__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.nest-memory__title {
  font-size: 15px;
}

.nest-memory__subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--nest-muted);
}

.nest-memory__close {
  border: 1px solid var(--nest-border);
  background: transparent;
  color: var(--nest-text);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}

.nest-memory__switches {
  display: flex;
  gap: 18px;
}

.nest-memory__switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.nest-memory__hint {
  margin: 0;
  font-size: 12px;
  color: var(--nest-muted);
}

.nest-memory__error {
  border: 1px solid #b91c1c;
  color: #fca5a5;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
}

.nest-memory__notice {
  border: 1px solid var(--nest-accent);
  color: var(--nest-accent);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
}

.nest-memory__tabs {
  display: flex;
  gap: 6px;
}

.nest-memory__tab {
  border: 1px solid var(--nest-border);
  background: transparent;
  color: var(--nest-muted);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}

.nest-memory__tab--active {
  border-color: var(--nest-accent);
  color: var(--nest-accent);
}

.nest-memory__tab-count {
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.7;
}

.nest-memory__filters {
  display: flex;
  gap: 8px;
}

.nest-memory__select,
.nest-memory__input {
  background: var(--nest-surface-2);
  border: 1px solid var(--nest-border);
  border-radius: 8px;
  color: var(--nest-text);
  font-size: 12px;
  padding: 6px 8px;
}

.nest-memory__input {
  flex: 1;
}

.nest-memory__inbox-hint {
  margin: 0;
  font-size: 12px;
  color: var(--nest-muted);
}

.nest-memory__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nest-memory__item {
  border: 1px solid var(--nest-border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--nest-surface-2);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nest-memory__item-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nest-memory__key {
  font-weight: 600;
  font-size: 13px;
}

.nest-memory__badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--nest-surface);
  border: 1px solid var(--nest-border);
  color: var(--nest-muted);
}

.nest-memory__ref {
  font-size: 11px;
  color: var(--nest-muted);
}

.nest-memory__value {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.nest-memory__source {
  margin: 0;
  font-size: 11px;
  color: var(--nest-muted);
}

.nest-memory__textarea {
  background: var(--nest-surface);
  border: 1px solid var(--nest-accent);
  border-radius: 8px;
  color: var(--nest-text);
  font-size: 13px;
  padding: 6px 8px;
  resize: vertical;
}

.nest-memory__item-actions {
  display: flex;
  gap: 6px;
}

.nest-memory__btn {
  border: 1px solid var(--nest-border);
  background: transparent;
  color: var(--nest-text);
  border-radius: 8px;
  padding: 5px 12px;
  cursor: pointer;
  font-size: 12px;
}

.nest-memory__btn--primary {
  border-color: var(--nest-accent);
  color: var(--nest-accent);
}

.nest-memory__btn--danger {
  border-color: #b91c1c;
  color: #fca5a5;
}

.nest-memory__empty {
  margin: 8px 0;
  font-size: 13px;
  color: var(--nest-muted);
}

.nest-memory__clear {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 10px;
}

.nest-memory__clear-confirm {
  font-size: 12px;
  color: #fca5a5;
}
</style>
