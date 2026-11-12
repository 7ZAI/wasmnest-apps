<script setup lang="ts">
import { computed, inject, onActivated, onDeactivated, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import AgentBadge from '@/components/orchestration/AgentBadge.vue'
import AgentParticipants from '@/components/orchestration/AgentParticipants.vue'
import EvidencePanel from '@/components/orchestration/EvidencePanel.vue'
import ExecutionPipeline from '@/components/orchestration/ExecutionPipeline.vue'
import NodeCard from '@/components/orchestration/NodeCard.vue'
import OrchestrationTimeline from '@/components/orchestration/OrchestrationTimeline.vue'
import PlanEditor from '@/components/orchestration/PlanEditor.vue'
import StatusBadge from '@/components/orchestration/StatusBadge.vue'
import WorkflowGraph from '@/components/orchestration/WorkflowGraph.vue'
import {
  reasonKey,
  useOrchestrations,
  type OrchestrationsApi,
} from '@/composables/orchestration/useOrchestrations'
import { useOrchestrationPolling } from '@/composables/orchestration/useOrchestrationPolling'
import {
  isTerminalStatus,
  type ActionView,
  type EventView,
  type MetaView,
  type NodeView,
  type OrchestrationView,
} from '@/composables/orchestration/types'
import { useAppI18n } from '@/composables/useAppI18n'
import { useToast } from '@/composables/useToast'
import { emptyPlan, type Plan } from '@/utils/orchestrationPlan'
import { resolvePluginErrorText } from '@/utils/pluginError'

const context = inject<PluginContext>('pluginContext')!
const t = useAppI18n()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const api: OrchestrationsApi = useOrchestrations(context)

const id = computed(() => String(route.params.id ?? ''))
const meta = ref<MetaView | null>(null)
const view = ref<OrchestrationView | null>(null)
const events = ref<EventView[]>([])
const now = ref(Date.now())
const loading = ref(true)
const loadError = ref<string | null>(null)
const eventsTruncated = ref(false)
const actionBusy = ref(false)

const EVENTS_PAGE = 500
const EVENTS_MAX_PAGES = 20
let eventCursor = 0
let eventsOwner = ''
let refreshing = false
let failures = 0
let pageActive = true
let booted = false

const selectedKey = ref('')
const selectedAgent = ref('')
const editingPlan = ref(false)
const savingPlan = ref(false)

const detail = computed(() => view.value?.orchestration ?? null)
const nodes = computed(() => view.value?.nodes ?? [])
const visibleNodes = computed(() =>
  selectedAgent.value
    ? nodes.value.filter((node) => (node.agentRef || node.agentId) === selectedAgent.value)
    : nodes.value,
)
const agentProfiles = computed(() => meta.value?.agentProfiles ?? [])
const selectedAgentDisplay = computed(() => {
  const profile = agentProfiles.value.find((entry) => entry.id === selectedAgent.value)
  return {
    cli: profile?.cli ?? 'unknown',
    name: profile?.name ?? selectedAgent.value,
  }
})
const orchestratorName = computed(() => {
  const id = detail.value?.orchestratorAgentId
  if (!id) return t('orchestration.detail.noOrchestrator')
  return agentProfiles.value.find((entry) => entry.id === id)?.name ?? id
})
const plan = computed<Plan | null>(() => view.value?.plan ?? null)
const planForEditor = computed<Plan>(
  () => plan.value ?? emptyPlan(detail.value?.title ?? '', detail.value?.goal ?? ''),
)
const planErrors = computed(() => view.value?.orchestration.planError ?? [])
const orchestrationActions = computed(() => view.value?.actions.orchestration ?? [])
const showEditor = computed(
  () =>
    editingPlan.value ||
    (!plan.value && !!detail.value && ['draft', 'awaiting-approval'].includes(detail.value.status)),
)
const goalText = computed(() => detail.value?.goal?.trim() ?? '')
const primaryAction = computed(() =>
  orchestrationActions.value.find((action) => ['approve', 'start', 'resume'].includes(action.kind)),
)
const primaryHint = computed(() => {
  const action = primaryAction.value
  return action && !action.enabled && action.reason ? t(reasonKey(action.reason)) : ''
})
const budgetText = computed(() =>
  detail.value
    ? t('orchestration.detail.budgetValue', {
        dispatches: detail.value.budget.maxDispatches,
        seconds: detail.value.budget.maxWallSeconds,
      })
    : '',
)

const polling = useOrchestrationPolling({
  load: () => refresh({ quiet: true }),
  intervalMs: 1000,
})

/** 按 seq 合并增量批次：同一批重复 seq 以服务端新值为准。 */
function mergeEvents(current: EventView[], incoming: EventView[]): EventView[] {
  if (!incoming.length) return current
  const bySeq = new Map<number, EventView>(current.map((event) => [event.seq, event]))
  for (const event of incoming) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

/**
 * 事件增量拉取：首帧 afterSeq=0，其后用上一批 nextSeq；命中单页上限继续翻页。
 * 全量 `events(id, 0)` 在 >500 条后被 `ORDER BY seq ASC LIMIT` 静默截断，
 * 最新事件永远进不了时间线（H8）。
 */
async function loadEvents(reset: boolean) {
  const owner = id.value
  if (reset || eventsOwner !== owner) {
    eventsOwner = owner
    eventCursor = 0
    events.value = []
  }
  eventsTruncated.value = false
  let cursor = eventCursor
  for (let page = 0; page < EVENTS_MAX_PAGES; page += 1) {
    if (!pageActive) return
    const batch = await api.events(owner, cursor, EVENTS_PAGE)
    const batchEvents = batch.events ?? []
    events.value = mergeEvents(events.value, batchEvents)
    const next = batch.nextSeq ?? cursor
    if (batchEvents.length < EVENTS_PAGE || next <= cursor) {
      eventCursor = cursor
      return
    }
    cursor = next
  }
  eventCursor = cursor
  // 显性提示，绝不把截断伪装成完整时间线
  eventsTruncated.value = true
  console.warn(`[orchestration] events timeline truncated after ${EVENTS_MAX_PAGES} pages`)
}

async function refresh(options: { quiet?: boolean } = {}): Promise<boolean> {
  if (!id.value) return false
  if (refreshing) return !!detail.value && isTerminalStatus(detail.value.status)
  refreshing = true
  try {
    const [loadedView, loadedMeta] = await Promise.all([
      api.get(id.value),
      meta.value ? Promise.resolve(meta.value) : api.meta(),
    ])
    view.value = loadedView
    meta.value = loadedMeta
    await loadEvents(false)
    if (!pageActive) return false
    now.value = Date.now()
    failures = 0
    loadError.value = null
    return !!detail.value && isTerminalStatus(detail.value.status)
  } catch (error) {
    failures += 1
    const text = resolvePluginErrorText(context, error, 'orchestration.detail.loadFailed')
    loadError.value = text
    // 轮询每秒失败一次：只在首次失败弹 toast，之后保留持久错误条（避免提示风暴）
    if (!options.quiet || failures === 1) {
      console.error('[orchestration] detail load failed', error)
      toast.error(text)
    }
    return false
  } finally {
    refreshing = false
    loading.value = false
  }
}

function actionOf(kind: string): ActionView | undefined {
  return orchestrationActions.value.find((action) => action.kind === kind)
}

function actionHint(kind: string): string {
  const reason = actionOf(kind)?.reason
  return reason ? t(reasonKey(reason)) : ''
}

function modeLabel(mode: string): string {
  const key = `orchestration.mode.${mode}`
  const text = t(key)
  return text === key ? mode : text
}

/**
 * 动作按钮的视觉优先级：推进流程 / 恢复 = 主按钮，取消 = 危险动作，其余 = ghost。
 * `!` 前缀用于覆盖宿主 `.wb-btn-ghost` 的边框与文字色（同在单类选择器权重）。
 */
function actionClass(action: ActionView): string {
  if (action.kind === 'cancel') {
    return 'wb-btn-ghost !border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] !text-[var(--color-danger-ink)] hover:!bg-[var(--color-danger-light)]'
  }
  if (['approve', 'start', 'resume'].includes(action.kind)) return 'wb-btn-primary'
  return 'wb-btn-ghost'
}

async function runAction(kind: string) {
  if (!detail.value || actionBusy.value) return
  actionBusy.value = true
  try {
    switch (kind) {
      case 'edit-plan':
        editingPlan.value = true
        return
      case 'approve':
        await api.approve(id.value)
        break
      case 'start':
        await api.start(id.value)
        break
      case 'pause':
        await api.pause(id.value)
        break
      case 'resume':
        await api.resume(id.value)
        break
      case 'cancel':
        await api.cancel(id.value)
        break
      case 'replan':
        await api.plan(id.value, detail.value.orchestratorAgentId ?? undefined)
        break
      default:
        return
    }
    await refresh()
  } catch (error) {
    console.error(`[orchestration] ${kind} failed`, error)
    toast.error(resolvePluginErrorText(context, error, 'orchestration.detail.actionFailed'))
  } finally {
    actionBusy.value = false
  }
}

function nodeActions(node: NodeView): ActionView[] {
  return view.value?.actions.nodes.find((entry) => entry.nodeKey === node.key)?.actions ?? []
}

async function retryNode(nodeKey: string) {
  try {
    await api.retryNode(id.value, nodeKey)
    await refresh()
  } catch (error) {
    console.error('[orchestration] retry failed', error)
    toast.error(resolvePluginErrorText(context, error, 'orchestration.detail.actionFailed'))
  }
}

async function skipNode(nodeKey: string) {
  try {
    await api.skipNode(id.value, nodeKey)
    await refresh()
  } catch (error) {
    console.error('[orchestration] skip failed', error)
    toast.error(resolvePluginErrorText(context, error, 'orchestration.detail.actionFailed'))
  }
}

async function openTerminal(runId: string, node?: NodeView) {
  try {
    await context.session.openTerminal({
      id: runId,
      name: node && detail.value ? `${detail.value.title} · ${node.title}` : runId,
    })
  } catch (error) {
    console.error('[orchestration] open terminal failed', error)
    toast.error(resolvePluginErrorText(context, error, 'orchestration.detail.actionFailed'))
  }
}

async function savePlan(planToSave: Plan) {
  savingPlan.value = true
  try {
    const receipt = await api.updatePlan(id.value, planToSave)
    await refresh()
    if (!receipt.planError?.length) editingPlan.value = false
  } catch (error) {
    console.error('[orchestration] update plan failed', error)
    toast.error(resolvePluginErrorText(context, error, 'orchestration.detail.actionFailed'))
  } finally {
    savingPlan.value = false
  }
}

function back() {
  void router.push('/orchestrations')
}

function selectNode(key: string) {
  selectedKey.value = selectedKey.value === key ? '' : key
}

function actionLabel(action: ActionView): string {
  if (action.kind === 'replan' && !plan.value) return t('orchestration.detail.generatePlan')
  return t(`orchestration.action.${action.kind}`)
}

function selectAgent(agentId: string) {
  selectedAgent.value = selectedAgent.value === agentId ? '' : agentId
}

onMounted(async () => {
  // 首屏失败也必须启动轮询（旧实现只在 detail 存在时启动，失败一次就再也不恢复）
  const done = await refresh()
  if (!done && pageActive) polling.start()
})

// KeepAlive 切走后 1s 轮询仍在后台发命令；回来时也不会因终态被跳过（H7）。
onActivated(async () => {
  pageActive = true
  if (!booted) {
    booted = true
    return
  }
  const done = await refresh()
  if (!done && pageActive) polling.start()
})

onDeactivated(() => {
  pageActive = false
  polling.stop()
})
</script>

<template>
  <div class="h-full flex flex-col bg-[var(--bg-page)]" data-testid="orchestration-detail">
    <div class="wb-toolbar">
      <div class="flex min-w-0 items-center gap-2.5">
        <button class="wb-btn-ghost" data-testid="orchestration-back" @click="back">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M15 19l-7-7 7-7"
            />
          </svg>
          {{ t('orchestration.detail.back') }}
        </button>
        <h2 class="truncate text-[calc(13px*var(--ui-scale))] font-semibold">
          {{ detail?.title ?? '' }}
        </h2>
        <StatusBadge v-if="detail" :status="detail.status" testid="orchestration-detail-status" />
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button class="wb-btn-ghost" data-testid="orchestration-detail-refresh" @click="refresh()">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {{ t('orchestration.list.refresh') }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-auto px-6 py-6">
      <div
        v-if="loading"
        class="flex flex-col items-center justify-center py-20"
        role="status"
        data-testid="orchestration-detail-loading"
      >
        <svg
          class="mb-3 h-5 w-5 animate-spin text-[var(--text-secondary)]"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="2"
          />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v2a6 6 0 00-6 6H4z" />
        </svg>
        <p class="wb-mono text-xs text-[var(--text-secondary)]">
          {{ t('orchestration.detail.loading') }}
        </p>
      </div>
      <div
        v-else-if="!detail"
        class="flex flex-col items-center justify-center py-20 text-xs text-[var(--text-secondary)]"
      >
        <p>{{ t('orchestration.detail.loadFailed') }}</p>
        <button class="wb-btn-ghost mt-4" @click="refresh()">
          {{ t('orchestration.list.refresh') }}
        </button>
      </div>
      <div v-else class="mx-auto max-w-6xl space-y-4">
        <div
          v-if="loadError"
          class="rounded-card border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--color-danger-ink)]"
          role="alert"
          data-testid="orchestration-detail-load-error"
        >
          {{ loadError }}
        </div>
        <div
          v-if="detail.status === 'cancelling'"
          class="rounded-card border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-secondary)]"
          role="status"
          data-testid="orchestration-cancelling-banner"
        >
          {{ t('orchestration.detail.cancelling') }}
        </div>
        <!-- 摘要 + 动作：动作不能塞进 48px 的 wb-toolbar（窄窗口会溢出/被裁切） -->
        <section
          class="rounded-card border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-card"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 space-y-2">
              <div
                class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]"
              >
                <span class="wb-mono inline-flex items-center gap-1">
                  <svg
                    class="h-3 w-3 shrink-0 text-[var(--text-tertiary)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.75"
                      d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                    />
                  </svg>
                  {{ detail.projectName }}
                </span>
                <span class="text-[var(--text-tertiary)]" aria-hidden="true">·</span>
                <span class="wb-mono">{{ modeLabel(detail.mode) }}</span>
                <span class="text-[var(--text-tertiary)]" aria-hidden="true">·</span>
                <span
                  class="wb-mono inline-flex min-w-0 items-center gap-1"
                  :title="t('orchestration.detail.orchestrator')"
                  data-testid="orchestration-orchestrator"
                >
                  <span class="truncate">{{ orchestratorName }}</span>
                </span>
                <span class="text-[var(--text-tertiary)]" aria-hidden="true">·</span>
                <span class="wb-mono" data-testid="orchestration-approval-policy">{{
                  detail.requireApproval
                    ? t('orchestration.detail.approvalOn')
                    : t('orchestration.detail.approvalOff')
                }}</span>
                <span class="text-[var(--text-tertiary)]" aria-hidden="true">·</span>
                <span class="wb-mono">{{
                  t('orchestration.detail.planRev', { rev: detail.planRev })
                }}</span>
                <span class="text-[var(--text-tertiary)]" aria-hidden="true">·</span>
                <span
                  class="wb-mono"
                  :class="detail.approved ? 'text-[var(--color-success-ink)]' : ''"
                  >{{
                    detail.approved
                      ? t('orchestration.detail.approved')
                      : t('orchestration.detail.notApproved')
                  }}</span
                >
                <span class="text-[var(--text-tertiary)]" aria-hidden="true">·</span>
                <span
                  class="wb-mono inline-flex items-center gap-1"
                  :title="t('orchestration.detail.budget')"
                >
                  <svg
                    class="h-3 w-3 shrink-0 text-[var(--text-tertiary)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.75"
                      d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {{ budgetText }}
                </span>
              </div>
              <div v-if="goalText">
                <div
                  class="text-[calc(11px*var(--ui-scale))] font-medium text-[var(--text-tertiary)]"
                >
                  {{ t('orchestration.detail.goal') }}
                </div>
                <p
                  class="mt-1 max-w-3xl whitespace-pre-wrap text-[calc(12px*var(--ui-scale))] leading-relaxed text-[var(--text-primary)]"
                >
                  {{ goalText }}
                </p>
              </div>
            </div>
            <div class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
              <button
                v-for="action in orchestrationActions"
                :key="action.kind"
                :class="actionClass(action)"
                :disabled="!action.enabled || actionBusy"
                :title="actionHint(action.kind)"
                :data-testid="`orchestration-${action.kind}`"
                @click="runAction(action.kind)"
              >
                {{ actionLabel(action) }}
              </button>
            </div>
          </div>
          <p
            v-if="primaryHint"
            class="mt-2 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
          >
            {{ primaryHint }}
          </p>
          <p
            v-if="detail.failureReason"
            class="mt-3 flex items-start gap-2 rounded-btn border border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] bg-[var(--color-danger-light)] p-2.5 text-[calc(11px*var(--ui-scale))] text-[var(--color-danger-ink)]"
          >
            <svg
              class="mt-0.5 h-3.5 w-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M12 9v4m0 4h.01M10.3 3.9L2.6 17a1.5 1.5 0 001.3 2.2h16.2a1.5 1.5 0 001.3-2.2L13.7 3.9a1.5 1.5 0 00-2.6 0z"
              />
            </svg>
            <span>
              <span class="font-medium">{{ t('orchestration.detail.failure') }}:</span>
              {{ t(reasonKey(detail.failureReason)) }}
            </span>
          </p>
        </section>

        <section v-if="nodes.length">
          <h3 class="wb-section-title">
            {{ t('orchestration.detail.participants') }}
          </h3>
          <AgentParticipants
            :nodes="nodes"
            :agent-profiles="agentProfiles"
            :selected-agent="selectedAgent"
            @select="selectAgent"
          />
        </section>

        <section class="min-w-0">
          <div class="mb-2 flex min-w-0 flex-wrap items-center gap-2">
            <h3 class="wb-section-title !mb-0">
              {{ t('orchestration.detail.plan') }}
            </h3>
            <span
              v-if="plan"
              class="wb-mono text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
              >{{ visibleNodes.length }} / {{ nodes.length }}</span
            >
            <span class="flex-1"></span>
            <span
              v-if="selectedAgent"
              class="inline-flex min-w-0 items-center gap-1 rounded-full border border-[var(--color-primary)] bg-[var(--color-primary-light)] py-0.5 pl-2 pr-1"
            >
              <AgentBadge :cli="selectedAgentDisplay.cli" :name="selectedAgentDisplay.name" />
              <button
                type="button"
                class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                :aria-label="t('orchestration.detail.clearAgentFilter')"
                :title="t('orchestration.detail.clearAgentFilter')"
                @click="selectedAgent = ''"
              >
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          </div>
          <div
            v-if="detail.status === 'planning'"
            class="flex items-center gap-2 rounded-card border border-dashed border-[var(--border)] bg-[var(--bg-card)] p-4 text-xs text-[var(--text-tertiary)]"
            data-testid="orchestration-planning-hint"
          >
            <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="2"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v2a6 6 0 00-6 6H4z"
              />
            </svg>
            {{ t('orchestration.detail.planningHint') }}
          </div>
          <PlanEditor
            v-else-if="showEditor"
            :plan="planForEditor"
            :agent-profiles="agentProfiles"
            :errors="planErrors"
            :disabled="savingPlan"
            @save="savePlan"
            @cancel="editingPlan = false"
          />
          <div
            v-else-if="!plan"
            class="rounded-card border border-dashed border-[var(--border)] bg-[var(--bg-card)] p-6 text-center text-xs text-[var(--text-tertiary)]"
          >
            <p class="text-[var(--text-secondary)]">{{ t('orchestration.detail.noPlan') }}</p>
            <p class="mt-1">
              {{
                t(
                  detail.mode === 'auto'
                    ? 'orchestration.detail.noPlanAutoHint'
                    : 'orchestration.detail.noPlanHint',
                )
              }}
            </p>
          </div>
          <div v-else class="space-y-2">
            <NodeCard
              v-for="node in visibleNodes"
              :key="node.key"
              :node="node"
              :agent-profiles="agentProfiles"
              :actions="nodeActions(node)"
              :selected="selectedKey === node.key"
              @select="selectNode"
              @retry="retryNode"
              @skip="skipNode"
              @open-terminal="(runId) => openTerminal(runId, node)"
            />
            <div
              v-if="visibleNodes.length === 0"
              class="rounded-card border border-dashed border-[var(--border)] bg-[var(--bg-card)] p-6 text-center"
            >
              <p class="text-xs text-[var(--text-secondary)]">
                {{
                  selectedAgent
                    ? t('orchestration.detail.noAgentNodes')
                    : t('orchestration.detail.noNodeActions')
                }}
              </p>
              <button v-if="selectedAgent" class="wb-btn-ghost mt-3" @click="selectedAgent = ''">
                {{ t('orchestration.detail.clearAgentFilter') }}
              </button>
            </div>
          </div>
          <div
            v-if="!showEditor && planErrors.length"
            class="mt-2 rounded-card border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[var(--color-danger-light)] p-3 text-[calc(11px*var(--ui-scale))]"
            data-testid="orchestration-plan-errors"
          >
            <div class="flex items-center gap-1.5 font-medium text-[var(--color-danger-ink)]">
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
            <ul class="mt-1.5 space-y-1 text-[var(--text-primary)]">
              <li v-for="(error, index) in planErrors" :key="index">
                <span class="wb-mono">{{ error.nodeKey ? `${error.nodeKey}: ` : '' }}</span>
                {{ t(`orchestration.planError.${error.code}`) }}
                <span class="text-[var(--text-tertiary)]">— {{ error.message }}</span>
              </li>
            </ul>
            <pre
              v-if="detail.plannerOutput"
              class="wb-mono mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-btn bg-[var(--bg-card)] p-2 text-[calc(10px*var(--ui-scale))] text-[var(--text-secondary)]"
              data-testid="orchestration-planner-output"
              >{{ detail.plannerOutput }}</pre>
          </div>
        </section>

        <!-- 有实际计划后才展示图 / 流水线：无计划时它们是两块空框，会把手动编辑入口挤到折叠线以下 -->
        <div v-if="plan" class="grid gap-4 xl:grid-cols-2">
          <section class="min-w-0">
            <div class="mb-2 flex items-center gap-2">
              <h3 class="wb-section-title !mb-0">
                {{ t('orchestration.detail.workflow') }}
              </h3>
              <span class="wb-mono text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]">{{
                nodes.length
              }}</span>
            </div>
            <WorkflowGraph
              :plan="plan"
              :nodes="nodes"
              :agent-profiles="agentProfiles"
              :selected-key="selectedKey"
              @select="selectNode"
            />
          </section>
          <section class="min-w-0">
            <div class="mb-2 flex items-center gap-2">
              <h3 class="wb-section-title !mb-0">
                {{ t('orchestration.detail.pipeline') }}
              </h3>
              <span class="wb-mono text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]">{{
                nodes.length
              }}</span>
            </div>
            <ExecutionPipeline
              :nodes="nodes"
              :events="events"
              :agent-profiles="agentProfiles"
              :started-at="detail.startedAt"
              :now="now"
              :selected-key="selectedKey"
              @select="selectNode"
            />
          </section>
        </div>

        <div class="grid gap-4 xl:grid-cols-2">
          <section class="min-w-0">
            <h3 class="wb-section-title">
              {{ t('orchestration.detail.timeline') }}
            </h3>
            <p
              v-if="eventsTruncated"
              class="mb-2 text-xs text-[var(--color-danger-ink)]"
              role="status"
              data-testid="orchestration-events-truncated"
            >
              {{ t('orchestration.detail.eventsTruncated') }}
            </p>
            <OrchestrationTimeline :events="events" />
          </section>
          <section class="min-w-0">
            <h3 class="wb-section-title">
              {{ t('orchestration.detail.evidence') }}
            </h3>
            <EvidencePanel :evidence="view?.evidence ?? []" />
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
