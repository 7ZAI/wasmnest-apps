/**
 * 二维码画布规格 行为契约测试
 *
 * 被测：`src/utils/qrRender.ts::planQrCanvas`（与 BedCode 同判据，本应用自持副本）。
 *
 * 回归背景（2026-11-11）：T08 把 QR 载荷从 37 模块扩到 85~93 模块，画布仍固定
 * 192px → 每模块 ~2.2px，手机端「对准二维码没有任何反应」。本套用例锁住
 * 「每模块 ≥ 4 CSS px」与「画布边长是总模块数的整数倍」两条判据。
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | QR-R1 | 常规 v2 载荷（85 模块）@DPR 1 | 每模块 4 CSS px，CSS 边长 356 |
 * | QR-R2 | 同载荷 @DPR 2 / 3 / 1.5 | CSS 边长不变，设备像素按 DPR 整数倍放大 |
 * | QR-R3 | 画布边长 | 恒为「总模块数 × 整数」（模块边界不落在半个像素上） |
 * | QR-R4 | 超密载荷 | 先保画布不超上限，每模块退到 3 / 2 px 也不溢出 |
 * | QR-R5 | 非法入参 | dpr 0/NaN/负数按 1；模块数 NaN 按 QR v1（21） |
 */
import { describe, it, expect } from 'vitest'
import { planQrCanvas, QR_MAX_CSS, QR_QUIET_ZONE_MODULES } from '../utils/qrRender'

const V2_MODULES = 85 // LAN + relay circuit 两条地址的典型 v3 载荷
const TOTAL = V2_MODULES + QR_QUIET_ZONE_MODULES * 2

describe('QR-R1 常规 v2 载荷：每模块 ≥ 4 CSS px', () => {
  it('should_giveFourCssPxPerModule_when_typicalV2PayloadOnDpr1', () => {
    const plan = planQrCanvas(V2_MODULES, 1)
    expect(plan.totalModules).toBe(TOTAL)
    expect(plan.cell).toBe(4)
    expect(plan.size).toBe(4 * TOTAL)
    expect(plan.cssSize).toBe(4 * TOTAL)
    // 回归判据：固定 192px 时这里只有 ~2.2px
    expect(plan.cssSize / plan.totalModules).toBeGreaterThanOrEqual(4)
  })
})

describe('QR-R2 DPR 缩放：CSS 尺寸不缩水，设备像素取整放大', () => {
  it.each([
    [2, 8],
    [3, 12],
    [1.5, 6],
    [1.25, 5],
  ])('should_keepCssSizeAndScaleDevicePixels_when_dprIs%s', (dpr, expectedCell) => {
    const plan = planQrCanvas(V2_MODULES, dpr)
    expect(plan.cell).toBe(expectedCell)
    expect(plan.size).toBe(expectedCell * TOTAL)
    expect(plan.cssSize).toBeCloseTo((expectedCell * TOTAL) / dpr, 6)
  })
})

describe('QR-R3 画布边长恒为总模块数整数倍', () => {
  it.each([21, 37, 69, 77, 85, 93, 101, 125, 177])(
    'should_alignModulesToWholePixels_when_moduleCountIs%i',
    (modules) => {
      for (const dpr of [1, 1.25, 1.5, 2, 2.75, 3]) {
        const plan = planQrCanvas(modules, dpr)
        expect(plan.size % plan.totalModules).toBe(0)
        expect(Number.isInteger(plan.size / plan.totalModules)).toBe(true)
        expect(plan.cell).toBeGreaterThanOrEqual(1)
      }
    },
  )
})

describe('QR-R4 超密载荷：先保画布不溢出卡片', () => {
  it('should_capCanvasAndShrinkCell_when_payloadTooDense', () => {
    for (const modules of [101, 125, 177]) {
      const plan = planQrCanvas(modules, 1)
      expect(plan.cssSize).toBeLessThanOrEqual(QR_MAX_CSS)
    }
    // 105 总模块（101 + 静区）仍能维持 4px；更密时才退档
    expect(planQrCanvas(101, 1).cell).toBe(4)
    expect(planQrCanvas(125, 1).cell).toBe(3)
    expect(planQrCanvas(177, 1).cell).toBe(2)
  })
})

describe('QR-R5 非法入参按保守值处理', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'should_fallbackToDpr1_when_dprIs%s',
    (dpr) => {
      const plan = planQrCanvas(V2_MODULES, dpr)
      expect(plan.cell).toBe(4)
      expect(plan.cssSize).toBe(4 * TOTAL)
    },
  )

  it('should_fallbackToVersion1_when_moduleCountInvalid', () => {
    const plan = planQrCanvas(Number.NaN, 1)
    expect(plan.totalModules).toBe(21 + QR_QUIET_ZONE_MODULES * 2)
    expect(plan.cell).toBe(4)
  })
})
