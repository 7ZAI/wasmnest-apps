<template>
  <section>
    <div
      class="rounded-card border border-[var(--border)] bg-[var(--bg-card)] divide-y divide-[var(--border)]"
    >
      <!-- 折叠头：标题 + 数量 + 展开/收起箭头 -->
      <button
        type="button"
        class="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
        :aria-expanded="expanded"
        :aria-label="
          expanded
            ? t('com.wasmnest.ai-chatbox.collapseProviders')
            : t('com.wasmnest.ai-chatbox.expandProviders')
        "
        data-testid="provider-summary-toggle"
        @click="expanded = !expanded"
      >
        <h4 class="text-xs font-medium text-[var(--text-secondary)]">
          {{ t('com.wasmnest.ai-chatbox.configuredProviders') }}
        </h4>
        <span
          class="px-1.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[11px] leading-none text-[var(--text-tertiary)] tabular-nums"
        >
          {{ providers.length }}
        </span>
        <span class="flex-1"></span>
        <svg
          class="w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-200"
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
        class="divide-y divide-[var(--border)]"
        data-testid="provider-summary-list"
      >
        <div v-if="providers.length === 0" class="px-3.5 py-3 text-xs text-[var(--text-tertiary)]">
          {{ t('com.wasmnest.ai-chatbox.noConfiguredProviders') }}
        </div>
        <button
          v-for="p in providers"
          :key="p.id"
          type="button"
          class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
          data-testid="provider-summary-row"
          @click="emit('edit', p.id)"
        >
          <ProviderAvatar :preset-id="p.presetId" :name="p.name" :size="28" />
          <span class="flex-1 min-w-0 truncate text-sm text-[var(--text-primary)]">{{
            p.name
          }}</span>
          <span
            v-if="activeProviderId === p.id"
            class="flex-shrink-0 rounded-full bg-[var(--color-primary-light)] px-2 py-0.5 text-[11px] leading-none text-[var(--text-secondary)]"
          >
            {{ t('com.wasmnest.ai-chatbox.activeProvider') }}
          </span>
          <svg
            class="w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      <!-- 入口：添加供应商（直达模板选择） -->
      <button
        type="button"
        class="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
        data-testid="provider-summary-add"
        @click="emit('add')"
      >
        <span>{{ t('com.wasmnest.ai-chatbox.addProvider') }}</span>
        <svg
          class="w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * ProviderSummarySection — 设置页内的「已配置供应商」折叠摘要（桌面）
 *
 * 展示已配置供应商（名称 / 品牌图标 / 当前使用标记），点行进入编辑；
 * 底部「添加供应商」发出 add 事件，由设置页直接切到模板选择。
 * 折叠态由组件自持（默认展开），切换不落 storage——纯展示状态。
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
