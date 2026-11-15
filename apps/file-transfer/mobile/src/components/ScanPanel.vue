<script setup lang="ts">
/**
 * ScanPanel — 扫码导入穿透配置（设置页）
 *
 * 相机流与帧循环自持（`../scan/`，与 BedCode 同判据的副本）：每帧按多档解码
 * （原生 BarcodeDetector 优先，ZXing 全尺寸 / 降采样 / ROI 放大）。
 *
 * 判据：
 * - 只认穿透配置分享（`wasmnest://relay-config/`）；其它码继续扫，不打断；
 * - 非法码不打断扫描，且不把二维码原文写日志（可能含配置信息）；
 * - 相机启动失败 / 无权限分开呈现（权限失败给出系统设置出路），不静默留黑屏；
 * - 成功即停扫并上抛 `relay-config`，由设置页确认后导入；
 * - 连续 10s 未命中给一条非阻断提示（不停止相机、不改错误态）。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import {
  parseRelayConfigShare,
  parseRemotePeerLink,
  type RelayConfigShare,
  type RemotePeerLink,
} from '../utils/pairingLink'
import { useCameraStream } from '../scan/useCameraStream'
import { useQrScanLoop } from '../scan/useQrScanLoop'
import {
  createScanHintState,
  noteScanHit,
  startScanHint,
  suppressScanHint,
  tickScanHint,
} from '../scan/scanHint'

type Translate = (key: string, params?: Record<string, any>) => string

const props = defineProps<{
  t: Translate
  /**
   * 扫描目标：
   * - `device`（缺省）= 设备二维码导入；扫到穿透配置分享时提示去设置导入；
   * - `relay-config` = 只认穿透配置分享（设置页导入用），其它码继续扫。
   */
  mode?: 'device' | 'relay-config'
}>()
const emit = defineEmits<{
  /** 设备二维码（v3）：交给父组件落设备缓存 */
  (e: 'link', link: RemotePeerLink): void
  /** 穿透配置分享（v1）：交给设置页确认后导入 */
  (e: 'relay-config', share: RelayConfigShare): void
  (e: 'close'): void
}>()

/** 二维码原文只在内存里交给解析器；日志只记失败结论 */
const logger = {
  warn: (message: string) => console.warn('[File Transfer] scan:', message),
}

const videoRef = ref<HTMLVideoElement | null>(null)
const error = ref<'' | 'failed' | 'permission'>('')
const hintVisible = ref(false)

let hint = createScanHintState()
let finished = false
let disposed = false

const loop = useQrScanLoop({
  logger,
  onResult: (text) => void handleText(text),
  onMiss: () => {
    // 只在可见性变化时写 ref，避免 10fps 的响应式抖动
    const visible = tickScanHint(hint, Date.now())
    if (visible !== hintVisible.value) hintVisible.value = visible
  },
})

const camera = useCameraStream({
  logger,
  onError: (kind) => {
    // 错误面板已说明问题，不再叠加「靠近一点」
    suppressScanHint(hint)
    hintVisible.value = false
    error.value = kind === 'permission' ? 'permission' : 'failed'
    loop.stop()
  },
})

async function start(): Promise<void> {
  const video = videoRef.value
  if (!video || disposed) return
  error.value = ''
  finished = false
  hint = startScanHint(createScanHintState(), Date.now())
  hintVisible.value = false

  const ok = await camera.attach(video)
  if (!ok || disposed) {
    camera.stop()
    return
  }
  await loop.start(video)
  if (disposed) {
    loop.stop()
    camera.stop()
  }
}

function finishScan(): void {
  finished = true
  loop.stop()
  camera.stop()
  noteScanHit(hint)
  hintVisible.value = false
}

async function handleText(text: string): Promise<void> {
  if (finished) return

  // 穿透配置分享：两种扫描目标都先识别（设置页直接导入；设备流程提示去处）
  const relayConfig = parseRelayConfigShare(text)
  if (relayConfig.ok) {
    finishScan()
    emit('relay-config', relayConfig.share)
    return
  }
  // 设置页只收穿透配置：其它码继续等正确码
  if (props.mode === 'relay-config') return

  const parsed = parseRemotePeerLink(text)
  if (!parsed.ok) {
    // 非法码继续扫（用户可能对着旧版/无关二维码），原文不回显也不落日志
    return
  }
  finishScan()
  emit('link', parsed.link)
}

function close(): void {
  finished = true
  loop.stop()
  camera.stop()
  emit('close')
}

function retry(): void {
  void start()
}

onMounted(() => {
  void start()
})

onUnmounted(() => {
  disposed = true
  finished = true
  loop.stop()
  camera.dispose()
})
</script>

<template>
  <div class="ft-scan-overlay" data-testid="mobile-remote-scan">
    <div class="ft-scan-head">
      <span class="ft-scan-title">{{
        props.mode === 'relay-config'
          ? props.t('transfer.relayConfig.scanTitle')
          : props.t('transfer.devices.scanTitle')
      }}</span>
      <button class="fv2-btn-text" data-testid="mobile-scan-close" @click="close()">
        {{ props.t('transfer.relayConfig.scanClose') }}
      </button>
    </div>

    <div class="ft-scan-stage">
      <video ref="videoRef" class="ft-scan-video" playsinline muted autoplay></video>
      <div v-if="!error" class="ft-scan-frame" aria-hidden="true"></div>
    </div>

    <div v-if="error" class="ft-scan-error" data-testid="mobile-scan-error">
      <p class="ft-scan-error-text">
        {{
          error === 'permission'
            ? props.t('transfer.relayConfig.scanPermission')
            : props.t('transfer.relayConfig.scanFailed')
        }}
      </p>
      <div class="flex items-center gap-2">
        <button class="fv2-btn-text" @click="close()">
          {{ props.t('transfer.relayConfig.scanClose') }}
        </button>
        <button
          class="fv2-btn-text fv2-btn-text--accent"
          data-testid="mobile-scan-retry"
          @click="retry()"
        >
          {{ props.t('transfer.relayConfig.scanRetry') }}
        </button>
      </div>
    </div>

    <template v-else>
      <p class="ft-scan-hint">
        {{
          props.mode === 'relay-config'
            ? props.t('transfer.relayConfig.scanHint')
            : props.t('transfer.devices.scanHint')
        }}
      </p>
      <p v-if="hintVisible" class="ft-scan-hint" data-testid="mobile-scan-slow-hint">
        {{ props.t('transfer.relayConfig.scanHintSlow') }}
      </p>
    </template>
  </div>
</template>
