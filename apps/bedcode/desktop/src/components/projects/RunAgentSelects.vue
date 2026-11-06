<template>
  <!-- 模型：运行内切换（后端 `run.agent.set`，不重启、不丢上下文）。
       取不到清单时只回显当前模型；能力不可用时禁用并把原因放进 title。 -->
  <select
    v-if="showModel"
    class="h-6 min-w-0 shrink rounded-[6px] px-1.5 cursor-pointer wb-mono bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
    :class="
      compact
        ? 'max-w-[128px] text-[calc(10px*var(--ui-scale))]'
        : 'max-w-[190px] text-[calc(11px*var(--ui-scale))]'
    "
    :value="currentModelValue"
    :disabled="!modelSwitchable || busy"
    :title="modelSwitchTitle"
    :data-testid="compact ? 'run-tile-model' : 'agent-model-select'"
    @change="onModelChange"
    @mousedown.stop
    @click.stop
  >
    <option v-if="modelOptions.length === 0" :value="currentModelValue">
      {{ currentModelValue || t('project.agent.modelNone') }}
    </option>
    <option v-for="option in modelOptions" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>

  <!-- 思考等级：无独立等级的 agent（opencode）不渲染，避免摆一个永远空的控件 -->
  <select
    v-if="thinkingLevels.length > 0"
    class="h-6 min-w-0 shrink rounded-[6px] px-1.5 cursor-pointer wb-mono bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
    :class="
      compact
        ? 'max-w-[84px] text-[calc(10px*var(--ui-scale))]'
        : 'text-[calc(11px*var(--ui-scale))]'
    "
    :value="currentThinkingValue"
    :disabled="!thinkingSwitchable || busy"
    :title="thinkingSwitchTitle"
    :data-testid="compact ? 'run-tile-thinking' : 'agent-thinking-select'"
    @change="onThinkingChange"
    @mousedown.stop
    @click.stop
  >
    <option v-if="!currentThinkingValue" value="">
      {{ t('project.agent.thinkingNone') }}
    </option>
    <option v-for="level in thinkingLevels" :key="level" :value="level">
      {{ level }}
    </option>
  </select>
</template>

<script setup lang="ts">
/**
 * 运行内 agent 控制下拉（模型 / 思考等级）
 *
 * 单屏终端 header 与拼屏每格 header 共用：控制项属于**运行**，拼屏后不属于全局
 * 工具栏。组件自己取 `run.agent.options`、自己调 `run.agent.set`，成功后只发
 * `changed` 让视图重取运行列表（模型 / 思考等级经上行 meta 回填）。
 *
 * `compact` = 拼屏格子里的窄版（更小字号与宽度）；testid 也按模式区分：
 * 单屏保持 `agent-model-select` / `agent-thinking-select`（既有 E2E 锚点），
 * 拼屏用 `run-tile-model` / `run-tile-thinking`。
 */
import { computed, inject, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { isLiveRun, type RunView } from '@/composables/useProjects'
import { useRunAgentControl } from '@/composables/projects/useRunAgentControl'
import { resolvePluginErrorText } from '@/utils/pluginError'

const props = withDefaults(defineProps<{ run: RunView; compact?: boolean }>(), {
  compact: false,
})

const emit = defineEmits<{ changed: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const control = useRunAgentControl(context)
const options = control.options
const busy = control.isApplying

/** 能力不可用的原因 → 文案（后端只给结构化 reason，文案归前端） */
const AGENT_REASON_KEY: Record<string, string> = {
  'run-ended': 'project.agent.reason.runEnded',
  'agent-unsupported': 'project.agent.reason.agentUnsupported',
  'bridge-offline': 'project.agent.reason.bridgeOffline',
  'no-pty': 'project.agent.reason.noPty',
  'codex-update-required': 'project.agent.reason.codexUpdateRequired',
  'thinking-unsupported': 'project.agent.reason.thinkingUnsupported',
  'model-unknown': 'project.agent.reason.modelUnknown',
  'level-unknown': 'project.agent.reason.levelUnknown',
  'invalid-value': 'project.agent.reason.invalidValue',
}

function capabilityTitle(
  capability: { supported: boolean; reason: string | null; message: string | null } | null,
): string {
  if (!capability) return ''
  if (capability.supported) return t('project.agent.switchHint')
  const key = AGENT_REASON_KEY[capability.reason ?? '']
  return key ? t(key) : (capability.message ?? '')
}

const live = computed(() => isLiveRun(props.run.status))

const modelOptions = computed(() => {
  const listed = options.value?.models ?? []
  if (listed.length > 0) return listed
  const current = props.run.model
  return current ? [{ value: current, label: current, source: 'current' }] : []
})

/** 存活运行即使还没有模型清单也要给下拉（禁用 + 原因），不静默隐藏能力事实 */
const showModel = computed(() => modelOptions.value.length > 0 || live.value)
const thinkingLevels = computed(() => options.value?.thinkingLevels ?? [])
const currentModelValue = computed(() => options.value?.current.model ?? props.run.model ?? '')
const currentThinkingValue = computed(() => options.value?.current.thinkingLevel ?? '')
const modelSwitchable = computed(
  () => live.value && (options.value?.capabilities.model.supported ?? false),
)
const thinkingSwitchable = computed(
  () => live.value && (options.value?.capabilities.thinking.supported ?? false),
)
const modelSwitchTitle = computed(() => capabilityTitle(options.value?.capabilities.model ?? null))
const thinkingSwitchTitle = computed(() =>
  capabilityTitle(options.value?.capabilities.thinking ?? null),
)

/**
 * 取控制项：失败只记日志（下拉保持禁用态），不打断工作台。
 *
 * 依赖 `bridgeConnected`：运行刚启动时桥接还没心跳（能力判为 bridge-offline），
 * 心跳到达后要重新取一次，否则下拉会一直灰着。
 */
watch(
  () => ({
    runId: props.run.id,
    bridge: props.run.bridgeConnected,
    model: props.run.model,
  }),
  (next) => {
    void loadFor(next.runId)
  },
  { immediate: true },
)

async function loadFor(runId: string): Promise<void> {
  try {
    await control.load(runId)
  } catch (e) {
    console.warn('[RunAgentSelects] load agent control failed:', e)
  }
}

async function onModelChange(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  if (!value) return
  try {
    await control.setModel(props.run.id, value)
    // 桥接通道的真实模型经上行 meta 回填，交给视图重取运行列表
    emit('changed')
  } catch (e) {
    console.error('[RunAgentSelects] set model failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.agent.setFailed'))
    await loadFor(props.run.id)
    // M31：失败后 load 拿回同一个 current，Vue 不 patch 原生 select →
    // 显式回写，界面不能停在未生效的选项上。
    const target = event.target as HTMLSelectElement
    if (target.value !== currentModelValue.value) target.value = currentModelValue.value
  }
}

async function onThinkingChange(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  if (!value) return
  try {
    await control.setThinking(props.run.id, value)
    emit('changed')
  } catch (e) {
    console.error('[RunAgentSelects] set thinking level failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.agent.setFailed'))
    await loadFor(props.run.id)
    const target = event.target as HTMLSelectElement
    if (target.value !== currentThinkingValue.value) target.value = currentThinkingValue.value
  }
}
</script>
