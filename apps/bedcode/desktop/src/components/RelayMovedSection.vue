<template>
  <!-- 分组正文：外层 <section> 与标题由设置页统一渲染 -->
  <div
    class="bg-[var(--bg-card)] border border-[var(--border)] rounded-[10px] divide-y divide-[var(--border)]"
    data-testid="relay-moved-section"
  >
    <div class="px-5 py-3.5 space-y-2.5">
      <p class="text-xs text-[var(--text-tertiary)] leading-relaxed">{{ t('relay.moved.desc') }}</p>

      <p
        v-if="loading"
        class="text-[calc(12.5px*var(--ui-scale))] text-[var(--text-secondary)]"
        data-testid="relay-moved-loading"
      >
        {{ t('relay.moved.loading') }}
      </p>
      <p
        v-else-if="loadError"
        class="text-xs text-[var(--color-danger-ink)] leading-relaxed"
        role="alert"
        data-testid="relay-moved-load-error"
      >
        {{ t('relay.moved.loadFailed', { message: loadError }) }}
      </p>
      <p
        v-else-if="config?.configured"
        class="text-[calc(12.5px*var(--ui-scale))] text-[var(--text-primary)]"
        data-testid="relay-moved-state"
      >
        {{ t('relay.moved.configured', { count: config.relayAddrs.length, source: sourceLabel }) }}
        <span
          v-if="config.allowWan === false"
          class="text-[var(--color-warning-ink)]"
          data-testid="relay-moved-wan-disabled"
        >
          · {{ t('relay.moved.wanDisabled') }}
        </span>
      </p>
      <p
        v-else
        class="text-[calc(12.5px*var(--ui-scale))] text-[var(--text-tertiary)]"
        data-testid="relay-moved-state"
      >
        {{ t('relay.moved.empty') }}
      </p>

      <!-- 中心不可用 / 正在用缓存：必须能看出来，不把降级藏起来 -->
      <p
        v-if="centerError || config?.source === 'cache'"
        class="text-xs text-[var(--color-warning-ink)] leading-relaxed"
        data-testid="relay-moved-center-error"
      >
        {{ t('relay.moved.centerError', { message: centerError || t('relay.moved.sourceCache') }) }}
      </p>

      <!-- WAN 注册表读不到：策略按默认 true 继续，但用户必须知道关不掉的真实原因 -->
      <p
        v-if="config?.wanPolicyError"
        class="text-xs text-[var(--color-warning-ink)] leading-relaxed"
        data-testid="relay-moved-wan-policy-error"
      >
        {{ t('relay.moved.wanPolicyError', { message: config.wanPolicyError }) }}
      </p>

      <!-- 迁移失败：本地旧配置没能进中心，用户需要显式重新导入 -->
      <p
        v-if="migration?.state === 'failed'"
        class="text-xs text-[var(--color-danger-ink)] leading-relaxed"
        role="alert"
        data-testid="relay-moved-migration-error"
      >
        {{ t('relay.moved.migrationFailed', { reason: migration.detail || '' }) }}
      </p>

      <button class="wb-btn-ghost" data-testid="relay-moved-open" @click="openCenter">
        {{ t('relay.moved.open') }}
      </button>
      <p
        v-if="navigateUnavailable"
        class="text-xs text-[var(--color-warning-ink)] leading-relaxed"
        data-testid="relay-moved-open-unavailable"
      >
        {{ t('relay.moved.openUnavailable') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * RelayMovedSection — 设置页「中转服务器」只读入口（T18 §5）
 *
 * T14 的可编辑卡片已整体迁入网络配置中心（`servers/net-config`）；本分组只显示
 * 中心当前状态与迁移结果，并跳转 `/network`。**不在本应用保留第二份编辑器**：
 * 地址真源只有中心一处。
 *
 * 失败语义：读不到中心配置 → 显性错误（不显示「未配置」）；后端用本地缓存兜底时
 * `source=cache` + `centerError` 上屏，用户能看出正在用旧值。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** `session.relay.config` 回执（字段与 Rust `relay_center::relay_config_view` 对齐） */
interface RelayConfigView {
  configured: boolean
  relayAddrs: string[]
  source: 'center' | 'cache'
  centerError: string | null
  /** 业务 WAN 注册表开关（缺省 = true） */
  allowWan?: boolean
  /** 注册表读取失败原因（策略按默认 true 继续，但原因必须可见） */
  wanPolicyError?: string | null
}

/** `session.relay.migration` 回执 */
interface MigrationStatus {
  state: 'none' | 'adopted' | 'skipped' | 'failed'
  reason?: unknown
  detail?: string
}

/** appContext 的 `navigate` 扩展（旧宿主不注入 onEvent 时不存在） */
type NavigableContext = PluginContext & { navigate?: (path: string) => boolean }

const context = inject<NavigableContext>('pluginContext')!
const t = context.i18n.t

const loading = ref(true)
const loadError = ref<string | null>(null)
const config = ref<RelayConfigView | null>(null)
const migration = ref<MigrationStatus | null>(null)
const navigateUnavailable = ref(false)

const sourceLabel = computed(() =>
  config.value?.source === 'cache' ? t('relay.moved.sourceCache') : t('relay.moved.sourceCenter'),
)

const centerError = computed(() => config.value?.centerError ?? null)

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function openCenter(): void {
  const navigated = context.navigate?.('/network') ?? false
  navigateUnavailable.value = !navigated
}

onMounted(async () => {
  // 两段独立：迁移状态读不到不该把配置状态一起打成失败
  try {
    const view = (await context.commands.execute('session.relay.config')) as RelayConfigView
    config.value = view
  } catch (error) {
    loadError.value = messageOf(error)
  }
  try {
    migration.value = (await context.commands.execute(
      'session.relay.migration',
    )) as MigrationStatus
  } catch {
    // 迁移状态是附加信息：读不到不影响「当前配置」的呈现
    migration.value = null
  } finally {
    loading.value = false
  }
})
</script>
