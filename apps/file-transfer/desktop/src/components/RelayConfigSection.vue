<script setup lang="ts">
/**
 * RelayConfigSection — 设置页「内网穿透」区块（file-transfer 形态改造）
 *
 * 与下方 T12「中继」开关**语义隔离**：
 * - 本区块 = 「怎么接入」（relay 地址 / 空间码 / 来源），真源是穿透配置中心；
 *   本页只读展示 + 分享，**不提供第二份配置编辑器**；导入 / 编辑仍去
 *   「内网穿透」中心（跳转通道）。
 * - T12 开关 = 「用不用外网通道」（拨号策略），语义未变。
 *
 * 分享：把同一份配置画成 `wasmnest://relay-config/…` 二维码（载荷只含 relay
 * 接入信息 + 空间码，不含长期密钥）；移动端在设置页扫码导入。
 *
 * 数据源 = `get-my-device`（后端统一收敛 center / cache / invite / qr / sync
 * 来源与中心错误）；中心不可用时后端回退缓存并回传 `relayError`，本页显性
 * 展示，不伪造「已连接配置中心」。
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import QRCode from 'qrcode'
import { useMyDevice } from '../composables/useMyDevice'
import { buildRelayConfigShare } from '../utils/pairingLink'
import { formatSyncedAt, maskRelayAddr, relaySourceKey, relayStateKey } from '../utils/relayConfig'
import { QR_ERROR_CORRECTION, QR_QUIET_ZONE_MODULES, planQrCanvas } from '../utils/qrRender'

/** appContext 的 `navigate` 扩展（旧宿主不注入时不存在） */
type NavigableContext = PluginContext & { navigate?: (path: string) => boolean }

const context = inject<NavigableContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const my = useMyDevice(context)

/** 地址默认脱敏；点「显示完整地址」才展开（截图 / 投屏时不易暴露完整中继身份） */
const revealed = ref(false)
/** 复制反馈：绑定被复制的地址（就地改按钮文案，2s 后自动清除，不额外占一行） */
const copyState = ref<{ addr: string; ok: boolean } | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

/** 生成的分享载荷（空 = 未生成 / 已失效） */
const sharePayload = ref('')
const shareError = ref<'' | 'relay-missing' | 'build-failed'>('')
const shareGeneratedAt = ref(0)
const qrCanvasRef = ref<HTMLCanvasElement | null>(null)
const navigateUnavailable = ref(false)

onMounted(() => {
  void my.load()
})

const addrs = computed(() => my.info.value.relayAddrs)
const canShare = computed(() => addrs.value.length > 0)

const sourceText = computed(() => t(relaySourceKey(my.info.value.relaySource)))
const stateText = computed(() => t(relayStateKey(my.info.value.relayState)))
const wanPolicyText = computed(() =>
  my.info.value.wanPolicy === 'blocked'
    ? t('transfer.relayConfig.wanBlocked')
    : t('transfer.relayConfig.wanAllowed'),
)
const syncedAtText = computed(() => formatSyncedAt(my.info.value.relaySyncedAt ?? 0))

function displayAddr(addr: string): string {
  return revealed.value ? addr : maskRelayAddr(addr)
}

function clearCopyState(): void {
  copyState.value = null
  if (copyTimer) {
    clearTimeout(copyTimer)
    copyTimer = null
  }
}

/** 复制完整 relay 地址（不是脱敏文本）：核对 / 贴到中心时用得上 */
async function copyAddr(addr: string): Promise<void> {
  clearCopyState()
  try {
    await navigator.clipboard.writeText(addr)
    copyState.value = { addr, ok: true }
  } catch (e) {
    copyState.value = { addr, ok: false }
    console.error('[File Transfer] copy relay address failed:', e)
  }
  copyTimer = setTimeout(clearCopyState, 2000)
}

/** 复制按钮文案：成功 / 失败就地反馈（不新增说明行，窄栏下不挤地址行） */
function copyLabel(addr: string): string {
  if (copyState.value?.addr !== addr) return t('transfer.relayConfig.copy')
  return copyState.value.ok
    ? t('transfer.relayConfig.copied')
    : t('transfer.relayConfig.copyFailed')
}

/**
 * 生成分享载荷：地址取**当前生效**的 relay（中心 / 缓存 / 导入来源），
 * 空间码随载荷带走（空则不写，保持 relay-wide 语义）。
 */
async function handleShare(): Promise<void> {
  shareError.value = ''
  await my.load()
  const data = my.info.value
  if (data.relayAddrs.length === 0) {
    shareError.value = 'relay-missing'
    sharePayload.value = ''
    return
  }
  try {
    shareGeneratedAt.value = Date.now()
    sharePayload.value = buildRelayConfigShare({
      relayAddrs: data.relayAddrs,
      room: data.relayRoom ?? '',
      wanPolicy: data.wanPolicy === 'blocked' ? 'blocked' : 'allowed',
      deviceName: data.deviceName ?? '',
      generatedAt: shareGeneratedAt.value,
    })
  } catch (e) {
    shareError.value = 'build-failed'
    sharePayload.value = ''
    console.error('[File Transfer] build relay config share failed:', e)
  }
}

/** 跳转到「内网穿透」配置中心（旧宿主无导航扩展时显性提示出路） */
function openCenter(): void {
  navigateUnavailable.value = false
  if (typeof context.navigate !== 'function' || !context.navigate('/network')) {
    navigateUnavailable.value = true
  }
}

/**
 * 二维码绘制（幂等）：按实际模块数定画布尺寸——配置载荷（relay + 空间码 +
 * 展示名）通常在 30–50 模块，固定小画布在手机相机下会糊。
 */
async function renderShareQr(payload: string, canvas: HTMLCanvasElement | null): Promise<void> {
  if (!payload || !canvas) return
  // 测试环境（jsdom）没有 2D 上下文：跳过绘制，不把「环境不支持」当失败刷日志
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
    console.error('[File Transfer] render relay config QR failed:', e)
  }
}

watch(
  () => sharePayload.value,
  () => void renderShareQr(sharePayload.value, qrCanvasRef.value),
  { flush: 'post' },
)
watch(qrCanvasRef, () => void renderShareQr(sharePayload.value, qrCanvasRef.value), {
  flush: 'post',
})
</script>

<template>
  <section class="ft-settings-section" data-testid="ft-settings-section-relay-config">
    <h3 class="ft-settings-section-title">{{ t('transfer.relayConfig.title') }}</h3>

    <p v-if="my.loading.value" class="ft-settings-helper" data-testid="ft-relay-config-loading">
      {{ t('transfer.relayConfig.loading') }}
    </p>
    <template v-else-if="my.loadError.value">
      <p class="ft-remote-error" data-testid="ft-relay-config-load-error">
        {{ t('transfer.relayConfig.loadFailed') }}
      </p>
      <div class="ft-settings-row ft-settings-row--right">
        <button class="ft-btn" data-testid="ft-relay-config-retry" @click="my.load()">
          {{ t('transfer.relayConfig.refresh') }}
        </button>
      </div>
    </template>

    <template v-else>
      <!-- 未配置：给出唯一可执行的下一步（去中心导入），不显示空行 -->
      <p
        v-if="addrs.length === 0"
        class="ft-settings-helper ft-settings-helper--warn"
        data-testid="ft-relay-config-empty"
      >
        {{ t('transfer.relayConfig.empty') }}
      </p>
      <div v-else class="ft-relay-config-addrs" data-testid="ft-relay-config-list">
        <!-- 地址独占左侧可换行；复制 / 显隐收进固定操作组，窄栏下也不会拆行 -->
        <div v-for="(addr, idx) in addrs" :key="addr" class="ft-relay-config-addr-row">
          <code class="ft-relay-config-addr" data-testid="ft-relay-config-addr">{{
            displayAddr(addr)
          }}</code>
          <div class="ft-relay-config-addr-actions">
            <button class="ft-text-btn" data-testid="ft-relay-config-copy" @click="copyAddr(addr)">
              {{ copyLabel(addr) }}
            </button>
            <!-- 显隐是列表级开关：多地址时只出现一次（末行），避免重复按钮 -->
            <button
              v-if="idx === addrs.length - 1"
              class="ft-text-btn"
              data-testid="ft-relay-config-reveal"
              @click="revealed = !revealed"
            >
              {{
                revealed ? t('transfer.relayConfig.hideAddr') : t('transfer.relayConfig.showAddr')
              }}
            </button>
          </div>
        </div>
      </div>

      <div class="ft-relay-config-kv">
        <span>{{ t('transfer.relayConfig.source') }}</span>
        <strong data-testid="ft-relay-config-source">{{ sourceText }}</strong>
      </div>
      <div class="ft-relay-config-kv">
        <span>{{ t('transfer.relayConfig.relayState') }}</span>
        <strong data-testid="ft-relay-config-state">{{ stateText }}</strong>
      </div>
      <div class="ft-relay-config-kv">
        <span>{{ t('transfer.relayConfig.wanPolicy') }}</span>
        <strong data-testid="ft-relay-config-wan-policy">{{ wanPolicyText }}</strong>
      </div>
      <div v-if="my.info.value.relayRoom" class="ft-relay-config-kv">
        <span>{{ t('transfer.relayConfig.room') }}</span>
        <code data-testid="ft-relay-config-room">{{ my.info.value.relayRoom }}</code>
      </div>
      <div v-if="syncedAtText" class="ft-relay-config-kv">
        <span>{{ t('transfer.relayConfig.syncedAt') }}</span>
        <strong data-testid="ft-relay-config-synced-at">{{ syncedAtText }}</strong>
      </div>

      <!-- 中心不可用：回退缓存必须显性（不把缓存当中心） -->
      <p
        v-if="my.info.value.relayError"
        class="ft-settings-helper ft-settings-helper--warn"
        data-testid="ft-relay-config-error"
      >
        {{ t('transfer.relayConfig.centerError', { message: my.info.value.relayError }) }}
      </p>

      <div class="ft-settings-row ft-relay-config-actions">
        <button
          class="ft-btn ft-btn--primary"
          :disabled="!canShare"
          data-testid="ft-relay-config-share"
          @click="handleShare"
        >
          {{ t('transfer.relayConfig.share') }}
        </button>
        <button class="ft-btn" data-testid="ft-relay-config-refresh" @click="my.load()">
          {{ t('transfer.relayConfig.refresh') }}
        </button>
        <button class="ft-btn" data-testid="ft-relay-config-open-center" @click="openCenter">
          {{ t('transfer.relayConfig.openCenter') }}
        </button>
      </div>
      <p
        v-if="navigateUnavailable"
        class="ft-settings-helper ft-settings-helper--warn"
        data-testid="ft-relay-config-open-center-unavailable"
      >
        {{ t('transfer.relayConfig.openCenterUnavailable') }}
      </p>
      <p v-if="shareError" class="ft-remote-error" data-testid="ft-relay-config-share-error">
        {{
          shareError === 'relay-missing'
            ? t('transfer.relayConfig.shareRelayMissing')
            : t('transfer.relayConfig.shareFailed')
        }}
      </p>

      <!-- 分享二维码：只含 relay 接入信息 + 空间码，不含长期密钥 -->
      <div v-if="sharePayload" class="ft-relay-config-qr-wrap" data-testid="ft-relay-config-qr">
        <div class="ft-relay-config-qr">
          <canvas ref="qrCanvasRef" class="block"></canvas>
        </div>
        <p class="ft-settings-helper" data-testid="ft-relay-config-qr-hint">
          {{ t('transfer.relayConfig.shareHint') }}
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.ft-relay-config-addrs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.ft-relay-config-addr-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.ft-relay-config-addr-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-top: 3px;
}

.ft-relay-config-addr {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-subtle);
  font-family: Consolas, Monaco, monospace;
  font-size: var(--font-size-tag);
  line-height: 1.5;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.ft-relay-config-kv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--font-size-body);
}

.ft-relay-config-kv > span {
  color: var(--text-secondary);
}

.ft-relay-config-kv code {
  font-family: Consolas, Monaco, monospace;
  font-size: var(--font-size-tag);
  color: var(--text-primary);
}

.ft-relay-config-actions {
  flex-wrap: wrap;
  margin-top: 12px;
}

.ft-relay-config-qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

/* 白色衬底：二维码必须有足够静区与对比度（深色主题下不能依赖页面底色） */
.ft-relay-config-qr {
  padding: 8px;
  border-radius: 10px;
  background: #ffffff;
  line-height: 0;
}

.ft-settings-helper--warn {
  color: var(--color-warning);
}
</style>
