<script setup lang="ts">
/**
 * PeerHeader — 顶栏：活跃对端 + 连接状态 + 设置入口
 *
 * 对端 chip 整块可点（44px 命中区）→ 切换到设备 tab；连接状态胶囊跟随
 * 插件自身对等连接语义（拨号 + connection-changed 事件维护），
 * 与外部配对认证（宿主主连接）无关——文件传输双端独立连接。
 */
defineProps<{
  /** 活跃对端展示名（未连接时由父组件给占位文案） */
  peerName: string
  /** WS 控制面连接态（决定状态点与文案） */
  online: boolean
  onlineLabel: string
  offlineLabel: string
  /** 上传入口 aria/可访问文案 */
  uploadLabel: string
  /** 设置入口 aria 文案 */
  settingsLabel: string
  /** 对端离线时置灰上传（无活跃对端不可选文件） */
  uploadDisabled: boolean
}>()

defineEmits<{
  (e: 'peer-tap'): void
  (e: 'upload'): void
  (e: 'settings'): void
}>()
</script>

<template>
  <div class="flex-shrink-0 flex items-center gap-1 px-4 pt-3 pb-1">
    <!-- 对端选择器：名称 + 连接状态两行，整块 44px 可点 -->
    <button class="fv2-peer-chip" data-testid="mobile-ft-peer-chip" @click="$emit('peer-tap')">
      <span class="fv2-peer-copy">
        <span class="fv2-peer-name truncate">{{ peerName }}</span>
        <!-- data-online 是语言无关的状态位，真机 E2E 断它（不断言文案：
             设备语言可能是 zh-CN / en） -->
        <span
          class="fv2-peer-state"
          :class="{ 'fv2-peer-state--online': online }"
          data-testid="mobile-ft-peer-status"
          :data-online="online ? 'true' : 'false'"
        >
          <span class="fv2-peer-dot" aria-hidden="true"></span>
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

    <!-- 弹性空隙：把操作按钮推到行尾 -->
    <div class="flex-1 min-w-1"></div>

    <!-- 上传入口：全程常驻，对端离线置灰；与底栏上传 CTA 共享同一路径 -->
    <button
      class="fv2-icon-btn fv2-icon-btn--emphasis"
      :disabled="uploadDisabled"
      :aria-label="uploadLabel"
      :title="uploadLabel"
      data-testid="mobile-ft-upload"
      @click="$emit('upload')"
    >
      <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.8"
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
        />
      </svg>
    </button>

    <!-- 设置入口 -->
    <button
      class="fv2-icon-btn"
      :aria-label="settingsLabel"
      :title="settingsLabel"
      data-testid="mobile-ft-settings"
      @click="$emit('settings')"
    >
      <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.8"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.8"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    </button>
  </div>
</template>
