/**
 * app 域取文案（消息 key 自带 `com.wasmnest.bedcode.*` 命名空间）
 *
 * 组件内 `useI18n()` 拿到的是实例直连 t（按顶层 key 查）；app 域文案统一经本
 * composable 补命名空间，避免各处手拼前缀 / 误取宿主命名空间（宿主文案不随
 * app 打包，取不到会回显 key 原文）。
 */
import { useI18n } from 'vue-i18n'
import { MESSAGE_NAMESPACE } from '@/i18n'

export type AppTranslate = (key: string, params?: Record<string, unknown>) => string

export function useAppI18n(): AppTranslate {
  const { t: translate } = useI18n()
  return (key: string, params?: Record<string, unknown>) =>
    translate(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
}
