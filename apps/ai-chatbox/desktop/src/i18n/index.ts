/**
 * AI Chatbox app 前端 i18n 实例（独立挂载包自足；桌面 UI 宿主修正 2026-10-17）
 *
 * 旧形态：key 经宿主 registerMessages 运行期自动加插件 ID 前缀
 * （com.wasmnest.ai-chatbox.hub.*）。新形态：本包自持 i18n 实例，消息以
 * `com.wasmnest.ai-chatbox.<key>` 扁平点号 key 注册（静态化，行为不变）；
 * 语言由宿主经 env.locale / handle.setLocale 注入。
 */
import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'

/** locale → 本 app 域翻译表（interface 无隐式索引签名，spread 摊平成 Record） */
export const messages: Record<string, Record<string, unknown>> = {
  'zh-CN': { ...zhCN },
  en: { ...en },
}

/** app 域消息在统一实例里的命名空间前缀 */
export const MESSAGE_NAMESPACE = 'com.wasmnest.ai-chatbox'

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
