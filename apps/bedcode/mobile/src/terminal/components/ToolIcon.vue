<template>
  <svg
    v-if="icon"
    :class="sizeClass"
    viewBox="0 0 24 24"
    :fill="icon.filled ? 'currentColor' : 'none'"
    :stroke="icon.filled ? 'none' : 'currentColor'"
  >
    <path
      v-for="(d, index) in icon.paths"
      :key="index"
      :d="d"
      :stroke-linecap="icon.filled ? undefined : 'round'"
      :stroke-linejoin="icon.filled ? undefined : 'round'"
      :stroke-width="icon.filled ? undefined : thick ? 2.5 : 2"
    />
  </svg>
</template>

<script setup lang="ts">
/**
 * Header 工具栏图标（issue #19）：按 `headerTools.ts` 的图标表渲染，
 * 常驻按钮与溢出菜单共用同一份 path，避免两处 SVG 漂移。
 */
import { computed } from 'vue'
import { HEADER_TOOL_ICONS } from '../headerTools'

defineOptions({ name: 'TerminalHeaderToolIcon' })

const props = withDefaults(
  defineProps<{
    /** 与 ToolbarItemConfig.key 对齐 */
    name: string
    /** toolbar = 常驻按钮尺寸（w-5 h-5）；menu = 溢出菜单尺寸（18px） */
    size?: 'toolbar' | 'menu'
    /** 加粗描边（个别项需要更重的视觉） */
    thick?: boolean
  }>(),
  {
    size: 'toolbar',
    thick: false,
  },
)

const icon = computed(() => HEADER_TOOL_ICONS[props.name])
const sizeClass = computed(() => (props.size === 'menu' ? 'w-[18px] h-[18px]' : 'w-5 h-5'))
</script>
