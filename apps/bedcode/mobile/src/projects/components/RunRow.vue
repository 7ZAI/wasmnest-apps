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
      <!-- 状态列：一个 8px 点。整块列表只有一个东西带颜色，就是它 -->
      <span class="run-state" aria-hidden="true">
        <span
          class="run-dot"
          :class="{ 'run-dot--pulse': isPulsing }"
          :style="{ background: runStatusDotColor(run.status) }"
        />
      </span>

      <span class="flex-1 min-w-0 block">
        <span class="group-row-title truncate block">{{ run.title || run.name }}</span>
        <!-- 副行是机器事实：状态名 + agent + 相对时间，全部同档小字 -->
        <span class="run-meta mt-0.5 flex items-center gap-2 min-w-0">
          <span class="status-text shrink-0" :style="{ color: statusTextColor }">
            {{ t(runStatusLabelKey(run.status)) }}
          </span>
          <span class="font-mono truncate">{{ run.agentId || '—' }}</span>
          <span class="shrink-0 font-mono">{{ relativeText }}</span>
        </span>
      </span>
    </button>

    <button
      v-if="run.active"
      type="button"
      class="run-stop shrink-0 flex items-center justify-center active:opacity-80 transition-colors"
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
 * - 终态运行：store 已过滤（`liveRuns`），一般不会出现在列表；组件仍保留降透明度 /
 *   不可打开的形态，兜住会话事件刷新前的过渡帧。
 * - 语义结构：外层只是布局行，主区是真 `<button>`，停止按钮是并列按钮——避免嵌套交互。
 *
 * 2026-11-11 unslop：去掉「彩色图标底 + 彩色状态胶囊」两层色块，改成
 * 左列一个状态点 + 副行一句状态文字。两处同时上色时，颜色既不是状态色也不是
 * 分类色，只是装饰；现在绿 = 在跑、琥珀 = 等输入、红 = 出错、灰 = 过渡 / 终态。
 */
import { computed } from 'vue'
import { useHostPage } from '../../host/useHostPage'
import {
  relativeTimeSpec,
  runStatusDotColor,
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

/** 状态文字跟随状态点：只有需要人注意的两个态上色，其余取次文字色 */
const statusTextColor = computed(() => {
  if (props.run.status === 'waitingInput') return 'var(--mobile-warning)'
  if (props.run.status === 'error') return 'var(--mobile-error)'
  return 'var(--mobile-text-secondary)'
})

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
  transition: background-color var(--bc-dur-fast) var(--bc-ease);
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

/* 状态列：固定宽度，四行点对齐成一列（标题 / 副行都从这里开始） */
.run-state {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 8px;
  flex-shrink: 0;
}

.run-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
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

.run-meta {
  font-size: var(--font-size-sm);
  color: var(--mobile-text-muted);
}

.status-text {
  font-weight: 500;
}

.run-stop {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--bc-radius-control);
  color: var(--mobile-text-muted);
  border: 1px solid var(--mobile-border);
  background: transparent;
}

.run-stop:active {
  color: var(--mobile-error);
  border-color: color-mix(in srgb, var(--mobile-error) 35%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .run-dot--pulse {
    animation: none;
  }
}
</style>
