/**
 * 离线扫码命中率基准（票 2026-11-11，spec §6.1）
 * -----------------------------------------------------------------------------
 * 真实相机不可进 CI，但「解码策略在退化图像上还能不能读出模块」可以离线复现：
 *
 * ```text
 * 桌面真实载荷 / 画布参数（pairingPayload + qrRender，跨端同一份代码）
 *   → 1080p 传感器渲染（二维码按取景框大小投影到传感器上）
 *   → 光学高斯模糊（σ 两档）+ 盒式降采样到工作画布（短边 720，与运行时同口径）
 *   → 噪声（两档）+ 亚像素平移（三组）
 *   → 生产策略 planAttempts + decodeQrImage（每帧多档，帧间轮换旋转方向）
 * ```
 *
 * 判据分两级：
 * - **帧级**：首帧的尝试序列里有没有解出（反映单帧能力，受假 finder 随机性影响）；
 * - **扫描级**：连续 `framesPerScan` 帧（默认 4 = 一轮旋转覆盖）内至少解出一次
 *   （反映「把手机对着码」的真实体验，DoD 的 ≥95% 按这一级判）。
 *
 * 输出只带样本序号 / host，**不带载荷原文**（二维码含 token 与一次性票据）。
 *
 * 用法：`node scripts/qr-decode-bench.mjs`（Node ≥ 22.18 直接跑 TS；也可被 vitest
 * 直接 import 做阈值断言）。
 */

import { buildQrPayload } from '../../../../../desktop/src/utils/pairingPayload.ts'
import { qrMatrix, QR_QUIET_ZONE_MODULES } from '../../../../../desktop/src/utils/qrRender.ts'
import {
  FRAME_BUDGET_MS,
  planAttempts,
  attemptCapture,
  workCanvasEdge,
} from '../../scan/decodeStrategy.ts'
import { scanFrameSize } from '../../scanViewport.ts'
import { decodeQrImage } from '../../scan/zxingDecoder.ts'

/** 传感器短边（1080p 竖屏手机，与 spec §2.3 同口径） */
const SENSOR_SHORT = 1080

/** 典型竖屏预览 CSS 尺寸（与 `scanIntegration.test.ts` 同口径） */
const PREVIEW_WIDTH = 390
const PREVIEW_HEIGHT = 520

/** 取景框在预览里的边长（生产公式，见 `scanViewport.scanFrameSize`） */
const FRAME_SIZE = scanFrameSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, PREVIEW_HEIGHT)

/** 工作画布短边（生产口径） */
const WORK_EDGE = workCanvasEdge(PREVIEW_WIDTH)

/** 退化两档：正常室内光（轻模糊 + 小噪声）/ 对焦偏差（重模糊 + 大噪声） */
const DEGRADES = [
  { sigma: 1.5, noise: 4, label: 'normal' },
  { sigma: 2.5, noise: 8, label: 'soft-focus' },
] as const

/** 亚像素平移三组（相机与屏幕的相对位置，永远不是整数模块网格） */
const SHIFTS = [0, 1 / 3, 2 / 3] as const

/** 宿主 status 里的真实节点 id（形状与长度同线上） */
const NODE_ID = '12D3KooWBSCkgKRqQWpPhGGC61TfEWno22bcEGXxQvohhPbQBkud'
const RELAY_ID = '12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H'

export interface BenchOptions {
  /** 载荷数（默认 20，spec §6.1） */
  payloadCount?: number
  /** 每个样本模拟连续扫描多少帧（默认 4 = 一轮旋转方向覆盖） */
  framesPerScan?: number
  /** 随机种子（默认 20261111，保证 CI 可复现） */
  seed?: number
}

/** 分档命中率（按退化档列） */
export interface BenchDegradeBucket {
  label: string
  sigma: number
  noise: number
  samples: number
  frameHits: number
  scanHits: number
}

export interface BenchReport {
  payloads: number
  samples: number
  framesPerScan: number
  /** 首帧命中数（帧级） */
  frameHits: number
  /** 扫描级命中数（N 帧内至少一次） */
  scanHits: number
  frameHitRate: number
  scanHitRate: number
  /** 单帧解码耗时（ms，仅统计解码调用，不含画布搬运） */
  p50Ms: number
  p95Ms: number
  byDegrade: BenchDegradeBucket[]
  /** 扫描级失败样本（只含序号 / host / 退化档，不含载荷原文） */
  failures: string[]
}

/** 可复现的 32 位随机数（mulberry32）：语料固定，CI 不因随机分布跳变 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 生成 n 位小写 hex（token / 票据与线上同长度） */
function hex(random: () => number, digits: number): string {
  let out = ''
  while (out.length < digits) out += Math.floor(random() * 16).toString(16)
  return out.slice(0, digits)
}

/** 一条 v2 载荷（1~3 条地址：LAN / 多网卡 / relay，覆盖 85~93 模块） */
function makePayload(random: () => number, index: number): { text: string; host: string } {
  const host = `192.168.1.${100 + index}`
  const addrs = [`/ip4/${host}/tcp/${39000 + index}/p2p/${NODE_ID}`]
  if (index % 2 === 0) {
    addrs.push(`/ip4/113.45.43.60/tcp/4001/p2p/${RELAY_ID}/p2p-circuit/p2p/${NODE_ID}`)
  }
  if (index % 3 === 0) {
    addrs.push(`/ip4/10.8.0.${4 + index}/tcp/39000/p2p/${NODE_ID}`)
  }
  return {
    host,
    text: buildQrPayload({
      host,
      port: 8765 + index,
      token: hex(random, 32),
      peer: { nodeId: NODE_ID, addrs, ticket: hex(random, 64) },
    }),
  }
}

/** 渲染二维码到传感器灰度图（含静区 + 白边；cell 可为小数，模拟真实投影） */
function renderSensor(
  matrix: { size: number; data: Uint8Array },
  qrSide: number,
): { gray: Float32Array; size: number } {
  const side =
    (matrix.size + QR_QUIET_ZONE_MODULES * 2) * (qrSide / (matrix.size + QR_QUIET_ZONE_MODULES * 2))
  const cell = side / (matrix.size + QR_QUIET_ZONE_MODULES * 2)
  const pad = Math.max(12, Math.round(cell * 4))
  const size = Math.ceil(side + pad * 2)
  const gray = new Float32Array(size * size).fill(255)
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.data[y * matrix.size + x]) continue
      const x0 = Math.round(pad + (QR_QUIET_ZONE_MODULES + x) * cell)
      const y0 = Math.round(pad + (QR_QUIET_ZONE_MODULES + y) * cell)
      const x1 = Math.round(pad + (QR_QUIET_ZONE_MODULES + x + 1) * cell)
      const y1 = Math.round(pad + (QR_QUIET_ZONE_MODULES + y + 1) * cell)
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (px >= 0 && py >= 0 && px < size && py < size) gray[py * size + px] = 0
        }
      }
    }
  }
  return { gray, size }
}

/** 可分离高斯模糊（光学失焦的常用近似） */
function gaussianBlur(gray: Float32Array, size: number, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel: number[] = []
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel.push(value)
    sum += value
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum

  const horizontal = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0
      for (let i = -radius; i <= radius; i++) {
        const xx = Math.min(size - 1, Math.max(0, x + i))
        acc += gray[y * size + xx] * kernel[i + radius]
      }
      horizontal[y * size + x] = acc
    }
  }
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0
      for (let i = -radius; i <= radius; i++) {
        const yy = Math.min(size - 1, Math.max(0, y + i))
        acc += horizontal[yy * size + x] * kernel[i + radius]
      }
      out[y * size + x] = acc
    }
  }
  return out
}

/** 区域平均降采样（相机把高分辨率画面缩到解码画布就是这一步） */
function boxDown(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  shiftX = 0,
  shiftY = 0,
): Float32Array {
  const out = new Float32Array(dstW * dstH)
  const fx = srcW / dstW
  const fy = srcH / dstH
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * fy + shiftY)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy + shiftY))
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * fx + shiftX)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx + shiftX))
      let acc = 0
      let count = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          acc +=
            src[Math.min(srcH - 1, Math.max(0, sy)) * srcW + Math.min(srcW - 1, Math.max(0, sx))]
          count += 1
        }
      }
      out[y * dstW + x] = acc / count
    }
  }
  return out
}

/** 顺时针 90° 旋转（解码尝试的扫描方向换挡，见 `DecodeAttempt.quarterTurns`） */
function rotateGray(gray: Float32Array, size: number, quarterTurns: number): Float32Array {
  let current = gray
  for (let turn = 0; turn < quarterTurns; turn++) {
    const out = new Float32Array(size * size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) out[x * size + (size - 1 - y)] = current[y * size + x]
    }
    current = out
  }
  return current
}

/** 灰度 → RGBA（`decodeQrImage` 的输入形状） */
function toRgba(gray: Float32Array, size: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const value = Math.max(0, Math.min(255, Math.round(gray[i])))
    rgba[i * 4] = value
    rgba[i * 4 + 1] = value
    rgba[i * 4 + 2] = value
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

/** 一帧的采样：传感器渲染 → 模糊 → 降采样 → 噪声 */
function captureFrame(
  matrix: { size: number; data: Uint8Array },
  degrade: (typeof DEGRADES)[number],
  shift: number,
  random: () => number,
): { gray: Float32Array; size: number } {
  // 二维码按取景框大小投影到传感器：预览短边 → 传感器短边的缩放比
  const qrSideSensor = (SENSOR_SHORT * FRAME_SIZE) / PREVIEW_WIDTH
  const rendered = renderSensor(matrix, qrSideSensor)
  const blurred = gaussianBlur(rendered.gray, rendered.size, degrade.sigma)
  const ratio = SENSOR_SHORT / WORK_EDGE
  const size = Math.round(rendered.size / ratio)
  const small = boxDown(blurred, rendered.size, rendered.size, size, size, shift, shift)

  const noisy = new Float32Array(small.length)
  for (let i = 0; i < small.length; i++) {
    noisy[i] = Math.max(0, Math.min(255, small[i] + (random() * 2 - 1) * degrade.noise))
  }
  return { gray: noisy, size }
}

/** 按一档尝试的几何重采样 + 旋转，再解码（与运行时 `useQrScanLoop.tryZxing` 等价） */
function decodeAttempt(
  gray: Float32Array,
  size: number,
  attempt: ReturnType<typeof planAttempts>[number],
): string | null {
  const geometry = attemptCapture(attempt.scale, size, size)
  const resampled =
    geometry.dw === size && geometry.sw === size
      ? gray
      : boxDown(
          crop(gray, size, geometry.sx, geometry.sy, geometry.sw, geometry.sh),
          geometry.sw,
          geometry.sh,
          geometry.dw,
          geometry.dh,
        )
  const rotated = rotateGray(resampled, geometry.dw, attempt.quarterTurns)
  return decodeQrImage(
    { data: toRgba(rotated, geometry.dw), width: geometry.dw, height: geometry.dh },
    attempt.tryHarder,
  )
}

/** 取矩形子区（`boxDown` 只做缩放，取样原点在这里处理） */
function crop(
  gray: Float32Array,
  size: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Float32Array {
  const out = new Float32Array(sw * sh)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      out[y * sw + x] = gray[(sy + y) * size + (sx + x)]
    }
  }
  return out
}

/** 百分位（线性插值；数组会就地排序） */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  values.sort((a, b) => a - b)
  const index = Math.min(values.length - 1, Math.max(0, (values.length - 1) * p))
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return values[lower] + (values[upper] - values[lower]) * (index - lower)
}

/**
 * 跑一遍离线基准。
 *
 * 每个样本 = 1 份载荷 × 1 档退化 × 1 组亚像素平移；每个样本模拟
 * `framesPerScan` 帧连续扫描（帧间噪声 / 旋转方向变化），记录首帧与扫描级命中。
 */
export function runDecodeBench(options: BenchOptions = {}): BenchReport {
  const payloadCount = Math.max(1, options.payloadCount ?? 20)
  const framesPerScan = Math.max(1, options.framesPerScan ?? 4)
  const random = mulberry32(options.seed ?? 20261111)

  const payloads = Array.from({ length: payloadCount }, (_, index) => makePayload(random, index))
  const buckets = new Map<string, BenchDegradeBucket>()
  const frameTimes: number[] = []
  const failures: string[] = []
  let samples = 0
  let frameHits = 0
  let scanHits = 0

  for (let index = 0; index < payloads.length; index++) {
    const { text: payload, host } = payloads[index]
    const matrix = qrMatrix(payload)

    for (const degrade of DEGRADES) {
      const key = degrade.label
      const bucket =
        buckets.get(key) ??
        ({
          label: degrade.label,
          sigma: degrade.sigma,
          noise: degrade.noise,
          samples: 0,
          frameHits: 0,
          scanHits: 0,
        } satisfies BenchDegradeBucket)
      buckets.set(key, bucket)

      for (const shift of SHIFTS) {
        samples += 1
        bucket.samples += 1
        let scanHit = false
        let firstFrameHit = false

        for (let frame = 0; frame < framesPerScan && !scanHit; frame++) {
          const { gray, size } = captureFrame(matrix, degrade, shift, random)
          const attempts = planAttempts({ nativeDetector: false }, frame, FRAME_BUDGET_MS)
          const started = performance.now()
          let decoded: string | null = null
          for (const attempt of attempts) {
            decoded = decodeAttempt(gray, size, attempt)
            if (decoded) break
          }
          frameTimes.push(performance.now() - started)
          if (decoded === payload) {
            scanHit = true
            if (frame === 0) firstFrameHit = true
          }
        }

        if (firstFrameHit) {
          frameHits += 1
          bucket.frameHits += 1
        }
        if (scanHit) {
          scanHits += 1
          bucket.scanHits += 1
        } else {
          failures.push(`#${index} host=${host} degrade=${degrade.label} shift=${shift.toFixed(2)}`)
        }
      }
    }
  }

  return {
    payloads: payloadCount,
    samples,
    framesPerScan,
    frameHits,
    scanHits,
    frameHitRate: samples > 0 ? frameHits / samples : 0,
    scanHitRate: samples > 0 ? scanHits / samples : 0,
    p50Ms: percentile(frameTimes, 0.5),
    p95Ms: percentile(frameTimes, 0.95),
    byDegrade: [...buckets.values()],
    failures,
  }
}

/** 报告 → 人读文本（CLI 与测试失败信息共用） */
export function formatBenchReport(report: BenchReport): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`
  const lines = [
    `载荷 ${report.payloads} × 平移 3 × 退化 2 = ${report.samples} 样本，每样本 ${report.framesPerScan} 帧`,
    `帧级（首帧）：${report.frameHits}/${report.samples} = ${percent(report.frameHitRate)}`,
    `扫描级（${report.framesPerScan} 帧内）：${report.scanHits}/${report.samples} = ${percent(report.scanHitRate)}`,
    `单帧解码 p50=${report.p50Ms.toFixed(1)}ms p95=${report.p95Ms.toFixed(1)}ms`,
    ...report.byDegrade.map(
      (bucket) =>
        `  ${bucket.label}（σ=${bucket.sigma}, ±${bucket.noise}）：帧级 ${bucket.frameHits}/${bucket.samples}，扫描级 ${bucket.scanHits}/${bucket.samples}`,
    ),
  ]
  if (report.failures.length > 0) {
    lines.push(`失败样本（${report.failures.length}）：${report.failures.join('；')}`)
  }
  return lines.join('\n')
}
