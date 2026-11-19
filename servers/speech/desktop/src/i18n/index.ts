/**
 * Speech app i18n 实例（独立挂载包自足）
 *
 * 消息以 `com.wasmnest.speech.<key>` 扁平点号 key 注册；语言由宿主经
 * env.locale / handle.setLocale 注入。构建期由 i18nPrecompile 预编译。
 */
import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'

export const messages: Record<string, Record<string, string>> = {
  'zh-CN': zhCN,
  en,
}

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages,
})

/** 宿主 locale → 本 app 支持的 locale */
export function normalizeLocale(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export default i18n