<template>
  <!--
    bedcode app 根组件（独立挂载包形态；桌面 UI 宿主修正 2026-10-17）
    旧 UI（侧边栏工作台形态）下沉为本应用的独立界面：AppLayout（Sidebar + 过渡容器；
    bareWindow 终端独立窗口由布局内部判据裸渲）+ 业务弹窗。
    壳 chrome（标题栏 / 启动画面 / Toaster / 主题 / 热区 / 授权弹窗 / 退出确认）由
    宿主壳承载——本应用只占壳标题栏以下的内容区。
  -->
  <!-- 应用主题根：色板只作用于本容器（宿主壳在挂载槽之外，不被应用主题染色） -->
  <div class="app-theme-root h-full" :data-palette="palette" data-testid="bedcode-root">
    <AppLayout />

    <!-- 任务队列弹窗（票 17：终端工具栏入口打开；fixed overlay 自覆盖视口） -->
    <TaskQueueModal />

    <!-- app 独立包自持 Toaster（宿主 Toaster 是另一 vue-sonner 副本，互不渲染） -->
    <Toaster position="bottom-right" rich-colors expand :visible-toasts="4" />
  </div>
</template>

<script setup lang="ts">
/**
 * bedcode app 根组件 — 独立应用界面（旧侧边栏工作台形态）
 *
 * 与宿主前端下沉期的差异（桌面 UI 宿主修正 2026-10-17）：壳（ShellHost）回到
 * 宿主 `wasmnest-desktop/src/`；本组件不再承载启动画面 / 授权弹窗 / 退出确认 /
 * 全局快捷键（宿主壳态处理），只保留工作台界面 + 业务弹窗 + 应用内快捷键。
 */
import { computed, inject, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Toaster } from 'vue-sonner'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import TaskQueueModal from '@/components/TaskQueueModal.vue'
import AppLayout from '@/components/AppLayout.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { loadAppPalette, useAppPalette } from '@/composables/useAppPalette'

const route = useRoute()
const router = useRouter()

// 主题色板：应用自持（宿主只下发深浅色）；首次挂载从本 app 的 KV 恢复
const context = inject<PluginContext | null>('pluginContext', null)
const { palette } = useAppPalette()

// bareWindow 路由（终端独立窗口）：不套内容区外壳，直接渲染路由视图
const isBareWindow = computed(() => route.meta.bareWindow === true)

// 键盘快捷键：Ctrl+, 打开设置（会话 / 设备页快捷键随各自页面注册）
useKeyboardShortcuts([
  {
    key: ',',
    ctrl: true,
    handler: () => {
      // 终端独立窗口（bareWindow）不响应全局设置快捷键
      if (isBareWindow.value) return
      router.push('/settings')
    },
  },
])

onMounted(() => {
  // 独立窗口（终端窗口）由 TerminalWindowView 自管关闭确认，主窗口关闭守卫归宿主
  if (context?.storage) {
    void loadAppPalette({
      get: (key) => context.storage.get(key),
      set: (key, value) => context.storage.set(key, value),
    })
  }
})

onUnmounted(() => {
  // 卸载路径：entry.ts unmount 已先推回 /sessions；此处无附加清理
})
</script>
