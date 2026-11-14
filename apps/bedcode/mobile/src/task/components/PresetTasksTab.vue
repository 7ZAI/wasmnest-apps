<template>
  <div class="att-tab-body">
    <div ref="contentScrollRef" class="att-scroll">
      <div class="att-scroll-inner">
        <!-- 编辑区域（常驻页面顶部，还原旧宿主 PresetTasksView 形态）：任务内容 + AI 模板 +
             工程目录选择 + 添加/保存按钮，添加/编辑都不走弹窗 -->
        <div class="group-card p-4 space-y-3">
          <div class="flex items-center justify-between">
            <label class="group-row-sub">{{
              t(editingTask ? 'toolbox.editTask' : 'toolbox.taskContent')
            }}</label>
            <!-- 插入模板是辅助动作（不是主操作）：纯文字 + accent 色，不加底色 -->
            <button
              v-if="!hasAiTemplate"
              class="flex items-center gap-1 min-h-[32px] px-1 text-[var(--font-size-sm)] font-medium transition-opacity active:opacity-70"
              style="color: var(--mobile-accent)"
              @click="insertAiTemplate"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.75"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              {{ t('toolbox.insertAiTemplate') }}
            </button>
          </div>

          <!-- 目标：项目 + agent（预设执行时只投递到该目标的运行） -->
          <div class="flex items-center gap-2">
            <div class="relative flex-1 min-w-0">
              <button
                class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--bc-radius-control)] text-[var(--font-size-sm)] w-full transition-colors active:opacity-80"
                style="
                  background: var(--mobile-bg-primary);
                  border: 1px solid var(--mobile-border);
                  color: var(--mobile-text-secondary);
                "
                @click="openPicker('project')"
              >
                <svg
                  class="w-3.5 h-3.5 flex-shrink-0"
                  style="color: var(--mobile-text-muted)"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.75"
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <span class="truncate">{{
                  selectedProjectName || t('preset.projectPlaceholder')
                }}</span>
                <svg
                  class="w-3 h-3 flex-shrink-0 ml-auto"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.75"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              <button
                class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--bc-radius-control)] text-[var(--font-size-sm)] w-full mt-1.5 transition-colors active:opacity-80 disabled:opacity-50"
                style="
                  background: var(--mobile-bg-primary);
                  border: 1px solid var(--mobile-border);
                  color: var(--mobile-text-secondary);
                "
                :disabled="!selectedProjectId"
                @click="openPicker('agent')"
              >
                <span class="truncate">{{
                  selectedAgentName || t('preset.agentPlaceholder')
                }}</span>
                <svg
                  class="w-3 h-3 flex-shrink-0 ml-auto"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.75"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            </div>
            <!-- 从侧栏插入引用：次级动作，中性底；禁用时靠透明度表达 -->
            <button
              class="flex-shrink-0 flex items-center justify-center rounded-[var(--bc-radius-control)] transition-colors active:opacity-70 disabled:opacity-40"
              style="
                background: var(--mobile-bg-primary);
                border: 1px solid var(--mobile-border);
                color: var(--mobile-text-secondary);
                width: 2.5rem;
                height: 2.5rem;
              "
              :disabled="!fileExplorerSessionId"
              @click="showFileExplorer = true"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.75"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.75"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            </button>
          </div>

          <textarea
            ref="contentTextarea"
            v-model="draftContent"
            rows="4"
            class="content-input w-full rounded-[var(--bc-radius-control)] px-3 py-2.5 resize-none overflow-y-auto transition-colors duration-200"
            :placeholder="t('toolbox.taskContentPlaceholder')"
            @input="autosizeTextarea"
            @keydown="submitOnEnter(handleAdd)"
          ></textarea>

          <!-- 添加 / 保存：卡片里的主操作，实底 accent（原先用主色 10% 底 + 主色字，
               和上面两个选择器几乎同权重，一屏里找不出该点哪个） -->
          <button
            class="w-full h-12 rounded-[var(--bc-radius-control)] text-[var(--font-size-base)] font-medium transition-opacity active:opacity-80 flex items-center justify-center gap-2"
            :class="{ 'opacity-50': !draftContent.trim() }"
            style="background: var(--mobile-accent); color: var(--mobile-text-on-accent)"
            :disabled="!draftContent.trim()"
            @click="handleAdd"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M12 4v16m8-8H4"
              />
            </svg>
            {{ editingTask ? t('common.button.save') : t('toolbox.add') }}
          </button>
        </div>

        <!-- 预设任务列表（容器是 group-card，卡片自持 group-row 语汇与行间分隔线） -->
        <div v-if="tasks.length > 0" class="group-card mt-3">
          <PresetTaskCard
            v-for="task in tasks"
            :key="task.id"
            :task="task"
            :target="targetLabel(task)"
            @tap="startExecuteFlow(task)"
            @execute="startExecuteFlow(task)"
            @edit="openEditTask"
            @delete="askDelete"
          />
        </div>

        <!-- 空态：说明「预设任务」是干什么的，降低首屏困惑 -->
        <div v-else class="att-state">
          <svg class="att-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M9 4h6a1 1 0 0 1 1 1v1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1V5a1 1 0 0 1 1-1z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="m9 13 2 2 4-4"
            />
          </svg>
          <p>{{ t('preset.noTasks') }}</p>
          <p class="text-[var(--mobile-text-disabled)] text-[var(--font-size-sm)]">
            {{ t('preset.emptyHint') }}
          </p>
        </div>
      </div>
    </div>

    <!-- 文件浏览：宿主通用组件（代码浏览域），经 wasmnestHostComponents 注入 -->
    <Teleport to="body">
      <Transition name="center-modal">
        <div
          v-if="showFileExplorer && fileExplorerSessionId"
          class="fixed inset-0 z-[100] flex items-center justify-center p-[10%] mobile-ui"
          data-bedcode-surface
        >
          <div
            class="absolute inset-0 bg-[var(--mobile-overlay-heavy)]"
            @click="showFileExplorer = false"
          ></div>
          <div
            class="relative w-full h-full bg-[var(--mobile-bg-card)] border border-[var(--mobile-border)] rounded-[var(--bc-radius-card)] bc-overlay-panel overflow-hidden flex flex-col modal-panel"
          >
            <FileExplorer
              :session-id="fileExplorerSessionId"
              mode="emit"
              :title="effectiveDirLabel"
              @close="showFileExplorer = false"
              @navigate-settings="handleNavigateSettings"
            />
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 目标选择弹层（项目 / agent 共用；自绘 bottom-sheet，禁原生 select） -->
    <Teleport to="body">
      <Transition name="bottom-sheet">
        <div
          v-if="picker"
          class="att-picker-overlay mobile-ui"
          data-bedcode-surface
          @click.self="picker = null"
        >
          <div class="att-picker-sheet modal-panel">
            <h4 class="att-picker-title">
              {{ picker === 'project' ? t('preset.project') : t('preset.agent') }}
            </h4>
            <div
              v-if="picker === 'project' && projects.length === 0"
              class="att-picker-empty-state"
            >
              {{ t('preset.projectEmpty') }}
            </div>
            <div
              v-else-if="picker === 'agent' && agentOptions.length === 0"
              class="att-picker-empty-state"
            >
              {{ t('preset.agentEmpty') }}
            </div>
            <div v-else class="att-picker-list">
              <template v-if="picker === 'project'">
                <button
                  v-for="project in projects"
                  :key="project.id"
                  class="att-picker-item"
                  :class="{ 'att-picker-item-active': project.id === selectedProjectId }"
                  @click="selectProject(project)"
                >
                  <span class="att-picker-item-name">{{ project.name || project.workingDir }}</span>
                  <span class="att-picker-item-sub">{{ project.workingDir }}</span>
                </button>
              </template>
              <template v-else>
                <button
                  v-for="agent in agentOptions"
                  :key="agent.id"
                  class="att-picker-item"
                  :class="{ 'att-picker-item-active': agent.id === selectedAgentId }"
                  @click="selectAgent(agent)"
                >
                  <span class="att-picker-item-name">{{ agent.displayName }}</span>
                  <span class="att-picker-item-sub">{{ agent.binary }}</span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 删除二次确认（防误触） -->
    <Modal v-model="showDeleteConfirm" :title="t('preset.delete')" size="sm">
      <p
        class="rounded-lg p-3 line-clamp-3"
        style="background: var(--mobile-bg-primary); color: var(--mobile-row-title)"
      >
        {{ pendingDeleteTask?.content }}
      </p>
      <template #footer>
        <div class="flex justify-end gap-3">
          <Button variant="ghost" @click="showDeleteConfirm = false">{{ t('cancel') }}</Button>
          <Button variant="danger" @click="confirmDelete">{{ t('delete') }}</Button>
        </div>
      </template>
    </Modal>

    <!-- 执行目标：运行中的会话与「启动新会话」并列选择，选定后再进确认 -->
    <Modal v-model="showTargetPicker" :title="t('preset.selectTarget')" size="sm">
      <p class="group-row-sub mb-2">{{ t('preset.selectTargetHint') }}</p>
      <p v-if="pendingCandidates.length === 0" class="group-row-sub text-center py-2">
        {{ t('preset.noActiveSessions') }}
      </p>
      <div v-else class="space-y-2 max-h-60 overflow-y-auto">
        <button
          v-for="session in pendingCandidates"
          :key="session.id"
          class="w-full text-left px-4 py-3 rounded-xl transition-colors active:opacity-80"
          style="background: var(--mobile-bg-primary); border: 1px solid var(--mobile-group-border)"
          data-testid="mobile-preset-session-row"
          @click="chooseRunningSession(session.id)"
        >
          <p class="group-row-title">{{ session.name }}</p>
          <p class="group-row-sub font-mono mt-0.5">{{ session.id.slice(0, 8) }}</p>
        </button>
      </div>

      <!-- 启动新会话：起会话必须带项目 × Agent，故只对已绑定目标的预设提供；
           且走的是真入队（不是直写终端），不可入队的预设一并禁用 -->
      <div class="mt-3 pt-3" style="border-top: 1px solid var(--mobile-group-border)">
        <button
          v-if="pendingStartTarget"
          class="w-full text-left px-4 py-3 rounded-xl transition-colors active:opacity-80 disabled:opacity-50"
          style="
            background: var(--mobile-accent-secondary);
            border: 1px solid var(--mobile-border-active);
          "
          :disabled="!canEnqueueTask"
          data-testid="mobile-preset-start-new-session"
          @click="chooseNewSession"
        >
          <p class="group-row-title" style="color: var(--mobile-accent)">
            {{ t('preset.startNewSession') }}
          </p>
          <p class="group-row-sub mt-0.5">{{ pendingStartTargetLabel }}</p>
        </button>
        <p v-else class="group-row-sub py-2 text-center">
          {{ t('preset.startNewSessionNeedsTarget') }}
        </p>
        <p v-if="pendingStartTarget && !canEnqueueTask" class="group-row-sub mt-2 text-center">
          {{ t('preset.startNewSessionLocked') }}
        </p>
      </div>

      <template #footer>
        <div class="flex justify-end">
          <Button variant="ghost" @click="showTargetPicker = false">{{ t('cancel') }}</Button>
        </div>
      </template>
    </Modal>

    <!-- 执行确认：把将要发出的指令原文摆出来，避免误发 -->
    <Modal
      v-model="showExecuteConfirm"
      :title="t('preset.confirmExecute')"
      :closable="!startingNewSession"
      :close-on-backdrop="!startingNewSession"
      size="sm"
    >
      <p class="text-[var(--font-size-base)] mb-1" style="color: var(--mobile-text-muted)">
        {{
          executeMode === 'new' ? t('preset.willStartNewSession') : t('preset.willSendToTerminal')
        }}
      </p>
      <p v-if="executeMode === 'new'" class="group-row-sub mb-2">{{ pendingStartTargetLabel }}</p>
      <p
        class="rounded-lg p-3 line-clamp-3"
        style="background: var(--mobile-bg-primary); color: var(--mobile-row-title)"
      >
        {{ pendingTask?.content }}
      </p>
      <template #footer>
        <div class="flex justify-end gap-3">
          <Button
            variant="ghost"
            :disabled="startingNewSession"
            @click="showExecuteConfirm = false"
          >
            {{ t('cancel') }}
          </Button>
          <Button
            :loading="startingNewSession"
            data-testid="mobile-preset-execute-confirm"
            @click="doExecute"
          >
            {{ executeMode === 'new' ? t('preset.startAndExecute') : t('preset.execute') }}
          </Button>
        </div>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
/**
 * PresetTasksTab — 预设任务页签
 *
 * 还原旧宿主 `src/views/PresetTasksView.vue`（票 2026-10-09 阶段 B 随旧宿主 UI
 * 退役删除，`b84767916` 前最后一个版本）。旧页是二级路由页，自带页头与返回键；本页是
 * 任务域的首个页签，页头由 app 域统一出，故去掉旧页头与返回，标题语义由任务页承担。
 *
 * 与弹窗版实现（`TaskEditDialog`）的关键差异：**新增 / 编辑不弹窗**——编辑表单
 * （任务内容 + AI 模板 + 工程目录 + 添加/保存按钮）常驻页面顶部，
 * 语义与交互对齐旧宿主 PresetTasksView；文件浏览 / 删除确认 / 执行目标选择 / 执行确认
 * 仍走弹层（与旧页一致，弹层是「选择或确认」而非「录入」）。
 * 执行目标弹层同时提供「运行中的会话」与「启动新会话」两条路：后者先经
 * `bedcode.start-run` 起运行，再把这任务入队并开自动执行（不直写终端，见
 * `startInNewSession` 注释）。
 *
 * 真源经 SDK `getPresetTasks()`（宿主 usePresetTasks 共享模块）读写，本页不持有状态；
 * 与终端任务选择器、任务面板同一份预设任务真源。
 * 未连接时的引导由「toast + 跳转连接页」改为 toast + 向 app 域发 `open-connection`
 * （与会话页的 `@open-connection` 同一通道，页签切换归 app 域）。
 */
import { ref, computed, onMounted, nextTick } from 'vue'
import { getMobileApi } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { getDirectorySessions, refreshSessionDirectory } from '../../host/sessionDirectory'
import { fetchAgents, fetchProjects, startRun } from '../../projects/api'
import type { AgentEntry, ProjectView } from '../../projects/types'
import { getAutoTaskApi } from '../api'
import { getPresetTarget, removePresetTarget, setPresetTarget } from '../presetTargets'
import { usePresetTasks } from '../presetApi'
import { readStoredDisplaySettings } from '../../terminal/displaySettings'
import { computeDeviceDefaultGridSize } from '../../terminal/utils/metrics'
import type { PresetTask } from '../../terminal/model'
import PresetTaskCard from './PresetTaskCard.vue'
// issue #24：FileExplorer 自宿主提供组件（wasmnestHostComponents provide/inject）迁入本 app
// fileExplorer 域，改为直接 import；挂载契约（props / events）不变
import FileExplorer from '../../fileExplorer/components/FileExplorer.vue'
import Modal from '../../host/components/ui/Modal.vue'
import Button from '../../host/components/ui/Button.vue'

const props = defineProps<{ context: PluginContext }>()

const emit = defineEmits<{ 'open-connection': [] }>()

const t = (key: string): string => props.context.i18n.t(key)
/** 轻提示（宿主 toast；宿主 dialogs 只有一个 showToast(message, type) 函数，非对象） */
const toast = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') =>
  props.context.dialogs.showToast(message, type)

const connection = getMobileApi()
const {
  tasks,
  load,
  addTask,
  updateTask,
  deleteTask,
  executeTask,
  reconcileWithQueue,
  canEnqueue,
  markEnqueued,
} = usePresetTasks()

// ==================== 宿主连接事实 ====================

const isConnected = computed(() => connection.isConnected.value === true)
const activeSessionId = computed(() => connection.activeSessionId.value || '')
/**
 * 可执行目标会话：只含运行中的会话（会话目录同时保存已停止会话，
 * 对它们下发输入必吃「会话不存在 / 无 PTY 句柄」→ 用户看到「发送失败」）。
 * waitingInput 也算运行中（会话在等 Agent 输入，PTY 仍可写），与宿主
 * runningSessionCount 同一判据。
 */
const runningSessions = computed<any[]>(() =>
  getDirectorySessions().filter((s) => s.status === 'running' || s.status === 'waitingInput'),
)
// ==================== 目标选择（项目 × agent） ====================

const picker = ref<'project' | 'agent' | null>(null)
const projects = ref<ProjectView[]>([])
const agents = ref<AgentEntry[]>([])
const supportedAgentIds = ref<Set<string>>(new Set())
const selectedProjectId = ref('')
const selectedAgentId = ref('')

const projectsById = computed(() => new Map(projects.value.map((project) => [project.id, project])))
const agentsById = computed(() => new Map(agents.value.map((agent) => [agent.id, agent])))
const agentOptions = computed(() =>
  agents.value.filter((agent) => supportedAgentIds.value.has(agent.id)),
)
const selectedProjectName = computed(() => {
  const project = projectsById.value.get(selectedProjectId.value)
  return project?.name || project?.workingDir || ''
})
const selectedAgentName = computed(() => {
  const id = selectedAgentId.value
  if (!id) return ''
  return agentsById.value.get(id)?.displayName || id
})

function openPicker(kind: 'project' | 'agent'): void {
  picker.value = kind
  // 每次打开都刷新清单：配对 / 新项目 / 新装 agent 后无需重进页面
  void loadTargets()
}

function selectProject(project: ProjectView): void {
  selectedProjectId.value = project.id
  selectedAgentId.value = ''
  picker.value = null
}

function selectAgent(agent: AgentEntry): void {
  selectedAgentId.value = agent.id
  picker.value = null
}

/** 当前编辑区的目标（项目 + agent 都选才生效） */
function draftTarget(): { projectId: string; agentId: string } | null {
  return selectedProjectId.value && selectedAgentId.value
    ? { projectId: selectedProjectId.value, agentId: selectedAgentId.value }
    : null
}

/** 目标文案：项目 · agent（id 兜底，不伪造名称） */
function formatTarget(target: ReturnType<typeof getPresetTarget>): string {
  if (!target) return ''
  const project = projectsById.value.get(target.projectId)
  const agent = agentsById.value.get(target.agentId)
  return [
    project?.name || project?.workingDir || target.projectId,
    agent?.displayName || target.agentId,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** 预设行目标文案：项目 · agent（未绑定 → 提示） */
function targetLabel(task: PresetTask): string {
  const label = formatTarget(getPresetTarget(task.id))
  return label || t('preset.targetUnbound')
}

/** 拉项目 / agent 清单（项目走 bedcode.list-projects；agent 取注册表 ∩ 任务域白名单） */
async function loadTargets(): Promise<void> {
  const [projectResult, agentResult, supportedResult] = await Promise.allSettled([
    fetchProjects(props.context),
    fetchAgents(props.context),
    getAutoTaskApi().httpListSupportedAgents(),
  ])
  projects.value = projectResult.status === 'fulfilled' ? projectResult.value : []
  agents.value = agentResult.status === 'fulfilled' ? agentResult.value : []
  const supported = supportedResult.status === 'fulfilled' ? supportedResult.value : null
  supportedAgentIds.value = new Set(supported?.code === 0 ? (supported.data?.agents ?? []) : [])
  for (const result of [projectResult, agentResult, supportedResult]) {
    if (result.status === 'rejected') {
      props.context.logger.warn(
        `[task] preset targets load failed: ${
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        }`,
      )
    }
  }
}

// ==================== 顶部编辑区域（常驻，非弹窗） ====================

/** AI 编程提示词标准 4 要素模板（与原 TaskEditDialog 一致） */
const AI_TEMPLATE = '目标：\n上下文：\n约束：\n完成条件：'

const contentScrollRef = ref<HTMLDivElement | null>(null)
const contentTextarea = ref<HTMLTextAreaElement | null>(null)
const draftContent = ref('')
/** 非空时为编辑模式：内容来自对应任务，点击按钮保存修改 */
const editingTask = ref<PresetTask | null>(null)

/** 检测内容中是否已包含模板要素 */
const hasAiTemplate = computed(() => {
  const c = draftContent.value
  return (
    c.includes('目标：') &&
    c.includes('上下文：') &&
    c.includes('约束：') &&
    c.includes('完成条件：')
  )
})

/** 插入 AI 提示词模板（仅当内容中尚未包含时） */
function insertAiTemplate(): void {
  if (hasAiTemplate.value) return
  const current = draftContent.value.trim()
  draftContent.value = current ? `${current}\n${AI_TEMPLATE}` : AI_TEMPLATE
  autosizeTextarea()
}

/** 自动增高 textarea：先置 auto 再取 scrollHeight，钳制到上限后由 overflow-y 滚动 */
function autosizeTextarea(): void {
  const el = contentTextarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 280)}px`
}

/** 回车提交（IME 组词中的回车不触发），Shift+Enter 换行 */
function submitOnEnter(handler: () => void) {
  return (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      handler()
    }
  }
}

/** 添加或保存修改：生成/更新任务卡片条，并保持输入框焦点方便连续添加 */
async function handleAdd(): Promise<void> {
  const content = draftContent.value.trim()
  if (!content) return
  const target = draftTarget()

  if (editingTask.value) {
    await updateTask({ ...editingTask.value, content })
    setPresetTarget(editingTask.value.id, target)
  } else {
    await addTask({ content })
    // 宿主 addTask 同步 push 到 tasks；新任务即最后一条，用它写目标
    const created = tasks.value[tasks.value.length - 1]
    if (created) setPresetTarget(created.id, target)
  }

  draftContent.value = ''
  editingTask.value = null
  nextTick(() => {
    autosizeTextarea()
    contentTextarea.value?.focus()
  })
}

/** 卡片编辑：把任务内容与目标载入顶部编辑区域，滚动到页面顶部并聚焦 */
function openEditTask(task: PresetTask): void {
  editingTask.value = task
  draftContent.value = task.content
  const target = getPresetTarget(task.id)
  selectedProjectId.value = target?.projectId ?? ''
  selectedAgentId.value = target?.agentId ?? ''
  contentScrollRef.value?.scrollTo?.({ top: 0, behavior: 'smooth' })
  nextTick(() => {
    autosizeTextarea()
    contentTextarea.value?.focus()
  })
}

// ==================== 文件浏览入口 ====================

const showFileExplorer = ref(false)

/** 用于 FileExplorer 标题的项目标签 */
const effectiveDirLabel = computed(() => selectedProjectName.value || t('toolbox.selectProject'))

/** 选中目标对应的活跃运行 id（用于 FileExplorer）；无 → 当前活动会话 */
const fileExplorerSessionId = computed(() => {
  if (!selectedProjectId.value || !selectedAgentId.value) return activeSessionId.value || ''
  const session = runningSessions.value.find(
    (s: any) => s.projectId === selectedProjectId.value && s.agentId === selectedAgentId.value,
  )
  return session?.id || activeSessionId.value || ''
})

/** 文件浏览未连接（base URL 缺失）→ 关闭浏览弹层并引导回连接页 */
function handleNavigateSettings(): void {
  showFileExplorer.value = false
  emit('open-connection')
}

// ==================== 删除 ====================

const showDeleteConfirm = ref(false)
const pendingDeleteTask = ref<PresetTask | null>(null)

function askDelete(id: string): void {
  pendingDeleteTask.value = tasks.value.find((task: PresetTask) => task.id === id) ?? null
  showDeleteConfirm.value = true
}

async function confirmDelete(): Promise<void> {
  const id = pendingDeleteTask.value?.id
  showDeleteConfirm.value = false
  pendingDeleteTask.value = null
  if (!id) return
  await deleteTask(id)
  removePresetTarget(id)
  // 删掉的正是正在编辑的任务时一并退出编辑态，避免下次保存带出已不存在的任务
  if (editingTask.value?.id === id) {
    editingTask.value = null
    draftContent.value = ''
  }
}

// ==================== 执行流程 ====================

const showTargetPicker = ref(false)
const showExecuteConfirm = ref(false)
/** 本次执行的目标形态：运行中的会话 / 为预设启动新会话 */
const executeMode = ref<'session' | 'new'>('session')
const pendingTask = ref<PresetTask | null>(null)
const pendingSessionId = ref('')
/** 起新会话进行中（防重复点击；确认键转 loading） */
const startingNewSession = ref(false)

/** 当前预设可投递的运行：有目标时只认同项目 + agent 的运行；未绑定回退全部运行 */
function sessionsForTask(task: PresetTask): any[] {
  const target = getPresetTarget(task.id)
  if (!target) return runningSessions.value
  return runningSessions.value.filter(
    (s: any) => s.projectId === target.projectId && s.agentId === target.agentId,
  )
}

/** 弹层里的运行候选（计算属性：会话目录刷新后列表自动跟上） */
const pendingCandidates = computed(() =>
  pendingTask.value ? sessionsForTask(pendingTask.value) : [],
)

/** 起新会话的目标（预设已绑定项目 × Agent 才有；未绑定不能起会话） */
const pendingStartTarget = computed(() =>
  pendingTask.value ? getPresetTarget(pendingTask.value.id) : null,
)
const pendingStartTargetLabel = computed(() => formatTarget(pendingStartTarget.value))
/** 新会话路径是**真入队**：执行中的预设不得再排 */
const canEnqueueTask = computed(() => (pendingTask.value ? canEnqueue(pendingTask.value) : false))

/**
 * 执行入口：未连接 → toast 引导去连接页；已连接 → 总开目标弹层
 *
 * 不再「单运行直接跳确认」：弹层同时承担「选运行中的会话」与「启动新会话」两条路，
 * 自动跳过会让后一条路永远不可达（一条运行也没有时更只能从这里起会话）。
 */
function startExecuteFlow(task: PresetTask): void {
  if (!isConnected.value) {
    toast(t('preset.connectFirst'), 'warning')
    emit('open-connection')
    return
  }
  pendingTask.value = task
  pendingSessionId.value = ''
  executeMode.value = 'session'
  showTargetPicker.value = true
}

/** 选一个运行中的会话 → 进确认 */
function chooseRunningSession(sessionId: string): void {
  showTargetPicker.value = false
  pendingSessionId.value = sessionId
  executeMode.value = 'session'
  showExecuteConfirm.value = true
}

/** 选「启动新会话并执行」→ 进确认（确认文案会说明是起新会话 + 入队） */
function chooseNewSession(): void {
  if (!pendingStartTarget.value || !canEnqueueTask.value) return
  showTargetPicker.value = false
  pendingSessionId.value = ''
  executeMode.value = 'new'
  showExecuteConfirm.value = true
}

/** 本端预估终端网格（与项目页启动同源：避免手机起的运行先画一屏 120 列） */
function initialRunGrid(): { cols: number; rows: number } | undefined {
  const settings = readStoredDisplaySettings()
  const grid = computeDeviceDefaultGridSize(settings.fontSize, settings.letterSpacing)
  return grid.cols > 0 && grid.rows > 0 ? grid : undefined
}

/** 收尾：清空本次执行的待定态（成功/失败都要回到干净状态） */
function resetExecuteState(): void {
  pendingTask.value = null
  pendingSessionId.value = ''
  executeMode.value = 'session'
}

async function doExecute(): Promise<void> {
  const task = pendingTask.value
  if (!task || startingNewSession.value) return
  if (executeMode.value === 'new') {
    // 确认弹层保持打开（按钮转 loading）到起会话 + 入队落定，不留无反馈空窗
    await startInNewSession(task)
    showExecuteConfirm.value = false
    return
  }

  const sessionId = pendingSessionId.value
  showExecuteConfirm.value = false
  if (!sessionId) return

  try {
    await executeTask(task, sessionId)
    toast(t('preset.sentToTerminal'), 'success')
  } catch (e) {
    props.context.logger.error(
      `[task] preset task execute failed: ${e instanceof Error ? e.message : String(e)}`,
    )
    toast(t('preset.sendFailed'), 'error')
  }
  resetExecuteState()
}

/**
 * 启动新会话并在其中执行预设（入队 + 自动执行）
 *
 * 不直写终端，改走任务队列（桌面「预设 → 队列 → 新会话」同一条链）：
 * 1. `bedcode.start-run` 起运行（项目 × Agent + 本端网格）；
 * 2. `task-queue/add` 入队（新会话 auto_execute 默认关，入队本身不触发下发）；
 * 3. `session-mode` 开自动执行 → 由桌面任务调度链出队下发（统一写任务行 +
 *    统一提交符，完成/中断按 task_id 回传本端）；
 * 4. 本地记入队（预设 = 执行中），完成/中断由队列广播与对账细化。
 *
 * 时序口径：真源里「等 agent idle 再下发」的门控（`task/scheduled.rs`、
 * `task/config_queue.rs`）只存在于桌面内部路径；移动端可用的 HTTP 面在开自动
 * 执行时即触发首次调度，因此本路径是「起会话后立即入队下发」——比直写终端多一层
 * 调度链记账，但**不是** idle 门控（要门控需桌面新增原子端点，另立项）。
 *
 * 失败口径：会话未起 → 报错（预设保持可重试）；会话已起但入队/开自动失败 →
 * 回滚刚入队的队列项并明说「新会话已启动但任务未入队」，不留半截静默态。
 */
async function startInNewSession(task: PresetTask): Promise<void> {
  const target = getPresetTarget(task.id)
  if (!target) {
    toast(t('preset.startNewSessionNeedsTarget'), 'warning')
    resetExecuteState()
    return
  }
  if (!canEnqueue(task)) {
    toast(t('preset.startNewSessionLocked'), 'warning')
    resetExecuteState()
    return
  }

  const api = getAutoTaskApi()
  startingNewSession.value = true
  let runId = ''
  let taskId = ''
  try {
    const created = await startRun(
      props.context,
      target.projectId,
      target.agentId,
      initialRunGrid(),
    )
    runId = created.runId

    const queued = await api.httpTaskQueueAdd(runId, task.content)
    if (queued.code !== 0 || !queued.data?.task_id) {
      throw new Error(queued.message || 'preset.sendFailed')
    }
    taskId = queued.data.task_id

    const mode = await api.httpSetSessionMode(runId, true, undefined)
    if (mode.code !== 0) throw new Error(mode.message || 'preset.sendFailed')

    markEnqueued(task.id, taskId, runId)
    toast(t('preset.newSessionStarted'), 'success')
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    props.context.logger.error(`[task] preset new-session execute failed: ${detail}`)
    // 已入队但没开成自动执行：撤回队列项，避免「队列里挂着永不执行的任务」
    if (runId && taskId) {
      try {
        await api.httpTaskQueueRemove(runId, taskId)
      } catch (removeError) {
        props.context.logger.warn(
          `[task] preset queue rollback failed: ${
            removeError instanceof Error ? removeError.message : String(removeError)
          }`,
        )
      }
    }
    toast(
      `${t(runId ? 'preset.newSessionPartialFailed' : 'preset.newSessionFailed')}: ${t(detail)}`,
      'error',
    )
  } finally {
    startingNewSession.value = false
    resetExecuteState()
    // 新运行要让会话目录立刻可见（终端/任务面按同一目录取目标）
    if (runId) void refreshSessionDirectory({ force: true })
  }
}

onMounted(async () => {
  void loadTargets()
  await load()
  // 对账：进入本页时，若有「执行中」预设的队列项已不在该会话 pending 队列中，
  // 落「已中断」（WS 广播不可靠时的兜底，语义与旧 PresetTasksView 一致）。
  // 仅对运行中的会话对账：轮换后旧会话队列已迁到新会话，查旧会话空队列会把
  // 仍在执行的任务误判为中断。
  const sid = activeSessionId.value
  if (sid && runningSessions.value.some((s: any) => s.id === sid)) {
    await reconcileWithQueue(sid)
  }
})
</script>

<style scoped>
/* 任务内容输入框：token 绑定 + 聚焦态（配合 autosizeTextarea 的 JS 高度自适应） */
.content-input {
  background: var(--mobile-bg-primary);
  border: 1px solid var(--mobile-border-hover);
  color: var(--mobile-text-primary);
  font-size: var(--font-size-base);
  line-height: 1.5;
  max-height: 280px;
  outline: none;
}

.content-input::placeholder {
  color: var(--mobile-text-disabled);
}

.content-input:focus {
  border-color: color-mix(in srgb, var(--mobile-accent) 50%, transparent);
}

</style>
