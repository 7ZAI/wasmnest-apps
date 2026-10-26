/**
 * 设置分组（业务面静态表；设置归属修正 2026-10-19）
 *
 * 宿主系统页（/sys/settings）只承载**平台分组**（壳外观深浅色 / 系统 / 日志 /
 * 授权 / 关于）；本 app 设置页承载**业务分组**：
 * - 外观（主题色板）——各 wasm-app 的样式主题独立，宿主不提供色板；
 * - 配对设置 / 会话设置（原经设置分组贡献面注册的 app 业务面）；
 * - 链路加密——终端业务数据面的设置（加密引擎仍是宿主平台原语）。
 *
 * 分组标题：分组只渲染正文（旧扩展点约定：外壳与标题由宿主统一渲染），
 * 本表为它们携带 titleKey，由设置页统一包外壳。app 域 key 带扁平命名空间前缀，
 * 宿主机制文案副本（host-zh-CN / host-en）的 key 直接取顶层。
 */

import { computed, type ComputedRef } from 'vue'
import { MESSAGE_NAMESPACE } from '@/i18n'
import AppearanceSettingsSection from '@/components/AppearanceSettingsSection.vue'
import LinkCryptoSettingsSection from '@/components/LinkCryptoSettingsSection.vue'
import PairingSettingsSection from '@/components/PairingSettingsSection.vue'
import SessionSettingsSection from '@/components/SessionSettingsSection.vue'

/** 业务分组排序槽位（沿用旧贡献面槽位：外观 100 / 配对 200 / 链路加密 300 / 会话 400） */
export const SECTION_ORDERS = {
  appearance: 100,
  pairing: 200,
  linkCrypto: 300,
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

/** 设置分组静态表（单一事实源：应用业务四分组） */
export const settingsSections: Omit<SettingsSectionEntry, 'props'>[] = [
  {
    key: 'appearance',
    order: SECTION_ORDERS.appearance,
    component: AppearanceSettingsSection,
    titleKey: `${MESSAGE_NAMESPACE}.appearance.settings.title`,
  },
  {
    key: 'pairing',
    order: SECTION_ORDERS.pairing,
    component: PairingSettingsSection,
    titleKey: `${MESSAGE_NAMESPACE}.pairing.settings.title`,
  },
  {
    key: 'linkCrypto',
    order: SECTION_ORDERS.linkCrypto,
    component: LinkCryptoSettingsSection,
    // 宿主机制文案副本里的平台文案（app 独立包已合并，无需重复定义）
    titleKey: 'settings.linkCrypto.title',
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
