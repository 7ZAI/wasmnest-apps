/**
 * Monitor（移动端）翻译消息汇总
 *
 * 通过 ES module 静态导入，构建期内联进 bundle；编译期校验语言文件完整性。
 * 注册时宿主自动加插件 ID 前缀（`com.wasmnest.monitor.<key>`）。
 */
import type { MessageSchema } from './messages'
import zhCN from './zh-CN'
import en from './en'

export type { MessageSchema }

/** locale → 翻译表（locale 与宿主 vue-i18n 配置一致：zh-CN 默认 / en） */
export const messages: Record<string, MessageSchema> = {
  'zh-CN': zhCN,
  en,
}
