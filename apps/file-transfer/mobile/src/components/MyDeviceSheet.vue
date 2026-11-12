<script setup lang="ts">
/**
 * MyDeviceSheet — 「我的设备」（T21，移动端）
 *
 * 与「添加远程设备」构成一对：本页产出 `wasmnest://pair/…` 连接串，对端在
 * 添加弹层里粘贴/扫码。连接串只含 nodeId + 可拨 addrs + 展示名，不含长期密钥；
 * relay 端点只在本页的「外网接入」里出现，不进入添加流程。
 *
 * 宿主 `host-peer` 尚未提供 node-info / configure-relay 时显性 unsupported
 * （7ZAI/wasmnest-apps#27），
 * 不伪造 nodeId / addrs；relay 端点仍可预先保存。
 */
import { computed, inject, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { useMyDevice } from '../composables/useMyDevice'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const emit = defineEmits<{
  (e: 'close'): void
}>()

/** 底部安全区（宿主经 provide 注入，与 BottomNav 同源；dev-shell 无注入时退化 0） */
const safeArea = inject<Ref<{ bottom: number; navigationBar?: number }> | undefined>(
  'safeArea',
  undefined,
)
const sheetBottomInset = computed(() => {
  const value = safeArea?.value
  return value?.navigationBar ?? value?.bottom ?? 0
})

const my = useMyDevice(context)

const relayText = ref('')
const copyState = ref<'idle' | 'ok' | 'failed'>('idle')
let copyTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => my.info.value.relayAddrs,
  (addrs) => {
    relayText.value = addrs.join('\n')
  },
  { immediate: true, deep: true },
)

onMounted(() => {
  void my.load()
})

onUnmounted(() => {
  if (copyTimer) clearTimeout(copyTimer)
})

/** 短指纹：前 16 位（完整值在 title 里） */
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

function onRelayInput(): void {
  my.clearRelayFeedback()
}

async function handleCopy(): Promise<void> {
  const ok = await my.copyLink()
  copyState.value = ok ? 'ok' : 'failed'
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copyState.value = 'idle'
  }, 2000)
}

async function handleSaveRelay(): Promise<void> {
  if (my.savingRelay.value) return
  const addrs = relayText.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  try {
    await my.saveRelayAddrs(addrs)
  } catch {
    // my.relayError 已置位并渲染；技术细节只进日志
  }
}

async function handleRefresh(): Promise<void> {
  await my.load()
}
</script>

<template>
  <div class="fv2-sheet-mask" @click.self="emit('close')">
    <div
      class="fv2-sheet fv2-md-sheet"
      data-testid="mobile-my-device"
      :style="{ paddingBottom: `calc(1rem + ${sheetBottomInset}px)` }"
    >
      <div class="fv2-sheet-head">
        <h3 class="fv2-sheet-title">{{ t('transfer.myDevice.title') }}</h3>
        <button
          class="fv2-icon-btn"
          :aria-label="t('transfer.myDevice.close')"
          data-testid="mobile-my-device-close"
          @click="emit('close')"
        >
          <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div class="fv2-md-body">
        <p v-if="my.loading.value" class="fv2-md-hint" data-testid="mobile-my-device-loading">
          {{ t('transfer.myDevice.loading') }}
        </p>
        <template v-else-if="my.loadError.value">
          <p class="fv2-device-error" data-testid="mobile-my-device-load-error">
            {{ t('transfer.myDevice.loadFailed') }}
          </p>
          <button class="fv2-btn-text" data-testid="mobile-my-device-retry" @click="handleRefresh">
            {{ t('transfer.myDevice.refresh') }}
          </button>
        </template>

        <div
          v-else-if="!my.info.value.supported"
          class="fv2-md-notice"
          data-testid="mobile-my-device-unsupported"
        >
          <p class="fv2-md-notice-title">{{ t('transfer.myDevice.unsupportedTitle') }}</p>
          <p class="fv2-md-notice-body">{{ t('transfer.myDevice.unsupportedBody') }}</p>
        </div>

        <template v-else>
          <div class="fv2-md-kv">
            <span>{{ t('transfer.myDevice.deviceName') }}</span>
            <strong>{{ my.info.value.deviceName || t('transfer.myDevice.unnamed') }}</strong>
          </div>
          <div class="fv2-md-kv">
            <span>{{ t('transfer.myDevice.fingerprint') }}</span>
            <code :title="my.info.value.nodeId" data-testid="mobile-my-device-fingerprint">{{
              shortId
            }}</code>
          </div>
          <div class="fv2-md-kv">
            <span>{{ t('transfer.myDevice.relayState') }}</span>
            <strong data-testid="mobile-my-device-relay-state">{{ relayStateText }}</strong>
          </div>
          <div class="fv2-md-kv">
            <span>{{ t('transfer.myDevice.addresses') }}</span>
            <strong data-testid="mobile-my-device-address-count">{{
              my.info.value.addrs?.length ?? 0
            }}</strong>
          </div>

          <label class="fv2-md-label" for="mobile-my-device-link">
            {{ t('transfer.myDevice.linkLabel') }}
          </label>
          <textarea
            id="mobile-my-device-link"
            class="fv2-remote-input fv2-md-link"
            rows="3"
            readonly
            :value="my.link.value"
            data-testid="mobile-my-device-link"
          ></textarea>
          <p v-if="!my.canShare.value" class="fv2-md-hint fv2-md-hint--warn">
            {{ t('transfer.myDevice.linkUnavailable') }}
          </p>
          <p v-else class="fv2-md-hint">{{ t('transfer.myDevice.linkHint') }}</p>
          <button
            class="fv2-btn-primary"
            :disabled="!my.canShare.value"
            data-testid="mobile-my-device-copy"
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
        </template>

        <section class="fv2-md-relay" data-testid="mobile-my-device-relay">
          <h4 class="fv2-md-relay-title">{{ t('transfer.myDevice.relayTitle') }}</h4>
          <p class="fv2-md-hint">{{ t('transfer.myDevice.relayHint') }}</p>
          <textarea
            v-model="relayText"
            class="fv2-remote-input fv2-md-link"
            rows="2"
            :placeholder="t('transfer.myDevice.relayPlaceholder')"
            data-testid="mobile-my-device-relay-input"
            @input="onRelayInput"
          ></textarea>
          <p
            v-if="!my.info.value.capabilities.relayReservation"
            class="fv2-md-hint fv2-md-hint--warn"
            data-testid="mobile-my-device-relay-unsupported"
          >
            {{ t('transfer.myDevice.relayUnsupported') }}
          </p>
          <p
            v-if="my.relaySaved.value"
            class="fv2-md-ok"
            data-testid="mobile-my-device-relay-saved"
          >
            {{ t('transfer.myDevice.relaySaved') }}
          </p>
          <p
            v-if="my.relayError.value"
            class="fv2-device-error"
            data-testid="mobile-my-device-relay-error"
          >
            {{ t('transfer.myDevice.relayError') }}
          </p>
          <button
            class="fv2-btn-text"
            :disabled="my.savingRelay.value"
            data-testid="mobile-my-device-relay-save"
            @click="handleSaveRelay"
          >
            {{ t('transfer.myDevice.relaySave') }}
          </button>
        </section>

        <div class="fv2-md-footer">
          <button
            class="fv2-btn-text"
            :disabled="my.loading.value"
            data-testid="mobile-my-device-refresh"
            @click="handleRefresh"
          >
            {{ t('transfer.myDevice.refresh') }}
          </button>
          <button class="fv2-btn-text" data-testid="mobile-my-device-done" @click="emit('close')">
            {{ t('transfer.myDevice.close') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fv2-md-sheet {
  max-height: 86vh;
  overflow-y: auto;
}

.fv2-md-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fv2-md-kv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.9rem;
}

.fv2-md-kv > span {
  color: var(--text-tertiary, #8a8f98);
}

.fv2-md-kv code {
  font-family: Consolas, Monaco, monospace;
  font-size: 0.78rem;
}

.fv2-md-label {
  font-size: 0.8rem;
  color: var(--text-tertiary, #8a8f98);
}

.fv2-md-link {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font-family: Consolas, Monaco, monospace;
  font-size: 0.78rem;
}

.fv2-md-notice {
  padding: 10px 12px;
  border: 1px solid var(--color-warning, #d97706);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-warning, #d97706) 12%, transparent);
}

.fv2-md-notice-title {
  margin: 0 0 4px;
  font-size: 0.9rem;
  font-weight: 600;
}

.fv2-md-notice-body {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--text-secondary, #5c6370);
}

.fv2-md-hint {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--text-tertiary, #8a8f98);
}

.fv2-md-hint--warn {
  color: var(--color-warning, #d97706);
}

.fv2-md-ok {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-success, #059669);
}

.fv2-md-relay {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.2));
}

.fv2-md-relay-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.fv2-md-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
</style>
