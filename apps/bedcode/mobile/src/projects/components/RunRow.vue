<template>
  <div
    class="group-row run-row"
    :class="run.active ? 'run-row--active' : 'run-row--ended'"
    data-testid="mobile-run-row"
    :data-status="run.status"
    :data-active="run.active ? 'true' : 'false'"
  >
    <!-- 行主区用真按钮：避免「role=button 的容器里再嵌停止按钮」的嵌套交互 -->
    <button
      type="button"
      class="run-open flex-1 min-w-0 flex items-center gap-3 text-left"
      :aria-label="run.active ? `${t('project.run.open')} ${run.title || run.name}` : undefined"
      @click="onOpen"
    >
      <span class="icon-chip" :class="runStatusChipClass(run.status)" aria-hidden="true">
        <span class="run-dot" :class="{ 'run-dot--pulse': isPulsing }"></span>
      </span>

      <span class="flex-1 min-w-0 block">
        <span class="flex items-center gap-2 min-w-0">
          <span class="group-row-title truncate">{{ run.title || run.name }}</span>
          <span class="status-badge shrink-0" :class="runStatusBadgeClass(run.status)">
            {{ t(runStatusLabelKey(run.status)) }}
          </span>
        </span>
        <span class="group-row-sub mt-0.5 flex items-center gap-2 min-w-0">
          <span class="font-mono truncate">{{ run.agentId || '—' }}</span>
          <span class="shrink-0 font-mono">{{ relativeText }}</span>
        </span>
      </span>
    </button>

    <button
      v-if="run.active"
      type="button"
      class="run-stop shrink-0 flex items-center justify-center rounded-lg active:opacity-80 transition-colors"
      :title="t('project.run.stop')"
      :aria-label="t('project.run.stop')"
      @click="$emit('stop', run)"
    >
      <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 运行行（项目详情）
 *
 * - 活跃运行：主区可点 → 打开终端；右侧停止按钮（触控目标 44px）。
 * - 终态运行：主区仍可点但只给「已结束」提示（PTY 已回收，订阅必空），整体降透明度。
 * - 语义结构：外层只是布局行，主区是真 `<button>`，停止按钮是并列按钮——避免嵌套交互。
 * - 状态只用现有 `icon-chip` / `status-badge` 语言；点用 currentColor，不新增色板。
 */
import { computed } from 'vue'
import { useHostPage } from '../../host/useHostPage'
import {
  relativeTimeSpec,
  runStatusBadgeClass,
  runStatusChipClass,
  runStatusLabelKey,
  type RunView,
} from '../types'

const props = defineProps<{
  run: RunView
  now: number
}>()

const emit = defineEmits<{ open: [run: RunView]; stop: [run: RunView] }>()

const t = useHostPage().t

/**
 * 过渡态才呼吸（2026-11-05 unslop 审核，与桌面端同口径）：
 * 稳态 running 是事实，用静态点；starting / stopping 才是进行中的变化。
 */
const isPulsing = computed(
  () => props.run.status === 'starting' || props.run.status === 'stopping',
)

const relativeText = computed(() => {
  const spec = relativeTimeSpec(props.run.updatedAt, props.now)
  return spec ? t(spec.key, spec.params) : '--'
})

function onOpen(): void {
  // 终态行也上抛：父级给「已结束」的显性提示，而不是让点击毫无反馈
  emit('open', props.run)
}
</script>

<style scoped>
.run-row {
  transition: background-color 0.15s ease;
}

.run-row--active:active {
  background: var(--mobile-group-row-active);
}

.run-row--ended {
  opacity: 0.62;
}

/* 主区按钮去掉原生外观，保留行内布局 */
.run-open {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.run-open:active {
  opacity: 0.8;
}

.run-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
}

.run-dot--pulse {
  animation: run-dot-pulse 1.6s ease-in-out infinite;
}

@keyframes run-dot-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.run-stop {
  width: 2.75rem;
  height: 2.75rem;
  background: color-mix(in srgb, var(--mobile-chip-red) 16%, transparent);
  color: var(--mobile-chip-red);
  border: 1px solid color-mix(in srgb, var(--mobile-chip-red) 35%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .run-dot--pulse {
    animation: none;
  }
}
</style>
