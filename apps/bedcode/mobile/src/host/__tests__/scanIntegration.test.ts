/**
 * 跨端集成：桌面生成的二维码 → 移动端扫码解码
 * -----------------------------------------------------------------------------
 * 2026-11-11 回归锁。用户现象：手机对着桌面二维码没有任何反应。两点可测缺陷：
 *
 *  1. 桌面把 v2 载荷画在 192px 画布上——v2 是 85~93 模块，每模块只剩 ~2.2px；
 *  2. 移动端 `qrbox` 把**解码画布**压到 250px，且相对 video 元素居中而非可见取景框，
 *     取景框对得再准也可能被裁掉一半，而解码失败回调按设计是空操作 → 界面零反馈。
 *
 * 本用例把两端真实代码接起来，证明「桌面画出来的那张图，手机取景后能读出原载荷」：
 *
 * ```text
 * 桌面 pairingPayload.buildQrPayload   → 真实 v3 载荷（LAN + relay 拨号前缀 + 64 hex 票据）
 * 桌面 qrRender.qrMatrix/planQrCanvas  → 与线上画布同参数、同几何的位图（像素级一致）
 *      ↓ 缩放到手机取景框里的大小（取景框尺寸由移动端 scanViewport 决定）
 * 模块采样（模拟扫码器读模块）          → 与桌面矩阵逐模块比对
 * ZXing（html5-qrcode 内置）解矩阵       → 格式信息 / 纠错 / 载荷
 * 移动 qr.parseQrText                  → 还原成扫码结果载荷（含 peer）
 * ```
 *
 * ## 判据为什么拆两层
 *
 * 1. **模块可分辨**（主判据）：按模块网格采样取景位图，逐模块与桌面原始矩阵比对，
 *    必须 0 个模块读错。扫码器的工作归根结底就是读模块；读不出来时换任何检测器
 *    都救不了。
 * 2. **载荷可还原**：采样矩阵按整数像素重画后用 html5-qrcode 内置 ZXing
 *    （`third_party/zxing-js.umd`，与运行时同一个包）解码，再交给 `parseQrText`。
 *
 * 不直接拿 ZXing 的相机检测器当判据（**单发**）：该版本 finder 定位在人工合成的高锐度大
 * 模块图上会锁到数据区里的假 finder 图案（`getProvisionalVersionForDimension` 拿到 53/57
 * 这类错维度，随 mask 随机失败）——上游已知问题（zxing#897 假中心、html5-qrcode#380/#726
 * 大码与高密码）。本文件同时锁住「生产的多档重试 + 旋转轮换」（见
 * `should_decodeThroughStrategySequence_when_nativeDetectorUnavailable`）：单发不稳，
 * 但「换尺度 + 换扫描方向」的序列必须稳定命中。
 *
 * 刻意**跨端引用桌面模块**：这张图必须由桌面侧真实代码生成，各写一份就测不到契约。
 */
import { describe, expect, it } from 'vitest'
import * as ZXingBundle from 'html5-qrcode/third_party/zxing-js.umd.js'

import { buildQrPayload, type PairingPeerInfo } from '../../../../desktop/src/utils/pairingPayload'
import {
  planQrCanvas,
  qrMatrix,
  QR_QUIET_ZONE_MODULES,
  type QrMatrix,
} from '../../../../desktop/src/utils/qrRender'
import { parseQrText } from '../qr'
import { scanFrameSize } from '../scanViewport'
import {
  attemptCapture,
  FRAME_BUDGET_MS,
  planAttempts,
  type DecodeAttempt,
} from '../scan/decodeStrategy'
import { decodeQrImage } from '../scan/zxingDecoder'

// ==================== 运行时解码库（html5-qrcode 内置 ZXing） ====================

interface ZxingReader {
  decode(bitmap: unknown, hints: Map<number, unknown>): { text: string }
}

interface ZxingModule {
  HTMLCanvasElementLuminanceSource: new (canvas: unknown) => unknown
  HybridBinarizer: new (source: unknown) => unknown
  BinaryBitmap: new (binarizer: unknown) => unknown
  MultiFormatReader: new (verbose: boolean, hints: Map<number, unknown>) => ZxingReader
  DecodeHintType: { POSSIBLE_FORMATS: number; PURE_BARCODE: number }
  BarcodeFormat: { QR_CODE: number }
}

/** UMD 包在 Vite SSR 转换下可能挂在 `default` 上；两种形状都认，缺类则显性失败 */
function loadZxing(): ZxingModule {
  const raw = ZXingBundle as unknown as Record<string, unknown>
  const candidate = (raw.HTMLCanvasElementLuminanceSource
    ? raw
    : (raw.default as Record<string, unknown>)) as unknown as ZxingModule
  for (const key of [
    'HTMLCanvasElementLuminanceSource',
    'HybridBinarizer',
    'BinaryBitmap',
    'MultiFormatReader',
  ]) {
    if (typeof (candidate as unknown as Record<string, unknown>)[key] !== 'function') {
      throw new Error(`html5-qrcode 内置 ZXing 包形状变了：缺少 ${key}`)
    }
  }
  return candidate
}

const ZXing = loadZxing()

/** 用运行时同一个 ZXing 包解一张「模块对齐」的二维码位图 */
function decodeAlignedQr(rgba: Uint8ClampedArray, size: number): string | null {
  const canvas = {
    width: size,
    height: size,
    getContext: () => ({ getImageData: () => ({ data: rgba, width: size, height: size }) }),
  }
  const hints = new Map<number, unknown>()
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.QR_CODE])
  hints.set(ZXing.DecodeHintType.PURE_BARCODE, true)
  const reader = new ZXing.MultiFormatReader(false, hints)
  const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas)
  const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source))
  try {
    return reader.decode(bitmap, hints).text
  } catch {
    return null
  }
}

// ==================== 位图工具 ====================

/** 把 QR 矩阵按整数 cell 画成 RGBA（与 `qrcode` 的 canvas 渲染器逐像素等价） */
function rasterize(
  matrix: QrMatrix,
  cell: number,
  marginModules = QR_QUIET_ZONE_MODULES,
): { size: number; rgba: Uint8ClampedArray } {
  const size = (matrix.size + marginModules * 2) * cell
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.data[y * matrix.size + x]) continue
      const px0 = (marginModules + x) * cell
      const py0 = (marginModules + y) * cell
      for (let dy = 0; dy < cell; dy++) {
        for (let dx = 0; dx < cell; dx++) {
          const offset = ((py0 + dy) * size + px0 + dx) * 4
          rgba[offset] = 0
          rgba[offset + 1] = 0
          rgba[offset + 2] = 0
        }
      }
    }
  }
  return { size, rgba }
}

/** 盒式重采样：相机把二维码投到 sensor、浏览器再把画面降采样到解码画布，都是区域平均 */
function boxResample(src: Uint8ClampedArray, srcSize: number, dstSize: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstSize * dstSize * 4)
  for (let y = 0; y < dstSize; y++) {
    const y0 = Math.floor((y * srcSize) / dstSize)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcSize) / dstSize))
    for (let x = 0; x < dstSize; x++) {
      const x0 = Math.floor((x * srcSize) / dstSize)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcSize) / dstSize))
      let sum = 0
      let count = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          sum += src[(sy * srcSize + sx) * 4]
          count += 1
        }
      }
      const value = Math.round(sum / count)
      const offset = (dstSize * y + x) * 4
      out[offset] = value
      out[offset + 1] = value
      out[offset + 2] = value
      out[offset + 3] = 255
    }
  }
  return out
}

// ==================== 手机取景（模拟相机） ====================

/** 典型 1080p 手机竖屏的 CSS 尺寸；新版解码区域 = 整个预览，故预览即解码画布 */
const PREVIEW_WIDTH = 390
const PREVIEW_HEIGHT = 520

interface Capture {
  /** 取景框边长（CSS px，= 二维码在解码画布里的目标尺寸） */
  frame: number
  /** 二维码在解码画布里的每模块像素（判据；与绝对尺寸无关） */
  pxPerModule: number
  width: number
  height: number
  rgba: Uint8ClampedArray
  /** 二维码左上角（含静区）在画布中的整数像素偏移 */
  originX: number
  originY: number
}

/**
 * 模拟手机取景：用户把二维码卡进取景框（桌面画布缩放到 `frameSize`），
 * 居中贴进预览画布——解码区域就是整块预览（新版不再传 `qrbox`）。
 */
function simulatePhoneCapture(qr: {
  size: number
  modules: number
  rgba: Uint8ClampedArray
}): Capture {
  const frame = scanFrameSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, PREVIEW_HEIGHT)
  const scaled = boxResample(qr.rgba, qr.size, frame)

  const originX = Math.round((PREVIEW_WIDTH - frame) / 2)
  const originY = Math.round((PREVIEW_HEIGHT - frame) / 2)
  const preview = new Uint8ClampedArray(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4).fill(255)
  for (let y = 0; y < frame; y++) {
    const srcStart = y * frame * 4
    preview.set(
      scaled.subarray(srcStart, srcStart + frame * 4),
      ((originY + y) * PREVIEW_WIDTH + originX) * 4,
    )
  }

  return {
    frame,
    pxPerModule: frame / (qr.modules + QR_QUIET_ZONE_MODULES * 2),
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    rgba: preview,
    originX,
    originY,
  }
}

/**
 * 按模块网格采样取景位图（每模块取中心邻域的均值），返回与桌面矩阵**逐模块比对**
 * 的错误数——这一步等价于扫码器把模块读出来。
 */
function countModuleErrors(capture: Capture, matrix: QrMatrix): number {
  const total = matrix.size + QR_QUIET_ZONE_MODULES * 2
  const modulePx = capture.frame / total
  const originX = capture.originX + QR_QUIET_ZONE_MODULES * modulePx
  const originY = capture.originY + QR_QUIET_ZONE_MODULES * modulePx

  let mismatches = 0
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      // 模块中心 ±0（整数取样）+ 2×2 均值：相机采样点落在模块中心是最有利情形，
      // 连中心都读错就说明模块边界已经被糊成一团。
      const cx = Math.round(originX + (x + 0.5) * modulePx)
      const cy = Math.round(originY + (y + 0.5) * modulePx)
      let sum = 0
      let count = 0
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const px = cx + dx
        const py = cy + dy
        if (px < 0 || py < 0 || px >= capture.width || py >= capture.height) continue
        sum += capture.rgba[(py * capture.width + px) * 4]
        count += 1
      }
      const dark = sum / count < 128
      if (dark !== Boolean(matrix.data[y * matrix.size + x])) mismatches += 1
    }
  }
  return mismatches
}

// ==================== 策略序列（生产解码路径） ====================

/** 任意尺寸的 RGBA 区域重采样（区域平均 = 相机降采样 / 策略缩放同一模型） */
function resampleRegion(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    const ry0 = Math.floor((y * sh) / dstH)
    const py0 = sy + ry0
    const py1 = sy + Math.max(ry0 + 1, Math.floor(((y + 1) * sh) / dstH))
    for (let x = 0; x < dstW; x++) {
      const rx0 = Math.floor((x * sw) / dstW)
      const px0 = sx + rx0
      const px1 = sx + Math.max(rx0 + 1, Math.floor(((x + 1) * sw) / dstW))
      let sum = 0
      let count = 0
      for (let py = py0; py < py1; py++) {
        for (let px = px0; px < px1; px++) {
          if (px < 0 || py < 0 || px >= srcW || py >= srcH) continue
          sum += src[(py * srcW + px) * 4]
          count += 1
        }
      }
      const value = count > 0 ? Math.round(sum / count) : 255
      const offset = (y * dstW + x) * 4
      out[offset] = value
      out[offset + 1] = value
      out[offset + 2] = value
      out[offset + 3] = 255
    }
  }
  return out
}

/** 顺时针 90° × `turns`（与 `useQrScanLoop.tryZxing` 的 canvas 旋转等价） */
function rotateRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  turns: number,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  let current = { rgba, width, height }
  for (let turn = 0; turn < turns; turn++) {
    const out = new Uint8ClampedArray(current.width * current.height * 4)
    for (let y = 0; y < current.height; y++) {
      for (let x = 0; x < current.width; x++) {
        const from = (y * current.width + x) * 4
        const to = (x * current.height + (current.height - 1 - y)) * 4
        out[to] = current.rgba[from]
        out[to + 1] = current.rgba[from + 1]
        out[to + 2] = current.rgba[from + 2]
        out[to + 3] = 255
      }
    }
    current = { rgba: out, width: current.height, height: current.width }
  }
  return current
}

/** 按一档尝试的几何（缩放 / ROI / 旋转）生成位图 */
function attemptImage(
  capture: Capture,
  attempt: DecodeAttempt,
): { data: Uint8ClampedArray; width: number; height: number } {
  const geometry = attemptCapture(attempt.scale, capture.width, capture.height)
  const resampled = resampleRegion(
    capture.rgba,
    capture.width,
    capture.height,
    geometry.sx,
    geometry.sy,
    geometry.sw,
    geometry.sh,
    geometry.dw,
    geometry.dh,
  )
  const rotated = rotateRgba(resampled, geometry.dw, geometry.dh, attempt.quarterTurns)
  return { data: rotated.rgba, width: rotated.width, height: rotated.height }
}

/** 跑一帧的生产尝试序列（无原生检测器 = 无 GMS 机型的回退路径） */
function decodeWithStrategy(capture: Capture, frameIndex = 0): string | null {
  for (const attempt of planAttempts({ nativeDetector: false }, frameIndex, FRAME_BUDGET_MS)) {
    const text = decodeQrImage(attemptImage(capture, attempt), attempt.tryHarder)
    if (text) return text
  }
  return null
}

// ==================== 载荷（宿主 status 的真实形状） ====================

const NODE_ID = '12D3KooWBSCkgKRqQWpPhGGC61TfEWno22bcEGXxQvohhPbQBkud'
const RELAY_ID = '12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H'
const TOKEN = '9c1f'.repeat(8) // 16 字节 hex（认证中心 QrToken）
const TICKET = 'f3a1'.repeat(16) // 32 字节 hex（宿主 issue-pairing-ticket）

/** LAN + relay 两条地址（宿主 `status.node.addrs` 的真实形状） */
const PEER: PairingPeerInfo = {
  nodeId: NODE_ID,
  addrs: [
    `/ip4/192.168.1.100/tcp/39000/p2p/${NODE_ID}`,
    `/ip4/113.45.43.60/tcp/4001/p2p/${RELAY_ID}/p2p-circuit/p2p/${NODE_ID}`,
  ],
  ticket: TICKET,
}

function payloadOf(peer: PairingPeerInfo | null, host = '192.168.1.100'): string {
  return buildQrPayload({ host, port: 8765, token: TOKEN, peer })
}

/** 走一遍「桌面画布 → 手机取景 → 模块采样 → 矩阵解码 → parseQrText」 */
function scanDesktopQr(payload: string, dpr = 1) {
  const matrix = qrMatrix(payload)
  const plan = planQrCanvas(matrix.size, dpr)
  const desktop = rasterize(matrix, plan.size / plan.totalModules)
  const capture = simulatePhoneCapture({
    size: desktop.size,
    modules: matrix.size,
    rgba: desktop.rgba,
  })
  const moduleErrors = countModuleErrors(capture, matrix)

  // 采样出来的矩阵按整数像素重画再解码（解的是「手机读到的那份模块」）
  const aligned = rasterize(matrix, 4)
  const decoded = decodeAlignedQr(aligned.rgba, aligned.size)
  return { matrix, plan, desktop, capture, moduleErrors, decoded }
}

// ==================== 用例 ====================

describe('跨端集成：桌面二维码 → 移动端扫描', () => {
  it('should_readEveryModuleAndParseV3_when_typicalLanPlusRelayAddresses', () => {
    const payload = payloadOf(PEER)
    const { matrix, capture, moduleErrors, decoded } = scanDesktopQr(payload)

    // 画布按实际模块数放大：v3 双地址 73 模块 + 静区 → 每模块 4 CSS px（v2 为 85 模块）
    expect(matrix.size).toBe(73)
    expect(capture.frame).toBeGreaterThanOrEqual(300)
    expect(capture.pxPerModule).toBeGreaterThanOrEqual(3.5)

    // 主判据：取景后每个模块都能读对（0 个翻转）
    expect(moduleErrors).toBe(0)

    // 载荷链路：ZXing 解矩阵 → 移动端解析，字段完整还原
    const parsed = parseQrText(decoded)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.payload).toEqual({
      host: '192.168.1.100',
      port: 8765,
      token: TOKEN,
      peer: PEER,
    })
  })

  it('should_readEveryModule_when_highDpiDesktopRender', () => {
    // DPR=2：CSS 尺寸不变、设备像素翻倍（模块边界更锐利），手机侧读到的是同一张图
    const payload = payloadOf(PEER)
    const { plan, capture, moduleErrors, decoded } = scanDesktopQr(payload, 2)
    expect(plan.cssSize).toBeCloseTo(plan.size / 2, 6)
    expect(moduleErrors).toBe(0)

    const parsed = parseQrText(decoded)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.payload.peer).toEqual(PEER)
  })

  it('should_readEveryModuleAndParseV3_when_threeAddressesMakeQrDenser', () => {
    // 多网卡 + relay：v3 三地址 77 模块（v2 同载荷 93），桌面画布按「每模块 ≥4px」放大
    const densePeer: PairingPeerInfo = {
      ...PEER,
      addrs: [
        `/ip4/192.168.1.100/tcp/39000/p2p/${NODE_ID}`,
        `/ip4/10.8.0.4/tcp/39000/p2p/${NODE_ID}`,
        `/ip4/113.45.43.60/tcp/4001/p2p/${RELAY_ID}/p2p-circuit/p2p/${NODE_ID}`,
      ],
    }
    const payload = payloadOf(densePeer)
    const { matrix, capture, moduleErrors, decoded } = scanDesktopQr(payload)
    expect(matrix.size).toBe(77)
    expect(capture.pxPerModule).toBeGreaterThanOrEqual(3.5)
    expect(moduleErrors).toBe(0)

    const parsed = parseQrText(decoded)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.payload.peer?.addrs).toEqual(densePeer.addrs)
  })

  it('should_parseFullPeerShape_when_addrTargetDiffersFromNodeId', () => {
    // 2026-11-14 现场形状：`node.nodeId` 是应用层指纹（64 hex），multiaddr 尾部是
    // libp2p PeerId。桌面退回 v2 完整地址载荷（v3 前缀折叠依赖两者相等）。
    const APP_NODE_ID = '56bc2e94ca6a1f119d014c6bd491ef2a7a6fc68f9354c4c9e9c1354446d31e94'
    const LIBP2P_ID = '12D3KooWSFCWtAtXSKNhNAr7D6iYPnEJFfUjSrUTFJqopHuD4UDx'
    const realPeer: PairingPeerInfo = {
      nodeId: APP_NODE_ID,
      addrs: [
        `/ip4/192.168.1.100/tcp/39000/p2p/${LIBP2P_ID}`,
        `/ip4/113.45.43.60/tcp/4001/p2p/${RELAY_ID}/p2p-circuit/p2p/${LIBP2P_ID}`,
      ],
      ticket: TICKET,
    }
    const payload = payloadOf(realPeer)
    // 完整地址形状（v2）：nodeId 与地址尾部各自保留，移动端按地址直接拨号
    expect(JSON.parse(payload).v).toBe(2)

    const { matrix, moduleErrors, decoded } = scanDesktopQr(payload)
    expect(matrix.size).toBe(85)
    expect(moduleErrors).toBe(0)

    const parsed = parseQrText(decoded)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.payload.peer).toEqual(realPeer)
  })

  it('should_readEveryModuleAndParseLegacyV1_when_oldDesktopWithoutPeer', () => {
    // v1 载荷（无 peer）：旧桌面仍在跑时不能回归
    const payload = payloadOf(null, '10.0.0.9')
    const { moduleErrors, decoded } = scanDesktopQr(payload)
    expect(moduleErrors).toBe(0)

    const parsed = parseQrText(decoded)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.payload).toEqual({ host: '10.0.0.9', port: 8765, token: TOKEN })
    }
  })

  it('should_decodeThroughStrategySequence_when_nativeDetectorUnavailable', () => {
    // 无 GMS 机型（或 BarcodeDetector 探测未通过）只剩 ZXing：单发会因为数据区的假
    // finder 随机失败，但「多尺度 + 四方向旋转轮换」的序列必须在几帧内命中。
    // 这里不降级图片（保持锐利），验证的是策略层本身的覆盖能力；相机退化另见
    // `__tests__/qrDecodeBench.test.ts`（σ / 噪声 / 亚像素平移）。
    const payload = payloadOf(PEER)
    const { capture } = scanDesktopQr(payload)

    let decoded: string | null = null
    for (let frame = 0; frame < 4 && !decoded; frame++) {
      decoded = decodeWithStrategy(capture, frame)
    }

    expect(decoded, '新策略序列 4 帧内未解出').not.toBeNull()
    const parsed = parseQrText(decoded)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.payload).toEqual({
      host: '192.168.1.100',
      port: 8765,
      token: TOKEN,
      peer: PEER,
    })
  })

  it('should_loseModules_when_oldFixed192CanvasAndV2Payload', () => {
    // 回归对照：旧实现固定 192px 画布 + v2 载荷（85 模块 → 2.06px/模块），同一取景下
    // 模块边界糊成一团——这正是「无法识别」的直接证据。
    //
    // 刻意固定用 v2 载荷：v3 压缩后是 73 模块（192px 下 2.37px/模块，本模拟刚好能读），
    // 但这只是余量变好，不改变「画布必须按实际模块数 × ≥4px 计算」的设计（见 qrRender.ts）。
    const v2Payload = JSON.stringify({
      v: 2,
      host: '192.168.1.100',
      port: 8765,
      token: TOKEN,
      peer: PEER,
    })
    const matrix = qrMatrix(v2Payload)
    const legacySize = 192
    const legacyCell = legacySize / (matrix.size + QR_QUIET_ZONE_MODULES * 2)
    expect(legacyCell).toBeLessThan(3)

    // 逐像素复刻 `qrcode` 的分数比例渲染（模块宽度 2px / 3px 交替）
    const rgba = new Uint8ClampedArray(legacySize * legacySize * 4).fill(255)
    for (let py = 0; py < legacySize; py++) {
      for (let px = 0; px < legacySize; px++) {
        const mx = Math.floor((px - QR_QUIET_ZONE_MODULES * legacyCell) / legacyCell)
        const my = Math.floor((py - QR_QUIET_ZONE_MODULES * legacyCell) / legacyCell)
        if (mx < 0 || my < 0 || mx >= matrix.size || my >= matrix.size) continue
        if (!matrix.data[my * matrix.size + mx]) continue
        const offset = (py * legacySize + px) * 4
        rgba[offset] = 0
        rgba[offset + 1] = 0
        rgba[offset + 2] = 0
      }
    }

    const capture = simulatePhoneCapture({ size: legacySize, modules: matrix.size, rgba })
    // 源图每模块 2.16px：放大到取景框也补不回被糊掉的模块边界
    expect(countModuleErrors(capture, matrix)).toBeGreaterThan(0)
  })
})
