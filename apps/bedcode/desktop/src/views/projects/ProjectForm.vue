<template>
  <div class="space-y-5" data-testid="project-form">
    <!-- 执行环境：按宿主平台过滤（同会话「新建配置」口径），不可用项禁用而非隐藏 -->
    <Select
      v-model="form.environment"
      :label="t('project.form.environment')"
      :options="environmentOptions"
      required
      data-testid="project-form-env"
    />

    <!-- WSL 发行版：仅 wsl2 分支需要；列表来自宿主平台事实 -->
    <div v-if="form.environment === 'wsl2'">
      <Select
        v-if="!wslLoading"
        v-model="form.wslDistro"
        :label="t('project.form.wslDistro')"
        :options="wslDistroOptions"
        :placeholder="t('project.form.wslDistroPlaceholder')"
        :disabled="wslDistroOptions.length === 0"
        data-testid="project-form-distro"
      />
      <div v-else class="form-group">
        <label class="block text-xs font-medium mb-1.5 text-[var(--text-secondary)]">
          {{ t('project.form.wslDistro') }}
        </label>
        <div
          class="border rounded-input px-4 py-2 border-[var(--border-input)] bg-[var(--bg-input)] text-[var(--text-tertiary)]"
        >
          <span class="text-sm">{{ t('project.form.wslInitializing') }}</span>
        </div>
      </div>
      <!-- 无 WSL 时给提示而不是空下拉（与会话表单同口径） -->
      <p v-if="!wslLoading && wslError" class="mt-1 text-sm text-amber-500">
        {{ t('project.form.wslNotDetected') }}
      </p>
    </div>

    <!-- 目录：唯一必填项；选择走项目域命令（宿主 fs:pick 权限门 + 路径授权校验） -->
    <TextInput
      v-model="form.workingDir"
      :label="t('project.form.workingDir')"
      :placeholder="t('project.form.workingDirPlaceholder')"
      :error="errors.workingDir"
      required
      data-testid="project-form-dir"
      @keydown.enter.prevent="submit"
    >
      <template #suffix>
        <button
          type="button"
          class="text-brand hover:text-[var(--color-primary-hover)]"
          data-testid="project-form-browse"
          @click="browseDir"
        >
          {{ t('project.button.browse') }}
        </button>
      </template>
    </TextInput>

    <!-- 项目名：可选，留空取目录末段（提示写在 placeholder 里） -->
    <TextInput
      v-model="form.name"
      :label="t('project.form.name')"
      :placeholder="t('project.form.namePlaceholder')"
      data-testid="project-form-name"
      @keydown.enter.prevent="submit"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 项目新建表单（ADR 0003 / issue #23 M2）
 *
 * 与「终端会话 → 新建配置」（SessionConfigForm）同形：自绘 Select / TextInput，
 * 不用原生 `<select>` / 裸 `<input>`——原生控件在本应用的主题 token 下既不吃
 * 深浅色，也不吃 `--ui-scale`，弹出的选项列表更是系统样式，与会话表单并排放
 * 会明显不是一套东西。
 *
 * 三处与会话表单对齐的规则：
 * 1. 执行环境按宿主平台过滤（Linux 只有 linux，Windows 有 windows/wsl2），
 *    不可用项禁用而不隐藏——用户能看到「这里还有别的环境，只是这台机器跑不了」；
 * 2. WSL 发行版经 `session.environment.wsl-distros` 枚举，加载中给占位、无 WSL
 *    给提示，不做空下拉；
 * 3. 必填只在提交时内联提示，输入恢复后即时消退（不把空值送给后端换通用错误）。
 *
 * 目录选择仍归父级：`pickDirectory()` 由 `ProjectListView` 注入（走 `project.pick-dir`
 * 命令）；本组件只额外发一条只读枚举命令（`session.environment.wsl-distros`），
 * 不持有任何写通道。
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import Select from '@binblink/wasmnest-plugin-sdk-desktop/ui'
import { platform } from '@tauri-apps/plugin-os'
import { toast } from 'vue-sonner'
import TextInput from '@/components/TextInput.vue'
import { resolvePluginErrorText } from '@/utils/pluginError'

export interface ProjectFormData {
  environment: string
  wslDistro: string
  workingDir: string
  name: string
}

const props = defineProps<{
  /** 目录选择（父级注入；返回 null = 用户取消） */
  pickDirectory?: () => Promise<string | null>
  /** 新建默认值（目前只有环境：按平台默认） */
  defaults?: { environment?: string }
}>()

const emit = defineEmits<{
  (e: 'save', form: ProjectFormData): void
}>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const form = ref<ProjectFormData>({
  environment: 'linux',
  wslDistro: '',
  workingDir: '',
  name: '',
})

const errors = ref({ workingDir: '' })

// ==================== 平台与执行环境 ====================

/**
 * 宿主平台名：经 Tauri OS API 同步取得（禁以 UA / 视口推断）。
 * 非 Tauri 环境（测试 / dev-shell）调用会抛错 → null，此时环境选项全部禁用并
 * 落回默认值，与 SessionConfigForm 同口径。
 */
const platformName: string | null = (() => {
  try {
    return platform()
  } catch {
    return null
  }
})()

/** 当前平台理论上可用的执行环境（与会话表单同规则） */
const availableValues = computed<string[]>(() => {
  if (platformName === 'linux') return ['linux']
  if (platformName === 'windows') return ['windows', 'wsl2']
  return []
})

const environmentOptions = computed(() => {
  const available = new Set(availableValues.value)
  return [
    { value: 'windows', label: t('project.form.env.windows'), disabled: !available.has('windows') },
    { value: 'wsl2', label: t('project.form.env.wsl2'), disabled: !available.has('wsl2') },
    { value: 'linux', label: t('project.form.env.linux'), disabled: !available.has('linux') },
  ]
})

const defaultEnvironment = computed(() =>
  availableValues.value.length > 0 ? availableValues.value[0] : 'linux',
)

/** 归一化已存环境取值：平台不可用时降级到平台默认 */
function normalizeEnvironment(stored: string | null | undefined): string {
  if (stored === 'windows' || stored === 'wsl2' || stored === 'linux') {
    if (availableValues.value.includes(stored)) return stored
  }
  return defaultEnvironment.value
}

// ==================== WSL 发行版 ====================

const wslDistros = ref<string[]>([])
const wslLoading = ref(false)
const wslError = ref('')

const wslDistroOptions = computed(() =>
  wslDistros.value.map((name) => ({ value: name, label: name })),
)

async function loadWslDistros(): Promise<void> {
  wslLoading.value = true
  wslError.value = ''
  try {
    const raw = (await context.commands.execute('session.environment.wsl-distros', {})) as {
      distros?: unknown
    }
    wslDistros.value = Array.isArray(raw?.distros) ? (raw.distros as string[]) : []
  } catch (e) {
    wslDistros.value = []
    console.error('[Projects] wsl distros failed:', e)
    wslError.value = t('project.form.wslNotDetected')
  } finally {
    wslLoading.value = false
  }
}

// 切到 wsl2 才需要发行版列表：按需加载一次（失败不重试，避免弹窗内抖动）
watch(
  () => form.value.environment,
  (env) => {
    if (env === 'wsl2' && wslDistros.value.length === 0 && !wslError.value) {
      void loadWslDistros()
    }
  },
)

// ==================== 初始化与校验 ====================

onMounted(() => {
  form.value.environment = props.defaults?.environment
    ? normalizeEnvironment(props.defaults.environment)
    : defaultEnvironment.value
  // 默认值就可能落在 wsl2（Windows 主机上的上次选择）
  if (form.value.environment === 'wsl2') void loadWslDistros()
})

// 必填提示随输入即时消退
watch(
  () => form.value.workingDir,
  (value) => {
    if (value.trim()) errors.value.workingDir = ''
  },
)

/** 打开宿主目录选择器（project.pick-dir：宿主 fs:pick 权限门在命令面里） */
async function browseDir(): Promise<void> {
  if (!props.pickDirectory) return
  try {
    const picked = await props.pickDirectory()
    if (picked) {
      form.value.workingDir = picked
      errors.value.workingDir = ''
    }
  } catch (e) {
    // 选择器打不开要说一声：静默失败会让用户以为按钮坏了
    console.error('[Projects] pick directory failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.form.pickFailed'))
  }
}

/** 提交前校验：目录是唯一必填项（名字留空取目录末段） */
function validate(): boolean {
  errors.value.workingDir = form.value.workingDir.trim() ? '' : t('project.form.required')
  return !errors.value.workingDir
}

/** 表单内回车提交（等于点「创建」） */
function submit(): void {
  if (!validate()) return
  emit('save', {
    ...form.value,
    workingDir: form.value.workingDir.trim(),
    name: form.value.name.trim(),
  })
}

defineExpose({ form, validate, submit })
</script>
