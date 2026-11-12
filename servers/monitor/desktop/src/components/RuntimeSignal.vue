<script setup lang="ts">
/**
 * 本次打开的调用速率轨迹（桌面）。
 *
 * 只用真实采样：相邻两次 `monitor.snapshot` 的 calls_total 差值 ÷ 间隔。
 * 计数回退或采样中断时断开线段，不补点；没有第二个采样时不画线。
 */
import { computed, inject } from 'vue'
import type { MonitorAppContext } from '../appContext'
import type { RuntimeSample } from '../types'
import { callRate, formatNumber } from '../utils/format'

const props = withDefaults(defineProps<{ samples: RuntimeSample[]; intervalMs?: number }>(), {
  intervalMs: 1000,
})

const context = inject<MonitorAppContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const WIDTH = 600
const HEIGHT = 150
const PAD = 10
/** 横轴固定为一分钟；数据从右侧进入，向左滚动，旧点自然离开 */
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

/** 逐段生成坐标；null rate 或间隔过大形成断点 */
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
    const x = WIDTH - (age / WINDOW_MS) * WIDTH
    out.push({
      x,
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

/** 连续点分组；每个数组是一段可连线数据 */
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
    ? t('monitor.signal.window', { seconds: windowSeconds.value })
    : t('monitor.signal.justStarted'),
)
const startingText = computed(() => t('monitor.signal.starting'))
const chartLabel = computed(() =>
  [
    t('monitor.signal.title'),
    windowText.value,
    currentRate.value === null
      ? startingText.value
      : `${currentRateText.value} ${t('monitor.signal.perSecond')}`,
    peakRate.value === null ? '' : t('monitor.signal.peak', { n: formatNumber(peakRate.value) }),
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
  <div class="mn-signal">
    <div class="mn-signal-head">
      <div>
        <p class="mn-signal-readout">
          <span :key="currentRateText" class="mn-signal-value">{{ currentRateText }}</span>
          <span class="mn-signal-unit">{{ t('monitor.signal.perSecond') }}</span>
        </p>
        <p class="mn-signal-label">{{ t('monitor.signal.title') }}</p>
      </div>
      <div class="mn-signal-meta">
        <span>{{ windowText }}</span>
        <span v-if="peakRate !== null">{{
          t('monitor.signal.peak', { n: formatNumber(peakRate) })
        }}</span>
      </div>
    </div>

    <div class="mn-signal-plot" role="img" :aria-label="chartLabel">
      <svg
        v-if="segments.length"
        class="mn-signal-svg"
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <template v-for="(segment, index) in segments" :key="index">
          <path v-if="segment.length > 1" class="mn-signal-area" :d="areaPath(segment)" />
          <path v-if="segment.length > 1" class="mn-signal-line" :d="linePath(segment)" />
        </template>
        <rect
          v-for="(mark, index) in trapMarks"
          :key="`trap-${index}`"
          class="mn-signal-trap"
          :x="mark.x - 1.5"
          :y="HEIGHT - 12"
          width="3"
          height="10"
          rx="1.5"
        />
      </svg>

      <template v-if="segments.length">
        <span
          v-for="(dot, index) in singleDots"
          :key="`dot-${index}`"
          class="mn-signal-dot"
          :style="{ left: pctX(dot), top: pctY(dot) }"
          aria-hidden="true"
        ></span>
        <span
          v-if="latestPoint"
          class="mn-signal-now"
          :style="{ left: pctX(latestPoint), top: pctY(latestPoint) }"
          aria-hidden="true"
        >
          <span class="mn-signal-halo"></span>
          <span class="mn-signal-now-core"></span>
        </span>
      </template>
      <p v-else class="mn-signal-empty">{{ startingText }}</p>
    </div>
  </div>
</template>

<style scoped>
.mn-signal {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  color: inherit;
}

.mn-signal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.mn-signal-label {
  margin: 6px 0 0;
  font-size: calc(14px * var(--ui-scale));
  line-height: 1.3;
  color: var(--signal-muted, currentColor);
}

.mn-signal-readout {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 2px 0 0;
}

.mn-signal-value {
  display: inline-block;
  font-size: calc(34px * var(--ui-scale));
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  animation: mn-signal-tick 420ms ease-out both;
}

.mn-signal-unit {
  font-size: calc(14px * var(--ui-scale));
  color: var(--signal-muted, currentColor);
}

.mn-signal-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  font-size: calc(13px * var(--ui-scale));
  line-height: 1.4;
  color: var(--signal-muted, currentColor);
  text-align: right;
}

.mn-signal-plot {
  position: relative;
  height: var(--signal-height, 150px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mn-signal-svg {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.mn-signal-line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.mn-signal-area {
  fill: currentColor;
  opacity: 0.11;
}

.mn-signal-dot {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  transform: translate(-50%, -50%);
}

.mn-signal-now {
  position: absolute;
  width: 0;
  height: 0;
  transform: translate(-50%, -50%);
}

.mn-signal-now-core {
  position: absolute;
  left: -4px;
  top: -4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.mn-signal-halo {
  position: absolute;
  left: -9px;
  top: -9px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.2;
  transform-origin: center;
  animation: mn-signal-halo 2s ease-out infinite;
}

.mn-signal-trap {
  fill: var(--signal-alert, currentColor);
}

.mn-signal-empty {
  margin: 0;
  padding: 22px 0;
  font-size: calc(14px * var(--ui-scale));
  color: var(--signal-muted, currentColor);
}

@keyframes mn-signal-tick {
  0% {
    opacity: 0.4;
    transform: translateY(3px);
  }
  100% {
    opacity: 1;
    transform: none;
  }
}

@keyframes mn-signal-halo {
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
  .mn-signal-value,
  .mn-signal-halo {
    animation: none;
  }
}
</style>
