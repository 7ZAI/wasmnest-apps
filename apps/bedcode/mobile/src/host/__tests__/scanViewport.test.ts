/**
 * 扫码取景框规格 行为契约测试
 *
 * 被测：`src/host/scanViewport.ts::scanFrameSize`。
 *
 * 回归背景（2026-11-11）：取景框写死 250px + 解码区域 250px `qrbox`，v2 载荷
 * （85+ 模块）下每模块不足 3px，且 `qrbox` 与可见框中心不一致 → 扫码无任何反应。
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | QR-V1 | 竖屏预览（宽 < 高） | 取宽度 × 88%，落在 [240, 360] |
 * | QR-V2 | 横屏预览（高 < 宽） | 取高度 × 88%（预览可见短边才是上限） |
 * | QR-V3 | 容器比预览矮 | 取容器高 × 88%（被裁切的部分不可见，不能拿它当框） |
 * | QR-V4 | 超小 / 超大尺寸 | 夹到 [240, 360] |
 * | QR-V5 | 非法 / 缺失尺寸 | 忽略无效项；全无效按下限 240 |
 */
import { describe, it, expect } from 'vitest'
import { SCAN_FRAME_MAX, SCAN_FRAME_MIN, scanFrameSize } from '../scanViewport'

describe('QR-V1 竖屏预览', () => {
  it('should_usePreviewWidth_when_portraitPreview', () => {
    expect(scanFrameSize(390, 520, 500)).toBe(343)
  })
})

describe('QR-V2 横屏预览', () => {
  it('should_usePreviewHeight_when_landscapePreview', () => {
    expect(scanFrameSize(390, 292, 500)).toBe(257)
  })
})

describe('QR-V3 容器裁切预览', () => {
  it('should_useViewportHeight_when_containerShorterThanPreview', () => {
    // 预览 520×900、容器 400：可见短边以容器为准（352），不拿被裁掉的 900 高
    expect(scanFrameSize(520, 900, 400)).toBe(352)
  })
})

describe('QR-V4 尺寸夹逼', () => {
  it('should_clampToFloor_when_previewTiny', () => {
    expect(scanFrameSize(200, 200, 200)).toBe(SCAN_FRAME_MIN)
  })

  it('should_clampToCeiling_when_previewHuge', () => {
    expect(scanFrameSize(1200, 1600, 1600)).toBe(SCAN_FRAME_MAX)
  })
})

describe('QR-V5 非法尺寸', () => {
  it('should_ignoreInvalidDimensions_when_someMissing', () => {
    // 宽度无效 → 按 min(520, 500) = 500 算（440）→ 撞上限
    expect(scanFrameSize(Number.NaN, 520, 500)).toBe(SCAN_FRAME_MAX)
  })

  it('should_fallBackToFloor_when_allDimensionsInvalid', () => {
    expect(scanFrameSize(0, -1, Number.NaN)).toBe(SCAN_FRAME_MIN)
  })
})
