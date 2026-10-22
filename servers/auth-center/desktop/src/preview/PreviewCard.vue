<script setup lang="ts">
/**
 * 认证中心卡片只读预览面（宿主多任务 / 主屏缩略区挂载）
 *
 * 只做一件事：把就位三态显示出来。**不等待数据就返回挂载**（entry.mountPreview 立即
 * 返回 handle），数据在 `onMounted` 里取一次；失败按「读不到」呈现，不冒充「未就位」。
 * 预览路径**只读**：不写存储、不换发通道令牌、不发起任何会改变状态的命令。
 */
import { computed, onMounted, ref } from 'vue'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import type { AppPreviewEnv } from '../entry'
import type { CenterState, CenterStatus } from '../types'

const props = defineProps<{ env: AppPreviewEnv }>()

const t = (key: string): string => i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`)

const raw = ref<CenterStatus | null>(null)

const state = computed<CenterState>(() => {
  const value = raw.value?.state
  return value === 'registered' || value === 'not_ready' ? value : 'unknown'
})

onMounted(async () => {
  try {
    const payload = await props.env.appInvoke<CenterStatus>('auth-center.status')
    if (payload && typeof payload === 'object' && typeof payload.state === 'string') {
      raw.value = payload
    }
  } catch {
    // 预览面不弹错：落 unknown（「读不到」），点开主界面才看得到原因
  }
})
</script>

<template>
  <div class="ac-preview" data-testid="auth-center-preview">
    <p class="ac-preview-title">{{ t('title') }}</p>
    <p class="ac-preview-state" :class="`is-${state}`" :data-state="state">
      <span class="ac-dot" aria-hidden="true"></span>
      <span>{{ t(`status.${state}`) }}</span>
    </p>
    <p class="ac-preview-hint">{{ t('preview.hint') }}</p>
  </div>
</template>
