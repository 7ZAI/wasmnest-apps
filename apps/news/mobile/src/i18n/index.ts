/**
 * News 移动端 i18n 消息表
 *
 * 由 index.ts 在 activate 时经 `context.i18n.registerMessages(locale, msgs)`
 * 注册（宿主自动加插件 id 前缀）。
 */
import zhCN from './zh-CN'
import en from './en'

export const messages: Record<string, Record<string, unknown>> = {
  'zh-CN': zhCN,
  en,
}