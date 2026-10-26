<script setup lang="ts">
/**
 * 接入应用卡片：哪些 wasmnest 应用把认证面交给了本中心
 *
 * 清单是声明（`consumers.ts`）；运行态取自宿主 `plugin_list_loaded`。两种状态必须
 * 分开呈现：`missing` = 清单在、该应用不在（未安装），`unknown` = 清单本身读不到 /
 * 状态不可判读——后者不能渲染成「未安装」。
 */
import { computed, inject, onMounted, ref } from 'vue'
import type { AuthCenterContext } from '../appContext'
import {
  AUTH_CENTER_CONSUMERS,
  consumerPresence,
  consumerStateError,
  type ConsumerPresence,
} from '../consumers'
import type { AuthCenterConsumer, HostPluginInfo } from '../types'

const context = inject<AuthCenterContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

/** 宿主面命令：插件清单（含运行态）；不是本 app 的插件命令 */
const PLUGIN_LIST_COMMAND = 'plugin_list_loaded'

interface ConsumerRow {
  consumer: AuthCenterConsumer
  presence: ConsumerPresence
  stateError: string | null
}

const infos = ref<HostPluginInfo[] | null>(null)
const error = ref<string | null>(null)
// 初始即视为加载中：onMounted 的首轮读取之前不闪「未安装 / 读不到」
const loading = ref(true)

const rows = computed<ConsumerRow[]>(() => {
  const list = infos.value
  return AUTH_CENTER_CONSUMERS.map((consumer) => {
    const info = list?.find((entry) => entry.id === consumer.id)
    return {
      consumer,
      // 清单读不到（且没有上一次成功数据）时整列落 unknown，不落 missing
      presence: list === null ? 'unknown' : consumerPresence(info),
      stateError: consumerStateError(info),
    }
  })
})

/** 首次加载尚未返回：显示读取中，避免闪现「未安装 / 读不到」 */
const pendingFirstLoad = computed(() => loading.value && infos.value === null)

const TONES: Record<ConsumerPresence | 'loading', string> = {
  activated: 'is-ok',
  loaded: 'is-muted',
  activating: 'is-muted',
  degraded: 'is-warn',
  needsApproval: 'is-warn',
  error: 'is-bad',
  deactivated: 'is-muted',
  missing: 'is-muted',
  unknown: 'is-bad',
  loading: 'is-muted',
}

function stateKey(row: ConsumerRow): ConsumerPresence | 'loading' {
  return pendingFirstLoad.value ? 'loading' : row.presence
}

function stateLabel(row: ConsumerRow): string {
  return pendingFirstLoad.value ? t('loading') : t(`consumers.state.${row.presence}`)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const payload = await context.hostInvoke<HostPluginInfo[]>(PLUGIN_LIST_COMMAND)
    if (!Array.isArray(payload)) throw new Error('plugin_list_loaded returned a non-array')
    infos.value = payload
    error.value = null
  } catch (e) {
    // 读不到 ≠ 未安装：保留上一次成功数据（若存在），原因上屏
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="ac-card" data-testid="auth-center-consumers">
    <div class="ac-card-head">
      <h2 class="ac-h2">{{ t('consumers.title') }}</h2>
      <div class="ac-actions">
        <span class="ac-tag" data-testid="auth-center-consumers-count">
          {{ t('consumers.count', { count: String(rows.length) }) }}
        </span>
        <button
          class="ac-btn"
          :disabled="loading"
          data-testid="auth-center-consumers-refresh"
          @click="load"
        >
          {{ loading ? t('loading') : t('refresh') }}
        </button>
      </div>
    </div>

    <p v-if="error" class="ac-error" role="alert" data-testid="auth-center-consumers-error">
      {{ t('error.body', { message: error }) }}
    </p>

    <ul class="ac-consumers">
      <li
        v-for="row in rows"
        :key="row.consumer.id"
        class="ac-consumer"
        :data-testid="`auth-center-consumer-${row.consumer.id}`"
        :data-state="stateKey(row)"
      >
        <div class="ac-consumer-head">
          <span class="ac-row-name">{{ row.consumer.name }}</span>
          <span
            class="ac-tag"
            :class="TONES[stateKey(row)]"
            :data-testid="`auth-center-consumer-state-${row.consumer.id}`"
            :data-state="stateKey(row)"
          >
            {{ stateLabel(row) }}
          </span>
        </div>
        <p class="ac-consumer-id">{{ row.consumer.id }}</p>
        <div class="ac-consumer-surfaces">
          <span
            v-for="surface in row.consumer.surfaces"
            :key="surface"
            class="ac-tag"
            :data-testid="`auth-center-consumer-surface-${row.consumer.id}-${surface}`"
          >
            {{ t(`consumers.surface.${surface}`) }}
          </span>
        </div>
        <p
          v-if="row.stateError"
          class="ac-consumer-error"
          :data-testid="`auth-center-consumer-error-${row.consumer.id}`"
        >
          {{ row.stateError }}
        </p>
      </li>
    </ul>
  </section>
</template>
