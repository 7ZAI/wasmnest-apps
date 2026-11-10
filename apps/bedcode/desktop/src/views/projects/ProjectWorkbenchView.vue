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
          class="wb-mono text-[calc(11px*var(--ui-scale))] uppercase px-1.5 py-0.5 rounded border border-[var(--border-strong)] text-[var(--text-secondary)] flex-shrink-0"
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
          class="wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--color-success-ink)] flex items-center gap-1.5"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]"></span>
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
          <!-- 收起入口放在面板外侧边缘，与右侧面板对称。
               图标用「侧栏」图形（不用箭头）：页头的返回按钮已经是箭头，箭头会被读成
               「上一页」；填充的左列 = 面板当前展开，与 aria-expanded 同义。 -->
          <button
            class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
            :aria-expanded="!runsCollapsed"
            aria-controls="wb-pane-runs"
            :aria-label="t('project.run.collapse')"
            :title="t('project.run.collapse')"
            data-testid="run-collapse"
            @click="toggleRuns"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect x="3.5" y="5" width="17" height="14" rx="2" stroke-width="1.5" />
              <path stroke-width="1.5" d="M9.5 5v14" />
              <rect
                x="5.5"
                y="6.8"
                width="2.2"
                height="10.4"
                rx="1.1"
                fill="currentColor"
                stroke="none"
                opacity="0.45"
              />
            </svg>
          </button>
          <span
            class="min-w-0 flex-1 truncate text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
          >
            {{ t('project.run.title') }}
            <span v-if="liveRuns.length > 0" class="wb-mono">· {{ liveRuns.length }}</span>
          </span>
          <button
            class="w-6 h-6 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            :disabled="isStarting"
            :title="isStarting ? t('project.run.starting') : t('project.run.new')"
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

          <div
            v-else-if="liveRuns.length === 0"
            class="px-3 py-6 text-center"
            data-testid="run-empty"
          >
            <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
              {{ t('project.run.empty') }}
            </p>
            <p
              class="mt-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
            >
              {{ t('project.run.emptyHint') }}
            </p>
          </div>

          <template v-else>
            <ul v-if="liveRuns.length > 0" class="space-y-0.5 px-1.5">
              <li v-for="run in liveRuns" :key="run.id">
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
                      class="wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]"
                    >
                      {{ statusText(run.status) }}
                    </span>
                    <span
                      class="wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
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
          </template>
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
            <!-- 与展开态同一「侧栏」图形，只是不填充：面板收起时左列不亮 -->
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect x="3.5" y="5" width="17" height="14" rx="2" stroke-width="1.5" />
              <path stroke-width="1.5" d="M9.5 5v14" />
            </svg>
          </button>
        </div>
        <span class="wb-rail-label" aria-hidden="true">
          {{ t('project.run.title') }}
          <template v-if="liveRuns.length > 0"> · {{ liveRuns.length }}</template>
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
      <section class="flex-1 min-w-0 flex flex-col relative" data-testid="pane-terminal">
        <div class="h-10 px-3 shrink-0 flex items-center gap-2 border-b border-[var(--border)]">
          <span
            class="shrink-0 whitespace-nowrap text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
          >
            {{ t('project.terminal.title') }}
          </span>
          <!-- 拼屏：主 header 只留全局信息；每条运行的标题 / 状态 / 控制都在各自格子上 -->
          <span
            v-if="tileMode"
            class="shrink-0 whitespace-nowrap wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]"
            data-testid="terminal-tile-summary"
          >
            {{ t('project.terminal.tileMode') }} · {{ tiledRuns.length }}
          </span>
          <template v-if="selectedRun && !tileMode">
            <span
              class="min-w-0 wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] truncate"
            >
              {{ selectedRun.agentId || '—' }}
            </span>

            <!-- 状态与运行时长：与独立终端窗口同一实现（useTerminalChrome） -->
            <span
              class="shrink-0 flex items-center gap-1.5"
              data-testid="terminal-status"
              :title="chromeStatusText"
              :data-status="selectedRun.status"
            >
              <span :class="['w-1.5 h-1.5 rounded-full', chromeStatusColor]"></span>
              <span
                :class="['text-[calc(11px*var(--ui-scale))] font-medium', chromeStatusLabelClass]"
              >
                {{ chromeStatusText }}
              </span>
            </span>
            <span
              v-if="showRunMeta"
              class="shrink-0 wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
              data-testid="terminal-uptime"
            >
              {{ chromeUptimeText }}
            </span>

            <!-- 模型 / 思考等级：控制项属于运行，由共享 selects 组件取数与切换 -->
            <RunAgentSelects :run="selectedRun" @changed="refreshRuns" />

            <!-- 主面被拖窄时不硬塞会话 id：几样东西挤在一行只会互相裁剪 -->
            <span
              v-if="selectedRun.agentSessionId && showRunMeta"
              class="flex items-center gap-1 min-w-0"
            >
              <span class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] shrink-0">
                {{ t('project.run.agentSessionId') }}
              </span>
              <span
                class="wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] truncate"
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

          <!-- ==================== 操作区（与独立窗口功能对齐；窗口控制不搬） ==================== -->
          <!-- 任务队列：判据取后端 is_supported，不在前端 hardcode agent 白名单。
               拼屏时每格自带任务入口（RunTileControls），主 header 不再代替焦点行。 -->
          <button
            v-if="!tileMode && selectedRun && chromeTaskSupported"
            class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            :title="t('task.title')"
            data-testid="terminal-task-queue"
            @click="openTaskQueue()"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M4 6h16M4 12h16M4 18h10"
              />
            </svg>
          </button>
          <!-- 停止运行：破坏性动作，danger ghost（与独立窗口同族语义）。
               拼屏后停止属于每一条运行，放在各自格子 header 上。 -->
          <button
            v-if="!tileMode && selectedRun && isRunLive"
            class="h-6 shrink-0 rounded-[6px] border px-2 flex items-center justify-center text-[calc(11px*var(--ui-scale))] border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-[var(--color-primary-contrast)] transition-colors"
            :title="t('project.run.stop')"
            data-testid="terminal-stop"
            @click="stop(selectedRun)"
          >
            {{ t('session.button.stop') }}
          </button>
          <!-- 设置面板：主题 / 字号 / 字间距 / 背景图 / 不透明度 -->
          <button
            class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            :class="{ 'bg-[var(--bg-hover)]': settingsOpen }"
            :title="t('session.terminal.settings')"
            data-testid="terminal-settings-toggle"
            @click.stop="toggleSettings"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          </button>
          <!-- 清屏 / 刷新格式：作用于当前焦点终端（拼屏时 = 选中格） -->
          <button
            class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!activeTerminal()"
            :title="t('session.terminal.clearScreen')"
            data-testid="terminal-clear"
            @click="clearActiveTerminal"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
          <button
            class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!activeTerminal()"
            :title="t('session.terminal.refreshFormat')"
            data-testid="terminal-refresh"
            @click="refreshActiveTerminal"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>

          <!-- 拼屏开关：把该项目存活运行的终端一起铺开（最多 4 格，点击格子换焦点） -->
          <button
            class="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-[6px] border h-6 px-2 text-[calc(11px*var(--ui-scale))] transition-colors"
            :class="
              tileMode
                ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--bg-hover)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            "
            :aria-pressed="tileMode"
            :title="tileMode ? t('project.terminal.singleMode') : t('project.terminal.tileMode')"
            data-testid="run-tile-toggle"
            @click="toggleTileMode"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z"
              />
            </svg>
            {{ tileMode ? t('project.terminal.singleMode') : t('project.terminal.tileMode') }}
          </button>
          <!-- 打开独立终端窗口：跟终端主面走（原在检查器头部，终端迁中栏后随迁）。
               拼屏时每格有自己的开窗按钮。 -->
          <button
            v-if="!tileMode && selectedRun"
            class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!isRunLive"
            :title="t('project.run.openWindow')"
            data-testid="run-open-window"
            @click="openWindow()"
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

        <!-- 设置抽屉：与独立终端窗口同一实现（纯受控，值绑当前焦点终端） -->
        <TerminalSettingsPanel
          v-model:open="settingsOpen"
          v-model:theme="settingsTheme"
          v-model:font-size="settingsFontSize"
          v-model:letter-spacing="settingsLetterSpacing"
          v-model:bg-opacity="settingsBgOpacity"
          :has-bg-image="hasBgImage"
          :bg-image-name="bgImageName"
          :theme-options="themeSelectOptions"
          :font-size-options="fontSizeSelectOptions"
          :letter-spacing-options="letterSpacingSelectOptions"
          @pick-bg="pickBgImage"
          @remove-bg="removeBgImage"
        />

        <!-- 拼屏：多条存活运行的终端同屏（每格复用同一渲染管线，各自一条真实 PTY） -->
        <div v-if="tileMode" class="flex-1 min-h-0 flex flex-col" data-testid="run-tiles">
          <div
            v-if="tiledRuns.length === 0"
            class="flex-1 flex flex-col items-center justify-center px-6 text-center"
            data-testid="run-tiles-empty"
          >
            <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
              {{ t('project.terminal.tileEmpty') }}
            </p>
            <p
              class="mt-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
            >
              {{ t('project.terminal.tileEmptyHint') }}
            </p>
          </div>

          <div
            v-else
            class="flex-1 min-h-0 grid gap-2 p-2"
            :class="tileGridClass"
            data-testid="run-tile-grid"
          >
            <div
              v-for="(run, index) in tiledRuns"
              :key="run.id"
              class="min-w-0 min-h-0 flex flex-col rounded-[8px] border overflow-hidden bg-[var(--bg-page)] transition-colors"
              :class="[
                isActiveRun(run) ? 'border-[var(--color-primary)]' : 'border-[var(--border)]',
                index === 0 && tileLayout.firstSpansRows && 'row-span-2',
              ]"
              data-testid="run-tile"
              :data-run-id="run.id"
              :data-active="isActiveRun(run) ? 'true' : 'false'"
              @mousedown="onTilePointerDown(run)"
              @click="focusTile(run)"
              @focusin="focusTile(run)"
            >
              <div
                class="h-8 shrink-0 flex items-center gap-1.5 px-2 border-b border-[var(--border)] bg-[var(--bg-card)]"
                data-testid="run-tile-header"
              >
                <span :class="['w-1.5 h-1.5 rounded-full shrink-0', statusDot(run.status)]"></span>
                <span
                  class="min-w-0 flex-1 truncate text-[calc(11.5px*var(--ui-scale))] text-[var(--text-primary)]"
                  :title="run.title || run.name"
                >
                  {{ run.title || run.name }}
                </span>
                <span
                  class="wb-mono shrink-0 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
                >
                  {{ statusText(run.status) }}
                </span>
                <!-- 每格自己的模型 / 思考等级 / 任务 / 停止 / 开窗（非全局功能不挂在主 header） -->
                <RunTileControls
                  :run="run"
                  @stop="stop(run)"
                  @open="openWindow(run)"
                  @task="openTaskQueue(run)"
                  @changed="refreshRuns"
                />
              </div>
              <div class="flex-1 min-h-0 relative">
                <TerminalPreview
                  :ref="(el) => setTileTerminalRef(run.id, el)"
                  :session="runAsSession(run)"
                  :show-header="false"
                  :auto-focus="isActiveRun(run)"
                />
              </div>
            </div>
          </div>

          <!-- 超过 4 条不静默丢弃：点左栏运行把它换进网格 -->
          <p
            v-if="hiddenTileCount > 0"
            class="shrink-0 px-2 pb-1.5 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
            data-testid="run-tiles-hint"
          >
            {{ t('project.terminal.tileHidden', { n: hiddenTileCount }) }}
          </p>
        </div>

        <!-- 单屏：一条运行的终端（既有行为不变） -->
        <template v-else>
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

          <!-- 终端：复用现有终端渲染管线（同一条 PTY 的真实字节）。
               只有存活运行才挂终端：终态运行的 PTY 已回收，挂上去只会得到一块
               永远空白的 xterm，且 fit/resize 会向不存在的 PTY 反复发命令
               （宿主「会话缺少 PTY 句柄」错误日志）。 -->
          <div v-else-if="isRunLive" class="flex-1 min-h-0 relative" data-testid="run-terminal">
            <TerminalPreview
              ref="singleTerminalRef"
              :session="selectedRunSession"
              :show-input="true"
              :show-header="false"
            />
          </div>

          <!-- 选中终态运行：显性说明「运行已结束」，不打开空终端 -->
          <div
            v-else
            class="flex-1 flex flex-col items-center justify-center px-6 text-center"
            data-testid="run-terminal-ended"
          >
            <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
              {{ t('project.terminal.runEnded') }}
            </p>
            <p
              class="mt-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] leading-relaxed"
            >
              {{ t('project.terminal.runEndedHint') }}
            </p>
          </div>
        </template>
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
        class="shrink-0 relative z-40 flex flex-col bg-[var(--bg-card)]"
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
            <!-- 右栏镜像：图形同左栏，只是分隔线/填充列在右侧 -->
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect x="3.5" y="5" width="17" height="14" rx="2" stroke-width="1.5" />
              <path stroke-width="1.5" d="M14.5 5v14" />
              <rect
                x="16.3"
                y="6.8"
                width="2.2"
                height="10.4"
                rx="1.1"
                fill="currentColor"
                stroke="none"
                opacity="0.45"
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

      <!-- 折叠后的窄轨：常驻恢复入口（与左侧同构，同一「侧栏」图形、不填充 = 面板收起） -->
      <aside
        v-if="inspectorCollapsed"
        class="shrink-0 relative z-40 flex flex-col items-center bg-[var(--bg-card)] border-l border-[var(--border)]"
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
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect x="3.5" y="5" width="17" height="14" rx="2" stroke-width="1.5" />
              <path stroke-width="1.5" d="M14.5 5v14" />
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
                class="wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] truncate"
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
              class="shrink-0 whitespace-nowrap leading-none py-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
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
 *
 * **运行列表与 agent CLI 同生命周期**（herdr agents 区口径）：卡片只在 agent
 * 进程存活期间展示；用户在 CLI 里 exit / 进程被杀 → 会话终态 → 卡片消失。
 * 不做「归档」整理：结束的运行不再留在列表里，记录仍归会话域持有。
 *
 * **拼屏（多终端同屏，2026-11-05）**：中栏可切「拼屏」，把该项目存活运行的终端
 * 一起铺开（最多 4 格；1 / 2 / 3 / 4 格自适应网格）。每格复用 TerminalPreview
 * （各自一条真实 PTY），点格子换焦点；超过 4 条由左栏点选换入，不静默丢弃。
 * 模式按项目记在 app KV；只铺存活运行（终态运行的 PTY 已回收）。
 * **运行相关控制（停止 / 模型 / 思考等级 / 任务队列 / 独立开窗）住在各自格子的
 * header 上**：它们只对某一条运行生效，挂在全局 header 会被误读成对所有格生效。
 * 主 header 只留拼屏开关、终端设置与作用于焦点终端的动作。
 */
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
  type Ref,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import PluginModal from '@/components/PluginModal.vue'
import ProjectFileTree from '@/components/projects/ProjectFileTree.vue'
import RunAgentSelects from '@/components/projects/RunAgentSelects.vue'
import RunTileControls from '@/components/projects/RunTileControls.vue'
import ProjectFileViewer from '@/components/projects/ProjectFileViewer.vue'
import ProjectGitGraph from '@/components/projects/ProjectGitGraph.vue'
import TerminalPreview from '@/components/terminal/TerminalPreview.vue'
import TerminalSettingsPanel from '@/components/terminal/TerminalSettingsPanel.vue'
import { resolvePluginErrorText } from '@/utils/pluginError'
import { agentGlyph } from '@/agents/registry'
import { usePaneResize } from '@/composables/usePaneResize'
import { hiddenLiveRunCount, pickTiledRuns, tileGridLayout } from '@/utils/runTiles'
import {
  envBadge,
  isLiveRun,
  relativeTimeSpec,
  runAsSession,
  useProjects,
  type AgentEntry,
  type RunView,
} from '@/composables/useProjects'
import {
  useTerminalHostCapabilities,
  createFallbackHostCapabilities,
} from '@/components/terminal/terminalHostCapabilities'
import { useTerminalChrome } from '@/composables/terminal/useTerminalChrome'
import {
  TERMINAL_THEME_SELECT_OPTIONS,
  TERMINAL_FONT_SIZE_SELECT_OPTIONS,
} from '@/utils/terminal/terminalThemes'
import { taskModalSessionId, taskModalVisible } from '@/state'

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

// ==================== 运行列表（与 agent CLI 同生命周期） ====================
//
// 只列存活运行：agent CLI 退出 → 会话终态 → 卡片立即从列表消失（记录仍留在
// 会话域）。已取消「归档」整理面：用户不需要手动把结束的运行藏起来。
// 选中项若是刚结束的运行，主面给「运行已结束」空态，不自动跳到别的运行。
const liveRuns = computed(() => runs.value.filter((run) => isLiveRun(run.status)))

// ==================== 拼屏（多终端同屏） ====================
//
// 口径（2026-11-05 用户裁决「按推荐」）：只铺**存活运行**，最多 4 格；顺序 =
// 最近聚焦优先（左栏点选换入）→ 列表序。每格复用 TerminalPreview（一条真实
// PTY），不新建渲染层。模式按项目持久化；优先序只在本次进入工作台内有效。
const TILE_MODE_KEY_PREFIX = 'project.workbench.tileMode.'
const tileMode = ref(false)
/** 最近聚焦的存活运行 id（拼屏顺序；切项目即清） */
const tilePriority = ref<string[]>([])
/** 异步读回的代次：切项目 / 用户已手动切换时丢弃过期结果 */
let tileModeLoadSeq = 0
let tileModeUserSet = false

const tiledRuns = computed(() => pickTiledRuns(runs.value, tilePriority.value))
const hiddenTileCount = computed(() => hiddenLiveRunCount(runs.value, tiledRuns.value))
const tileLayout = computed(() => tileGridLayout(tiledRuns.value.length))
/** 列 / 行给静态类名（Tailwind 只编译源码里出现过的字面量，不拼接动态类） */
const tileGridClass = computed(() => [
  tileLayout.value.columns === 2 ? 'grid-cols-2' : 'grid-cols-1',
  tileLayout.value.rows === 2 ? 'grid-rows-2' : 'grid-rows-1',
])

async function loadTileMode(pid: string): Promise<void> {
  const seq = ++tileModeLoadSeq
  tileModeUserSet = false
  tileMode.value = false
  if (!pid) return
  try {
    const raw = await context.storage.get(`${TILE_MODE_KEY_PREFIX}${pid}`)
    if (seq !== tileModeLoadSeq || tileModeUserSet) return
    tileMode.value = raw === true
  } catch (e) {
    // 读失败按单屏处理：布局偏好不该把工作台拦住
    console.warn('[Project Workbench] read tile mode failed:', e)
  }
}

function persistTileMode(): void {
  const pid = projectId.value
  if (!pid) return
  void context.storage.set(`${TILE_MODE_KEY_PREFIX}${pid}`, tileMode.value).catch((e) => {
    console.warn('[Project Workbench] persist tile mode failed:', e)
  })
}

/** 把运行顶到拼屏最前（左栏点选「换入」；已在网格里则只换焦点，不重排） */
function bumpTilePriority(runId: string): void {
  tilePriority.value = [runId, ...tilePriority.value.filter((id) => id !== runId)]
}

function toggleTileMode(): void {
  tileMode.value = !tileMode.value
  tileModeUserSet = true
  persistTileMode()
  if (!tileMode.value) return
  // 打开拼屏先铺用户正在看的那条；它不在存活态时把焦点落到第一格
  const current = selectedRun.value
  if (current && isLiveRun(current.status)) {
    bumpTilePriority(current.id)
    focusTileTerminal(current.id)
  } else {
    const first = tiledRuns.value[0]
    if (first) {
      selectedRunId.value = first.id
      focusTileTerminal(first.id)
    }
  }
}

/** 点格子 = 换焦点（不重排：点第 4 格却把它弹到第 1 格会打断阅读） */
function focusTile(run: RunView): void {
  if (selectedRunId.value !== run.id) selectedRunId.value = run.id
}

/** 单屏终端实例（清屏 / 刷新 / 设置读写的作用对象） */
const singleTerminalRef = ref<InstanceType<typeof TerminalPreview> | null>(null)

/** 拼屏格子组件引用（按运行 id）：左栏换入 / 点标题条后把键盘焦点交给该格终端 */
const tileTerminalRefs = new Map<string, { focus?: () => void }>()

function setTileTerminalRef(runId: string, el: unknown): void {
  if (el) tileTerminalRefs.set(runId, el as { focus?: () => void })
  else tileTerminalRefs.delete(runId)
}

function focusTileTerminal(runId: string): void {
  void nextTick(() => tileTerminalRefs.get(runId)?.focus?.())
}

/** 点格子（标题条 / 空白处）：换选中态，并把键盘焦点交给该格终端 */
function onTilePointerDown(run: RunView): void {
  focusTile(run)
  focusTileTerminal(run.id)
}

watch(
  projectId,
  (pid) => {
    tilePriority.value = []
    void loadTileMode(pid)
  },
  { immediate: true },
)

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

/**
 * 选中运行
 *
 * 选中 id 仍按**全量记录**解析：刚结束（终态）的运行留在主面显示「运行已结束」，
 * 不自动跳到别的运行；只有 id 失配（运行被移除 / 深链）才退回第一条存活运行。
 */
const selectedRun = computed<RunView | null>(() => {
  const byId = runs.value.find((run) => run.id === selectedRunId.value)
  if (byId) return byId
  // 拼屏：选中失配时优先落到铺开的存活运行（否则标题条指向一条不在网格里的运行）
  if (tileMode.value) {
    const firstTiled = tiledRuns.value[0]
    if (firstTiled) return firstTiled
  }
  // 列表只展示存活运行；选中 id 仍按全量记录解析——刚结束的运行留在主面
  // 显示「运行已结束」，不自动跳到下一条
  return liveRuns.value[0] ?? null
})

// 兜底选中的运行固化为真实选中：否则它退出后选中 id 仍在空串上，主面会
// 跟着兜底跳去别的运行（或掉回未选中空态），看不到「运行已结束」。
watch(
  () => selectedRun.value?.id ?? '',
  (id) => {
    if (!id || id === selectedRunId.value) return
    // 原选中仍有效（用户点过 / 刚切换）→ 不接管；只有失效（运行被移除 / 深链
    // 未指定）才把兜底结果固化
    if (runs.value.some((run) => run.id === selectedRunId.value)) return
    selectedRunId.value = id
  },
)

/** 传给终端组件的会话形状（同一条 PTY，运行视图 ↔ 会话视图同源） */
const selectedRunSession = computed(() =>
  selectedRun.value ? runAsSession(selectedRun.value) : null,
)

// ==================== 终端 chrome（状态 / 时长 / 任务入口，与独立窗口共用） ====================

const chrome = useTerminalChrome({
  t,
  status: computed(() => selectedRun.value?.status ?? null),
  startedAt: computed(() => selectedRun.value?.startedAt ?? null),
  sessionId: computed(() => selectedRun.value?.id ?? ''),
})
const {
  statusColor: chromeStatusColor,
  statusText: chromeStatusText,
  statusLabelClass: chromeStatusLabelClass,
  uptimeText: chromeUptimeText,
  taskSupported: chromeTaskSupported,
  evaluateTaskSupport: evaluateChromeTaskSupport,
} = chrome

/** 中栏当前运行是否存活（可看终端 / 可停止 / 可切换控制项） */
const isRunLive = computed(() => !!selectedRun.value && isLiveRun(selectedRun.value.status))

/** 点任务队列入口：把目标运行注入共享弹窗（单屏 = 当前运行；拼屏 = 该格运行） */
function openTaskQueue(run: RunView | null = selectedRun.value): void {
  if (!run) return
  taskModalSessionId.value = run.id
  taskModalVisible.value = true
}

// ==================== 终端设置（主题 / 字号 / 字间距 / 背景图） ====================

const caps = useTerminalHostCapabilities() ?? createFallbackHostCapabilities()

const settingsOpen = ref(false)
const settingsTheme = ref('dracula')
const settingsFontSize = ref(12)
const settingsLetterSpacing = ref(0)
const settingsBgOpacity = ref<number>(caps.settings.getBgOpacity() ?? 30)
const themeSelectOptions = TERMINAL_THEME_SELECT_OPTIONS
const fontSizeSelectOptions = TERMINAL_FONT_SIZE_SELECT_OPTIONS
const letterSpacingSelectOptions = [0, 1, 2, 3, 4].map((value) => ({
  value,
  label: `${value}px`,
}))

const hasBgImage = computed(() => caps.bgImage.hasImage)
const bgImageName = computed(() => caps.bgImage.imageName)

/** 当前焦点终端：单屏 = 中栏实例；拼屏 = 选中格的实例 */
function activeTerminal(): InstanceType<typeof TerminalPreview> | null {
  if (tileMode.value) {
    const runId = selectedRun.value?.id ?? ''
    return (tileTerminalRefs.get(runId) as InstanceType<typeof TerminalPreview> | undefined) ?? null
  }
  return singleTerminalRef.value
}

/** 打开面板 / 换焦点运行：把终端上的当前值同步进受控字段 */
function syncSettingsFromTerminal(): void {
  const term = activeTerminal()
  if (!term) return
  settingsTheme.value = term.terminalTheme ?? settingsTheme.value
  settingsFontSize.value = term.fontSize ?? settingsFontSize.value
  settingsLetterSpacing.value = term.letterSpacing ?? settingsLetterSpacing.value
  settingsBgOpacity.value = caps.settings.getBgOpacity() ?? settingsBgOpacity.value
}

function toggleSettings(): void {
  settingsOpen.value = !settingsOpen.value
  if (settingsOpen.value) syncSettingsFromTerminal()
}

// 面板改动写回终端（TerminalPreview 内部走既有防抖持久化链）
watch(settingsTheme, (value) => {
  const term = activeTerminal()
  if (term) term.terminalTheme = value
})
watch(settingsFontSize, (value) => {
  const term = activeTerminal()
  if (term) term.fontSize = value
})
watch(settingsLetterSpacing, (value) => {
  const term = activeTerminal()
  if (term) term.letterSpacing = value
})

// 背景不透明度：本地实时预览 + 防抖持久化（与独立窗口同一口径）
let bgSaveTimeout: ReturnType<typeof setTimeout> | null = null
watch(settingsBgOpacity, () => {
  if (bgSaveTimeout) clearTimeout(bgSaveTimeout)
  bgSaveTimeout = setTimeout(() => {
    caps.settings.save({ bgOpacity: settingsBgOpacity.value })
  }, 300)
})

async function pickBgImage(): Promise<void> {
  await caps.bgImage.pickAndSet()
}

async function removeBgImage(): Promise<void> {
  await caps.bgImage.remove()
}

function clearActiveTerminal(): void {
  activeTerminal()?.clearTerminal()
}

function refreshActiveTerminal(): void {
  activeTerminal()?.refreshTerminal()
}

/** Esc 关闭设置抽屉（与独立窗口同口径） */
function onChromeKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && settingsOpen.value) settingsOpen.value = false
}

// ==================== 换焦点 / 任务入口（单屏 header） ====================

/**
 * 换焦点运行：任务入口判据跟着换（拼屏点格子也走这里）。
 *
 * `bridgeConnected` 进依赖：运行刚启动时桥接还没心跳（能力判为 bridge-offline），
 * 心跳到达后要重新取一次，否则入口会一直灰着。
 * 拼屏时任务入口在每格自己身上（RunTileControls），主 header 不取。
 * 模型 / 思考等级也由 RunAgentSelects 自己按运行取，这里不再重复请求。
 */
watch(
  () => ({
    runId: selectedRun.value?.id ?? '',
    bridge: selectedRun.value?.bridgeConnected ?? false,
    tile: tileMode.value,
  }),
  (next, previous) => {
    if (
      !next.tile &&
      (next.tile !== previous?.tile ||
        next.runId !== previous?.runId ||
        next.bridge !== previous?.bridge)
    ) {
      void evaluateChromeTaskSupport()
    }
    if (settingsOpen.value) syncSettingsFromTerminal()
  },
  { immediate: true },
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
      return 'bg-[var(--color-success)]'
    case 'waitingInput':
      return 'bg-[var(--color-warning)]'
    case 'starting':
      return 'bg-[var(--color-info)] animate-pulse'
    case 'error':
      return 'bg-[var(--color-danger)]'
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
  if (!tileMode.value) return
  const run = runs.value.find((item) => item.id === runId)
  if (!run || !isLiveRun(run.status)) return
  // 第 5 条以后的存活运行：点左栏把它顶进可见的 4 格
  if (!tiledRuns.value.some((tile) => tile.id === runId)) bumpTilePriority(runId)
  // 左栏点选 = 想看这条：把键盘焦点交给它的终端（与单屏切换后自动聚焦同语义）
  focusTileTerminal(runId)
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

async function stop(run: RunView | null): Promise<void> {
  if (!run) return
  try {
    await stopRun(run.id, projectId.value)
    toast.info(t('session.toast.stopped'))
  } catch (e) {
    console.error('[Project Workbench] stop run failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.run.stopFailed'))
  }
}

async function openWindow(run: RunView | null = selectedRun.value): Promise<void> {
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
  // 设置抽屉的 Esc 关闭（与独立窗口同口径）
  window.addEventListener('keydown', onChromeKeydown)
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
  window.removeEventListener('keydown', onChromeKeydown)
  if (bgSaveTimeout) {
    clearTimeout(bgSaveTimeout)
    bgSaveTimeout = null
  }
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
  letter-spacing: 0.02em;
  user-select: none;
  font-size: calc(10px * var(--ui-scale));
  color: var(--text-tertiary);
}
</style>
