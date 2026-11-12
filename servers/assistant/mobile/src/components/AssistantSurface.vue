<script setup lang="ts">
/**
 * Nest 移动侧运行面包装（票 05 骨架）
 *
 * 宿主壳只注入 `pluginContext` 与宿主全局 vue-i18n；共享占位视图
 * （`shared/components/PlaceholderView.vue`）保持端无关（纯 props），
 * 移动侧适配由本包装承担：宿主 i18n 译文、ping 绑定 `context.commands.execute`，
 * 再以 props 传入共享组件。
 */
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import PlaceholderView from '@nest-shared/components/PlaceholderView.vue'
import {
  ASSISTANT_PING_COMMAND,
  type AssistantPingResult,
  type PlaceholderPingState,
} from '@nest-shared/types'

/** 插件 ID 命名空间（与宿主注册消息时的前缀一致） */
const NAMESPACE = 'com.wasmnest.assistant'

const { t } = useI18n()

/** 域内 key → 全命名空间 key 翻译（宿主 i18n 按插件 ID 前缀注册） */
const tx = (key: string, params?: Record<string, unknown>): string =>
  t(`${NAMESPACE}.${key}`, params ?? {})

const context = inject<PluginContext>('pluginContext')!

/** 占位页状态文案 */
const stateLabel = (state: PlaceholderPingState): string => {
  const key =
    state.status === 'ok'
      ? 'assistant.state.ok'
      : state.status === 'error'
        ? 'assistant.state.error'
        : state.status === 'running'
          ? 'assistant.state.running'
          : 'assistant.state.idle'
  return tx(key)
}

/** ping 结果行文案 */
const resultLabel = (result: AssistantPingResult): string =>
  tx('assistant.result', { appId: result.appId })

/** 命令调用绑定（宿主 commands.execute → 共享 crate assistant.ping） */
const ping = () => context.commands.execute<AssistantPingResult>(ASSISTANT_PING_COMMAND)
</script>

<template>
  <PlaceholderView
    :title="tx('assistant.title')"
    :subtitle="tx('assistant.subtitle')"
    :state-label="stateLabel"
    :result-label="resultLabel"
    :ping="ping"
  />
</template>
