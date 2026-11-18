<template>
  <div class="flex flex-col h-full min-h-0" data-testid="project-git">
    <!-- 头部：当前分支 + 提交数 + 刷新（与文件树工具栏同节奏） -->
    <div
      class="h-8 px-2 shrink-0 flex items-center gap-1 border-b border-[var(--border)]"
      data-testid="project-git-toolbar"
    >
      <svg
        class="w-3.5 h-3.5 shrink-0 text-[var(--text-tertiary)]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.75"
          d="M6 3v15m12-12a9 9 0 01-9 9"
        />
        <circle cx="6" cy="3" r="2.25" stroke-width="1.75" />
        <circle cx="6" cy="18" r="2.25" stroke-width="1.75" />
        <circle cx="18" cy="6" r="2.25" stroke-width="1.75" />
      </svg>
      <span
        v-if="isLoaded && isGitRepo && currentBranch"
        class="min-w-0 truncate wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]"
        :title="currentBranch"
        data-testid="git-branch"
      >
        {{ currentBranch }}
      </span>
      <span
        v-else-if="isLoaded && isGitRepo"
        class="min-w-0 truncate text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
        data-testid="git-branch"
      >
        {{ t('project.git.detached') }}
      </span>
      <span class="flex-1"></span>
      <span
        v-if="isLoaded && isGitRepo && commits.length > 0"
        class="wb-mono shrink-0 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
        data-testid="git-commit-count"
      >
        {{ t('project.git.commitCount', { n: commits.length }) }}
      </span>
      <button
        class="wb-tree-action"
        :title="t('project.git.refresh')"
        :aria-label="t('project.git.refresh')"
        data-testid="git-refresh"
        @click="reload"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
    </div>

    <!-- 加载 / 错误 / 非仓库 / 空仓库：全部显性，不拿空白面板冒充「没有提交」 -->
    <div
      v-if="isLoading && !isLoaded"
      class="flex-1 flex items-center justify-center gap-2"
      data-testid="git-loading"
    >
      <svg
        class="w-4 h-4 animate-spin text-[var(--text-secondary)]"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          class="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="2"
        ></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v2a6 6 0 00-6 6H4z"></path>
      </svg>
      <span class="text-[calc(11.5px*var(--ui-scale))] text-[var(--text-secondary)]">
        {{ t('project.git.loading') }}
      </span>
    </div>

    <div
      v-else-if="error"
      class="flex-1 min-h-0 overflow-y-auto px-3 py-4 text-center"
      data-testid="git-error"
    >
      <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
        {{ errorText }}
      </p>
      <button class="wb-btn-ghost mt-3" data-testid="git-retry" @click="reload">
        {{ t('project.git.retry') }}
      </button>
    </div>

    <div
      v-else-if="!isGitRepo"
      class="flex-1 flex flex-col items-center justify-center px-6 text-center"
      data-testid="git-not-repo"
    >
      <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
        {{ t('project.git.notRepo') }}
      </p>
      <p
        class="mt-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
      >
        {{ t('project.git.notRepoHint') }}
      </p>
    </div>

    <div
      v-else-if="commits.length === 0"
      class="flex-1 flex flex-col items-center justify-center px-6 text-center"
      data-testid="git-empty"
    >
      <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
        {{ t('project.git.empty') }}
      </p>
      <p
        class="mt-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
      >
        {{ t('project.git.emptyHint') }}
      </p>
    </div>

    <div
      v-else
      class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-1"
      data-testid="git-commit-list"
    >
      <div
        v-for="row in layout.rows"
        :key="row.commit.hash"
        class="wb-git-row"
        :style="{ height: `${ROW_HEIGHT}px` }"
        :title="rowTitle(row.commit)"
        data-testid="git-commit-row"
        :data-hash="row.commit.hash"
        :data-lane="row.lane"
      >
        <svg
          class="shrink-0"
          :width="graphWidth"
          :height="ROW_HEIGHT"
          aria-hidden="true"
          focusable="false"
        >
          <path
            v-for="edge in row.through"
            :key="`t-${edge.id}`"
            :d="throughPath(edge)"
            :stroke="laneColor(edge.color)"
            stroke-width="1.5"
            fill="none"
          />
          <path
            v-for="edge in row.incoming"
            :key="`i-${edge.id}`"
            :d="incomingPath(edge, row.lane)"
            :stroke="laneColor(edge.color)"
            stroke-width="1.5"
            fill="none"
          />
          <path
            v-for="edge in row.outgoing"
            :key="`o-${edge.id}`"
            :d="outgoingPath(row.lane, edge.lane)"
            :stroke="laneColor(edge.color)"
            stroke-width="1.5"
            fill="none"
          />
          <circle
            :cx="laneX(row.lane)"
            :cy="ROW_HEIGHT / 2"
            r="3.25"
            :fill="laneColor(row.color)"
            stroke="var(--bg-card)"
            stroke-width="1.5"
          />
        </svg>

        <div class="min-w-0 flex-1 flex flex-col justify-center">
          <div class="flex items-center gap-1 min-w-0">
            <span
              v-for="ref in visibleRefs(row.commit.refs)"
              :key="ref.raw"
              class="wb-git-ref"
              :class="`wb-git-ref-${ref.kind}`"
              :title="ref.raw"
            >
              {{ ref.name }}
            </span>
            <span v-if="hiddenRefCount(row.commit.refs) > 0" class="wb-git-ref wb-git-ref-more">
              +{{ hiddenRefCount(row.commit.refs) }}
            </span>
            <span
              class="min-w-0 truncate text-[calc(11.5px*var(--ui-scale))] text-[var(--text-primary)]"
            >
              {{ row.commit.subject || t('project.git.noSubject') }}
            </span>
          </div>
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="wb-mono shrink-0 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
            >
              {{ row.commit.shortHash }}
            </span>
            <span
              class="min-w-0 truncate text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]"
            >
              {{ row.commit.author }}
            </span>
            <span
              class="wb-mono shrink-0 ml-auto text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
            >
              {{ relativeDate(row.commit.date) }}
            </span>
          </div>
        </div>
      </div>

      <div
        v-if="truncated"
        class="px-3 py-2 text-center text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
        data-testid="git-truncated"
      >
        {{ t('project.git.truncated', { n: commits.length }) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 项目 Git 提交图（工作台右栏「Git」页签）
 *
 * 纯展示层：数据来自 `useProjectGit`（project.git-log），拓扑布局来自
 * `utils/gitGraph` 的纯函数。每行一个定高 SVG（而非一整幅大图）——行是滚动
 * 容器里的普通列表项，300 条提交不会变成一张 12000px 高的 SVG；同时逐行画线
 * 保证跨行对齐（车道 x 坐标只由全局 laneCount 决定）。
 *
 * 颜色只用于区分分支线，不承载「状态」语义；色板取 8 个互相可辨的中亮色，
 * 在明暗主题下都保持可读。提交行本身不可聚焦（列表是阅读面，不是操作面），
 * 完整 hash / 邮箱 / 时间放在原生 title 里。
 */
import { computed, inject, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useProjectGit, type GitCommit } from '@/composables/useProjectGit'
import { relativeTimeSpec } from '@/composables/useProjects'
import { layoutGitGraph, GIT_GRAPH_PALETTE_SIZE, type GitGraphEdge } from '@/utils/gitGraph'
import { resolvePluginErrorText } from '@/utils/pluginError'

const props = defineProps<{
  projectId: string
  /** 当前页签是否可见：不可见不取数 */
  active: boolean
}>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const { isGitRepo, currentBranch, commits, truncated, isLoading, error, isLoaded, load, reset } =
  useProjectGit(
    context,
    computed(() => props.projectId),
  )

const errorText = computed(() =>
  resolvePluginErrorText(context, error.value, 'project.git.loadFailed'),
)

const layout = computed(() => layoutGitGraph(commits.value))

// ==================== 图形常量与路径 ====================

/** 行高：两行文字（标题 + 元信息）在 11.5px/10.5px 字号下留足呼吸 */
const ROW_HEIGHT = 40
/** 车道间距：14px 足够画出圆点 + 两条曲线不相交的视觉间隙 */
const LANE_WIDTH = 14
/** 左右内边距（圆点半径 3.25，留 3.75px 抗锯齿余量） */
const GRAPH_PAD = 7

const graphWidth = computed(() => Math.max(GRAPH_PAD * 2, layout.value.laneCount * LANE_WIDTH))

/** 8 槽色板：蓝 / 琥珀 / 翠绿 / 粉 / 紫 / 青 / 红 / 黄绿（明暗主题通用） */
const LANE_COLORS = [
  '#3b82f6',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
] as const

function laneColor(slot: number): string {
  return LANE_COLORS[slot % GIT_GRAPH_PALETTE_SIZE]
}

function laneX(lane: number): number {
  return GRAPH_PAD + lane * LANE_WIDTH
}

function throughPath(edge: GitGraphEdge): string {
  const x = laneX(edge.lane)
  return `M${x} 0V${ROW_HEIGHT}`
}

/** 上方汇入：从边上车道落进提交圆点（同车道 = 竖直线） */
function incomingPath(edge: GitGraphEdge, lane: number): string {
  const from = laneX(edge.lane)
  const to = laneX(lane)
  if (from === to) return `M${from} 0V${ROW_HEIGHT / 2}`
  return `M${from} 0C${from} ${ROW_HEIGHT * 0.35} ${to} ${ROW_HEIGHT * 0.15} ${to} ${ROW_HEIGHT / 2}`
}

/** 下方离开：从提交圆点分叉到边上车道（第一父提交为竖直线） */
function outgoingPath(fromLane: number, toLane: number): string {
  const from = laneX(fromLane)
  const to = laneX(toLane)
  if (from === to) return `M${from} ${ROW_HEIGHT / 2}V${ROW_HEIGHT}`
  return `M${from} ${ROW_HEIGHT / 2}C${from} ${ROW_HEIGHT * 0.65} ${to} ${ROW_HEIGHT * 0.85} ${to} ${ROW_HEIGHT}`
}

// ==================== 引用装饰 / 元信息 ====================

type RefKind = 'head' | 'tag' | 'branch'

interface DisplayRef {
  raw: string
  name: string
  kind: RefKind
}

/** 只展示前两个引用；其余折叠成 +N（窄栏里徽标比提交标题更该让位） */
const MAX_VISIBLE_REFS = 2

function parseRef(raw: string): DisplayRef {
  if (raw.startsWith('tag: ')) return { raw, name: raw.slice(5), kind: 'tag' }
  if (raw.startsWith('HEAD -> ')) return { raw, name: raw.slice(8), kind: 'head' }
  return { raw, name: raw, kind: 'branch' }
}

function visibleRefs(refs: string[]): DisplayRef[] {
  return refs.slice(0, MAX_VISIBLE_REFS).map(parseRef)
}

function hiddenRefCount(refs: string[]): number {
  return Math.max(0, refs.length - MAX_VISIBLE_REFS)
}

function relativeDate(iso: string): string {
  const spec = relativeTimeSpec(iso, Date.now())
  return spec ? t(spec.key, spec.params) : '--'
}

/** 原生 tooltip：完整 hash / 作者邮箱 / 提交时间（列表里放不下的排障信息） */
function rowTitle(commit: GitCommit): string {
  const lines = [commit.hash, commit.subject, `${commit.author} <${commit.email}>`, commit.date]
  if (commit.refs.length > 0) lines.push(commit.refs.join(', '))
  return lines.filter(Boolean).join('\n')
}

// ==================== 取数编排 ====================

watch(
  () => props.projectId,
  () => {
    // 项目切换：清空旧历史；若页签可见立即读新项目
    reset()
    if (props.active) void load()
  },
)

watch(
  () => props.active,
  (active) => {
    if (active) void load()
  },
  { immediate: true },
)

function reload(): void {
  void load(true)
}
</script>

<style scoped>
/** 工具栏按钮（与 ProjectFileTree 的 .wb-tree-action 同形；scoped 样式不跨组件） */
.wb-tree-action {
  width: 1.5rem;
  height: 1.5rem;
  flex-shrink: 0;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.wb-tree-action:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.wb-tree-action:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

/** 行：与文件树行同宽，hover 只做轻微底色提示（阅读面，无点击动作） */
.wb-git-row {
  display: flex;
  align-items: stretch;
  gap: 0.375rem;
  padding: 0 0.5rem;
  transition: background-color 120ms ease;
}

.wb-git-row:hover {
  background: var(--bg-hover);
}

/**
 * 引用徽标：HEAD（当前分支）用主色描边，tag 用琥珀系，其它分支用弱边框。
 * 全部走 `color-mix` 派生，避免在组件里再写一套主题色。
 */
.wb-git-ref {
  flex-shrink: 0;
  max-width: 7.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 0.3rem;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: calc(9.5px * var(--ui-scale));
  line-height: 1.35;
  color: var(--text-secondary);
}

.wb-git-ref-head {
  border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
}

.wb-git-ref-tag {
  border-color: color-mix(in srgb, #f59e0b 55%, transparent);
  background: color-mix(in srgb, #f59e0b 12%, transparent);
  color: color-mix(in srgb, #f59e0b 78%, var(--text-primary));
}

.wb-git-ref-more {
  color: var(--text-tertiary);
}
</style>
