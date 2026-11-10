<script setup lang="ts">
/**
 * 网络配置中心卡片只读预览面（宿主多任务 / 主屏缩略区挂载）
 *
 * 只做一件事：显示「是否配置了中转地址」。**不等待数据就返回挂载**
 * （entry.mountPreview 立即返回 handle），数据在 `onMounted` 里取一次；失败按
 * 「读取失败」呈现，不冒充「未配置」——存储损坏（`relayError` / `wanError` 非空）
 * 同样属于读不出来，不能显示成「尚未导入」。预览路径**只读**：不写存储、不改策略。
 */
import { computed, onMounted, ref } from 'vue'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import type { AppPreviewEnv } from '../entry'
import type { NetConfigStatus } from '../types'

const props = defineProps<{ env: AppPreviewEnv }>()

const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})

const status = ref<NetConfigStatus | null>(null)
const failed = ref(false)
/** 后端带出的读取失败原因（损坏 ≠ 未配置） */
const readError = computed(() => status.value?.relayError || status.value?.wanError || null)

onMounted(async () => {
  try {
    const payload = await props.env.appInvoke<NetConfigStatus>('net-config.status')
    if (payload && typeof payload === 'object' && typeof payload.configured === 'boolean') {
      status.value = payload
    } else {
      failed.value = true
    }
  } catch {
    // 预览面不弹错：落「读取失败」，点开主界面才看得到原因
    failed.value = true
  }
})
</script>

<template>
  <div class="nc-preview" data-testid="net-config-preview">
    <p class="nc-preview-title">{{ t('preview.title') }}</p>
    <p
      v-if="failed || readError"
      class="nc-preview-state is-bad"
      data-testid="net-config-preview-state"
      :title="readError ?? undefined"
    >
      {{ t('preview.unavailable') }}
    </p>
    <p
      v-else-if="status?.configured"
      class="nc-preview-state is-ok"
      data-testid="net-config-preview-state"
    >
      {{ t('preview.configured', { count: status.relayAddrsCount }) }}
    </p>
    <p v-else class="nc-preview-state is-muted" data-testid="net-config-preview-state">
      {{ t('preview.empty') }}
    </p>
  </div>
</template>
