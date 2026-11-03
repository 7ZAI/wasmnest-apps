<template>
  <div class="h-full flex flex-col bg-[var(--bg-page)]" data-testid="project-workbench">
    <!-- ==================== 工具栏页头：返回 + 项目身份 + 刷新 ==================== -->
    <div class="wb-toolbar">
      <!-- 左组占满剩余宽度并允许收缩：不这样做，长项目名 / 长路径会把右侧状态与刷新按钮顶出可视区 -->
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <button
          class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          :title="t('project.workbench.back')"
          data-testid="project-back"
          @click="backToList"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <h2
          class="min-w-0 shrink truncate text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
        >
          {{ project?.name || t('project.sidebar.title') }}
        </h2>
        <span
          v-if="project"
          class="wb-mono text-[calc(10.5px*var(--ui-scale))] uppercase px-1.5 py-0.5 rounded border border-[var(--border-strong)] text-[var(--text-secondary)] flex-shrink-0"
        >
          {{ envBadge(project.environment) }}
        </span>
        <!-- 路径是次要信息：窗口窄到放不下时整段收起，别把它截成半截路径 -->
        <span
          v-if="project && showProjectPath"
          class="min-w-0 flex-1 wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] truncate"
          :title="project.workingDir"
        >
          {{ project.workingDir }}
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span
          v-if="activeRunCount > 0"
          class="wb-mono text-[calc(11px*var(--ui-scale))] text-green-600 dark:text-green-400 flex items-center gap-1.5"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
          {{ t('project.workbench.activeRuns', { n: activeRunCount }) }}
        </span>
        <button class="wb-btn-ghost" data-testid="workbench-refresh" @click="refresh">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {{ t('project.button.refresh') }}
        </button>
      </div>
    </div>

    <!-- 项目不存在（被移除 / 深链写错）：显性提示，不白屏 -->
    <div
      v-if="notFound"
      class="flex-1 flex flex-col items-center justify-center"
      data-testid="project-not-found"
    >
      <p class="text-sm text-[var(--text-primary)]">{{ t('project.error.notFound') }}</p>
      <button class="wb-btn-primary mt-4 h-8 px-4" @click="backToList">
        {{ t('project.workbench.back') }}
      </button>
    </div>

    <div v-else ref="layoutEl" class="flex-1 flex min-h-0" data-testid="workbench-layout">
      <!-- ==================== 左：运行列表 + 新建运行（宽度可拖拽；可折叠） ==================== -->
      <aside
        v-if="!runsCollapsed"
        id="wb-pane-runs"
        class="shrink-0 flex flex-col bg-[var(--bg-card)]"
        :style="{ width: `${runsWidth}px` }"
        data-testid="pane-runs"
      >
        <div
          class="h-10 px-2.5 shrink-0 flex items-center justify-between gap-2 border-b border-[var(--border)]"
        >
          <!-- 收起入口放在面板外侧边缘：箭头指向面板消失的方向，与右侧面板对称 -->
          <button
            class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
            :aria-expanded="!runsCollapsed"
            aria-controls="wb-pane-runs"
            :aria-label="t('project.run.collapse')"
            :title="t('project.run.collapse')"
            data-testid="run-collapse"
            @click="toggleRuns"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <span
            class="min-w-0 flex-1 truncate text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-[var(--text-tertiary)]"
          >
            {{ t('project.run.title') }}
            <span v-if="runs.length > 0" class="wb-mono">· {{ runs.length }}</span>
          </span>
          <button
            class="w-6 h-6 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            :disabled="isStarting"
            :title="t('project.run.new')"
            data-testid="run-new"
            @click="openAgentPicker"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>

        <!-- 运行列表 -->
        <div class="flex-1 overflow-y-auto py-2">
          <div v-if="isLoading" class="px-3 py-6 flex justify-center">
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
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v2a6 6 0 00-6 6H4z"
              ></path>
            </svg>
          </div>

          <div v-else-if="runs.length === 0" class="px-3 py-6 text-center" data-testid="run-empty">
            <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
              {{ t('project.run.empty') }}
            </p>
            <p
              class="mt-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
            >
              {{ t('project.run.emptyHint') }}
            </p>
          </div>

          <ul v-else class="space-y-0.5 px-1.5">
            <li v-for="run in runs" :key="run.id">
              <div
                class="group relative rounded-[6px] pl-2.5 pr-2 py-1.5 cursor-pointer transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-strong)]"
                :class="isActiveRun(run) && 'bg-[var(--bg-hover)]'"
                role="button"
                tabindex="0"
                data-testid="run-item"
                :data-status="run.status"
                :data-active="isActiveRun(run) ? 'true' : 'false'"
                @click="selectRun(run.id)"
                @keydown.enter.prevent="selectRun(run.id)"
                @keydown.space.prevent="selectRun(run.id)"
              >
                <!-- 选中态左侧竖标：仅靠底色时，选中与 hover 同色，看不出主面在看哪条 -->
                <span
                  v-if="isActiveRun(run)"
                  class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[var(--color-primary)]"
                  aria-hidden="true"
                ></span>
                <div class="flex items-center gap-2 min-w-0">
                  <span
                    :class="['w-1.5 h-1.5 rounded-full shrink-0', statusDot(run.status)]"
                  ></span>
                  <span
                    class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)] truncate flex-1"
                    :class="isActiveRun(run) && 'font-medium'"
                  >
                    {{ run.title || run.name }}
                  </span>
                  <!-- 无标题时 agent 名会与主标题重复（run.name 就是 agent 名），此时不再重复标注 -->
                  <span
                    v-if="run.agentId && run.agentId !== (run.title || run.name)"
                    class="wb-mono text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)] shrink-0"
                    >{{ run.agentId }}</span
                  >
                </div>
                <div class="mt-0.5 flex items-center gap-2 pl-3.5">
                  <span
                    class="wb-mono text-[calc(10.5px*var(--ui-scale))] text-[var(--text-secondary)]"
                  >
                    {{ statusText(run.status) }}
                  </span>
                  <span
                    class="wb-mono text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)]"
                  >
                    {{ relativeText(run.updatedAt) }}
                  </span>
                  <span class="flex-1"></span>
                  <!-- 停止：破坏性动作走 danger ghost（与会话页同口径） -->
                  <button
                    v-if="run.active"
                    class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 w-5 h-5 rounded-[4px] flex items-center justify-center text-[var(--color-danger)] hover:bg-[var(--bg-card)] transition-opacity"
                    :title="t('project.run.stop')"
                    data-testid="run-stop"
                    @click.stop="stop(run)"
                  >
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 6h12v12H6z"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <div class="p-2 border-t border-[var(--border)]">
          <button
            class="wb-btn-primary w-full"
            :disabled="isStarting"
            data-testid="run-new-primary"
            @click="openAgentPicker"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M12 4v16m8-8H4"
              />
            </svg>
            {{ isStarting ? t('project.run.starting') : t('project.run.new') }}
          </button>
        </div>
      </aside>

      <!-- 折叠后的窄轨：常驻恢复入口（不靠悬停，否则等于没有入口） -->
      <aside
        v-else
        class="shrink-0 flex flex-col items-center bg-[var(--bg-card)] border-r border-[var(--border)]"
        :style="{ width: `${PANE_RAIL_WIDTH}px` }"
        data-testid="pane-runs-rail"
      >
        <div class="h-10 shrink-0 flex items-center justify-center">
          <button
            class="w-6 h-6 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
            :aria-expanded="!runsCollapsed"
            aria-controls="wb-pane-runs"
            :aria-label="t('project.run.expand')"
            :title="t('project.run.expand')"
            data-testid="run-collapse"
            @click="toggleRuns"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
        <span class="wb-rail-label" aria-hidden="true">
          {{ t('project.run.title') }}
          <template v-if="runs.length > 0"> · {{ runs.length }}</template>
        </span>
      </aside>

      <!-- 拖拽手柄：左栏 ↔ 终端主面（双击复位；键盘 ←/→ 可调；收起时不渲染） -->
      <div
        v-if="!runsCollapsed"
        class="wb-split-handle"
        :class="runsResizing && 'wb-split-handle-active'"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t('project.split.resizeRuns')"
        :aria-valuenow="runsValueNow"
        :aria-valuemin="RUNS_MIN_WIDTH"
        :aria-valuemax="Number.isFinite(runsMaxWidth) ? runsMaxWidth : undefined"
        :title="t('project.split.resizeHint')"
        tabindex="0"
        data-testid="split-runs"
        @mousedown="onRunsHandleDown"
        @touchstart="onRunsHandleTouch"
        @dblclick="resetRunsWidth"
        @keydown="onRunsHandleKeydown"
      ></div>

      <!-- ==================== 中：终端主面（CLI 为核心：同一条 PTY 的真实字节） ==================== -->
      <section class="flex-1 min-w-0 flex flex-col" data-testid="pane-terminal">
        <div class="h-10 px-3 shrink-0 flex items-center gap-2 border-b border-[var(--border)]">
          <span
            class="shrink-0 whitespace-nowrap text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-[var(--text-tertiary)]"
          >
            {{ t('project.terminal.title') }}
          </span>
          <template v-if="selectedRun">
            <span
              class="min-w-0 wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] truncate"
            >
              {{ selectedRun.agentId || '—' }}
            </span>
            <!-- 模型：桥接 meta 回填到运行行后可见（无此数据时不占位） -->
            <span
              v-if="selectedRun.model && showRunMeta"
              class="min-w-0 wb-mono text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)] truncate"
              :title="selectedRun.model"
            >
              {{ selectedRun.model }}
            </span>
            <!-- 主面被拖窄时不硬塞会话 id：几样东西挤在一行只会互相裁剪 -->
            <span
              v-if="selectedRun.agentSessionId && showRunMeta"
              class="flex items-center gap-1 min-w-0"
            >
              <span
                class="text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)] shrink-0"
              >
                {{ t('project.run.agentSessionId') }}
              </span>
              <span
                class="wb-mono text-[calc(10.5px*var(--ui-scale))] text-[var(--text-secondary)] truncate"
              >
                {{ selectedRun.agentSessionId }}
              </span>
              <button
                class="w-5 h-5 shrink-0 rounded-[4px] flex items-center justify-center text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] transition-colors"
                :title="t('project.run.copyId')"
                data-testid="run-copy-session"
                @click="copyAgentSessionId"
              >
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.75"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </button>
            </span>
          </template>
          <span class="flex-1"></span>
          <!-- 打开独立终端窗口：跟终端主面走（原在检查器头部，终端迁中栏后随迁） -->
          <button
            v-if="selectedRun"
            class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!isLiveRun(selectedRun.status)"
            :title="t('project.run.openWindow')"
            data-testid="run-open-window"
            @click="openWindow"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
              />
            </svg>
          </button>
        </div>

        <!-- 未选中运行：显性空态，不白屏 -->
        <div
          v-if="!selectedRun"
          class="flex-1 flex flex-col items-center justify-center px-6 text-center"
          data-testid="workbench-empty"
        >
          <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
            {{ t('project.terminal.empty') }}
          </p>
          <p
            class="mt-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
          >
            {{ t('project.terminal.emptyHint') }}
          </p>
        </div>

        <!-- 终端：复用现有终端渲染管线（同一条 PTY 的真实字节） -->
        <div v-else class="flex-1 min-h-0 relative" data-testid="run-terminal">
          <TerminalPreview :session="selectedRunSession" :show-input="true" :show-header="false" />
        </div>
      </section>

      <!-- 拖拽手柄：终端主面 ↔ 右栏检查器（收起时不渲染） -->
      <div
        v-if="!inspectorCollapsed"
        class="wb-split-handle"
        :class="inspectorResizing && 'wb-split-handle-active'"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t('project.split.resizeInspector')"
        :aria-valuenow="inspectorValueNow"
        :aria-valuemin="INSPECTOR_MIN_WIDTH"
        :aria-valuemax="Number.isFinite(inspectorMaxWidth) ? inspectorMaxWidth : undefined"
        :title="t('project.split.resizeHint')"
        tabindex="0"
        data-testid="split-inspector"
        @mousedown="onInspectorHandleDown"
        @touchstart="onInspectorHandleTouch"
        @dblclick="resetInspectorWidth"
        @keydown="onInspectorHandleKeydown"
      ></div>

      <!-- ==================== 右：检查器（文件 / Git / 变更；宽度可拖拽；可折叠） ==================== -->
      <aside
        v-if="!inspectorCollapsed"
        id="wb-pane-inspector"
        class="shrink-0 flex flex-col bg-[var(--bg-card)]"
        :style="{ width: `${inspectorWidth}px` }"
        data-testid="pane-inspector"
      >
        <div
          class="h-10 px-2 shrink-0 flex items-center gap-1 border-b border-[var(--border)]"
          role="tablist"
        >
          <button
            v-for="tab in inspectorTabs"
            :key="tab.key"
            class="h-7 px-2.5 rounded-[6px] text-[calc(11.5px*var(--ui-scale))] transition-colors"
            :class="
              inspectorTab === tab.key
                ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            "
            :aria-selected="inspectorTab === tab.key"
            :tabindex="inspectorTab === tab.key ? 0 : -1"
            :data-testid="`inspector-tab-${tab.key}`"
            role="tab"
            @click="selectInspectorTab(tab.key)"
            @keydown="onTabKeydown"
          >
            {{ tab.label }}
          </button>
          <span class="flex-1"></span>
          <button
            class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
            :aria-expanded="!inspectorCollapsed"
            aria-controls="wb-pane-inspector"
            :aria-label="t('project.inspector.collapse')"
            :title="t('project.inspector.collapse')"
            data-testid="inspector-collapse"
            @click="toggleInspector"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>

        <!-- 文件：默认页签；v-show 保活（切到变更再回来不丢展开态 / 不重复取数） -->
        <div v-show="inspectorTab === 'files'" class="flex-1 min-h-0" data-testid="inspector-files">
          <ProjectFileTree
            :project-id="projectId"
            :working-dir="project?.workingDir ?? ''"
            :active="inspectorTabReady && inspectorTab === 'files'"
            @open="openFile"
          />
        </div>

        <!-- Git：提交历史 + 分支 DAG（文件树旁的提交图；同样 v-show 保活滚动位置） -->
        <div v-show="inspectorTab === 'git'" class="flex-1 min-h-0" data-testid="inspector-git">
          <ProjectGitGraph
            :project-id="projectId"
            :active="inspectorTabReady && inspectorTab === 'git'"
          />
        </div>

        <!-- 变更（M3 才接管） -->
        <template v-if="inspectorTab === 'changes'">
          <!-- 未选中运行 -->
          <div
            v-if="!selectedRun"
            class="flex-1 flex items-center justify-center px-6 text-center"
            data-testid="inspector-empty"
          >
            <p class="text-[calc(11.5px*var(--ui-scale))] text-[var(--text-secondary)]">
              {{ t('project.inspector.noSelection') }}
            </p>
          </div>

          <div
            v-else
            class="flex-1 flex items-center justify-center px-6 text-center"
            data-testid="inspector-changes"
          >
            <p class="text-[calc(11.5px*var(--ui-scale))] text-[var(--text-secondary)]">
              {{ t('project.inspector.changesEmpty') }}
            </p>
          </div>
        </template>
      </aside>

      <!-- 折叠后的窄轨：常驻恢复入口（与左侧同构，箭头指向面板展开方向） -->
      <aside
        v-if="inspectorCollapsed"
        class="shrink-0 flex flex-col items-center bg-[var(--bg-card)] border-l border-[var(--border)]"
        :style="{ width: `${PANE_RAIL_WIDTH}px` }"
        data-testid="pane-inspector-rail"
      >
        <div class="h-10 shrink-0 flex items-center justify-center">
          <button
            class="w-6 h-6 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
            :aria-expanded="!inspectorCollapsed"
            aria-controls="wb-pane-inspector"
            :aria-label="t('project.inspector.expand')"
            :title="t('project.inspector.expand')"
            data-testid="inspector-collapse"
            @click="toggleInspector"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        </div>
        <span class="wb-rail-label" aria-hidden="true">
          {{ t('project.inspector.title') }}
        </span>
      </aside>
    </div>

    <!-- 文件查看器：只读；点文件打开，关闭后保留文件页签位置 -->
    <ProjectFileViewer
      v-model="fileViewerOpen"
      :project-id="projectId"
      :path="fileViewerPath"
      :name="fileViewerName"
    />

    <!-- ==================== 选 agent 启动（项目 → 运行） ==================== -->
    <PluginModal v-model="showAgentPicker" :title="t('project.run.pickAgent')" size="lg">
      <div v-if="agents.length === 0" class="py-6 text-center">
        <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)]">
          {{ t('project.run.emptyHint') }}
        </p>
      </div>
      <ul v-else class="space-y-1.5">
        <li v-for="agent in agents" :key="agent.id">
          <div
            class="flex items-center gap-3 rounded-[8px] border border-[var(--border)] px-3 py-2.5 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
            :data-testid="`run-agent-${agent.id}`"
            @click="pickAgent(agent)"
          >
            <!-- 图标芯片：四个 agent 都有固定品牌色（claude 橙 / pi 三色 / codex 蓝 /
                 opencode 橙金），中性浅底只做形状衬托，不承载品牌色 -->
            <span
              class="w-8 h-8 shrink-0 rounded-[9px] bg-[var(--bg-hover)] flex items-center justify-center"
            >
              <svg
                class="w-6 h-6"
                :viewBox="agentGlyph(agent.id).viewBox"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  v-for="(path, index) in agentGlyph(agent.id).paths"
                  :key="index"
                  :d="path.d"
                  :fill="path.fill ?? agentGlyph(agent.id).color"
                  :fill-rule="path.rule ?? 'nonzero'"
                />
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-[calc(12.5px*var(--ui-scale))] text-[var(--text-primary)] truncate">
                {{ agent.displayName }}
              </div>
              <div
                class="wb-mono text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)] truncate"
              >
                {{ agent.binary }}
              </div>
            </div>
            <span
              v-if="agent.readiness === 'missing'"
              class="wb-mono text-[calc(10px*var(--ui-scale))] px-1.5 py-0.5 rounded border border-[var(--border-strong)] text-[var(--text-secondary)] shrink-0"
            >
              {{ t('project.run.agentMissing') }}
            </span>
            <span
              v-else-if="agent.readiness === 'unknown'"
              class="wb-mono text-[calc(10px*var(--ui-scale))] px-1.5 py-0.5 rounded border border-[var(--border-strong)] text-[var(--text-secondary)] shrink-0"
            >
              {{ t('project.run.agentUnknown') }}
            </span>
            <button
              v-if="agent.readiness === 'missing'"
              class="shrink-0 whitespace-nowrap leading-none py-1 text-[calc(10.5px*var(--ui-scale))] text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
              data-testid="run-agent-install"
              @click.stop="goInstall"
            >
              {{ t('project.run.installHint') }}
            </button>
          </div>
        </li>
      </ul>
    </PluginModal>
  </div>
</template>

<script setup lang="ts">
/**
 * 项目工作台（ADR 0003 / issue #23 M2；CLI 为核心：终端即主面）
 *
 * 三栏：左运行列表 + 新建运行｜中终端主面｜右检查器（文件 / Git / 变更）。右栏
 * 文件页签是当前项目 workingDir 的目录树（与移动端文件浏览同语义），默认落在文件；
 * Git 页签是同一目录的提交历史与分支图（project.git-log）；变更是 M3 占位。
 *
 * **终端主面不是新写的渲染层**：它就是 `TerminalPreview`（现有渲染管线：xterm +
 * 输出拉取 + 背压 ack + IME/尺寸处理），只是把「运行视图」投影成它认的会话形状
 * ——「终端显示的是同一条 PTY 的真实字节」这条要求靠复用成立，不靠重写。
 * 对话经 CLI（终端）直接进行，前端不再渲染对话流（M3 对话面已撤销）。
 *
 * **两侧宽度可拖拽**（usePaneResize）：写死宽度在窄窗口下会把终端主面挤成一条缝，
 * 而终端宽度直接决定 PTY 列数与换行——宽度该由用户定。上限按容器实测宽度反推
 * （保住终端主面最小宽），拖拽 / 键盘 <- / -> / 双击复位三套入口，宽度记在
 * app KV 里下次沿用。
 *
 * **新建运行 = 在项目里选一个 agent**：后端按（项目, agent）取/建启动参数并走
 * 唯一启动链；前端只准备终端网格（先预测再启动，避免开终端后重排）。
 */
import { computed, inject, onMounted, onUnmounted, reactive, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import PluginModal from '@/components/PluginModal.vue'
import ProjectFileTree from '@/components/projects/ProjectFileTree.vue'
import ProjectFileViewer from '@/components/projects/ProjectFileViewer.vue'
import ProjectGitGraph from '@/components/projects/ProjectGitGraph.vue'
import TerminalPreview from '@/components/terminal/TerminalPreview.vue'
import { resolvePluginErrorText } from '@/utils/pluginError'
import { agentGlyph } from '@/agents/registry'
import { usePaneResize } from '@/composables/usePaneResize'
import {
  envBadge,
  isLiveRun,
  relativeTimeSpec,
  runAsSession,
  useProjects,
  type AgentEntry,
  type RunView,
} from '@/composables/useProjects'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)
const route = useRoute()
const router = useRouter()

const projectId = computed(() => String(route.params.id ?? ''))

const {
  project,
  runs,
  agents,
  activeRunCount,
  isLoading,
  now,
  loadWorkbench,
  loadRuns,
  loadProject,
  loadAgents,
  openProject,
  startRun,
  stopRun,
  openRunWindow,
  startTicker,
  stopTicker,
} = useProjects(context)

const selectedRunId = ref('')
const notFound = ref(false)
const isStarting = ref(false)
const showAgentPicker = ref(false)

// ==================== 右栏页签（文件 / Git / 变更） ====================

type InspectorTab = 'files' | 'git' | 'changes'

/** 默认落在「文件」：项目页最常查的是目录，变更是 M3 才接管的空占位 */
const inspectorTab = ref<InspectorTab>('files')
/** 持久化偏好读回前不触发文件树取数（避免「上次停在变更」也先弹一次授权） */
const inspectorTabReady = ref(false)
/** 首帧不把默认值写回存储（只有用户操作 / 读回完成后才持久化） */
let persistInspectorTab = false

const INSPECTOR_TAB_KEY = 'project.workbench.inspectorTab'

const inspectorTabs = computed<{ key: InspectorTab; label: string }[]>(() => [
  { key: 'files', label: t('project.files.title') },
  { key: 'git', label: t('project.git.title') },
  { key: 'changes', label: t('project.inspector.changes') },
])

function selectInspectorTab(tab: InspectorTab): void {
  inspectorTab.value = tab
}

/** 页签键盘导航（←/→ 循环、Home/End 到两端；焦点跟随选中项） */
function onTabKeydown(event: KeyboardEvent): void {
  const keys = inspectorTabs.value.map((tab) => tab.key)
  const current = keys.indexOf(inspectorTab.value)
  let next = current
  if (event.key === 'ArrowRight') next = (current + 1) % keys.length
  else if (event.key === 'ArrowLeft') next = (current - 1 + keys.length) % keys.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = keys.length - 1
  else return
  event.preventDefault()
  inspectorTab.value = keys[next]
  const tabs = (
    event.currentTarget as HTMLElement | null
  )?.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')
  tabs?.[next]?.focus()
}

/** 读回上次停留的页签；读失败 / 值非法按默认「文件」处理 */
async function loadInspectorTab(): Promise<void> {
  try {
    const raw = await context.storage.get(INSPECTOR_TAB_KEY)
    if (raw === 'files' || raw === 'git' || raw === 'changes') inspectorTab.value = raw
  } catch (e) {
    console.warn('[Project Workbench] read inspector tab failed:', e)
  } finally {
    inspectorTabReady.value = true
    persistInspectorTab = true
  }
}

watch(inspectorTab, (tab) => {
  if (!persistInspectorTab) return
  void context.storage.set(INSPECTOR_TAB_KEY, tab).catch((e) => {
    // 写失败只影响下次进入的默认页签，不阻断当前交互
    console.warn('[Project Workbench] persist inspector tab failed:', e)
  })
})

// ==================== 文件查看器 ====================

const fileViewerOpen = ref(false)
const fileViewerPath = ref('')
const fileViewerName = ref('')

function openFile(name: string, path: string): void {
  fileViewerName.value = name
  fileViewerPath.value = path
  fileViewerOpen.value = true
}

/** 切到另一个项目时收起查看器：旧路径在新项目里没有意义 */
watch(projectId, () => {
  fileViewerOpen.value = false
})

// ==================== 三栏宽度（可拖拽） ====================

/** 运行列表默认宽度（= 原 w-64，改动后仍从同一默认值起步） */
const RUNS_DEFAULT_WIDTH = 256
const RUNS_MIN_WIDTH = 200
/** 检查器默认宽度（= 原 w-[420px]） */
const INSPECTOR_DEFAULT_WIDTH = 420
const INSPECTOR_MIN_WIDTH = 320
/**
 * 中间终端主面最小宽度。
 *
 * 两侧是固定像素列，窗口一窄就会把中间挤成一条缝（实测 1180 宽时主面只剩 250px，
 * 标题条里的「Agent 会话」直接和标题撞上）。上限据此反推：两侧再拖也不能吃掉它。
 */
const CENTER_MIN_WIDTH = 320
/** 两个拖拽手柄的宽度合计（手柄是布局内的实体，不是覆盖层） */
const SPLIT_HANDLE_WIDTH = 6

/**
 * 折叠后的窄轨宽度
 *
 * 收起两侧面板是为了把宽度还给终端，但恢复入口必须始终可达：按 hover 才显出按钮
 * 等于没有入口（UX 准则 Compact Control Semantics 明确禁止把唯一动作藏在 hover 里）。
 * 窄轨同时回答两个问题——「这里有一块面板」与「点哪里打开」。
 */
const PANE_RAIL_WIDTH = 36

const runsCollapsed = ref(false)
const inspectorCollapsed = ref(false)

/** 折叠标记与宽度共用同一个 app KV：重进工作台沿用上次布局 */
const RUNS_COLLAPSED_KEY = 'project.workbench.runsCollapsed'
const INSPECTOR_COLLAPSED_KEY = 'project.workbench.inspectorCollapsed'

/** 可见手柄宽度合计：收起的一侧不渲染手柄，那一段宽度就不该参与布局预算 */
const handleWidth = computed(
  () =>
    (runsCollapsed.value ? 0 : SPLIT_HANDLE_WIDTH) +
    (inspectorCollapsed.value ? 0 : SPLIT_HANDLE_WIDTH),
)

const layoutEl = ref<HTMLElement | null>(null)
/** 三栏容器实测宽度（0 = 还没测到，此时不夹上限，避免把存下来的宽度误压到下限） */
const layoutWidth = ref(0)

/**
 * 两侧当前宽度的镜像（上限函数要读「另一侧现在多宽」，但两个 pane 互相引用会在
 * setup 期踩 TDZ）。镜像由下面的 sync watcher 实时保持同步，拖动过程中也不滞后。
 *
 * 存的是**生效宽度**，不是用户拖出来的宽度：折叠的一侧只占窄轨，上限就该按窄轨算，
 * 否则收起一块面板后另一侧仍然拖不宽（看起来像没生效）。
 */
const paneMetrics = reactive({ runs: RUNS_DEFAULT_WIDTH, inspector: INSPECTOR_DEFAULT_WIDTH })

/** 运行列表上限：容器宽 − 检查器生效宽 − 中间最小宽 − 手柄（收起的一侧不占手柄） */
function runsMax(): number {
  if (layoutWidth.value <= 0) return Number.POSITIVE_INFINITY
  return Math.max(
    RUNS_MIN_WIDTH,
    layoutWidth.value - paneMetrics.inspector - CENTER_MIN_WIDTH - handleWidth.value,
  )
}

/** 检查器上限：容器宽 − 运行列表生效宽 − 中间最小宽 − 手柄 */
function inspectorMax(): number {
  if (layoutWidth.value <= 0) return Number.POSITIVE_INFINITY
  return Math.max(
    INSPECTOR_MIN_WIDTH,
    layoutWidth.value - paneMetrics.runs - CENTER_MIN_WIDTH - handleWidth.value,
  )
}

const {
  width: runsWidth,
  isResizing: runsResizing,
  maxWidth: runsMaxWidth,
  valueNow: runsValueNow,
  onResizeStart: onRunsHandleDown,
  onResizeTouchStart: onRunsHandleTouch,
  onKeydown: onRunsHandleKeydown,
  reset: resetRunsWidth,
  reconcile: reconcileRuns,
  load: loadRunsWidth,
  dispose: disposeRuns,
} = usePaneResize({
  initial: RUNS_DEFAULT_WIDTH,
  min: RUNS_MIN_WIDTH,
  max: runsMax,
  direction: 'ltr',
  storageKey: 'project.workbench.runsWidth',
  storage: context.storage,
})

const {
  width: inspectorWidth,
  isResizing: inspectorResizing,
  maxWidth: inspectorMaxWidth,
  valueNow: inspectorValueNow,
  onResizeStart: onInspectorHandleDown,
  onResizeTouchStart: onInspectorHandleTouch,
  onKeydown: onInspectorHandleKeydown,
  reset: resetInspectorWidth,
  reconcile: reconcileInspector,
  load: loadInspectorWidth,
  dispose: disposeInspector,
} = usePaneResize({
  initial: INSPECTOR_DEFAULT_WIDTH,
  min: INSPECTOR_MIN_WIDTH,
  max: inspectorMax,
  direction: 'rtl',
  storageKey: 'project.workbench.inspectorWidth',
  storage: context.storage,
})

// ==================== 两侧面板折叠 ====================

/** 生效宽度：折叠的一侧只占窄轨（拖出来的宽度仍存着，展开时原样回来） */
const effectiveRunsWidth = computed(() => (runsCollapsed.value ? PANE_RAIL_WIDTH : runsWidth.value))
const effectiveInspectorWidth = computed(() =>
  inspectorCollapsed.value ? PANE_RAIL_WIDTH : inspectorWidth.value,
)

/** 读不到就按展开算：布局偏好读失败不该让面板打不开 */
async function loadCollapsed(key: string, target: Ref<boolean>): Promise<void> {
  try {
    target.value = (await context.storage.get(key)) === true
  } catch (e) {
    console.warn('[Project Workbench] read collapsed state failed:', e)
  }
}

/** 写失败不影响交互（下进来回到默认布局，不报错） */
async function persistCollapsed(key: string, collapsed: boolean): Promise<void> {
  try {
    await context.storage.set(key, collapsed)
  } catch (e) {
    console.warn('[Project Workbench] persist collapsed state failed:', e)
  }
}

function toggleRuns(): void {
  runsCollapsed.value = !runsCollapsed.value
  void persistCollapsed(RUNS_COLLAPSED_KEY, runsCollapsed.value)
}

function toggleInspector(): void {
  inspectorCollapsed.value = !inspectorCollapsed.value
  void persistCollapsed(INSPECTOR_COLLAPSED_KEY, inspectorCollapsed.value)
}

/** 容器宽度变化：先压检查器，再压运行列表（顺序决定窄窗口下谁先让位） */
watch(layoutWidth, (width) => {
  if (width <= 0) return
  reconcileInspector()
  reconcileRuns()
})

// 镜像必须同步更新：拖拽中每帧都会读上限，异步 watcher 会让上限慢一拍；
// 镜像存的是生效宽度，所以折叠开关也要触发重算（否则收起一块后另一侧拖不宽）
watch(effectiveRunsWidth, (width) => (paneMetrics.runs = width), {
  immediate: true,
  flush: 'sync',
})
watch(effectiveInspectorWidth, (width) => (paneMetrics.inspector = width), {
  immediate: true,
  flush: 'sync',
})

/**
 * 监听三栏容器的实测宽度
 *
 * 不用窗口宽度：应用挂在宿主挂载槽里，侧边栏折叠 / 窗口分屏都会改变可用宽度，
 * 只有容器自己的尺寸是准的。
 */
watch(layoutEl, (el, _previous, onCleanup) => {
  if (!el) return
  if (typeof ResizeObserver === 'undefined') {
    layoutWidth.value = el.clientWidth
    return
  }
  const observer = new ResizeObserver((entries) => {
    layoutWidth.value = entries[0]?.contentRect?.width ?? el.clientWidth
  })
  observer.observe(el)
  layoutWidth.value = el.clientWidth
  onCleanup(() => observer.disconnect())
})

/** 终端主面实际宽度（容器 − 两侧生效宽 − 可见手柄）：标题条据此取舍信息，而不是按窗口断点猜 */
const centerWidth = computed(() =>
  Math.max(
    0,
    layoutWidth.value -
      effectiveRunsWidth.value -
      effectiveInspectorWidth.value -
      handleWidth.value,
  ),
)

/** 会话 id + 复制按钮约占 200px：放不下就整块收起，不切成半截 */
const showRunMeta = computed(() => centerWidth.value >= 460)

/** 工具栏里的项目路径：窄窗口下让位给「运行中 / 刷新」（悬停 title 仍能看到完整路径） */
const showProjectPath = computed(() => layoutWidth.value === 0 || layoutWidth.value >= 820)

/** 选中运行（选中 id 失配时退回第一条，避免删/停之后中栏空着） */
const selectedRun = computed<RunView | null>(() => {
  const byId = runs.value.find((run) => run.id === selectedRunId.value)
  return byId ?? runs.value[0] ?? null
})

/** 传给终端组件的会话形状（同一条 PTY，运行视图 ↔ 会话视图同源） */
const selectedRunSession = computed(() =>
  selectedRun.value ? runAsSession(selectedRun.value) : null,
)

// ==================== 状态展示 ====================

/**
 * 是否是「检查器正在看的那条」
 *
 * 判据取 `selectedRun`（含「没点过就回落到第一条」的兜底），不是 `selectedRunId`：
 * 后者在首次进入时是空的，会让列表一条都不高亮、而中栏却已经在渲染第一条的终端。
 */
function isActiveRun(run: RunView): boolean {
  return selectedRun.value?.id === run.id
}

function statusDot(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-green-500 animate-pulse'
    case 'waitingInput':
      return 'bg-amber-500'
    case 'starting':
      return 'bg-blue-500 animate-pulse'
    case 'error':
      return 'bg-red-500'
    default:
      return 'bg-[var(--text-tertiary)]'
  }
}

function statusText(status: string): string {
  switch (status) {
    case 'starting':
      return t('session.status.starting')
    case 'running':
      return t('session.status.running')
    case 'waitingInput':
      return t('session.status.asking')
    case 'error':
      return t('session.status.error')
    case 'stopped':
      return t('session.status.stopped')
    default:
      return t('session.status.unknown')
  }
}

function relativeText(iso: string | null): string {
  const spec = relativeTimeSpec(iso, now.value)
  return spec ? t(spec.key, spec.params) : '--'
}

// ==================== 数据加载 ====================

async function load(): Promise<void> {
  isLoading.value = true
  notFound.value = false
  try {
    await loadWorkbench(projectId.value)
    // 项目不存在（被移除 / 深链写错）：显性空态，不把工作台渲染成「一个空项目」
    notFound.value = project.value === null
    if (!notFound.value) {
      // 深链进入（宿主恢复 lastRoute）也要记一次「打开」：列表排序与「最近打开」
      // 语义靠它，否则只有从列表点进来的那次算数。失败不影响工作台。
      await openProject(projectId.value).catch((e) => {
        console.warn('[Project Workbench] touch lastOpenedAt failed:', e)
      })
    }
  } catch (e) {
    console.error('[Project Workbench] load failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.error.loadFailed'))
  } finally {
    isLoading.value = false
  }
}

/** 运行状态变化只重取运行 + 项目统计（agent 清单无需跟着刷） */
async function refreshRuns(): Promise<void> {
  try {
    await Promise.all([loadRuns(projectId.value), loadProject(projectId.value)])
  } catch (e) {
    console.error('[Project Workbench] refresh runs failed:', e)
  }
}

async function refresh(): Promise<void> {
  try {
    await Promise.all([loadRuns(projectId.value), loadProject(projectId.value), loadAgents()])
    toast.info(t('project.toast.refreshed'))
  } catch (e) {
    toast.error(resolvePluginErrorText(context, e, 'project.error.loadFailed'))
  }
}

// ==================== 运行编排 ====================

function selectRun(runId: string): void {
  selectedRunId.value = runId
}

async function openAgentPicker(): Promise<void> {
  try {
    await loadAgents()
  } catch (e) {
    // 清单取不到不该把弹窗变成空白：注册表不可用是运行期异常，显性提示
    console.error('[Project Workbench] load agents failed:', e)
  }
  showAgentPicker.value = true
}

/**
 * 选中一个 agent 后的分流
 *
 * 探测确认「未安装」的 agent 不去撞启动失败：点了只会得到一条「启动运行失败」，
 * 用户还得自己找安装入口。这种行整行点下去就是去安装（与行内链接同一落点）；
 * `unknown`（探测没结论）仍允许尝试启动，不谎称未安装。
 */
function pickAgent(agent: AgentEntry): void {
  if (agent.readiness === 'missing') {
    goInstall()
    return
  }
  void start(agent.id)
}

async function start(agentId: string): Promise<void> {
  if (isStarting.value) return
  isStarting.value = true
  try {
    const created = await startRun(projectId.value, agentId)
    selectedRunId.value = created.runId
    // 新运行立刻有字节可看：终端主面随选中运行切换
    showAgentPicker.value = false
  } catch (e) {
    console.error('[Project Workbench] start run failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.run.startFailed'))
  } finally {
    isStarting.value = false
  }
}

async function stop(run: RunView): Promise<void> {
  try {
    await stopRun(run.id, projectId.value)
    toast.info(t('session.toast.stopped'))
  } catch (e) {
    console.error('[Project Workbench] stop run failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.run.stopFailed'))
  }
}

async function openWindow(): Promise<void> {
  const run = selectedRun.value
  if (!run) return
  // 终态运行没有存活 PTY：宿主开窗也会立刻空着，先在这里显性拒绝
  if (!isLiveRun(run.status)) {
    toast.info(t('session.error.notRunning'))
    return
  }
  try {
    await openRunWindow(run)
  } catch (e) {
    console.error('[Project Workbench] open window failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'session.terminal.openFailed'))
  }
}

function goInstall(): void {
  showAgentPicker.value = false
  void router.push('/agents')
}

async function copyAgentSessionId(): Promise<void> {
  const id = selectedRun.value?.agentSessionId
  if (!id) return
  try {
    await navigator.clipboard.writeText(id)
    toast.success(t('project.run.copied'))
  } catch (e) {
    // 剪贴板不可用不影响阅读：id 就在标题条上可选中复制
    console.error('[Project Workbench] clipboard unavailable:', e)
  }
}

function backToList(): void {
  void router.push('/projects')
}

// ==================== 生命周期 ====================

/** 会话生命周期事件：运行是会话的容器化投影，事件仍由会话域发 */
let eventDisposables: { dispose(): void }[] = []

onMounted(async () => {
  // 先读回上次的三栏布局（宽度 + 折叠状态；读不到即用默认值，不阻塞取数）
  void loadRunsWidth()
  void loadInspectorWidth()
  void loadInspectorTab()
  void loadCollapsed(RUNS_COLLAPSED_KEY, runsCollapsed)
  void loadCollapsed(INSPECTOR_COLLAPSED_KEY, inspectorCollapsed)
  await load()
  startTicker()
  const refreshOnEvent = () => {
    void refreshRuns()
  }
  eventDisposables = [
    context.events.on('session:created', refreshOnEvent),
    context.events.on('session:stopped', refreshOnEvent),
    context.events.on('session:removed', refreshOnEvent),
  ]
})

onUnmounted(() => {
  stopTicker()
  disposeRuns()
  disposeInspector()
  for (const disposable of eventDisposables) disposable.dispose()
  eventDisposables = []
})
</script>

<style scoped>
/**
 * 拖拽手柄：6px 命中区 + 居中 1px 分隔线
 *
 * 命中区比视觉线宽得多是刻意的：1px 的线鼠标根本抓不住，而视觉上 6px 的粗线又会
 * 把三栏切得很碎。`touch-action: none` 让触屏拖拽不被滚动/缩放手势抢走。
 */
.wb-split-handle {
  position: relative;
  flex: 0 0 6px;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
  outline: none;
  transition: background-color 120ms ease;
}

.wb-split-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--border);
  transition:
    background-color 120ms ease,
    width 120ms ease;
}

.wb-split-handle:hover::before,
.wb-split-handle:focus-visible::before {
  width: 2px;
  background: color-mix(in srgb, var(--color-primary) 45%, transparent);
}

.wb-split-handle:focus-visible {
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}

.wb-split-handle-active::before {
  width: 2px;
  background: var(--color-primary);
}

/**
 * 折叠窄轨里的竖排面板名
 *
 * CJK 在 `vertical-rl` 下是正字竖排（不是旋转的字），刚好能让「运行」/「变更」在
 * 36px 宽的轨道里读得出来；夹带的少量英文/数字会被旋转，仍然可辨。
 */
.wb-rail-label {
  writing-mode: vertical-rl;
  letter-spacing: 0.08em;
  user-select: none;
  font-size: calc(10px * var(--ui-scale));
  text-transform: uppercase;
  color: var(--text-tertiary);
}
</style>
