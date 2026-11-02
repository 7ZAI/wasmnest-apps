/**
 * 终端快捷键面板的循环轮播（issue #19）
 *
 * 轨道布局固定为 `[末页克隆][0][1]…[n-1][首页克隆]`：真实页从偏移 1 开始，
 * 因此 `trackStyle` 的位移是 `-(currentSlide + 1) * 100%`。首尾两侧的克隆
 * 由面板模板按 `slides` 派生（只写一份页面标记），本 composable 只负责
 * 索引、手势与循环跳转的瞬时状态。
 *
 * 副作用边界：循环跳转依赖 `nextTick` + 双 `requestAnimationFrame` 关闭
 * transition（先无动画瞬移回真实页，再恢复动画），因此测试里需要 stub rAF。
 */
import { computed, nextTick, ref, type Ref } from 'vue'

export interface UseCarouselOptions {
  /** 真实页数量（不含首尾克隆） */
  totalSlides: number
  /** 轮播容器（用于按宽度换算跟手位移） */
  container: Ref<HTMLElement | null>
  /** 翻页判定阈值（百分比），默认 20 */
  threshold?: number
}

export function useCarousel({ totalSlides, container, threshold = 20 }: UseCarouselOptions) {
  if (totalSlides < 1) throw new Error('useCarousel: totalSlides must be >= 1')

  const currentSlide = ref(0)
  const touchStartX = ref(0)
  const touchStartY = ref(0)
  const touchDeltaX = ref(0)
  const isSwiping = ref(false)
  /** 循环跳转中间态：为 true 时禁用 transition（瞬移回真实页） */
  const isLooping = ref(false)

  /** 规范化索引：把循环过渡中的 -1 / totalSlides 映射回真实范围（供页码点用） */
  const displaySlide = computed(
    () => ((currentSlide.value % totalSlides) + totalSlides) % totalSlides,
  )

  const trackStyle = computed(() => ({
    transform: `translateX(${-(currentSlide.value + 1) * 100 + touchDeltaX.value}%)`,
    transition: isSwiping.value || isLooping.value ? 'none' : 'transform 0.3s ease',
  }))

  function goToSlide(index: number) {
    currentSlide.value = ((index % totalSlides) + totalSlides) % totalSlides
    touchDeltaX.value = 0
  }

  /**
   * 循环跳转：先动画滑到克隆位（`cloneIndex`），再瞬移回真实页（`realIndex`）。
   * 两跳之间禁用 transition，避免用户看到反向回卷。
   */
  function loopThrough(cloneIndex: number, realIndex: number) {
    currentSlide.value = cloneIndex
    touchDeltaX.value = 0
    nextTick(() => {
      isLooping.value = true
      currentSlide.value = realIndex
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isLooping.value = false
        })
      })
    })
  }

  /** 左滑 → 下一页；末页循环到首页 */
  function slideToNext() {
    if (currentSlide.value < totalSlides - 1) {
      currentSlide.value++
      touchDeltaX.value = 0
    } else {
      loopThrough(totalSlides, 0)
    }
  }

  /** 右滑 → 上一页；首页循环到末页 */
  function slideToPrev() {
    if (currentSlide.value > 0) {
      currentSlide.value--
      touchDeltaX.value = 0
    } else {
      loopThrough(-1, totalSlides - 1)
    }
  }

  function onTouchStart(e: TouchEvent) {
    touchStartX.value = e.touches[0].clientX
    touchStartY.value = e.touches[0].clientY
    touchDeltaX.value = 0
    isSwiping.value = true
  }

  function onTouchMove(e: TouchEvent) {
    const deltaX = e.touches[0].clientX - touchStartX.value
    const deltaY = e.touches[0].clientY - touchStartY.value
    // 水平位移大于垂直才接管，避免抢走页面纵向滚动
    if (Math.abs(deltaX) > Math.abs(deltaY) && container.value) {
      const width = container.value.offsetWidth || 1
      touchDeltaX.value = (deltaX / width) * 100
    }
  }

  function onTouchEnd() {
    isSwiping.value = false
    if (touchDeltaX.value < -threshold) {
      slideToNext()
    } else if (touchDeltaX.value > threshold) {
      slideToPrev()
    } else {
      touchDeltaX.value = 0
    }
  }

  return {
    currentSlide,
    displaySlide,
    trackStyle,
    touchDeltaX,
    isSwiping,
    isLooping,
    goToSlide,
    slideToNext,
    slideToPrev,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  }
}
