<script setup lang="ts">
/**
 * 配对码 / 二维码卡片（`auth-center.pairing-code.*` / `auth-center.qr-code.*`）
 *
 * 两条状态机在 Rust 侧是一次的（生成即替换、成功即消费、过期即不可见），页面的
 * 职责只是**如实展示**它此刻的样子：
 * - 没有活跃码 → 显示「当前没有」而不是空串；
 * - 调用失败 → 保留上次成功的码 + 原因上屏（清空会把「读不到」伪装成「没生成」）。
 *
 * 注册切换后本页生成的码就是宿主的配对入口（`/api/auth/*` 由本插件登记），
 * 不会再出现「生成了却配不上」的分叉。
 *
 * 不自动刷新、不轮询：剩余秒数是**取回时刻**的快照，倒计时需要重新取数（刷新按钮）。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { AuthCenterContext } from '../appContext'
import type { PairingCodeView, QrTokenView } from '../types'

const context = inject<AuthCenterContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const CODE_COMMAND = 'auth-center.pairing-code.generate'
const CODE_STATUS = 'auth-center.pairing-code.status'
const CODE_CLEAR = 'auth-center.pairing-code.clear'
const QR_COMMAND = 'auth-center.qr-code.generate'
const QR_STATUS = 'auth-center.qr-code.status'
const QR_CLEAR = 'auth-center.qr-code.clear'

/** 生成时的有效期（秒）：与 bedcode 设备页默认值一致（设置项搬迁后只换来源） */
const DEFAULT_CODE_TTL = 60
const DEFAULT_QR_TTL = 300

const code = ref<PairingCodeView | null>(null)
const qr = ref<QrTokenView | null>(null)
const codeError = ref<string | null>(null)
const qrError = ref<string | null>(null)
const codeBusy = ref(false)
const qrBusy = ref(false)

const codeText = computed(() => code.value?.code ?? t('status.none'))
const codeRemaining = computed(() =>
  code.value ? t('pairing.remaining', { seconds: String(code.value.expires_in) }) : t('status.none'),
)
const qrText = computed(() => qr.value?.token ?? t('status.none'))
const qrRemaining = computed(() =>
  qr.value ? t('pairing.remaining', { seconds: String(qr.value.remaining) }) : t('status.none'),
)

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function refreshCode(): Promise<void> {
  try {
    const payload = await context.appInvoke<PairingCodeView | null>(CODE_STATUS)
    code.value = payload && typeof payload === 'object' ? payload : null
    codeError.value = null
  } catch (e) {
    codeError.value = reasonOf(e)
  }
}

async function refreshQr(): Promise<void> {
  try {
    const payload = await context.appInvoke<QrTokenView | null>(QR_STATUS)
    qr.value = payload && typeof payload === 'object' ? payload : null
    qrError.value = null
  } catch (e) {
    qrError.value = reasonOf(e)
  }
}

async function generateCode(): Promise<void> {
  codeBusy.value = true
  try {
    const payload = await context.appInvoke<PairingCodeView>(CODE_COMMAND, { ttl: DEFAULT_CODE_TTL })
    code.value = payload
    codeError.value = null
  } catch (e) {
    codeError.value = reasonOf(e)
  } finally {
    codeBusy.value = false
  }
}

async function clearCode(): Promise<void> {
  codeBusy.value = true
  try {
    await context.appInvoke(CODE_CLEAR)
    code.value = null
    codeError.value = null
  } catch (e) {
    codeError.value = reasonOf(e)
  } finally {
    codeBusy.value = false
  }
}

async function generateQr(): Promise<void> {
  qrBusy.value = true
  try {
    const payload = await context.appInvoke<QrTokenView>(QR_COMMAND, { ttl: DEFAULT_QR_TTL })
    qr.value = payload
    qrError.value = null
  } catch (e) {
    qrError.value = reasonOf(e)
  } finally {
    qrBusy.value = false
  }
}

async function clearQr(): Promise<void> {
  qrBusy.value = true
  try {
    await context.appInvoke(QR_CLEAR)
    qr.value = null
    qrError.value = null
  } catch (e) {
    qrError.value = reasonOf(e)
  } finally {
    qrBusy.value = false
  }
}

async function refresh(): Promise<void> {
  await Promise.all([refreshCode(), refreshQr()])
}

onMounted(refresh)
</script>

<template>
  <section class="ac-card" data-testid="auth-center-pairing">
    <div class="ac-card-head">
      <h2 class="ac-h2">{{ t('pairing.title') }}</h2>
      <button class="ac-btn" data-testid="auth-center-pairing-refresh" @click="refresh">
        {{ t('refresh') }}
      </button>
    </div>

    <div class="ac-split">
      <div class="ac-block">
        <div class="ac-card-head">
          <h3 class="ac-h3">{{ t('pairing.code.title') }}</h3>
          <div class="ac-actions">
            <button
              class="ac-btn"
              :disabled="codeBusy"
              data-testid="auth-center-pairing-generate"
              @click="generateCode"
            >
              {{ t('pairing.generate') }}
            </button>
            <button
              class="ac-btn"
              :disabled="codeBusy || !code"
              data-testid="auth-center-pairing-clear"
              @click="clearCode"
            >
              {{ t('pairing.clear') }}
            </button>
          </div>
        </div>
        <p class="ac-mono" :class="{ 'is-empty': !code }" data-testid="auth-center-pairing-code">
          {{ codeText }}
        </p>
        <p class="ac-hint" data-testid="auth-center-pairing-code-remaining">
          {{ codeRemaining }}
        </p>
        <p v-if="codeError" class="ac-error" role="alert" data-testid="auth-center-pairing-code-error">
          {{ t('error.body', { message: codeError }) }}
        </p>
      </div>

      <div class="ac-block">
        <div class="ac-card-head">
          <h3 class="ac-h3">{{ t('pairing.qr.title') }}</h3>
          <div class="ac-actions">
            <button
              class="ac-btn"
              :disabled="qrBusy"
              data-testid="auth-center-qr-generate"
              @click="generateQr"
            >
              {{ t('pairing.generate') }}
            </button>
            <button
              class="ac-btn"
              :disabled="qrBusy || !qr"
              data-testid="auth-center-qr-clear"
              @click="clearQr"
            >
              {{ t('pairing.clear') }}
            </button>
          </div>
        </div>
        <p class="ac-mono is-token" :class="{ 'is-empty': !qr }" data-testid="auth-center-qr-token">
          {{ qrText }}
        </p>
        <p class="ac-hint" data-testid="auth-center-qr-remaining">{{ qrRemaining }}</p>
        <p v-if="qrError" class="ac-error" role="alert" data-testid="auth-center-qr-error">
          {{ t('error.body', { message: qrError }) }}
        </p>
      </div>
    </div>
  </section>
</template>
