/**
 * Monitor app 前端 i18n 实例（独立挂载包自足）
 *
 * 本包自持 i18n 实例，消息以 `com.wasmnest.monitor.<key>` 扁平点号 key 注册
 * （静态化）；语言由宿主经 env.locale / handle.setLocale 注入。
 */
import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'

/** locale → 本 app 域翻译表 */
export const messages: Record<string, Record<string, unknown>> = {
  'zh-CN': zhCN,
  en,
}

/** app 域消息在统一实例里的命名空间前缀 */
export const MESSAGE_NAMESPACE = 'com.wasmnest.monitor'

/** 域消息表 → 扁平命名空间 key 表（`<namespace>.<key>`，供 merge 进实例） */
function toNamespacedFlat(table: Record<string, unknown>): Record<string, string> {
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
