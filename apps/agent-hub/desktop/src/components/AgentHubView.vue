<script setup lang="ts">
/**
 * Agent Hub 面板（变体 B：顶部 pill 分段导航）
 *
 * 设计真源：用户评审定稿原型 `.scratch/agent-hub/prototype/index.html`
 * （#variant=b）。六分区中票据 02 交付概览、票据 03 交付安装与更新、
 * 票据 04 交付 Skills、票据 05 交付供应商、票据 06 交付使用统计与会话
 * 日志（07 收尾 opencode/codex）。agent 清单来自 `agent-hub.list-agents`
 * （失败回退内置 UI 注册表并上屏降级横幅）。useDetection / useInstall 均为单实例：
 * 事件订阅与输出轮询在此层持有，各分区经 props + emits 交互。
 *
 * 分区职责（统计改版后）：**统计 = 聚合看板**（汇总 / 趋势 / 节奏 / 分布），
 * **日志 = 会话级明细**（分页表格 + 二级详情）。两者不再展示同一份会话
 * 列表，因此本层不再持有 `goto-logs` 跳转。
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useDetection } from '../composables/useDetection'
import { CODE_NODE_MISSING, failedUninstallFromLast, useInstall } from '../composables/useInstall'
import { useBootstrap } from '../composables/useBootstrap'
import { useSkills } from '../composables/useSkills'
import { useProviders } from '../composables/useProviders'
import { useUsage } from '../composables/useUsage'
import { useAgentCatalog } from '../composables/useAgentCatalog'
import type { CliId, HubTab } from '../types'
import OverviewTab from './OverviewTab.vue'
import InstallTab from './InstallTab.vue'
import SkillsTab from './SkillsTab.vue'
import ProvidersTab from './ProvidersTab.vue'
import StatsTab from './StatsTab.vue'
import SessionLogsTab from './SessionLogsTab.vue'
import NodeBootstrapDialog from './NodeBootstrapDialog.vue'
import NodeRemoveDialog from './NodeRemoveDialog.vue'

const context = inject<PluginContext>('pluginContext')!
const {
  state,
  detecting,
  refresh,
  detect,
  requestAuth,
} = useDetection(context)
const install = useInstall(context)
const bootstrap = useBootstrap(context)
const skills = useSkills(context)
const providers = useProviders(context)
const usage = useUsage(context)
const catalog = useAgentCatalog(context)

const activeTab = ref<HubTab>('overview')

// ==================== Node.js 引导 / 移除（P3/P4） ====================

/** 引导弹窗（确认 / 进行 / 失败 / 完成四态共用） */
const bootOpen = ref(false)
/** 命令面拒绝（如 busy）的友好文案；确认态展示 */
const bootError = ref<string | null>(null)
/** 链式安装：被 `nodeMissing` 拒绝的原安装动作，引导成功后自动重入 */
const pendingInstall = ref<{ cli: CliId; useMirror: boolean } | null>(null)
/** 移除环境确认弹窗 */
const removeOpen = ref(false)
const removeError = ref<string | null>(null)
/** 安装命令的可见失败（业务码 / 异常；原文只进日志） */
const installError = ref<string | null>(null)

/** 链式安装的目标展示名（弹窗里说明「装完继续装它」） */
const chainName = computed(() => {
  const cli = pendingInstall.value?.cli
  if (!cli) return null
  return catalog.agents.value.find((a) => a.id === cli)?.displayName ?? cli
})

/** 打开引导弹窗（确认态；计划数据由 get-bootstrap-state 拉取，不启动流水线） */
function openBootstrap() {
  bootError.value = null
  bootOpen.value = true
  void bootstrap.refresh()
}

/** 概览的「安装 Node.js / 升级」：先确认再开始（安全约束：不做静默下载） */
function handleBootstrapStart() {
  openBootstrap()
}

async function startBootstrap() {
  bootError.value = null
  const r = await bootstrap.start()
  if (!r.ok) bootError.value = r.error ?? context.i18n.t('hub.boot.failed.generic')
}

function cancelBootstrap() {
  void bootstrap.cancel()
}

function closeBootstrap() {
  bootOpen.value = false
  bootError.value = null
  // 进行中关闭只是收起界面（guest 继续跑）；没在跑才丢弃链式意图
  if (!bootstrap.running.value) pendingInstall.value = null
}

/**
 * 安装动作（P3 §3 链式）：
 * guest 在缺 node 时以业务码 `nodeMissing` 拒绝 → 弹引导确认 → 装完自动重入。
 * 互斥由 guest 串行锁保证，前端只渲染返回的业务码。
 */
async function handleInstall(cli: CliId, useMirror: boolean) {
  installError.value = null
  const r = await install.install(cli, useMirror)
  if (r.ok) return
  if (r.code === CODE_NODE_MISSING) {
    pendingInstall.value = { cli, useMirror }
    openBootstrap()
    return
  }
  installError.value = r.error ?? context.i18n.t('hub.inst.failed')
}

// 引导完成 → 自动重入原安装（单次确认、串行，不并发）
watch(
  () => bootstrap.state.value?.phase,
  async (phase) => {
    if (phase !== 'done' || !pendingInstall.value) return
    const args = pendingInstall.value
    pendingInstall.value = null
    bootOpen.value = false
    await install.install(args.cli, args.useMirror)
  },
)

/** 打开移除确认弹窗（不可一键静默删） */
function openRemove() {
  removeError.value = null
  removeOpen.value = true
  void bootstrap.refresh()
}

async function confirmRemove() {
  removeError.value = null
  const r = await bootstrap.remove()
  if (!r.ok) {
    removeError.value = r.error ?? context.i18n.t('hub.remove.failed')
    return
  }
  removeOpen.value = false
  // 兜底拉一次探测态：guest 侧已触发重探测，事件丢失时也不会停在旧值
  void refresh()
}

/** 卸载失败信号（guest 拒绝/异常 + 进程级 run 失败；瞬态提示，下次操作自动清除）。
 * 携带失败 CLI + 友好 i18n 文案（ADR 0030：guest 业务码优先，原文不携带） */
const uninstallFailed = ref<{ cli: CliId; error: string } | null>(null)

// 进程级卸载失败（run exit≠0 / 超时，如 npm 不可达 127）：last 终态落地时上屏。
// 此前失败只在安装页控制台可见，卡片静默回到「已安装」——2026-09-29 实测
// npm 127 后卡片无任何提示。与 guest 拒绝共用 uninstallFailed 通道。
watch(
  () => install.state.value?.last,
  (last) => {
    const cli = failedUninstallFromLast(last ?? null)
    if (cli) {
      uninstallFailed.value = {
        cli,
        error: context.i18n.t('hub.card.uninstallRunFailed'),
      }
    }
  },
)

/** 概览卡片卸载：发命令给 guest，失败则落瞬态提示（友好 i18n 文案） */
async function handleUninstall(cli: CliId) {
  uninstallFailed.value = null
  const r = await install.uninstall(cli)
  if (!r.ok) {
    uninstallFailed.value = {
      cli,
      error: r.error ?? context.i18n.t('hub.card.uninstallFailed'),
    }
  }
}

const tabs = computed(() => [
  { id: 'overview' as const, label: context.i18n.t('hub.tab.overview') },
  { id: 'install' as const, label: context.i18n.t('hub.tab.install') },
  { id: 'skills' as const, label: context.i18n.t('hub.tab.skills') },
  { id: 'providers' as const, label: context.i18n.t('hub.tab.providers') },
  { id: 'logs' as const, label: context.i18n.t('hub.tab.logs') },
  { id: 'stats' as const, label: context.i18n.t('hub.tab.stats') },
])

onMounted(() => {
  refresh()
  install.refresh()
  // 引导域状态（挂载 / 重连时拉持久化态 + 确认弹窗所需的计划）
  void bootstrap.refresh()
  // agent 清单：后端注册表为准；失败回退内置注册表并上屏降级横幅
  void catalog.load()
})

function gotoInstall() {
  activeTab.value = 'install'
}

/**
 * 各 CLI 的会话数据状态（票 07：概览卡片第六态「已装 · 未初始化」）
 *
 * 由 usage 域单实例计算后下传——统计与概览两个分区共享同一个 useUsage，
 * 不会重复拉取。未扫描 / 未授权 / 扫描中 → `unknown`（不下结论）。
 */
const sessionStates = computed(() => {
  const out: Partial<Record<CliId, ReturnType<typeof usage.cliSessionState>>> = {}
  for (const id of catalog.ids.value) out[id] = usage.cliSessionState(id)
  return out
})
</script>

<template>
  <div class="ah-view" data-testid="hub-view">
    <div
      v-if="catalog.degraded.value"
      class="ah-banner ah-banner-info"
      data-testid="agent-catalog-degraded"
    >
      <span class="ah-banner-ic">⚠</span>
      <span class="ah-banner-text">{{ context.i18n.t('hub.agents.degraded') }}</span>
    </div>
    <div class="ah-tabs" role="tablist" data-testid="hub-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="ah-tab"
        :class="{ active: activeTab === tab.id }"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :data-testid="`hub-tab-${tab.id}`"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 分区切换：过渡容器 page-swap 必须包在分段栏下方（.ah-view 本身还含顶部分段栏，
         直接标在 .ah-view 上会让退场层从栏顶开始绘制而盖住导航）。过渡类与效果
         变体由宿主 src/style.css 统一提供，本文件不再自带 .ah-page-*。 -->
    <div class="page-swap">
      <Transition name="page">
        <OverviewTab
        v-if="activeTab === 'overview'"
        :state="state"
        :detecting="detecting"
        :install-state="install.state.value"
        :speed-testing="install.speedTesting.value"
        :agents="catalog.agents.value"
        :session-states="sessionStates"
        :uninstall-failed="uninstallFailed"
        :bootstrap="bootstrap.state.value"
        @detect="detect"
        @auth="requestAuth"
        @speed-test="install.speedTest"
        @goto-install="gotoInstall"
        @uninstall="handleUninstall"
        @bootstrap-start="handleBootstrapStart"
        @bootstrap-cancel="cancelBootstrap"
        @node-remove="openRemove"
      />
      <InstallTab
        v-else-if="activeTab === 'install'"
        :detection="state"
        :state="install.state.value"
        :output="install.output.value"
        :checking="install.checking.value"
        :speed-testing="install.speedTesting.value"
        :agents="catalog.agents.value"
        :command-error="installError"
        @speed-test="install.speedTest"
        @apply-mirror="install.applyMirror"
        @restore="install.restoreNpmrc"
        @check-updates="install.checkUpdates"
        @install="handleInstall"
        @cancel="install.cancelRun"
        @auth="requestAuth"
      />
      <SkillsTab
        v-else-if="activeTab === 'skills'"
        :detection="state"
        :skills="skills"
        :agents="catalog.agents.value"
      />
      <ProvidersTab
        v-else-if="activeTab === 'providers'"
        :detection="state"
        :providers="providers"
        :agents="catalog.agents.value"
      />
      <SessionLogsTab v-else-if="activeTab === 'logs'" :usage="usage" />
      <StatsTab v-else :usage="usage" :agents="catalog.agents.value" />
      </Transition>
    </div>

    <!-- Node.js 引导 / 移除弹窗（Teleport 到 body；四态由 guest phase 决定） -->
    <NodeBootstrapDialog
      :open="bootOpen"
      :state="bootstrap.state.value"
      :plan="bootstrap.plan.value"
      :starting="bootstrap.starting.value"
      :command-error="bootError"
      :chain-name="chainName"
      @close="closeBootstrap"
      @start="startBootstrap"
      @cancel="cancelBootstrap"
    />
    <NodeRemoveDialog
      :open="removeOpen"
      :version="bootstrap.state.value?.placedVersion ?? null"
      :busy="bootstrap.removing.value"
      :error="removeError"
      @close="removeOpen = false"
      @confirm="confirmRemove"
    />
  </div>
</template>
