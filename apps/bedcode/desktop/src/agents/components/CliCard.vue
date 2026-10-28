<script setup lang="ts">
/**
 * 单 CLI 卡片：官方图标 + 状态徽章 + 版本/安装方式 + 双安装警告 + 卸载动作
 *
 * 徽章色语义：ok=success；双安装=warning；unavailable=danger（探测无结论）；其余中性
 *
 * 三态语义（票 P0）：`not-installed`（探测成功且确认未装）给安装入口；
 * `unavailable`（探测没结论：进程失败/超时/输出不可解析）只给「重试检测」——
 * 两者不可混同，否则用户会把「没测出来」当成「没装」而重复安装。
 *
 * 票 07 新增第六态「已装 · 未初始化」：`sessionState === 'empty'`（装了但
 * 扫描后零会话数据，如本机 codex —— `~/.codex/` 存在却从未跑过会话）。
 * 该信号由 usage 域给出（`useUsage.cliSessionState`），本组件不自行探测；
 * 三种未定状态（未扫描 / 未授权 / 扫描中）由上游归为 `unknown`，此时仍走
 * 常规「已装」——**宁可少一次提醒也不误报**。
 *
 * 卸载（本次新增）：仅已装卡片出现；两击确认防误触（第一击 arm，4s 自动
 * 复位）。busy（任意在途 run）禁用；双安装 / 未知安装方式 / npm-global 缺
 * node 不提供自动卸载（手动）。运行中由父层经 `uninstalling` 标注。
 */
import { computed, inject, onUnmounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { CliDetectInfo, CliId } from '../types'
import type { CliSessionState } from '../composables/useUsage'
import { builtinAgentName } from '../registry'
import CliIcon from './CliIcon.vue'

const props = defineProps<{
  cliId: CliId
  /** 展示名（后端清单优先；缺省回退 UI 注册表） */
  name?: string
  info: CliDetectInfo | null
  /** usage 域的会话数据状态（缺省=不下结论） */
  sessionState?: CliSessionState
  /** 是否有任意在途 run（busy 期间禁用一切动作） */
  busy?: boolean
  /** 该 CLI 是否正被卸载（active run 属于本卡；按钮变“卸载中…”） */
  uninstalling?: boolean
  /** 卸载失败信号（guest 拒绝/异常；瞬态提示，成功后由父层清除）。
   * 值为友好 i18n 文案（ADR 0030：guest 业务码优先，原文不携带） */
  uninstallFailed?: string | null
  /** node 环境是否就绪（npm-global 卸载依赖 npm） */
  nodeReady?: boolean
}>()

const emit = defineEmits<{ launch: [cli: CliId]; uninstall: [cli: CliId]; retry: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const displayName = computed(() => props.name ?? builtinAgentName(props.cliId))

const badge = computed(() => {
  const s = props.info?.status ?? 'idle'
  if (s === 'ok') {
    // **双安装优先于第六态**：双安装是可行动问题（PATH 生效的是哪一个），
    // 「没数据」只是缺席信号。两者同现时用可行动的那条。
    if (props.info?.dual) return { tone: 'warn', label: t('hub.card.installed') }
    // 已装但未初始化：中性色（不是错误也不是警告，是「还没数据」）
    if (props.sessionState === 'empty') {
      return { tone: 'neutral', label: t('hub.card.installedNoSessions') }
    }
    return { tone: 'ok', label: t('hub.card.installed') }
  }
  if (s === 'not-installed') return { tone: 'neutral', label: t('hub.card.notInstalled') }
  // unavailable = 探测没结论（不是「未安装」）：区别于 not-installed 的中性色，
  // 用错误色提示「这里没有答案」，并给出重试入口
  if (s === 'unavailable') return { tone: 'err', label: t('hub.card.unavailable') }
  if (s === 'detecting') return { tone: 'neutral', label: t('hub.card.detecting') }
  return { tone: 'neutral', label: t('hub.card.idle') }
})

const methodLabel = computed(() => {
  const m = props.info?.method
  return m && m !== 'unknown' ? t(`hub.card.method.${m}`) : null
})

// ==================== 卸载动作（两击确认，防误触） ====================

/** 卸载不可用原因（null=可自动卸载；hidden=不渲染按钮） */
type UninstallReason = 'dual' | 'unknown-method' | 'no-node' | 'hidden' | null

const uninstallReason = computed<UninstallReason>(() => {
  const info = props.info
  if (info?.status !== 'ok' || info?.installed !== true) return 'hidden'
  if (info.dual) return 'dual'
  if (info.method === 'unknown') return 'unknown-method'
  // npm-global 卸载走 npm，node 缺失时不可用（native/standalone 不依赖）
  if (info.method === 'npm-global' && !props.nodeReady) return 'no-node'
  return null
})

const uninstallReasonLabel = computed(() => {
  switch (uninstallReason.value) {
    case 'dual':
      return t('hub.card.uninstallHintDual')
    case 'unknown-method':
      return t('hub.card.uninstallHintMethod')
    case 'no-node':
      return t('hub.card.uninstallHintNode')
    default:
      return null
  }
})

/** 两击确认：第一击 arm（4s 自动复位），第二击才发命令 */
const armed = ref(false)
let armedTimer: ReturnType<typeof setTimeout> | null = null

function onUninstall() {
  if (!armed.value) {
    armed.value = true
    if (armedTimer) clearTimeout(armedTimer)
    armedTimer = setTimeout(() => {
      armed.value = false
    }, 4000)
    return
  }
  armed.value = false
  if (armedTimer) clearTimeout(armedTimer)
  emit('uninstall', props.cliId)
}

onUnmounted(() => {
  if (armedTimer) clearTimeout(armedTimer)
})
</script>

<template>
  <div class="ah-card" :data-testid="`cli-card-${cliId}`">
    <div class="ah-cli-head">
      <span class="ah-cli-name">
        <CliIcon :cli-id="cliId" />
        <span class="ah-cli-name-text" :data-testid="`cli-name-${cliId}`">{{ displayName }}</span>
      </span>
      <span class="ah-cli-tag" :class="badge.tone" :data-testid="`cli-badge-${cliId}`">
        <span class="ah-cli-dot"></span>{{ badge.label }}
      </span>
    </div>

    <div class="ah-cli-meta">
      <span class="ah-mono">{{ props.info?.version ?? t('hub.card.versionUnknown') }}</span>
      <span v-if="methodLabel" class="ah-cli-method">{{ methodLabel }}</span>
    </div>

    <!-- 探测无结论（unavailable）：显示「检测失败」+ 重试入口。
         原始错误明细只进日志（ADR 0030），界面不展示原文 -->
    <div
      v-if="props.info?.error || props.info?.status === 'unavailable'"
      class="ah-cli-error"
      :data-testid="`cli-unavailable-${cliId}`"
    >
      <span>{{ t('hub.card.unavailable') }}</span>
      <button
        v-if="props.info?.status === 'unavailable'"
        type="button"
        class="ah-btn ah-btn-ghost ah-btn-sm"
        :data-testid="`cli-retry-${cliId}`"
        @click="emit('retry')"
      >
        {{ t('hub.card.retry') }}
      </button>
    </div>

    <div v-if="props.info?.dual" class="ah-cli-dual">
      <div>{{ t('hub.card.dualWarning', { n: props.info.paths.length }) }}</div>
      <div v-for="p in props.info.paths" :key="p" class="ah-mono ah-cli-path">{{ p }}</div>
    </div>

    <!-- 启动会话（闭环入口）：已装即可一键拉起运行该 agent 的终端会话 -->
    <div v-if="props.info?.installed" class="ah-cli-foot">
      <button
        type="button"
        class="ah-btn ah-btn-primary ah-btn-sm"
        :disabled="busy || uninstalling"
        :data-testid="`cli-launch-${cliId}`"
        @click="emit('launch', props.cliId)"
      >
        {{ t('hub.launch.open') }}
      </button>
    </div>

    <!-- 卸载动作：仅已装；两击确认防误触；busy/双安装/未知安装方式/缺 node 不可用 -->
    <div v-if="uninstallReason !== 'hidden'" class="ah-cli-foot">
      <span v-if="uninstallReasonLabel" class="ah-cli-error">{{ uninstallReasonLabel }}</span>
      <button
        v-else
        type="button"
        class="ah-btn ah-btn-ghost ah-btn-sm"
        :class="{ 'ah-btn-warn': armed }"
        :disabled="busy || uninstalling"
        :data-testid="`cli-uninstall-${cliId}`"
        @click="onUninstall"
      >
        {{ uninstalling
          ? t('hub.card.uninstallRunning')
          : armed ? t('hub.card.uninstallConfirm') : t('hub.card.uninstall') }}
      </button>
    </div>
    <div v-if="uninstallFailed" class="ah-cli-error">{{ uninstallFailed }}</div>
  </div>
</template>
