<script setup lang="ts">
/**
 * 对话面（项目工作台中栏，ADR 0004 / issue #23 M3）
 *
 * 输入是账本事件流（`useRunEvents`）与当前运行；渲染规则全在
 * `conversationModel.ts`（纯函数），本组件只做呈现与交互：
 * - 时间线：用户气泡 / 助手正文（markdown，流式行带生成标记）/ thinking
 *   （默认折叠）/ 工具卡（状态机）/ patch 卡 / plan 卡 / 权限只读提示 /
 *   错误条 + 「排队中」本地气泡（发送已接住、事件流未回显）。
 * - 降级面：镜像模式（桥接离线）标横幅并禁用输入说明原因；pi 未授信给
 *   「需在终端授予项目信任」；截断显示提示；读取失败给重试按钮。
 *   —— 不可用的操作不渲染成可点的按钮（spec「权限只代传、不代裁」口径）。
 * - 发送：`run.send`（镜像模式禁用）；停止：复用 `session.close`（上抛给
 *   工作台走既有停止链）。
 *
 * 样式自足（scoped）：`wb-btn-*` / `wb-mono` 在本 app 是无定义的历史空类，
 * 新面不依赖它们；markdown 走 `.cs-md` 自带子集样式（v-html 内容没有
 * scoped 属性，需 :deep 穿透）。
 */
import { computed, inject, nextTick, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { PendingMessage, RunEvent } from '@/composables/useRunEvents'
import { buildConversation, type ConversationRow } from './conversationModel'

const props = defineProps<{
  /** 运行 id（null = 未选运行，显示引导空态） */
  runId: string | null
  /** 运行是否非终态（终态停轮询、禁输入并说明「运行已结束」） */
  runActive: boolean
  /** agent id（镜像降级文案按驱动细分：pi 未授信是专属场景） */
  agentId: string | null
  events: RunEvent[]
  pending: PendingMessage[]
  truncated: boolean
  /** 桥接在线（null = 还没有账本响应，按离线渲染但不抢跑提示） */
  bridgeConnected: boolean | null
  loadError: string | null
  loading: boolean
  sending: boolean
}>()

const emit = defineEmits<{ send: [text: string]; stop: []; retry: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

// ==================== 模型 ====================

const model = computed(() => buildConversation(props.events))
const rows = computed(() => model.value.rows)
const hasConversation = computed(() => rows.value.length > 0 || props.pending.length > 0)

/** 镜像模式：账本响应说桥接离线（终态运行恒离线，不算降级场景） */
const mirrorMode = computed(() => props.runActive && props.bridgeConnected === false)

/** pi 的项目扩展受 project trust 约束：未授信时桥接根本不加载（ADR 0004 核查 6） */
const piTrustHint = computed(() => mirrorMode.value && props.agentId === 'pi')

/** 执行状态指示：终态运行不显示（停了就是停了） */
const agentState = computed(() => (props.runActive ? model.value.agentState : null))

// ==================== 折叠（thinking / 工具输出 / diff） ====================

const expanded = ref<Set<string>>(new Set())

function toggleExpand(key: string): void {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function isExpanded(key: string): boolean {
  return expanded.value.has(key)
}

/** 换运行重置折叠态：上一条运行的展开残留不该带到新会话 */
watch(
  () => props.runId,
  () => {
    expanded.value = new Set()
  },
)

// ==================== 工具卡展示 ====================

const TOOL_OUTPUT_COLLAPSE_CHARS = 400

function toolOutputCollapsible(row: ConversationRow): boolean {
  return row.type === 'tool' && row.output.length > TOOL_OUTPUT_COLLAPSE_CHARS
}

/** 工具参数摘要行：JSON 单行展示（超过 200 字截断，完整内容本就在卡里） */
function toolArgsSummary(row: ConversationRow): string {
  if (row.type !== 'tool' || !row.args) return ''
  try {
    const text = JSON.stringify(row.args)
    return text.length > 200 ? `${text.slice(0, 200)}…` : text
  } catch {
    return ''
  }
}

// ==================== 滚动跟随 ====================

const scrollEl = ref<HTMLElement | null>(null)
/** 用户是否停在底部附近：只有贴底才自动跟随，翻历史时不抢滚动条 */
const pinnedToBottom = ref(true)

function onScroll(): void {
  const el = scrollEl.value
  if (!el) return
  pinnedToBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 48
}

function scrollToBottom(): void {
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}

// 行数变化 + 每秒流式刷新都可能改变高度：贴底就跟
watch(
  () => [rows.value.length, props.pending.length, model.value.agentState],
  () => {
    if (!pinnedToBottom.value) return
    void nextTick(scrollToBottom)
  },
)

// 首屏内容渲染完贴一次底（打开历史会话直接看到最新消息）
watch(
  () => props.loading,
  (loading, previous) => {
    if (previous && !loading) void nextTick(scrollToBottom)
  },
)

// ==================== 输入 ====================

const draft = ref('')

/** 输入禁用必须给得出原因：不渲染「灰色但不知道为什么」的假输入框 */
const inputDisabledReason = computed<string | null>(() => {
  if (!props.runId) return 'project.chat.emptyNoRun'
  if (!props.runActive) return 'project.chat.runEnded'
  if (mirrorMode.value) {
    return piTrustHint.value ? 'project.chat.mirrorPiTrust' : 'project.chat.mirrorHint'
  }
  return null
})

const inputDisabled = computed(() => inputDisabledReason.value !== null)

function submit(): void {
  const text = draft.value.trim()
  if (!text || inputDisabled.value || props.sending) return
  emit('send', text)
  draft.value = ''
  pinnedToBottom.value = true
  void nextTick(scrollToBottom)
}

function onInputKeydown(event: KeyboardEvent): void {
  // Enter 发送 / Shift+Enter 换行；IME 组合中不抢（选字回车不是发送）
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="conversation-surface">
    <!-- ==================== 降级横幅（状态本身即语义，常驻不挤时间线） ==================== -->
    <div v-if="loadError" class="cs-banner cs-banner-error" data-testid="chat-load-error">
      <span class="min-w-0 flex-1 truncate" :title="loadError">
        {{ t('project.chat.loadFailed') }}
      </span>
      <button
        class="cs-link shrink-0"
        data-testid="chat-retry"
        @click="emit('retry')"
      >
        {{ t('project.chat.retry') }}
      </button>
    </div>
    <div v-if="mirrorMode" class="cs-banner cs-banner-warn" data-testid="chat-mirror-banner">
      <span class="min-w-0 flex-1">
        {{ t('project.chat.mirrorMode') }}
        {{ piTrustHint ? t('project.chat.mirrorPiTrust') : t('project.chat.mirrorHint') }}
      </span>
    </div>
    <div v-if="truncated" class="cs-banner cs-banner-warn" data-testid="chat-truncated-banner">
      {{ t('project.chat.truncated') }}
    </div>

    <!-- ==================== 时间线 ==================== -->
    <div
      ref="scrollEl"
      class="min-h-0 flex-1 overflow-y-auto"
      data-testid="chat-scroll"
      @scroll.passive="onScroll"
    >
      <!-- 空态：有运行给发消息引导；没运行给启动引导（spec 用户故事 38） -->
      <div
        v-if="!hasConversation && !loading"
        class="flex h-full flex-col items-center justify-center px-8 text-center"
        data-testid="chat-empty"
      >
        <template v-if="runId">
          <p class="text-sm text-[var(--text-primary)]">{{ t('project.chat.emptyTitle') }}</p>
          <p
            class="mt-1.5 max-w-md text-[calc(11.5px*var(--ui-scale))] leading-relaxed text-[var(--text-secondary)]"
          >
            {{
              mirrorMode
                ? piTrustHint
                  ? t('project.chat.mirrorPiTrust')
                  : t('project.chat.mirrorHint')
                : t('project.chat.emptyHint')
            }}
          </p>
        </template>
        <template v-else>
          <p class="text-sm text-[var(--text-primary)]">{{ t('project.chat.emptyNoRun') }}</p>
          <p
            class="mt-1.5 max-w-md text-[calc(11.5px*var(--ui-scale))] leading-relaxed text-[var(--text-secondary)]"
          >
            {{ t('project.chat.emptyNoRunHint') }}
          </p>
        </template>
      </div>

      <div v-else class="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-3">
        <template v-for="row in rows" :key="row.key">
          <!-- 用户消息：右对齐气泡 -->
          <div v-if="row.type === 'user'" class="flex justify-end" data-testid="chat-row-user">
            <div class="cs-bubble-user" :title="row.at">
              <span class="whitespace-pre-wrap break-words">{{ row.text }}</span>
            </div>
          </div>

          <!-- 助手正文：markdown；流式行带生成标记 -->
          <div
            v-else-if="row.type === 'text'"
            data-testid="chat-row-text"
            :data-streaming="row.streaming ? 'true' : 'false'"
          >
            <div class="cs-md" v-html="row.html"></div>
            <span v-if="row.streaming" class="cs-streaming" data-testid="chat-streaming">{{
              t('project.chat.generating')
            }}</span>
          </div>

          <!-- thinking：默认折叠（spec 用户故事 20），展开弱化呈现 -->
          <div v-else-if="row.type === 'thinking'" data-testid="chat-row-thinking">
            <button
              class="cs-thinking-toggle"
              :aria-expanded="isExpanded(row.key)"
              @click="toggleExpand(row.key)"
            >
              <span class="cs-thinking-chev" :class="{ open: isExpanded(row.key) }">▸</span>
              {{ row.redacted ? t('project.chat.thinkingRedacted') : t('project.chat.thinking') }}
            </button>
            <div
              v-if="isExpanded(row.key)"
              class="cs-thinking-body"
              data-testid="chat-thinking-body"
            >{{ row.text }}</div>
          </div>

          <!-- 工具卡：状态机 pending→running→done/error -->
          <div
            v-else-if="row.type === 'tool'"
            class="cs-tool"
            :data-state="row.state"
            data-testid="chat-row-tool"
          >
            <div class="cs-tool-head">
              <span class="cs-tool-dot" aria-hidden="true"></span>
              <span class="font-mono truncate text-[calc(11.5px*var(--ui-scale))]">{{ row.name }}</span>
              <span class="cs-tool-state" data-testid="chat-tool-state">{{
                t(`project.chat.toolState.${row.state}`)
              }}</span>
            </div>
            <div v-if="toolArgsSummary(row)" class="cs-tool-args font-mono">
              {{ toolArgsSummary(row) }}
            </div>
            <div v-if="row.error" class="cs-tool-error" data-testid="chat-tool-error">
              {{ row.error }}
            </div>
            <template v-if="row.output">
              <div
                v-if="!toolOutputCollapsible(row) || isExpanded(row.key)"
                class="cs-tool-output font-mono"
                data-testid="chat-tool-output"
              >{{ row.output }}</div>
              <button
                v-if="toolOutputCollapsible(row)"
                class="cs-collapse-btn"
                :aria-expanded="isExpanded(row.key)"
                @click="toggleExpand(row.key)"
              >
                {{
                  isExpanded(row.key)
                    ? t('project.chat.collapse')
                    : t('project.chat.expandOutput')
                }}
              </button>
            </template>
          </div>

          <!-- patch 卡：文件列表 + 可折叠 diff -->
          <div v-else-if="row.type === 'patch'" class="cs-patch" data-testid="chat-row-patch">
            <div class="cs-patch-head">
              <span>{{ t('project.chat.patchTitle') }}</span>
              <span class="font-mono text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)]">
                {{ t('project.chat.patchFiles', { n: row.files.length }) }}
              </span>
            </div>
            <ul class="cs-patch-files">
              <li
                v-for="file in row.files"
                :key="file"
                class="font-mono truncate text-[calc(11px*var(--ui-scale))]"
                :title="file"
              >
                {{ file }}
              </li>
            </ul>
            <template v-if="row.diff">
              <div
                v-if="isExpanded(row.key)"
                class="cs-patch-diff font-mono"
                data-testid="chat-patch-diff"
              >{{ row.diff }}</div>
              <button
                class="cs-collapse-btn"
                :aria-expanded="isExpanded(row.key)"
                @click="toggleExpand(row.key)"
              >
                {{ isExpanded(row.key) ? t('project.chat.hideDiff') : t('project.chat.showDiff') }}
              </button>
            </template>
          </div>

          <!-- plan 卡：待办清单随进度更新 -->
          <div v-else-if="row.type === 'plan'" class="cs-plan" data-testid="chat-row-plan">
            <div class="cs-patch-head">{{ t('project.chat.planTitle') }}</div>
            <ul class="cs-plan-items">
              <li v-for="(item, index) in row.items" :key="index" :data-status="item.status">
                <span class="font-mono" aria-hidden="true">{{
                  item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '•' : '○'
                }}</span>
                <span class="min-w-0 flex-1">{{ item.text }}</span>
              </li>
            </ul>
          </div>

          <!-- 权限：M3 只读提示条（不渲染按钮）；已回执的决定随行显示 -->
          <div v-else-if="row.type === 'permission'" class="cs-perm" data-testid="chat-row-permission">
            <div class="cs-perm-head">
              <span>{{ t('project.chat.permissionTitle') }}</span>
              <span class="font-mono truncate text-[calc(11.5px*var(--ui-scale))]">
                {{ row.tool || row.requestId }}
              </span>
              <span
                v-if="row.decision"
                class="cs-perm-decision font-mono"
                data-testid="chat-permission-decision"
              >{{ row.decision }}</span>
            </div>
            <div v-if="row.decision" class="cs-perm-note">
              {{ t('project.chat.permissionDecidedBy', { by: row.decidedBy ?? 'agent' }) }}
            </div>
            <div v-else class="cs-perm-note" data-testid="chat-permission-readonly">
              {{ t('project.chat.permissionNeedTerminal') }}
            </div>
          </div>

          <!-- 错误条：可读的一段话（不是堆栈） -->
          <div v-else-if="row.type === 'error'" class="cs-error-row" data-testid="chat-row-error">
            <span class="min-w-0 flex-1 truncate" :title="row.message">{{ row.message }}</span>
            <span
              v-if="row.code"
              class="font-mono shrink-0 text-[calc(10px*var(--ui-scale))] opacity-70"
            >{{ row.code }}</span>
          </div>
        </template>

        <!-- 排队中的本地气泡：发送已被命令队列接住，等事件流回显后由数据层摘除 -->
        <div
          v-for="item in pending"
          :key="item.id"
          class="flex justify-end"
          data-testid="chat-row-pending"
        >
          <div class="cs-bubble-user cs-bubble-pending">
            <span class="whitespace-pre-wrap break-words">{{ item.text }}</span>
            <span class="cs-pending-mark">{{ t('project.chat.queued') }}</span>
          </div>
        </div>

        <!-- 执行状态指示：busy / retrying / error（idle 不占行） -->
        <div
          v-if="agentState && agentState !== 'idle'"
          class="cs-agent-state"
          :data-state="agentState"
          data-testid="chat-agent-state"
        >
          <span class="cs-agent-state-dot" aria-hidden="true"></span>
          {{ t(`project.chat.agentState.${agentState}`) }}
        </div>
      </div>
    </div>

    <!-- ==================== 输入区（禁用必给原因） ==================== -->
    <div class="shrink-0 border-t border-[var(--border)] p-2.5" data-testid="chat-input-area">
      <div
        v-if="inputDisabledReason"
        class="mb-1.5 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]"
        data-testid="chat-input-reason"
      >
        {{ t(inputDisabledReason) }}
      </div>
      <div class="flex items-stretch gap-2">
        <textarea
          v-model="draft"
          class="cs-input"
          rows="1"
          :disabled="inputDisabled"
          :placeholder="t('project.chat.inputPlaceholder')"
          :data-testid="inputDisabled ? undefined : 'chat-input'"
          @keydown="onInputKeydown"
        ></textarea>
        <!-- 停止：活运行才出现（复用 session.close 停止链；镜像模式下 PTY 停止仍可用） -->
        <button
          v-if="runActive && runId"
          class="cs-btn cs-btn-danger shrink-0 self-center"
          :title="t('project.chat.stop')"
          data-testid="chat-stop"
          @click="emit('stop')"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6h12v12H6z" />
          </svg>
        </button>
        <button
          class="cs-btn cs-btn-primary shrink-0 self-center"
          :disabled="inputDisabled || sending || !draft.trim()"
          data-testid="chat-send"
          @click="submit"
        >
          {{ sending ? t('project.chat.sending') : t('project.chat.send') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ==================== 横幅 ==================== */
.cs-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  font-size: calc(11.5px * var(--ui-scale));
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.cs-banner-warn {
  background: color-mix(in srgb, #f59e0b 10%, transparent);
  color: var(--text-secondary);
}

.cs-banner-error {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--text-primary);
}

.cs-link {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* ==================== 用户气泡 ==================== */
.cs-bubble-user {
  max-width: 82%;
  border-radius: 10px 10px 3px 10px;
  background: color-mix(in srgb, var(--color-primary) 14%, var(--bg-card));
  border: 1px solid color-mix(in srgb, var(--color-primary) 28%, transparent);
  padding: 6px 10px;
  font-size: calc(12.5px * var(--ui-scale));
  line-height: 1.55;
  color: var(--text-primary);
}

.cs-bubble-pending {
  opacity: 0.72;
}

.cs-pending-mark {
  display: block;
  margin-top: 3px;
  font-size: calc(10px * var(--ui-scale));
  color: var(--text-secondary);
}

/* ==================== 流式生成标记 ==================== */
.cs-streaming {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  font-size: calc(10.5px * var(--ui-scale));
  color: var(--text-tertiary);
}

.cs-streaming::before,
.cs-tool[data-state='running'] .cs-tool-dot,
.cs-agent-state[data-state='busy'] .cs-agent-state-dot,
.cs-agent-state[data-state='retrying'] .cs-agent-state-dot {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: cs-pulse 1.2s ease-in-out infinite;
}

@keyframes cs-pulse {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}

/* ==================== thinking ==================== */
.cs-thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: calc(11.5px * var(--ui-scale));
  color: var(--text-tertiary);
  padding: 1px 0;
}

.cs-thinking-toggle:hover {
  color: var(--text-secondary);
}

.cs-thinking-chev {
  transition: transform 120ms ease;
}

.cs-thinking-chev.open {
  transform: rotate(90deg);
}

.cs-thinking-body {
  margin: 4px 0 0 14px;
  padding: 6px 10px;
  border-left: 2px solid var(--border);
  color: var(--text-secondary);
  font-size: calc(11.5px * var(--ui-scale));
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ==================== 工具卡 ==================== */
.cs-tool {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  padding: 7px 10px;
  font-size: calc(11.5px * var(--ui-scale));
}

.cs-tool-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--text-primary);
}

.cs-tool-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-tertiary);
}

.cs-tool[data-state='done'] .cs-tool-dot {
  background: #22c55e;
}

.cs-tool[data-state='error'] .cs-tool-dot {
  background: var(--color-danger);
}

.cs-tool-state {
  margin-left: auto;
  flex-shrink: 0;
  font-size: calc(10px * var(--ui-scale));
  color: var(--text-tertiary);
}

.cs-tool-args {
  margin-top: 5px;
  color: var(--text-tertiary);
  font-size: calc(10.5px * var(--ui-scale));
  word-break: break-all;
  line-height: 1.45;
}

.cs-tool-output {
  margin-top: 5px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-page);
  color: var(--text-secondary);
  font-size: calc(10.5px * var(--ui-scale));
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
}

.cs-tool-error {
  margin-top: 5px;
  color: var(--color-danger);
  font-size: calc(11px * var(--ui-scale));
  white-space: pre-wrap;
  word-break: break-word;
}

/* ==================== patch / plan / 权限 / 错误 ==================== */
.cs-patch,
.cs-plan,
.cs-perm {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  padding: 7px 10px;
  font-size: calc(11.5px * var(--ui-scale));
}

.cs-patch-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-primary);
}

.cs-patch-files {
  margin-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-secondary);
}

.cs-patch-diff {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-page);
  color: var(--text-secondary);
  font-size: calc(10.5px * var(--ui-scale));
  max-height: 280px;
  overflow: auto;
  white-space: pre;
}

.cs-plan-items {
  margin-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--text-secondary);
}

.cs-plan-items li {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.cs-plan-items li[data-status='completed'] {
  color: var(--text-tertiary);
  text-decoration: line-through;
}

.cs-perm-head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
}

.cs-perm-decision {
  margin-left: auto;
  flex-shrink: 0;
  font-size: calc(10px * var(--ui-scale));
  color: var(--text-tertiary);
}

.cs-perm-note {
  margin-top: 4px;
  font-size: calc(11px * var(--ui-scale));
  color: var(--text-secondary);
}

.cs-error-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--color-danger) 35%, transparent);
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: calc(11.5px * var(--ui-scale));
  color: var(--text-primary);
}

/* ==================== 执行状态指示 ==================== */
.cs-agent-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: calc(11px * var(--ui-scale));
  color: var(--text-tertiary);
}

.cs-agent-state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.cs-agent-state[data-state='error'] .cs-agent-state-dot {
  background: var(--color-danger);
}

/* ==================== 输入区 ==================== */
.cs-input {
  flex: 1;
  min-width: 0;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  padding: 6px 10px;
  font-size: calc(12.5px * var(--ui-scale));
  line-height: 1.5;
  max-height: 140px;
}

.cs-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
}

.cs-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ==================== 按钮（本面自带；wb-btn-* 在本 app 是无定义空类） ==================== */
.cs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  min-width: 56px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: calc(12px * var(--ui-scale));
  transition: background-color 120ms ease, opacity 120ms ease;
}

.cs-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.cs-btn-primary {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}

.cs-btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.cs-btn-danger {
  border: 1px solid color-mix(in srgb, var(--color-danger) 40%, transparent);
  color: var(--color-danger);
}

.cs-btn-danger:hover {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
}

/* ==================== markdown 子集（v-html 内容需 :deep 穿透） ==================== */
.cs-md {
  color: var(--text-primary);
  font-size: calc(12.5px * var(--ui-scale));
  line-height: 1.6;
  word-break: break-word;
}

.cs-md :deep(p) {
  margin: 0.35em 0;
}

.cs-md :deep(h1),
.cs-md :deep(h2),
.cs-md :deep(h3),
.cs-md :deep(h4) {
  margin: 0.6em 0 0.3em;
  font-weight: 600;
  line-height: 1.35;
}

.cs-md :deep(h1) {
  font-size: 1.15em;
}

.cs-md :deep(h2) {
  font-size: 1.08em;
}

.cs-md :deep(h3),
.cs-md :deep(h4) {
  font-size: 1em;
}

.cs-md :deep(ul),
.cs-md :deep(ol) {
  margin: 0.35em 0;
  padding-left: 1.4em;
}

.cs-md :deep(ul) {
  list-style: disc;
}

.cs-md :deep(ol) {
  list-style: decimal;
}

.cs-md :deep(li) {
  margin: 0.15em 0;
}

.cs-md :deep(blockquote) {
  margin: 0.4em 0;
  padding: 0.1em 0 0.1em 0.8em;
  border-left: 2px solid var(--border);
  color: var(--text-secondary);
}

.cs-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
  background: var(--bg-hover);
  border-radius: 4px;
  padding: 0.1em 0.35em;
}

.cs-md :deep(pre) {
  margin: 0.4em 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-page);
  overflow: auto;
}

.cs-md :deep(pre code) {
  background: none;
  padding: 0;
}

.cs-md :deep(table) {
  margin: 0.4em 0;
  border-collapse: collapse;
  font-size: 0.95em;
}

.cs-md :deep(th),
.cs-md :deep(td) {
  border: 1px solid var(--border);
  padding: 3px 8px;
  text-align: left;
}

.cs-md :deep(hr) {
  margin: 0.6em 0;
  border: none;
  border-top: 1px solid var(--border);
}

.cs-md :deep(a) {
  color: var(--color-primary);
  /* 挂载包无 opener 权限：链接不可点（markdown 渲染器不产 href），样式只作强调 */
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
