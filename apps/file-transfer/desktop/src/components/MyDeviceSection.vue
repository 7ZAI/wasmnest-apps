<script setup lang="ts">
/**
 * MyDeviceSection — 设置页「我的设备」区块（桌面）
 *
 * 形态改造（2026-11-16）：探索面板不再承载手工配对入口（「添加远程设备」已下线），
 * 原「我的设备」弹层的信息收敛到设置页——只读展示设备名与设备指纹，供对方设备
 * 核对身份。设备二维码随扫码添加入口一并退役（无消费方，不做死 UI）；
 * 跨网接入配置见下方「内网穿透」区块。
 *
 * 数据源 = `get-my-device`（宿主 `host-peer`）；宿主能力未就绪时显性 unsupported，
 * 不伪造 nodeId / 指纹。
 */
import { computed, inject, onMounted } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
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
  <section class="ft-settings-section" data-testid="ft-settings-section-my-device">
    <h3 class="ft-settings-section-title">{{ t('transfer.myDevice.title') }}</h3>

    <p v-if="my.loading.value" class="ft-settings-helper" data-testid="ft-my-device-loading">
      {{ t('transfer.myDevice.loading') }}
    </p>
    <template v-else-if="my.loadError.value">
      <p class="ft-remote-error" data-testid="ft-my-device-load-error">
        {{ t('transfer.myDevice.loadFailed') }}
      </p>
      <div class="ft-settings-row ft-settings-row--right">
        <button class="ft-btn" data-testid="ft-my-device-retry" @click="my.load()">
          {{ t('transfer.myDevice.refresh') }}
        </button>
      </div>
    </template>

    <!-- 宿主能力未就绪：显性说明，不展示伪造身份 -->
    <p
      v-else-if="!my.info.value.supported"
      class="ft-settings-helper ft-settings-helper--warn"
      data-testid="ft-my-device-unsupported"
    >
      {{ t('transfer.myDevice.unsupportedTitle') }}：{{ t('transfer.myDevice.unsupportedBody') }}
    </p>

    <template v-else>
      <div class="ft-md-kv">
        <span>{{ t('transfer.myDevice.deviceName') }}</span>
        <strong data-testid="ft-my-device-name">{{
          my.info.value.deviceName || t('transfer.myDevice.unnamed')
        }}</strong>
      </div>
      <div class="ft-md-kv">
        <span>{{ t('transfer.myDevice.fingerprint') }}</span>
        <code :title="my.info.value.nodeId" data-testid="ft-my-device-fingerprint">{{
          shortId
        }}</code>
      </div>
      <p class="ft-settings-helper">{{ t('transfer.myDevice.hint') }}</p>
    </template>
  </section>
</template>

<style scoped>
.ft-md-kv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--font-size-body);
}

.ft-md-kv > span {
  color: var(--text-secondary);
}

.ft-md-kv code {
  font-family: Consolas, Monaco, monospace;
  font-size: var(--font-size-tag);
  color: var(--text-primary);
}

.ft-settings-helper--warn {
  color: var(--color-warning);
}
</style>
