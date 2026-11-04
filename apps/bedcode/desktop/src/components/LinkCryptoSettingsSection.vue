<template>
  <!-- 分组正文：外层 <section> 与标题由设置页统一渲染 -->
  <div
    class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px] divide-y divide-[var(--border)]"
  >
    <!-- 策略三档：off / preferred / required（覆盖本应用全部 HTTP / WS 端点） -->
    <div class="px-5 py-3.5 flex items-start justify-between gap-6">
      <div class="min-w-0">
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">{{
          t('linkCrypto.policy')
        }}</span>
        <p class="text-xs text-[var(--text-tertiary)] mt-0.5">
          {{ t('linkCrypto.policyDesc') }}
        </p>
      </div>
      <div
        data-testid="link-crypto-policy"
        class="flex items-center gap-1 rounded-[8px] border border-[var(--border-strong)] p-0.5 flex-shrink-0"
        role="group"
        :aria-label="t('linkCrypto.policy')"
      >
        <button
          v-for="opt in options"
          :key="opt.value"
          :data-testid="`link-crypto-policy-${opt.value}`"
          class="px-2.5 py-1 rounded-[6px] text-[calc(12px*var(--ui-scale))] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            policy === opt.value
              ? opt.value === 'off'
                ? 'bg-[var(--color-warning-light)] text-[var(--color-warning-ink)]'
                : 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          "
          :aria-pressed="supported && policy === opt.value"
          :disabled="isDisabled(opt.value)"
          @click="select(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- 能力缺失（旧宿主）/ 当前策略语义 -->
    <p
      v-if="loadDone && !supported"
      data-testid="link-crypto-unavailable"
      class="px-5 py-3.5 text-xs text-[var(--color-danger-ink)] leading-relaxed"
    >
      {{ t('linkCrypto.capabilityMissing') }}
    </p>
    <p
      v-else-if="supported"
      data-testid="link-crypto-hint"
      class="px-5 py-3.5 text-xs leading-relaxed"
      :class="policy === 'off' ? 'text-[var(--color-danger-ink)]' : 'text-[var(--text-tertiary)]'"
    >
      {{ hint }}
    </p>

    <!-- 旧宿主不支持 WS 帧级加密：策略只对 HTTP 生效（绝不把 WS 明文说成已加密） -->
    <p
      v-if="supported && !wsSession"
      data-testid="link-crypto-ws-gap"
      class="px-5 py-3.5 text-xs leading-relaxed text-[var(--text-tertiary)]"
    >
      {{ t('linkCrypto.wsNotEncrypted') }}
    </p>

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
 * 归属（2026-11-04 用户裁决，修正 2026-11-03 的宿主只读）：链路加密策略**属于应用**。
 * 本页决定 off / preferred / required，覆盖 bedcode 全部 HTTP / WS 端点；写入经
 * AppMountEnv.appLinkCryptoSet（app 通道令牌绑定本应用，宿主只执行）。宿主不设
 * 整机下限，也没有宿主设置页开关——bedcode 的设置就是 bedcode 的策略。
 *
 * 旧宿主（不注入 appLinkCryptoGet/Set / 能力缺 appScopedPolicy）显性提示不可用，
 * 不假装已加密；保存失败保持原值并提示，不显示「已生效」假象。
 */
import { computed, inject, onMounted, ref } from 'vue'
import { useAppI18n } from '@/composables/useAppI18n'
import { useToast } from '@/composables/useToast'
import type { AppMountEnv } from '@/entry'
import { useLinkCryptoStatus, type EncryptionPolicy } from '@/composables/useLinkCrypto'

const env = inject<AppMountEnv | null>('appEnv', null)
const t = useAppI18n()
const toast = useToast()
const { capabilities, policy, supported, load, save } = useLinkCryptoStatus(env?.invoke.bind(env), {
  getPolicy: env?.appLinkCryptoGet?.bind(env),
  setPolicy: env?.appLinkCryptoSet?.bind(env),
})

/** 加载完成标记：区分「加载中」与「旧宿主缺能力」，避免首帧误报 */
const loadDone = ref(false)
const busy = ref(false)

const options = computed<Array<{ value: EncryptionPolicy; label: string }>>(() => [
  { value: 'off', label: t('linkCrypto.policyOff') },
  { value: 'preferred', label: t('linkCrypto.policyPreferred') },
  { value: 'required', label: t('linkCrypto.policyRequired') },
])

const hint = computed(() => {
  switch (policy.value) {
    case 'required':
      return t('linkCrypto.requiredHint')
    case 'preferred':
      return t('linkCrypto.preferredHint')
    default:
      return t('linkCrypto.offHint')
  }
})

const fingerprint = computed(() => capabilities.value?.identityFingerprint ?? null)
const wsSession = computed(() => capabilities.value?.wsSession === true)

/**
 * `required` 仅在宿主能力 `wsSession=false`（旧宿主，WS 升级期协商未接线）时禁用：
 * 旧宿主的有 WS 端点应用选它会让所有 WS 客户端在升级前被拒。
 */
function isDisabled(value: EncryptionPolicy): boolean {
  if (!supported.value || busy.value) return true
  return value === 'required' && !wsSession.value
}

async function select(next: EncryptionPolicy): Promise<void> {
  if (!supported.value || busy.value || next === policy.value) return
  busy.value = true
  try {
    await save(next)
    toast.success(t('linkCrypto.saved'))
  } catch {
    // 失败不改本地值：界面不显示「已生效」的假象
    toast.error(t('linkCrypto.saveFailed'))
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
