<script setup lang="ts">
/**
 * Nest 移动侧运行面包装（票 07 保险库）
 *
 * 宿主壳注入 `pluginContext` 与宿主全局 vue-i18n；共享保险库视图
 * （`shared/components/VaultView.vue`）保持端无关（只吃 `invoke` + `t`），
 * 移动侧适配由本包装承担：命令调用绑定 `context.commands.execute`、
 * 译文绑定宿主 i18n（插件 ID 前缀）。
 */
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import VaultView from '@nest-shared/components/VaultView.vue'
import type { AssistantInvoke } from '@nest-shared/types'

/** 插件 ID 命名空间（与宿主注册消息时的前缀一致） */
const NAMESPACE = 'com.wasmnest.assistant'

const { t: rawT } = useI18n()
/** 域内 key → 全命名空间 key 翻译 */
const t = (key: string): string => rawT(`${NAMESPACE}.${key}`)

const context = inject<PluginContext>('pluginContext')!

/** 命令调用绑定（宿主 commands.execute → 共享 crate 命令面） */
const invoke: AssistantInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) =>
  context.commands.execute(command, args) as Promise<T>
</script>

<template>
  <VaultView :invoke="invoke" :t="t" />
</template>
