<script setup lang="ts">
/**
 * 宿主进程 / WebView 面板（桌面）：**与 wasm 指标分开的整机口径**。
 *
 * 显示的是宿主 `process` 段——宿主主进程 + WebKitGTK 子进程的 OS 账：
 * - PSS = 共享页按比例分摊后的「真占用」；RSS 是上界（同一棵树按进程加总会
 *   重复计共享库页，实测可差近两倍），两者并列显示，不互相顶替；
 * - CPU 是「占单核百分比」，并列下发核数供换算；
 * - `webview.present === false` 是「进程树里没有 WebView 子进程」（macOS 的
 *   内容进程由 launchd 拉起），页面必须显示「未归属」而不是 0 字节。
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

interface ScopeBlock {
  id: 'self' | 'webview' | 'other' | 'tree'
  scope: ProcessScope | null | undefined
  processes: ProcessSample[] | undefined
  /** 备注（没有 WebView / PSS 不可用等），null = 无需备注 */
  note: string | null
  testId: string
}

const scopes = computed<ScopeBlock[]>(() => {
  const metrics = props.metrics
  if (!metrics || !metrics.available) return []
  const webview = metrics.webview
  const other = metrics.otherChildren
  return [
    {
      id: 'self',
      scope: metrics.self ?? null,
      processes: undefined,
      note: null,
      testId: 'self',
    },
    {
      id: 'webview',
      scope: webview ?? null,
      processes: webview?.processes,
      note: !webview
        ? t('monitor.process.webviewMissing')
        : !webview.present
          ? t('monitor.process.webviewAbsent')
          : null,
      testId: 'webview',
    },
    {
      id: 'other',
      scope: other ?? null,
      processes: other?.processes,
      note: other && (other.processCount ?? 0) === 0 ? t('monitor.process.noOtherChildren') : null,
      testId: 'other',
    },
    {
      id: 'tree',
      scope: metrics.tree ?? null,
      processes: undefined,
      note: null,
      testId: 'tree',
    },
  ]
})

/** WebView 占进程树 PSS 的比例（任一侧缺失 → null，不除零、不猜） */
const webviewShare = computed<number | null>(() => {
  const metrics = props.metrics
  return usageRatio(metrics?.webview?.pssBytes ?? null, metrics?.tree?.pssBytes ?? null)
})

/** CPU 口径说明：单核百分比 + 核数（无基线时缺省） */
const cpuHint = computed<string | null>(() => {
  const metrics = props.metrics
  if (!metrics || !metrics.available) return null
  const cores = metrics.cores
  if (typeof cores === 'number' && cores > 0) {
    return t('monitor.process.cpuCores', { n: cores })
  }
  return null
})

const cpuPending = computed<boolean>(() => {
  const metrics = props.metrics
  return !!metrics && metrics.available && (metrics.cpuWindowMs ?? null) === null
})

function bytesText(scope: ProcessScope | null | undefined): string {
  return formatBytes(scope?.pssBytes ?? null)
}

function rssText(scope: ProcessScope | null | undefined): string {
  return formatBytes(scope?.rssBytes ?? null)
}

function cpuText(scope: ProcessScope | null | undefined): string {
  return formatPercent(scope?.cpuPercent ?? null)
}

function sampleBytes(sample: ProcessSample): string {
  return formatBytes(sample.pssBytes ?? sample.rssBytes ?? null)
}

function sampleCpu(sample: ProcessSample): string {
  return formatPercent(sample.cpuPercent ?? null)
}
</script>

<template>
  <section class="mn-host-section" data-ui data-testid="monitor-process">
    <header class="mn-section-head">
      <div>
        <h2 class="mn-section-title">{{ t('monitor.process.title') }}</h2>
        <p class="mn-section-hint">{{ t('monitor.process.hint') }}</p>
      </div>
    </header>

    <p
      v-if="!props.metrics"
      class="mn-process-note"
      role="status"
      data-testid="monitor-process-unavailable"
    >
      {{ t('monitor.process.unavailable') }}
    </p>

    <p
      v-else-if="!props.metrics.available"
      class="mn-process-note"
      role="status"
      data-testid="monitor-process-unavailable"
    >
      {{ t('monitor.process.notSampled') }}
      <span v-if="props.metrics.reason" class="mn-muted">· {{ props.metrics.reason }}</span>
    </p>

    <template v-else>
      <div class="mn-process-share" data-testid="monitor-process-share">
        <span class="mn-process-share-label">{{ t('monitor.process.webviewShare') }}</span>
        <span class="mn-process-share-value">
          {{ webviewShare === null ? '—' : formatRatio(webviewShare) }}
        </span>
      </div>

      <div class="mn-process-scopes">
        <div
          v-for="block in scopes"
          :key="block.id"
          class="mn-process-scope"
          :data-testid="`monitor-process-${block.testId}`"
        >
          <h3 class="mn-process-scope-title">{{ t(`monitor.process.scope.${block.id}`) }}</h3>
          <dl class="mn-system-grid">
            <div class="mn-system-item">
              <dd class="mn-system-value">{{ bytesText(block.scope) }}</dd>
              <dt class="mn-system-label">{{ t('monitor.process.pss') }}</dt>
            </div>
            <div class="mn-system-item">
              <dd class="mn-system-value">{{ rssText(block.scope) }}</dd>
              <dt class="mn-system-label">{{ t('monitor.process.rss') }}</dt>
            </div>
            <div class="mn-system-item">
              <dd class="mn-system-value">{{ cpuText(block.scope) }}</dd>
              <dt class="mn-system-label">
                {{ cpuPending ? t('monitor.process.cpuPending') : t('monitor.process.cpu') }}
              </dt>
            </div>
            <div v-if="block.id !== 'self'" class="mn-system-item">
              <dd class="mn-system-value">{{ formatNumber(block.scope?.processCount) }}</dd>
              <dt class="mn-system-label">{{ t('monitor.process.processCount') }}</dt>
            </div>
          </dl>

          <p
            v-if="block.note"
            class="mn-process-note"
            :data-testid="`monitor-process-note-${block.testId}`"
          >
            {{ block.note }}
          </p>

          <ul
            v-if="block.processes && block.processes.length > 0"
            class="mn-process-procs"
            :data-testid="`monitor-process-list-${block.testId}`"
          >
            <li v-for="sample in block.processes" :key="sample.pid" class="mn-process-row">
              <span class="mn-process-name">{{ sample.name || `pid ${sample.pid}` }}</span>
              <span class="mn-process-cpu">{{ sampleCpu(sample) }}</span>
              <span class="mn-process-bytes">{{ sampleBytes(sample) }}</span>
            </li>
          </ul>
        </div>
      </div>

      <p class="mn-process-note" data-testid="monitor-process-hint">
        {{ cpuHint ?? t('monitor.process.noCores') }}
      </p>
    </template>
  </section>
</template>
