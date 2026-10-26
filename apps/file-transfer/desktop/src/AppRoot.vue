<template>
  <!-- File Transfer 独立应用界面（桌面 UI 宿主修正 · 机制 B 挂载包根） -->
  <div class="ft-app-root h-full w-full">
    <FileTransferView />

    <!-- 首连确认弹窗：旧宿主全局弹窗机制（context.ui.showDialog）退役后由
         挂载包自持渲染（useConsent 编排，有请求即开、结清即关） -->
    <Teleport to="body">
      <div v-if="hasRequest" class="ft-consent-overlay" data-ft-consent-overlay>
        <div class="ft-consent-sheet">
          <ConsentDialog />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * File Transfer app 根组件 — 独立应用界面
 *
 * 旧 lib 形态由 index.ts activate 期编排（consentController.start + 宿主弹窗
 * 开关同步）；挂载包形态把编排收敛到本组件：useConsent 随视图生命周期启停，
 * 弹窗自持渲染（不再依赖宿主全局弹窗面）。
 */
import { computed, inject, onBeforeUnmount } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import FileTransferView from './components/FileTransferView.vue'
import ConsentDialog from './components/ConsentDialog.vue'
import { useConsent } from './composables/useConsent'

const context = inject<PluginContext>('pluginContext')!

// 首连确认编排：常驻订阅（不依赖视图内部挂载），有请求即开、结清即关
const consent = useConsent(context)
consent.start()
onBeforeUnmount(() => consent.stop())
const hasRequest = computed(() => consent.currentRequest.value != null)
</script>

<style scoped>
/* 旧宿主全局弹窗的遮罩/卡片形态（showDialog + bodyClass p-5）退役后由挂载包自持 */
.ft-consent-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
}
.ft-consent-sheet {
  width: min(440px, calc(100vw - 48px));
  border-radius: 12px;
  background: var(--bg-elevated, var(--bg-card, #1c1a16));
  padding: 20px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);
}
</style>
