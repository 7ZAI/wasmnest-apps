<template>
  <div class="h-full flex flex-col bg-[var(--mobile-bg-primary)]">
    <!-- 顶栏：标题随视图流转（设置页/模板选择/表单） -->
    <header class="flex items-center justify-between px-3 pb-2 pt-1 border-b border-[var(--mobile-border)] bg-[var(--mobile-bg-card)]" :style="{ paddingTop: `${safeAreaTop}px` }">
      <button
        class="h-11 px-2 -ml-2 flex items-center gap-1 text-[var(--font-size-sm)] text-[var(--mobile-text-secondary)] active:opacity-80 rounded-xl transition-opacity"
        @click="goBack"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        {{ view === 'settings' ? t('com.wasmnest.ai-chatbox.chat.backToChat') : t('com.wasmnest.ai-chatbox.chat.back') }}
      </button>
      <h3 class="text-[var(--font-size-base)] font-medium text-[var(--mobile-text-primary)]">{{ headerTitle }}</h3>
      <div class="w-16"></div>
    </header>

    <!-- 视图切换：设置页 / 模板选择 / 表单（淡入 + 横向滑入，先出后进避免布局跳动） -->
    <Transition name="view-slide" mode="out-in">
      <!-- 视图一：设置页主页（供应商折叠摘要 + 应用设置；设置归属 wasm-app） -->
      <div v-if="view === 'settings'" key="settings" class="flex-1 overflow-y-auto px-4 py-4">
        <ProviderSummarySection
          :providers="providers"
          :active-provider-id="activeProviderId"
          @add="view = 'templates'"
          @edit="startEdit"
        />
        <div class="mt-4">
          <AppSettingsSection :config="props.pluginConfig" @change="onPluginConfigChange" />
        </div>
      </div>

      <!-- 视图二：模板选择（添加供应商直达；4 预设 + 自定义） -->
      <div v-else-if="view === 'templates'" key="templates" class="flex-1 overflow-y-auto px-4 py-4">
        <p class="text-xs text-[var(--mobile-text-secondary)] mb-5">{{ t('com.wasmnest.ai-chatbox.chat.selectTemplate') }}</p>
        <div class="grid grid-cols-2 gap-2.5">
          <button
            v-for="preset in PROVIDER_PRESETS"
            :key="preset.id"
            class="flex flex-col items-center gap-2 px-3 py-4 rounded-xl bg-[var(--mobile-bg-card)] border border-[var(--mobile-border)] active:border-[var(--mobile-border-active)] active:bg-[var(--mobile-bg-tertiary)] transition-colors"
            @click="choosePreset(preset)"
          >
            <ProviderAvatar :preset-id="preset.id" :name="preset.name" :size="40" />
            <span class="text-[var(--font-size-sm)] text-[var(--mobile-text-primary)]">{{ preset.name }}</span>
          </button>

          <!-- 自定义模板：全空表单入口 -->
          <button
            class="flex flex-col items-center gap-2 px-3 py-4 rounded-xl bg-[var(--mobile-bg-card)] border border-dashed border-[var(--mobile-border)] active:border-[var(--mobile-border-active)] active:bg-[var(--mobile-bg-tertiary)] transition-colors"
            @click="chooseCustom"
          >
            <span class="w-10 h-10 rounded-full bg-[var(--mobile-bg-tertiary)] flex items-center justify-center text-[var(--mobile-text-muted)]">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span class="text-[var(--font-size-sm)] text-[var(--mobile-text-primary)]">{{ t('com.wasmnest.ai-chatbox.chat.customTemplate') }}</span>
          </button>
        </div>
      </div>

      <!-- 视图三：表单（预设回填或全空；编辑已有实例） -->
      <div v-else key="form" class="flex-1 overflow-y-auto px-4 pt-4 pb-24">
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
</template>

<script setup lang="ts">
/**
 * 应用配置页（移动端全屏，与桌面端对齐）— 设置页主页（供应商摘要 + 应用设置）
 * + 供应商配置子流程
 *
 * 设置页（默认视图）承载：已配置供应商折叠摘要（点行编辑 / 底部直接添加）+
 * 应用级配置分区（代码渲染 / 思考 / 限流重试，设置归属 wasm-app）。
 * 「添加供应商」直达模板选择 → 表单；供应商列表页已退役（摘要即索引）。
 */
import { ref, computed, inject } from 'vue'
import type { Ref } from 'vue'
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

// 宿主注入的安全区 JS 值（同 ChatView）：CSS env() 在 Android WebView 无效，须用 JS 值避让状态栏
const safeArea = inject<Ref<{ top: number }>>('safeArea')
const safeAreaTop = computed(() => safeArea?.value?.top || 0)

/** 页内视图流转：设置页（主页，含供应商摘要）→ 模板选择 → 表单 */
const view = ref<'settings' | 'templates' | 'form'>(props.initialView ?? 'settings')
const editingMode = ref<'add' | 'edit'>('add')
const editingId = ref('')
const selectedPreset = ref<ProviderPreset | null>(null)
const formKey = ref(0)

/** 编辑模式回填（edit 时才有值） */
const editingProvider = computed(() =>
  editingMode.value === 'edit' && editingId.value
    ? props.providers.find(p => p.id === editingId.value)
    : undefined,
)

const existingNames = computed(() => props.providers.map(p => p.name))

/** 顶栏标题随视图与模式切换 */
const headerTitle = computed(() => {
  if (view.value === 'settings') return t('com.wasmnest.ai-chatbox.settingsTitle')
  if (view.value === 'templates') return t('com.wasmnest.ai-chatbox.chat.selectTemplate')
  return editingMode.value === 'edit'
    ? t('com.wasmnest.ai-chatbox.chat.editProvider')
    : t('com.wasmnest.ai-chatbox.chat.addProvider')
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

/**
 * 暴露给 ChatView：ChatView 的应用层返回处理经此逐级后退（表单/模板 → 设置页 → 聊天页），
 * 与页头返回按钮走同一条路径（goBack）。
 */
defineExpose({ goBack })
</script>

<style scoped>
/* 视图切换（设置页 → 模板选择 → 表单）：淡入 + 横向滑入，出向轻微左移 */
.view-slide-enter-active,
.view-slide-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.view-slide-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.view-slide-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
