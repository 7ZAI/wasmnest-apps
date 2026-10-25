/**
 * 侧边栏菜单（静态表，D3：wasm-app 页面路由直写侧边栏）
 *
 * 桌面宿主前端整体下沉后，菜单表是 app 内的单一事实源：贡献面注册与激活态
 * 仲裁随前端插件运行时退役，侧边栏直接渲染本表。order 沿用下沉前各页面的
 * 槽位值，保证视觉顺序不变：
 * 设备配对 100 / 终端会话 200 / Agent任务 210 / 设置 9999。
 *
 * 文案 key 两种命名域并存：本 app 域消息经 `com.wasmnest.bedcode.`
 * 前缀（MESSAGE_NAMESPACE），宿主机制文案（设置项）直取顶层 key。
 */

import { computed, type ComputedRef } from 'vue'
import { MESSAGE_NAMESPACE } from '@/i18n'

/** 统一侧边栏菜单项 */
export interface SidebarMenuItem {
  /** 唯一 id（渲染 :key） */
  id: string
  /** 路由路径 */
  path: string
  /** 显示文本 i18n key（完整 key，含 app 域命名空间前缀） */
  labelKey: string
  /** SVG path d 属性（Heroicons outline 风格，viewBox 0 0 24 24） */
  icon: string
  /** 排序值，升序排列（越小越靠前） */
  order: number
}

/** 菜单排序槽位（下沉前槽位值，锁住视觉顺序） */
export const MENU_ORDERS = {
  pairing: 100,
  sessions: 200,
  tasks: 210,
  settings: 9999,
} as const

/** 侧边栏图标：宿主同款 Heroicons outline path（同图标体系） */
const PAIRING_ICON = 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z'
const SESSIONS_ICON =
  'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
const TASKS_ICON =
  'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01'
const SETTINGS_ICON =
  'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z'

/**
 * 静态菜单表（单一事实源）
 *
 * 连接历史（/history）与终端窗口（/terminal-window/:id）是深链页，不进菜单
 * （D3）：前者经设备列表「历史」按钮 query 直达，后者是独立窗口路由。
 */
export const sidebarMenuItems: SidebarMenuItem[] = [
  {
    id: 'pairing',
    path: '/pairing',
    labelKey: `${MESSAGE_NAMESPACE}.pairing.sidebar.title`,
    icon: PAIRING_ICON,
    order: MENU_ORDERS.pairing,
  },
  {
    id: 'sessions',
    path: '/sessions',
    labelKey: `${MESSAGE_NAMESPACE}.session.sidebar.title`,
    icon: SESSIONS_ICON,
    order: MENU_ORDERS.sessions,
  },
  {
    id: 'tasks',
    path: '/tasks',
    labelKey: `${MESSAGE_NAMESPACE}.task.historyTitle`,
    icon: TASKS_ICON,
    order: MENU_ORDERS.tasks,
  },
  {
    id: 'settings',
    path: '/settings',
    labelKey: 'desktop.sidebar.settings',
    icon: SETTINGS_ICON,
    order: MENU_ORDERS.settings,
  },
]

/** 侧边栏菜单组合子（静态表按 order 升序，同值保持声明顺序） */
export function useSidebarMenu(): { menuItems: ComputedRef<SidebarMenuItem[]> } {
  const menuItems = computed(() => [...sidebarMenuItems].sort((a, b) => a.order - b.order))
  return { menuItems }
}
