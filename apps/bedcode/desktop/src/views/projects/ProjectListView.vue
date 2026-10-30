<template>
  <div class="h-full flex flex-col bg-[var(--bg-page)]" data-testid="projects-view">
    <!-- ==================== 工具栏页头：左标题，右刷新/新建 ==================== -->
    <div class="wb-toolbar">
      <div class="flex items-center gap-2.5">
        <svg
          class="w-4 h-4 text-[var(--text-secondary)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.688-6.75l-.75-1.5a2.25 2.25 0 00-2.013-1.25H6.75A2.25 2.25 0 004.5 5.25v4.5m17.25 3v6.75a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25v-6.75"
          />
        </svg>
        <h2 class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]">
          {{ t('project.sidebar.title') }}
        </h2>
        <span
          v-if="projects.length > 0"
          class="wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
          >{{ projects.length }}</span
        >
      </div>
      <div class="flex items-center gap-2">
        <button class="wb-btn-ghost" data-testid="projects-refresh" @click="refresh">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {{ t('project.button.refresh') }}
        </button>
        <button class="wb-btn-primary" data-testid="projects-create" @click="openCreateDialog">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M12 4v16m8-8H4"
            />
          </svg>
          {{ t('project.button.new') }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-auto px-6 py-6">
      <div class="max-w-5xl mx-auto">
        <!-- Loading -->
        <div v-if="isLoading" class="flex flex-col items-center justify-center py-20">
          <svg
            class="w-5 h-5 animate-spin text-[var(--text-secondary)] mb-3"
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
            ></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v2a6 6 0 00-6 6H4z"
            ></path>
          </svg>
          <p class="wb-mono text-xs text-[var(--text-secondary)]">
            {{ t('session.operating.processing') }}
          </p>
        </div>

        <!-- 空态 -->
        <div
          v-else-if="projects.length === 0"
          class="flex flex-col items-center justify-center py-20"
          data-testid="projects-empty"
        >
          <p class="text-sm text-[var(--text-primary)]">{{ t('project.empty.noProjects') }}</p>
          <p class="text-xs text-[var(--text-secondary)] mt-1 max-w-md text-center">
            {{ t('project.empty.noProjectsHint') }}
          </p>
          <button class="wb-btn-primary mt-5 h-8 px-4" @click="openCreateDialog">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M12 4v16m8-8H4"
              />
            </svg>
            {{ t('project.button.new') }}
          </button>
        </div>

        <!-- 项目卡网格 -->
        <div v-else class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <article
            v-for="project in projects"
            :key="project.id"
            class="rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-4 hover:shadow-sm transition-shadow cursor-pointer"
            data-testid="project-card"
            @click="enterProject(project)"
          >
            <!-- 卡片头：名称 + 执行环境徽标 + 活跃运行数 -->
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-semibold text-[var(--text-primary)] truncate flex-1">
                {{ project.name }}
              </h4>
              <span
                v-if="project.activeRuns > 0"
                class="wb-mono text-[calc(10.5px*var(--ui-scale))] px-1.5 py-0.5 rounded border border-green-600/40 text-green-600 dark:text-green-400 flex items-center gap-1 flex-shrink-0"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                {{ t('project.card.activeRuns', { n: project.activeRuns }) }}
              </span>
              <span
                class="wb-mono text-[calc(10.5px*var(--ui-scale))] uppercase px-1.5 py-0.5 rounded border border-[var(--border-strong)] text-[var(--text-secondary)] flex-shrink-0"
              >
                {{ envBadge(project.environment) }}
              </span>
            </div>

            <!-- 路径（mono，可复制） -->
            <div class="mt-3 flex items-center gap-2 text-[var(--text-secondary)] min-w-0">
              <svg
                class="w-3.5 h-3.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <span class="wb-mono truncate" :title="project.workingDir">{{
                project.workingDir
              }}</span>
            </div>

            <!-- 元信息：最近活动 / 最近 agent / 运行数 -->
            <div
              class="mt-2 flex items-center gap-3 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] flex-wrap"
            >
              <span class="flex items-center gap-1.5">
                <span class="text-[var(--text-tertiary)]">{{
                  t('project.card.lastActivity')
                }}</span>
                <span class="wb-mono text-[var(--text-primary)]">{{
                  activityText(project.lastActivityAt)
                }}</span>
              </span>
              <span v-if="project.lastAgentId" class="flex items-center gap-1.5">
                <span class="text-[var(--text-tertiary)]">{{ t('project.card.lastAgent') }}</span>
                <span class="wb-mono text-[var(--text-primary)]">{{ project.lastAgentId }}</span>
              </span>
              <span class="wb-mono text-[var(--text-tertiary)]">
                {{ t('project.card.runCount', { n: project.runCount }) }}
              </span>
            </div>

            <!-- 卡片底部操作 -->
            <div class="mt-3 pt-3 border-t border-[var(--border)] flex items-center gap-2">
              <button class="wb-btn-primary" @click.stop="enterProject(project)">
                {{ t('project.button.open') }}
              </button>
              <span class="flex-1"></span>
              <button
                class="wb-btn-ghost"
                data-testid="project-rename"
                @click.stop="openRenameDialog(project)"
              >
                {{ t('project.button.rename') }}
              </button>
              <button
                class="wb-btn-ghost hover:!text-red-600 dark:hover:!text-red-400"
                data-testid="project-remove"
                @click.stop="confirmRemove(project)"
              >
                {{ t('project.button.remove') }}
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>

    <!-- 新建项目（表单与会话「新建配置」同款：自绘 Select / TextInput） -->
    <PluginModal v-model="showCreateDialog" :title="t('project.form.title.new')" size="lg">
      <ProjectForm
        ref="createFormRef"
        :pick-directory="pickDirectory"
        :defaults="{ environment: lastEnvironment }"
        @save="createFromForm"
      />
      <template #footer>
        <div class="flex justify-end gap-3">
          <button class="wb-btn-ghost" @click="showCreateDialog = false">
            {{ t('project.button.cancel') }}
          </button>
          <button
            class="wb-btn-primary"
            :disabled="isSubmitting"
            data-testid="project-form-submit"
            @click="submitCreate"
          >
            {{ t('project.button.create') }}
          </button>
        </div>
      </template>
    </PluginModal>

    <!-- 重命名（与新建同一套输入控件，不混用原生 input） -->
    <PluginModal v-model="showRenameDialog" :title="t('project.form.title.rename')" size="sm">
      <TextInput
        v-model="renameValue"
        :label="t('project.form.name')"
        data-testid="project-rename-input"
        @keydown.enter="submitRename"
      />
      <template #footer>
        <div class="flex justify-end gap-3">
          <button class="wb-btn-ghost" @click="showRenameDialog = false">
            {{ t('project.button.cancel') }}
          </button>
          <button class="wb-btn-primary" :disabled="isSubmitting" @click="submitRename">
            {{ t('project.button.save') }}
          </button>
        </div>
      </template>
    </PluginModal>

    <!-- 移除确认 -->
    <PluginModal v-model="showRemoveDialog" :title="t('project.confirm.removeTitle')" size="sm">
      <p class="text-[var(--text-primary)] text-[calc(13px*var(--ui-scale))]">
        {{ t('project.confirm.removeMsg', { name: pendingRemove?.name }) }}
      </p>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button class="wb-btn-ghost" @click="showRemoveDialog = false">
            {{ t('project.button.cancel') }}
          </button>
          <button
            class="wb-btn-primary bg-[var(--color-danger)]"
            :disabled="isSubmitting"
            data-testid="project-remove-confirm"
            @click="submitRemove"
          >
            {{ t('project.button.remove') }}
          </button>
        </div>
      </template>
    </PluginModal>
  </div>
</template>

<script setup lang="ts">
/**
 * 项目列表页（ADR 0003 / issue #23 M2）
 *
 * 项目卡 = 名称 + 路径 + 执行环境徽标 + 活跃运行数 + 最近活动（含最近 agent）。
 * 「新建项目」= 选目录 + 选执行环境（名字可选，缺省取目录末段）；同目录同执行
 * 环境已有项目时不报错，直接带你进那条既有项目（用户故事 02）。
 *
 * 取数与编排全在 `useProjects`（只走命令通道）；本视图只做渲染、弹窗与提示。
 * 进入项目走 `router.push('/projects/:id')`——「打开」这件事由项目域记录时间戳，
 * 列表排序据此变化，因此创建工作台前先 `project.open`（等一次 lastOpenedAt 刷新）。
 */
import { inject, onActivated, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import PluginModal from '@/components/PluginModal.vue'
import TextInput from '@/components/TextInput.vue'
import ProjectForm, { type ProjectFormData } from './ProjectForm.vue'
import { resolvePluginErrorText } from '@/utils/pluginError'
import {
  envBadge,
  relativeTimeSpec,
  useProjects,
  type ProjectView,
} from '@/composables/useProjects'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)
const router = useRouter()

const {
  projects,
  isLoading,
  now,
  loadProjects,
  createProject,
  openProject,
  renameProject,
  removeProject,
  pickDirectory,
  startTicker,
  stopTicker,
} = useProjects(context)

const showCreateDialog = ref(false)
const showRenameDialog = ref(false)
const showRemoveDialog = ref(false)
const isSubmitting = ref(false)
const renameValue = ref('')
const pendingRemove = ref<ProjectView | null>(null)
const renaming = ref<ProjectView | null>(null)

/** 新建表单（自绘控件；校验与字段错误都在表单内部） */
const createFormRef = ref<InstanceType<typeof ProjectForm> | null>(null)
/** 上次成功创建的执行环境：下次新建默认沿用（跨次记住，不必每次重选） */
const lastEnvironment = ref<string | undefined>(undefined)

// ==================== 渲染辅助 ====================

/** 最近活动的相对时间；无活动 → 「暂无活动」（不显示 NaN） */
function activityText(iso: string | null): string {
  const spec = relativeTimeSpec(iso, now.value)
  return spec ? t(spec.key, spec.params) : t('project.card.noActivity')
}

// ==================== 数据加载 ====================

async function load(): Promise<void> {
  isLoading.value = true
  try {
    await loadProjects()
  } catch (e) {
    console.error('[Projects] load failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.error.loadFailed'))
  } finally {
    isLoading.value = false
  }
}

async function refresh(): Promise<void> {
  try {
    await loadProjects()
    toast.info(t('project.toast.refreshed'))
  } catch (e) {
    toast.error(resolvePluginErrorText(context, e, 'project.error.loadFailed'))
  }
}

// ==================== 新建 ====================

function openCreateDialog(): void {
  showCreateDialog.value = true
}

/** 点「创建」：先让表单做字段校验，通过后由 @save 回到 createFromForm */
function submitCreate(): void {
  createFormRef.value?.submit()
}

/** 表单校验通过后的实际建项目（同目录同环境已存在时后端带你进既有项目） */
async function createFromForm(data: ProjectFormData): Promise<void> {
  isSubmitting.value = true
  try {
    const result = await createProject({
      environment: data.environment,
      workingDir: data.workingDir,
      name: data.name || undefined,
      wslDistro: data.environment === 'wsl2' ? data.wslDistro || undefined : undefined,
    })
    showCreateDialog.value = false
    lastEnvironment.value = data.environment
    toast.success(result.created ? t('project.toast.created') : t('project.toast.existed'))
    await enterProject(result.project)
  } catch (e) {
    console.error('[Projects] create failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.error.createFailed'))
  } finally {
    isSubmitting.value = false
  }
}

// ==================== 进入 / 改名 / 移除 ====================

/**
 * 进入工作台：先记一次「打开」（刷新 lastOpenedAt，列表排序随之变化），再导航
 *
 * 记时间戳失败不阻断导航：用户点的是「进项目」，不是「更新统计」——进不去比
 * 统计旧一分钟严重得多。
 */
async function enterProject(project: ProjectView): Promise<void> {
  try {
    await openProject(project.id)
  } catch (e) {
    console.error('[Projects] open failed (navigating anyway):', e)
  }
  await router.push(`/projects/${project.id}`)
}

function openRenameDialog(project: ProjectView): void {
  renaming.value = project
  renameValue.value = project.name
  showRenameDialog.value = true
}

async function submitRename(): Promise<void> {
  const target = renaming.value
  const name = renameValue.value.trim()
  if (!target || !name) return
  isSubmitting.value = true
  try {
    await renameProject(target.id, name)
    showRenameDialog.value = false
    renaming.value = null
    toast.success(t('project.toast.renamed'))
  } catch (e) {
    console.error('[Projects] rename failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.error.renameFailed'))
  } finally {
    isSubmitting.value = false
  }
}

function confirmRemove(project: ProjectView): void {
  pendingRemove.value = project
  showRemoveDialog.value = true
}

async function submitRemove(): Promise<void> {
  const target = pendingRemove.value
  if (!target) return
  isSubmitting.value = true
  try {
    await removeProject(target.id)
    showRemoveDialog.value = false
    pendingRemove.value = null
    toast.success(t('project.toast.removed'))
  } catch (e) {
    // 有活跃运行时后端显性拒绝（不静默 kill）：提示先停运行
    console.error('[Projects] remove failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.error.removeFailed'))
  } finally {
    isSubmitting.value = false
  }
}

// ==================== 页面级快捷键（Ctrl/⌘+N 新建、Esc 关闭） ====================

function handleKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  const tag = target?.tagName?.toLowerCase() ?? ''
  const inInput =
    tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable === true

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'n') {
    if (inInput) return
    event.preventDefault()
    openCreateDialog()
    return
  }
  if (event.key === 'Escape') {
    showCreateDialog.value = false
    showRenameDialog.value = false
    showRemoveDialog.value = false
  }
}

// ==================== 生命周期 ====================

/** 首次挂载后 onActivated 还会再触发一次：只把「回到列表」当成刷新点 */
let activatedOnce = false

onMounted(() => {
  void load()
  startTicker()
  document.addEventListener('keydown', handleKeydown)
})

// 路由被 KeepAlive 缓存：从工作台返回列表时组件不会重新挂载，必须显式重取，
// 否则刚建的运行数、刚改的名字全是离开时那一份
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  void loadProjects().catch((e) => {
    console.error('[Projects] refresh on activate failed:', e)
  })
})

onUnmounted(() => {
  stopTicker()
  document.removeEventListener('keydown', handleKeydown)
})
</script>
