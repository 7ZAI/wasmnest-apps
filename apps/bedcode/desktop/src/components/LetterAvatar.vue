<template>
  <div
    class="icon-tile select-none bg-[color-mix(in_srgb,var(--color-primary)_12%,var(--bg-card))] font-medium text-[var(--text-secondary)]"
    :class="size === 'lg' ? 'w-14 h-14 rounded-2xl text-2xl' : 'w-10 h-10 rounded-xl text-base'"
  >
    {{ letter }}
  </div>
</template>

<script setup lang="ts">
/**
 * LetterAvatar - 字母头像（PluginIcon 的回退实现）
 *
 * 取插件名首字符；底色用一层极淡的主色 tint，跟随宿主色板与深浅色，
 * 不再按 seed 从彩虹渐变里挑色。seed 保留为调用方兼容参数。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 显示名称（取首字符） */
    name: string
    /** 保留参数：调用方仍按插件 id 传入，当前调色不依赖它 */
    seed: string
    /** 图标尺寸 */
    size?: 'md' | 'lg'
  }>(),
  { size: 'md' },
)

const letter = computed(() => (props.name.trim().charAt(0) || '?').toUpperCase())
</script>

<style scoped>
.icon-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
</style>
