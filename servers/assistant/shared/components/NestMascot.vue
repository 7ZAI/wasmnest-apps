<script setup lang="ts">
/**
 * Nest 形象
 *
 * 抽象「巢 / 陶碗 + 光点」，没有五官与拟人表情。六种状态靠姿态、描边与光感
 * 区分；动效只是第二通道，关闭后仍能辨认。颜色全部来自主题变量。
 */
import { computed } from 'vue'
import type { MascotState } from '../ui/mascot-state'

const props = withDefaults(
  defineProps<{
    state?: MascotState
    size?: number
    motionEnabled?: boolean
  }>(),
  {
    state: 'idle',
    size: 40,
    motionEnabled: true,
  },
)

const motion = computed(() => (props.motionEnabled ? 'on' : 'off'))
</script>

<template>
  <svg
    class="mascot"
    data-testid="nest-mascot"
    :class="`mascot--${state}`"
    :data-mascot-state="state"
    :data-mascot-motion="motion"
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    role="img"
    aria-hidden="true"
    focusable="false"
  >
    <g class="mascot__shell">
      <path class="mascot__bowl" d="M10 30c0 14 10 23 22 23s22-9 22-23" />
      <path class="mascot__rim" d="M10 30h44" />
      <path class="mascot__top" d="M25 14c2-5 12-5 14 0" />
    </g>

    <g v-if="state === 'tooling'" class="mascot__orbits">
      <circle class="mascot__orbit" cx="32" cy="34" r="19" />
      <circle class="mascot__satellite" cx="51" cy="34" r="2.6" />
    </g>

    <g v-if="state === 'streaming'" class="mascot__rings">
      <circle class="mascot__ring mascot__ring--1" cx="32" cy="34" r="13" />
      <circle class="mascot__ring mascot__ring--2" cx="32" cy="34" r="19" />
    </g>

    <path v-if="state === 'locked'" class="mascot__lid" d="M17 23h30" />

    <circle v-if="state !== 'locked'" class="mascot__core" cx="32" cy="34" r="6" />
    <rect
      v-else
      class="mascot__core mascot__core--locked"
      x="28"
      y="30"
      width="8"
      height="8"
      rx="1.6"
    />

    <g v-if="state === 'thinking'" class="mascot__dots">
      <circle cx="22" cy="22" r="1.8" />
      <circle cx="32" cy="20" r="1.8" />
      <circle cx="42" cy="22" r="1.8" />
    </g>
  </svg>
</template>

<style scoped>
.mascot {
  display: inline-block;
  overflow: visible;
  color: var(--nest-text);
  pointer-events: none;
}

.mascot__bowl {
  fill: var(--nest-primary-soft);
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linejoin: round;
}

.mascot__rim,
.mascot__top {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
}

.mascot__lid {
  fill: none;
  stroke: currentColor;
  stroke-width: 3.6;
  stroke-linecap: round;
}

.mascot__core {
  fill: var(--nest-accent);
  transform-box: fill-box;
  transform-origin: center;
}

.mascot__ring,
.mascot__orbit {
  fill: none;
  stroke: var(--nest-accent);
  stroke-width: 1.6;
}

.mascot__ring {
  opacity: 0.4;
}

.mascot__satellite {
  fill: var(--nest-accent);
}

.mascot__dots circle {
  fill: var(--nest-accent);
}

.mascot--locked {
  color: var(--nest-faint);
}

.mascot--locked .mascot__core {
  fill: var(--nest-faint);
}

.mascot--locked .mascot__rim {
  stroke-width: 3.4;
}

.mascot--error {
  color: var(--nest-danger);
}

.mascot--error .mascot__core {
  fill: var(--nest-danger);
}

.mascot--error .mascot__rim {
  stroke-dasharray: 5 4;
}

.mascot--thinking .mascot__core {
  opacity: 0.55;
}

.mascot--streaming .mascot__core {
  fill: var(--nest-accent);
}

.mascot--tooling .mascot__bowl,
.mascot--tooling .mascot__rim,
.mascot--tooling .mascot__top {
  stroke: var(--nest-accent);
}

.mascot[data-mascot-motion='on'] .mascot__core {
  animation: mascot-breathe 2.6s ease-in-out infinite;
}

.mascot[data-mascot-motion='on'].mascot--thinking .mascot__dots circle {
  animation: mascot-dot 1.2s ease-in-out infinite;
}

.mascot[data-mascot-motion='on'].mascot--thinking .mascot__dots circle:nth-child(2) {
  animation-delay: 0.15s;
}

.mascot[data-mascot-motion='on'].mascot--thinking .mascot__dots circle:nth-child(3) {
  animation-delay: 0.3s;
}

.mascot[data-mascot-motion='on'].mascot--streaming .mascot__ring--1 {
  animation: mascot-ripple 1.6s ease-out infinite;
}

.mascot[data-mascot-motion='on'].mascot--streaming .mascot__ring--2 {
  animation: mascot-ripple 1.6s ease-out infinite 0.4s;
}

.mascot[data-mascot-motion='on'].mascot--tooling .mascot__orbits {
  transform-box: fill-box;
  transform-origin: center;
  animation: mascot-orbit 4s linear infinite;
}

@keyframes mascot-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}

@keyframes mascot-dot {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}

@keyframes mascot-ripple {
  0% {
    opacity: 0.5;
    transform: scale(0.8);
  }
  100% {
    opacity: 0;
    transform: scale(1.25);
  }
}

@keyframes mascot-orbit {
  to {
    transform: rotate(360deg);
  }
}

.mascot[data-mascot-motion='on'] .mascot__ring {
  transform-box: fill-box;
  transform-origin: center;
}

@media (prefers-reduced-motion: reduce) {
  .mascot * {
    animation: none !important;
  }
}
</style>