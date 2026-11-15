<script setup lang="ts">
/**
 * MyDeviceDialog — 「我的设备」二维码（桌面生成，移动端扫码导入）
 *
 * 只产出设备二维码（v3：nodeId + 可拨地址 + 展示名，不含长期密钥）。
 * 粘贴连接串与 v4 邀请已退役；宿主未提供 node-info 时显性 unsupported，
 * 不伪造 nodeId / addrs。
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import QRCode from 'qrcode'
import { useMyDevice } from '../composables/useMyDevice'
import { QR_ERROR_CORRECTION, QR_QUIET_ZONE_MODULES, planQrCanvas } from '../utils/qrRender'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const my = useMyDevice(context)
const qrCanvasRef = ref<HTMLCanvasElement | null>(null)

/** 短指纹：前 16 位（完整值在 title 里） */
const shortId = computed(() => (my.info.value.nodeId ?? '').slice(0, 16))

onMounted(() => {
  void my.load()
})

function handleRefresh(): void {
  void my.load()
}

/** 二维码绘制（幂等）：按实际模块数定画布尺寸，避免手机相机扫不出 */
async function renderQr(payload: string, canvas: HTMLCanvasElement | null): Promise<void> {
  if (!payload || !canvas) return
  if (typeof canvas.getContext !== 'function') return
  try {
    const { modules } = QRCode.create(payload, { errorCorrectionLevel: QR_ERROR_CORRECTION })
    const plan = planQrCanvas(modules.size, window.devicePixelRatio)
    await QRCode.toCanvas(canvas, payload, {
      width: plan.size,
      margin: QR_QUIET_ZONE_MODULES,
      errorCorrectionLevel: QR_ERROR_CORRECTION,
      color: { dark: '#000000', light: '#ffffff' },
    })
    canvas.style.width = `${plan.cssSize}px`
    canvas.style.height = `${plan.cssSize}px`
  } catch (e) {
    console.error('[File Transfer] render device QR failed:', e)
  }
}

watch(
  () => my.link.value,
  () => void renderQr(my.link.value, qrCanvasRef.value),
  { flush: 'post' },
)
watch(qrCanvasRef, () => void renderQr(my.link.value, qrCanvasRef.value), { flush: 'post' })
</script>

<template>
  <Teleport to="body">
    <div class="ft-remote-overlay" @click.self="emit('close')">
      <div
        class="ft-remote-sheet ft-md-sheet"
        role="dialog"
        aria-modal="true"
        data-testid="ft-my-device"
      >
        <div class="ft-md-head">
          <span class="ft-dialog-title">{{ t('transfer.myDevice.title') }}</span>
          <button
            class="ft-text-btn"
            :aria-label="t('transfer.myDevice.close')"
            data-testid="ft-my-device-close"
            @click="emit('close')"
          >
            ×
          </button>
        </div>

        <div class="ft-md-body">
          <p v-if="my.loading.value" class="ft-md-hint" data-testid="ft-my-device-loading">
            {{ t('transfer.myDevice.loading') }}
          </p>
          <template v-else-if="my.loadError.value">
            <p class="ft-remote-error" data-testid="ft-my-device-load-error">
              {{ t('transfer.myDevice.loadFailed') }}
            </p>
            <div class="ft-md-actions">
              <button class="ft-btn" data-testid="ft-my-device-retry" @click="handleRefresh">
                {{ t('transfer.myDevice.refresh') }}
              </button>
            </div>
          </template>

          <!-- 宿主能力未就绪：显性说明，不展示伪造二维码 -->
          <div
            v-else-if="!my.info.value.supported"
            class="ft-md-notice"
            data-testid="ft-my-device-unsupported"
          >
            <p class="ft-md-notice-title">{{ t('transfer.myDevice.unsupportedTitle') }}</p>
            <p class="ft-md-hint">{{ t('transfer.myDevice.unsupportedBody') }}</p>
          </div>

          <template v-else>
            <div class="ft-md-kv">
              <span>{{ t('transfer.myDevice.deviceName') }}</span>
              <strong>{{ my.info.value.deviceName || t('transfer.myDevice.unnamed') }}</strong>
            </div>
            <div class="ft-md-kv">
              <span>{{ t('transfer.myDevice.fingerprint') }}</span>
              <code :title="my.info.value.nodeId" data-testid="ft-my-device-fingerprint">{{
                shortId
              }}</code>
            </div>

            <div v-if="my.canShare.value" class="ft-md-qr-wrap" data-testid="ft-my-device-qr">
              <div class="ft-md-qr">
                <canvas ref="qrCanvasRef"></canvas>
              </div>
              <p class="ft-md-hint">{{ t('transfer.myDevice.qrHint') }}</p>
            </div>
            <p v-else class="ft-md-hint ft-md-hint--warn" data-testid="ft-my-device-qr-unavailable">
              {{ t('transfer.myDevice.qrUnavailable') }}
            </p>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ft-md-sheet {
  width: min(420px, calc(100vw - 2rem));
}
.ft-md-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.ft-md-body {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}
.ft-md-kv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8rem;
}
.ft-md-kv > span {
  color: var(--text-secondary, #a4a9b3);
}
.ft-md-kv code {
  font-family: ui-monospace, monospace;
}
.ft-md-qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.ft-md-qr {
  padding: 0.625rem;
  border-radius: 0.5rem;
  background: #fff;
}
.ft-md-qr canvas {
  display: block;
}
.ft-md-hint {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--text-secondary, #a4a9b3);
  text-align: center;
}
.ft-md-hint--warn {
  color: var(--warning, #e5b567);
}
.ft-md-notice {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.ft-md-notice-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
}
.ft-md-actions {
  display: flex;
  gap: 0.5rem;
}
</style>
