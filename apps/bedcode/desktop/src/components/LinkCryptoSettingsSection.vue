<template>
  <!-- 分组正文：外层 <section> 与标题由设置页统一渲染 -->
  <div
    class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px] divide-y divide-[var(--border)]"
  >
    <!-- 主开关：默认关（opt-in），关时全服务明文与现状一致 -->
    <div class="px-5 py-3.5 flex items-center justify-between gap-4">
      <div class="min-w-0">
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">{{
          t('linkCrypto.master')
        }}</span>
      </div>
      <button
        class="relative w-10 h-5 rounded-[4px] border transition-colors flex-shrink-0"
        :class="
          config?.enabled
            ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
            : 'bg-[var(--bg-page)] border-[var(--border-strong)]'
        "
        role="switch"
        :aria-checked="config?.enabled ?? false"
        @click="update({ enabled: !config?.enabled })"
      >
        <span
          class="absolute top-[3px] w-3 h-3 rounded-[2px] transition-all"
          :class="
            config?.enabled
              ? 'left-[22px] bg-[var(--color-primary-contrast)]'
              : 'left-[3px] bg-[var(--border-strong)]'
          "
        />
      </button>
    </div>

    <!-- 通道子开关：主开关关时置灰不可点（粒度收窄是显式动作） -->
    <div
      v-for="channel in channels"
      :key="channel.field"
      class="px-5 py-3.5 flex items-center justify-between gap-4"
      :class="{ 'opacity-50': !config?.enabled }"
    >
      <div class="min-w-0">
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">{{
          t(channel.labelKey)
        }}</span>
      </div>
      <button
        class="relative w-10 h-5 rounded-[4px] border transition-colors flex-shrink-0 disabled:cursor-not-allowed"
        :class="
          config?.[channel.field]
            ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
            : 'bg-[var(--bg-page)] border-[var(--border-strong)]'
        "
        role="switch"
        :aria-checked="config?.[channel.field] ?? false"
        :disabled="!config?.enabled"
        @click="update({ [channel.field]: !config?.[channel.field] })"
      >
        <span
          class="absolute top-[3px] w-3 h-3 rounded-[2px] transition-all"
          :class="
            config?.[channel.field]
              ? 'left-[22px] bg-[var(--color-primary-contrast)]'
              : 'left-[3px] bg-[var(--border-strong)]'
          "
        />
      </button>
    </div>

    <!-- 明文回退：关掉后非环回未协商请求一律拒绝（强加密模式） -->
    <div
      class="px-5 py-3.5 flex items-center justify-between gap-4"
      :class="{ 'opacity-50': !config?.enabled }"
    >
      <div class="min-w-0">
        <span class="text-[calc(13px*var(--ui-scale))] text-[var(--text-primary)]">{{
          t('linkCrypto.plaintextFallback')
        }}</span>
        <p class="text-xs text-[var(--text-tertiary)] mt-0.5">
          {{ t('linkCrypto.plaintextFallbackDesc') }}
        </p>
      </div>
      <button
        class="relative w-10 h-5 rounded-[4px] border transition-colors flex-shrink-0 disabled:cursor-not-allowed"
        :class="
          config?.allow_plaintext_fallback
            ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
            : 'bg-[var(--bg-page)] border-[var(--border-strong)]'
        "
        role="switch"
        :aria-checked="config?.allow_plaintext_fallback ?? false"
        :disabled="!config?.enabled"
        @click="update({ allow_plaintext_fallback: !config?.allow_plaintext_fallback })"
      >
        <span
          class="absolute top-[3px] w-3 h-3 rounded-[2px] transition-all"
          :class="
            config?.allow_plaintext_fallback
              ? 'left-[22px] bg-[var(--color-primary-contrast)]'
              : 'left-[3px] bg-[var(--border-strong)]'
          "
        />
      </button>
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
  </div>
</template>

<script setup lang="ts">
/**
 * LinkCryptoSettingsSection — 设置页「链路加密」分组正文（床 desktop 业务设置）
 *
 * 归属（设置归属修正 2026-10-19）：链路加密是终端业务数据面的设置项，不归宿主
 * 外壳；宿主系统页不再承载，本应用设置页直接读写宿主平台原语（加密引擎仍在
 * 宿主 / server-core，应用只做设置面）。
 *
 * 乐观更新失败回滚：不产生「UI 已开 / 后端未生效」的半启用状态。
 */
import { inject, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { useAppI18n } from '@/composables/useAppI18n'
import type { AppMountEnv } from '@/entry'
import { useLinkCryptoConfig, type LinkCryptoConfig } from '@/composables/useLinkCrypto'

const env = inject<AppMountEnv | null>('appEnv', null)
const t = useAppI18n()
const { config, fingerprint, load, save } = useLinkCryptoConfig(env?.invoke.bind(env))

/** 通道子开关元数据：字段名与 Rust serde snake_case 一致（deny_unknown_fields） */
const channels: Array<{
  field: keyof Omit<LinkCryptoConfig, 'enabled' | 'allow_plaintext_fallback'>
  labelKey: string
  descKey: string
}> = [
  {
    field: 'encrypt_http',
    labelKey: 'linkCrypto.encryptHttp',
    descKey: 'linkCrypto.encryptHttpDesc',
  },
  {
    field: 'encrypt_ws_terminal',
    labelKey: 'linkCrypto.encryptWsTerminal',
    descKey: 'linkCrypto.encryptWsTerminalDesc',
  },
  {
    field: 'encrypt_ws_event',
    labelKey: 'linkCrypto.encryptWsEvent',
    descKey: 'linkCrypto.encryptWsEventDesc',
  },
]

/**
 * 乐观更新 + 失败回滚：单次切换整体保存，落库失败恢复原值并提示，
 * 不产生「UI 已开 / 后端未生效」的半启用状态
 */
async function update(patch: Partial<LinkCryptoConfig>): Promise<void> {
  if (!config.value) return
  const prev = config.value
  const next = { ...prev, ...patch }
  config.value = next
  try {
    await save(next)
  } catch {
    config.value = prev
    toast.error(t('linkCrypto.saveFailed'))
  }
}

onMounted(() => {
  // 配置域加载失败不阻断设置页其余部分；指纹 / 开关展示占位符
  void load().catch(() => {})
})
</script>
