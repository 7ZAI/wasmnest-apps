/**
 * 扫码解码策略（纯函数层，票 2026-11-11：ZXing 回退路径可靠性）
 * -----------------------------------------------------------------------------
 * 为什么需要策略层：html5-qrcode 内置 ZXing 在「数据区里有假 finder 图案」时会估出
 * 错误维度（上游 zxing#897 / html5-qrcode#380、#726），触发条件是**载荷 + mask +
 * 每模块像素**的组合。同一份载荷换 mask 就恢复；同一张图换模块尺寸（缩放到别的
 * 尺度）也可能恢复。所以每帧不能只解一次：按代价升序给若干档，命中即停。
 *
 * 本模块只做**计划**（给定能力 / 连续未命中数 / 预算，产出尝试序列），不碰 DOM、
 * 不解码，便于单测锁定「预算裁剪」与「原生优先」两条不变量。
 *
 * 与运行时的对应关系见 `./useQrScanLoop`：它按本模块产出的序列逐档执行，
 * `scale` 交给 `attemptCapture` 换成画布裁剪 / 缩放参数。
 */

/** 解码能力快照（每帧取一次；原生检测器被探测 / 连续失败降级后随之变化） */
export interface DecodeCapabilities {
  /** 启动探测通过的 BarcodeDetector（探测见 `./nativeDetector`） */
  nativeDetector: boolean
}

/** 单档解码尝试 */
export interface DecodeAttempt {
  kind: 'native' | 'zxing'
  /**
   * 相对工作画布的缩放；1 = 全尺寸。
   *
   * `> 1` 表示**中心 ROI 裁剪后放大**（视野缩小到取景框那一块），语义见
   * `attemptCapture`：远距离小码兜底档，不是简单的整体放大。
   */
  scale: number
  /**
   * 图像顺时针旋转的 90° 次数（0~3，仅 zxing 档）。
   *
   * 为什么需要：ZXing 的 finder 是**按行/列扫描**找 1:1:3:1:1 图案的，数据区里的
   * 假 finder 图案（zxing#897）在某个扫描方向下才会凑齐比例。实测同一帧转 90° 后
   * 假中心常常不再成立、真 finder 仍成立（同一「小码 + 失焦」退化语料，连续扫描
   * 命中 80% → 92%）。转 0/180 与 90/270 两两相似但不相同，四档都留。
   */
  quarterTurns: 0 | 1 | 2 | 3
  /** ZXing`TRY_HARDER`（原生档无此概念，恒 false） */
  tryHarder: boolean
  /** 本档时间预算（ms）：既是名义上限，也参与整帧预算裁剪 */
  budgetMs: number
}

/** 单帧总预算（ms）：超出后本帧不再加档，剩余档下一帧再说（不积压） */
export const FRAME_BUDGET_MS = 60

/** 单档预算下限（ms）：低于它的档不值得起一次解码（含 getImageData） */
export const MIN_ATTEMPT_BUDGET_MS = 15

/** 追加 ROI 放大档所需的连续未命中帧数（10fps ≈ 3s） */
export const ROI_MISS_THRESHOLD = 30

/** ROI 档的缩放：中心 1/1.4 短边的正方形裁剪，再放大回来 */
export const ROI_SCALE = 1.4

/** 工作画布短边上限（设备像素）：相机细节够用，再大只会平摊 CPU */
export const MAX_DECODE_EDGE = 720

/** 采样间隔：正常 10fps */
export const FRAME_INTERVAL_MS = 100

/** 采样间隔：单帧耗时超阈值时降到 5fps（避免降级档拖垮帧率 / 发热） */
export const SLOW_FRAME_INTERVAL_MS = 200

/** 判定「慢帧」的单帧耗时阈值（ms） */
export const SLOW_FRAME_THRESHOLD_MS = 120

/** 原生检测档名义预算：BarcodeDetector 正常在 10ms 量级 */
const NATIVE_BUDGET_MS = 15

/** 全尺寸 + TRY_HARDER：最可能命中的一档，预算给足 */
const FULL_SCALE_BUDGET_MS = 25

/** 降采样档预算（0.66× / 0.45×） */
const DOWNSCALE_BUDGET_MS = 15

/** ROI 放大档预算 */
const ROI_BUDGET_MS = 15

/** 降采样档的尺度（模块尺寸换挡，绕开假 finder 的像素组合） */
const DOWNSCALE_STEPS = [0.66, 0.45] as const

/**
 * 产出本帧的尝试序列（按代价升序）。
 *
 * 不变量：
 * - 序列非空；
 * - 原生可用 → 第一档必须是 native；
 * - 预算裁剪按序取，单档 ≥ `MIN_ATTEMPT_BUDGET_MS`，总和 ≤ `budgetMs`
 *   （唯一例外：`budgetMs` 本身小于下限时也要给一档，否则整帧无事可做）；
 * - 连续未命中 ≥ `ROI_MISS_THRESHOLD` 才追加 ROI 放大档，且它排在 0.45× 之前——
 *   否则 60ms 预算被前两档占满后它会永远被裁掉（见下）；
 * - 序列里最多一个 native 档（它已是第一档）；
 * - zxing 档的 `quarterTurns` 随 `consecutiveMisses` 轮换（四方向覆盖）。
 *
 * @param caps 能力快照（原生检测器是否可用）
 * @param consecutiveMisses 连续未命中帧数（命中 / 扫码重启即归零）
 * @param budgetMs 单帧预算；缺省 `FRAME_BUDGET_MS`
 */
export function planAttempts(
  caps: DecodeCapabilities,
  consecutiveMisses: number,
  budgetMs: number = FRAME_BUDGET_MS,
): DecodeAttempt[] {
  const misses =
    Number.isFinite(consecutiveMisses) && consecutiveMisses > 0 ? Math.floor(consecutiveMisses) : 0
  // 旋转档按未命中帧数轮换：同一帧只跑 2~3 档，四帧内（10fps ≈ 0.4s）把四个扫描方向
  // 都覆盖一遍，不额外吃单帧预算。
  const turn = (offset: number): 0 | 1 | 2 | 3 =>
    ((((misses + offset) % 4) + 4) % 4) as 0 | 1 | 2 | 3

  const candidates: DecodeAttempt[] = []
  if (caps.nativeDetector) {
    candidates.push({
      kind: 'native',
      scale: 1,
      quarterTurns: 0,
      tryHarder: false,
      budgetMs: NATIVE_BUDGET_MS,
    })
  }
  candidates.push({
    kind: 'zxing',
    scale: 1,
    quarterTurns: turn(0),
    tryHarder: true,
    budgetMs: FULL_SCALE_BUDGET_MS,
  })
  candidates.push({
    kind: 'zxing',
    scale: DOWNSCALE_STEPS[0],
    quarterTurns: turn(2),
    tryHarder: true,
    budgetMs: DOWNSCALE_BUDGET_MS,
  })
  // ROI 档与 0.45× 档的取舍：两者都是「降级兜底」，但 ROI 只在久扫不出时才出现，
  // 而 0.45× 在正常预算里已经跑了几十帧——所以 ROI 就绪时优先它。
  const roiReady = misses >= ROI_MISS_THRESHOLD
  if (roiReady) {
    candidates.push({
      kind: 'zxing',
      scale: ROI_SCALE,
      quarterTurns: turn(1),
      tryHarder: true,
      budgetMs: ROI_BUDGET_MS,
    })
  }
  candidates.push({
    kind: 'zxing',
    scale: DOWNSCALE_STEPS[1],
    quarterTurns: turn(3),
    tryHarder: true,
    budgetMs: DOWNSCALE_BUDGET_MS,
  })

  const limit = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : FRAME_BUDGET_MS
  const attempts: DecodeAttempt[] = []
  let used = 0
  for (const candidate of candidates) {
    const remaining = limit - used
    if (remaining < MIN_ATTEMPT_BUDGET_MS) break
    attempts.push({ ...candidate, budgetMs: Math.min(candidate.budgetMs, remaining) })
    used += Math.min(candidate.budgetMs, remaining)
  }
  // 预算小于单档下限（异常场景 / 调用方显式压预算）：仍给第一档，预算按剩余值封顶
  if (attempts.length === 0) {
    const first = candidates[0]
    attempts.push({ ...first, budgetMs: limit })
  }
  return attempts
}

/** 一档尝试在源画布上的取样矩形与输出尺寸（设备像素） */
export interface CaptureGeometry {
  /** 源画布取样原点（x） */
  sx: number
  /** 源画布取样原点（y） */
  sy: number
  /** 源画布取样宽 */
  sw: number
  /** 源画布取样高 */
  sh: number
  /** 输出画布宽 */
  dw: number
  /** 输出画布高 */
  dh: number
}

/**
 * 把 `scale` 换成具体的画布取样 / 缩放参数。
 *
 * - `scale === 1`：整帧原样；
 * - `scale < 1`：整帧缩到 `scale`（模块尺寸换挡；`drawImage` 默认区域平均）；
 * - `scale > 1`：取中心正方形（短边 ÷ scale）**放大**到原短边尺寸——即「ROI 放大」，
 *   视野缩小到取景框那一块，让远距离小码的模块占到更多像素。输出不超过
 *   `MAX_DECODE_EDGE`，且绝不小于取样区域（不丢信息）。
 */
export function attemptCapture(scale: number, width: number, height: number): CaptureGeometry {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) {
    return { sx: 0, sy: 0, sw: w, sh: h, dw: w, dh: h }
  }
  if (scale < 1) {
    return {
      sx: 0,
      sy: 0,
      sw: w,
      sh: h,
      dw: Math.max(1, Math.round(w * scale)),
      dh: Math.max(1, Math.round(h * scale)),
    }
  }
  const side = Math.max(1, Math.round(Math.min(w, h) / scale))
  const out = Math.max(side, Math.min(Math.round(side * scale), MAX_DECODE_EDGE))
  return {
    sx: Math.max(0, Math.round((w - side) / 2)),
    sy: Math.max(0, Math.round((h - side) / 2)),
    sw: side,
    sh: side,
    dw: out,
    dh: out,
  }
}

/**
 * 工作画布短边（设备像素）：相机预览 CSS 短边 × 2，封顶 `MAX_DECODE_EDGE`。
 *
 * 不用 CSS px 当解码分辨率上限：html5-qrcode 旧实现直接拿解码区域的 CSS 尺寸当画布
 * 尺寸（v2 载荷 85 模块 → 每模块 2~3px），相机细节被白白丢掉；这里保留 2 倍再交给
 * 策略降采样，等于把「换挡」的主动权拿回本域。
 */
export function workCanvasEdge(cssShortEdge: number): number {
  const css = Number.isFinite(cssShortEdge) && cssShortEdge > 0 ? cssShortEdge : 0
  // 预览尺寸还测不出来（布局未完成）时给个下限，避免 0 宽画布
  return Math.min(MAX_DECODE_EDGE, Math.max(240, Math.round(css * 2)))
}

/**
 * 下一帧的调度间隔：单帧耗时超过 `SLOW_FRAME_THRESHOLD_MS` 就从 10fps 降到 5fps。
 *
 * 降级档（多尺度 / ROI）只在失败帧里跑，慢帧说明这一帧已经把预算吃满；继续 10fps
 * 只会让解码队列排队，反而降低有效采样率。
 */
export function nextFrameDelayMs(frameCostMs: number): number {
  return frameCostMs > SLOW_FRAME_THRESHOLD_MS ? SLOW_FRAME_INTERVAL_MS : FRAME_INTERVAL_MS
}
