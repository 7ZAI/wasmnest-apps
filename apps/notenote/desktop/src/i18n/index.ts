/**
 * notenote app 前端 i18n 实例
 */

import { createI18n } from 'vue-i18n'
import type { MessageSchema } from './messages'
import zhCN from './zh-CN'
import en from './en'

export type { MessageSchema }

export const messages: Record<string, MessageSchema> = {
  'zh-CN': zhCN,
  en,
}

export const MESSAGE_NAMESPACE = 'com.wasmnest.notenote'

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
    'zh-CN': toNamespacedFlat(messages['zh-CN']),
    en: toNamespacedFlat(messages.en),
  },
})

export default i18n
