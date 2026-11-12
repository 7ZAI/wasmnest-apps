<script setup lang="ts">
/**
 * MyDeviceDialog — 「我的设备」（T21，file-transfer 独立化的分享入口）
 *
 * 与「添加远程设备」构成一对：本页产出 `wasmnest://pair/…` 连接串，对端在
 * 「添加远程设备」里粘贴/扫码。连接串只含 nodeId + 可拨 addrs + 展示名，
 * **不含长期密钥**；relay 端点只在本页的「外网接入」里出现，不进入添加流程。
 *
 * 当前宿主 `host-peer` 尚未提供 node-info / configure-relay 两个原语
 * （7ZAI/wasmnest-apps#27）：
 * 本页显性显示 unsupported（不伪造 nodeId / addrs）。relay 地址真源是
 * 「内网穿透」配置中心（T18）；本页只读展示 + 跳转，不保留第二份编辑器。
 * 宿主能力到位后同一读面自动显示连接串。
 */
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import QRCode from 'qrcode'
import { useMyDevice } from '../composables/useMyDevice'
import { useConnectionInvite } from '../composables/useConnectionInvite'
import { QR_ERROR_CORRECTION, QR_QUIET_ZONE_MODULES, planQrCanvas } from '../utils/qrRender'

/** appContext 的 `navigate` 扩展（旧宿主不注入时不存在） */
type NavigableContext = PluginContext & { navigate?: (path: string) => boolean }

const context = inject<NavigableContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const my = useMyDevice(context)
/** 邀请（v4）：生成 / 轮换 / 复制；与 v3 设备链接并存（后者是兜底） */
const invites = useConnectionInvite(context)

const copyState = ref<'idle' | 'ok' | 'failed'>('idle')
const inviteCopyState = ref<'idle' | 'ok' | 'failed'>('idle')
const roomText = ref('')
const navigateUnavailable = ref(false)
const qrCanvasRef = ref<HTMLCanvasElement | null>(null)
const inviteQrRef = ref<HTMLCanvasElement | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null
let inviteCopyTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  void my.load()
})

watch(
  () => my.info.value.relayRoom,
  (room) => {
    roomText.value = room ?? ''
  },
  { immediate: true },
)

onUnmounted(() => {
  if (copyTimer) clearTimeout(copyTimer)
  if (inviteCopyTimer) clearTimeout(inviteCopyTimer)
})

/** 生成失败原因 → 文案 key（不把后端原文当用户文案） */
const INVITE_ERROR_KEYS: Record<string, string> = {
  'relay-missing': 'transfer.invite.errorRelayMissing',
  'save-failed': 'transfer.invite.errorSaveFailed',
}

const inviteErrorKey = computed(() =>
  invites.error.value ? (INVITE_ERROR_KEYS[invites.error.value] ?? '') : '',
)

/** 短指纹：前 16 位（完整值在 title / 复制链接里） */
const shortId = computed(() => (my.info.value.nodeId ?? '').slice(0, 16))

/** relay 状态词表（与引擎 `RelayState::as_str()` 同字面） */
const RELAY_STATE_KEYS: Record<string, string> = {
  'relay-idle': 'transfer.myDevice.relayIdle',
  'relay-connecting': 'transfer.myDevice.relayConnecting',
  'relay-reserved': 'transfer.myDevice.relayReserved',
  'relay-lost': 'transfer.myDevice.relayLost',
}

const relayStateText = computed(() => {
  const state = my.info.value.relayState
  if (!state) return t('transfer.myDevice.relayUnknown')
  return t(RELAY_STATE_KEYS[state] ?? 'transfer.myDevice.relayUnknown')
})

async function handleCopy(): Promise<void> {
  const ok = await my.copyLink()
  copyState.value = ok ? 'ok' : 'failed'
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copyState.value = 'idle'
  }, 2000)
}

async function handleRefresh(): Promise<void> {
  await my.load()
}

/** 生成邀请：缺空间码时由后端先落一个随机码，再刷新本页展示 */
async function handleGenerateInvite(): Promise<void> {
  await invites.generate()
  if (invites.invite.value) await my.load()
}

/** 轮换空间码：旧邀请仍能进旧房间，但看不到本机（UI 有显性提示） */
async function handleRotateRoom(): Promise<void> {
  await invites.rotateRoom()
  if (invites.invite.value) await my.load()
}

async function handleCopyInvite(): Promise<void> {
  const ok = await invites.copy()
  inviteCopyState.value = ok ? 'ok' : 'failed'
  if (inviteCopyTimer) clearTimeout(inviteCopyTimer)
  inviteCopyTimer = setTimeout(() => {
    inviteCopyState.value = 'idle'
  }, 2000)
}

function onRoomInput(): void {
  my.roomSaved.value = false
  my.roomError.value = ''
}

/** 保存空间码（桌面 relay 地址仍由配置中心管理，这里只编辑房间隔离键） */
async function handleSaveRoom(): Promise<void> {
  if (my.savingRoom.value) return
  try {
    await my.saveRelayRoom(roomText.value)
  } catch {
    // my.roomError 已置位并渲染
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
 * 把当前连接串画到 canvas（幂等；链接缺失 / canvas 未挂载时跳过）。
 *
 * 画布规格按**实际模块数**算——v3 载荷（LAN + circuit）约 85~95 模块，固定
 * 192px 只剩 ~2px/模块，手机相机扫不出（判据见 `utils/qrRender.ts`）。
 */
async function renderQrInto(payload: string, canvas: HTMLCanvasElement | null): Promise<void> {
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
    // `qrcode` 把 CSS 尺寸设成设备像素值：DPR > 1 会被浏览器放大插值，模块边缘糊掉
    canvas.style.width = `${plan.cssSize}px`
    canvas.style.height = `${plan.cssSize}px`
  } catch (e) {
    console.error('[File Transfer] render device QR failed:', e)
  }
}

// 链接变化（生成 / 刷新）与 canvas 重建（解锁后才出现）两个触发点缺一不可
watch(
  () => [my.link.value, invites.invite.value] as const,
  () => {
    void renderQrInto(my.link.value, qrCanvasRef.value)
    void renderQrInto(invites.invite.value, inviteQrRef.value)
  },
  { flush: 'post' },
)
watch(qrCanvasRef, () => void renderQrInto(my.link.value, qrCanvasRef.value), { flush: 'post' })
watch(inviteQrRef, () => void renderQrInto(invites.invite.value, inviteQrRef.value), {
  flush: 'post',
})
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
        <div class="ft-confirm-head ft-md-head">
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
          <!-- 读面加载 / 失败 -->
          <p v-if="my.loading.value" class="ft-confirm-body" data-testid="ft-my-device-loading">
            {{ t('transfer.myDevice.loading') }}
          </p>
          <template v-else-if="my.loadError.value">
            <p class="ft-remote-error" data-testid="ft-my-device-load-error">
              {{ t('transfer.myDevice.loadFailed') }}
            </p>
            <div class="ft-dialog-actions">
              <button class="ft-btn" data-testid="ft-my-device-retry" @click="handleRefresh">
                {{ t('transfer.myDevice.refresh') }}
              </button>
            </div>
          </template>

          <!-- 宿主能力未就绪：显性说明，不展示伪造链接 -->
          <div
            v-else-if="!my.info.value.supported"
            class="ft-md-notice"
            data-testid="ft-my-device-unsupported"
          >
            <p class="ft-md-notice-title">{{ t('transfer.myDevice.unsupportedTitle') }}</p>
            <p class="ft-md-notice-body">{{ t('transfer.myDevice.unsupportedBody') }}</p>
          </div>

          <!-- 能力就绪：身份 / 地址 / relay 状态 + 连接串 -->
          <template v-else>
            <!-- 新的主路径：同一中继自动发现；连接串只给无法共用中继的对端 -->
            <p class="ft-md-hint" data-testid="ft-my-device-auto-discovery">
              {{ t('transfer.myDevice.autoDiscoveryHint') }}
            </p>
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
            <div class="ft-md-kv">
              <span>{{ t('transfer.myDevice.relayState') }}</span>
              <strong data-testid="ft-my-device-relay-state">{{ relayStateText }}</strong>
            </div>
            <div class="ft-md-kv">
              <span>{{ t('transfer.myDevice.addresses') }}</span>
              <strong data-testid="ft-my-device-address-count">{{
                my.info.value.addrs?.length ?? 0
              }}</strong>
            </div>

            <!-- T23：跨网邀请（v4）= relay + 空间码，一次带走；对端扫/粘一次即可 -->
            <section class="ft-md-invite" data-testid="ft-my-device-invite">
              <h3 class="ft-md-relay-title">{{ t('transfer.invite.title') }}</h3>
              <p class="ft-md-hint">{{ t('transfer.invite.hint') }}</p>
              <p
                v-if="!my.info.value.relayAddrs.length"
                class="ft-md-hint ft-md-hint--warn"
                data-testid="ft-my-device-invite-relay-missing"
              >
                {{ t('transfer.invite.errorRelayMissing') }}
              </p>
              <div class="ft-dialog-actions">
                <button
                  class="ft-btn ft-btn--primary"
                  :disabled="invites.busy.value || !my.info.value.relayAddrs.length"
                  data-testid="ft-my-device-invite-generate"
                  @click="handleGenerateInvite"
                >
                  {{
                    invites.busy.value
                      ? t('transfer.invite.generating')
                      : t('transfer.invite.generate')
                  }}
                </button>
              </div>
              <p
                v-if="invites.error.value"
                class="ft-remote-error"
                data-testid="ft-my-device-invite-error"
              >
                {{ t(inviteErrorKey) }}
              </p>

              <template v-if="invites.invite.value">
                <div class="ft-md-qr-wrap" data-testid="ft-my-device-invite-qr">
                  <div class="ft-md-qr">
                    <canvas ref="inviteQrRef" class="block"></canvas>
                  </div>
                  <p class="ft-md-hint">{{ t('transfer.invite.qrHint') }}</p>
                </div>
                <textarea
                  class="ft-remote-input ft-md-link"
                  rows="3"
                  readonly
                  :value="invites.invite.value"
                  data-testid="ft-my-device-invite-link"
                ></textarea>
                <div class="ft-dialog-actions">
                  <button
                    class="ft-btn"
                    data-testid="ft-my-device-invite-copy"
                    @click="handleCopyInvite"
                  >
                    {{
                      inviteCopyState === 'ok'
                        ? t('transfer.invite.copied')
                        : inviteCopyState === 'failed'
                          ? t('transfer.invite.copyFailed')
                          : t('transfer.invite.copy')
                    }}
                  </button>
                  <button
                    class="ft-btn"
                    :disabled="invites.busy.value"
                    data-testid="ft-my-device-invite-rotate"
                    @click="handleRotateRoom"
                  >
                    {{ t('transfer.invite.rotate') }}
                  </button>
                </div>
                <p
                  class="ft-md-hint ft-md-hint--warn"
                  data-testid="ft-my-device-invite-rotate-hint"
                >
                  {{ t('transfer.invite.rotateHint') }}
                </p>
              </template>
            </section>

            <div v-if="my.canShare.value" class="ft-md-qr-wrap" data-testid="ft-my-device-qr">
              <div class="ft-md-qr">
                <canvas ref="qrCanvasRef" class="block"></canvas>
              </div>
              <p class="ft-md-hint">{{ t('transfer.myDevice.qrHint') }}</p>
            </div>

            <label class="ft-md-link-label" for="ft-my-device-link">
              {{ t('transfer.myDevice.linkLabel') }}
            </label>
            <textarea
              id="ft-my-device-link"
              class="ft-remote-input ft-md-link"
              rows="4"
              readonly
              :value="my.link.value"
              data-testid="ft-my-device-link"
            ></textarea>
            <p v-if="!my.canShare.value" class="ft-md-hint ft-md-hint--warn">
              {{ t('transfer.myDevice.linkUnavailable') }}
            </p>
            <p v-else class="ft-md-hint">{{ t('transfer.myDevice.linkHint') }}</p>
            <div class="ft-dialog-actions">
              <button
                class="ft-btn ft-btn--primary"
                :disabled="!my.canShare.value"
                data-testid="ft-my-device-copy"
                @click="handleCopy"
              >
                {{
                  copyState === 'ok'
                    ? t('transfer.myDevice.copied')
                    : copyState === 'failed'
                      ? t('transfer.myDevice.copyFailed')
                      : t('transfer.myDevice.copy')
                }}
              </button>
            </div>
          </template>

          <!-- 外网接入：地址真源在「内网穿透」配置中心，本页只读 + 跳转 -->
          <section class="ft-md-relay" data-testid="ft-my-device-relay">
            <h3 class="ft-md-relay-title">{{ t('transfer.myDevice.relayTitle') }}</h3>
            <p class="ft-md-hint">{{ t('transfer.myDevice.relayHint') }}</p>

            <p
              v-if="my.info.value.relaySource === 'center' && my.info.value.relayAddrs.length === 0"
              class="ft-md-hint"
              data-testid="ft-my-device-relay-center-empty"
            >
              {{ t('transfer.myDevice.relayCenterEmpty') }}
            </p>
            <ul
              v-else-if="my.info.value.relayAddrs.length"
              class="ft-md-relay-list"
              data-testid="ft-my-device-relay-list"
            >
              <li v-for="addr in my.info.value.relayAddrs" :key="addr">
                <code>{{ addr }}</code>
              </li>
            </ul>

            <p
              v-if="my.info.value.relaySource === 'cache'"
              class="ft-md-hint ft-md-hint--warn"
              data-testid="ft-my-device-relay-cache"
            >
              {{ t('transfer.myDevice.relaySourceCache') }}
            </p>
            <p
              v-if="my.info.value.relayError"
              class="ft-md-hint ft-md-hint--warn"
              data-testid="ft-my-device-relay-center-error"
            >
              {{ t('transfer.myDevice.relayCenterError', { message: my.info.value.relayError }) }}
            </p>

            <label class="ft-md-link-label" for="ft-my-device-room">
              {{ t('transfer.myDevice.relayRoomLabel') }}
            </label>
            <input
              id="ft-my-device-room"
              v-model="roomText"
              class="ft-remote-input"
              :placeholder="t('transfer.myDevice.relayRoomPlaceholder')"
              data-testid="ft-my-device-room-input"
              @input="onRoomInput"
            />
            <p class="ft-md-hint">{{ t('transfer.myDevice.relayRoomHint') }}</p>
            <p v-if="my.roomSaved.value" class="ft-md-hint" data-testid="ft-my-device-room-saved">
              {{ t('transfer.myDevice.relayRoomSaved') }}
            </p>
            <p
              v-if="my.roomError.value"
              class="ft-remote-error"
              data-testid="ft-my-device-room-error"
            >
              {{ t('transfer.myDevice.relayRoomError') }}
            </p>
            <div class="ft-dialog-actions">
              <button
                class="ft-btn"
                :disabled="my.savingRoom.value"
                data-testid="ft-my-device-room-save"
                @click="handleSaveRoom"
              >
                {{ t('transfer.myDevice.relayRoomSave') }}
              </button>
              <button class="ft-btn" data-testid="ft-my-device-open-center" @click="openCenter">
                {{ t('transfer.myDevice.relayOpenCenter') }}
              </button>
            </div>
            <p
              v-if="navigateUnavailable"
              class="ft-md-hint ft-md-hint--warn"
              data-testid="ft-my-device-open-center-unavailable"
            >
              {{ t('transfer.myDevice.relayOpenUnavailable') }}
            </p>

            <p
              v-if="!my.info.value.capabilities.relayReservation"
              class="ft-md-hint ft-md-hint--warn"
              data-testid="ft-my-device-relay-unsupported"
            >
              {{ t('transfer.myDevice.relayUnsupported') }}
            </p>
          </section>
        </div>

        <div class="ft-dialog-actions ft-md-footer">
          <button
            class="ft-btn"
            :disabled="my.loading.value"
            data-testid="ft-my-device-refresh"
            @click="handleRefresh"
          >
            {{ t('transfer.myDevice.refresh') }}
          </button>
          <button
            class="ft-btn ft-btn--primary"
            data-testid="ft-my-device-done"
            @click="emit('close')"
          >
            {{ t('transfer.myDevice.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ft-md-sheet {
  width: min(560px, calc(100vw - 32px));
  max-height: min(760px, calc(100vh - 48px));
  overflow-y: auto;
}

.ft-md-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ft-md-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

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

.ft-md-link-label {
  font-size: var(--font-size-label);
  color: var(--text-secondary);
}

.ft-md-link {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font-family: Consolas, Monaco, monospace;
  font-size: var(--font-size-tag);
}

.ft-md-notice {
  padding: 10px 12px;
  border: 1px solid var(--color-warning);
  border-radius: 8px;
  background: var(--color-warning-light);
}

.ft-md-notice-title {
  margin: 0 0 4px;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
}

.ft-md-notice-body {
  margin: 0;
  font-size: var(--font-size-tag);
  line-height: 1.5;
  color: var(--text-secondary);
}

.ft-md-hint {
  margin: 0;
  font-size: var(--font-size-tag);
  line-height: 1.5;
  color: var(--text-tertiary);
}

.ft-md-hint--warn {
  color: var(--color-warning);
}

.ft-md-ok {
  margin: 0;
  font-size: var(--font-size-tag);
  color: var(--color-success);
}

.ft-md-relay {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.ft-md-relay-title {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
}

.ft-md-relay-list {
  margin: 0;
  padding: 8px 10px;
  list-style: none;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-subtle);
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-wrap: anywhere;
}

.ft-md-relay-list code {
  font-family: Consolas, Monaco, monospace;
  font-size: var(--font-size-tag);
  color: var(--text-secondary);
}

.ft-md-qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

/* 白色衬底：二维码必须有足够静区与对比度（深色主题下不能依赖页面底色） */
.ft-md-qr {
  padding: 8px;
  border-radius: 10px;
  background: #ffffff;
  line-height: 0;
}

.ft-md-footer {
  margin-top: 12px;
}
</style>
