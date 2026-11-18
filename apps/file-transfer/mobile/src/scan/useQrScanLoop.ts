/**
 * 自建扫码帧循环（票 2026-11-11：替换 html5-qrcode 的相机扫描面）
 * -----------------------------------------------------------------------------
 * 每帧做四件事：
 *
 * 1. 把相机的当前帧画进**工作画布**（短边 = 预览 CSS 短边 × 2，封顶 720）；
 * 2. 按 `./decodeStrategy.planAttempts` 的序列逐档解码（原生 → 全尺寸 → 降采样 →
 *    ROI 放大），每档受单帧总预算约束，命中即停；
 * 3. 未命中 → 递增连续未命中数（回调给面板驱动「慢提示」计时）并按耗时调度下一帧
 *    （正常 10fps，慢帧降 5fps）；
 * 4. 命中 → 停循环（相机流由面板停），把原文交给调用方解析。
 *
 * 换掉 html5-qrcode 相机面而不换解码器：旧库的解码画布只有解码区域的 CSS 像素
 * （v2 载荷 85 模块 → 每模块 2~3px）、且失败回调静默。多尺度 / ROI 重试与「预算内
 * 按序尝试」需要自己控制画布，所以循环也自己起——依赖仍是同一个 ZXing 包。
 *
 * 安全：本模块只吞解码原文（`onResult`），**不记日志**；日志只出现在面板侧，且只记
 * 「解析结论」。二维码含 token / 一次性票据，原文不能进日志（C4）。
 */

import {
  attemptCapture,
  FRAME_BUDGET_MS,
  FRAME_INTERVAL_MS,
  nextFrameDelayMs,
  planAttempts,
  workCanvasEdge,
  type DecodeAttempt,
} from './decodeStrategy'
import { NATIVE_MAX_FAILURES, probeNativeQrDetector, type NativeQrDetector } from './nativeDetector'
import type { LoggerLike } from './types'
import { decodeQrImage, zxingAvailable } from './zxingDecoder'

export interface QrScanLoopOptions {
  logger: LoggerLike
  /** 命中：二维码原文（调用方立即停循环 / 停流 / 解析） */
  onResult: (text: string) => void
  /** 每处理完一帧未命中时回调（驱动「久扫不出」提示计时） */
  onMiss?: () => void
}

export interface QrScanLoop {
  /** 起循环（先探测原生检测器）；重复调用等价于 restart */
  start: (video: HTMLVideoElement) => Promise<void>
  /** 停循环（幂等）；相机流由 `useCameraStream` 单独停 */
  stop: () => void
}

/** 工作画布与 2D 上下文 */
interface Surface {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
}

/** 单帧调度计时源：`performance.now` 在旧 WebView 上可能缺失 */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 建画布并取 2D 上下文（`willReadFrequently`：每帧都要 getImageData，软件渲染更快） */
function createSurface(width: number, height: number): Surface | null {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return ctx ? { canvas, ctx } : null
}

/** 降采样 / ROI 档的输出画布缓存（按尺寸复用，避免每帧重分配） */
const SCRATCH_CACHE_LIMIT = 6

export function useQrScanLoop(options: QrScanLoopOptions): QrScanLoop {
  let running = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let video: HTMLVideoElement | null = null
  let work: Surface | null = null
  const scratch = new Map<string, Surface>()
  let native: NativeQrDetector | null = null
  let nativeFailures = 0
  let misses = 0

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule(delay: number): void {
    if (!running) return
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      void runFrame().catch((error) => {
        options.logger.warn(`[host] qr scan frame failed: ${errText(error)}`)
        schedule(FRAME_INTERVAL_MS)
      })
    }, delay)
  }

  /** 保证工作画布尺寸 = 本帧的取样尺寸（改尺寸会清空画布，所以只在变化时写） */
  function ensureWork(width: number, height: number): Surface | null {
    if (work && work.canvas.width === width && work.canvas.height === height) return work
    work = createSurface(width, height)
    return work
  }

  function scratchFor(width: number, height: number): Surface | null {
    const key = `${width}x${height}`
    const cached = scratch.get(key)
    if (cached) return cached
    const surface = createSurface(width, height)
    if (!surface) return null
    if (scratch.size >= SCRATCH_CACHE_LIMIT) scratch.clear()
    scratch.set(key, surface)
    return surface
  }

  /** 原生检测档：失败累计到阈值就丢弃实例（后续帧只剩 ZXing，不再白等） */
  async function tryNative(): Promise<string | null> {
    const detector = native
    if (!detector || !work) return null
    try {
      const results = await detector.detect(work.canvas)
      nativeFailures = 0
      for (const result of results) {
        if (typeof result.rawValue === 'string' && result.rawValue.length > 0)
          return result.rawValue
      }
      return null
    } catch (error) {
      nativeFailures += 1
      if (nativeFailures >= NATIVE_MAX_FAILURES) {
        options.logger.warn(`[host] qr native detector disabled: ${errText(error)}`)
        native = null
      }
      return null
    }
  }

  /** ZXing 档：按 `attemptCapture` 的几何把工作画布搬进目标尺寸（可带 90° 旋转）再解 */
  function tryZxing(attempt: DecodeAttempt): string | null {
    if (!work) return null
    const source = work.canvas
    const geometry = attemptCapture(attempt.scale, source.width, source.height)
    const turns = attempt.quarterTurns

    // 全尺寸、不旋转：直接读工作画布，省一次 drawImage
    if (
      turns === 0 &&
      geometry.sx === 0 &&
      geometry.sy === 0 &&
      geometry.sw === source.width &&
      geometry.sh === source.height &&
      geometry.dw === source.width &&
      geometry.dh === source.height
    ) {
      return decodeQrImage(work.ctx.getImageData(0, 0, geometry.dw, geometry.dh), attempt.tryHarder)
    }

    // 旋转 90°/270° 时目标画布宽高互换（QR 是方的，不影响解码；取景画布不是方的）
    const outWidth = turns % 2 === 0 ? geometry.dw : geometry.dh
    const outHeight = turns % 2 === 0 ? geometry.dh : geometry.dw
    const target = scratchFor(outWidth, outHeight)
    if (!target) return null
    const ctx = target.ctx
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // 旋转要在 drawImage 之前设好：等价于把取样区域转 90°×turns 再贴满目标画布
    if (turns === 1) {
      ctx.translate(outWidth, 0)
      ctx.rotate(Math.PI / 2)
    } else if (turns === 2) {
      ctx.translate(outWidth, outHeight)
      ctx.rotate(Math.PI)
    } else if (turns === 3) {
      ctx.translate(0, outHeight)
      ctx.rotate(-Math.PI / 2)
    }
    ctx.drawImage(
      source,
      geometry.sx,
      geometry.sy,
      geometry.sw,
      geometry.sh,
      0,
      0,
      geometry.dw,
      geometry.dh,
    )
    ctx.restore()
    return decodeQrImage(ctx.getImageData(0, 0, outWidth, outHeight), attempt.tryHarder)
  }

  async function runFrame(): Promise<void> {
    const element = video
    if (!running || !element) return

    // 相机还没出帧（或面板被隐藏）：等下一拍，不累计未命中（不是「扫不到」）
    if (element.readyState < 2 || element.videoWidth === 0 || element.videoHeight === 0) {
      schedule(FRAME_INTERVAL_MS)
      return
    }

    const cssShort = Math.min(
      element.clientWidth || element.videoWidth,
      element.clientHeight || element.videoHeight,
    )
    const edge = workCanvasEdge(cssShort)
    const aspect = element.videoWidth / element.videoHeight
    const width = aspect >= 1 ? edge : Math.max(1, Math.round(edge * aspect))
    const height = aspect >= 1 ? Math.max(1, Math.round(edge / aspect)) : edge

    const surface = ensureWork(width, height)
    if (!surface) {
      // 2D 上下文都拿不到（极端 WebView）：循环没有意义，停掉并由面板提示
      running = false
      options.logger.warn('[host] qr scan stopped: 2d context unavailable')
      return
    }
    surface.ctx.drawImage(element, 0, 0, width, height)

    const started = now()
    const attempts = planAttempts({ nativeDetector: native !== null }, misses, FRAME_BUDGET_MS)
    let hit: string | null = null
    let hitTier = -1
    for (let tier = 0; tier < attempts.length; tier++) {
      if (!running) return
      if (now() - started > FRAME_BUDGET_MS) break
      const attempt = attempts[tier]
      hit = attempt.kind === 'native' ? await tryNative() : tryZxing(attempt)
      if (hit) {
        hitTier = tier
        break
      }
    }

    const cost = now() - started
    if (!running) return

    if (hit) {
      running = false
      clearTimer()
      // 真机排障用（spec §6.4「日志里能看到多尺度重试命中」）：只记档位 / 尺度 / 方向 /
      // 耗时，不落原文（二维码含 token 与一次性票据，C4）
      const winning = attempts[hitTier]
      options.logger.info?.(
        `[host] qr decoded: tier=${hitTier} kind=${winning.kind} scale=${winning.scale} turn=${winning.quarterTurns} cost=${Math.round(cost)}ms`,
      )
      options.onResult(hit)
      return
    }

    misses += 1
    options.onMiss?.()
    schedule(nextFrameDelayMs(cost))
  }

  async function start(element: HTMLVideoElement): Promise<void> {
    stop()
    video = element
    misses = 0
    nativeFailures = 0
    running = true
    if (!zxingAvailable) {
      // 包形状变了（升级 html5-qrcode 会踩）：显性记一条，界面仍可走原生 / 相册
      options.logger.warn('[host] qr zxing decoder unavailable: bundle shape changed')
    }
    const detector = await probeNativeQrDetector()
    if (!running) return
    native = detector
    // 真机验收要记录「这台机器到底有没有可用的原生检测器」（spec §6.4）：
    // 无 GMS 机型 / 不支持的 WebView 只是少了原生加速，回退路径照跑
    options.logger.info?.(
      detector
        ? '[host] qr native detector ready'
        : '[host] qr native detector unavailable; zxing only',
    )
    schedule(0)
  }

  function stop(): void {
    running = false
    clearTimer()
    video = null
    native = null
    nativeFailures = 0
    misses = 0
  }

  return { start, stop }
}
