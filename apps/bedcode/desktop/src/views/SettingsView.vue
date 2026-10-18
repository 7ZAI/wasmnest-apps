<template>
  <div class="h-full flex flex-col bg-[var(--bg-page)]">
    <!-- ==================== 工具栏页头 ==================== -->
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
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <h2 class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]">
          {{ t('settings.title') }}
        </h2>
      </div>
    </div>

    <!-- 内容区：业务分组（配对 / 会话）静态表渲染；平台分组在宿主系统页 /sys/settings -->
    <div class="flex-1 overflow-auto px-6 py-6">
      <div class="max-w-3xl mx-auto space-y-6">
        <template v-for="section in sections" :key="section.key">
          <section>
            <h3 class="wb-section-title">{{ t(section.titleKey ?? '') }}</h3>
            <component :is="section.component" v-bind="section.props" />
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 设置视图 — 业务分组设置页（桌面 UI 宿主修正 2026-10-17）
 *
 * 桌面 UI 宿主修正后设置页拆分：平台分组（外观 / 链路加密 / 系统 / 日志 / 授权 /
 * 关于）归宿主系统页（/sys/settings，SysSettingsView 编排宿主 useSettingsSections）；
 * 本页只承载本 app 的**业务分组**（配对设置 / 会话设置，静态表渲染，组件经
 * inject('pluginContext') 取命令通道——appContext env 适配层零改写）。
 */
import { useI18n } from 'vue-i18n'
import { useSettingsSections } from '@/composables/useSettingsSections'

const { t } = useI18n()

// 业务分组静态表（配对 / 会话；无共享状态需求）
const sections = useSettingsSections()
</script>
