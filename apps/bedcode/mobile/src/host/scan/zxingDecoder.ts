/**
 * ZXing 解码适配层（票 2026-11-11：扫码回退路径）
 * -----------------------------------------------------------------------------
 * 用 html5-qrcode 随包分发的 zxing-js（`third_party/zxing-js.umd.js`）直接解
 * `ImageData`，**不经过 html5-qrcode 的相机循环**：
 *
 * - 旧路径把解码画布钉成解码区域的 CSS 像素（250px `qrbox`），且只解全尺寸一次；
 *   本层由 `./useQrScanLoop` 喂任意尺度的画布，同一包可跑多尺度 / ROI 重试；
 * - 用 `RGBLuminanceSource` 而不是 `HTMLCanvasElementLuminanceSource`：前者吃纯
 *   亮度数组，解码可离线评测（Node 里没有 2D canvas），线上只多一次
 *   `getImageData → 灰度`的循环，与库内实现等价。
 *
 * 例外一律按「没解出」返回 null（ZXing 的 `NotFoundException` 是每帧常态），
 * 不在这里记日志：热路径 10fps，噪声交给调用方按档位计数。
 *
 * 该包与 `html5-qrcode` 主包共用同一份 UMD（主包的 `zxing-html5-qrcode-decoder`
 * 就是从 `../third_party/zxing-js.umd` import 的），因此不引入新依赖、不增量
 * 打包体积；相册路径继续用 html5-qrcode 的 `scanFile`。
 */
import * as ZXingBundle from 'html5-qrcode/third_party/zxing-js.umd.js'

/** 解码输入：`ImageData` 的最小子集（RGBA，行优先） */
export interface QrImage {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

interface ZxingReader {
  decode(bitmap: unknown, hints: Map<number, unknown>): { text?: string }
}

interface ZxingApi {
  RGBLuminanceSource: new (luminances: Uint8ClampedArray, width: number, height: number) => unknown
  HybridBinarizer: new (source: unknown) => unknown
  BinaryBitmap: new (binarizer: unknown) => unknown
  MultiFormatReader: new (verbose: boolean, hints: Map<number, unknown>) => ZxingReader
  DecodeHintType: { POSSIBLE_FORMATS: number; TRY_HARDER: number }
  BarcodeFormat: { QR_CODE: number }
}

/**
 * 取 UMD 包：Vite（ESM interop）下类挂在 `default` 上，Node 直接 import 时挂在
 * 命名空间上——两种形状都认。缺类说明包形状变了（升级 html5-qrcode 会踩），
 * 显性失败一次，由 `zxingAvailable` 暴露给调用方记一条日志。
 */
function loadZxing(): ZxingApi | null {
  const raw = ZXingBundle as unknown as Record<string, unknown>
  const candidate = (raw.RGBLuminanceSource
    ? raw
    : (raw.default as Record<string, unknown>)) as unknown as ZxingApi | undefined
  if (!candidate) return null
  for (const key of [
    'RGBLuminanceSource',
    'HybridBinarizer',
    'BinaryBitmap',
    'MultiFormatReader',
  ]) {
    if (typeof (candidate as unknown as Record<string, unknown>)[key] !== 'function') return null
  }
  return candidate
}

const ZXING = loadZxing()

/** 包是否可用（不可用时 `decodeQrImage` 恒返回 null；调用方据此记一条告警） */
export const zxingAvailable = ZXING !== null

/** 提示表按 `tryHarder` 缓存两份（每帧重建 Map 是纯浪费） */
const hintCache = new Map<boolean, Map<number, unknown>>()

function hintsFor(tryHarder: boolean): Map<number, unknown> {
  const cached = hintCache.get(tryHarder)
  if (cached) return cached
  const hints = new Map<number, unknown>()
  hints.set(ZXING!.DecodeHintType.POSSIBLE_FORMATS, [ZXING!.BarcodeFormat.QR_CODE])
  // TRY_HARDER 让 detector 在整帧里多扫几行/列找 finder：对远距离小码与假 finder
  // 引起的漏检都有帮助，代价是单帧耗时上升（预算由策略层控制）
  if (tryHarder) hints.set(ZXING!.DecodeHintType.TRY_HARDER, true)
  hintCache.set(tryHarder, hints)
  return hints
}

/**
 * 解一张 RGBA 位图里的二维码。
 *
 * @param image 位图（`ImageData` 或 bench 里手工构造的同形对象）
 * @param tryHarder 是否开 ZXing `TRY_HARDER`
 * @returns 二维码原文；未识别 / 解码器异常 / 包不可用 → null
 */
export function decodeQrImage(image: QrImage, tryHarder = true): string | null {
  const api = ZXING
  if (!api) return null
  const { data, width, height } = image
  const pixels = width * height
  if (width <= 0 || height <= 0 || data.length < pixels * 4) return null

  // 亮度：BT.601 的整数近似（绿权重 2，红蓝各 1），与 zxing-js 内部同口径
  const luminance = new Uint8ClampedArray(pixels)
  for (let i = 0, offset = 0; i < pixels; i++, offset += 4) {
    luminance[i] = (data[offset] + 2 * data[offset + 1] + data[offset + 2]) >> 2
  }

  const hints = hintsFor(tryHarder)
  try {
    const source = new api.RGBLuminanceSource(luminance, width, height)
    const bitmap = new api.BinaryBitmap(new api.HybridBinarizer(source))
    const text = new api.MultiFormatReader(false, hints).decode(bitmap, hints).text
    return typeof text === 'string' && text.length > 0 ? text : null
  } catch {
    // NotFoundException（绝大多数帧）/ 版本估错 / 图像太糊：都按「本档没解出」
    return null
  }
}
