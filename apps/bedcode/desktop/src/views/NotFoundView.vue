<template>
  <div class="h-full flex flex-col items-center justify-center gap-4 bg-[var(--bg-page)]">
    <p class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]">
      {{ t('notFound.title') }}
    </p>
    <p class="text-xs text-[var(--text-tertiary)]">{{ t('notFound.body') }}</p>
    <!-- 返回应用主面：/sessions 停用后主面是项目列表（默认落地页） -->
    <button class="wb-btn-ghost" @click="router.push(DEFAULT_ROUTE)">
      {{ t('notFound.back') }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 未匹配路由兜底视图（D3 fail-visible）
 *
 * 退役面（/plugins 应用中心、/shell 设备壳、/plugin/* 插件视图路由）直接访问时
 * 落此页：显性 not-found，不白屏、不静默回落。
 */
import { useAppI18n } from '@/composables/useAppI18n'
import { useRouter } from 'vue-router'
import { DEFAULT_ROUTE } from '@/router'

const t = useAppI18n()
const router = useRouter()
</script>
