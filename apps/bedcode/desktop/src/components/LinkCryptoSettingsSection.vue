<template>
  <!-- 分组正文：外层 <section> 与标题由设置页统一渲染 -->
  <div
    class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px] divide-y divide-[var(--border)]"
  >
    <!-- 宿主下限：只读。整机策略归宿主设置页（写入口带宿主凭证），
         应用不参与、也不反推自己端点是否加密（spec §6 / §8）。 -->
    <div class="px-5 py-3.5 flex items-center justify-between gap-4">
      <div class="min-w-0">
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">{{
          t('linkCrypto.floor')
        }}</span>
        <p class="text-xs text-[var(--text-tertiary)] mt-0.5">
          {{ t('linkCrypto.floorDesc') }}
        </p>
      </div>
      <span
        data-testid="link-crypto-floor"
        class="flex-shrink-0 text-[calc(13px*var(--ui-scale))] font-medium"
        :class="floorTone"
        >{{ floorLabel }}</span
      >
    </div>

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
        class="wb-mono text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)] flex-shrink-0 truncate"
        >{{ fingerprint ?? '—' }}</span
      >
    </div>

    <!-- 能力缺失（旧宿主）/ 归属说明：只读面不提供写入口，避免两处开关语义打架 -->
    <p
      v-if="loadDone && !capabilities"
      data-testid="link-crypto-unavailable"
      class="px-5 py-3.5 text-xs text-[var(--color-danger-ink)] leading-relaxed"
    >
      {{ t('linkCrypto.capabilityMissing') }}
    </p>
    <p v-else class="px-5 py-3.5 text-xs text-[var(--text-tertiary)] leading-relaxed">
      {{ t('linkCrypto.hostManaged') }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * LinkCryptoSettingsSection — 设置页「链路加密」分组正文（只读）
 *
 * 归属修正（按应用/端点加密策略 spec §6，2026-11-03）：链路加密**下限**是宿主
 * 安全策略，只能由宿主设置页经宿主凭证门写入；应用不再读写整机开关（旧版这里
 * 的开关会调用无凭证的 `set_traffic_encryption_config`，等于任意应用可关闭全机
 * 加密——issue #45）。应用的安全要求改为在自己的端点注册时声明 `encryption`。
 *
 * 本分组只做两件事：展示宿主当前下限（只读）与本机指纹；旧宿主不返回
 * `get_link_crypto_capabilities` 时显性提示能力缺失，不假定已加密。
 */
import { computed, inject, onMounted, ref } from 'vue'
import { useAppI18n } from '@/composables/useAppI18n'
import type { AppMountEnv } from '@/entry'
import { useLinkCryptoStatus } from '@/composables/useLinkCrypto'

const env = inject<AppMountEnv | null>('appEnv', null)
const t = useAppI18n()
const { capabilities, load } = useLinkCryptoStatus(env?.invoke.bind(env))

/** 加载完成标记：区分「加载中」与「旧宿主缺能力」，避免首帧误报 */
const loadDone = ref(false)

const floorLabel = computed(() => {
  switch (capabilities.value?.floor) {
    case 'required':
      return t('linkCrypto.floorRequired')
    case 'preferred':
      return t('linkCrypto.floorPreferred')
    case 'off':
      return t('linkCrypto.floorOff')
    default:
      return '—'
  }
})

const floorTone = computed(() => {
  switch (capabilities.value?.floor) {
    case 'required':
      return 'text-[var(--color-success-ink)]'
    case 'off':
      return 'text-[var(--color-danger-ink)]'
    default:
      return 'text-[var(--text-secondary)]'
  }
})

const fingerprint = computed(() => capabilities.value?.identity_fingerprint ?? null)

onMounted(async () => {
  // 读取失败不阻断设置页其余部分：能力缺失由说明行显性呈现
  try {
    await load()
  } catch {
    // 保持 capabilities = null；错误已在宿主只读命令侧记录
  } finally {
    loadDone.value = true
  }
})
</script>
