<script setup lang="ts">
/**
 * 入场密钥代次卡片（`auth-center.keys.status` / `.rotate`）
 *
 * 只展示**代次标识**（`g<n>`），永不展示密钥材料（凭据红线：`kid` 是代次号，
 * 不是密钥片段）。轮换的语义由「当前代次 + 上一代」两行数据本身呈现：
 * 上一代仍在场 = 仍参与验签；不写解释性文案。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { AuthCenterContext } from '../appContext'
import type { KeyRotationView, KeyStatusView } from '../types'

const context = inject<AuthCenterContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const STATUS_COMMAND = 'auth-center.keys.status'
const ROTATE_COMMAND = 'auth-center.keys.rotate'

const status = ref<KeyStatusView | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref(false)

const kidText = computed(() => status.value?.kid || t('status.none'))
const previousText = computed(() => status.value?.previousKid || t('keys.none'))

async function load(): Promise<void> {
  try {
    const payload = await context.appInvoke<KeyStatusView>(STATUS_COMMAND)
    status.value = payload && typeof payload === 'object' ? payload : null
    error.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function rotate(): Promise<void> {
  busy.value = true
  notice.value = null
  try {
    const payload = await context.appInvoke<KeyRotationView>(ROTATE_COMMAND)
    notice.value = t('keys.rotated', { kid: payload?.kid ?? t('status.none') })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="ac-card" data-testid="auth-center-keys">
    <div class="ac-card-head">
      <h2 class="ac-h2">{{ t('keys.title') }}</h2>
      <div class="ac-actions">
        <button class="ac-btn" data-testid="auth-center-keys-refresh" @click="load">
          {{ t('refresh') }}
        </button>
        <button
          class="ac-btn"
          :disabled="busy"
          data-testid="auth-center-keys-rotate"
          @click="rotate"
        >
          {{ t('keys.rotate') }}
        </button>
      </div>
    </div>

    <dl class="ac-meta">
      <div>
        <dt>{{ t('keys.active') }}</dt>
        <dd class="ac-mono" data-testid="auth-center-keys-kid">{{ kidText }}</dd>
      </div>
      <div>
        <dt>{{ t('keys.previous') }}</dt>
        <dd class="ac-mono" data-testid="auth-center-keys-previous">{{ previousText }}</dd>
      </div>
    </dl>

    <p v-if="notice" class="ac-note" data-testid="auth-center-keys-notice">{{ notice }}</p>
    <p v-if="error" class="ac-error" role="alert" data-testid="auth-center-keys-error">
      {{ t('error.body', { message: error }) }}
    </p>
  </section>
</template>
