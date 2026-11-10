<script setup lang="ts">
/**
 * Agent 官方图标（移动端）
 *
 * 图元真源见 `../icons.ts`（与桌面端同一份品牌 path / 固定品牌色，测试锁同步）。
 * 内置四家渲染各自官方标；后端有、本表未登记的 agent 回退通用机器人占位。
 * 字体 / 底色走移动端 token 与品牌低透明度底色，不随主题改品牌色。
 */
import { computed } from 'vue'
import { agentGlyph, isBrandAgent } from '../icons'

const props = withDefaults(
  defineProps<{
    /** Agent id（claude / codex / opencode / pi / 后端新增 id…） */
    agentId: string
    /** 芯片边长（px），默认 34（与桌面概览卡片同档） */
    size?: number
  }>(),
  { size: 34 },
)

const glyph = computed(() => agentGlyph(props.agentId))
const brandClass = computed(() =>
  isBrandAgent(props.agentId) ? `agent-icon--${props.agentId}` : 'agent-icon--generic',
)
const boxStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${Math.round(props.size * 0.26)}px`,
}))
</script>

<template>
  <span
    class="agent-icon"
    :class="brandClass"
    :style="boxStyle"
    :title="agentId"
    role="img"
    :aria-label="agentId"
  >
    <svg
      :viewBox="glyph.viewBox"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        v-for="(p, i) in glyph.paths"
        :key="i"
        :d="p.d"
        :fill="p.fill ?? glyph.color"
        :fill-rule="p.rule ?? 'nonzero'"
      />
    </svg>
  </span>
</template>

<style scoped>
.agent-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--mobile-chip-zinc-bg);
}

.agent-icon svg {
  width: 58%;
  height: 58%;
}

/* 品牌底色：低透明度同色派生（与桌面 CliIcon 的 brand-* chip 同值）。
   品牌色是标识而非语义色，不随主题切换。 */
.agent-icon--claude {
  background: rgba(217, 119, 87, 0.16);
}

.agent-icon--pi {
  background: rgba(245, 158, 11, 0.16);
}

.agent-icon--codex {
  background: rgba(99, 168, 248, 0.16);
}

.agent-icon--opencode {
  background: rgba(250, 178, 131, 0.16);
}

.agent-icon--generic {
  color: var(--mobile-text-secondary);
}
</style>
