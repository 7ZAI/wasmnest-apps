<script setup lang="ts">
/**
 * 业务 WAN 注册表（逐业务开关）
 *
 * 只读展示宿主已知业务 + 注册表已有条目；开关写 `net-config.wan-policy.set`。
 * 关闭后业务下次配置时自然不再建立中继预留（LAN 入口不受影响）；本卡片不参与
 * 任何业务的 `expose` / `connect`。
 */
import { computed } from 'vue'
import type { WanPolicyRow } from '@/composables/useWanPolicy'

const props = defineProps<{
  rows: WanPolicyRow[]
  /** 读取 / 切换失败原因（null = 正常）；文案统一走 `error.body` */
  errorText: string | null
  busy: boolean
  t: (key: string, params?: Record<string, unknown>) => string
}>()

const emit = defineEmits<{
  (e: 'toggle', pluginId: string, allowWan: boolean): void
}>()

const allowedCount = computed(() => props.rows.filter((row) => row.entry?.allowWan).length)

function toggle(row: WanPolicyRow): void {
  if (props.busy) return
  emit('toggle', row.pluginId, !(row.entry?.allowWan ?? false))
}
</script>

<template>
  <section class="nc-card" data-testid="net-config-wan">
    <div class="nc-card-head">
      <h2 class="nc-h2">{{ t('wan.title') }}</h2>
      <span class="nc-tag" data-testid="net-config-wan-count">
        {{ allowedCount }} / {{ rows.length }}
      </span>
    </div>
    <p class="nc-hint">{{ t('wan.desc') }}</p>

    <p v-if="errorText" class="nc-error" role="alert" data-testid="net-config-wan-error">
      {{ t('error.body', { message: errorText }) }}
    </p>

    <p v-if="rows.length === 0" class="nc-hint" data-testid="net-config-wan-empty">
      {{ t('wan.empty') }}
    </p>

    <ul v-else class="nc-rows">
      <li
        v-for="row in rows"
        :key="row.pluginId"
        class="nc-row"
        :data-testid="`net-config-wan-row-${row.pluginId}`"
      >
        <div class="nc-row-main">
          <span class="nc-row-name" :data-testid="`net-config-wan-name-${row.pluginId}`">
            {{ row.name }}
            <span v-if="!row.known" class="nc-tag nc-tag-muted">{{ t('wan.unknown') }}</span>
          </span>
          <p class="nc-row-id nc-mono">{{ row.pluginId }}</p>
        </div>

        <div class="nc-row-meta">
          <span
            class="nc-tag"
            :class="row.entry?.allowWan ? 'is-ok' : 'is-muted'"
            :data-testid="`net-config-wan-state-${row.pluginId}`"
            :data-allowed="row.entry?.allowWan ? 'true' : 'false'"
          >
            {{ row.entry?.allowWan ? t('wan.state.allowed') : t('wan.state.blocked') }}
          </span>
          <span
            class="nc-row-updated"
            :data-testid="`net-config-wan-updated-${row.pluginId}`"
          >
            {{ row.entry?.updatedAt || '—' }}
          </span>
          <button
            class="nc-btn"
            :disabled="busy"
            :data-testid="`net-config-wan-toggle-${row.pluginId}`"
            @click="toggle(row)"
          >
            {{ row.entry?.allowWan ? t('wan.block') : t('wan.allow') }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
