<template>
  <QuickCard
    :label="label"
    :value="count"
    :hint="hint"
    :tone="count > 0 ? 'success' : 'neutral'"
    :icon-path="ICON"
  />
</template>

<script setup lang="ts">
/**
 * 宿主壳首页快捷卡片（bedcode 应用贡献的「活跃会话数」槽位）
 *
 * 外观由 SDK 公共 QuickCard 承载（与宿主 token / 明暗 / 字号一致）；点击与跳转
 * 归宿主壳——壳把整张卡渲染成按钮并打开本应用，因此这里不再自绘按钮 / 交互，
 * 卡片内也不得再出现按钮（嵌套交互会抢点击）。
 *
 * 壳 Home 直接渲染（不经 PluginViewHost），不依赖 pluginContext——只读
 * mobileApi.activeSessions（宿主连接域投影）计数。文案一律走宿主共享 i18n
 * 实例（本域在 activate 期已注册插件前缀键）；插件键取不到时退回宿主自有的
 * 槽位标题键（同义且双语），仍取不到则留空（模板隐藏标签，不落硬编码文案）。
 */
import { computed } from 'vue'
import QuickCard from '@binblink/wasmnest-plugin-sdk-mobile/ui/quick-card'
import { getI18n, getMobileApi } from '@binblink/wasmnest-plugin-sdk-mobile'

defineProps<{ app: any }>()

const api = getMobileApi()
const count = computed(() => api.activeSessions.value?.length ?? 0)

/** 右上角装饰图标：终端窗口 + 提示符（24 视框 stroke 线稿） */
const ICON = ['M4 5h16v14H4z', 'M8 10l3 2.5-3 2.5', 'M13.5 15H16']

/** 插件前缀键（本域 activate 期注册；键名见 host/i18n.ts） */
const PREFIX = 'com.wasmnest.bedcode.'
/** 兜底键：宿主壳首页自有标题文案（双语，壳不依赖插件注册顺序） */
const HOST_FALLBACK_KEY = 'shell.home.slotsTitle'

const label = computed(() => {
  const i18n: any = getI18n()
  if (!i18n?.global?.t) return ''
  try {
    const key = `${PREFIX}hub.slotTitle`
    const text: string = i18n.global.t(key)
    if (text && text !== key) return text
    const hostText: string = i18n.global.t(HOST_FALLBACK_KEY)
    return hostText && hostText !== HOST_FALLBACK_KEY ? hostText : ''
  } catch {
    return ''
  }
})

/** 零值时的状态说明（无活跃会话）；取不到文案就留空，不硬编码中文 */
const emptyHint = computed(() => {
  const i18n: any = getI18n()
  if (!i18n?.global?.t) return ''
  try {
    const key = `${PREFIX}hub.slotEmpty`
    const text: string = i18n.global.t(key)
    return text && text !== key ? text : ''
  } catch {
    return ''
  }
})

const hint = computed(() => (count.value === 0 ? emptyHint.value : ''))
</script>