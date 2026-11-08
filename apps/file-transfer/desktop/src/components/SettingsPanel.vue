<script setup lang="ts">
/**
 * SettingsPanel — 插件设置（覆盖层面板）— host-peer 契约版
 *
 * 共享目录列表管理（添加 = 系统多目录选择器，一次可加多个；条目由宿主持久化）、
 * 下载目录、接收策略/超时、安全告知常驻文案。纯展示组件，写操作经 emit 交给父级。
 */
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { Settings } from '../types'
import type { RootItem } from '../composables/useSettings'
import TrustedPeersSection from './TrustedPeersSection.vue'
import AppUpdateSection from '@binblink/wasmnest-plugin-sdk-desktop/ui/app-update'
import NumberField from '@binblink/wasmnest-plugin-sdk-desktop/ui/number-field'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const props = defineProps<{
  settings: Settings
  /** 共享目录条目（宿主 DTO，带 id 供移除寻址） */
  rootItems: RootItem[]
}>()

const emit = defineEmits<{
  (e: 'addRoot'): void
  (e: 'removeRoot', id: string): void
  (e: 'pickDownloadDir'): void
  (e: 'setReceivingPolicy', policy: 'ask' | 'accept' | 'reject'): void
  (e: 'setApprovalTimeoutSec', secs: number): void
  (e: 'setConcurrency', n: number): void
  (e: 'close'): void
}>()

// ==================== v2 接收策略（自绘分段控件，禁原生 select） ====================

/** 策略选项（顺序即展示顺序） */
const POLICY_OPTIONS: Array<{ value: 'ask' | 'accept' | 'reject'; key: string }> = [
  { value: 'ask', key: 'transfer.settings.receivingPolicyAsk' },
  { value: 'accept', key: 'transfer.settings.receivingPolicyAccept' },
  { value: 'reject', key: 'transfer.settings.receivingPolicyReject' },
]

/** 并发上限（1–8，spec §7） */
const MIN_CONCURRENCY = 1
const MAX_CONCURRENCY = 8

/** 同意超时范围（10–600 秒，与 `useSettings.setApprovalTimeoutSec` 的钳制同界） */
const MIN_APPROVAL_TIMEOUT = 10
const MAX_APPROVAL_TIMEOUT = 600

/** 超时输入框 id（与上方 `<label for>` 配对，点标签能聚焦输入框） */
const timeoutInputId = 'ft-approval-timeout'

/** 步进：钳制在 1–8 后 emit */
function stepConcurrency(delta: number): void {
  const next = Math.min(
    MAX_CONCURRENCY,
    Math.max(MIN_CONCURRENCY, props.settings.concurrency + delta),
  )
  emit('setConcurrency', next)
}
/** 超时提交（失焦 / 回车即写；`commit` 已按 10–600 钳制，composable 内再做一次同口径收敛） */
function onTimeoutCommit(secs: number): void {
  emit('setApprovalTimeoutSec', secs)
}
</script>

<template>
  <div class="ft-settings-backdrop" data-testid="ft-settings-panel">
    <div class="ft-settings">
      <div class="ft-topbar">
        <h2 class="ft-settings-title">{{ t('transfer.topbar.settings') }}</h2>
        <div class="ft-spacer"></div>
        <button class="ft-btn" data-testid="ft-settings-close" @click="emit('close')">
          {{ t('transfer.topbar.closeSettings') }}
        </button>
      </div>

      <div class="ft-settings-body">
        <!-- 共享目录 -->
        <section class="ft-settings-section" data-testid="ft-settings-section-roots">
          <h3 class="ft-settings-section-title">{{ t('transfer.settings.sharedRoots') }}</h3>
          <div
            v-if="rootItems.length === 0"
            class="ft-dir-value ft-dir-value--empty ft-dir-value--placeholder"
          >
            {{ t('transfer.settings.noRoots') }}
          </div>
          <div v-else class="ft-root-list">
            <div v-for="root in rootItems" :key="root.id" class="ft-root-item">
              <!-- 完整路径为展示真源（title 悬停可读全文）；缺 path 的旧数据退化用 name -->
              <span class="ft-root-path" :title="root.path || root.name">
                {{ root.path || root.name }}
              </span>
              <button
                class="ft-mini-btn ft-mini-btn--ghost"
                :title="t('transfer.settings.removeRoot')"
                @click="emit('removeRoot', root.id)"
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M18 6L6 18M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div class="ft-settings-row ft-settings-row--push ft-settings-row--right">
            <button class="ft-btn" @click="emit('addRoot')">
              {{ t('transfer.settings.addRoot') }}
            </button>
          </div>
        </section>

        <!-- 下载目录 -->
        <section class="ft-settings-section" data-testid="ft-settings-section-download-dir">
          <h3 class="ft-settings-section-title">{{ t('transfer.settings.downloadDir') }}</h3>
          <div class="ft-settings-row">
            <span
              class="ft-dir-value"
              :class="{ 'ft-dir-value--empty ft-dir-value--placeholder': !settings.downloadDir }"
            >
              {{ settings.downloadDir || t('transfer.settings.noDownloadDir') }}
            </span>
            <button class="ft-btn" @click="emit('pickDownloadDir')">
              {{ t('transfer.settings.chooseDir') }}
            </button>
          </div>
        </section>

        <!-- 接收策略（自绘分段控件，禁原生 select；超时输入仅 ask 时显示） -->
        <section class="ft-settings-section" data-testid="ft-settings-section-policy">
          <h3 class="ft-settings-section-title">{{ t('transfer.settings.receivingPolicy') }}</h3>
          <div class="ft-segmented" role="tablist">
            <button
              v-for="opt in POLICY_OPTIONS"
              :key="opt.value"
              class="ft-segmented-item"
              :class="{ 'ft-segmented-item--active': settings.receivingPolicy === opt.value }"
              role="tab"
              :aria-selected="settings.receivingPolicy === opt.value"
              :data-testid="`ft-policy-${opt.value}`"
              @click="emit('setReceivingPolicy', opt.value)"
            >
              {{ t(opt.key) }}
            </button>
          </div>
          <p class="ft-settings-helper">{{ t('transfer.settings.receivingPolicyHint') }}</p>
          <div
            v-if="settings.receivingPolicy === 'ask'"
            class="ft-settings-row ft-settings-timeout"
            data-testid="ft-settings-timeout"
          >
            <label class="ft-timeout-label" :for="timeoutInputId">
              {{ t('transfer.settings.approvalTimeout') }}
            </label>
            <NumberField
              :input-id="timeoutInputId"
              :model-value="settings.approvalTimeoutSec"
              :min="MIN_APPROVAL_TIMEOUT"
              :max="MAX_APPROVAL_TIMEOUT"
              size="md"
              width="104px"
              data-testid="ft-approval-timeout-input"
              @commit="onTimeoutCommit"
            />
          </div>
        </section>

        <!-- 发送并发上限（同时传输任务数，1–8；增大占用更多带宽） -->
        <section class="ft-settings-section" data-testid="ft-settings-section-concurrency">
          <h3 class="ft-settings-section-title">{{ t('transfer.settings.concurrency') }}</h3>
          <div class="ft-stepper" role="group" :aria-label="t('transfer.settings.concurrency')">
            <button
              class="ft-stepper-btn"
              :disabled="settings.concurrency <= MIN_CONCURRENCY"
              :aria-label="t('transfer.settings.concurrencyMinus')"
              @click="stepConcurrency(-1)"
            >
              −
            </button>
            <span class="ft-stepper-value" aria-live="polite" data-testid="ft-concurrency-value">{{
              settings.concurrency
            }}</span>
            <button
              class="ft-stepper-btn"
              :disabled="settings.concurrency >= MAX_CONCURRENCY"
              :aria-label="t('transfer.settings.concurrencyPlus')"
              @click="stepConcurrency(1)"
            >
              +
            </button>
          </div>
          <p class="ft-settings-helper">{{ t('transfer.settings.concurrencyHint') }}</p>
        </section>

        <!-- 传输加密（固定开启，无关闭开关——穿透方案不变量 12） -->
        <section class="ft-settings-section" data-testid="ft-settings-section-encryption">
          <h3 class="ft-settings-section-title">{{ t('transfer.settings.encryption') }}</h3>
          <div class="ft-segmented">
            <span
              class="ft-segmented-item ft-segmented-item--active ft-segmented-item--static"
              role="status"
              data-testid="ft-encryption-required"
            >
              {{ t('transfer.settings.encryptionAlwaysOn') }}
            </span>
          </div>
          <p class="ft-settings-helper">{{ t('transfer.settings.encryptionHint') }}</p>
        </section>

        <!-- 可信对端管理（spec 决策 8）：独立分区，列表/撤销自包含 -->
        <TrustedPeersSection data-testid="ft-settings-section-trusted" />

        <!-- 版本更新（SDK 默认实现；宿主统一 GitHub Release 判定） -->
        <section class="ft-settings-section" data-testid="ft-settings-section-update">
          <AppUpdateSection />
        </section>

        <!-- 安全告知（spec §10 常驻） -->
        <div class="ft-warning" data-testid="ft-settings-warning">
          <svg class="ft-warning-ico" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"
            />
          </svg>
          <span>{{ t('transfer.settings.encryptionNotice') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
