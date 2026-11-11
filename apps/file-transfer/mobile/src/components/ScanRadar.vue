<script setup lang="ts">
/**
 * ScanRadar — 探索连接的雷达扫描图元（纯装饰）
 *
 * 「探索连接」是唯一一个「用户看不到结果还会盯着看」的页面：mDNS 发现没有
 * 可观测的完成时刻，只有一个从空到有的列表。没有过程指示时，用户无法区分
 * 「没搜到」和「还在搜」——本图元就是那段过程的可见载体。
 *
 * 三层结构（全部 transform / opacity 动画，合成层友好）：
 *   - 同心圆环：固定刻度，给出「正在扫一个范围」的空间感
 *   - 扇形扫描：conic-gradient 圆盘匀速旋转（仅 active 时转）
 *   - 扩散脉冲：圆环自内向外放大淡出（仅 active）
 * 无 SVG / 无 canvas / 无外部资源：宿主不保证这张图能被 CSP 放行，
 * 纯 CSS 在 WebView 上最稳。
 *
 * 语义：`aria-hidden`，状态由相邻文案承担（读屏不该念“动画”）。
 * 减弱动效：`prefers-reduced-motion` 下扫描与脉冲停止（见 styles.css）。
 */
defineProps<{
  /** 扫描进行中：旋转 + 扩散脉冲；否则只留静态刻度环 */
  active: boolean
  /** sm = 列表页头的紧凑尺寸；lg = 空态页中央 */
  size?: 'sm' | 'lg'
}>()
</script>

<template>
  <div
    class="fv2-radar"
    :class="[`fv2-radar--${size ?? 'lg'}`, { 'fv2-radar--active': active }]"
    aria-hidden="true"
  >
    <span class="fv2-radar-ring fv2-radar-ring--outer"></span>
    <span class="fv2-radar-ring fv2-radar-ring--mid"></span>
    <span class="fv2-radar-ring fv2-radar-ring--inner"></span>
    <span class="fv2-radar-sweep"></span>
    <span class="fv2-radar-pulse"></span>
    <span class="fv2-radar-core"></span>
  </div>
</template>
