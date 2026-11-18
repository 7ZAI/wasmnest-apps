/**
 * 原生 `BarcodeDetector` 探测与降级（票 2026-11-11）
 * -----------------------------------------------------------------------------
 * 为什么不能只看 `typeof BarcodeDetector`：Android WebView 从 83 起暴露该 API，但
 * 实际检测依赖 Google Play Services（Chromium 提交：无 GMSCore 时 `detect()` 报
 * unsupported）。**构造函数存在 ≠ 能用**——无 GMS 的国产 ROM / AOSP 上它就是一个
 * 每帧必然失败的壳，而它排在尝试序列第一档，不探测就会白等。
 *
 * 探测口径：构造一次 + 对 32×32 空画布真实调一次 `detect()`。
 * - 抛错（非 `NotFoundError`）→ 判定不可用，本会话不再尝试原生；
 * - 返回数组（含空数组）/ `NotFoundError` → 可用（空数组 = 没检测到条码，属正常）。
 *
 * 运行期再兜一层：`detect()` 连续失败 `NATIVE_MAX_FAILURES` 次 → 调用方丢弃实例
 * （`useQrScanLoop` 里实现），避免设备在中途掉能力后长期卡在第一档。
 */

/** 原生检测结果的最小形状（真 API 还带 cornerPoints / boundingBox，本域不用） */
export interface NativeQrResult {
  rawValue?: string
}

/** 检测器实例（`BarcodeDetector` 的最小子集） */
export interface NativeQrDetector {
  detect(source: CanvasImageSource): Promise<ReadonlyArray<NativeQrResult>>
}

/** `detect()` 连续失败多少次后放弃原生路径（约 2 帧） */
export const NATIVE_MAX_FAILURES = 2

/** 只认二维码：本应用不扫一维码 / 其他码制 */
const QR_FORMAT = 'qr_code'

/** 探测画布边长（像素）：只要能让实现走完一次真实检测即可 */
const PROBE_SIZE = 32

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeQrDetector
  getSupportedFormats?: () => Promise<string[]>
}

/** 取全局构造器；不存在 / 非函数 → null */
function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector
  return typeof ctor === 'function' ? (ctor as BarcodeDetectorCtor) : null
}

/**
 * 探测原生二维码检测器。
 *
 * @returns 可用则返回实例；不可用（无 API / 不支持 qr_code / `detect()` 抛错 /
 *          无 DOM 环境）返回 null。**永不抛错**：原生只是加速与精度兜底，
 *          不可用时退回 ZXing 多尺度路径。
 */
export async function probeNativeQrDetector(): Promise<NativeQrDetector | null> {
  const ctor = detectorCtor()
  if (!ctor || typeof document === 'undefined') return null

  // 先问支持的码制：老 Chromium 的 BarcodeDetector 不认 qr_code 时会构造成功但恒空
  if (typeof ctor.getSupportedFormats === 'function') {
    try {
      const formats = await ctor.getSupportedFormats()
      if (Array.isArray(formats) && formats.length > 0 && !formats.includes(QR_FORMAT)) return null
    } catch {
      // 查询失败不代表检测不可用，继续往下探真实 detect()
    }
  }

  let detector: NativeQrDetector
  try {
    detector = new ctor({ formats: [QR_FORMAT] })
  } catch {
    return null
  }

  const probe = document.createElement('canvas')
  probe.width = PROBE_SIZE
  probe.height = PROBE_SIZE
  try {
    await detector.detect(probe)
  } catch (error) {
    // 部分实现「没检测到」用 NotFoundError 表达，那不是能力缺失
    const name = error instanceof Error ? error.name : ''
    if (name !== 'NotFoundError') return null
  }
  return detector
}
