<template>
  <div class="h-full flex flex-col bg-[var(--bg-page)]" data-testid="chat-config-page">
    <!-- 顶栏：标题随视图流转（设置页/模板选择/表单）
         标题**左对齐**紧跟返回按钮，与宿主「← 返回 X」及各 wasm 应用
         （agent-hub / terminal-session）的页头一致。原先用 justify-between +
         右侧 w-20 空洞做居中，标题实际只在左侧按钮恰好 80px 宽时才真居中——
         i18n 换文案（EN 的 "Back to chat"）就偏。 -->
    <header
      class="h-12 flex items-center gap-2 px-4 border-b border-[var(--border)] bg-[var(--bg-card)]"
    >
      <button
        class="flex-shrink-0 flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] px-2 py-1 -ml-2 rounded-btn transition-colors"
        data-testid="chat-config-back"
        @click="goBack"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        {{
          view === 'settings'
            ? t('com.wasmnest.ai-chatbox.backToChat')
            : t('com.wasmnest.ai-chatbox.back')
        }}
      </button>
      <h3 class="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]">{{ headerTitle }}</h3>
    </header>

    <!-- 视图切换：设置页 / 模板选择 / 表单。page-swap 单独包一层并承接高度链：
         退场的绝对定位层需要以「顶栏以下的视图区」为定位上下文，直接标在视图根上
         会从顶栏行开始绘制。过渡类与效果变体由宿主 src/style.css 统一提供。 -->
    <div class="page-swap flex-1 flex flex-col min-h-0">
      <Transition name="page">
        <!-- 视图一：设置页主页（供应商折叠摘要 + 应用设置；设置归属 wasm-app） -->
        <div v-if="view === 'settings'" key="settings" class="flex-1 overflow-y-auto p-4">
          <div class="max-w-3xl mx-auto space-y-5">
            <ProviderSummarySection
              :providers="providers"
              :active-provider-id="activeProviderId"
              @add="view = 'templates'"
              @edit="startEdit"
            />
            <AppSettingsSection :config="props.pluginConfig" @change="onPluginConfigChange" />
          </div>
        </div>

        <!-- 视图二：模板选择（添加供应商直达；4 预设 + 自定义） -->
        <div
          v-else-if="view === 'templates'"
          key="templates"
          class="flex-1 overflow-y-auto p-4"
          data-testid="chat-config-templates"
        >
          <p class="text-xs text-[var(--text-secondary)] mb-3">
            {{ t('com.wasmnest.ai-chatbox.selectTemplate') }}
          </p>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="preset in PROVIDER_PRESETS"
              :key="preset.id"
              class="flex flex-col items-center gap-2 px-3 py-4 rounded-card bg-[var(--bg-card)] border border-[var(--border)] hover:border-brand hover:bg-[var(--bg-hover)] transition-colors"
              @click="choosePreset(preset)"
            >
              <ProviderAvatar :preset-id="preset.id" :name="preset.name" :size="40" />
              <span class="text-sm text-[var(--text-primary)]">{{ preset.name }}</span>
            </button>

            <!-- 自定义模板：全空表单入口 -->
            <button
              class="flex flex-col items-center gap-2 px-3 py-4 rounded-card bg-[var(--bg-card)] border border-dashed border-[var(--border)] hover:border-brand hover:bg-[var(--bg-hover)] transition-colors"
              @click="chooseCustom"
            >
              <span
                class="w-10 h-10 rounded-full bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-tertiary)]"
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span class="text-sm text-[var(--text-primary)]">{{
                t('com.wasmnest.ai-chatbox.customTemplate')
              }}</span>
            </button>
          </div>
        </div>

        <!-- 视图三：表单（预设回填或全空；编辑已有实例） -->
        <div v-else key="form" class="flex-1 overflow-y-auto p-6">
          <ProviderForm
            :key="formKey"
            :mode="editingMode"
            :initial-values="editingProvider"
            :preset="selectedPreset"
            :existing-names="existingNames"
            :fetch-models="props.fetchModels"
            :test-connection="props.testConnection"
            @save="handleSave"
            @delete="handleDelete"
          />
        </div>
      </Transition>
    </div>

  </div>
</template>

<script setup lang="ts">
/**
 * 应用配置页 — 设置页主页（供应商摘要 + 应用设置）+ 供应商配置子流程
 *
 * 设置页（默认视图）承载：已配置供应商折叠摘要（点行编辑 / 底部直接添加）+
 * 应用级配置分区（代码渲染 / 思考 / 限流重试，设置归属 wasm-app）。
 * 「添加供应商」直达模板选择 → 表单；供应商列表页已退役（摘要即索引）。
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ProviderForm from './ProviderForm.vue'
import ProviderAvatar from './ProviderAvatar.vue'
import AppSettingsSection from './AppSettingsSection.vue'
import ProviderSummarySection from './ProviderSummarySection.vue'
import { PROVIDER_PRESETS } from '../types'
import type { ApiProvider, PluginConfig, ProviderPreset } from '../types'

const props = defineProps<{
  providers: ApiProvider[]
  activeProviderId?: string
  /** 拉取模型列表（ChatView 注入 config.fetchModels） */
  fetchModels: (provider: ApiProvider) => Promise<string[]>
  /** 测试连接（ChatView 注入 config.testConnection） */
  testConnection: (provider: ApiProvider) => Promise<string>
  /** 应用级配置（设置归属 wasm-app；本页设置视图编辑，即改即存） */
  pluginConfig: PluginConfig
  /** 初始视图：默认设置页（主入口）；空态「配置模型」可直达模板选择 */
  initialView?: 'settings' | 'templates'
}>()

const emit = defineEmits<{
  back: []
  add: [provider: ApiProvider]
  update: [provider: ApiProvider]
  remove: [id: string]
  /** 应用级配置整表变更（即改即存；ChatView 转 usePluginConfig.saveConfig 落 storage） */
  changePluginConfig: [next: PluginConfig]
}>()

const { t } = useI18n()

/** 页内视图流转：设置页（主页，含供应商摘要）→ 模板选择 → 表单 */
const view = ref<'settings' | 'templates' | 'form'>(props.initialView ?? 'settings')
const editingMode = ref<'add' | 'edit'>('add')
const editingId = ref('')
const selectedPreset = ref<ProviderPreset | null>(null)
const formKey = ref(0)

/** 编辑模式回填（edit 时才有值） */
const editingProvider = computed(() =>
  editingMode.value === 'edit' && editingId.value
    ? props.providers.find((p) => p.id === editingId.value)
    : undefined,
)

const existingNames = computed(() => props.providers.map((p) => p.name))

/** 顶栏标题随视图与模式切换 */
const headerTitle = computed(() => {
  if (view.value === 'settings') return t('com.wasmnest.ai-chatbox.pluginSettings')
  if (view.value === 'templates') return t('com.wasmnest.ai-chatbox.selectTemplate')
  return editingMode.value === 'edit'
    ? t('com.wasmnest.ai-chatbox.editProvider')
    : t('com.wasmnest.ai-chatbox.addProvider')
})

/** 返回：设置页 → 聊天；模板选择 → 设置页；表单（添加）→ 模板选择；表单（编辑）→ 设置页 */
function goBack(): void {
  if (view.value === 'settings') {
    emit('back')
  } else if (view.value === 'templates') {
    view.value = 'settings'
  } else if (editingMode.value === 'add') {
    view.value = 'templates'
  } else {
    view.value = 'settings'
  }
}

/** 应用设置分区变更：整表上抛（ChatView 即改即存落 storage） */
function onPluginConfigChange(next: PluginConfig): void {
  emit('changePluginConfig', next)
}

function choosePreset(preset: ProviderPreset): void {
  editingMode.value = 'add'
  selectedPreset.value = preset
  editingId.value = ''
  formKey.value++
  view.value = 'form'
}

function chooseCustom(): void {
  editingMode.value = 'add'
  selectedPreset.value = null
  editingId.value = ''
  formKey.value++
  view.value = 'form'
}

function startEdit(id: string): void {
  editingMode.value = 'edit'
  editingId.value = id
  selectedPreset.value = null
  formKey.value++
  view.value = 'form'
}

/** 保存：新增或更新后回到设置页（新增不自动激活，首个自动激活逻辑在 useAiConfig） */
function handleSave(provider: ApiProvider): void {
  if (editingMode.value === 'edit') {
    emit('update', provider)
  } else {
    emit('add', provider)
  }
  view.value = 'settings'
}

/** 表单内删除：确认后删除并回到设置页（列表页已退役） */
function handleDelete(id: string): void {
  emit('remove', id)
  view.value = 'settings'
}
</script>

<style scoped>
/* 视图切换（设置页 → 模板选择 → 表单）已收归宿主页面过渡体系（src/style.css 的
   .page-* / .page-swap）：名字恒为 `page`，时长/缓动/位移走 --motion-page-* token，
   效果变体由 <html data-page-fx> 选（全端唯一切换点 = 宿主
   src/utils/pageTransition.ts）。本文件不再自带 .view-slide-*。 */
</style>
