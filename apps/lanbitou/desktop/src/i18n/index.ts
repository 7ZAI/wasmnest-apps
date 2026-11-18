/**
 * Lanbitou app 前端 i18n 实例（独立挂载包自足；桌面 UI 宿主修正 2026-11-02）
 *
 * 旧形态：key 经宿主 registerMessages 运行期自动加插件 ID 前缀
 * （com.wasmnest.lanbitou.hub.*）。新形态：本包自持 i18n 实例，消息以
 * `com.wasmnest.lanbitou.<key>` 扁平点号 key 注册（静态化，行为不变）；
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
export const MESSAGE_NAMESPACE = 'com.wasmnest.lanbitou'

/** 支持的 locale（宿主注入值；未知值回落默认中文） */
export type AppLocale = 'zh-CN' | 'en'

/** 宿主 locale → 受支持 locale（未知值回落 zh-CN，与 mountApp 的判定同口径） */
export function normalizeLocale(value: string | undefined): AppLocale {
  return value === 'en' ? 'en' : 'zh-CN'
}

/** 域消息表 → 扁平命名空间 key 表（`<namespace>.<key>`，供 merge 进实例） */
function toNamespacedFlat(table: Record<string, unknown>): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [key, value] of Object.entries(table)) {
    flat[`${MESSAGE_NAMESPACE}.${key}`] = value as string
  }
  return flat
}

/**
 * 新建独立 i18n 实例
 *
 * 主应用与多任务预览**各持一份**：`mountPreview` 若直接改写模块单例的
 * `global.locale`，卡片以宿主 locale 挂载时会把用户在主应用里选的语言改掉
 * （预览是只读面，不得有这种副作用）。消息表每次重新摊平，避免实例间共享可变对象。
 */
export function createAppI18n(locale: AppLocale = 'zh-CN') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'zh-CN',
    messages: {
      'zh-CN': toNamespacedFlat(messages['zh-CN']),
      en: toNamespacedFlat(messages.en),
    },
  })
}

const i18n = createAppI18n('zh-CN')

export default i18n
