<script setup lang="ts">
/**
 * Agent Hub · 多任务卡片只读预览面（应用侧自绘；`mountPreview` 契约）
 *
 * 用途：宿主在多任务卡片缩略区挂一个容器，本组件在其中画一张**点时刻只读摘要**，
 * 让用户从卡片认出「这是 Agent Hub、本机 CLI 装了什么」。不是主界面的截图，也不
 * 复刻任何交互。
 *
 * 契约约束（spec D1/D3/D4/D11 + CONTRACT §6.2）：
 * - 只读：仅经 `env.appInvoke` 调本 app 既有只读命令 `agent-hub.get-state` /
 *   `agent-hub.get-usage-state`；不写存储、不发事件、不启动检测 / 扫描 / 轮询。
 * - 点时刻：`onMounted` 取一次数，取数前先渲染可读骨架；不订阅任何活过卸载的
 *   定时器 / / `window` / `document` 监听。`disposed` 只用于丢弃卸载后晚到的数据。
 * - 无交互：渲染 DOM 内没有任何可聚焦控件（无 button / a[href] / 输入 / tabindex），
 *   点击与焦点都由外层卡片覆盖层承接。
 * - 诚实空态：`state: null` / 命令失败 → 「暂无检测数据」；不编造「运行中」内容。
 * - 轻量：不 import 主 App.vue / 主 router / pinia / 主 stores；i18n 直接取本 app
 *   实例（`i18n.global.t`，无 inject），主题 / 语言跟随 `env.theme` / `env.locale`。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import type { AppPreviewEnv } from '../entry'
import type { AgentHubState, CliDetectInfo, CliId, UsageDomainState } from '../types'

const props = defineProps<{ env: AppPreviewEnv }>()

/** CLI 展示顺序与展示名（与主界面 CliCard 一致；纯展示，不参与业务判定） */
const CLI_IDS: CliId[] = ['claude', 'codex', 'opencode', 'pi']
const CLI_NAMES: Record<CliId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  pi: 'Pi',
}

/** 检测状态（guest 持久化全量；null = 从未探测过） */
const detection = ref<AgentHubState | null>(null)
/** 使用统计域状态（只取会话数摘要；null = 尚未同步 / 不可读） */
const usage = ref<UsageDomainState | null>(null)
/** 检测数据是否仍在读（首帧骨架；读完不再进入加载态） */
const detectionLoading = ref(true)
/** 卸载标志：晚到数据不得写回已卸载组件 */
let disposed = false

/** 本 app 域 i18n（扁平命名空间 key，与 appContext.t 同形） */
const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})

/** 单 CLI 的只读状态文案（版本 / 未安装 / 检测中 / 失败 / 未检测） */
function cliValue(info: CliDetectInfo | undefined): string {
  switch (info?.status) {
    case 'ok':
      return info.version ?? '—'
    case 'detecting':
      return t('hub.preview.detecting')
    case 'not-installed':
      return t('hub.preview.notInstalled')
    case 'error':
      return t('hub.preview.error')
    default:
      return t('hub.preview.idle')
  }
}

const rows = computed(() =>
  CLI_IDS.map((id) => {
    const info = detection.value?.clis?.[id]
    return {
      id,
      name: CLI_NAMES[id],
      value: cliValue(info),
      installed: info?.installed === true || info?.status === 'ok',
    }
  }),
)

/** 已装数量（installed 显式为 true，或探测终态 ok 且有版本） */
const installedCount = computed(() => rows.value.filter((row) => row.installed).length)

/**
 * 会话总数（usage 域已扫描 + 已授权时才有数据）
 *
 * 未同步 / 未授权 / 出错都返回 null——预览只说「会话数据未同步」，不把
 * 「看不到数据」说成 0 会话（与主界面 cliSessionState 的诚实口径一致）。
 */
const sessions = computed<number | null>(() => {
  const state = usage.value
  if (!state || state.status !== 'ok' || !state.authGranted) return null
  return Object.values(state.adapters ?? {}).reduce((sum, stat) => sum + (stat?.sessions ?? 0), 0)
})

/** 一次只读取数：检测概览（命令失败按诚实空态呈现，不抛、不重试、不弹提示） */
async function loadDetection(): Promise<void> {
  try {
    const data = await props.env.appInvoke<{ state?: AgentHubState | null } | null>(
      'agent-hub.get-state',
      {},
    )
    if (disposed) return
    detection.value = (data?.state ?? null) as AgentHubState | null
  } catch {
    if (!disposed) detection.value = null
  } finally {
    if (!disposed) detectionLoading.value = false
  }
}

/** 一次只读取数：会话数摘要（失败只回落到「未同步」，不影响检测概览） */
async function loadUsage(): Promise<void> {
  try {
    const data = await props.env.appInvoke<{ state?: UsageDomainState | null } | null>(
      'agent-hub.get-usage-state',
      {},
    )
    if (disposed) return
    usage.value = (data?.state ?? null) as UsageDomainState | null
  } catch {
    if (!disposed) usage.value = null
  }
}

onMounted(() => {
  void loadDetection()
  void loadUsage()
})

onUnmounted(() => {
  disposed = true
})
</script>

<template>
  <!-- 唯一根类名 + scoped：填满卡片缩略容器，只作为装饰层（外层卡片另有 inert） -->
  <div
    class="ahpv"
    :data-theme="env.theme"
    :data-locale="env.locale"
    :lang="env.locale"
  >
    <div class="ahpv-head">
      <span class="ahpv-brand">Agent Hub</span>
      <span class="ahpv-sub">{{ t('hub.preview.subtitle') }}</span>
    </div>

    <!-- 首帧骨架：可读文案 + 装饰条，不出现空白 / 转圈 -->
    <div v-if="detectionLoading" class="ahpv-skeleton">
      <span class="ahpv-loading">{{ t('hub.preview.loading') }}</span>
      <span class="ahpv-bar" aria-hidden="true" />
      <span class="ahpv-bar ahpv-bar-short" aria-hidden="true" />
      <span class="ahpv-bar" aria-hidden="true" />
    </div>

    <!-- 诚实空态：从未探测 / 命令失败 -->
    <div v-else-if="!detection" class="ahpv-empty">
      <span class="ahpv-empty-title">{{ t('hub.preview.empty') }}</span>
      <span class="ahpv-empty-hint">{{ t('hub.preview.emptyHint') }}</span>
    </div>

    <template v-else>
      <div class="ahpv-summary">
        <span class="ahpv-stat">
          {{ t('hub.preview.installedCount', { done: installedCount, total: CLI_IDS.length }) }}
        </span>
        <span v-if="sessions !== null" class="ahpv-stat">
          {{ t('hub.preview.sessionCount', { n: sessions }) }}
        </span>
        <span v-else class="ahpv-stat ahpv-stat-muted">
          {{ t('hub.preview.sessionUnknown') }}
        </span>
      </div>

      <div class="ahpv-list">
        <div
          v-for="row in rows"
          :key="row.id"
          class="ahpv-row"
          :class="{ 'is-installed': row.installed }"
        >
          <span class="ahpv-dot" aria-hidden="true" />
          <span class="ahpv-name">{{ row.name }}</span>
          <span class="ahpv-value">{{ row.value }}</span>
        </div>
      </div>
    </template>

    <!-- 上次停留页面（宿主注入的 lastRoute；只是附注，不是预览主数据） -->
    <div v-if="env.lastRoute" class="ahpv-foot">
      <span class="ahpv-route">{{ t('hub.preview.lastRoute', { path: env.lastRoute }) }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 预览面只读装饰层：填满宿主给的缩略容器，内部自成布局（容器查询，不假设全屏尺寸）。
   颜色 / 字号全部取宿主 token（主题跟随宿主），插件派生色取 styles.css 的 --ah-*；
   不写全局选择器、不碰 document.body。 */
.ahpv {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100%;
  padding: 16px 18px;
  overflow: hidden;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--font-size-label);
  line-height: 1.45;
  /* 内部按容器宽度自适应（卡片随窗口缩放），而不是按视口 */
  container-type: inline-size;
  /* 装饰层：不接手势、不可选中（外层卡片已 inert，这里是应用侧自守） */
  pointer-events: none;
  user-select: none;
}

.ahpv-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.ahpv-brand {
  font-size: var(--font-size-title);
  font-weight: 700;
  letter-spacing: 0.01em;
}

.ahpv-sub {
  font-size: var(--font-size-tag);
  color: var(--ah-text-data, var(--text-primary));
}

.ahpv-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ahpv-loading {
  font-size: var(--font-size-tag);
  color: var(--ah-text-data, var(--text-primary));
}

.ahpv-bar {
  display: block;
  height: 10px;
  border-radius: 999px;
  background: var(--bg-hover);
}

.ahpv-bar-short {
  width: 62%;
}

.ahpv-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 0;
}

.ahpv-empty-title {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
}

.ahpv-empty-hint {
  font-size: var(--font-size-tag);
  color: var(--ah-text-data, var(--text-primary));
}

.ahpv-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.ahpv-stat {
  font-size: var(--font-size-tag);
  font-weight: 600;
  color: var(--ah-text-data, var(--text-primary));
}

.ahpv-stat-muted {
  font-weight: 400;
}

.ahpv-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ahpv-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ahpv-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border-strong);
}

.ahpv-row.is-installed .ahpv-dot {
  background: var(--ah-dot-success, var(--color-success));
}

.ahpv-name {
  flex: none;
  font-size: var(--font-size-tag);
  font-weight: 600;
  color: var(--text-primary);
}

.ahpv-value {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--font-size-tag);
  color: var(--ah-text-data, var(--text-primary));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ahpv-foot {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.ahpv-route {
  font-size: var(--font-size-tag);
  color: var(--ah-text-data, var(--text-primary));
  word-break: break-all;
}

/* 窄卡片（缩略区更小 / UI 放大档）收紧留白与字号，避免内容被裁切 */
@container (max-width: 300px) {
  .ahpv {
    gap: 8px;
    padding: 10px 12px;
  }

  .ahpv-brand {
    font-size: var(--font-size-label);
  }
}
</style>
