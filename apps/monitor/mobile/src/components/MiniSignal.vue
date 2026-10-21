<script setup lang="ts">
/**
 * 移动端调用速率轨迹。与桌面同口径：相邻采样差值 / 间隔，30 秒窗口；
 * 采样中断或计数回退断开，不补点。仅存在于本次打开。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RuntimeSample } from '../types'
import { callRate, formatNumber } from '../utils/format'

const props = withDefaults(defineProps<{ samples: RuntimeSample[]; intervalMs?: number }>(), {
  intervalMs: 1000,
})

const NAMESPACE = 'com.wasmnest.monitor'
const { t } = useI18n()
const tx = (key: string, params?: Record<string, unknown>): string =>
  t(`${NAMESPACE}.${key}`, params ?? {})

const WIDTH = 600
const HEIGHT = 110
const PAD = 8
const WINDOW_MS = 30_000

interface Point {
  x: number
  y: number
  rate: number
  trapDelta: number
}

const firstAt = computed(() => props.samples[0]?.at ?? 0)
const lastAt = computed(() => props.samples[props.samples.length - 1]?.at ?? 0)
const spanMs = computed(() => Math.max(0, lastAt.value - firstAt.value))
const gapMs = computed(() => Math.max(5000, props.intervalMs * 5))

const series = computed<Array<Point | null>>(() => {
  const out: Array<Point | null> = []
  for (let i = 1; i < props.samples.length; i++) {
    const previous = props.samples[i - 1]
    const current = props.samples[i]
    const elapsed = current.at - previous.at
    if (elapsed > gapMs.value) {
      out.push(null)
      continue
    }
    const rate = callRate(previous.callsTotal, current.callsTotal, elapsed)
    if (rate === null) {
      out.push(null)
      continue
    }
    const age = lastAt.value - current.at
    if (age > WINDOW_MS) continue
    out.push({
      x: WIDTH - (age / WINDOW_MS) * WIDTH,
      y: 0,
      rate,
      trapDelta: Math.max(0, current.trapsTotal - previous.trapsTotal),
    })
  }
  return out
})

const maxRate = computed(() => Math.max(1, ...series.value.map((point) => point?.rate ?? 0)))
const scaled = computed<Array<Point | null>>(() =>
  series.value.map((point) =>
    point
      ? {
          ...point,
          y: HEIGHT - PAD - (point.rate / maxRate.value) * (HEIGHT - PAD * 2),
        }
      : null,
  ),
)
const segments = computed<Point[][]>(() => {
  const result: Point[][] = []
  let current: Point[] = []
  for (const point of scaled.value) {
    if (point) current.push(point)
    else if (current.length) {
      result.push(current)
      current = []
    }
  }
  if (current.length) result.push(current)
  return result
})
const trapMarks = computed(() =>
  scaled.value.filter((point): point is Point => !!point && point.trapDelta > 0),
)
const singleDots = computed(() =>
  segments.value.filter((segment) => segment.length === 1).map((segment) => segment[0]),
)
const latestPoint = computed(() => {
  for (let i = scaled.value.length - 1; i >= 0; i--) {
    const point = scaled.value[i]
    if (point) return point
  }
  return null
})
const currentRate = computed(() => {
  for (let i = series.value.length - 1; i >= 0; i--) {
    const point = series.value[i]
    if (point) return point.rate
  }
  return null
})
const currentRateText = computed(() =>
  currentRate.value === null ? '—' : formatNumber(currentRate.value),
)
const peakRate = computed(() => {
  const values = series.value.filter((point): point is Point => !!point).map((point) => point.rate)
  return values.length ? Math.max(...values) : null
})
const windowSeconds = computed(() => Math.min(WINDOW_MS / 1000, Math.round(spanMs.value / 1000)))
const windowText = computed(() =>
  windowSeconds.value >= 1
    ? tx('monitor.signal.window', { seconds: windowSeconds.value })
    : tx('monitor.signal.justStarted'),
)
const startingText = computed(() => tx('monitor.signal.starting'))
const chartLabel = computed(() =>
  [
    tx('monitor.signal.title'),
    windowText.value,
    currentRate.value === null
      ? startingText.value
      : `${currentRateText.value} ${tx('monitor.signal.perSecond')}`,
    peakRate.value === null ? '' : tx('monitor.signal.peak', { n: formatNumber(peakRate.value) }),
  ]
    .filter(Boolean)
    .join(' · '),
)

function linePath(points: Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ')
}
function areaPath(points: Point[]): string {
  if (points.length < 2) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${linePath(points)} L${last.x.toFixed(1)} ${HEIGHT} L${first.x.toFixed(1)} ${HEIGHT} Z`
}
function pctX(point: Point): string {
  return `${(point.x / WIDTH) * 100}%`
}
function pctY(point: Point): string {
  return `${(point.y / HEIGHT) * 100}%`
}
</script>

<template>
  <div class="mnm-signal">
    <div class="mnm-signal-head">
      <div>
        <p class="mnm-signal-readout">
          <span :key="currentRateText" class="mnm-signal-value">{{ currentRateText }}</span>
          <span class="mnm-signal-unit">{{ tx('monitor.signal.perSecond') }}</span>
        </p>
        <p class="mnm-signal-label">{{ tx('monitor.signal.title') }}</p>
      </div>
      <div class="mnm-signal-meta">
        <span>{{ windowText }}</span>
        <span v-if="peakRate !== null">{{
          tx('monitor.signal.peak', { n: formatNumber(peakRate) })
        }}</span>
      </div>
    </div>

    <div class="mnm-signal-plot" role="img" :aria-label="chartLabel">
      <svg
        v-if="segments.length"
        class="mnm-signal-svg"
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <template v-for="(segment, index) in segments" :key="index">
          <path v-if="segment.length > 1" class="mnm-signal-area" :d="areaPath(segment)" />
          <path v-if="segment.length > 1" class="mnm-signal-line" :d="linePath(segment)" />
        </template>
        <rect
          v-for="(mark, index) in trapMarks"
          :key="`trap-${index}`"
          class="mnm-signal-trap"
          :x="mark.x - 1.5"
          :y="HEIGHT - 10"
          width="3"
          height="8"
          rx="1.5"
        />
      </svg>
      <span
        v-for="(dot, index) in singleDots"
        :key="`dot-${index}`"
        class="mnm-signal-dot"
        :style="{ left: pctX(dot), top: pctY(dot) }"
        aria-hidden="true"
      ></span>
      <span
        v-if="latestPoint"
        class="mnm-signal-now"
        :style="{ left: pctX(latestPoint), top: pctY(latestPoint) }"
        aria-hidden="true"
      >
        <span class="mnm-signal-halo"></span>
        <span class="mnm-signal-now-core"></span>
      </span>
      <p v-if="!segments.length" class="mnm-signal-empty">{{ startingText }}</p>
    </div>
  </div>
</template>

<style scoped>
.mnm-signal {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  color: inherit;
}

.mnm-signal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.mnm-signal-readout {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
}

.mnm-signal-value {
  display: inline-block;
  font-size: 30px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  animation: mnm-signal-tick 420ms ease-out both;
}

.mnm-signal-unit {
  font-size: 13px;
  color: var(--mnm-band-muted, currentColor);
}

.mnm-signal-label {
  margin: 5px 0 0;
  font-size: 13px;
  line-height: 1.3;
  color: var(--mnm-band-muted, currentColor);
}

.mnm-signal-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mnm-band-muted, currentColor);
  text-align: right;
}

.mnm-signal-plot {
  position: relative;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mnm-signal-svg {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.mnm-signal-line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.mnm-signal-area {
  fill: currentColor;
  opacity: 0.1;
}

.mnm-signal-dot {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  transform: translate(-50%, -50%);
}

.mnm-signal-now {
  position: absolute;
  width: 0;
  height: 0;
  transform: translate(-50%, -50%);
}

.mnm-signal-now-core {
  position: absolute;
  left: -3.5px;
  top: -3.5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.mnm-signal-halo {
  position: absolute;
  left: -8px;
  top: -8px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.2;
  transform-origin: center;
  animation: mnm-signal-halo 2s ease-out infinite;
}

.mnm-signal-trap {
  fill: var(--mnm-band-danger, currentColor);
}

.mnm-signal-empty {
  margin: 0;
  font-size: 13px;
  color: var(--mnm-band-muted, currentColor);
}

@keyframes mnm-signal-tick {
  0% {
    opacity: 0.4;
    transform: translateY(2px);
  }
  100% {
    opacity: 1;
    transform: none;
  }
}

@keyframes mnm-signal-halo {
  0% {
    opacity: 0.28;
    transform: scale(0.55);
  }
  70%,
  100% {
    opacity: 0;
    transform: scale(1.35);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mnm-signal-value,
  .mnm-signal-halo {
    animation: none;
  }
}
</style>
