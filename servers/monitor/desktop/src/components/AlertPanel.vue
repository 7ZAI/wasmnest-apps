<script setup lang="ts">
/**
 * 预警面板（桌面）：活动预警 + 最近解除 + 阈值设置。
 *
 * 预警的判定在 `utils/alerts.ts`（纯引擎），本组件只负责呈现与编辑设置；
 * 阈值改动经 `update` 事件交给 `useAlertSettings` 归一化后落盘。
 */
import { computed, inject } from 'vue'
import type { MonitorAppContext } from '../appContext'
import type { Alert, AlertSettings, PluginRow, ResolvedAlert } from '../types'
import { alertMessage, resolvedMessage } from '../utils/alerts'
import { formatNumber } from '../utils/format'

const props = defineProps<{
  alerts: Alert[]
  resolved: ResolvedAlert[]
  settings: AlertSettings
  rows: PluginRow[]
  settingsWarning: string | null
  notifyWarning: string | null
}>()

const emit = defineEmits<{
  (e: 'update', patch: Partial<AlertSettings>): void
  (e: 'reset'): void
}>()

const context = inject<MonitorAppContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const names = computed(() => new Map(props.rows.map((row) => [row.id, row.name])))
const nameOf = (id: string): string => names.value.get(id) ?? id

const textOf = (alert: Alert): { title: string; body: string } => alertMessage(alert, { t, nameOf })

const resolvedTextOf = (alert: ResolvedAlert): { title: string; body: string } =>
  resolvedMessage(alert, { t, nameOf }, alert.resolvedAt)

/** 持续时长（秒）：以当前时钟为准（event 型预警的 updatedAt 只随新增刷新，
 * 不能用它算年龄）；本组件每次轮询都会收到新数组而重渲染。 */
function ageText(alert: Alert): string {
  return t('monitor.alerts.age', {
    seconds: formatNumber(Math.max(0, Date.now() - alert.since) / 1000),
  })
}

const MIB = 1024 * 1024

function percentOf(ratio: number): number {
  return Math.round(ratio * 100)
}

function mibOf(bytes: number): number {
  return Math.round(bytes / MIB)
}

/** 平台内存阈值按 MiB 编辑（0 = 关闭），落盘仍是字节 */
function onMib(
  field: 'platformMemoryWarnBytes' | 'platformMemoryCriticalBytes',
  event: Event,
): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  emit('update', { [field]: Math.max(0, raw) * MIB } as Partial<AlertSettings>)
}

function onNumber(field: keyof AlertSettings, event: Event, scale = 1): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  emit('update', { [field]: raw / scale } as Partial<AlertSettings>)
}

function onToggle(field: keyof AlertSettings, event: Event): void {
  emit('update', { [field]: (event.target as HTMLInputElement).checked } as Partial<AlertSettings>)
}

/**
 * 数字框失焦：把非法 / 被夹紧的输入回写成设置里的权威值
 *
 * 用 `input[type=text] + inputmode=numeric`（原生 number 步进器禁用于本仓 UI 规范）：
 * 非法文本不会触发 `update`，若不回写，输入框会停在无法保存的文本上。
 */
function syncInput(event: Event, value: number): void {
  const input = event.target as HTMLInputElement
  if (Number(input.value) !== value) input.value = String(value)
}
</script>

<template>
  <div class="mn-alerts" data-testid="monitor-alerts">
    <div
      v-if="props.alerts.length > 0"
      class="mn-alert-list"
      role="list"
      data-testid="monitor-alert-list"
    >
      <article
        v-for="alert in props.alerts"
        :key="alert.id"
        class="mn-alert"
        :class="`is-${alert.level}`"
        role="listitem"
        :data-testid="`monitor-alert-${alert.id}`"
      >
        <span class="mn-alert-flag">
          <span
            class="mn-state-dot"
            :class="`is-${alert.level === 'critical' ? 'danger' : 'warning'}`"
            aria-hidden="true"
          ></span>
          {{ t(`monitor.alerts.level.${alert.level}`) }}
        </span>
        <div class="mn-alert-body">
          <p class="mn-alert-title">{{ textOf(alert).title }}</p>
          <p class="mn-alert-detail">{{ textOf(alert).body }}</p>
          <p class="mn-alert-meta">
            <span v-if="alert.target" class="mn-alert-target">{{ alert.target }}</span>
            <span>{{ ageText(alert) }}</span>
          </p>
        </div>
      </article>
    </div>

    <p v-else class="mn-alerts-empty" data-testid="monitor-alerts-empty">
      {{ props.settings.enabled ? t('monitor.alerts.empty') : t('monitor.alerts.disabled') }}
    </p>

    <p
      v-if="props.notifyWarning"
      class="mn-alert-warning is-standalone"
      data-testid="monitor-alerts-notify-warning"
    >
      {{ props.notifyWarning }}
    </p>

    <div
      v-if="props.resolved.length > 0"
      class="mn-alerts-resolved"
      data-testid="monitor-alerts-resolved"
    >
      <span class="mn-alerts-resolved-title">{{ t('monitor.alerts.recentResolved') }}</span>
      <ul class="mn-alerts-resolved-list">
        <li v-for="item in props.resolved" :key="`${item.id}-${item.resolvedAt}`">
          <span class="mn-alert-flag is-resolved">{{ t('monitor.alerts.level.resolved') }}</span>
          <span class="mn-alert-resolved-text">{{ resolvedTextOf(item).body }}</span>
        </li>
      </ul>
    </div>

    <details class="mn-alert-settings" data-testid="monitor-alerts-settings">
      <summary class="mn-alert-settings-summary" data-testid="monitor-alerts-settings-summary">
        {{ t('monitor.alerts.settings') }}
      </summary>

      <div class="mn-alert-settings-body">
        <label class="mn-alert-field">
          <input
            type="checkbox"
            :checked="props.settings.enabled"
            data-testid="monitor-alert-enabled"
            @change="onToggle('enabled', $event)"
          />
          <span>{{ t('monitor.alerts.enabled') }}</span>
        </label>

        <label class="mn-alert-field">
          <input
            type="checkbox"
            :checked="props.settings.notify"
            data-testid="monitor-alert-notify"
            @change="onToggle('notify', $event)"
          />
          <span>{{ t('monitor.alerts.notify') }}</span>
        </label>
        <p class="mn-alert-field-hint">{{ t('monitor.alerts.notifyHint') }}</p>

        <label class="mn-alert-field is-number">
          <span>{{ t('monitor.alerts.platformMemoryWarn') }}</span>
          <input
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :value="mibOf(props.settings.platformMemoryWarnBytes)"
            data-testid="monitor-alert-platform-warn"
            @change="onMib('platformMemoryWarnBytes', $event)"
            @blur="syncInput($event, mibOf(props.settings.platformMemoryWarnBytes))"
          />
        </label>

        <label class="mn-alert-field is-number">
          <span>{{ t('monitor.alerts.platformMemoryCritical') }}</span>
          <input
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :value="mibOf(props.settings.platformMemoryCriticalBytes)"
            data-testid="monitor-alert-platform-critical"
            @change="onMib('platformMemoryCriticalBytes', $event)"
            @blur="syncInput($event, mibOf(props.settings.platformMemoryCriticalBytes))"
          />
        </label>
        <p class="mn-alert-field-hint">{{ t('monitor.alerts.bytesHint') }}</p>

        <label class="mn-alert-field is-number">
          <span>{{ t('monitor.alerts.pluginMemoryWarn') }}</span>
          <input
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :value="percentOf(props.settings.pluginMemoryWarn)"
            data-testid="monitor-alert-plugin-warn"
            @change="onNumber('pluginMemoryWarn', $event, 100)"
            @blur="syncInput($event, percentOf(props.settings.pluginMemoryWarn))"
          />
        </label>

        <label class="mn-alert-field is-number">
          <span>{{ t('monitor.alerts.computeWarn') }}</span>
          <input
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :value="props.settings.computeWarnFuelPerSecond"
            data-testid="monitor-alert-compute-warn"
            @change="onNumber('computeWarnFuelPerSecond', $event)"
            @blur="syncInput($event, props.settings.computeWarnFuelPerSecond)"
          />
        </label>
        <p class="mn-alert-field-hint">{{ t('monitor.alerts.computeHint') }}</p>

        <p
          v-if="props.settingsWarning"
          class="mn-alert-warning"
          data-testid="monitor-alerts-settings-warning"
        >
          {{ t('monitor.alerts.settingsWarning') }}
          <span class="mn-alert-warning-detail">{{ props.settingsWarning }}</span>
        </p>
        <button
          type="button"
          class="mn-alert-reset"
          data-testid="monitor-alert-reset"
          @click="emit('reset')"
        >
          {{ t('monitor.alerts.reset') }}
        </button>
      </div>
    </details>
  </div>
</template>
