/**
 * 二维码画布规格（T08 后的回归修复）
 * -----------------------------------------------------------------------------
 * 问题：T08 把载荷从 v1 的 `{host,port,token}`（≈80 字节 / 37 模块）扩到 v2 的
 * `{v,host,port,token,peer:{nodeId,addrs[],ticket}}`（LAN + relay 两条地址时
 * ≈480 字节 / 85 模块，三地址 ≈93 模块）。画布仍是固定 192px、`margin: 2`，
 * 每模块只剩 **≈2.2 个 CSS px**——相机拍到的模块边界混叠成灰带，解码器读不出
 * 模块网格；而逐帧解码失败的回调按设计是空操作，界面表现就是「对准二维码
 * 没有任何反应」。
 *
 * 判据：**每个模块至少 {@link QR_MIN_CELL_CSS} 个 CSS px**，且画布设备像素数
 * 必须是「总模块数 × 整数」——`qrcode` 的 canvas 渲染按 `width / 模块数` 取比例，
 * 非整数比例会把模块画成 2px / 3px 交替的条纹（同一张图自带畸变）。
 *
 * 本模块只做规格计算与矩阵编码（无 DOM），组件按返回值落 `canvas.width` 与 `style.width`。
 *
 * 真源：`apps/bedcode/desktop/src/utils/pairingPayload.ts`（载荷字段）、
 * 移动端解析 `apps/bedcode/mobile/src/host/qr.ts`。
 */
import QRCode from 'qrcode'

/** 每模块最小边长（CSS px）：低于 4px 时手机相机在常规对焦距离下无法稳定识别 */
export const QR_MIN_CELL_CSS = 4

/** 画布边长上限（CSS px）：配对卡片是整行宽度，再大也只会把二维码顶出可视区 */
export const QR_MAX_CSS = 420

/** 画布内静区（模块数）。
 *
 * 低于规范要求的 4：画布处在配对卡片的白色衬底内（`bg-white p-3`），
 * 衬底补足外圈白边，画布内留 2 模块即可，省下的像素留给模块本身。
 */
export const QR_QUIET_ZONE_MODULES = 2

/**
 * 纠错级别。
 *
 * 二维码只出现在屏幕上（无印刷脏污 / 折痕），M（15% 容错）已经是过档配置；
 * 再往上每级要多吃 8~12 个模块，等于把每个模块的像素又摊薄一层。
 */
export const QR_ERROR_CORRECTION = 'M' as const

/** QR 矩阵（`data` 按行优先，1 = 黑模块） */
export interface QrMatrix {
  /** 矩阵边长（模块数，不含静区） */
  size: number
  data: Uint8Array
}

/**
 * 载荷 → QR 矩阵。
 *
 * 单独导出是为了让**跨端集成测试**（移动端 `host/__tests__/scanIntegration`）
 * 用与桌面画布完全相同的编码参数生成同一张图，而不是各写一份。
 */
export function qrMatrix(payload: string): QrMatrix {
  const { modules } = QRCode.create(payload, { errorCorrectionLevel: QR_ERROR_CORRECTION })
  return { size: modules.size, data: modules.data }
}

export interface QrCanvasPlan {
  /** 画布设备像素边长（`canvas.width` / `canvas.height`） */
  size: number
  /** 画布 CSS 边长（`style.width` / `style.height`）：`size / dpr` */
  cssSize: number
  /** 每个模块的设备像素（整数，保证模块边界落在像素格上） */
  cell: number
  /** 含静区的总模块数 */
  totalModules: number
}

/**
 * 计算二维码画布规格。
 *
 * @param moduleCount 二维码矩阵边长（`QRCode.create(...).modules.size`，不含静区）
 * @param dpr 设备像素比；非法值（0 / NaN / 负数）按 1 处理
 *
 * 取舍：载荷过密（总模块数 × 4px 超过 {@link QR_MAX_CSS}）时**先保画布不溢出**，
 * 每模块退到 3px 甚至更低；绝不反过来让二维码撑出卡片。
 */
export function planQrCanvas(moduleCount: number, dpr: number): QrCanvasPlan {
  // 21 = QR version 1 的模块数下限；非法入参按最小矩阵算，不产出 NaN 画布
  const modules = Number.isFinite(moduleCount) ? Math.max(21, Math.trunc(moduleCount)) : 21
  const totalModules = modules + QR_QUIET_ZONE_MODULES * 2
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1

  const maxCellCss = Math.floor(QR_MAX_CSS / totalModules)
  const cellCss = Math.max(1, Math.min(QR_MIN_CELL_CSS, maxCellCss))
  const cell = Math.max(1, Math.round(cellCss * scale))
  const size = cell * totalModules

  return { size, cssSize: size / scale, cell, totalModules }
}
