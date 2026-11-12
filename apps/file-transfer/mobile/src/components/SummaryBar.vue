<script setup lang="ts">
/**
 * SummaryBar — 底部导航上方的上下文行动条（多选 / 活跃传输两态）
 *
 * 一级入口下沉到底栏后，底栏只留四个导航项；「发送」常驻顶栏，于是这里只
 * 承担两件随上下文出现的事：
 *   select — 浏览页勾选了文件：取消选择 + 批量下载（主 CTA）
 *   active — 有正在传输的任务：总体进度 + 速率，整条可点回传输页
 * 空闲（idle）时整条不渲染——没有要说的就不占高度，列表能多显示一张卡。
 *
 * 两态切换用并行交叉渐变（不用 out-in）：离场分支绝对定位退出文档流，
 * 进场分支同帧接管布局，底栏高度不塌陷、不闪烁。
 */
import type { FooterMode } from '../types'

defineProps<{
  /** idle 由父级整条不渲染；这里两种就绪态各占一个分支 */
  mode: FooterMode
  /** select 态：批量下载文案（含数量与总大小） */
  downloadLabel: string
  clearLabel: string
  /** active 态 */
  activeLabel: string
  speedLabel: string
  overallLabel: string
  overallPercent: number
  viewQueueLabel: string
}>()

defineEmits<{
  (e: 'download'): void
  (e: 'clear-selection'): void
  (e: 'open-queue'): void
}>()
</script>

<template>
  <div class="fv2-bar">
    <Transition name="fv2-bar-swap">
      <!-- 多选操作：浏览页勾选后出现 -->
      <div v-if="mode === 'select'" key="select" class="fv2-bar-row">
        <button class="fv2-btn-text flex-shrink-0" @click="$emit('clear-selection')">
          {{ clearLabel }}
        </button>
        <button class="fv2-btn-primary flex-1" @click="$emit('download')">
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          <span class="truncate">{{ downloadLabel }}</span>
        </button>
      </div>

      <!-- 活跃传输：总体进度，整条可点回到传输页 -->
      <button
        v-else-if="mode === 'active'"
        key="active"
        class="fv2-mini"
        @click="$emit('open-queue')"
      >
        <span class="fv2-mini-pulse" aria-hidden="true"></span>
        <div class="fv2-mini-body">
          <div class="fv2-mini-head">
            <span class="fv2-mini-title">{{ activeLabel }}</span>
            <span class="fv2-mini-speed flex-shrink-0">{{ speedLabel }}</span>
          </div>
          <div class="fv2-progress fv2-progress--bar">
            <div
              class="fv2-progress-fill ft-progress-active"
              :style="{ width: overallPercent + '%' }"
            ></div>
          </div>
        </div>
        <span class="fv2-mini-overall flex-shrink-0">{{ overallLabel }}</span>
        <svg
          class="fv2-mini-chevron"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
/* 两态交叉渐变：compositor 友好（仅 opacity），150ms 与全局过渡同节奏；
   离场分支绝对定位（相对 .fv2-bar 的 padding 盒）避免双分支堆叠挤高容器 */
.fv2-bar-swap-enter-active,
.fv2-bar-swap-leave-active {
  transition: opacity 0.15s ease;
}

.fv2-bar-swap-enter-from,
.fv2-bar-swap-leave-to {
  opacity: 0;
}

.fv2-bar-swap-leave-active {
  /* 离场即退出文档流：进场分支同帧接管布局，容器高度不塌陷（防闪烁跳变）；
     pointer-events 防止 150ms 离场窗口内的幽灵点击 */
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
