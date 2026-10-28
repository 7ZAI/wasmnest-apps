<script setup lang="ts">
/**
 * Node.js 引导弹窗（P3）
 *
 * 四态（与 guest `bootstrap.phase` 对应，不在前端自造状态）：
 * - **确认**（idle / cancelled）：版本 / 目标平台 / 来源 / 大小 / SHA-256 + PATH 告知
 * - **进行**（preflight → reprobing）：阶段文案 + 已用时 + 取消（无假百分比：
 *   `host-process` 只在进程结束时回调，拿不到流式进度）
 * - **失败**（failed）：失败码对应文案 + 「详情」折叠原始输出尾部 + 重试
 * - **完成**（done）：已就绪（`alreadyReady` 时说明「无需安装」）
 *
 * 确认态的数据源是 `BootstrapPlan`（\`get-bootstrap-state\` 附带，不启动流水线）；
 * 一旦开始，展示切到 state 里的目标产物（兜底产物切换时也跟着变）。
 *
 * 安全约束（spec §7）：确认弹窗必须展示来源与校验方式——不做「一键静默下载」。
 */
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type {
  BootstrapFailureCode,
  BootstrapPhase,
  BootstrapPlan,
  BootstrapState,
} from '../types'

const props = defineProps<{
  open: boolean
  state: BootstrapState | null
  plan: BootstrapPlan | null
  /** 命令在途（防连点） */
  starting?: boolean
  /** 命令面拒绝（如 busy）的友好文案；确认态展示 */
  commandError?: string | null
  /** 链式安装目标 CLI 展示名（非空 = 装完 node 后自动继续装它） */
  chainName?: string | null
}>()

const emit = defineEmits<{ close: []; start: []; cancel: [] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const shaExpanded = ref(false)
const detailExpanded = ref(false)

const phase = computed<BootstrapPhase>(() => props.state?.phase ?? 'idle')
const running = computed(() => props.state?.active === true)
const failed = computed(() => phase.value === 'failed')
const done = computed(() => phase.value === 'done')
const already = computed(() => props.state?.alreadyReady === true)
const confirm = computed(() => !running.value && !failed.value && !done.value)

/** 当前产物：优先 state（已开始 / 已切兜底），否则用计划（确认态） */
const currentTarget = computed(() => {
  const list = props.state?.targets ?? []
  return list[props.state?.targetIndex ?? 0] ?? null
})

const version = computed(
  () => props.state?.version ?? props.plan?.version ?? '—',
)
const platform = computed(
  () =>
    currentTarget.value?.platform ??
    props.state?.platform ??
    props.plan?.platform ??
    '—',
)
const sha256 = computed(
  () => currentTarget.value?.sha256 ?? props.state?.sha256 ?? props.plan?.sha256 ?? '',
)
const bytes = computed(
  () => currentTarget.value?.bytes ?? props.state?.bytes ?? props.plan?.bytes ?? null,
)
const sources = computed(() => props.state?.sources ?? props.plan?.sources ?? [])

/** 来源主机：进行中显示实际在试的 URL，确认态显示首选来源 */
const sourceHost = computed(() => {
  const url = props.state?.sourceUrl ?? sources.value[0] ?? ''
  const m = /^https?:\/\/([^/]+)/.exec(url)
  return m ? m[1] : '—'
})

const sizeText = computed(() => {
  const b = bytes.value
  if (!b || b <= 0) return '—'
  return `${(b / 1024 / 1024).toFixed(1)} MB`
})

const shaShort = computed(() =>
  sha256.value ? `${sha256.value.slice(0, 12)}…` : '—',
)
const shaFull = computed(() => sha256.value || '—')

/** guest `Code::as_str` → i18n 短名（未知码退回通用文案，不裸奔 code） */
const FAIL_KEYS: Record<BootstrapFailureCode, string> = {
  'unsupported-platform': 'hub.boot.failed.unsupportedPlatform',
  'insufficient-space': 'hub.boot.failed.insufficientSpace',
  'download-failed': 'hub.boot.failed.downloadFailed',
  'verify-failed': 'hub.boot.failed.verifyFailed',
  'extract-failed': 'hub.boot.failed.extractFailed',
  'register-path-failed': 'hub.boot.failed.registerPathFailed',
  'reprobe-failed': 'hub.boot.failed.reprobeFailed',
  cancelled: 'hub.boot.failed.cancelled',
}

const failText = computed(() => {
  const code = props.state?.error?.code
  return t(code ? (FAIL_KEYS[code] ?? 'hub.boot.failed.generic') : 'hub.boot.failed.generic')
})
const detail = computed(() => props.state?.error?.detail ?? '')

const PHASE_KEYS: Partial<Record<BootstrapPhase, string>> = {
  preflight: 'hub.boot.phase.preflight',
  downloading: 'hub.boot.phase.downloading',
  verifying: 'hub.boot.phase.verifying',
  extracting: 'hub.boot.phase.extracting',
  registering: 'hub.boot.phase.registering',
  reprobing: 'hub.boot.phase.reprobing',
}
const phaseText = computed(() => t(PHASE_KEYS[phase.value] ?? 'hub.boot.phase.preflight'))

// 已用时：只在进行态计时（前端时钟；guest 只给 startedAt 毫秒戳）
const nowMs = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

function syncTicker() {
  if (running.value && ticker === null) {
    nowMs.value = Date.now()
    ticker = setInterval(() => {
      nowMs.value = Date.now()
    }, 1000)
  } else if (!running.value && ticker !== null) {
    clearInterval(ticker)
    ticker = null
  }
}

watch(running, syncTicker, { immediate: true })
watch(
  () => props.open,
  (open) => {
    if (!open) return
    shaExpanded.value = false
    detailExpanded.value = false
    syncTicker()
  },
)

onUnmounted(() => {
  if (ticker !== null) clearInterval(ticker)
})

const elapsedSec = computed(() => {
  const started = props.state?.startedAt ?? 0
  if (!started) return 0
  return Math.max(0, Math.floor((nowMs.value - started) / 1000))
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ah-modal">
      <div
        v-if="open"
        class="ah-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="boot-title"
        data-testid="boot-dialog"
        @click.self="emit('close')"
      >
        <div class="ah-modal-panel ah-card">
          <div class="ah-modal-head">
            <h2 id="boot-title" class="ah-modal-title">{{ t('hub.boot.confirm.title') }}</h2>
            <button
              type="button"
              class="ah-modal-close"
              :aria-label="t('hub.boot.close')"
              :title="t('hub.boot.close')"
              data-testid="boot-close"
              @click="emit('close')"
            >
              ✕
            </button>
          </div>

          <div class="ah-modal-body">
            <!-- 失败：码对应文案 + 原始输出尾部（折叠） -->
            <template v-if="failed">
              <div class="ah-cli-error" data-testid="boot-error">{{ failText }}</div>
              <div v-if="detail" class="ah-env-row">
                <button
                  type="button"
                  class="ah-btn ah-btn-ghost ah-btn-sm"
                  data-testid="boot-detail-toggle"
                  @click="detailExpanded = !detailExpanded"
                >
                  {{ detailExpanded ? t('hub.boot.detailHide') : t('hub.boot.detail') }}
                </button>
              </div>
              <pre v-if="detailExpanded" class="ah-console ah-mono" data-testid="boot-detail">{{ detail }}</pre>
            </template>

            <!-- 进行中：阶段 + 已用时（不做假百分比） -->
            <template v-else-if="running">
              <div class="ah-cli-tag warn" data-testid="boot-phase">
                <span class="ah-cli-dot"></span>{{ phaseText }}
              </div>
              <div class="ah-env-rows">
                <div class="ah-env-row">
                  <span class="ah-env-label">{{ t('hub.boot.row.version') }}</span>
                  <span class="ah-env-value ah-mono">{{ version }}</span>
                </div>
                <div class="ah-env-row">
                  <span class="ah-env-label">{{ t('hub.boot.row.platform') }}</span>
                  <span class="ah-env-value ah-mono">{{ platform }}</span>
                </div>
                <div class="ah-env-row">
                  <span class="ah-env-label">{{ t('hub.boot.row.source') }}</span>
                  <span class="ah-env-value ah-mono">{{ sourceHost }}</span>
                </div>
              </div>
              <div class="ah-inst-hint ah-mono" data-testid="boot-elapsed">
                {{ t('hub.boot.elapsed', { s: elapsedSec }) }}
              </div>
            </template>

            <!-- 完成 -->
            <template v-else-if="done">
              <div class="ah-cli-tag ok" data-testid="boot-done">
                <span class="ah-cli-dot"></span>{{ t('hub.boot.done') }}
              </div>
              <div class="ah-inst-hint">
                {{ already ? t('hub.boot.already', { version: props.state?.detectedVersion ?? version }) : version }}
              </div>
            </template>

            <!-- 确认：来源 / 平台 / 大小 / SHA-256 / PATH 告知 -->
            <template v-else>
              <p class="ah-inst-hint" data-testid="boot-body">
                {{ t('hub.boot.confirm.body', { version, platform, host: sourceHost, size: sizeText }) }}
              </p>
              <div class="ah-env-rows">
                <div class="ah-env-row">
                  <span class="ah-env-label">{{ t('hub.boot.row.version') }}</span>
                  <span class="ah-env-value ah-mono" data-testid="boot-version">{{ version }}</span>
                </div>
                <div class="ah-env-row">
                  <span class="ah-env-label">{{ t('hub.boot.row.platform') }}</span>
                  <span class="ah-env-value ah-mono" data-testid="boot-platform">{{ platform }}</span>
                </div>
                <div class="ah-env-row">
                  <span class="ah-env-label">{{ t('hub.boot.row.source') }}</span>
                  <span class="ah-env-value ah-mono" data-testid="boot-source">{{ sourceHost }}</span>
                </div>
                <div class="ah-env-row">
                  <span class="ah-env-label">{{ t('hub.boot.row.size') }}</span>
                  <span class="ah-env-value ah-mono" data-testid="boot-size">{{ sizeText }}</span>
                </div>
                <div class="ah-env-row">
                  <span class="ah-env-label">{{ t('hub.boot.row.sha256') }}</span>
                  <span class="ah-env-value ah-mono" data-testid="boot-sha">{{ shaExpanded ? shaFull : shaShort }}</span>
                  <button
                    v-if="sha256"
                    type="button"
                    class="ah-btn ah-btn-ghost ah-btn-sm"
                    data-testid="boot-sha-toggle"
                    @click="shaExpanded = !shaExpanded"
                  >
                    {{ shaExpanded ? t('hub.boot.sha.hide') : t('hub.boot.sha.show') }}
                  </button>
                </div>
              </div>
              <div class="ah-inst-hint" data-testid="boot-path">{{ t('hub.boot.confirm.path') }}</div>
              <!-- 链式安装：从某 CLI 的安装动作被 nodeMissing 拒绝时打开，装完自动继续 -->
              <div v-if="chainName" class="ah-inst-hint" data-testid="boot-chain">
                {{ t('hub.boot.chain', { cli: chainName }) }}
              </div>
              <div v-if="commandError" class="ah-cli-error" data-testid="boot-command-error">
                {{ commandError }}
              </div>
            </template>
          </div>

          <div class="ah-modal-foot">
            <button type="button" class="ah-btn ah-btn-ghost" data-testid="boot-close-foot" @click="emit('close')">
              {{ t('hub.boot.close') }}
            </button>
            <button
              v-if="running"
              type="button"
              class="ah-btn ah-btn-warn"
              data-testid="boot-cancel"
              @click="emit('cancel')"
            >
              {{ t('hub.boot.cancel') }}
            </button>
            <button
              v-else-if="failed"
              type="button"
              class="ah-btn ah-btn-primary"
              :disabled="starting"
              data-testid="boot-retry"
              @click="emit('start')"
            >
              {{ t('hub.boot.retry') }}
            </button>
            <button
              v-else-if="confirm"
              type="button"
              class="ah-btn ah-btn-primary"
              :disabled="starting"
              data-testid="boot-start"
              @click="emit('start')"
            >
              {{ t('hub.boot.start') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
