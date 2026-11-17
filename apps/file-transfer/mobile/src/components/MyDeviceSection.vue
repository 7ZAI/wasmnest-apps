<script setup lang="ts">
/**
 * MyDeviceSection — 设置页「我的设备」区块（移动端）
 *
 * 形态改造（2026-11-16）：探索连接页不再承载「我的设备」/「添加远程设备」入口，
 * 本机身份信息收敛到设置页——只读展示设备名与设备指纹，供对方设备核对身份。
 * 设备二维码随手工配对入口一并退役（移动端无消费方）；跨网接入配置见下方
 * 「内网穿透配置」区块。
 *
 * 数据源 = `get-my-device`（宿主 `host-peer`）；宿主能力未就绪时显性 unsupported，
 * 不伪造 nodeId / 指纹。
 */
import { computed, inject, onMounted } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { useMyDevice } from '../composables/useMyDevice'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)
const my = useMyDevice(context)

/** 短指纹：前 16 位（完整值在 title 里） */
const shortId = computed(() => (my.info.value.nodeId ?? '').slice(0, 16) || '—')

onMounted(() => {
  void my.load()
})
</script>

<template>
  <section class="space-y-2" data-testid="mobile-settings-section-my-device">
    <h2 class="settings-section-title">{{ t('transfer.myDevice.title') }}</h2>

    <p v-if="my.loading.value" class="settings-desc" data-testid="mobile-my-device-loading">
      {{ t('transfer.myDevice.loading') }}
    </p>
    <template v-else-if="my.loadError.value">
      <p class="ft-my-device-error" data-testid="mobile-my-device-load-error">
        {{ t('transfer.myDevice.loadFailed') }}
      </p>
      <button class="fv2-btn-text" data-testid="mobile-my-device-retry" @click="my.load()">
        {{ t('transfer.myDevice.refresh') }}
      </button>
    </template>

    <!-- 宿主能力未就绪：显性说明，不展示伪造身份 -->
    <p
      v-else-if="!my.info.value.supported"
      class="settings-desc ft-my-device-warn"
      data-testid="mobile-my-device-unsupported"
    >
      {{ t('transfer.myDevice.unsupportedTitle') }}：{{ t('transfer.myDevice.unsupportedBody') }}
    </p>

    <template v-else>
      <div class="settings-group">
        <div class="settings-row">
          <div class="settings-label">{{ t('transfer.myDevice.deviceName') }}</div>
          <div class="settings-value" data-testid="mobile-my-device-name">
            {{ my.info.value.deviceName || t('transfer.myDevice.unnamed') }}
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">{{ t('transfer.myDevice.fingerprint') }}</div>
          <code
            class="settings-value ft-my-device-fp"
            :title="my.info.value.nodeId"
            data-testid="mobile-my-device-fingerprint"
            >{{ shortId }}</code
          >
        </div>
      </div>
      <p class="settings-desc">{{ t('transfer.myDevice.hint') }}</p>
    </template>
  </section>
</template>

<style scoped>
.ft-my-device-fp {
  font-family: Consolas, Monaco, monospace;
  font-size: var(--font-size-xs);
  color: var(--ft-text-secondary);
}

.ft-my-device-warn {
  color: var(--ft-warning, #e5b567);
}

.ft-my-device-error {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--ft-error);
}
</style>
