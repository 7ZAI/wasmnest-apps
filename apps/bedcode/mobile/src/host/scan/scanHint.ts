/**
 * 扫码「久扫不出」提示状态机（纯函数，票 2026-11-11）
 * -----------------------------------------------------------------------------
 * 现象：相机常驻扫描、逐帧解码失败回调按设计静默，用户把手机怼在二维码上却零反馈，
 * 无法区分「还没对上焦」和「这个码根本读不出来」。
 *
 * 本模块只回答一个问题：**现在该不该显示非阻断提示**。规则：
 * - 相机就绪起计时，连续 `SCAN_HINT_DELAY_MS` 没有任何解码结果 → 显示；
 * - 一旦命中（`noteScanHit`）→ 立即隐藏，并停表（调用方随即停扫；
 *   重新扫时再 `startScanHint` 起表）；
 * - 相机错误态（权限 / 启动失败）→ `suppressScanHint`，错误面板已经说明问题，
 *   不再叠加一行「靠近一点」；
 * - 提示**不停止相机、不改错误态**，纯展示。
 *
 * 状态对象直接持有可变字段（调用方只通过函数改），避免在 10fps 热路径上产生垃圾。
 */

/** 无结果多久后给提示（ms）：低于它会把「正常对焦时间」当成故障 */
export const SCAN_HINT_DELAY_MS = 10_000

/** 提示状态（由调用方持有，`useQrScanLoop` 每帧 tick 一次） */
export interface ScanHintState {
  /** 扫描开始时刻（ms）；null = 未在扫描 / 已命中停表 */
  startedAt: number | null
  /** 抑制标志（相机错误 / 面板即将卸载） */
  suppressed: boolean
  /** 最近一次 tick 的可见性（供调用方比较、避免无谓的 ref 更新） */
  visible: boolean
}

/** 新建一份空状态（未开始计时） */
export function createScanHintState(): ScanHintState {
  return { startedAt: null, suppressed: false, visible: false }
}

/** 开始在 `now` 起计时（相机就绪 / 重新扫描） */
export function startScanHint(state: ScanHintState, now: number): ScanHintState {
  state.startedAt = now
  state.suppressed = false
  state.visible = false
  return state
}

/** 命中：立即隐藏并停表（扫码成功即停扫，计时没有继续的意义） */
export function noteScanHit(state: ScanHintState): ScanHintState {
  state.startedAt = null
  state.visible = false
  return state
}

/** 抑制：相机错误态 / 面板卸载；隐藏提示且不再计时 */
export function suppressScanHint(state: ScanHintState): ScanHintState {
  state.suppressed = true
  state.visible = false
  return state
}

/**
 * 按当前时刻推进状态，返回是否应显示提示。
 *
 * `now` 由调用方注入（帧循环用 `Date.now()`），保证可单测、不依赖真实时钟。
 */
export function tickScanHint(state: ScanHintState, now: number): boolean {
  if (state.suppressed || state.startedAt === null) {
    state.visible = false
    return false
  }
  state.visible = now - state.startedAt >= SCAN_HINT_DELAY_MS
  return state.visible
}
