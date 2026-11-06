<template>
  <button
    type="button"
    class="project-card w-full text-left rounded-xl border p-4 transition-colors active:opacity-80"
    :style="{
      background: 'var(--mobile-bg-card)',
      borderColor: 'var(--mobile-border)',
    }"
    :aria-label="`${t('project.card.open')} ${project.name}`"
    data-testid="mobile-project-card"
    @click="$emit('open', project)"
  >
    <div class="flex items-center gap-3 min-w-0">
      <span class="config-icon chip-cyan" aria-hidden="true">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
          />
        </svg>
      </span>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="group-row-title truncate">{{ project.name }}</span>
          <span
            v-if="project.activeRuns > 0"
            class="status-badge badge-emerald shrink-0"
            role="status"
            :title="t('project.card.activeRuns', { n: project.activeRuns })"
            :aria-label="t('project.card.activeRuns', { n: project.activeRuns })"
          >
            <span class="status-dot dot-emerald" aria-hidden="true"></span>
            {{ project.activeRuns }}
          </span>
          <span class="env-badge shrink-0" :class="envChipClass(project.environment)">
            {{ envLabel(project.environment) }}
          </span>
        </div>
        <p class="group-row-sub font-mono truncate mt-1">{{ project.workingDir }}</p>
      </div>

      <svg
        class="w-4 h-4 shrink-0"
        style="color: var(--mobile-text-disabled)"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
    </div>

    <div class="project-meta mt-3 flex items-center gap-3 flex-wrap min-w-0">
      <span class="flex items-center gap-1 min-w-0">
        <span class="project-meta-label">{{ t('project.card.lastActivity') }}</span>
        <span class="project-meta-value font-mono truncate">{{ activityText }}</span>
      </span>
      <span v-if="project.lastAgentId" class="flex items-center gap-1">
        <span class="project-meta-label">{{ t('project.card.lastAgent') }}</span>
        <span class="project-meta-value font-mono">{{ project.lastAgentId }}</span>
      </span>
      <span class="project-meta-value font-mono">
        {{ t('project.card.runCount', { n: project.runCount }) }}
      </span>
    </div>
  </button>
</template>

<script setup lang="ts">
/**
 * 项目卡（项目列表一行）
 *
 * 信息层级：名称 + 活跃运行数 + 环境徽标；路径独占一行（mono、可截断）；
 * 底部元信息为最近活动 / 最近 Agent / 运行数。移动端不提供改名 / 删除入口
 * （项目写面在桌面端）。
 */
import { computed } from 'vue'
import { useHostPage } from '../../host/useHostPage'
import { envChipClass, envLabel, relativeTimeSpec, type ProjectView } from '../types'

const props = defineProps<{
  project: ProjectView
  /** 当前时间（父级 ticker 推进；相对时间按此计算） */
  now: number
}>()

defineEmits<{ open: [project: ProjectView] }>()

const t = useHostPage().t

const activityText = computed(() => {
  const spec = relativeTimeSpec(props.project.lastActivityAt, props.now)
  return spec ? t(spec.key, spec.params) : t('project.card.noActivity')
})
</script>

<style scoped>
.project-meta {
  font-size: var(--font-size-sm);
  color: var(--mobile-text-muted);
}

.project-meta-label {
  color: var(--mobile-text-muted);
}

.project-meta-value {
  color: var(--mobile-text-secondary);
  font-size: var(--font-size-sm);
}

.env-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.02em;
}
</style>
