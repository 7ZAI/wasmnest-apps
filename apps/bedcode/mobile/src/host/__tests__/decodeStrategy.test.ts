/**
 * 扫码解码策略 行为契约测试（票 2026-11-11）
 *
 * 被测：`src/host/scan/decodeStrategy.ts`（纯函数，不依赖 DOM / 解码器）。
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | C-QRS-1 | 原生检测器可用 | 第一档必须是 native（否则每帧白等） |
 * | C-QRS-2 | 无原生 | 第一档是全尺寸 ZXing + TRY_HARDER |
 * | C-QRS-3 | 预算裁剪 | 按序取、单档 ≥ 15ms、总和 ≤ 预算；预算过小时也给一档 |
 * | C-QRS-4 | ROI 兜底档 | 连续未命中 ≥ 30 帧才出现，且排在 0.45× 之前 |
 * | C-QRS-5 | 旋转轮换 | 逐帧换扫描方向，4 帧覆盖 0/90/180/270 |
 * | C-QRS-6 | 取景几何 | 全尺寸原样 / 降采样缩比 / ROI 中心裁剪放大（不超上限、不丢信息） |
 * | C-QRS-7 | 工作画布与帧率 | 短边 = CSS×2 封顶 720、下限 240；慢帧 10fps→5fps |
 */
import { describe, expect, it } from 'vitest'
import {
  attemptCapture,
  FRAME_BUDGET_MS,
  FRAME_INTERVAL_MS,
  MAX_DECODE_EDGE,
  MIN_ATTEMPT_BUDGET_MS,
  nextFrameDelayMs,
  planAttempts,
  ROI_MISS_THRESHOLD,
  ROI_SCALE,
  SLOW_FRAME_INTERVAL_MS,
  SLOW_FRAME_THRESHOLD_MS,
  workCanvasEdge,
} from '../scan/decodeStrategy'

describe('C-QRS-1/C-QRS-2 尝试序列的起点', () => {
  it('should_putNativeFirst_when_detectorAvailable', () => {
    const [first] = planAttempts({ nativeDetector: true }, 0, FRAME_BUDGET_MS)
    expect(first.kind).toBe('native')
    expect(first.quarterTurns).toBe(0)
    expect(first.tryHarder).toBe(false)
  })

  it('should_startWithFullScaleZxing_when_noNativeDetector', () => {
    const [first] = planAttempts({ nativeDetector: false }, 0, FRAME_BUDGET_MS)
    expect(first).toMatchObject({ kind: 'zxing', scale: 1, tryHarder: true })
  })
})

describe('C-QRS-3 预算裁剪', () => {
  it.each([FRAME_BUDGET_MS, 40, 30, MIN_ATTEMPT_BUDGET_MS])(
    'should_fitBudgetAndKeepFloor_when_budget=%ims',
    (budget) => {
      const attempts = planAttempts({ nativeDetector: true }, 0, budget)
      expect(attempts.length).toBeGreaterThan(0)
      const total = attempts.reduce((sum, attempt) => sum + attempt.budgetMs, 0)
      expect(total).toBeLessThanOrEqual(budget)
      for (const attempt of attempts)
        expect(attempt.budgetMs).toBeGreaterThanOrEqual(MIN_ATTEMPT_BUDGET_MS)
    },
  )

  it('should_stillReturnOneAttempt_when_budgetBelowFloor', () => {
    // 预算小于单档下限（异常 / 调用方压预算）：不给档 = 整帧无事可做，必须保底一档
    const attempts = planAttempts({ nativeDetector: false }, 0, 5)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].budgetMs).toBe(5)
  })

  it('should_fallBackToDefaultBudget_when_budgetInvalid', () => {
    for (const budget of [Number.NaN, 0, -10]) {
      const attempts = planAttempts({ nativeDetector: false }, 0, budget)
      const total = attempts.reduce((sum, attempt) => sum + attempt.budgetMs, 0)
      expect(total).toBeLessThanOrEqual(FRAME_BUDGET_MS)
      expect(attempts.length).toBeGreaterThan(0)
    }
  })
})

describe('C-QRS-4 ROI 兜底档', () => {
  it('should_notPlanRoi_when_missesBelowThreshold', () => {
    const attempts = planAttempts(
      { nativeDetector: false },
      ROI_MISS_THRESHOLD - 1,
      FRAME_BUDGET_MS,
    )
    expect(attempts.some((attempt) => attempt.scale === ROI_SCALE)).toBe(false)
  })

  it('should_planRoiBefore045_when_missesReachThreshold', () => {
    const attempts = planAttempts({ nativeDetector: false }, ROI_MISS_THRESHOLD, FRAME_BUDGET_MS)
    const roi = attempts.findIndex((attempt) => attempt.scale === ROI_SCALE)
    const down = attempts.findIndex((attempt) => attempt.scale === 0.45)
    expect(roi).toBeGreaterThanOrEqual(0)
    // 60ms 预算下若 ROI 排在 0.45 之后会被裁掉，永远跑不到
    expect(down === -1 || roi < down).toBe(true)
    expect(attempts[roi].tryHarder).toBe(true)
  })

  it('should_keepRoiOutOfBudget_when_missesHighButBudgetTight', () => {
    // 预算裁掉 ROI 是合法结果（不变量只要求「按序取」），但序列不得为空
    const attempts = planAttempts({ nativeDetector: false }, 999, 20)
    expect(attempts.length).toBeGreaterThan(0)
    expect(attempts.reduce((sum, attempt) => sum + attempt.budgetMs, 0)).toBeLessThanOrEqual(20)
  })
})

describe('C-QRS-5 旋转轮换', () => {
  it('should_coverAllFourTurnsWithinFourFrames', () => {
    const turns = new Set<number>()
    for (let frame = 0; frame < 4; frame++) {
      const [first] = planAttempts({ nativeDetector: false }, frame, FRAME_BUDGET_MS)
      turns.add(first.quarterTurns)
    }
    expect([...turns].sort()).toEqual([0, 1, 2, 3])
  })

  it('should_useSameTurn_when_frameIndexRepeats', () => {
    // 轮换只依赖连续未命中数（纯函数），同一帧号必须产出同一序列
    const first = planAttempts({ nativeDetector: false }, 7, FRAME_BUDGET_MS)
    const second = planAttempts({ nativeDetector: false }, 7, FRAME_BUDGET_MS)
    expect(second).toEqual(first)
  })

  it('should_behaveForNonNegativeFrames_when_missesMalformed', () => {
    for (const misses of [-3, Number.NaN, 2.7]) {
      const attempts = planAttempts({ nativeDetector: false }, misses, FRAME_BUDGET_MS)
      expect(attempts.length).toBeGreaterThan(0)
      for (const attempt of attempts) expect([0, 1, 2, 3]).toContain(attempt.quarterTurns)
    }
  })

  it('should_coverBothScalesAndTurnsAcrossFrames', () => {
    const seen = new Set<string>()
    for (let frame = 0; frame < 4; frame++) {
      for (const attempt of planAttempts({ nativeDetector: false }, frame, FRAME_BUDGET_MS)) {
        seen.add(`${attempt.scale}@${attempt.quarterTurns}`)
      }
    }
    // 四帧内至少覆盖「全尺寸四方向」与「降采样四方向」
    expect(seen.size).toBeGreaterThanOrEqual(8)
  })
})

describe('C-QRS-6 取景几何', () => {
  it('should_returnWholeFrame_when_scaleIsOne', () => {
    expect(attemptCapture(1, 720, 960)).toEqual({
      sx: 0,
      sy: 0,
      sw: 720,
      sh: 960,
      dw: 720,
      dh: 960,
    })
  })

  it('should_scaleDownBothAxes_when_scaleBelowOne', () => {
    expect(attemptCapture(0.5, 720, 960)).toEqual({
      sx: 0,
      sy: 0,
      sw: 720,
      sh: 960,
      dw: 360,
      dh: 480,
    })
  })

  it('should_cropCenteredSquareAndUpScale_when_roiScale', () => {
    const geometry = attemptCapture(ROI_SCALE, 720, 960)
    expect(geometry.sw).toBe(geometry.sh)
    expect(geometry.sh).toBe(Math.round(720 / ROI_SCALE))
    expect(geometry.sx).toBe(Math.round((720 - geometry.sw) / 2))
    expect(geometry.sy).toBe(Math.round((960 - geometry.sh) / 2))
    // 输出 = 取样边 × ROI 比例（放大一档），且不超过工作画布上限
    expect(geometry.dw).toBe(Math.min(Math.round(geometry.sw * ROI_SCALE), MAX_DECODE_EDGE))
    expect(geometry.dw).toBeGreaterThanOrEqual(geometry.sw)
  })

  it('should_normalizeIllegalScale_toWholeFrame', () => {
    for (const scale of [0, -1, Number.NaN]) {
      expect(attemptCapture(scale, 400, 300)).toEqual({
        sx: 0,
        sy: 0,
        sw: 400,
        sh: 300,
        dw: 400,
        dh: 300,
      })
    }
  })
})

describe('C-QRS-7 工作画布与帧率', () => {
  it('should_capEdgeAt720_andKeepDoubleCss', () => {
    expect(workCanvasEdge(390)).toBe(MAX_DECODE_EDGE) // 390×2 = 780 → 封顶 720
    expect(workCanvasEdge(200)).toBe(400)
  })

  it('should_keepFloor_when_cssSizeUnknown', () => {
    for (const css of [0, -1, Number.NaN]) expect(workCanvasEdge(css)).toBe(240)
  })

  it('should_dropTo5fps_when_frameCostExceedsThreshold', () => {
    expect(nextFrameDelayMs(SLOW_FRAME_THRESHOLD_MS)).toBe(FRAME_INTERVAL_MS)
    expect(nextFrameDelayMs(SLOW_FRAME_THRESHOLD_MS + 1)).toBe(SLOW_FRAME_INTERVAL_MS)
  })
})

describe('策略序列的完整性', () => {
  it('should_neverExceedOneNativeAttempt', () => {
    for (const misses of [0, 1, 5, 29, 30, 300]) {
      const attempts = planAttempts({ nativeDetector: true }, misses, FRAME_BUDGET_MS)
      expect(attempts.filter((attempt) => attempt.kind === 'native')).toHaveLength(1)
    }
  })

  it('should_onlyUseSupportedAttemptKinds', () => {
    for (const misses of [0, 30]) {
      for (const attempt of planAttempts({ nativeDetector: true }, misses, FRAME_BUDGET_MS)) {
        expect(['native', 'zxing']).toContain(attempt.kind)
        expect(attempt.budgetMs).toBeGreaterThan(0)
      }
    }
  })
})
