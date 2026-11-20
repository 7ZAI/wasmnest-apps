<script setup lang="ts">
/**
 * Nest 移动侧运行面包装（票 08 对话主链路）
 *
 * 宿主壳注入 `pluginContext` 与宿主全局 vue-i18n；共享全屏会话页
 * （`shared/components/ChatView.vue`）保持端无关（只吃 `invoke` / `subscribe`
 * / `t` / `lang`），移动侧适配由本包装承担：
 * - 命令调用绑定 `context.commands.execute`（共享 crate 命令面）；
 * - 事件订阅绑定 `context.events.on`（宿主流式事件 `assistant:stream:*`
 *   经插件事件总线推送，与桌面 Tauri listen 同语义）；
 * - 译文绑定宿主 i18n（插件 ID 前缀），语言取宿主当前 locale。
 */
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import ChatView from '@nest-shared/components/ChatView.vue'
import type { AssistantInvoke } from '@nest-shared/types'

/** 插件 ID 命名空间（与宿主注册消息时的前缀一致） */
const NAMESPACE = 'com.wasmnest.assistant'

const { t: rawT, locale } = useI18n()
/** 域内 key → 全命名空间 key 翻译（透传插值参数，供计数等文案使用） */
const t = (key: string, params?: Record<string, unknown>): string =>
  rawT(`${NAMESPACE}.${key}`, params ?? {})

const context = inject<PluginContext>('pluginContext')!

/** 命令调用绑定（宿主 commands.execute → 共享 crate 命令面） */
const invoke: AssistantInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) =>
  context.commands.execute(command, args) as Promise<T>

/** 事件订阅绑定（宿主事件总线 → 共享核；返回退订函数） */
const subscribe = (event: string, handler: (payload: unknown) => void): (() => void) => {
  const disposable = context.events.on(event, (payload: unknown) => handler(payload))
  return () => disposable.dispose()
}

const lang = computed<'zh-CN' | 'en'>(() => (locale.value === 'en' ? 'en' : 'zh-CN'))

/**
 * 移动端显式 KDF 档位：与 Rust 默认一致（m=32 MiB / t=3 / p=1）。
 * 参数随保险库元数据落库，解锁沿用建档时的档位，不随后续端侧变化漂移。
 */
const mobileKdfParams = { m: 32 * 1024, t: 3, p: 1 }
</script>

<template>
  <ChatView
    :invoke="invoke"
    :subscribe="subscribe"
    :t="t"
    :lang="lang"
    :kdf-params="mobileKdfParams"
    :apps="context.apps ?? null"
  />
</template>
