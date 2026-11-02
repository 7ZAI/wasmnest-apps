<script setup lang="ts">
/**
 * 宿主进程卡片（移动端）：**与 wasm 指标分开的整机口径**
 *
 * 数据来自快照 `process` 段。移动端能力边界比桌面窄，文案必须说清：
 * - `self` = 本进程（宿主 Rust + wasm 运行时）的 PSS / RSS / CPU；
 * - WebView 渲染进程不可归属（Android 上是独立 uid、父进程 `webview_zygote`），
 *   所以「进程树合计」**不含** WebView——不要读成「整个 app 占多少」；
 * - WebView JS 堆是浏览器自报（Chromium `performance.memory`），且未开跨源隔离时
 *   被量化；与进程内存是两个口径，分开显示。
 *
 * 段缺失（旧宿主）= `metrics` 为 null → 显示「未提供」，不伪造数字。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HostProcessMetrics, ProcessScope, WebviewHeap } from '../types'
import { formatBytes, formatNumber, formatPercent, formatRatio, usageRatio } from '../utils/format'

const props = defineProps<{
  metrics: HostProcessMetrics | null
  heap: WebviewHeap | null
}>()

const NAMESPACE = 'com.wasmnest.monitor'
const { t } = useI18n()
const tx = (key: string, params?: Record<string, unknown>): string =>
  t(`${NAMESPACE}.${key}`, params ?? {})

const available = computed(() => props.metrics?.available === true)
const webviewPresent = computed(() => props.metrics?.webview?.present === true)

/** WebView 占进程树 PSS 的比例（不可归属 → null，不除零、不猜） */
const webviewShare = computed<number | null>(() =>
  usageRatio(props.metrics?.webview?.pssBytes ?? null, props.metrics?.tree?.pssBytes ?? null),
)

function bytesOf(scope: ProcessScope | null | undefined): string {
  return formatBytes(scope?.pssBytes ?? null)
}

function rssOf(scope: ProcessScope | null | undefined): string {
  return formatBytes(scope?.rssBytes ?? null)
}

function cpuOf(scope: ProcessScope | null | undefined): string {
  return formatPercent(scope?.cpuPercent ?? null)
}

const heapText = computed<string | null>(() => {
  const heap = props.heap
  if (!heap) return null
  const used = formatBytes(heap.usedBytes)
  const limit = heap.limitBytes === null ? null : formatBytes(heap.limitBytes)
  return limit ? tx('monitor.process.heapValue', { used, limit }) : used
})
</script>

<template>
  <section class="mnm-proc" data-ui data-testid="mobile-monitor-process">
    <header class="mnm-proc-head">
      <h2 class="mnm-proc-title">{{ tx('monitor.process.title') }}</h2>
      <p class="mnm-proc-note">{{ tx('monitor.process.hint') }}</p>
    </header>

    <p
      v-if="!props.metrics"
      class="mnm-proc-note"
      role="status"
      data-testid="mobile-monitor-process-unavailable"
    >
      {{ tx('monitor.process.unavailable') }}
    </p>

    <p
      v-else-if="!available"
      class="mnm-proc-note"
      role="status"
      data-testid="mobile-monitor-process-unavailable"
    >
      {{ tx('monitor.process.notSampled') }}
      <span v-if="props.metrics.reason" class="mnm-proc-muted">· {{ props.metrics.reason }}</span>
    </p>

    <template v-else>
      <div class="mnm-proc-grid">
        <div class="mnm-proc-cell" data-testid="mobile-monitor-process-self">
          <span class="mnm-proc-value">{{ bytesOf(props.metrics.self) }}</span>
          <span class="mnm-proc-label">{{ tx('monitor.process.pss') }}</span>
        </div>
        <div class="mnm-proc-cell">
          <span class="mnm-proc-value">{{ rssOf(props.metrics.self) }}</span>
          <span class="mnm-proc-label">{{ tx('monitor.process.rss') }}</span>
        </div>
        <div class="mnm-proc-cell">
          <span class="mnm-proc-value">{{ cpuOf(props.metrics.self) }}</span>
          <span class="mnm-proc-label">
            {{
              props.metrics.cpuWindowMs === null
                ? tx('monitor.process.cpuPending')
                : tx('monitor.process.cpu')
            }}
          </span>
        </div>
      </div>

      <dl class="mnm-proc-rows">
        <div data-testid="mobile-monitor-process-webview">
          <dt>{{ tx('monitor.process.webviewRow') }}</dt>
          <dd>
            {{
              webviewPresent
                ? `${bytesOf(props.metrics.webview)} · ${formatRatio(webviewShare)}`
                : tx('monitor.process.webviewAbsent')
            }}
          </dd>
        </div>
        <div v-if="heapText" data-testid="mobile-monitor-process-heap">
          <dt>{{ tx('monitor.process.heapRow') }}</dt>
          <dd>
            {{ heapText }}
            <span v-if="props.heap?.quantized" class="mnm-proc-muted">
              · {{ tx('monitor.process.heapQuantized') }}
            </span>
          </dd>
        </div>
        <div data-testid="mobile-monitor-process-other">
          <dt>{{ tx('monitor.process.otherRow') }}</dt>
          <dd>
            {{
              tx('monitor.process.otherValue', {
                n: formatNumber(props.metrics.otherChildren?.processCount),
                pss: bytesOf(props.metrics.otherChildren),
              })
            }}
          </dd>
        </div>
        <div data-testid="mobile-monitor-process-tree">
          <dt>{{ tx('monitor.process.treeRow') }}</dt>
          <dd>
            {{
              tx('monitor.process.treeValue', {
                pss: bytesOf(props.metrics.tree),
                rss: rssOf(props.metrics.tree),
                cpu: cpuOf(props.metrics.tree),
              })
            }}
          </dd>
        </div>
      </dl>

      <p class="mnm-proc-note" data-testid="mobile-monitor-process-tree-note">
        {{ tx('monitor.process.treeNote') }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.mnm-proc {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--mobile-radius-card, 14px);
  background: var(--mobile-bg-card);
}

.mnm-proc-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mnm-proc-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.02em;
  color: var(--mnm-ink);
}

.mnm-proc-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--mobile-text-secondary);
}

.mnm-proc-muted {
  color: var(--mobile-text-secondary);
}

.mnm-proc-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.mnm-proc-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mnm-proc-value {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--mnm-ink);
  font-variant-numeric: tabular-nums;
}

.mnm-proc-label {
  font-size: 11px;
  line-height: 1.4;
  color: var(--mobile-text-secondary);
}

.mnm-proc-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}

.mnm-proc-rows > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.mnm-proc-rows dt {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--mobile-text-secondary);
}

.mnm-proc-rows dd {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  text-align: right;
  color: var(--mnm-ink);
  font-variant-numeric: tabular-nums;
}
</style>
