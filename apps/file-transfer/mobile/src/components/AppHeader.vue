<script setup lang="ts">
/**
 * AppHeader — 应用顶栏：页面标题 + 活跃对端 + 发送入口
 *
 * 一级入口下沉到底栏之后，顶栏的职责收敛成一行三件事：
 *   1. 当前页面是谁（大标题，随底栏切换）：探索连接 / 浏览 / 传输
 *   2. 正在跟谁传（对端胶囊：名称 + 连接状态，整块可点 → 探索连接）
 *   3. 立刻发文件（渐变主按钮；对端离线时置灰）
 *
 * 对端胶囊的 `data-online` 是语言无关状态位，真机 E2E 断它而不断文案
 * （设备语言可能是 zh-CN / en）。
 *
 * 设置不再由顶栏齿轮承担（已收进底栏），顶栏因此回到两区结构：
 * 标题固定、对端可压缩，发送按钮固定靠右——长设备名只截断自己，不挤掉主操作。
 */
defineProps<{
  /** 页面标题（= 底栏一级页文案） */
  title: string
  /** 活跃对端展示名（未连接时由父级给占位文案） */
  peerName: string
  /** 对等连接是否已建立（决定状态点与文案） */
  online: boolean
  onlineLabel: string
  offlineLabel: string
  /** 发送按钮可见文案 */
  sendLabel: string
  /** 发送按钮可访问文案（读屏 / 长按提示） */
  sendAriaLabel: string
  /** 无活跃对端时置灰（无目标不可选文件） */
  sendDisabled: boolean
}>()

defineEmits<{
  (e: 'peer-tap'): void
  (e: 'send'): void
}>()
</script>

<template>
  <header class="fv2-top">
    <h1 class="fv2-top-title">{{ title }}</h1>

    <!-- 对端胶囊：名称 + 连接状态两行，整块可点切到探索连接 -->
    <button class="fv2-peer" data-testid="mobile-ft-peer-chip" @click="$emit('peer-tap')">
      <span class="fv2-peer-avatar" :class="{ 'fv2-peer-avatar--online': online }">
        <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.7"
            d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
          />
        </svg>
        <span class="fv2-peer-pin" aria-hidden="true"></span>
      </span>
      <span class="fv2-peer-copy">
        <span class="fv2-peer-name">{{ peerName }}</span>
        <span
          class="fv2-peer-state"
          :class="{ 'fv2-peer-state--online': online }"
          data-testid="mobile-ft-peer-status"
          :data-online="online ? 'true' : 'false'"
        >
          {{ online ? onlineLabel : offlineLabel }}
        </span>
      </span>
      <svg
        class="fv2-peer-chevron"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- 发送：全程常驻（离线置灰），与传输页空态 CTA 走同一条上传路径 -->
    <button
      class="fv2-send"
      :disabled="sendDisabled"
      :aria-label="sendAriaLabel"
      :title="sendAriaLabel"
      data-testid="mobile-ft-upload"
      @click="$emit('send')"
    >
      <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
        />
      </svg>
      <span>{{ sendLabel }}</span>
    </button>
  </header>
</template>
