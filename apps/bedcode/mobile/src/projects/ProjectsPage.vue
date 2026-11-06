<template>
  <div class="h-full flex flex-col" style="background: var(--mobile-bg-primary)" data-testid="mobile-projects-page">
    <!-- ==================== 页头：返回 / 项目身份 / 刷新 ==================== -->
    <div class="page-header flex-shrink-0">
      <div class="page-header-row">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <button
            v-if="currentProject"
            type="button"
            class="page-icon-btn -ml-1.5"
            :aria-label="t('project.detail.back')"
            :title="t('project.detail.back')"
            @click="backToList"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <div class="min-w-0">
            <h1 class="page-title truncate">
              {{ currentProject ? currentProject.name : t('project.title') }}
            </h1>
            <p v-if="currentProject" class="page-subtitle truncate font-mono">
              {{ envLabel(currentProject.environment) }} · {{ currentProject.workingDir }}
            </p>
            <p v-else class="page-subtitle truncate">{{ t('project.subtitle') }}</p>
          </div>
        </div>

        <button
          type="button"
          class="page-icon-btn"
          :disabled="isRefreshing || !isAuthenticated"
          :aria-label="t('project.refresh')"
          :title="t('project.refresh')"
          data-testid="mobile-projects-refresh"
          @click="refresh"
        >
          <svg
            class="w-5 h-5"
            :class="{ 'refresh-spin': isRefreshing }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>
    </div>

    <div
      ref="scrollEl"
      class="scrollbar-gutter-stable session-scroll flex-1 overflow-auto px-4 pb-8 min-h-0"
    >
      <!-- 未连接：项目 → 连接联动（受保护端点未认证一律 401，不渲染空列表） -->
      <div
        v-if="!isAuthenticated"
        class="min-h-[45vh] flex flex-col items-center justify-center text-center"
      >
        <svg
          class="w-12 h-12 mb-4"
          style="color: var(--mobile-text-disabled)"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        <p class="group-row-sub">{{ t('hub.notConnected') }}</p>
        <p class="text-sm mt-1" style="color: var(--mobile-text-secondary)">
          {{ t('project.notConnectedHint') }}
        </p>
        <button
          type="button"
          class="mt-5 h-11 px-6 rounded-xl text-sm font-medium transition-colors active:opacity-80"
          style="background: var(--mobile-accent); color: var(--mobile-text-on-accent)"
          @click="$emit('open-connection')"
        >
          {{ t('hub.qrConnect') }}
        </button>
      </div>

      <!-- ==================== 项目列表 ==================== -->
      <template v-else-if="!currentProject">
        <div v-if="!loadedProjects && !loadError" class="space-y-3 mt-3">
          <div
            v-for="i in 3"
            :key="i"
            class="rounded-xl border p-4 animate-pulse"
            :style="{ background: 'var(--mobile-bg-card)', borderColor: 'var(--mobile-border)' }"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-xl"
                style="background: var(--mobile-chip-zinc-bg)"
              ></div>
              <div class="flex-1">
                <div
                  class="h-4 w-32 rounded mb-2"
                  style="background: var(--mobile-chip-zinc-bg)"
                ></div>
                <div class="h-3 w-48 rounded" style="background: var(--mobile-chip-zinc-bg)"></div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="loadError" class="project-error mt-6">
          <p class="group-row-sub">{{ t(loadError) }}</p>
          <button type="button" class="project-retry" @click="refresh">
            {{ t('project.retry') }}
          </button>
        </div>

        <div
          v-else-if="projects.length === 0"
          class="min-h-[40vh] flex flex-col items-center justify-center text-center"
        >
          <svg
            class="w-12 h-12 mb-4"
            style="color: var(--mobile-text-disabled)"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
            />
          </svg>
          <p class="group-row-sub">{{ t('project.empty') }}</p>
          <p class="text-sm mt-1" style="color: var(--mobile-text-secondary)">
            {{ t('project.emptyHint') }}
          </p>
        </div>

        <div v-else class="space-y-3 mt-3">
          <ProjectCard
            v-for="project in projects"
            :key="project.id"
            :project="project"
            :now="now"
            @open="enterProject"
          />
        </div>
      </template>

      <!-- ==================== 项目详情：运行列表 ==================== -->
      <template v-else>
        <div class="flex items-center gap-2 pt-3 min-w-0">
          <span class="section-head__label">{{ t('project.run.title') }}</span>
          <span class="group-row-sub font-mono">{{ runs.length }}</span>
          <span class="flex-1"></span>
          <span v-if="currentProject.activeRuns > 0" class="status-badge badge-emerald">
            <span class="status-dot dot-emerald" aria-hidden="true"></span>
            {{ t('project.run.activeCount', { n: currentProject.activeRuns }) }}
          </span>
        </div>

        <button
          type="button"
          class="new-run-btn mt-3"
          :disabled="isStarting"
          data-testid="mobile-run-new"
          @click="openAgentPicker"
        >
          <span v-if="isStarting" class="new-run-spinner" aria-hidden="true"></span>
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 4v16m8-8H4"
            />
          </svg>
          {{ isStarting ? t('project.run.starting') : t('project.run.new') }}
        </button>

        <div v-if="loadingRuns && runs.length === 0" class="space-y-3 mt-3">
          <div
            v-for="i in 2"
            :key="i"
            class="rounded-xl border p-4 animate-pulse"
            :style="{ background: 'var(--mobile-bg-card)', borderColor: 'var(--mobile-border)' }"
          >
            <div class="h-4 w-40 rounded mb-2" style="background: var(--mobile-chip-zinc-bg)"></div>
            <div class="h-3 w-24 rounded" style="background: var(--mobile-chip-zinc-bg)"></div>
          </div>
        </div>

        <div v-else-if="loadError" class="project-error mt-4">
          <p class="group-row-sub">{{ t(loadError) }}</p>
          <button type="button" class="project-retry" @click="refresh">
            {{ t('project.retry') }}
          </button>
        </div>

        <div
          v-else-if="runs.length === 0"
          class="min-h-[30vh] flex flex-col items-center justify-center text-center"
        >
          <svg
            class="w-12 h-12 mb-4"
            style="color: var(--mobile-text-disabled)"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p class="group-row-sub">{{ t('project.run.empty') }}</p>
          <p class="text-sm mt-1" style="color: var(--mobile-text-secondary)">
            {{ t('project.run.emptyHint') }}
          </p>
        </div>

        <div v-else class="group-card mt-3" data-testid="mobile-project-runs">
          <RunRow
            v-for="run in runs"
            :key="run.id"
            :run="run"
            :now="now"
            @open="openRun"
            @stop="confirmStop"
          />
        </div>

        <p
          v-if="runs.some((run) => run.active)"
          class="text-center mt-3"
          style="font-size: var(--font-size-sm); color: var(--mobile-text-muted)"
        >
          {{ t('project.detail.openHint') }}
        </p>
      </template>
    </div>

    <AgentPicker
      v-model="showAgentPicker"
      :agents="agents"
      :loading="loadingAgents"
      :error="agentsError"
      :starting-agent-id="startingAgentId"
      @pick="pickAgent"
      @refresh="refreshAgents"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 项目页（ADR 0003 移动消费面：项目 → 运行 → 终端）
 *
 * 取代原「会话配置 + 运行中会话」页：
 * - 列表：项目卡（名称 / 路径 / 活跃运行 / 最近活动 / 环境徽标）；项目写面在桌面端，
 *   移动端不提供新建 / 改名 / 删除；
 * - 详情：项目内运行列表；「新建运行」→ 选 agent → `run.start`（后端按项目 × agent
 *   取 / 建启动配置），启动成功直接进终端；
 * - 打开运行：先 `prewarm` 传输面再切沉浸终端（与旧会话入口同一链路，`sessionId`
 *   即 `runId`）；终态运行没有存活 PTY，显性提示不打开空终端；
 * - 系统返回键：终端层优先（AppRoot），其次本页详情 → 列表；列表页不消费返回。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useHostPage } from '../host/useHostPage'
import { useProjects } from './useProjects'
import AgentPicker from './components/AgentPicker.vue'
import ProjectCard from './components/ProjectCard.vue'
import RunRow from './components/RunRow.vue'
import { envLabel, type AgentEntry, type ProjectView, type RunView } from './types'
import './projects.css'

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const emit = defineEmits<{
  /** 打开终端（AppRoot 切整页沉浸终端） */
  (e: 'open-terminal', sessionId: string, sessionName: string): void
  /** 切到连接页（未连接空态的入口） */
  (e: 'open-connection'): void
}>()

const ctrl = useHostPage()
const t = ctrl.t
const toast = ctrl.toast
const logger = ctrl.logger
const api = ctrl.api
const context = ctrl.context

const {
  projects,
  currentProject,
  runs,
  agents,
  now,
  loadingProjects,
  loadingRuns,
  loadingAgents,
  loadedProjects,
  startingAgentId,
  isStarting,
  loadError,
  agentsError,
  loadProjects,
  refreshCurrent,
  openProject,
  backToList: leaveProject,
  restoreSelection,
  resetSelection,
  loadAgents,
  startRun,
  stopRun,
  subscribe,
  startTicker,
  stopTicker,
} = useProjects(context)

const isAuthenticated = computed(() => api.isPaired.value)
const isRefreshing = computed(() => loadingProjects.value || loadingRuns.value)
const showAgentPicker = ref(false)
const scrollEl = ref<HTMLElement | null>(null)

/** 错误对象 → 展示文本（i18n key 或服务端原文） */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ==================== 取数 ====================

async function refresh(): Promise<void> {
  if (!isAuthenticated.value) return
  try {
    if (currentProject.value) await refreshCurrent()
    else await loadProjects()
  } catch (error) {
    toast.showToast(t(errorText(error)), 'error')
  }
}

/** 终端返回 / 事件刷新：静默重取，不打断用户 */
function refreshAfterTerminal(): void {
  if (!isAuthenticated.value) return
  const task = currentProject.value ? refreshCurrent() : loadProjects()
  void task.catch((error) => {
    logger.warn(`[projects] refresh after terminal failed: ${errorText(error)}`)
  })
}

function scrollTop(): void {
  scrollEl.value?.scrollTo?.({ top: 0 })
}

async function enterProject(project: ProjectView): Promise<void> {
  try {
    await openProject(project)
    scrollTop()
  } catch (error) {
    toast.showToast(t(errorText(error)), 'error')
  }
}

function backToList(): void {
  leaveProject()
  scrollTop()
}

// ==================== 运行 ====================

async function openAgentPicker(): Promise<void> {
  showAgentPicker.value = true
  // 每次打开都重取就绪度：刚在桌面端装好的 agent 不该被旧缓存标成未安装
  try {
    await loadAgents()
  } catch (error) {
    // 错误槽在弹窗内展示（agentsError），这里只留日志
    logger.warn(`[projects] open agent picker failed: ${errorText(error)}`)
  }
}

function refreshAgents(): void {
  void loadAgents().catch((error) => {
    logger.warn(`[projects] retry agents failed: ${errorText(error)}`)
  })
}

function pickAgent(agent: AgentEntry): void {
  if (startingAgentId.value) return
  if (agent.readiness === 'missing') {
    toast.showToast(t('project.run.installOnDesktop'), 'warning')
    return
  }
  void start(agent)
}

async function start(agent: AgentEntry): Promise<void> {
  const projectId = currentProject.value?.id
  try {
    const created = await startRun(agent.id)
    showAgentPicker.value = false
    // 启动期间用户切走页签 / 退回列表 / 换了项目：不在后台强拉终端页
    if (!props.active || !projectId || currentProject.value?.id !== projectId) {
      toast.showToast(t('project.run.startedInBackground'), 'success')
      return
    }
    openRunById(created.runId, created.name)
  } catch (error) {
    logger.error(`[projects] start run failed: ${errorText(error)}`)
    toast.showToast(t(errorText(error)), 'error')
  }
}

/** 打开运行终端：终态运行没有存活 PTY，不打开空页 */
function openRun(run: RunView): void {
  if (!run.active) {
    toast.showToast(t('project.run.ended'), 'warning')
    return
  }
  openRunById(run.id, run.title || run.name, run.status)
}

function openRunById(runId: string, runName: string, status = 'starting'): void {
  api.activeSessionId.value = runId
  // 预热只建连、不发 subscribe：桌面端每次 subscribe 都整段重放环窗口
  if (status !== 'stopped' && status !== 'error') {
    void context.commands
      .execute('bedcode.prewarm', { sessionId: runId })
      .catch((error) => logger.warn(`[projects] terminal prewarm failed: ${errorText(error)}`))
  }
  emit('open-terminal', runId, runName)
}

async function confirmStop(run: RunView): Promise<void> {
  const name = run.title || run.name
  const confirmed = await context.dialogs.showConfirm({
    title: t('project.run.stopTitle'),
    message: t('project.run.stopConfirm', { name }),
    variant: 'danger',
    confirmText: t('project.run.stop'),
    cancelText: t('project.run.cancel'),
  })
  if (!confirmed) return
  try {
    await stopRun(run)
    toast.showToast(t('project.run.stoppedOk'), 'success')
  } catch (error) {
    logger.error(`[projects] stop run failed: ${errorText(error)}`)
    toast.showToast(t(errorText(error)), 'error')
  }
}

// ==================== 生命周期 ====================

let subscriptions: { dispose(): void }[] = []

/** 首屏：项目列表 → 恢复上次查看的项目（终端返回时本页重挂载） */
async function initialLoad(): Promise<void> {
  await loadProjects()
  await restoreSelection()
}

onMounted(() => {
  startTicker()
  subscriptions = subscribe(() => props.active)
  if (isAuthenticated.value) {
    void initialLoad().catch((error) => {
      logger.warn(`[projects] initial load failed: ${errorText(error)}`)
    })
  }
})

onUnmounted(() => {
  stopTicker()
  for (const disposable of subscriptions) disposable.dispose()
  subscriptions = []
})

/** 页签常驻：切回项目页时刷新当前层级（列表→项目统计，详情→运行） */
watch(
  () => props.active,
  (visible) => {
    // 页签常驻：切走时收起 agent 弹窗（Teleport 在面板之外，否则会跨页残留）
    if (!visible) {
      showAgentPicker.value = false
      return
    }
    if (!isAuthenticated.value) return
    refreshAfterTerminal()
  },
)

/** 配对完成：页签已挂载时补拉首屏 */
watch(isAuthenticated, (paired) => {
  if (!paired) {
    // 断开 / 掉认证：受保护端点已不可用，收起弹窗并清掉详情与记忆，重新配对后回列表
    showAgentPicker.value = false
    resetSelection()
    return
  }
  if (!loadedProjects.value) {
    void initialLoad().catch((error) => {
      logger.warn(`[projects] load after pairing failed: ${errorText(error)}`)
    })
  }
})

/** 系统返回键契约（AppRoot 按层调用）：弹窗 → 详情 → 列表；列表不消费 */
function canGoBack(): boolean {
  return showAgentPicker.value || currentProject.value !== null
}

function handleBack(): void {
  if (showAgentPicker.value) {
    showAgentPicker.value = false
    return
  }
  backToList()
}

defineExpose({ canGoBack, goBack: handleBack })
</script>

<style scoped>
/* 详情分组标题（原 SessionsSection 的 scoped 样式已随旧 UI 退役，此处自持） */
.section-head__label {
  display: block;
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--mobile-text-secondary);
}

.page-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.75rem;
  color: var(--mobile-text-secondary);
  transition:
    background-color 0.15s ease,
    opacity 0.15s ease;
}

.page-icon-btn:active {
  background: var(--mobile-group-row-active);
}

.page-icon-btn:disabled {
  opacity: 0.5;
}

.refresh-spin {
  animation: project-spin 0.8s linear infinite;
}

@keyframes project-spin {
  to {
    transform: rotate(360deg);
  }
}

.new-run-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  height: 2.75rem;
  border-radius: 0.75rem;
  font-size: var(--font-size-base);
  font-weight: 600;
  background: var(--mobile-accent);
  color: var(--mobile-text-on-accent);
  transition: opacity 0.15s ease;
}

.new-run-btn:disabled {
  opacity: 0.55;
}

.new-run-btn:active:not(:disabled) {
  opacity: 0.8;
}

.new-run-spinner {
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: project-spin 0.8s linear infinite;
}

.project-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-align: center;
  padding: 2rem 0;
}

.project-retry {
  height: 2.5rem;
  padding: 0 1rem;
  border-radius: 0.75rem;
  font-size: var(--font-size-base);
  color: var(--mobile-accent);
  background: var(--mobile-accent-muted);
}

@media (prefers-reduced-motion: reduce) {
  .refresh-spin,
  .new-run-spinner {
    animation: none;
  }
}
</style>
