/**
 * bedcode app 前端 i18n 实例（独立挂载包自足消息集；桌面 UI 宿主修正 2026-10-17）
 *
 * 两份来源（app 独立打包，不再与宿主共享实例）：
 * 1. 宿主机制文案副本（host-zh-CN / host-en，与宿主 i18n 同源同值——drift 锁钉
 *    住：app 视图仍消费 errors.* / common.* / desktop.* / settings.* 宿主命名空间
 *    key，独立包必须自足）；
 * 2. 本 app 域消息（zh-CN / en）：session.* / pairing.* / task.* 三命名空间。
 *
 * **扁平 key 机制**（D5 遗留约定）：app 域消息以 `com.wasmnest.bedcode.<key>`
 * 的扁平点号 key 注册（vue-i18n 的 `t` 可直接取文案；`te` 不识别扁平形态，故判
 * 「是否注册」用 `t !== key`）。语言由宿主经 env.locale / handle.setLocale 注入。
 */

import { createI18n } from 'vue-i18n'
import type { MessageSchema } from './messages'
import zhCN from './zh-CN'
import en from './en'
import hostZhCN from './host-zh-CN'
import hostEn from './host-en'

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
      ...hostZhCN,
      ...toNamespacedFlat(messages['zh-CN']),
    },
    en: {
      ...hostEn,
      ...toNamespacedFlat(messages.en),
    },
  },
})

export default i18n
