<template>
  <!-- 分组正文：外层 <section> 与标题由设置页统一渲染 -->
  <div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px]">
    <div class="px-5 py-3.5 flex items-start justify-between gap-6">
      <div class="flex-shrink-0">
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">{{
          t('settings.appearance.palette')
        }}</span>
      </div>
      <div class="flex items-start gap-2 flex-wrap justify-end">
        <button
          v-for="opt in paletteOptions"
          :key="opt.value"
          class="w-[84px] rounded-[8px] border p-1.5 transition-colors"
          :class="
            palette === opt.value
              ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
              : 'border-[var(--border-strong)] hover:border-[var(--text-tertiary)]'
          "
          :title="opt.label"
          :aria-pressed="palette === opt.value"
          @click="selectPalette(opt.value)"
        >
          <!-- 色块预览：页面底 / 卡片底 / 强调色（取色板自身色值，预览切换后效果） -->
          <div class="flex gap-1">
            <span
              class="w-4 h-4 rounded-[3px] border border-black/5"
              :style="{ background: opt.swatches.page }"
            ></span>
            <span
              class="w-4 h-4 rounded-[3px] border border-black/5"
              :style="{ background: opt.swatches.card }"
            ></span>
            <span
              class="w-4 h-4 rounded-[3px] border border-black/5"
              :style="{ background: opt.swatches.primary }"
            ></span>
          </div>
          <p
            class="text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] mt-1.5 text-center truncate"
          >
            {{ opt.label }}
          </p>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * AppearanceSettingsSection — 设置页「外观」分组正文（应用自持主题色板）
 *
 * 色板归属（设置归属修正 2026-10-19）：主题色板是**本应用的样式主题**，不再由
 * 宿主设置页提供，也不写入宿主设置。选择只改应用根容器（App.vue 的
 * `.app-theme-root[data-palette]`），壳标题栏 / 系统页不受影响。
 *
 * 深浅色不在此分组：那是宿主的窗口级主题（宿主系统页持有），应用只消费。
 */
import { computed, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { toast } from 'vue-sonner'
import {
  APP_PALETTES,
  loadAppPalette,
  setAppPalette,
  useAppPalette,
  type AppPalette,
} from '@/composables/useAppPalette'

const context = inject<PluginContext | null>('pluginContext', null)
const { t } = useI18n()
const { palette } = useAppPalette()

/** 色板元数据：label 复用宿主机制文案副本，色块取色板自身色值以便预览切换后效果 */
const PALETTE_META: Record<
  AppPalette,
  { labelKey: string; swatches: { page: string; card: string; primary: string } }
> = {
  warm: {
    labelKey: 'settings.appearance.paletteWarm',
    swatches: { page: '#F5F4F0', card: '#FDFCFA', primary: '#1D1A14' },
  },
  cool: {
    labelKey: 'settings.appearance.paletteCool',
    swatches: { page: '#F3F5F7', card: '#FBFCFD', primary: '#2563EB' },
  },
  forest: {
    labelKey: 'settings.appearance.paletteForest',
    swatches: { page: '#F6F5EF', card: '#FDFCF7', primary: '#3E6B4F' },
  },
  ocean: {
    labelKey: 'settings.appearance.paletteOcean',
    swatches: { page: '#F2F7F9', card: '#FAFCFD', primary: '#0E7490' },
  },
  sunset: {
    labelKey: 'settings.appearance.paletteSunset',
    swatches: { page: '#FBF5EF', card: '#FEFAF5', primary: '#D9532A' },
  },
  violet: {
    labelKey: 'settings.appearance.paletteViolet',
    swatches: { page: '#F7F5FB', card: '#FCFBFE', primary: '#6D4FC6' },
  },
}

/** 选项序列由白名单 APP_PALETTES 驱动（与 style.css 变量组同源，单边新增即缺项） */
const paletteOptions = computed(() =>
  APP_PALETTES.map((value) => ({
    value,
    label: t(PALETTE_META[value].labelKey),
    swatches: PALETTE_META[value].swatches,
  })),
)

/** 切换色板：即时生效 + 落本 app KV；写失败提示（不静默） */
async function selectPalette(value: AppPalette): Promise<void> {
  try {
    await setAppPalette(value)
  } catch {
    toast.error(t('com.wasmnest.terminal-session.appearance.settings.saveFailed'))
  }
}

onMounted(() => {
  // App.vue 已在应用根挂载时恢复过；此处兜底（组件单测 / 独立挂载时不依赖根组件顺序）
  if (context?.storage) {
    void loadAppPalette({
      get: (key) => context.storage.get(key),
      set: (key, value) => context.storage.set(key, value),
    })
  }
})
</script>
