<script setup lang="ts">
import { computed, inject, onActivated, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import AgentIcon from '@/agents/components/AgentIcon.vue'
import PluginModal from '@/components/PluginModal.vue'
import Toggle from '@/components/Toggle.vue'
import AppSelectField from '@/components/ui/AppSelectField.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import StatusBadge from '@/components/orchestration/StatusBadge.vue'
import AgentPoolArea from '@/components/orchestration/AgentPoolArea.vue'
import { useOrchestrations } from '@/composables/orchestration/useOrchestrations'
import type { ListItemView, MetaView } from '@/composables/orchestration/types'
import { statusTone } from '@/composables/orchestration/types'
import { useAppI18n } from '@/composables/useAppI18n'
import { useToast } from '@/composables/useToast'
import { toneBarClass } from '@/utils/orchestrationTone'
import { resolvePluginErrorText } from '@/utils/pluginError'

interface ProjectOption {
  id: string
  name: string
}

const context = inject<PluginContext>('pluginContext')!
const t = useAppI18n()
const toast = useToast()
const router = useRouter()
const api = useOrchestrations(context)

const meta = ref<MetaView | null>(null)
/** 编排域内的两个区域：编排列表 / Agent 池 */
const activeTab = ref<'list' | 'pool'>('list')
let poolPollTimer: ReturnType<typeof setInterval> | null = null
const projects = ref<ProjectOption[]>([])
const items = ref<ListItemView[]>([])
const loading = ref(false)
const filterProject = ref('')
const filterStatus = ref('')
const showCreate = ref(false)
const submitting = ref(false)
const createForm = reactive({
  projectId: '',
  title: '',
  goal: '',
  mode: 'manual',
  orchestratorAgentId: '',
  requireApproval: true,
})

/** 可作为编排 Agent 的池成员：启用 + CLI 已安装 + 标记可编排 */
const orchestratorOptions = computed(() =>
  (meta.value?.agentProfiles ?? [])
    .filter((profile) => profile.enabled && profile.ready && profile.canOrchestrate)
    .map((profile) => ({
      value: profile.id,
      label: `${profile.name} · ${profile.cli}`,
    })),
)
const isAutoMode = computed(() => createForm.mode === 'auto')
const poolAgents = computed(() => meta.value?.agents ?? [])
const hasReadyCli = computed(() => poolAgents.value.some((agent) => agent.ready))

const filtered = computed(() =>
  items.value.filter((item) => {
    if (filterProject.value && item.projectId !== filterProject.value) return false
    if (filterStatus.value && item.status !== filterStatus.value) return false
    return true
  }),
)
const hasFilters = computed(() => !!filterProject.value || !!filterStatus.value)

const projectOptions = computed(() =>
  projects.value.map((project) => ({ value: project.id, label: project.name })),
)
const statusOptions = computed(() =>
  (meta.value?.statuses ?? []).map((status) => ({
    value: status,
    label: t(`orchestration.status.${status}`),
  })),
)
const modeOptions = computed(() => [
  { value: 'manual', label: t('orchestration.create.modeManual') },
  { value: 'auto', label: t('orchestration.create.modeAuto') },
])

async function load(options: { quiet?: boolean } = {}) {
  if (!options.quiet) loading.value = true
  try {
    const [loadedMeta, loadedProjects] = await Promise.all([
      api.meta(),
      context.commands.execute('project.list', {}) as Promise<{ projects: ProjectOption[] }>,
    ])
    meta.value = loadedMeta
    projects.value = loadedProjects.projects ?? []
    items.value = await api.list()
  } catch (error) {
    console.error('[orchestration] list load failed', error)
    toast.error(resolvePluginErrorText(context, error, 'orchestration.list.loadFailed'))
  } finally {
    if (!options.quiet) loading.value = false
  }
}

let poolPollSeq = 0
let poolPollInFlight = false

function stopPoolPoll() {
  // 代次作废：stop 之后仍在飞的请求不得再写 meta（M34）。
  poolPollSeq += 1
  poolPollInFlight = false
  if (poolPollTimer) {
    clearInterval(poolPollTimer)
    poolPollTimer = null
  }
}

/**
 * Agent 池的 CLI 事实来自 hub 探测（`orchestration.meta.agents.ready`）。
 * 探测是异步进程：进入池区域且尚无就绪 CLI 时显式触发一次，并轮询 meta
 * 直到探测收敛（45s 上限）；不把「未探测」误呈现成「没安装」。
 */
async function refreshPoolAgents() {
  try {
    await context.commands.execute('agent.detect', {})
  } catch (error) {
    console.error('[orchestration] agent detect failed', error)
  }
  stopPoolPoll()
  const seq = poolPollSeq
  const startedAt = Date.now()
  poolPollTimer = setInterval(() => {
    if (poolPollInFlight || seq !== poolPollSeq) return
    poolPollInFlight = true
    void (async () => {
      try {
        const next = await api.meta()
        if (seq === poolPollSeq) meta.value = next
      } catch (error) {
        console.error('[orchestration] meta refresh failed', error)
      } finally {
        poolPollInFlight = false
        if (seq === poolPollSeq && (hasReadyCli.value || Date.now() - startedAt > 45_000)) {
          stopPoolPoll()
        }
      }
    })()
  }, 2000)
}

function openPoolTab() {
  activeTab.value = 'pool'
  stopPoolPoll()
  // 不在读页面时隐式起探测进程：CLI 事实缺失时由池区域显式「刷新 CLI 状态」
}

function openListTab() {
  activeTab.value = 'list'
  stopPoolPoll()
}

onUnmounted(stopPoolPoll)

function openCreate() {
  createForm.projectId = projects.value[0]?.id ?? ''
  createForm.title = ''
  createForm.goal = ''
  createForm.mode = 'manual'
  createForm.orchestratorAgentId = orchestratorOptions.value[0]?.value ?? ''
  createForm.requireApproval = true
  showCreate.value = true
}

async function submitCreate() {
  if (!createForm.projectId) {
    toast.error(t('orchestration.create.projectRequired'))
    return
  }
  if (isAutoMode.value && !createForm.orchestratorAgentId) {
    toast.error(t('orchestration.create.orchestratorRequired'))
    return
  }
  submitting.value = true
  try {
    const auto = isAutoMode.value
    const orchestrator = createForm.orchestratorAgentId
    const receipt = await api.create({
      projectId: createForm.projectId,
      title: createForm.title.trim(),
      goal: createForm.goal.trim(),
      mode: createForm.mode as 'manual' | 'auto',
      ...(auto
        ? {
            orchestratorAgentId: orchestrator,
            requireApproval: createForm.requireApproval,
          }
        : {}),
    })
    showCreate.value = false
    if (auto) {
      // 自动编排创建即启动 planner；失败不丢编排（详情页可重新规划）
      try {
        await api.plan(receipt.id, orchestrator)
      } catch (error) {
        console.error('[orchestration] auto plan failed to start', error)
        toast.error(resolvePluginErrorText(context, error, 'orchestration.create.planFailed'))
      }
    }
    await router.push(`/orchestrations/${receipt.id}`)
  } catch (error) {
    console.error('[orchestration] create failed', error)
    toast.error(resolvePluginErrorText(context, error, 'orchestration.create.failed'))
  } finally {
    submitting.value = false
  }
}

function open(item: ListItemView) {
  void router.push(`/orchestrations/${item.id}`)
}

function clearFilters() {
  filterProject.value = ''
  filterStatus.value = ''
}

function modeLabel(mode: string): string {
  const key = `orchestration.mode.${mode}`
  const text = t(key)
  return text === key ? mode : text
}

function progressPct(item: ListItemView): number {
  if (!item.nodeCount) return 0
  return Math.round((item.succeededCount / item.nodeCount) * 100)
}

function barClass(item: ListItemView): string {
  return toneBarClass[statusTone(item.status)]
}

function relativeTime(at: string): string {
  const parsed = Date.parse(at)
  if (!Number.isFinite(parsed)) return at
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000))
  if (seconds < 60) return t('orchestration.time.secondsAgo', { n: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('orchestration.time.minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('orchestration.time.hoursAgo', { n: hours })
  return t('orchestration.time.daysAgo', { n: Math.floor(hours / 24) })
}

// 路由页被 AppLayout 的 KeepAlive 缓存：新建编排后返回列表时若不重新取数，
// 用户看到的还是进入详情前的旧快照。首次挂载只取一次（activated 紧跟 mounted），
// 之后每次重新激活都刷新。
let skipFirstActivate = false
onMounted(() => {
  skipFirstActivate = true
  void load()
})
onActivated(() => {
  if (skipFirstActivate) {
    skipFirstActivate = false
    return
  }
  // 静默刷新：保留列表内容，刷新完成后再替换，避免返回时闪一屏骨架
  void load({ quiet: true })
})
</script>

<template>
  <div class="h-full flex flex-col bg-[var(--bg-page)]" data-testid="orchestration-list">
    <div class="wb-toolbar">
      <div class="flex min-w-0 items-center gap-2.5">
        <svg
          class="w-4 h-4 shrink-0 text-[var(--text-secondary)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <rect x="3" y="3" width="7" height="7" rx="1.5" stroke-width="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" stroke-width="1.5" />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M10 6.5h4a2 2 0 0 1 2 2v5.5M6.5 10v4a2 2 0 0 0 2 2H14"
          />
        </svg>
        <h2
          class="truncate text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
        >
          {{ t('orchestration.list.title') }}
        </h2>
        <span
          v-if="items.length"
          class="wb-mono rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[calc(10px*var(--ui-scale))] text-[var(--text-secondary)]"
          >{{ items.length }}</span
        >
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          v-if="activeTab === 'list'"
          class="wb-btn-ghost"
          data-testid="orchestration-refresh"
          @click="load()"
        >
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
        <button
          v-if="activeTab === 'list'"
          class="wb-btn-primary"
          data-testid="orchestration-create"
          @click="openCreate"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M12 4v16m8-8H4"
            />
          </svg>
          {{ t('orchestration.list.create') }}
        </button>
      </div>
    </div>

    <div class="flex gap-1 border-b border-[var(--border)] px-6" role="tablist">
      <button
        type="button"
        class="relative -mb-px border-b-2 px-3 py-2 text-[calc(12px*var(--ui-scale))] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        :class="
          activeTab === 'list'
            ? 'border-[var(--color-primary)] font-medium text-[var(--color-primary)]'
            : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        "
        role="tab"
        :aria-selected="activeTab === 'list'"
        data-testid="orchestration-tab-list"
        @click="openListTab"
      >
        {{ t('orchestration.tabs.list') }}
      </button>
      <button
        type="button"
        class="relative -mb-px border-b-2 px-3 py-2 text-[calc(12px*var(--ui-scale))] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        :class="
          activeTab === 'pool'
            ? 'border-[var(--color-primary)] font-medium text-[var(--color-primary)]'
            : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        "
        role="tab"
        :aria-selected="activeTab === 'pool'"
        data-testid="orchestration-tab-pool"
        @click="openPoolTab"
      >
        {{ t('orchestration.tabs.pool') }}
      </button>
    </div>

    <div v-if="activeTab === 'list'" class="flex-1 overflow-auto px-6 py-6">
      <div class="mx-auto max-w-5xl">
        <!-- 筛选条放在内容区：wb-toolbar 固定 48px 高，窄窗口下筛选与动作同排会溢出 -->
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <AppSelectField
            v-model="filterProject"
            compact
            class="w-44"
            :aria-label="t('orchestration.list.filterProject')"
            :placeholder="t('orchestration.list.allProjects')"
            :options="projectOptions"
            :disabled="loading"
          />
          <AppSelectField
            v-model="filterStatus"
            compact
            class="w-40"
            :aria-label="t('orchestration.list.filterStatus')"
            :placeholder="t('orchestration.list.allStatuses')"
            :options="statusOptions"
            :disabled="loading"
          />
          <button v-if="hasFilters" class="wb-btn-ghost" @click="clearFilters">
            {{ t('orchestration.list.clearFilters') }}
          </button>
          <span class="flex-1"></span>
          <span
            v-if="items.length"
            class="wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
          >
            {{ filtered.length }} / {{ items.length }}
          </span>
        </div>

        <!-- 加载态 -->
        <div
          v-if="loading"
          class="flex flex-col items-center justify-center py-20"
          role="status"
          data-testid="orchestration-loading"
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
            {{ t('orchestration.list.loading') }}
          </p>
        </div>

        <!-- 空态：没有任何编排 -->
        <div
          v-else-if="items.length === 0"
          class="flex flex-col items-center justify-center py-20"
          data-testid="orchestration-empty"
        >
          <div
            class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[var(--text-tertiary)]"
          >
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1.5" stroke-width="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" stroke-width="1.5" />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M10 6.5h4a2 2 0 0 1 2 2v5.5M6.5 10v4a2 2 0 0 0 2 2H14"
              />
            </svg>
          </div>
          <p class="text-sm font-medium text-[var(--text-primary)]">
            {{ t('orchestration.list.empty') }}
          </p>
          <p class="mt-1 max-w-md text-center text-xs text-[var(--text-secondary)]">
            {{ t('orchestration.list.emptyHint') }}
          </p>
          <button class="wb-btn-primary mt-5" @click="openCreate">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M12 4v16m8-8H4"
              />
            </svg>
            {{ t('orchestration.list.create') }}
          </button>
        </div>

        <!-- 空态：筛选后无结果（与「没有编排」区分，避免误导用户去新建） -->
        <div
          v-else-if="filtered.length === 0"
          class="flex flex-col items-center justify-center py-20"
          data-testid="orchestration-no-matches"
        >
          <div
            class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[var(--text-tertiary)]"
          >
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M3 5h18l-7 8v5l-4 2v-7L3 5z"
              />
            </svg>
          </div>
          <p class="text-sm font-medium text-[var(--text-primary)]">
            {{ t('orchestration.list.noMatches') }}
          </p>
          <button class="wb-btn-ghost mt-4" @click="clearFilters">
            {{ t('orchestration.list.clearFilters') }}
          </button>
        </div>

        <div v-else class="space-y-2">
          <button
            v-for="item in filtered"
            :key="item.id"
            type="button"
            class="group w-full rounded-card border border-[var(--border)] bg-[var(--bg-card)] p-4 text-left shadow-card transition-[border-color,box-shadow,background-color] duration-200 hover:border-[var(--border-strong)] hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            data-testid="orchestration-row"
            :data-id="item.id"
            :data-status="item.status"
            @click="open(item)"
          >
            <div class="flex items-start gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    class="min-w-0 truncate text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
                  >
                    {{ item.title }}
                  </span>
                  <span
                    class="wb-mono rounded-tag border border-[var(--border)] px-1.5 py-0.5 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
                    >{{ modeLabel(item.mode) }}</span
                  >
                  <StatusBadge :status="item.status" />
                </div>
                <div
                  class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]"
                >
                  <span class="wb-mono inline-flex items-center gap-1 text-[var(--text-tertiary)]">
                    <svg
                      class="h-3 w-3 shrink-0"
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
                    {{ item.projectName }}
                  </span>
                  <span class="wb-mono">{{
                    t('orchestration.list.progress', {
                      done: item.succeededCount,
                      total: item.nodeCount,
                    })
                  }}</span>
                  <span v-if="item.failedCount" class="wb-mono text-[var(--color-danger-ink)]">
                    {{ t('orchestration.list.failedCount', { n: item.failedCount }) }}
                  </span>
                  <span class="wb-mono text-[var(--text-tertiary)]"
                    >{{ t('orchestration.list.updatedAt') }}
                    {{ relativeTime(item.updatedAt) }}</span
                  >
                </div>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-2">
                <span
                  v-if="item.agents.length"
                  class="flex items-center -space-x-1"
                  :title="item.agents.join(', ')"
                  data-testid="orchestration-row-agents"
                >
                  <AgentIcon
                    v-for="agent in item.agents"
                    :key="agent"
                    :adapter="agent"
                    :size="15"
                  />
                </span>
                <svg
                  class="h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--text-secondary)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.75"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </div>
            <div v-if="item.nodeCount" class="mt-3 flex items-center gap-2">
              <div
                class="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-hover)]"
                role="progressbar"
                :aria-valuenow="progressPct(item)"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="
                  t('orchestration.list.progress', {
                    done: item.succeededCount,
                    total: item.nodeCount,
                  })
                "
              >
                <div
                  class="h-full rounded-full transition-[width] duration-300"
                  :class="barClass(item)"
                  :style="{ width: progressPct(item) + '%' }"
                ></div>
              </div>
              <span class="wb-mono text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
                >{{ progressPct(item) }}%</span
              >
            </div>
          </button>
        </div>
      </div>
    </div>

    <div v-else class="flex-1 overflow-auto">
      <AgentPoolArea
        :agents="poolAgents"
        @refresh="refreshPoolAgents"
        @changed="() => load({ quiet: true })"
      />
    </div>

    <PluginModal v-model="showCreate" :title="t('orchestration.create.title')" size="md">
      <div class="space-y-4">
        <AppSelectField
          v-model="createForm.projectId"
          :label="t('orchestration.create.project')"
          :options="projectOptions"
          required
          testid="orchestration-create-project"
        />
        <AppTextField
          v-model="createForm.title"
          :label="t('orchestration.create.name')"
          testid="orchestration-create-name"
        />
        <AppTextField
          v-model="createForm.goal"
          :label="t('orchestration.create.goal')"
          multiline
          :rows="3"
          testid="orchestration-create-goal"
        />
        <AppSelectField
          v-model="createForm.mode"
          :label="t('orchestration.create.mode')"
          :options="modeOptions"
          testid="orchestration-create-mode"
        />
        <template v-if="isAutoMode">
          <AppSelectField
            v-if="orchestratorOptions.length"
            v-model="createForm.orchestratorAgentId"
            :label="t('orchestration.create.orchestrator')"
            :options="orchestratorOptions"
            :help="t('orchestration.create.orchestratorHint')"
            required
            testid="orchestration-create-orchestrator"
          />
          <p
            v-else
            class="text-xs text-[var(--color-warning-ink)]"
            data-testid="orchestration-create-no-orchestrator"
          >
            {{ t('orchestration.create.noOrchestrator') }}
          </p>
          <div class="flex flex-col gap-1.5">
            <Toggle
              v-model="createForm.requireApproval"
              :label="t('orchestration.create.requireApproval')"
              data-testid="orchestration-create-approval"
            />
            <p class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">
              {{ t('orchestration.create.requireApprovalHint') }}
            </p>
          </div>
        </template>
      </div>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button class="wb-btn-ghost" @click="showCreate = false">
            {{ t('orchestration.create.cancel') }}
          </button>
          <button
            class="wb-btn-primary"
            :disabled="submitting"
            data-testid="orchestration-create-submit"
            @click="submitCreate"
          >
            {{ t('orchestration.create.submit') }}
          </button>
        </div>
      </template>
    </PluginModal>
  </div>
</template>
