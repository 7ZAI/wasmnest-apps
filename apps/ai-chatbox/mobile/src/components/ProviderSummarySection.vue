<template>
  <div
    class="rounded-xl border border-[var(--mobile-border)] bg-[var(--mobile-bg-card)] overflow-hidden"
  >
    <!-- 折叠头：标题 + 数量 + 展开/收起箭头 -->
    <button
      class="w-full min-h-[52px] px-3 flex items-center gap-2 text-left active:bg-[var(--mobile-bg-tertiary)] transition-colors"
      :aria-expanded="expanded"
      :aria-label="
        expanded
          ? t('com.wasmnest.ai-chatbox.collapseProviders')
          : t('com.wasmnest.ai-chatbox.expandProviders')
      "
      data-testid="provider-summary-toggle"
      @click="expanded = !expanded"
    >
      <span class="text-[var(--font-size-sm)] font-medium text-[var(--mobile-text-primary)]">
        {{ t('com.wasmnest.ai-chatbox.configuredProviders') }}
      </span>
      <span
        class="px-1.5 py-0.5 rounded-full bg-[var(--mobile-bg-tertiary)] text-[var(--font-size-xs)] leading-none text-[var(--mobile-text-muted)] tabular-nums"
      >
        {{ providers.length }}
      </span>
      <span class="flex-1"></span>
      <svg
        class="w-4 h-4 flex-shrink-0 text-[var(--mobile-text-muted)] transition-transform duration-200"
        :class="{ 'rotate-180': expanded }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- 折叠体：已配置供应商（点行进入编辑） -->
    <div
      v-show="expanded"
      class="border-t border-[var(--mobile-border)] divide-y divide-[var(--mobile-border)]"
      data-testid="provider-summary-list"
    >
      <div v-if="providers.length === 0" class="px-3 py-3 text-xs text-[var(--mobile-text-muted)]">
        {{ t('com.wasmnest.ai-chatbox.noConfiguredProviders') }}
      </div>
      <button
        v-for="p in providers"
        :key="p.id"
        class="w-full flex items-center gap-2.5 px-3 py-2 min-h-[48px] text-left active:bg-[var(--mobile-bg-tertiary)] transition-colors"
        data-testid="provider-summary-row"
        @click="emit('edit', p.id)"
      >
        <ProviderAvatar :preset-id="p.presetId" :name="p.name" :size="28" />
        <span
          class="flex-1 min-w-0 truncate text-[var(--font-size-base)] text-[var(--mobile-text-primary)]"
        >
          {{ p.name }}
        </span>
        <span
          v-if="activeProviderId === p.id"
          class="flex-shrink-0 rounded-full bg-[var(--mobile-bg-tertiary)] px-2 py-0.5 text-[var(--font-size-xs)] leading-none text-[var(--mobile-text-secondary)]"
        >
          {{ t('mobile.plugin.aiChatbox.activeProvider') }}
        </span>
        <svg
          class="w-4 h-4 flex-shrink-0 text-[var(--mobile-text-muted)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>

    <!-- 入口：添加供应商（直达模板选择） -->
    <button
      class="w-full min-h-[52px] px-3 flex items-center justify-between gap-2 border-t border-[var(--mobile-border)] text-[var(--font-size-sm)] text-[var(--mobile-text-secondary)] active:bg-[var(--mobile-bg-tertiary)] transition-colors"
      data-testid="provider-summary-add"
      @click="emit('add')"
    >
      <span>{{ t('mobile.plugin.aiChatbox.addProvider') }}</span>
      <svg
        class="w-4 h-4 flex-shrink-0 text-[var(--mobile-text-muted)]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * ProviderSummarySection — 设置页内的「已配置供应商」折叠摘要（移动端）
 *
 * 展示已配置供应商（名称 / 品牌图标 / 当前使用标记），点行进入编辑；
 * 底部「添加供应商」发出 add 事件，由设置页直接切到模板选择。
 * 折叠态由组件自持（默认展开），切换不落 storage——纯展示状态。
 *
 * 文案使用本应用自持的 i18n 键（activate 期经 registerMessages 带
 * `com.wasmnest.ai-chatbox.` 前缀注册）；当前使用标记沿用宿主移动端文案键。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ProviderAvatar from './ProviderAvatar.vue'
import type { ApiProvider } from '../types'

defineProps<{
  providers: ApiProvider[]
  activeProviderId?: string
}>()

const emit = defineEmits<{
  /** 添加供应商（设置页父级直接切到模板选择） */
  add: []
  /** 编辑已配置供应商（设置页父级打开该供应商表单） */
  edit: [id: string]
}>()

const { t } = useI18n()

/** 折叠态（默认展开：用户一眼看到已配置供应商与入口） */
const expanded = ref(true)
</script>
