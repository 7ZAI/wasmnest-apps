<script setup lang="ts">
/**
 * 连接历史卡片（`auth-center.devices.list` / `auth-center.history.list` / `.clear`）
 *
 * 两层取数：设备清单（决定可选范围）→ 选中设备的连接事件。语义纪律：
 * - **设备清单为空 ≠ 读不到**：前者显示「暂无已配对设备」，后者显示原因并保留上次数据；
 * - 历史为空同样分两种：读失败 vs 真的没有记录（不合并成一句「暂无」）；
 * - 认证方式与结果字符串由 Rust 侧按内核常量落库（小写），页面只做文案映射，
 *   映射不到就原样显示——**不要**大小写归一化（那会让真实数据看起来像已知值）。
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import type { AuthCenterContext } from '../appContext'
import type { ConnectionEventView, PairedDeviceView } from '../types'

const context = inject<AuthCenterContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const DEVICES_COMMAND = 'auth-center.devices.list'
const HISTORY_COMMAND = 'auth-center.history.list'
const CLEAR_COMMAND = 'auth-center.history.clear'

const devices = ref<PairedDeviceView[]>([])
const selectedId = ref<string>('')
const events = ref<ConnectionEventView[]>([])
const devicesError = ref<string | null>(null)
const historyError = ref<string | null>(null)
const loading = ref(false)
const clearing = ref(false)

/** 认证方式 → 文案：未知值原样上屏（不猜、不丢弃） */
const METHOD_KEY: Record<string, string> = {
  pairing_code: 'history.method.pairing_code',
  qr: 'history.method.qr',
  biometric: 'history.method.biometric',
  jwt: 'history.method.jwt',
}

function methodText(method: string): string {
  const key = METHOD_KEY[method]
  return key ? t(key) : method
}

const resultText = (result: string): string =>
  result === 'success' ? t('history.result.success') : t('history.result.failed')

const selectedDevice = computed(() => devices.value.find((d) => d.id === selectedId.value) ?? null)

async function loadDevices(): Promise<void> {
  try {
    const payload = await context.appInvoke<PairedDeviceView[]>(DEVICES_COMMAND)
    devices.value = Array.isArray(payload) ? payload : []
    devicesError.value = null
    // 选中项保持（刷新后同一设备仍在册），失效则回落到第一台
    if (!devices.value.some((d) => d.id === selectedId.value)) {
      selectedId.value = devices.value[0]?.id ?? ''
    }
  } catch (e) {
    devicesError.value = e instanceof Error ? e.message : String(e)
  }
}

async function loadHistory(): Promise<void> {
  if (!selectedId.value) {
    events.value = []
    historyError.value = null
    return
  }
  loading.value = true
  try {
    const payload = await context.appInvoke<ConnectionEventView[]>(HISTORY_COMMAND, {
      deviceId: selectedId.value,
    })
    events.value = Array.isArray(payload) ? payload : []
    historyError.value = null
  } catch (e) {
    historyError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function clearHistory(): Promise<void> {
  if (!selectedId.value) return
  clearing.value = true
  try {
    await context.appInvoke(CLEAR_COMMAND, { deviceId: selectedId.value })
    await loadHistory()
  } catch (e) {
    historyError.value = e instanceof Error ? e.message : String(e)
  } finally {
    clearing.value = false
  }
}

async function refresh(): Promise<void> {
  await loadDevices()
  await loadHistory()
}

watch(selectedId, loadHistory)

onMounted(refresh)
</script>

<template>
  <section class="ac-card" data-testid="auth-center-history">
    <div class="ac-card-head">
      <h2 class="ac-h2">{{ t('history.title') }}</h2>
      <div class="ac-actions">
        <button class="ac-btn" :disabled="loading" data-testid="auth-center-history-refresh" @click="refresh">
          {{ loading ? t('loading') : t('refresh') }}
        </button>
        <button
          class="ac-btn"
          :disabled="clearing || !selectedId"
          data-testid="auth-center-history-clear"
          @click="clearHistory"
        >
          {{ t('history.clear') }}
        </button>
      </div>
    </div>

    <p v-if="devicesError" class="ac-error" role="alert" data-testid="auth-center-history-devices-error">
      {{ t('error.body', { message: devicesError }) }}
    </p>

    <template v-else>
      <label class="ac-field">
        <span class="ac-field-label">{{ t('history.device') }}</span>
        <select
          v-model="selectedId"
          class="ac-select"
          :disabled="devices.length === 0"
          data-testid="auth-center-history-device"
        >
          <option v-for="device in devices" :key="device.id" :value="device.id">
            {{ device.deviceName }}
          </option>
        </select>
      </label>
      <p v-if="devices.length === 0" class="ac-hint" data-testid="auth-center-history-empty-devices">
        {{ t('history.noDevices') }}
      </p>
      <p v-else-if="selectedDevice" class="ac-hint" data-testid="auth-center-history-device-meta">
        {{ t('history.deviceMeta', { at: selectedDevice.pairedAt, count: String(selectedDevice.connectCount) }) }}
      </p>

      <p v-if="historyError" class="ac-error" role="alert" data-testid="auth-center-history-error">
        {{ t('error.body', { message: historyError }) }}
      </p>

      <ul v-if="events.length > 0" class="ac-list">
        <li
          v-for="(event, index) in events"
          :key="`${event.connectedAt}:${index}`"
          class="ac-row is-compact"
          data-testid="auth-center-history-item"
          :data-result="event.result"
        >
          <div class="ac-row-main">
            <span class="ac-row-name">{{ methodText(event.authMethod) }}</span>
            <span class="ac-tag" :class="{ 'is-bad': event.result !== 'success' }">
              {{ resultText(event.result) }}
            </span>
          </div>
          <div class="ac-row-meta">
            <span>{{ t('history.at', { at: event.connectedAt }) }}</span>
            <span class="ac-mono is-sub">{{ event.address || t('status.none') }}</span>
          </div>
        </li>
      </ul>
      <p
        v-else-if="!historyError && selectedId"
        class="ac-hint"
        data-testid="auth-center-history-no-events"
      >
        {{ t('history.noEvents') }}
      </p>
    </template>
  </section>
</template>
