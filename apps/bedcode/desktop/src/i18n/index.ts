/**
 * bedcode app 前端 i18n 实例（独立挂载包自足消息集）
 *
 * 两份来源（app 独立打包，不与宿主共享实例）：
 * 1. 宿主机制文案副本（mechanism.ts）：仅错误信封 `errors.*`（ADR 0030 机制契约，
 *    code 即 key，app 侧消费层按同一命名空间查文案）；
 * 2. 本 app 域消息（zh-CN / en）：session.* / pairing.* / task.* / server.* /
 *    sidebar.* / linkCrypto.* / appearance.* / notFound.* 等。
 *
 * **扁平 key 机制**（D5 遗留约定）：app 域消息以 `com.wasmnest.bedcode.<key>`
 * 的扁平点号 key 注册（vue-i18n 的 `t` 可直接取文案；`te` 不识别扁平形态，故判
 * 「是否注册」用 `t !== key`）。语言由宿主经 env.locale / handle.setLocale 注入。
 */

import { createI18n } from 'vue-i18n'
import type { MessageSchema } from './messages'
import zhCN from './zh-CN'
import en from './en'
import { mechanismZhCN, mechanismEn } from './mechanism'

export type { MessageSchema }

/** locale → 本 app 域翻译表 */
export const messages: Record<string, MessageSchema> = {
  'zh-CN': zhCN,
  en,
}

/** app 域消息在统一实例里的命名空间前缀 */
export const MESSAGE_NAMESPACE = 'com.wasmnest.bedcode'

/** 域消息表 → 扁平命名空间 key 表（`<namespace>.<key>`，供 merge 进实例） */
function toNamespacedFlat(table: MessageSchema): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [key, value] of Object.entries(table)) {
    flat[`${MESSAGE_NAMESPACE}.${key}`] = value as string
  }
  return flat
}

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      ...mechanismZhCN,
      ...toNamespacedFlat(messages['zh-CN']),
    },
    en: {
      ...mechanismEn,
      ...toNamespacedFlat(messages.en),
    },
  },
})

export default i18n
