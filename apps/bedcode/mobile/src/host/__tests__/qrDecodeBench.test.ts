/**
 * 离线扫码命中率阈值（票 2026-11-11，spec §6.1 / §7 DoD 1）
 *
 * 被测：`__tests__/support/qrDecodeBench.ts` —— 用生产代码跑
 * 「桌面载荷/画布 → 1080p 传感器退化（σ 1.5/2.5 + 噪声 ±4/±8 + 3 组亚像素平移）
 * → 移动 scan/decodeStrategy 尝试序列（无原生检测器）→ ZXing 解码」。
 *
 * 判据（无原生检测器 = 最坏路径）：
 * - 扫描级命中率 ≥ 95%（连续 4 帧内解出，反映真实扫码体验）；
 * - 帧级命中率 ≥ 95%（首帧就要能出，NoDo 的「3 秒内」有余量）；
 * - 单帧解码 p95 ≤ 60ms（与 `FRAME_BUDGET_MS` 同口径）。
 *
 * 语料固定（种子写死），失败信息带 `formatBenchReport` 全文，便于定位是哪个退化档退化。
 */
import { describe, expect, it } from 'vitest'
import { formatBenchReport, runDecodeBench } from './support/qrDecodeBench'

describe('离线扫码命中率（无原生检测器）', () => {
  it('should_hitAtLeast95PercentWithinFrameBudget', () => {
    const report = runDecodeBench({ payloadCount: 20, framesPerScan: 4 })
    const detail = formatBenchReport(report)

    expect(report.samples).toBe(20 * 3 * 2)
    expect(report.scanHitRate, detail).toBeGreaterThanOrEqual(0.95)
    expect(report.frameHitRate, detail).toBeGreaterThanOrEqual(0.95)
    expect(report.p95Ms, detail).toBeLessThanOrEqual(60)
  }, 180_000)
})
