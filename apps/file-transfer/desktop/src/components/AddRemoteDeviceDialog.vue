<script setup lang="ts">
/**
 * AddRemoteDeviceDialog — 添加远程设备（T12）
 *
 * 无摄像头场景：粘贴 `wasmnest://pair/<base64url>` 连接串或纯 JSON 载荷，
 * 解析成功即把 `{nodeId, addrs}` 交回父组件落设备缓存（不落 ticket）。
 * 解析失败按原因给可操作文案（坏连接串 / 字段缺失 / 地址不可拨号），
 * 不静默吞掉——粘贴后「什么也没发生」是这里最不可接受的失败形态。
 */
import { ref } from 'vue'
import {
  parseRemotePeerLink,
  type RemotePeerLink,
  type RemotePeerLinkError,
} from '../utils/pairingLink'
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const emit = defineEmits<{
  (e: 'add', link: RemotePeerLink): void
  (e: 'close'): void
}>()

const text = ref('')
const error = ref<RemotePeerLinkError | null>(null)

const ERROR_KEYS: Record<RemotePeerLinkError, string> = {
  malformed: 'transfer.remote.errorMalformed',
  incomplete: 'transfer.remote.errorIncomplete',
  'address-invalid': 'transfer.remote.errorAddressInvalid',
}

function submit(): void {
  const parsed = parseRemotePeerLink(text.value)
  if (!parsed.ok) {
    error.value = parsed.reason
    return
  }
  error.value = null
  emit('add', parsed.link)
}
</script>

<template>
  <Teleport to="body">
    <div class="ft-remote-overlay" @click.self="emit('close')">
      <div class="ft-remote-sheet" role="dialog" aria-modal="true">
        <div class="ft-confirm-head">
          <span class="ft-dialog-title">{{ t('transfer.remote.title') }}</span>
        </div>
        <p class="ft-confirm-body">{{ t('transfer.remote.hint') }}</p>
        <textarea
          v-model="text"
          class="ft-remote-input"
          rows="4"
          :placeholder="t('transfer.remote.placeholder')"
          data-testid="ft-remote-add-input"
          @input="error = null"
        ></textarea>
        <p v-if="error" class="ft-remote-error" data-testid="ft-remote-add-error">
          {{ t(ERROR_KEYS[error]) }}
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
      </div>
    </div>
  </Teleport>
</template>
