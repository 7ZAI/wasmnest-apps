<template>
  <!-- 分组正文：外层 <section> 与标题由设置页统一渲染 -->
  <div
    class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px] divide-y divide-[var(--border)]"
  >
    <!-- 策略档位：固定 required（不可关闭）。本应用不提供 off / preferred 选择 -->
    <div class="px-5 py-3.5 flex items-start justify-between gap-6">
      <div class="min-w-0">
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">{{
          t('linkCrypto.policy')
        }}</span>
        <p class="text-xs text-[var(--text-tertiary)] mt-0.5">
          {{ t('linkCrypto.policyDesc') }}
        </p>
      </div>
      <span
        data-testid="link-crypto-policy"
        :data-policy="policy"
        :data-enforced="enforced ? 'true' : 'false'"
        class="wb-mono text-[calc(11px*var(--ui-scale))] inline-flex items-center gap-1.5 px-2 h-5 rounded-[6px] flex-shrink-0"
        :class="badgeClass"
      >
        <span class="w-1.5 h-1.5 rounded-full" :class="dotClass"></span>
        {{ badgeText }}
      </span>
    </div>

    <!-- 旧宿主：无按应用策略面（不假装已加密） -->
    <p
      v-if="loadDone && !supported"
      data-testid="link-crypto-unavailable"
      class="px-5 py-3.5 text-xs text-[var(--color-danger-ink)] leading-relaxed"
    >
      {{ t('linkCrypto.capabilityMissing') }}
    </p>

    <template v-else-if="supported">
      <!-- 强制加密无法真正生效：不写库、不宣称已加密（fail-visible） -->
      <p
        v-if="blockReason"
        data-testid="link-crypto-blocked"
        class="px-5 py-3.5 text-xs leading-relaxed text-[var(--color-danger-ink)]"
      >
        {{ blockedText }}
      </p>

      <!-- 可强制但宿主旧值未收紧（自动收紧失败）：显性修复入口 -->
      <div
        v-else-if="!enforced"
        data-testid="link-crypto-repair"
        class="px-5 py-3.5 flex items-start justify-between gap-4"
      >
        <div class="min-w-0 text-xs leading-relaxed text-[var(--color-danger-ink)]">
          <p>{{ t('linkCrypto.repairNeeded', { state: currentStateLabel }) }}</p>
          <p
            v-if="lastError"
            data-testid="link-crypto-error"
            class="wb-mono mt-1 text-[var(--text-tertiary)] break-all"
          >
            {{ t('linkCrypto.enforceFailed') }}: {{ lastError }}
          </p>
        </div>
        <button
          data-testid="link-crypto-enforce"
          class="wb-btn-primary !h-7 !px-2.5 text-[calc(12px*var(--ui-scale))] flex-shrink-0"
          :disabled="busy"
          @click="onEnforce"
        >
          {{ t('linkCrypto.enforce') }}
        </button>
      </div>

      <!-- 已生效 -->
      <p
        v-else
        data-testid="link-crypto-enforced"
        class="px-5 py-3.5 text-xs leading-relaxed text-[var(--text-tertiary)]"
      >
        {{ t('linkCrypto.requiredHint') }}
      </p>
    </template>

    <!-- 本机指纹：供双端人工核对（移动端 pin 展示比对） -->
    <div class="px-5 py-3.5 flex items-center justify-between gap-4">
      <div class="min-w-0">
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">{{
          t('linkCrypto.fingerprint')
        }}</span>
        <p class="text-xs text-[var(--text-tertiary)] mt-0.5">
          {{ t('linkCrypto.fingerprintDesc') }}
        </p>
      </div>
      <span
        data-testid="link-crypto-fingerprint"
        class="wb-mono text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)] flex-shrink-0 truncate"
        >{{ fingerprint ?? '—' }}</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * LinkCryptoSettingsSection — 设置页「链路加密」分组正文（应用自有策略）
 *
 * 归属：链路加密策略属于应用（2026-11-04 用户裁决）。**T07 起固定 `required`**：
 * bedcode 不提供 off / preferred 选择（spec 不变量 12·14「无关闭开关」），本页只
 * 呈现当前状态并在宿主记录仍旧值时自动收紧（`useLinkCryptoStatus.load`）。
 *
 * 三种显性状态，绝不把「没生效」显示成已加密：
 * - 旧宿主无按应用策略面（`supported=false`）→ 提示升级宿主；
 * - 强制档无法真正生效（身份未初始化 / WS 帧加密未接线）→ 说明原因，不写库；
 * - 能生效但宿主旧值未收紧 → 给「立即启用强制加密」修复入口与失败原因。
 */
import { computed, inject, onMounted, ref } from 'vue'
import { useAppI18n } from '@/composables/useAppI18n'
import { useToast } from '@/composables/useToast'
import type { AppMountEnv } from '@/entry'
import { useLinkCryptoStatus } from '@/composables/useLinkCrypto'

const env = inject<AppMountEnv | null>('appEnv', null)
const t = useAppI18n()
const toast = useToast()
const { capabilities, policy, supported, enforced, blockReason, lastError, load, enforce } =
  useLinkCryptoStatus(env?.invoke.bind(env), {
    getPolicy: env?.appLinkCryptoGet?.bind(env),
    setPolicy: env?.appLinkCryptoSet?.bind(env),
  })

/** 加载完成标记：区分「加载中」与「旧宿主缺能力」，避免首帧误报 */
const loadDone = ref(false)
const busy = ref(false)

const badgeText = computed(() =>
  enforced.value ? t('linkCrypto.forced') : t('linkCrypto.forcedPending'),
)
const badgeClass = computed(() =>
  enforced.value
    ? 'bg-[var(--color-success-light)] text-[var(--color-success)]'
    : 'bg-[var(--color-danger-light)] text-[var(--color-danger-ink)]',
)
const dotClass = computed(() =>
  enforced.value ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]',
)

const blockedText = computed(() => {
  switch (blockReason.value) {
    case 'identity-missing':
      return t('linkCrypto.blockedIdentityMissing')
    case 'ws-unsupported':
      return t('linkCrypto.blockedWsUnsupported')
    default:
      return ''
  }
})

/** 宿主当前记录的状态（修复提示里点名，避免只说「未开启」） */
const currentStateLabel = computed(() => {
  switch (policy.value) {
    case 'required':
      return t('linkCrypto.forced')
    case 'preferred':
      return t('linkCrypto.currentPreferred')
    default:
      return t('linkCrypto.currentOff')
  }
})

const fingerprint = computed(() => capabilities.value?.identityFingerprint ?? null)

async function onEnforce(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await enforce()
    toast.success(t('linkCrypto.enforced'))
  } catch {
    // 失败不改本地值：界面继续显示「未生效」与原因，不显示已生效假象
    toast.error(t('linkCrypto.enforceFailed'))
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  // 读取失败不阻断设置页其余部分：能力缺失由说明行显性呈现
  try {
    await load()
  } catch {
    // 保持 supported = false；错误已在宿主只读命令侧记录
  } finally {
    loadDone.value = true
  }
})
</script>
