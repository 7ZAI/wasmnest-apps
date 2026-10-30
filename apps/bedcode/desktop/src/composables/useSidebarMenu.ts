/**
 * 侧边栏菜单（静态表，D3：wasm-app 页面路由直写侧边栏）
 *
 * 桌面宿主前端整体下沉后，菜单表是 app 内的单一事实源：贡献面注册与激活态
 * 仲裁随前端插件运行时退役，侧边栏直接渲染本表。order 沿用下沉前各页面的
 * 槽位值，保证视觉顺序不变：
 * 设备配对 100 / 项目 190 / 终端会话 200 / Agent管理（原 agent-hub）205 /
 * Agent任务 210 / 设置 9999。
 *
 * 「项目」排在「终端会话」之前（ADR 0003）：项目是桌面一级容器，会话降级为
 * 运行——但两者**并存**（用户 2026-10-29 裁定：新增项目入口，不替换终端会话；
 * 旧入口待 M3 对话面成形后再评估退役）。
 *
 * 文案 key 全部为 app 域相对键（渲染处经 `useAppI18n()` 补
 * `com.wasmnest.bedcode.` 命名空间）；宿主文案不随 app 打包。
 */

import { computed, type ComputedRef } from 'vue'

/** 统一侧边栏菜单项 */
export interface SidebarMenuItem {
  /** 唯一 id（渲染 :key） */
  id: string
  /** 路由路径 */
  path: string
  /** 显示文本 i18n key（app 域相对 key，渲染时补命名空间） */
  labelKey: string
  /** SVG path d 属性（Heroicons outline 风格，viewBox 0 0 24 24） */
  icon: string
  /** 排序值，升序排列（越小越靠前） */
  order: number
}

/** 菜单排序槽位（下沉前槽位值，锁住视觉顺序） */
export const MENU_ORDERS = {
  pairing: 100,
  projects: 190,
  sessions: 200,
  agents: 205,
  tasks: 210,
  settings: 9999,
} as const

/** 侧边栏图标：宿主同款 Heroicons outline path（同图标体系） */
const PAIRING_ICON = 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z'
const PROJECTS_ICON =
  'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.688-6.75l-.75-1.5a2.25 2.25 0 00-2.013-1.25H6.75A2.25 2.25 0 004.5 5.25v4.5m17.25 3v6.75a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25v-6.75'
const SESSIONS_ICON =
  'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
const AGENTS_ICON =
  'M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z'
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
    labelKey: 'pairing.sidebar.title',
    icon: PAIRING_ICON,
    order: MENU_ORDERS.pairing,
  },
  {
    id: 'projects',
    path: '/projects',
    labelKey: 'project.sidebar.title',
    icon: PROJECTS_ICON,
    order: MENU_ORDERS.projects,
  },
  {
    id: 'sessions',
    path: '/sessions',
    labelKey: 'session.sidebar.title',
    icon: SESSIONS_ICON,
    order: MENU_ORDERS.sessions,
  },
  {
    id: 'agents',
    path: '/agents',
    labelKey: 'hub.sidebar.title',
    icon: AGENTS_ICON,
    order: MENU_ORDERS.agents,
  },
  {
    id: 'tasks',
    path: '/tasks',
    labelKey: 'task.historyTitle',
    icon: TASKS_ICON,
    order: MENU_ORDERS.tasks,
  },
  {
    id: 'settings',
    path: '/settings',
    labelKey: 'sidebar.settings',
    icon: SETTINGS_ICON,
    order: MENU_ORDERS.settings,
  },
]

/** 侧边栏菜单组合子（静态表按 order 升序，同值保持声明顺序） */
export function useSidebarMenu(): { menuItems: ComputedRef<SidebarMenuItem[]> } {
  const menuItems = computed(() => [...sidebarMenuItems].sort((a, b) => a.order - b.order))
  return { menuItems }
}
