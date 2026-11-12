/**
 * 扫码取景框规格
 * -----------------------------------------------------------------------------
 * 为什么单独算：`html5-qrcode` 的解码画布边长**等于解码区域的 CSS 像素数**
 * （传 `qrbox` 时是框，不传时是整个预览），与相机分辨率无关。所以「每模块能拿到
 * 多少像素」只由两件事决定：
 *
 *   1. 二维码在解码区域里占多大（用户会把码卡进取景框，所以与框同尺度）；
 *   2. 二维码本身的模块数（T08 的 v2 载荷 85~93 模块）。
 *
 * 旧实现把取景框与 `qrbox` 都写死 250px，85 模块时每模块 ≈2.9px，再叠加两者
 * 的居中基准不一致（`qrbox` 相对 video 元素居中，可见框相对容器居中），对准框的
 * 二维码常常被裁掉一截——解码回调按设计静默，界面表现就是「没有任何反应」。
 *
 * 现口径：取景框贴着**预览可见区**取（短边 88%），解码区域直接覆盖整个预览
 * （不再传 `qrbox`），于是「看到的框」永远落在「解得到」的区域内。
 */

/** 取景框下限（CSS px）：再小二维码就装不进框 */
export const SCAN_FRAME_MIN = 240

/** 取景框上限（CSS px）：手机竖屏下再大就会把提示文案顶出可视区 */
export const SCAN_FRAME_MAX = 360

/** 取景框占预览可见短边的比例（留出边缘余量，便于对焦时抖动） */
export const SCAN_FRAME_RATIO = 0.88

/**
 * 计算取景框边长。
 *
 * @param previewWidth 预览（video 元素）CSS 宽
 * @param previewHeight 预览（video 元素）CSS 高
 * @param viewportHeight 取景容器 CSS 高（video 可能比容器高、被裁切，可见区以容器为准）
 *
 * 取三者的最小值作为「可见短边」：video 比容器矮时以 video 为准，反之以容器为准。
 */
export function scanFrameSize(
  previewWidth: number,
  previewHeight: number,
  viewportHeight: number,
): number {
  const usable = [previewWidth, previewHeight, viewportHeight].filter(
    (value) => Number.isFinite(value) && value > 0,
  )
  // 一个有效尺寸都没拿到（相机未就绪 / 测量早于布局）：给下限，避免出现 0 宽取景框
  const shortEdge = usable.length > 0 ? Math.min(...usable) : SCAN_FRAME_MIN
  const raw = Math.round(shortEdge * SCAN_FRAME_RATIO)
  return Math.min(SCAN_FRAME_MAX, Math.max(SCAN_FRAME_MIN, raw))
}
