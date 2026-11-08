<script setup lang="ts">
/**
 * ScanPanel — 扫码添加远程设备（T12）
 *
 * 相机取景（`html5-qrcode`，与 bedcode 移动端同依赖）→ 解码文本 →
 * `parseRemotePeerLink` 与粘贴路径**同一解析口径**（连接串 / JSON / QR v2 包装）。
 *
 * 判据：
 * - 非法码不打断扫描（继续等正确码），且不把二维码原文写日志（可能含一次性票据）；
 * - 相机启动失败 / 无权限分开呈现（权限失败给出系统设置出路），不静默留黑屏；
 * - 成功即停扫并上抛 `link`，由父组件落设备缓存（本组件不写存储）。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { Html5Qrcode } from 'html5-qrcode'
import { parseRemotePeerLink, type RemotePeerLink } from '../utils/pairingLink'

type Translate = (key: string, params?: Record<string, any>) => string

const props = defineProps<{ t: Translate }>()
const emit = defineEmits<{
  (e: 'link', link: RemotePeerLink): void
  (e: 'close'): void
}>()

/** 取景容器 id（Html5Qrcode 按 id 挂载） */
const READER_ID = 'ft-qr-reader'
const error = ref<'' | 'failed' | 'permission'>('')

let scanner: Html5Qrcode | null = null
let finished = false

async function stop(): Promise<void> {
  const current = scanner
  scanner = null
  if (!current) return
  try {
    if (current.isScanning) await current.stop()
  } catch {
    // 停止失败不阻断关闭（相机已被系统回收等）
  }
  try {
    current.clear()
  } catch {
    // 容器清理失败忽略
  }
}

async function start(): Promise<void> {
  error.value = ''
  await stop()
  if (finished) return
  try {
    const instance = new Html5Qrcode(READER_ID)
    scanner = instance
    await instance.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (text) => {
        void handleText(text)
      },
      () => {
        // 逐帧未识别：正常扫描过程，不记日志
      },
    )
    // start 期间组件被关闭 / 已识别：相机不得留在运行态
    if (finished) await stop()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    error.value = /permission|notallowed|denied|security/i.test(message) ? 'permission' : 'failed'
    // 只记失败结论，不落二维码原文 / 帧内容
    console.warn('[File Transfer] qr camera start failed:', message)
  }
}

async function handleText(text: string): Promise<void> {
  if (finished) return
  const parsed = parseRemotePeerLink(text)
  if (!parsed.ok) {
    // 非法码继续扫（用户可能对着旧版/无关二维码），原文不回显也不落日志
    return
  }
  finished = true
  await stop()
  emit('link', parsed.link)
}

function close(): void {
  finished = true
  void stop()
  emit('close')
}

function retry(): void {
  void start()
}

onMounted(() => {
  void start()
})

onUnmounted(() => {
  finished = true
  void stop()
})
</script>

<template>
  <div class="ft-scan-overlay" data-testid="mobile-remote-scan">
    <div class="ft-scan-head">
      <span class="ft-scan-title">{{ props.t('transfer.remote.scanTitle') }}</span>
      <button class="fv2-btn-text" data-testid="mobile-scan-close" @click="close()">
        {{ props.t('transfer.remote.scanClose') }}
      </button>
    </div>

    <div class="ft-scan-stage">
      <div :id="READER_ID" class="ft-scan-reader"></div>
      <div v-if="!error" class="ft-scan-frame" aria-hidden="true"></div>
    </div>

    <div v-if="error" class="ft-scan-error" data-testid="mobile-scan-error">
      <p class="ft-scan-error-text">
        {{
          error === 'permission'
            ? props.t('transfer.remote.scanPermission')
            : props.t('transfer.remote.scanFailed')
        }}
      </p>
      <div class="flex items-center gap-2">
        <button class="fv2-btn-text" @click="close()">
          {{ props.t('transfer.remote.scanClose') }}
        </button>
        <button
          class="fv2-btn-text fv2-btn-text--accent"
          data-testid="mobile-scan-retry"
          @click="retry()"
        >
          {{ props.t('transfer.remote.scanRetry') }}
        </button>
      </div>
    </div>

    <p v-else class="ft-scan-hint">{{ props.t('transfer.remote.scanHint') }}</p>
  </div>
</template>
