<script setup lang="ts">
/**
 * AddRemoteDeviceDialog — 添加远程设备（T12 / T23）
 *
 * 两种入口按前缀 / 载荷分流，互不猜语义：
 * - v4 邀请 `wasmnest://join/…`：先解析成 `{relay, room, name}`，弹**确认页**
 *   再落设置（不直接改本机空间）；中心已配置且与邀请不同时显性冲突、不给假成功。
 * - v3 设备链接 `wasmnest://pair/…`：沿用 T12 行为，解析成功即交回父级落设备缓存。
 *
 * 失败必须显性：坏码 / 缺空间码 / 地址非法分开提示；保存失败留在弹层，不静默关闭。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import {
  isConnectionInvite,
  parseConnectionInvite,
  parseRemotePeerLink,
  type ConnectionInvite,
  type ConnectionInviteError,
  type RemotePeerLink,
  type RemotePeerLinkError,
} from '../utils/pairingLink'
import { useConnectionInvite } from '../composables/useConnectionInvite'

/** appContext 的 `navigate` 扩展（旧宿主不注入时不存在） */
type NavigableContext = PluginContext & { navigate?: (path: string) => boolean }

const props = defineProps<{
  /** 当前经中继可见的设备数（确认页展示「当前空间 N 台」） */
  relayDeviceCount?: number
}>()

const emit = defineEmits<{
  (e: 'add', link: RemotePeerLink): void
  (e: 'joined', invite: ConnectionInvite): void
  (e: 'close'): void
}>()

const context = inject<NavigableContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)
const invites = useConnectionInvite(context)

const text = ref('')
const error = ref<RemotePeerLinkError | null>(null)
const inviteError = ref<ConnectionInviteError | null>(null)
const pasteFailed = ref(false)
/** 非 null = 停在邀请确认页（此时不写任何设置） */
const pending = ref<ConnectionInvite | null>(null)
const joining = ref(false)
const joinFailed = ref(false)
const navigateUnavailable = ref(false)

onMounted(() => {
  void invites.loadCurrent()
})

const ERROR_KEYS: Record<RemotePeerLinkError, string> = {
  malformed: 'transfer.remote.errorMalformed',
  incomplete: 'transfer.remote.errorIncomplete',
  'address-invalid': 'transfer.remote.errorAddressInvalid',
}

const INVITE_ERROR_KEYS: Record<ConnectionInviteError, string> = {
  malformed: 'transfer.invite.errorMalformed',
  'missing-room': 'transfer.invite.errorMissingRoom',
  'address-invalid': 'transfer.invite.errorAddressInvalid',
}

const inviteErrorKey = computed(() =>
  inviteError.value ? INVITE_ERROR_KEYS[inviteError.value] : '',
)

/** 中心已配置且与邀请不同：P0 中心优先，自动发现不会工作 */
const conflict = computed(() => (pending.value ? invites.isCenterConflict(pending.value) : false))

/** 本机已在另一个空间：加入后看不到当前空间设备，确认页必须说清楚 */
const leaveRoom = computed(() => {
  const target = pending.value
  const current = invites.current.value
  return Boolean(target && current && current.room && current.room !== target.room)
})

/** 空间码只展示前 8 位（完整值与中继地址不进确认页大段文本） */
const roomPrefix = computed(() => {
  const room = pending.value?.room ?? ''
  return room.length > 8 ? `${room.slice(0, 8)}…` : room
})

const inviteName = computed(() => pending.value?.name || t('transfer.invite.unnamed'))

async function pasteFromClipboard(): Promise<void> {
  pasteFailed.value = false
  try {
    const value = await navigator.clipboard.readText()
    if (!value.trim()) {
      pasteFailed.value = true
      return
    }
    text.value = value
    error.value = null
    inviteError.value = null
  } catch {
    pasteFailed.value = true
  }
}

/** 输入变化即清掉旧错误（两种解析口径分开存，但同一输入框共用） */
function clearInputErrors(): void {
  error.value = null
  inviteError.value = null
}

function submit(): void {
  error.value = null
  inviteError.value = null

  // 先试 v4 邀请（入口不依赖前缀，纯 v4 JSON 粘贴也能识别）
  const joined = parseConnectionInvite(text.value)
  if (joined.ok) {
    pending.value = joined.invite
    joinFailed.value = false
    return
  }
  // 明确是邀请前缀却解析失败：按邀请的细分原因提示，不回退成「设备链接坏」
  if (isConnectionInvite(text.value)) {
    inviteError.value = joined.reason
    return
  }

  const parsed = parseRemotePeerLink(text.value)
  if (!parsed.ok) {
    error.value = parsed.reason
    return
  }
  emit('add', parsed.link)
}

async function join(): Promise<void> {
  const target = pending.value
  if (!target || joining.value || conflict.value) return
  joining.value = true
  joinFailed.value = false
  const ok = await invites.apply(target)
  joining.value = false
  if (!ok) {
    joinFailed.value = true
    return
  }
  emit('joined', target)
}

function cancelConfirm(): void {
  pending.value = null
  joinFailed.value = false
}

/** 跳转到「内网穿透」配置中心（旧宿主无导航扩展时显性提示出路） */
function openCenter(): void {
  navigateUnavailable.value = false
  if (typeof context.navigate !== 'function' || !context.navigate('/network')) {
    navigateUnavailable.value = true
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="ft-remote-overlay" @click.self="emit('close')">
      <div class="ft-remote-sheet" role="dialog" aria-modal="true">
        <div class="ft-confirm-head">
          <span class="ft-dialog-title">{{
            pending ? t('transfer.invite.joinTitle') : t('transfer.remote.title')
          }}</span>
        </div>

        <!-- 邀请确认页：先展示将改什么，再落设置 -->
        <template v-if="pending">
          <div class="ft-invite-confirm" data-testid="ft-invite-confirm">
            <p class="ft-confirm-body" data-testid="ft-invite-confirm-name">
              {{ t('transfer.invite.joinName', { name: inviteName }) }}
            </p>
            <div class="ft-md-kv">
              <span>{{ t('transfer.invite.joinRelay') }}</span>
              <code data-testid="ft-invite-confirm-relay">{{ pending.relay.join(', ') }}</code>
            </div>
            <div class="ft-md-kv">
              <span>{{ t('transfer.invite.joinRoom') }}</span>
              <code data-testid="ft-invite-confirm-room">{{ roomPrefix }}</code>
            </div>
            <div class="ft-md-kv">
              <span>{{ t('transfer.invite.joinDevices') }}</span>
              <strong data-testid="ft-invite-confirm-count">{{
                props.relayDeviceCount ?? 0
              }}</strong>
            </div>

            <p
              v-if="leaveRoom"
              class="ft-md-hint ft-md-hint--warn"
              data-testid="ft-invite-confirm-leave-room"
            >
              {{ t('transfer.invite.joinLeaveRoom') }}
            </p>
            <p
              v-if="conflict"
              class="ft-md-hint ft-md-hint--warn"
              data-testid="ft-invite-confirm-conflict"
            >
              {{ t('transfer.invite.joinConflict') }}
            </p>
            <p
              v-if="navigateUnavailable"
              class="ft-md-hint ft-md-hint--warn"
              data-testid="ft-invite-open-center-unavailable"
            >
              {{ t('transfer.invite.openCenterUnavailable') }}
            </p>
            <p v-if="joinFailed" class="ft-remote-error" data-testid="ft-invite-confirm-save-error">
              {{ t('transfer.invite.joinFailed') }}
            </p>
          </div>

          <div class="ft-dialog-actions">
            <button class="ft-btn" data-testid="ft-invite-confirm-back" @click="cancelConfirm">
              {{ t('transfer.remote.cancel') }}
            </button>
            <button
              v-if="conflict"
              class="ft-btn"
              data-testid="ft-invite-open-center"
              @click="openCenter"
            >
              {{ t('transfer.invite.openCenter') }}
            </button>
            <button
              class="ft-btn ft-btn--primary"
              :disabled="joining || conflict"
              data-testid="ft-invite-join"
              @click="join"
            >
              {{ joining ? t('transfer.invite.joining') : t('transfer.invite.join') }}
            </button>
          </div>
        </template>

        <!-- 输入页：邀请 / 设备链接共用同一个粘贴框 -->
        <template v-else>
          <p class="ft-confirm-body">{{ t('transfer.invite.inputHint') }}</p>
          <p class="ft-confirm-body ft-remote-source" data-testid="ft-remote-add-source">
            {{ t('transfer.remote.sourceHint') }}
          </p>
          <textarea
            v-model="text"
            class="ft-remote-input"
            rows="4"
            :placeholder="t('transfer.invite.placeholder')"
            data-testid="ft-remote-add-input"
            @input="clearInputErrors"
          ></textarea>
          <div class="ft-remote-paste-row">
            <button
              class="ft-text-btn"
              data-testid="ft-remote-add-paste"
              @click="pasteFromClipboard"
            >
              {{ t('transfer.remote.paste') }}
            </button>
            <span
              v-if="pasteFailed"
              class="ft-remote-error"
              data-testid="ft-remote-add-paste-failed"
            >
              {{ t('transfer.remote.pasteFailed') }}
            </span>
          </div>
          <p v-if="error" class="ft-remote-error" data-testid="ft-remote-add-error">
            {{ t(ERROR_KEYS[error]) }}
          </p>
          <p v-if="inviteError" class="ft-remote-error" data-testid="ft-invite-add-error">
            {{ t(inviteErrorKey) }}
          </p>
          <div class="ft-dialog-actions">
            <button class="ft-btn" data-testid="ft-remote-add-cancel" @click="emit('close')">
              {{ t('transfer.remote.cancel') }}
            </button>
            <button
              class="ft-btn ft-btn--primary"
              :disabled="text.trim() === ''"
              data-testid="ft-remote-add-confirm"
              @click="submit"
            >
              {{ t('transfer.remote.confirm') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ft-remote-paste-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.ft-invite-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ft-invite-confirm code {
  word-break: break-all;
  text-align: right;
}
</style>
