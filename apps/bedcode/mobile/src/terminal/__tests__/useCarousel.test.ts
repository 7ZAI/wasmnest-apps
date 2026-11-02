import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { useCarousel } from '../composables/useCarousel'

/** 构造一个带 offsetWidth 的容器 ref（跟手位移按宽度换算） */
function makeContainer(width = 300) {
  return ref({ offsetWidth: width } as HTMLElement)
}

function setup(totalSlides = 2) {
  const container = makeContainer()
  const carousel = useCarousel({ totalSlides, container })
  return { container, ...carousel }
}

function touch(clientX: number, clientY = 0): TouchEvent {
  return { touches: [{ clientX, clientY }] } as unknown as TouchEvent
}

describe('useCarousel', () => {
  beforeEach(() => {
    // 循环跳转用双 rAF 关闭 transition：同步执行即可断言最终态
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('goToSlide 规范化越界与负数索引', () => {
    const c = setup(2)
    c.goToSlide(1)
    expect(c.currentSlide.value).toBe(1)
    c.goToSlide(3)
    expect(c.currentSlide.value).toBe(1)
    c.goToSlide(-1)
    expect(c.currentSlide.value).toBe(1)
  })

  it('displaySlide 把克隆位映射回真实页', () => {
    const c = setup(2)
    c.currentSlide.value = -1
    expect(c.displaySlide.value).toBe(1)
    c.currentSlide.value = 2
    expect(c.displaySlide.value).toBe(0)
  })

  it('trackStyle 为真实页补一个克隆偏移，拖动时叠加位移', () => {
    const c = setup(2)
    c.goToSlide(0)
    expect(c.trackStyle.value.transform).toBe('translateX(-100%)')
    c.currentSlide.value = 1
    expect(c.trackStyle.value.transform).toBe('translateX(-200%)')
    c.isSwiping.value = true
    expect(c.trackStyle.value.transition).toBe('none')
  })

  it('左滑翻页，末页循环回首页', async () => {
    const c = setup(2)
    c.slideToNext()
    expect(c.currentSlide.value).toBe(1)

    c.slideToNext() // 末页 → 克隆位（2）→ 瞬移回 0
    expect(c.currentSlide.value).toBe(2)
    await nextTick()
    expect(c.currentSlide.value).toBe(0)
    expect(c.isLooping.value).toBe(false)
  })

  it('右滑翻页，首页循环到末页', async () => {
    const c = setup(2)
    c.slideToPrev() // 首页 → 克隆位（-1）→ 瞬移回 1
    expect(c.currentSlide.value).toBe(-1)
    await nextTick()
    expect(c.currentSlide.value).toBe(1)
  })

  it('水平位移超过阈值才翻页，否则回弹', () => {
    const c = setup(2)
    c.onTouchStart(touch(200))
    c.onTouchMove(touch(100)) // -100px / 300px = -33%
    c.onTouchEnd()
    expect(c.currentSlide.value).toBe(1)
    expect(c.touchDeltaX.value).toBe(0)

    // 同一页内小幅滑动：不翻页
    c.currentSlide.value = 0
    c.onTouchStart(touch(200))
    c.onTouchMove(touch(190)) // -3.3%
    c.onTouchEnd()
    expect(c.currentSlide.value).toBe(0)
  })

  it('纵向位移大于横向时不接管手势', () => {
    const c = setup(2)
    c.onTouchStart(touch(200, 100))
    c.onTouchMove(touch(150, 0)) // dx=50 dy=100 → 纵向为主
    expect(c.touchDeltaX.value).toBe(0)
  })
})
