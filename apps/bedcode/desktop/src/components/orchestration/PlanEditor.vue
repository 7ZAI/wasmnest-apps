<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppNumberField from '@/components/ui/AppNumberField.vue'
import AppSelectField from '@/components/ui/AppSelectField.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import { useAppI18n } from '@/composables/useAppI18n'
import type { AgentProfileView } from '@/composables/orchestration/types'
import type { Plan, PlanError, PlanNode } from '@/utils/orchestrationPlan'

const props = defineProps<{
  plan: Plan
  agentProfiles: AgentProfileView[]
  errors: PlanError[]
  disabled?: boolean
}>()
const emit = defineEmits<{ save: [plan: Plan]; cancel: [] }>()
const t = useAppI18n()

const roleOptions = computed(() =>
  ['planner', 'coder', 'reviewer', 'observer', 'custom'].map((role) => ({
    value: role,
    label: t(`orchestration.role.${role}`),
  })),
)
const agentOptions = computed(() =>
  props.agentProfiles.map((profile) => {
    const suffix = [profile.cli, profile.model, profile.thinkingLevel]
      .filter((value) => !!value)
      .join(' · ')
    const ready = profile.enabled && profile.ready
    const orchestratable = ready && profile.orchestratable
    const stateLabel = !profile.enabled
      ? t('orchestration.agent.disabled')
      : !profile.ready
        ? t('orchestration.agent.notReady')
        : !profile.orchestratable
          ? t('orchestration.agent.noBridge')
          : ''
    return {
      value: profile.id,
      label: `${profile.name}${suffix ? ` · ${suffix}` : ''}${stateLabel ? ` (${stateLabel})` : ''}`,
      disabled: !orchestratable,
    }
  }),
)
const acceptanceOptions = computed(() => [
  { value: 'none', label: t('orchestration.planEditor.acceptanceNone') },
  { value: 'command', label: t('orchestration.planEditor.acceptanceCommand') },
  { value: 'verdict', label: t('orchestration.planEditor.acceptanceVerdict') },
])

const draft = ref<Plan>(clone(props.plan))
const dirty = ref(false)
let resetting = false
watch(
  draft,
  () => {
    if (!resetting) dirty.value = true
  },
  // sync：程序回填必须在 `resetting` 仍为 true 时被消费，pre flush 会把
  // watcher 排到下一拍，那时标志已复位 → dirty 永真（M28）。
  { deep: true, flush: 'sync' },
)
watch(
  () => props.plan,
  (value) => {
    // 详情页 1s 轮询会换新对象；编辑中不得用服务端快照覆盖用户输入。
    if (dirty.value) return
    resetting = true
    draft.value = clone(value)
    dirty.value = false
    resetting = false
  },
  { deep: true },
)

const maxParallel = computed({
  get: () => draft.value.maxParallel,
  set: (value: number | null) => {
    if (value !== null) draft.value.maxParallel = value
  },
})

function clone(plan: Plan): Plan {
  return JSON.parse(JSON.stringify(plan)) as Plan
}

/** 与 Rust 计划校验同源：1..=20 节点、key 匹配 [a-z0-9-]{1,32}、不得重名 */
const MAX_PLAN_NODES = 20
const NODE_KEY_RE = /^[a-z0-9-]{1,32}$/
const keyError = ref<string | null>(null)

function nextKey(): string {
  const used = new Set(draft.value.nodes.map((node) => node.key))
  let index = draft.value.nodes.length + 1
  while (used.has(`n${index}`)) index += 1
  return `n${index}`
}

function addNode() {
  if (draft.value.nodes.length >= MAX_PLAN_NODES) return
  keyError.value = null
  const key = nextKey()
  draft.value.nodes.push({
    key,
    title: '',
    role: 'coder',
    agentRef:
      props.agentProfiles.find(
        (profile) => profile.enabled && profile.ready && profile.orchestratable,
      )?.id ?? '',
    agent: null,
    matchReason: '',
    prompt: '',
    dependsOn: [],
    writeScope: [],
    acceptance: { type: 'none' },
    maxAttempts: 1,
  })
}

function removeNode(index: number) {
  const [removed] = draft.value.nodes.splice(index, 1)
  if (!removed) return
  for (const node of draft.value.nodes) {
    node.dependsOn = node.dependsOn.filter((dep) => dep !== removed.key)
  }
}

function renameNode(index: number, nextKey: string) {
  const previous = draft.value.nodes[index]?.key
  if (!previous || !nextKey || nextKey === previous) return
  // 本地重复 key 会破坏依赖 chip 与 workflowLayout，等后端报错太晚（M30）。
  if (!NODE_KEY_RE.test(nextKey)) {
    keyError.value = errorLabel('invalid-node-key')
    return
  }
  if (draft.value.nodes.some((node, i) => i !== index && node.key === nextKey)) {
    keyError.value = errorLabel('duplicate-node-key')
    return
  }
  keyError.value = null
  draft.value.nodes[index].key = nextKey
  for (const node of draft.value.nodes) {
    node.dependsOn = node.dependsOn.map((dep) => (dep === previous ? nextKey : dep))
  }
}

function toggleDependency(node: PlanNode, key: string) {
  if (node.key === key) return
  if (node.dependsOn.includes(key)) {
    node.dependsOn = node.dependsOn.filter((dep) => dep !== key)
  } else {
    node.dependsOn = [...node.dependsOn, key]
  }
}

function scopeText(node: PlanNode): string {
  return node.writeScope.join('\n')
}

function setScope(node: PlanNode, value: string) {
  node.writeScope = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function commandText(node: PlanNode): string {
  return node.acceptance.type === 'command' ? node.acceptance.command.join(' ') : ''
}

function setCommand(node: PlanNode, value: string) {
  if (node.acceptance.type !== 'command') return
  node.acceptance.command = value.split(/\s+/).filter(Boolean)
}

function setAcceptanceType(node: PlanNode, type: string) {
  if (type === 'command') {
    node.acceptance = { type: 'command', command: [], cwd: null, timeoutSec: null }
  } else if (type === 'verdict') {
    node.acceptance = { type: 'verdict', timeoutSec: null }
  } else {
    node.acceptance = { type: 'none' }
  }
}

function setOptionalNumber(node: PlanNode, value: number | null) {
  if (node.acceptance.type === 'none') return
  node.acceptance.timeoutSec = value && value > 0 ? value : null
}

function setCwd(node: PlanNode, value: string) {
  if (node.acceptance.type !== 'command') return
  node.acceptance.cwd = value.trim() ? value : null
}

function setAttempts(node: PlanNode, value: number | null) {
  if (value !== null) node.maxAttempts = value
}

function setRole(node: PlanNode, value: string | number) {
  node.role = String(value) as PlanNode['role']
}

function save() {
  emit('save', clone(draft.value))
}

function errorLabel(code: string): string {
  const key = `orchestration.planError.${code}`
  const text = t(key)
  return text === key ? code : text
}
</script>

<template>
  <div
    class="rounded-card border border-[var(--border)] bg-[var(--bg-card)] p-4"
    data-testid="orchestration-plan-editor"
  >
    <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
      <AppTextField
        v-model="draft.title"
        :label="t('orchestration.create.name')"
        testid="orchestration-plan-title"
      />
      <AppNumberField
        v-model="maxParallel"
        :label="t('orchestration.planEditor.maxParallel')"
        :min="1"
        :max="4"
        testid="orchestration-plan-max-parallel"
        :decrease-label="t('orchestration.planEditor.decrease')"
        :increase-label="t('orchestration.planEditor.increase')"
      />
      <AppTextField
        v-model="draft.goal"
        class="md:col-span-2"
        :label="t('orchestration.create.goal')"
        testid="orchestration-plan-goal"
        multiline
        :rows="2"
      />
    </div>

    <p
      v-if="keyError"
      class="mt-2 text-[calc(11px*var(--ui-scale))] text-[var(--color-danger-ink)]"
      role="alert"
      data-testid="orchestration-plan-key-error"
    >
      {{ keyError }}
    </p>

    <div class="mt-4 space-y-3">
      <div
        v-for="(node, index) in draft.nodes"
        :key="index"
        class="rounded-btn border border-[var(--border)] bg-[var(--bg-page)] p-3"
      >
        <div class="flex items-center gap-2">
          <span
            class="wb-mono rounded-tag border border-[var(--border)] bg-[var(--bg-card)] px-1.5 py-0.5 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
            >#{{ index + 1 }}</span
          >
          <span class="flex-1"></span>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded-btn text-[var(--text-tertiary)] transition-colors hover:bg-[var(--color-danger-light)] hover:text-[var(--color-danger-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            :aria-label="t('orchestration.planEditor.removeNode')"
            :title="t('orchestration.planEditor.removeNode')"
            data-testid="orchestration-plan-node-remove"
            :disabled="draft.nodes.length <= 1"
            @click="removeNode(index)"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>

        <div class="mt-2 flex flex-wrap gap-2">
          <AppTextField
            class="w-28 shrink-0"
            :model-value="node.key"
            :label="t('orchestration.planEditor.nodeKey')"
            testid="orchestration-plan-node-key"
            commit-on-change
            @update:model-value="renameNode(index, $event)"
          />
          <AppTextField
            v-model="node.title"
            class="min-w-48 flex-1"
            :label="t('orchestration.planEditor.nodeTitle')"
            :placeholder="t('orchestration.planEditor.nodeTitle')"
            testid="orchestration-plan-node-title"
          />
        </div>

        <div class="mt-2 grid gap-2 md:grid-cols-2">
          <AppSelectField
            :model-value="node.role"
            :label="t('orchestration.planEditor.nodeRole')"
            :options="roleOptions"
            @update:model-value="(value) => setRole(node, value)"
          />
          <AppSelectField
            :model-value="node.agentRef"
            :label="t('orchestration.planEditor.nodeAgent')"
            :options="agentOptions"
            testid="orchestration-plan-node-agent"
            @update:model-value="(value) => (node.agentRef = String(value))"
          />
        </div>

        <AppTextField
          v-model="node.matchReason"
          class="mt-2"
          :label="t('orchestration.planEditor.nodeMatchReason')"
          :placeholder="t('orchestration.planEditor.matchReasonPlaceholder')"
          testid="orchestration-plan-node-match-reason"
        />

        <AppTextField
          v-model="node.prompt"
          class="mt-2"
          :label="t('orchestration.planEditor.nodePrompt')"
          :placeholder="t('orchestration.planEditor.nodePrompt')"
          testid="orchestration-plan-node-prompt"
          multiline
          :rows="2"
        />

        <div class="mt-2 grid gap-2 md:grid-cols-2">
          <div class="min-w-0">
            <span
              class="text-[calc(11.5px*var(--ui-scale))] font-medium tracking-[0.01em] text-[var(--text-secondary)]"
              >{{ t('orchestration.planEditor.nodeDeps') }}</span
            >
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              <template v-for="other in draft.nodes" :key="other.key">
                <button
                  v-if="other.key !== node.key"
                  type="button"
                  class="wb-mono rounded-tag border px-1.5 py-0.5 text-[calc(11px*var(--ui-scale))] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  :class="
                    node.dependsOn.includes(other.key)
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                      : 'border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                  "
                  :aria-pressed="node.dependsOn.includes(other.key)"
                  @click="toggleDependency(node, other.key)"
                >
                  {{ other.key }}
                </button>
              </template>
              <span
                v-if="draft.nodes.length <= 1"
                class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
                >—</span
              >
            </div>
          </div>
          <AppTextField
            :model-value="scopeText(node)"
            :label="t('orchestration.planEditor.nodeScope')"
            :placeholder="t('orchestration.planEditor.scopeHint')"
            testid="orchestration-plan-node-scope"
            commit-on-change
            multiline
            :rows="2"
            @update:model-value="setScope(node, $event)"
          />
        </div>

        <div class="mt-2 grid gap-2 md:grid-cols-2">
          <AppSelectField
            :model-value="node.acceptance.type"
            :label="t('orchestration.planEditor.nodeAcceptance')"
            :options="acceptanceOptions"
            testid="orchestration-plan-node-acceptance"
            @update:model-value="(value) => setAcceptanceType(node, String(value))"
          />
          <AppNumberField
            :model-value="node.maxAttempts"
            :label="t('orchestration.planEditor.maxAttempts')"
            :min="1"
            :max="3"
            :decrease-label="t('orchestration.planEditor.decrease')"
            :increase-label="t('orchestration.planEditor.increase')"
            @update:model-value="setAttempts(node, $event)"
          />
        </div>

        <div v-if="node.acceptance.type === 'command'" class="mt-2 grid gap-2 md:grid-cols-3">
          <AppTextField
            :model-value="commandText(node)"
            :label="t('orchestration.planEditor.command')"
            commit-on-change
            @update:model-value="setCommand(node, $event)"
          />
          <AppTextField
            :model-value="node.acceptance.cwd ?? ''"
            :label="t('orchestration.planEditor.cwd')"
            commit-on-change
            @update:model-value="setCwd(node, $event)"
          />
          <AppNumberField
            :model-value="node.acceptance.timeoutSec ?? null"
            :label="t('orchestration.planEditor.timeout')"
            :min="1"
            allow-empty
            :decrease-label="t('orchestration.planEditor.decrease')"
            :increase-label="t('orchestration.planEditor.increase')"
            @update:model-value="setOptionalNumber(node, $event)"
          />
        </div>
      </div>
    </div>

    <div
      v-if="errors.length"
      class="mt-3 rounded-card border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[var(--color-danger-light)] p-3"
      data-testid="orchestration-plan-errors"
    >
      <div
        class="flex items-center gap-1.5 text-[calc(11px*var(--ui-scale))] font-medium text-[var(--color-danger-ink)]"
      >
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M12 9v4m0 4h.01M10.3 3.9L2.6 17a1.5 1.5 0 001.3 2.2h16.2a1.5 1.5 0 001.3-2.2L13.7 3.9a1.5 1.5 0 00-2.6 0z"
          />
        </svg>
        {{ t('orchestration.planEditor.errors') }}
      </div>
      <ul class="mt-1.5 space-y-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-primary)]">
        <li v-for="(error, index) in errors" :key="index">
          <span class="wb-mono">{{ error.nodeKey ? `${error.nodeKey}: ` : '' }}</span>
          {{ errorLabel(error.code) }}
          <span class="text-[var(--text-tertiary)]">— {{ error.message }}</span>
        </li>
      </ul>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        class="wb-btn-ghost"
        data-testid="orchestration-plan-add-node"
        :disabled="draft.nodes.length >= MAX_PLAN_NODES"
        @click="addNode"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M12 4v16m8-8H4"
          />
        </svg>
        {{ t('orchestration.planEditor.addNode') }}
      </button>
      <span class="flex-1"></span>
      <button class="wb-btn-ghost" @click="emit('cancel')">
        {{ t('orchestration.planEditor.cancel') }}
      </button>
      <button
        class="wb-btn-primary"
        :disabled="disabled"
        data-testid="orchestration-plan-save"
        @click="save"
      >
        {{ t('orchestration.planEditor.save') }}
      </button>
    </div>
  </div>
</template>
