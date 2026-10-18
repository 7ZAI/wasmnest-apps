/**
 * 设置分组（业务面静态表；桌面 UI 宿主修正 2026-10-17）
 *
 * 宿主系统页（/sys/settings）承载平台分组（外观 / 链路加密 / 系统 / 日志 / 授权 /
 * 关于）；本 app 设置页只承载**业务分组**：配对设置 / 会话设置（原经设置分组
 * 贡献面注册的 app 业务面，随 app 独立界面归位）。
 *
 * 分组标题：业务分组只渲染正文（旧扩展点约定：外壳与标题由宿主统一渲染），
 * 本表为它们携带 titleKey（`com.wasmnest.terminal-session.*` 扁平 key），由
 * 设置页统一包外壳。
 */

import { computed, type ComputedRef } from 'vue'
import { MESSAGE_NAMESPACE } from '@/i18n'
import PairingSettingsSection from '@/components/PairingSettingsSection.vue'
import SessionSettingsSection from '@/components/SessionSettingsSection.vue'

/** 业务分组排序槽位（沿用旧贡献面槽位：配对 200 / 会话 400） */
export const SECTION_ORDERS = {
  pairing: 200,
  session: 400,
} as const

/** 设置分组条目（与宿主 useSettingsSections 同形状，app 侧自持） */
export interface SettingsSectionEntry {
  key: string
  order: number
  component: any
  props: Record<string, unknown>
  titleKey?: string
}

/** 设置分组静态表（单一事实源：业务两分组） */
export const settingsSections: Omit<SettingsSectionEntry, 'props'>[] = [
  {
    key: 'pairing',
    order: SECTION_ORDERS.pairing,
    component: PairingSettingsSection,
    titleKey: `${MESSAGE_NAMESPACE}.pairing.settings.title`,
  },
  {
    key: 'session',
    order: SECTION_ORDERS.session,
    component: SessionSettingsSection,
    titleKey: `${MESSAGE_NAMESPACE}.session.settings.title`,
  },
]

/**
 * 设置分组静态表 composable（编排层传入 props，分组列表 computed 挂响应式依赖；
 * 业务分组无共享状态需求，props 恒空）
 */
export function useSettingsSections(
  _sharedState?: () => Record<string, unknown>,
): ComputedRef<SettingsSectionEntry[]> {
  return computed(() =>
    settingsSections
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ ...s, props: {} })),
  )
}
