<script setup lang="ts">
/**
 * 可信设备卡片（`auth-center.trust.list` / `.revoke`）
 *
 * 统一视图 = 认证记录库的 pairing 段 + 宿主 peer trust_store 的 peer 段（Rust 侧
 * 合并、排序、三态撤销裁决）。页面只做三件事：
 * 1. 逐条展示（`kind` 是判别字段，两种来源的寻址 ID 语义不同，必须可见）；
 * 2. 撤销（成功即从列表消失——软删后不再出现在活跃集合里）；
 * 3. **peer 段失败不算整体失败**：`peerError` 单独上屏，pairing 段照常可用
 *    （静默吞掉会让人以为「这台机器没有可信对端」）。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { AuthCenterContext } from '../appContext'
import type { TrustedDeviceView } from '../types'

const context = inject<AuthCenterContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const LIST_COMMAND = 'auth-center.trust.list'
const REVOKE_COMMAND = 'auth-center.trust.revoke'

const devices = ref<TrustedDeviceView[]>([])
const peerError = ref<string | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const revoking = ref<string | null>(null)

const countText = computed(() => t('trust.count', { count: String(devices.value.length) }))

async function load(): Promise<void> {
  loading.value = true
  try {
    const payload = await context.appInvoke<{
      devices?: TrustedDeviceView[]
      peerError?: string | null
    }>(LIST_COMMAND)
    devices.value = Array.isArray(payload?.devices) ? payload.devices : []
    peerError.value = payload?.peerError ?? null
    error.value = null
  } catch (e) {
    // 读不到 ≠ 没有设备：保留上次成功的数据，原因上屏
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function revoke(device: TrustedDeviceView): Promise<void> {
  revoking.value = device.id
  try {
    await context.appInvoke(REVOKE_COMMAND, { id: device.id })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    revoking.value = null
  }
}

onMounted(load)
</script>

<template>
  <section class="ac-card" data-testid="auth-center-trust">
    <div class="ac-card-head">
      <h2 class="ac-h2">{{ t('trust.title') }}</h2>
      <div class="ac-actions">
        <span class="ac-tag" data-testid="auth-center-trust-count">{{ countText }}</span>
        <button class="ac-btn" :disabled="loading" data-testid="auth-center-trust-refresh" @click="load">
          {{ loading ? t('loading') : t('refresh') }}
        </button>
      </div>
    </div>

    <p v-if="error" class="ac-error" role="alert" data-testid="auth-center-trust-error">
      {{ t('error.body', { message: error }) }}
    </p>
    <p v-if="peerError" class="ac-note" data-testid="auth-center-trust-peer-error">
      {{ t('trust.peerError', { message: peerError }) }}
    </p>

    <ul v-if="devices.length > 0" class="ac-list">
      <li
        v-for="device in devices"
        :key="`${device.kind}:${device.id}`"
        class="ac-row"
        :data-testid="`auth-center-trust-item-${device.id}`"
        :data-kind="device.kind"
      >
        <div class="ac-row-main">
          <span class="ac-row-name">{{ device.name || device.id }}</span>
          <span class="ac-tag">{{ t(`trust.kind.${device.kind}`) }}</span>
        </div>
        <div class="ac-row-meta">
          <span class="ac-mono is-sub" :data-testid="`auth-center-trust-fp-${device.id}`">
            {{ device.fingerprint || device.fingerprintShort || t('status.none') }}
          </span>
          <span>{{ t('trust.addedAt', { at: device.addedAt }) }}</span>
        </div>
        <button
          class="ac-btn"
          :disabled="revoking === device.id"
          :data-testid="`auth-center-trust-revoke-${device.id}`"
          @click="revoke(device)"
        >
          {{ t('trust.revoke') }}
        </button>
      </li>
    </ul>
    <p v-else-if="!error" class="ac-hint" data-testid="auth-center-trust-empty">
      {{ t('trust.empty') }}
    </p>
  </section>
</template>
