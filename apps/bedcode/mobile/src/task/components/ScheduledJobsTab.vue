<template>
  <div class="att-tab-body">
    <div ref="scrollEl" class="att-scroll" :style="scrollStyle">
      <!-- 创建入口 -->
      <button v-if="!formOpen" class="att-create-btn" @click="openCreateForm()">
        <svg class="att-create-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 4v16m8-8H4"
          />
        </svg>
        {{ t('scheduled.create.title') }}
      </button>

      <!-- 创建表单（折叠展开） -->
      <div v-if="formOpen" class="att-form" :style="formStyle">
        <div class="att-form-head">
          <h4 class="att-form-title">{{ t('scheduled.create.title') }}</h4>
          <button class="att-form-close" @click="props.scheduled.closeForm()">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <!-- 名称（可选） -->
        <label class="att-field-label">{{ t('scheduled.create.name') }}</label>
        <input
          v-model="props.scheduled.formName.value"
          type="text"
          class="att-input"
          :placeholder="t('scheduled.create.namePlaceholder')"
        />

        <!-- 目标：项目 + agent（自绘选择：点击展开列表弹层，禁原生 select） -->
        <label class="att-field-label">{{ t('scheduled.create.project') }}</label>
        <button
          class="att-picker-btn"
          :class="{ 'att-picker-empty': !selectedProjectName }"
          @click="openPicker('project')"
        >
          <span>{{ selectedProjectName || t('scheduled.create.projectPlaceholder') }}</span>
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        <label class="att-field-label">{{ t('scheduled.create.agent') }}</label>
        <button
          class="att-picker-btn"
          :class="{ 'att-picker-empty': !selectedAgentName }"
          :disabled="!props.scheduled.formProjectId.value"
          @click="openPicker('agent')"
        >
          <span>{{ selectedAgentName || t('scheduled.create.agentPlaceholder') }}</span>
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        <!-- 触发时间（@vuepic/vue-datepicker，主题已由插件入口注入覆盖） -->
        <label class="att-field-label">{{ t('scheduled.create.triggerAt') }}</label>
        <Datepicker
          ref="dpRef"
          v-model="props.scheduled.formTriggerAt.value"
          :format="dateFormat"
          :locale="dateLocale"
          :dark="isDark"
          :clearable="true"
          :enable-time-picker="true"
          :select-text="dpSelectText"
          :cancel-text="dpCancelText"
          :now-button-label="dpNowLabel"
          :action-row="{ showNow: true }"
          :teleport="'body'"
          :placeholder="t('scheduled.create.triggerAtPlaceholder')"
        />
        <p class="att-utc-hint">
          {{ t('scheduled.create.utcHint', { time: props.scheduled.utcPreview.value }) }}
        </p>

        <!-- 指令列表（每行一条，可增删） -->
        <label class="att-field-label">{{ t('scheduled.create.prompts') }}</label>
        <div
          v-for="(_, index) in props.scheduled.formPrompts.value"
          :key="index"
          class="att-prompt-row"
        >
          <input
            v-model="props.scheduled.formPrompts.value[index]"
            type="text"
            class="att-input att-prompt-input"
            :placeholder="t('scheduled.create.promptPlaceholder')"
          />
          <button
            class="att-prompt-remove"
            :title="t('scheduled.create.removePrompt')"
            @click="props.scheduled.removePrompt(index)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <button class="att-add-prompt" @click="props.scheduled.addPrompt()">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 4v16m8-8H4"
            />
          </svg>
          {{ t('scheduled.create.addPrompt') }}
        </button>

        <div class="att-form-actions">
          <button
            class="att-form-cancel"
            :disabled="props.scheduled.submitting.value"
            @click="props.scheduled.closeForm()"
          >
            {{ t('scheduled.create.cancel') }}
          </button>
          <button
            class="att-form-submit"
            :disabled="props.scheduled.submitting.value"
            @click="props.scheduled.submit()"
          >
            {{ t('scheduled.create.submit') }}
          </button>
        </div>
      </div>

      <!-- 未连接空态 -->
      <div v-if="!formOpen && offline && jobs.length === 0" class="att-state">
        <svg class="att-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m9.9 2.828a5 5 0 010 7.072m-7.072 0a5 5 0 010-7.072M12 12h.01"
          />
        </svg>
        <p>{{ t('scheduled.offline') }}</p>
      </div>

      <!-- 首屏加载 -->
      <div v-else-if="!formOpen && loading && jobs.length === 0" class="att-state">
        <p>{{ t('scheduled.loading') }}</p>
      </div>

      <!-- 空态 -->
      <div v-else-if="!formOpen && jobs.length === 0" class="att-state">
        <svg class="att-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p>{{ t('scheduled.empty') }}</p>
      </div>

      <!-- 定时任务列表 -->
      <div v-else class="att-list">
        <div v-for="job in jobs" :key="job.id" class="att-row">
          <div class="att-row-head">
            <p class="att-row-title">{{ job.name || t('scheduled.defaultName') }}</p>
            <span class="att-badge" :style="badgeStyle(job.status)">{{
              statusLabel(job.status)
            }}</span>
          </div>
          <div class="att-row-meta">
            <span class="att-meta-item"
              >{{ t('scheduled.field.target') }}: {{ targetLabel(job) }}</span
            >
            <span class="att-meta-item"
              >{{ t('scheduled.field.triggerAt') }}: {{ utcToLocalDisplay(job.trigger_at) }}</span
            >
            <span v-if="job.executed_at" class="att-meta-item"
              >{{ t('scheduled.field.executedAt') }}: {{ utcToLocalDisplay(job.executed_at) }}</span
            >
          </div>
          <div v-if="promptPreview(job).length > 0" class="att-row-prompts">
            <span v-for="(p, i) in promptPreview(job)" :key="i" class="att-prompt-chip">{{
              p
            }}</span>
          </div>
          <p v-if="job.status === 'failed' && job.error" class="att-row-error">
            {{ t('scheduled.field.error') }}: {{ job.error }}
          </p>
        </div>
      </div>
    </div>

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
              {{
                picker === 'project' ? t('scheduled.create.project') : t('scheduled.create.agent')
              }}
            </h4>
            <div
              v-if="picker === 'project' && projects.length === 0"
              class="att-picker-empty-state"
            >
              {{ t('scheduled.create.projectEmpty') }}
            </div>
            <div
              v-else-if="picker === 'agent' && agentOptions.length === 0"
              class="att-picker-empty-state"
            >
              {{ t('scheduled.create.agentEmpty') }}
            </div>
            <div v-else class="att-picker-list">
              <template v-if="picker === 'project'">
                <button
                  v-for="project in projects"
                  :key="project.id"
                  class="att-picker-item"
                  :class="{
                    'att-picker-item-active': project.id === props.scheduled.formProjectId.value,
                  }"
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
                  :class="{
                    'att-picker-item-active': agent.id === props.scheduled.formAgentId.value,
                  }"
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
  </div>
</template>

<script setup lang="ts">
/**
 * ScheduledJobsTab — 定时任务页（纯 UI）
 *
 * 列表 + 创建表单状态/提交逻辑在 useScheduledJobs composable；本组件只做
 * 渲染与轻交互（配置选择弹层、日期选择器绑定、键盘避让样式）。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Datepicker from '@vuepic/vue-datepicker'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { getI18n } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { ScheduledJobsComposable, ScheduledJob } from '../composables/useScheduledJobs'
import { parsePrompts } from '../composables/useScheduledJobs'
import { utcToLocalDisplay } from '../composables/useTaskHistory'
import { fetchAgents, fetchProjects } from '../../projects/api'
import type { AgentEntry, ProjectView } from '../../projects/types'
import { getAutoTaskApi } from '../api'

const props = defineProps<{
  context: PluginContext
  scheduled: ScheduledJobsComposable
}>()

const t = (key: string, params?: Record<string, any>): string => props.context.i18n.t(key, params)

// 解构 ref：模板顶层自动解包
// 注意：formOpen 必须一并解构，模板中裸用 formOpen（v-if 创建表单/空态分支）
// 依赖此绑定，缺失会导致点击「创建定时任务」无反应（undefined 恒为假）
const { jobs, loading, offline, formOpen } = props.scheduled

// ==================== 目标选择（项目 × agent） ====================

const picker = ref<'project' | 'agent' | null>(null)
const projects = ref<ProjectView[]>([])
const agents = ref<AgentEntry[]>([])
/** 任务域支持的 agent（后端 supported-agents 白名单） */
const supportedAgentIds = ref<Set<string>>(new Set())

const projectsById = computed(() => new Map(projects.value.map((project) => [project.id, project])))
const agentsById = computed(() => new Map(agents.value.map((agent) => [agent.id, agent])))

const selectedProjectName = computed(() => {
  const id = props.scheduled.formProjectId.value
  if (!id) return ''
  const project = projectsById.value.get(id)
  return project?.name || project?.workingDir || id
})

const agentOptions = computed(() =>
  agents.value.filter((agent) => supportedAgentIds.value.has(agent.id)),
)

const selectedAgentName = computed(() => {
  const id = props.scheduled.formAgentId.value
  if (!id) return ''
  return agentsById.value.get(id)?.displayName || id
})

function openPicker(kind: 'project' | 'agent'): void {
  picker.value = kind
  // 每次打开都刷新清单：配对 / 新项目 / 新装 agent 后无需重进页面
  void loadTargets()
}

function openCreateForm(): void {
  props.scheduled.openForm()
  // 每次打开都刷新清单：配对 / 新项目 / 新装 agent 后无需重进页面
  void loadTargets()
}

function selectProject(project: ProjectView): void {
  props.scheduled.formProjectId.value = project.id
  // 项目变了，agent 必须重选（不同项目的可用 agent 可能不同）
  props.scheduled.formAgentId.value = ''
  picker.value = null
}

function selectAgent(agent: AgentEntry): void {
  props.scheduled.formAgentId.value = agent.id
  picker.value = null
}

/** 定时任务行目标文案：项目 · agent（历史行可能只有 config_id） */
function targetLabel(job: ScheduledJob): string {
  const project = job.project_id ? projectsById.value.get(job.project_id) : undefined
  const agent = job.agent_id ? agentsById.value.get(job.agent_id) : undefined
  const projectName = project?.name || project?.workingDir || job.project_id || ''
  const agentName = agent?.displayName || job.agent_id || ''
  if (projectName || agentName) return [projectName, agentName].filter(Boolean).join(' · ')
  return job.config_id || t('scheduled.field.targetUnbound')
}

/** 拉目标清单：项目走 bedcode.list-projects，agent 取注册表 ∩ 任务域支持清单 */
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
        `[task] scheduled targets load failed: ${
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        }`,
      )
    }
  }
}

// ==================== 日期选择器（@vuepic/vue-datepicker） ====================

// 深色模式跟随宿主 documentElement.dark class（宿主 useTheme 维护），
// MutationObserver 联动 Datepicker dark prop
const isDark = ref(document.documentElement.classList.contains('dark'))
let themeObserver: MutationObserver | null = null

// 输入/回填格式，与桌面端显示习惯一致
const dateFormat = 'yyyy-MM-dd HH:mm'

// 跟随宿主语言（zh-CN / en），供 Datepicker 渲染对应语言日历
const dateLocale = computed(() => getI18n()?.global?.locale?.value ?? 'zh-CN')

// v9 底部操作按钮默认英文，不跟随 locale，需按当前语言传入
const dpSelectText = computed(() => t('confirm'))
const dpCancelText = computed(() => t('cancel'))
const dpNowLabel = computed(() => t('datepickerNow'))

// ==================== 日期选择器 bottom-sheet 联动 ====================
//
// 菜单经 teleport 挂到 body，脱离 .mobile-ui 作用域：浅色模式（含自定义调色板）
// 下拿不到宿主 token，遮罩空白点击也不会关闭（库的 onClickOutside 以遮罩元素为界）。
// 此处补齐两件事：
// 1) 菜单出现时把宿主 token 复制到遮罩元素（随主题/调色板即时生效）
// 2) 遮罩空白（遮罩内、菜单外）点击调用库暴露的 closeMenu 关闭

const dpRef = ref<InstanceType<typeof Datepicker> | null>(null)

/** 弹层引用到的宿主 token（与插件入口 DATEPICKER_THEME_OVERRIDES 引用一致） */
const SHEET_TOKENS = [
  '--mobile-bg-card',
  '--mobile-bg-primary',
  '--mobile-bg-tertiary',
  '--mobile-text-primary',
  '--mobile-text-secondary',
  '--mobile-text-muted',
  '--mobile-text-disabled',
  '--mobile-text-on-accent',
  '--mobile-border',
  '--mobile-border-hover',
  '--mobile-accent',
  '--mobile-overlay-heavy',
] as const

let sheetObserver: MutationObserver | null = null

/** 把宿主（.mobile-ui 作用域内）的 token 值复制到弹层遮罩，保证浅色模式取色正确 */
function syncSheetTokens() {
  const wrapper = document.querySelector<HTMLElement>('.dp__outer_menu_wrap.dp--menu-wrapper')
  const source = document.querySelector('.att-root.mobile-ui')
  if (!wrapper || !source) return
  const cs = getComputedStyle(source)
  for (const name of SHEET_TOKENS) {
    wrapper.style.setProperty(name, cs.getPropertyValue(name))
  }
}

/** 遮罩空白点击关闭（库的 onClickOutside 以遮罩为界，点击遮罩本身不会关闭） */
function onSheetBackdropClick(e: MouseEvent) {
  const wrapper = document.querySelector('.dp__outer_menu_wrap.dp--menu-wrapper')
  const menu = document.querySelector('.dp--menu-wrapper.dp__menu')
  if (!wrapper || !menu) return
  const target = e.target as Node
  if (wrapper.contains(target) && !menu.contains(target)) {
    dpRef.value?.closeMenu()
  }
}

// ==================== 状态展示 ====================

/** 定时任务状态徽标文字 */
function statusLabel(status: string): string {
  const key: Record<string, string> = {
    pending: 'scheduled.status.pending',
    creating: 'scheduled.status.creating',
    executed: 'scheduled.status.executed',
    failed: 'scheduled.status.failed',
    missed: 'scheduled.status.missed',
  }
  return t(key[status] || 'scheduled.status.pending')
}

function badgeStyle(status: string): Record<string, string> {
  const color: Record<string, string> = {
    pending: 'var(--mobile-text-muted)',
    creating: 'var(--mobile-accent)',
    executed: 'var(--mobile-success)',
    failed: 'var(--mobile-error)',
    missed: 'var(--mobile-warning)',
  }
  const c = color[status] || color.pending
  return {
    background: `color-mix(in srgb, ${c} 10%, transparent)`,
    color: c,
  }
}

/** prompts JSON 列 → 数组（最多展示 3 条，其余折叠） */
function promptPreview(job: ScheduledJob): string[] {
  return parsePrompts(job.prompts).slice(0, 3)
}

// ==================== 键盘避让（prompts 输入区，复用 AutoTaskPanelHost 双通道） ====================
//
// 双通道键盘检测（Android adjustNothing 下 WebView 不缩放）：
// 通道 1 visualViewport resize/scroll；通道 2 safeAreaChanged DOM 事件。
// 表单区整体 translateY 上移，底部对齐键盘顶部。

const fullLayoutHeight = ref(window.innerHeight)
const viewportHeight = ref(window.visualViewport?.height ?? window.innerHeight)
const pluginKeyboardHeight = ref(0)

const keyboardOffset = computed(() => {
  const vvOffset = fullLayoutHeight.value - viewportHeight.value
  const offset = Math.max(vvOffset, pluginKeyboardHeight.value)
  return offset > 10 ? offset : 0
})

function handleVisualViewportChange() {
  const vv = window.visualViewport
  if (!vv) return
  if (!keyboardOffset.value) {
    fullLayoutHeight.value = window.innerHeight
  }
  viewportHeight.value = vv.height
}

function handlePluginSafeAreaChange(e: Event) {
  const detail = (e as CustomEvent).detail as {
    keyboardHeight: number
    keyboardVisible: boolean
  }
  pluginKeyboardHeight.value = detail.keyboardVisible ? detail.keyboardHeight : 0
}

/** 表单区键盘避让样式 */
const formStyle = computed(() => {
  const kb = keyboardOffset.value
  if (kb <= 0) return {}
  return { transform: `translateY(-${kb}px)` }
})

/** 列表容器在键盘弹出时压缩高度（与表单上移配合，避免内容顶出屏幕） */
const scrollStyle = computed(() => {
  const kb = keyboardOffset.value
  if (kb <= 0) return {}
  return { maxHeight: `calc(100dvh - ${kb}px)` }
})

const scrollEl = ref<HTMLElement | null>(null)

// ==================== 生命周期 ====================

onMounted(() => {
  void loadTargets()
  // 通道 1: visualViewport
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleVisualViewportChange)
    window.visualViewport.addEventListener('scroll', handleVisualViewportChange)
  }
  // 通道 2: 插件 keyboardHeight
  window.addEventListener('safeAreaChanged', handlePluginSafeAreaChange as EventListener)
  // 日期选择器深色模式联动
  themeObserver = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  // bottom-sheet 联动：菜单挂载时同步宿主 token；遮罩空白点击关闭
  sheetObserver = new MutationObserver(() => {
    syncSheetTokens()
  })
  sheetObserver.observe(document.body, { childList: true })
  document.addEventListener('click', onSheetBackdropClick)
})

onUnmounted(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', handleVisualViewportChange)
    window.visualViewport.removeEventListener('scroll', handleVisualViewportChange)
  }
  window.removeEventListener('safeAreaChanged', handlePluginSafeAreaChange as EventListener)
  themeObserver?.disconnect()
  themeObserver = null
  sheetObserver?.disconnect()
  sheetObserver = null
  document.removeEventListener('click', onSheetBackdropClick)
})
</script>
