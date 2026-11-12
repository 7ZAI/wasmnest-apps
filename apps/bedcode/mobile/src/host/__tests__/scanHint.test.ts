/**
 * 扫码「久扫不出」提示 行为契约测试（票 2026-11-11）
 *
 * 被测：`src/host/scan/scanHint.ts`（纯状态机，时间由调用方注入）。
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | C-QRH-1 | 未开始计时 | 不显示 |
 * | C-QRH-2 | 连续无结果 < 10s / ≥ 10s | 不显示 / 显示 |
 * | C-QRH-3 | 命中 | 立即隐藏并停表（不再因时间流逝复现） |
 * | C-QRH-4 | 相机错误抑制 | 永不显示；重新起扫才能恢复计时 |
 * | C-QRH-5 | 重新扫描 | 计时归零，10s 后才会再出现 |
 */
import { describe, expect, it } from 'vitest'
import {
  createScanHintState,
  noteScanHit,
  SCAN_HINT_DELAY_MS,
  startScanHint,
  suppressScanHint,
  tickScanHint,
} from '../scan/scanHint'

describe('C-QRH-1 未开始计时', () => {
  it('should_stayHidden_when_scanNeverStarted', () => {
    const state = createScanHintState()
    expect(tickScanHint(state, Date.now())).toBe(false)
    expect(state.visible).toBe(false)
  })
})

describe('C-QRH-2 无结果计时', () => {
  it('should_stayHidden_justBeforeDelay', () => {
    const state = startScanHint(createScanHintState(), 1_000)
    expect(tickScanHint(state, 1_000 + SCAN_HINT_DELAY_MS - 1)).toBe(false)
  })

  it('should_showExactlyAtDelay', () => {
    const state = startScanHint(createScanHintState(), 1_000)
    expect(tickScanHint(state, 1_000 + SCAN_HINT_DELAY_MS)).toBe(true)
    expect(state.visible).toBe(true)
  })

  it('should_keepShowing_whileNoResult', () => {
    const state = startScanHint(createScanHintState(), 0)
    expect(tickScanHint(state, SCAN_HINT_DELAY_MS * 3)).toBe(true)
  })
})

describe('C-QRH-3 命中', () => {
  it('should_hideImmediately_when_hitAfterHintShown', () => {
    const state = startScanHint(createScanHintState(), 0)
    expect(tickScanHint(state, SCAN_HINT_DELAY_MS + 5)).toBe(true)
    noteScanHit(state)
    expect(tickScanHint(state, SCAN_HINT_DELAY_MS + 6)).toBe(false)
  })

  it('should_stayHidden_when_hitStopsTheTimer', () => {
    const state = startScanHint(createScanHintState(), 0)
    noteScanHit(state)
    // 命中即停扫：时间再久也不该冒出来（避免「扫成功了还提示靠近一点」）
    expect(tickScanHint(state, SCAN_HINT_DELAY_MS * 10)).toBe(false)
  })
})

describe('C-QRH-4 相机错误抑制', () => {
  it('should_neverShow_when_suppressed', () => {
    const state = startScanHint(createScanHintState(), 0)
    suppressScanHint(state)
    expect(tickScanHint(state, SCAN_HINT_DELAY_MS * 2)).toBe(false)
  })

  it('should_hideAlreadyVisibleHint_when_cameraFails', () => {
    const state = startScanHint(createScanHintState(), 0)
    expect(tickScanHint(state, SCAN_HINT_DELAY_MS)).toBe(true)
    suppressScanHint(state)
    expect(state.visible).toBe(false)
  })
})

describe('C-QRH-5 重新扫描', () => {
  it('should_restartTimer_when_scanRestartsAfterSuppression', () => {
    const state = startScanHint(createScanHintState(), 0)
    suppressScanHint(state)
    startScanHint(state, 50_000)
    expect(tickScanHint(state, 50_000 + SCAN_HINT_DELAY_MS - 1)).toBe(false)
    expect(tickScanHint(state, 50_000 + SCAN_HINT_DELAY_MS)).toBe(true)
  })
})
