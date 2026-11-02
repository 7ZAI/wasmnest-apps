<script setup lang="ts">
/**
 * 宿主进程 / WebView 面板（桌面）：**与 wasm 指标分开的整机口径**。
 *
 * 数据来自宿主 `process` 段。版面与「平台总览」同构（全宽横排卡片），因为它回答的
 * 是同一层的整机问题，只是口径从「全部 wasm 的合计」换成「宿主进程树的 OS 账」：
 * - PSS = 共享页按比例分摊后的真占用；RSS 是上界（按进程加总 RSS 会重复计共享库页，
 *   实测可差 ~1.45 倍），两者并列，不互相顶替；
 * - CPU 是「占单核百分比」，核数并列下发供换算；
 * - `webview.present === false` 是「进程树里没有 WebView 子进程」（macOS 的内容进程
 *   由 launchd 拉起），必须显示「未归属」而不是 0 字节。
 *
 * 段缺失（旧宿主）= `null`，显示「未提供」，不伪造数字。
 */
import { computed, inject } from 'vue'
import type { MonitorAppContext } from '../appContext'
import type { HostProcessMetrics, ProcessSample, ProcessScope } from '../types'
import { formatBytes, formatNumber, formatPercent, formatRatio, usageRatio } from '../utils/format'

const props = defineProps<{ metrics: HostProcessMetrics | null }>()
const context = inject<MonitorAppContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const available = computed(() => props.metrics?.available === true)
const webview = computed(() => props.metrics?.webview)
const webviewPresent = computed(() => webview.value?.present === true)

/** WebView 占进程树 PSS 的比例（任一侧缺失 → null，不除零、不猜） */
const webviewShare = computed<number | null>(() =>
  usageRatio(webview.value?.pssBytes ?? null, props.metrics?.tree?.pssBytes ?? null),
)

/** CPU 口径说明：占单核百分比 + 机器核数（缺省时不猜） */
const cpuHint = computed<string | null>(() => {
  const cores = props.metrics?.cores
  if (typeof cores === 'number' && cores > 0) {
    return t('monitor.process.cpuCores', { n: cores })
  }
  return null
})

const webviewShareScale = computed(() => {
  const share = webviewShare.value
  return share === null ? 0 : Math.min(1, Math.max(0, share))
})

/** WebView 明细（渲染 / 网络 / GPU）+ 其他子进程：横排一行一条 */
const detailRows = computed<ProcessSample[]>(() => {
  const metrics = props.metrics
  if (!metrics || !metrics.available) return []
  return [...(metrics.webview?.processes ?? []), ...(metrics.otherChildren?.processes ?? [])].sort(
    (a, b) => a.pid - b.pid,
  )
})

const detailBase = computed(() => {
  const rows = detailRows.value
  return rows.reduce((max, row) => Math.max(max, row.pssBytes ?? row.rssBytes ?? 0), 0)
})

function pssText(scope: ProcessScope | null | undefined): string {
  return formatBytes(scope?.pssBytes ?? null)
}

function rssText(scope: ProcessScope | null | undefined): string {
  return formatBytes(scope?.rssBytes ?? null)
}

function cpuText(scope: ProcessScope | null | undefined): string {
  return formatPercent(scope?.cpuPercent ?? null)
}

/** 卡片注释：RSS · CPU（· 进程数）；CPU 无基线时按 key 说明，不写 0% */
function noteOf(scope: ProcessScope | null | undefined, withCount = false): string {
  const parts = [
    `${t('monitor.process.rss')} ${rssText(scope)}`,
    props.metrics?.cpuWindowMs === null
      ? t('monitor.process.cpuPending')
      : `${t('monitor.process.cpu')} ${cpuText(scope)}`,
  ]
  if (withCount) {
    parts.push(t('monitor.process.nProcesses', { n: formatNumber(scope?.processCount) }))
  }
  return parts.join(' · ')
}

function rowPss(sample: ProcessSample): string {
  return formatBytes(sample.pssBytes ?? sample.rssBytes ?? null)
}

function rowScale(sample: ProcessSample): number {
  const value = sample.pssBytes ?? sample.rssBytes ?? 0
  return detailBase.value > 0 ? Math.min(1, value / detailBase.value) : 0
}

function rowCpu(sample: ProcessSample): string {
  return formatPercent(sample.cpuPercent ?? null)
}
</script>

<template>
  <section class="mn-overview" data-testid="monitor-process">
    <p
      v-if="!props.metrics"
      class="mn-process-note"
      role="status"
      data-testid="monitor-process-unavailable"
    >
      {{ t('monitor.process.unavailable') }}
    </p>

    <p
      v-else-if="!available"
      class="mn-process-note"
      role="status"
      data-testid="monitor-process-unavailable"
    >
      {{ t('monitor.process.notSampled') }}
      <span v-if="props.metrics.reason" class="mn-muted">· {{ props.metrics.reason }}</span>
    </p>

    <template v-else>
      <div class="mn-overview-grid">
        <!-- 宿主主进程：PSS 为主值，RSS / CPU 作注释 -->
        <div class="mn-overview-card" data-testid="monitor-process-self">
          <span class="mn-overview-label">{{ t('monitor.process.scope.self') }}</span>
          <span class="mn-overview-value">{{ pssText(props.metrics.self) }}</span>
          <span class="mn-overview-note">
            {{ t('monitor.process.pss') }} · {{ noteOf(props.metrics.self) }}
          </span>
        </div>

        <!-- WebView：没有子进程时显式「未归属」，不写 0 字节 -->
        <div class="mn-overview-card" data-testid="monitor-process-webview">
          <span class="mn-overview-label">{{ t('monitor.process.scope.webview') }}</span>
          <span v-if="webviewPresent" class="mn-overview-value">{{ pssText(webview) }}</span>
          <span v-else class="mn-overview-value is-muted">
            {{ t('monitor.process.webviewAbsentShort') }}
          </span>
          <span
            v-if="!webviewPresent"
            class="mn-overview-note"
            data-testid="monitor-process-note-webview"
          >
            {{ t('monitor.process.webviewAbsent') }}
          </span>
          <span v-else class="mn-overview-note">{{ noteOf(webview, true) }}</span>
        </div>

        <!-- 其他子进程：应用自己拉起的进程（桌面通常为 0） -->
        <div class="mn-overview-card" data-testid="monitor-process-other">
          <span class="mn-overview-label">{{ t('monitor.process.scope.other') }}</span>
          <span class="mn-overview-value">{{ pssText(props.metrics.otherChildren) }}</span>
          <span class="mn-overview-note">
            <template v-if="(props.metrics.otherChildren?.processCount ?? 0) === 0">
              {{ t('monitor.process.noOtherChildren') }}
            </template>
            <template v-else>
              {{ noteOf(props.metrics.otherChildren, true) }}
            </template>
          </span>
        </div>

        <!-- 进程树合计：WebView 占比放进水位条（与总览的内存水位同一视觉语言） -->
        <div class="mn-overview-card is-wide" data-testid="monitor-process-tree">
          <span class="mn-overview-label">{{ t('monitor.process.scope.tree') }}</span>
          <span class="mn-overview-value">{{ pssText(props.metrics.tree) }}</span>
          <span class="mn-overview-note">{{ noteOf(props.metrics.tree, true) }}</span>
          <div v-if="webviewPresent" class="mn-overview-gauge" aria-hidden="true">
            <div
              class="mn-overview-gauge-fill is-ok"
              :style="{ transform: `scaleX(${webviewShareScale})` }"
            ></div>
          </div>
          <span v-if="webviewPresent" class="mn-overview-ratio is-ok">
            {{ webviewShare === null ? '—' : formatRatio(webviewShare) }}
            <span class="mn-overview-unit">{{ t('monitor.process.webviewShare') }}</span>
          </span>
        </div>
      </div>

      <!-- 进程明细：横排一行一条（进程名 / PSS / RSS / CPU） -->
      <div
        v-if="detailRows.length > 0"
        class="mn-proc-detail"
        data-testid="monitor-process-details"
      >
        <span class="mn-consumers-title">{{ t('monitor.process.details') }}</span>
        <ol class="mn-proc-detail-list">
          <li
            v-for="sample in detailRows"
            :key="sample.pid"
            class="mn-proc-detail-row"
            :data-testid="`monitor-process-list-${sample.role}`"
          >
            <span class="mn-proc-detail-name" :title="`${sample.name} (pid ${sample.pid})`">
              {{ sample.name || `pid ${sample.pid}` }}
            </span>
            <span class="mn-proc-detail-value">{{ rowPss(sample) }}</span>
            <span class="mn-proc-detail-meta">{{ rowCpu(sample) }}</span>
            <span class="mn-proc-detail-bar" aria-hidden="true">
              <span
                class="mn-proc-detail-bar-fill"
                :style="{ transform: `scaleX(${rowScale(sample)})` }"
              ></span>
            </span>
          </li>
        </ol>
      </div>

      <p class="mn-overview-gap" data-testid="monitor-process-hint">
        {{ cpuHint ?? t('monitor.process.noCores') }}
      </p>
    </template>
  </section>
</template>
