<script setup lang="ts">
/**
 * 会话转写只读视图（任务记录 / 原始 JSONL 两个页签的**内容面**）
 *
 * 从 Agent 管理日志详情抽出（2026-11-07），让「任务日志详情」与「Agent 管理
 * 日志详情」读同一份转写、用同一套渲染：倒序对话气泡（markdown / 工具卡 /
 * 折叠 / token 明细 / 截断提示）+ 逐行折叠的原始 JSONL。
 *
 * 页签按钮留在父级（两个详情页的头卡各自不同），本组件通过 `tab` 与
 * `update:tab` 受控：页签切换不会重建本组件实例，两个视图的折叠态因此互不
 * 干扰、切回来也不丢；换会话（`sessionKey` 变化）才整体重置。
 */
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { NormalizedEventView } from '../types'
import {
  COLLAPSE_THRESHOLD_CHARS,
  COLLAPSE_THRESHOLD_TOOL_CHARS,
  formatEventTime,
  formatTokens,
  looksTruncated,
  RAW_LINE_COLLAPSE_CHARS,
  renderNonTextBlocks,
  splitToolText,
} from '../utils/format'
import { markdownPlainPreview, renderMarkdown } from '../utils/markdown'

const props = defineProps<{
  /** 会话身份键（变化 = 换会话：重置折叠态与滚动量测） */
  sessionKey: string | number
  /** 当前页签（父级与头卡按钮共用同一受控值） */
  tab: 'chat' | 'raw'
  /** 归一事件流（按原顺序给；组件内部倒序渲染） */
  events: NormalizedEventView[]
  /** 原始行（SQLite 源恒空） */
  raw: string[]
  /** 任务记录空态文案（父级按来源给不同指引，已本地化） */
  emptyText: string
  /** 原始行空态文案（已本地化） */
  noRawText: string
}>()

const emit = defineEmits<{ 'update:tab': [value: 'chat' | 'raw'] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

/** 助手事件 token 明细（↑ 输入 ↓ 输出 ⚡ 缓存读 +缓存写） */
function tokenMeta(e: NormalizedEventView): string {
  if (!e.tokens) return ''
  return [
    `↑ ${formatTokens(e.tokens.input)}`,
    `↓ ${formatTokens(e.tokens.output)}`,
    `⚡ ${formatTokens(e.tokens.cacheRead)}`,
    `+${formatTokens(e.tokens.cacheWrite)}`,
    e.tokens.reasoning > 0 ? `◈ ${formatTokens(e.tokens.reasoning)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

// ==================== 聊天行模型（折叠 / 工具卡 / markdown / 截断提示） ====================
/** 已展开的事件下标（空 = 全部收起，即默认折叠态） */
// 展开态行号集合：用 Set 而非数组 —— chatRows 是整体 computed，切换任一行会让
// 全部行重算，数组的 includes()/filter() 在 MAX_EVENTS=5000 量级退化为 O(n²)
const expandedIndexes = ref<Set<number>>(new Set())

/**
 * 「原始 JSONL」展开行号集合（粒度从「消息」降到「行」，理由见
 * `RAW_LINE_COLLAPSE_CHARS`）
 *
 * 独立于 `expandedIndexes`（聊天行）：两个视图的展开态互不干扰，切页签回来
 * 不该丢；同时由下面那个 `watch(sessionKey)` 一起重置，避免换会话后残留旧下标。
 */
const expandedRawIndexes = ref<Set<number>>(new Set())

/**
 * 原始行视图的行模型（一次算全：预览文本 + 是否可折叠）
 *
 * `raw` 是 guest 直接给的整文件行，单行可达数十 KB（codex `session_meta` 的
 * `base_instructions` 就是整份系统提示词）。不逐行折叠的话首行会把整屏占满，
 * 用户实际看到的是「打开页签 = 一堵 JSON 墙」。折叠态**只渲染截断预览**
 * （展开才铺全文），保证上千行时 DOM 也轻。
 */
const rawRows = computed(() => {
  const lines = props.raw
  return lines.map((line, i) => {
    const long = line.length > RAW_LINE_COLLAPSE_CHARS
    const expanded = long && expandedRawIndexes.value.has(i)
    return {
      i,
      long,
      expanded,
      // **只有真被折叠的超阈值行才挂折叠类**：短行展开与否都该原样铺开，
      // 误挂会被 `nowrap + ellipsis` 在视口宽度处截掉（本行并不长）
      collapsed: long && !expanded,
      text: expanded ? line : line.slice(0, RAW_LINE_COLLAPSE_CHARS),
    }
  })
})

/** 切换某一行原始行的展开态（整体替换而非原地 mutate，与 `toggleExpand` 同理） */
function toggleRawExpand(i: number) {
  const next = new Set(expandedRawIndexes.value)
  if (next.has(i)) {
    next.delete(i)
  } else {
    next.add(i)
  }
  expandedRawIndexes.value = next
}

// ==================== 任务记录快捷跳转（回顶 / 到底） ====================
/** 任务记录的滚动容器（.ah-chat-scroll；切页签时会被重建，故用模板 ref） */
const chatScroll = ref<HTMLElement | null>(null)
/** 当前滚动位置两端是否还有内容（按钮可见性） */
const chatCanUp = ref(false)
const chatCanDown = ref(false)
/** 端点容差（px）：滚动取整 / 亚像素下不因 1px 抖动闪按钮 */
const CHAT_EDGE_PX = 8

/** 读一次滚动几何：内容不足一屏时两个按钮都不出现 */
function updateChatScrollState() {
  const el = chatScroll.value
  if (!el) {
    chatCanUp.value = false
    chatCanDown.value = false
    return
  }
  chatCanUp.value = el.scrollTop > CHAT_EDGE_PX
  chatCanDown.value = el.scrollTop + el.clientHeight < el.scrollHeight - CHAT_EDGE_PX
}

/** 回顶 / 到底（平滑滚动；滚动后由 scroll 事件刷新按钮可见性） */
function scrollChatTo(edge: 'top' | 'bottom') {
  const el = chatScroll.value
  if (!el) return
  el.scrollTo({ top: edge === 'top' ? 0 : el.scrollHeight, behavior: 'smooth' })
}

// 首次挂载 / 换会话 / 切回任务记录页签时都要重新量：这些时机内容刚渲染，
// 不量就只能等用户先滚一下按钮才出现。
onMounted(() => void nextTick(updateChatScrollState))
watch(
  () => props.tab,
  (tab) => {
    if (tab === 'chat') void nextTick(updateChatScrollState)
  },
)

watch(
  () => props.sessionKey,
  () => {
    expandedIndexes.value = new Set()
    expandedRawIndexes.value = new Set()
    // 新会话的内容渲染完再量（否则按钮按上一会话的滚动位置误显示）
    void nextTick(updateChatScrollState)
  },
)

/**
 * 聊天视图的行模型（一次算全：工具卡切片 + 折叠阈值 + markdown 正文 + 截断提示）
 *
 * **顺序：倒序渲染**——日志是回看场景，最新一轮（最后回复）在最上面；
 * 下方是更早的往来。行下标 `i` 仍是原始事件下标，折叠态 / aria-controls
 * 因此跨会话与顺序调整都保持稳定。
 *
 * 展示规则都落在这里，模板只做渲染：
 * - **折叠**：助手正文按 500 字、工具卡身按 400 字（工具输出上限 1000，见 format.ts）；
 *   超阈值默认收起，切换会话由下方 watch 重置。思考行（pi）**不看长度恒默认收起**
 *   （pi TUI 口径：thinking 只给「Thinking...」占位，点开才展开），展开态弱化呈现。
 * - **markdown**：只渲染助手正文（用户行是「我说的话」、工具行是命令原文、思考行
 *   是草稿推理，都不该排版）。折叠态给剥标记的纯文本——CSS line-clamp 只对纯文本
 *   可靠（块级子元素上 `-webkit-line-clamp` 会数不准行），展开态才产出结构化 HTML。
 * - **占位本地化**：非文本块占位 token（pi 图片附件 `[non-text:image]` 等）在工具卡身
 *   （splitToolText 内）与 user / system 行都按当前语言渲染。
 * - **截断提示**：guest 在上限处补省略号收尾，这里据此提示「完整原文见原始 JSONL」。
 * - **空泡丢弃**：正文空且五项 token 全为 0 的助手行整条不渲染（pi 纯工具/纯思考轮
 *   的空泡已在 guest 侧不再产出，此处是历史数据兜底）；零 token 行本身也不再出
 *   （token 明细只在真有量时才有信息，“0 0 0 0” 只会让人以为统计坏了）。
 */
const chatRows = computed(() => {
  const events = props.events ?? []
  return (
    events
      .map((e, i) => {
        // 传入 t：非文本块占位 token（`[non-text:image]`）按当前语言本地化
        const card = e.role === 'tool' ? splitToolText(e.text, t) : null
        // 思考行恒默认收起（不看长度）；其余角色按阈值
        const isThinking = e.role === 'thinking'
        const collapsible = isThinking
          ? e.text.trim().length > 0
          : e.role === 'assistant'
            ? e.text.length > COLLAPSE_THRESHOLD_CHARS
            : card
              ? card.body.length > COLLAPSE_THRESHOLD_TOOL_CHARS
              : false
        const collapsed = collapsible && !expandedIndexes.value.has(i)
        const isMd = e.role === 'assistant'
        const bodyText = isMd
          ? collapsed
            ? markdownPlainPreview(e.text)
            : renderMarkdown(e.text)
          : card
            ? card.body
            : isThinking
              ? e.text
              : renderNonTextBlocks(e.text, t)
        const truncated = looksTruncated(e.text)
        const tokens = e.tokens
        const hasTokens =
          !!tokens &&
          tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning > 0
        // 行存亡只看**原始文本 + token**：折叠预览是展示派生物，仅由分隔线 / 表格分隔行
        // 等块级构造组成的长正文剥完标记会是空串，拿它判空会把整条实质消息丢掉
        const empty = isMd && !e.text.trim() && !hasTokens
        return {
          e,
          i,
          card,
          collapsible,
          collapsed,
          isMd,
          // 卡头为空（`tool_use · Bash` 已在头行）或正文为空时整段不渲染
          bodyText,
          truncated,
          hasTokens,
          hasBody: !!bodyText || collapsible || hasTokens || truncated,
          empty,
        }
      })
      .filter((row) => !row.empty)
      // 倒序：filter 产出新数组，reverse 不触碰源事件流；最新回复在最上面
      .reverse()
  )
})

function msgId(i: number): string {
  return `lg-msg-text-${i}`
}

function toggleExpand(i: number) {
  // 整体替换（而非原地 mutate）：Set 在 Vue 的响应式代理里 mutate 也能触发，
  // 但重建一次表达「本行折叠态集合」的完整快照，读代码时无歧义
  const next = new Set(expandedIndexes.value)
  if (next.has(i)) {
    next.delete(i)
  } else {
    next.add(i)
  }
  expandedIndexes.value = next
  // 展开/收起改变内容高度：内容缩短到不足一屏时「到底」按钮要及时消失
  void nextTick(updateChatScrollState)
}
</script>

<template>
  <!-- 任务记录（只读对话样式，无输入框） -->
  <div v-if="tab === 'chat'" class="ah-card ah-lg-events">
    <div v-if="events.length === 0" class="ah-st-empty">{{ emptyText }}</div>
    <div v-else class="ah-chat">
      <div ref="chatScroll" class="ah-chat-scroll" @scroll="updateChatScrollState">
        <div v-for="row in chatRows" :key="row.i" class="ah-msg" :class="`role-${row.e.role}`">
          <div class="ah-msg-head">
            <span class="ah-msg-dot" aria-hidden="true"></span>
            <span class="ah-msg-role">{{ t(`hub.lg.role.${row.e.role}`) }}</span>
            <!-- 工具卡头：类型 · 名称（无头形态时整条都落进卡身） -->
            <span v-if="row.card && row.card.head" class="ah-msg-tool-head ah-mono">
              {{ row.card.head }}
            </span>
            <span v-if="row.e.model" class="ah-msg-model ah-mono">{{ row.e.model }}</span>
            <span class="ah-msg-time ah-mono">{{ formatEventTime(row.e.ts) }}</span>
          </div>
          <div
            v-if="row.hasBody"
            class="ah-msg-body"
            :class="{ 'is-error': row.card?.isError || row.e.error }"
          >
            <!-- 助手正文：markdown 结构化渲染（折叠态是剥标记的纯文本预览） -->
            <div
              v-if="row.isMd && row.bodyText"
              :id="msgId(row.i)"
              class="ah-msg-text ah-md"
              :class="{ 'is-collapsed': row.collapsed }"
              data-testid="lg-msg-md"
              v-html="row.bodyText"
            ></div>
            <!-- 工具卡身 / 用户 / 系统 / 思考：纯文本（命令原文与草稿推理不该排版） -->
            <div
              v-else-if="row.bodyText"
              :id="msgId(row.i)"
              class="ah-msg-text"
              :class="{ 'is-collapsed': row.collapsed }"
              :data-testid="row.e.role === 'thinking' ? 'lg-msg-thinking' : undefined"
            >
              {{ row.bodyText }}
            </div>
            <!-- 模型输出 / 工具卡身折叠：超阈值默认收起，点击展开/收起 -->
            <button
              v-if="row.collapsible"
              type="button"
              class="ah-msg-expand"
              :aria-expanded="!row.collapsed"
              :aria-controls="msgId(row.i)"
              @click="toggleExpand(row.i)"
            >
              {{
                row.collapsed
                  ? row.card
                    ? t('hub.lg.detail.expandDetail')
                    : t('hub.lg.detail.expand')
                  : t('hub.lg.detail.collapse')
              }}
            </button>
            <!-- guest 上限截断：给一个看得见的完整原文路径（票 B4 可做部分） -->
            <div v-if="row.truncated" class="ah-msg-trunc" data-testid="lg-msg-truncated">
              <span>{{ t('hub.lg.detail.truncated') }}</span>
              <button type="button" class="ah-msg-trunc-jump" @click="emit('update:tab', 'raw')">
                {{ t('hub.lg.detail.viewRaw') }}
              </button>
            </div>
            <div v-if="row.hasTokens" class="ah-msg-meta ah-mono">
              <span>{{ tokenMeta(row.e) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 任务记录快捷跳转：回顶 / 到底。按滚动几何显示（内容不足一屏
           或已在端点时对应的按钮隐藏），不做「点了没反应」的空按钮。 -->
      <div class="ah-chat-jump">
        <button
          v-show="chatCanUp"
          type="button"
          class="ah-chat-jump-btn"
          data-testid="lg-chat-to-top"
          :title="t('hub.lg.detail.toTop')"
          :aria-label="t('hub.lg.detail.toTop')"
          @click="scrollChatTo('top')"
        >
          ↑
        </button>
        <button
          v-show="chatCanDown"
          type="button"
          class="ah-chat-jump-btn"
          data-testid="lg-chat-to-bottom"
          :title="t('hub.lg.detail.toBottom')"
          :aria-label="t('hub.lg.detail.toBottom')"
          @click="scrollChatTo('bottom')"
        >
          ↓
        </button>
      </div>
    </div>
  </div>

  <!-- 原始 JSONL 行视图 -->
  <div v-else class="ah-card ah-lg-raw-card">
    <div v-if="raw.length === 0" class="ah-st-empty">{{ noRawText }}</div>
    <div v-else class="ah-lg-raw ah-mono">
      <div
        v-for="row in rawRows"
        :key="row.i"
        class="ah-lg-raw-line"
        :class="{ 'is-collapsed': row.collapsed }"
      >
        <div class="ah-lg-raw-text">{{ row.text }}</div>
        <!-- 原始行折叠：超阈值行默认收起，点开看全文（同聊天行折叠） -->
        <button
          v-if="row.long"
          type="button"
          class="ah-lg-raw-expand"
          :aria-expanded="row.expanded"
          @click="toggleRawExpand(row.i)"
        >
          {{ row.expanded ? t('hub.lg.detail.collapse') : t('hub.lg.detail.expand') }}
        </button>
      </div>
    </div>
  </div>
</template>
