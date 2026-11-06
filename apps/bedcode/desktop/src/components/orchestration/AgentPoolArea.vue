<script setup lang="ts">
/**
 * Agent 池：编排的「人」这一侧。
 *
 * 成员 = 已安装 CLI + 模型 / 思考等级 + 标签 / 擅长 / 职责描述。编排 Agent 从
 * 这里选人，自动计划按职责描述匹配。创建源 = Agent 管理域已安装的桥接 CLI
 *（`AgentDescriptor.bridge` 由后端给出），不在前端另造 CLI 白名单。
 */
import { computed, inject, onMounted, reactive, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import PluginModal from '@/components/PluginModal.vue'
import AppSelectField from '@/components/ui/AppSelectField.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import Toggle from '@/components/Toggle.vue'
import AgentIcon from '@/agents/components/AgentIcon.vue'
import {
  resolveAgentProfileError,
  useAgentProfiles,
} from '@/composables/orchestration/useAgentProfiles'
import type {
  AgentOption,
  AgentProfileOptions,
  AgentProfileView,
} from '@/composables/orchestration/types'

const props = defineProps<{
  /** `orchestration.meta.agents`：已按桥接能力过滤，ready = CLI 已安装 */
  agents: AgentOption[]
}>()
const emit = defineEmits<{ refresh: []; changed: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)
const api = useAgentProfiles(context)

const profiles = ref<AgentProfileView[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

const editorOpen = ref(false)
const editing = ref<AgentProfileView | null>(null)
const saving = ref(false)
const formError = ref<string | null>(null)
const options = ref<AgentProfileOptions | null>(null)
const optionsError = ref<string | null>(null)

const deleteTarget = ref<AgentProfileView | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

/** 程序化回填表单时挂起 CLI watcher：只在用户手动切 CLI 时清空 model / thinkingLevel。 */
let syncing = false

const form = reactive({
  name: '',
  cli: '',
  model: '',
  thinkingLevel: '',
  tagsText: '',
  specialtiesText: '',
  description: '',
  canOrchestrate: false,
  enabled: true,
})

const installedBridgeAgents = computed(() => props.agents.filter((agent) => agent.ready))

/** 编辑禁用成员时保留当前 CLI（即使已卸载），不让「改个标签」变成换 CLI。 */
const cliOptions = computed(() => {
  const out = installedBridgeAgents.value.map((agent) => ({
    value: agent.id,
    label: agent.displayName,
  }))
  if (form.cli && !out.some((option) => option.value === form.cli)) {
    const known = props.agents.find((agent) => agent.id === form.cli)
    out.push({
      value: form.cli,
      label: `${known?.displayName ?? form.cli} (${t('orchestration.pool.cliNotInstalled')})`,
    })
  }
  return out
})

const thinkingOptions = computed(() =>
  (options.value?.thinkingLevels ?? []).map((level) => ({ value: level, label: level })),
)
const modelSuggestions = computed(() => (options.value?.models ?? []).slice(0, 8))
const thinkingHint = computed(() => {
  if (!options.value) return ''
  if (options.value.thinkingLevels.length === 0) return t('orchestration.pool.thinkingUnsupported')
  return ''
})

function cliLabel(cli: string): string {
  return props.agents.find((agent) => agent.id === cli)?.displayName ?? cli
}

function chips(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[,，\n]/)) {
    const item = raw.trim()
    if (!item) continue
    if (!out.some((existing) => existing.toLowerCase() === item.toLowerCase())) out.push(item)
  }
  return out
}

function toText(values: string[]): string {
  return values.join(', ')
}

async function load() {
  loading.value = true
  loadError.value = null
  try {
    profiles.value = await api.list()
  } catch (error) {
    console.error('[orchestration-pool] load failed', error)
    loadError.value = resolveAgentProfileError(context, error, 'orchestration.pool.loadFailed')
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.name = ''
  form.model = ''
  form.thinkingLevel = ''
  form.tagsText = ''
  form.specialtiesText = ''
  form.description = ''
  form.canOrchestrate = false
  form.enabled = true
  formError.value = null
  options.value = null
  optionsError.value = null
}

async function loadOptions(cli: string) {
  options.value = null
  optionsError.value = null
  if (!cli) return
  try {
    options.value = await api.options(cli)
    if (!form.thinkingLevel && options.value.thinkingLevels.length === 0) {
      form.thinkingLevel = ''
    }
  } catch (error) {
    console.error('[orchestration-pool] options failed', error)
    optionsError.value = resolveAgentProfileError(
      context,
      error,
      'orchestration.pool.optionsFailed',
    )
  }
}

function openCreate() {
  editing.value = null
  syncing = true
  resetForm()
  form.cli = installedBridgeAgents.value[0]?.id ?? ''
  form.enabled = true
  editorOpen.value = true
  syncing = false
  void loadOptions(form.cli)
}

function openEdit(profile: AgentProfileView) {
  editing.value = profile
  syncing = true
  resetForm()
  form.name = profile.name
  form.cli = profile.cli
  form.model = profile.model ?? ''
  form.thinkingLevel = profile.thinkingLevel ?? ''
  form.tagsText = toText(profile.tags)
  form.specialtiesText = toText(profile.specialties)
  form.description = profile.description
  form.canOrchestrate = profile.canOrchestrate
  form.enabled = profile.enabled
  editorOpen.value = true
  syncing = false
  void loadOptions(form.cli)
}

// `flush: 'sync'` 是必需的：pre/post 回调会在整个回填块之后才执行，届时
// syncing 已复位，会把刚回填的 model / thinkingLevel 清空（H6）。
// 同步 flush 让「程序回填」与「用户手动切 CLI」在赋值当场就能区分。
watch(
  () => form.cli,
  (cli, previous) => {
    if (syncing || !editorOpen.value || cli === previous) return
    form.thinkingLevel = ''
    form.model = ''
    void loadOptions(cli)
  },
  { flush: 'sync' },
)

async function save() {
  if (saving.value) return
  formError.value = null
  // required 标在 <div> 内的控件上不会触发原生约束校验：保存前显式判必填，
  // 空值不得直接进 api.create / update（L17）。
  if (!form.name.trim() || !form.cli || !form.description.trim()) {
    formError.value = t('orchestration.pool.requiredMissing')
    return
  }
  saving.value = true
  const input = {
    name: form.name.trim(),
    cli: form.cli,
    model: form.model.trim() || null,
    thinkingLevel: form.thinkingLevel.trim() || null,
    tags: chips(form.tagsText),
    specialties: chips(form.specialtiesText),
    description: form.description.trim(),
    canOrchestrate: form.canOrchestrate,
    enabled: form.enabled,
  }
  try {
    if (editing.value) await api.update(editing.value.id, input)
    else await api.create(input)
    editorOpen.value = false
    await load()
    // 池成员变更会影响父视图的编排 Agent 可选清单（M34）
    emit('changed')
  } catch (error) {
    console.error('[orchestration-pool] save failed', error)
    formError.value = resolveAgentProfileError(context, error, 'orchestration.pool.saveFailed')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(profile: AgentProfileView) {
  try {
    await api.update(profile.id, {
      name: profile.name,
      cli: profile.cli,
      model: profile.model,
      thinkingLevel: profile.thinkingLevel,
      tags: profile.tags,
      specialties: profile.specialties,
      description: profile.description,
      canOrchestrate: profile.canOrchestrate,
      enabled: !profile.enabled,
    })
    await load()
    // 池成员变更会影响父视图的编排 Agent 可选清单（M34）
    emit('changed')
  } catch (error) {
    console.error('[orchestration-pool] toggle failed', error)
    loadError.value = resolveAgentProfileError(context, error, 'orchestration.pool.saveFailed')
  }
}

/** 打开删除确认：清掉上一次的弹窗内错误，再挂目标 */
function requestDelete(profile: AgentProfileView) {
  deleteError.value = null
  deleteTarget.value = profile
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleteError.value = null
  deleting.value = true
  try {
    await api.remove(target.id)
    deleteTarget.value = null
    await load()
    // 池成员变更会影响父视图的编排 Agent 可选清单（M34）
    emit('changed')
  } catch (error) {
    console.error('[orchestration-pool] delete failed', error)
    // 失败提示必须留在弹窗内：写进页面级 loadError 会被 Teleport 的 Modal 遮住（M27）
    deleteError.value = resolveAgentProfileError(context, error, 'orchestration.pool.deleteFailed')
  } finally {
    deleting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="orch-pool" data-testid="orchestration-pool">
    <div class="orch-pool-head">
      <div>
        <h2 class="wb-section-title">{{ t('orchestration.pool.title') }}</h2>
        <p class="orch-pool-sub">{{ t('orchestration.pool.subtitle') }}</p>
      </div>
      <button
        type="button"
        class="wb-btn-primary"
        :disabled="installedBridgeAgents.length === 0"
        data-testid="orchestration-pool-create"
        @click="openCreate"
      >
        {{ t('orchestration.pool.create') }}
      </button>
    </div>

    <div v-if="installedBridgeAgents.length === 0" class="orch-pool-banner">
      <span class="orch-pool-banner-icon">i</span>
      <span class="orch-pool-banner-text">{{ t('orchestration.pool.noCli') }}</span>
      <button
        type="button"
        class="wb-btn-ghost orch-pool-btn-sm"
        data-testid="orchestration-pool-refresh-cli"
        @click="emit('refresh')"
      >
        {{ t('orchestration.pool.refreshCli') }}
      </button>
    </div>

    <div
      v-if="loadError"
      class="orch-pool-banner orch-pool-banner-warn"
      data-testid="orchestration-pool-error"
    >
      <span class="orch-pool-banner-icon">!</span>
      <span class="orch-pool-banner-text">{{ loadError }}</span>
      <button type="button" class="wb-btn-ghost orch-pool-btn-sm" @click="load">
        {{ t('orchestration.pool.retry') }}
      </button>
    </div>

    <p v-if="loading" class="orch-pool-empty">{{ t('orchestration.pool.loading') }}</p>
    <div
      v-else-if="profiles.length === 0"
      class="orch-pool-empty"
      data-testid="orchestration-pool-empty"
    >
      <p>{{ t('orchestration.pool.emptyTitle') }}</p>
      <p class="orch-pool-empty-hint">{{ t('orchestration.pool.emptyHint') }}</p>
    </div>

    <div v-else class="orch-pool-grid">
      <article
        v-for="profile in profiles"
        :key="profile.id"
        class="orch-pool-surface orch-pool-card"
        :class="{ 'orch-pool-card-disabled': !profile.enabled }"
        data-testid="orchestration-pool-card"
        :data-profile-id="profile.id"
      >
        <div class="orch-pool-card-head">
          <span class="orch-pool-avatar">
            <AgentIcon :adapter="profile.cli" :size="18" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="orch-pool-name-row">
              <span class="orch-pool-name">{{ profile.name }}</span>
              <span class="orch-pool-status" :class="profile.enabled ? 'ok' : 'warn'">
                <span class="orch-pool-dot"></span>
                {{
                  profile.enabled
                    ? t('orchestration.pool.enabled')
                    : t('orchestration.pool.disabled')
                }}
              </span>
              <span v-if="profile.canOrchestrate" class="orch-pool-tag orch-pool-tag-accent">
                {{ t('orchestration.pool.canOrchestrate') }}
              </span>
              <span v-if="!profile.ready" class="orch-pool-tag orch-pool-tag-warn">
                {{ t('orchestration.pool.cliNotInstalled') }}
              </span>
            </div>
            <div class="orch-pool-meta">
              <span>{{ cliLabel(profile.cli) }}</span>
              <span v-if="profile.model" class="wb-mono">{{ profile.model }}</span>
              <span v-if="profile.thinkingLevel" class="orch-pool-tag">
                {{ t('orchestration.pool.thinkingChip', { level: profile.thinkingLevel }) }}
              </span>
            </div>
          </div>
        </div>

        <p class="orch-pool-desc">{{ profile.description }}</p>

        <div v-if="profile.specialties.length" class="orch-pool-chips">
          <span class="orch-pool-chips-label">{{ t('orchestration.pool.specialties') }}</span>
          <span v-for="item in profile.specialties" :key="item" class="orch-pool-tag">{{
            item
          }}</span>
        </div>
        <div v-if="profile.tags.length" class="orch-pool-chips">
          <span class="orch-pool-chips-label">{{ t('orchestration.pool.tags') }}</span>
          <span
            v-for="item in profile.tags"
            :key="item"
            class="orch-pool-tag orch-pool-tag-muted"
            >{{ item }}</span
          >
        </div>

        <div class="orch-pool-foot">
          <button
            type="button"
            class="wb-btn-ghost orch-pool-btn-sm"
            data-testid="orchestration-pool-edit"
            @click="openEdit(profile)"
          >
            {{ t('orchestration.pool.edit') }}
          </button>
          <button
            type="button"
            class="wb-btn-ghost orch-pool-btn-sm"
            data-testid="orchestration-pool-toggle"
            @click="toggleEnabled(profile)"
          >
            {{ profile.enabled ? t('orchestration.pool.disable') : t('orchestration.pool.enable') }}
          </button>
          <button
            type="button"
            class="wb-btn-ghost orch-pool-btn-sm orch-pool-danger"
            data-testid="orchestration-pool-delete"
            @click="requestDelete(profile)"
          >
            {{ t('orchestration.pool.delete') }}
          </button>
        </div>
      </article>
    </div>

    <PluginModal
      v-model="editorOpen"
      :title="editing ? t('orchestration.pool.editTitle') : t('orchestration.pool.createTitle')"
      size="md"
    >
      <div class="orch-pool-form" data-testid="orchestration-pool-form">
        <AppTextField
          v-model="form.name"
          :label="t('orchestration.pool.name')"
          required
          testid="orchestration-pool-name"
        />
        <AppSelectField
          v-model="form.cli"
          :label="t('orchestration.pool.cli')"
          :options="cliOptions"
          required
          testid="orchestration-pool-cli"
        />
        <div>
          <AppTextField
            v-model="form.model"
            :label="t('orchestration.pool.model')"
            :placeholder="t('orchestration.pool.modelPlaceholder')"
            :help="t('orchestration.pool.modelHelp')"
            testid="orchestration-pool-model"
          />
          <div v-if="modelSuggestions.length" class="orch-pool-suggestions">
            <button
              v-for="option in modelSuggestions"
              :key="option.value"
              type="button"
              class="orch-pool-tag orch-pool-tag-action"
              data-testid="orchestration-pool-model-suggestion"
              @click="form.model = option.value"
            >
              {{ option.value }}
            </button>
          </div>
          <p v-if="optionsError" class="orch-pool-form-hint">{{ optionsError }}</p>
        </div>
        <AppSelectField
          v-model="form.thinkingLevel"
          :label="t('orchestration.pool.thinking')"
          :options="thinkingOptions"
          :placeholder="t('orchestration.pool.thinkingDefault')"
          :help="thinkingHint"
          testid="orchestration-pool-thinking"
        />
        <AppTextField
          v-model="form.tagsText"
          :label="t('orchestration.pool.tags')"
          :help="t('orchestration.pool.listHelp')"
          testid="orchestration-pool-tags"
        />
        <AppTextField
          v-model="form.specialtiesText"
          :label="t('orchestration.pool.specialties')"
          :help="t('orchestration.pool.specialtiesHelp')"
          testid="orchestration-pool-specialties"
        />
        <AppTextField
          v-model="form.description"
          :label="t('orchestration.pool.description')"
          multiline
          :rows="3"
          :help="t('orchestration.pool.descriptionHelp')"
          required
          testid="orchestration-pool-description"
        />
        <div class="orch-pool-switches">
          <Toggle
            v-model="form.canOrchestrate"
            :label="t('orchestration.pool.canOrchestrate')"
            data-testid="orchestration-pool-can-orchestrate"
          />
          <Toggle
            v-model="form.enabled"
            :label="t('orchestration.pool.enabled')"
            data-testid="orchestration-pool-enabled"
          />
        </div>
        <p
          v-if="formError"
          class="orch-pool-form-error"
          role="alert"
          data-testid="orchestration-pool-form-error"
        >
          {{ formError }}
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button type="button" class="wb-btn-ghost" @click="editorOpen = false">
            {{ t('orchestration.pool.cancel') }}
          </button>
          <button
            type="button"
            class="wb-btn-primary"
            :disabled="saving"
            data-testid="orchestration-pool-save"
            @click="save"
          >
            {{ saving ? t('orchestration.pool.saving') : t('orchestration.pool.save') }}
          </button>
        </div>
      </template>
    </PluginModal>

    <PluginModal
      :model-value="!!deleteTarget"
      :title="t('orchestration.pool.deleteTitle')"
      size="sm"
      @update:model-value="(open: boolean) => !open && (deleteTarget = null)"
    >
      <p class="orch-pool-delete-copy">
        {{ t('orchestration.pool.deleteConfirm', { name: deleteTarget?.name ?? '' }) }}
      </p>
      <p
        v-if="deleteError"
        class="orch-pool-form-error"
        role="alert"
        data-testid="orchestration-pool-delete-error"
      >
        {{ deleteError }}
      </p>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button type="button" class="wb-btn-ghost" @click="deleteTarget = null">
            {{ t('orchestration.pool.cancel') }}
          </button>
          <button
            type="button"
            class="orch-pool-btn-danger"
            :disabled="deleting"
            data-testid="orchestration-pool-delete-confirm"
            @click="confirmDelete"
          >
            {{ t('orchestration.pool.delete') }}
          </button>
        </div>
      </template>
    </PluginModal>
  </div>
</template>

<style scoped>
.orch-pool {
  padding: 18px 20px 26px;
}

.orch-pool-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.orch-pool-sub {
  margin-top: 6px;
  font-size: var(--font-size-tag);
  color: var(--text-tertiary);
  max-width: 62ch;
}

.orch-pool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.orch-pool-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 190px;
}

.orch-pool-card-disabled {
  opacity: 0.72;
}

.orch-pool-card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.orch-pool-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  flex: none;
}

.orch-pool-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.orch-pool-name {
  font-weight: 600;
  font-size: var(--font-size-base);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.orch-pool-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
  font-size: var(--font-size-tag);
  color: var(--text-tertiary);
}

.orch-pool-desc {
  font-size: var(--font-size-tag);
  line-height: 1.55;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.orch-pool-chips {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.orch-pool-chips-label {
  font-size: var(--font-size-tag);
  color: var(--text-tertiary);
  margin-right: 2px;
}

.orch-pool-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--font-size-tag);
  line-height: 1.6;
  white-space: nowrap;
}

.orch-pool-tag-muted {
  color: var(--text-tertiary);
  background: transparent;
}

.orch-pool-tag-accent {
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
  background: var(--color-primary-light);
}

.orch-pool-tag-warn {
  color: var(--color-warning-ink);
  border-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
  background: var(--color-warning-light);
}

.orch-pool-tag-action {
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s;
}

.orch-pool-tag-action:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.orch-pool-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

.orch-pool-danger {
  color: var(--color-danger-ink);
  margin-left: auto;
}

.orch-pool-empty {
  padding: 48px 12px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-base);
}

.orch-pool-empty-hint {
  margin-top: 6px;
  font-size: var(--font-size-tag);
}

.orch-pool-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.orch-pool-form-hint,
.orch-pool-form-error {
  margin-top: 4px;
  font-size: var(--font-size-tag);
}

.orch-pool-form-hint {
  color: var(--text-tertiary);
}

.orch-pool-form-error {
  color: var(--color-danger-ink);
}

.orch-pool-switches {
  display: flex;
  gap: 22px;
  flex-wrap: wrap;
}

.orch-pool-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}

.orch-pool-delete-copy {
  font-size: var(--font-size-base);
  color: var(--text-secondary);
  line-height: 1.6;
}

.orch-pool-surface {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 14px 16px;
}

.orch-pool-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
  border: 1px solid color-mix(in srgb, var(--color-info) 30%, transparent);
  border-radius: var(--radius-card);
  background: var(--color-info-light);
  color: var(--text-secondary);
  font-size: var(--font-size-tag);
}

.orch-pool-banner-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-info);
  color: var(--color-primary-contrast);
  font-size: 11px;
  font-weight: 600;
  flex: none;
}

.orch-pool-banner-text {
  flex: 1;
  min-width: 0;
}

.orch-pool-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: var(--font-size-tag);
  line-height: 1.6;
  white-space: nowrap;
}

.orch-pool-status.ok {
  color: var(--color-success-ink);
  border-color: color-mix(in srgb, var(--color-success) 35%, transparent);
  background: var(--color-success-light);
}

.orch-pool-status.warn {
  color: var(--color-warning-ink);
  border-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
  background: var(--color-warning-light);
}

.orch-pool-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.orch-pool-status.ok .orch-pool-dot {
  background: var(--color-success);
}

.orch-pool-status.warn .orch-pool-dot {
  background: var(--color-warning);
}

.orch-pool-btn-sm {
  height: 26px;
  padding: 0 10px;
  font-size: var(--font-size-tag);
}

.orch-pool-btn-danger {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-button);
  background: var(--color-danger);
  color: var(--color-primary-contrast);
  font: inherit;
  font-size: var(--font-size-base);
  cursor: pointer;
}

.orch-pool-btn-danger:disabled {
  opacity: 0.55;
  cursor: default;
}
.orch-pool-banner-warn {
  border-color: color-mix(in srgb, var(--color-danger) 35%, transparent);
  background: var(--color-danger-light);
}

.orch-pool-banner-warn .orch-pool-banner-icon {
  background: var(--color-danger);
}
</style>
