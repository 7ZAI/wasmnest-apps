/**
 * 侧边栏静态菜单表契约（D3：路由直写侧边栏，无贡献注册）
 *
 * 桌面宿主前端整体下沉后，侧边栏菜单是 app 内的静态单一事实源。本测试钉：
 * - 菜单项 = 设备配对 / 终端会话 / Agent任务 / 设置 四项，order 即视觉顺序；
 * - 菜单路径与静态路由表一一对应（改表不改路由 = 死链，反之 = 死菜单）；
 * - app 域项走 `com.wasmnest.bedcode.*` 命名空间 key，宿主机制项
 *   （设置）走顶层 key——两种命名域不得混用；
 * - 连接历史 / 终端窗口是深链页，不进菜单。
 */

import { describe, it, expect } from 'vitest'
import { sidebarMenuItems, MENU_ORDERS, useSidebarMenu } from '@/composables/useSidebarMenu'
import router from '@/router'

describe('useSidebarMenu（静态表）', () => {
  it('菜单恒为四项，顺序槽位锁死（配对 100 / 会话 200 / 任务 210 / 设置 9999）', () => {
    expect(sidebarMenuItems.map((i) => i.id)).toEqual(['pairing', 'sessions', 'tasks', 'settings'])
    expect(sidebarMenuItems.map((i) => i.order)).toEqual([100, 200, 210, 9999])
    expect(MENU_ORDERS).toEqual({ pairing: 100, sessions: 200, tasks: 210, settings: 9999 })
  })

  it('useSidebarMenu 输出的菜单按 order 升序（同一静态表）', () => {
    const { menuItems } = useSidebarMenu()
    expect(menuItems.value.map((i) => i.id)).toEqual(['pairing', 'sessions', 'tasks', 'settings'])
  })

  it('菜单路径与静态路由表一一对应（双向无死链）', () => {
    const routePaths = new Set(router.getRoutes().map((r) => r.path))
    for (const item of sidebarMenuItems) {
      expect(routePaths.has(item.path), `菜单 ${item.id} 的路由 ${item.path} 不在路由表`).toBe(true)
    }
  })

  it('app 域菜单项走命名空间 key，宿主机制项（设置）走顶层 key', () => {
    expect(sidebarMenuItems[0].labelKey).toBe('com.wasmnest.bedcode.pairing.sidebar.title')
    expect(sidebarMenuItems[1].labelKey).toBe('com.wasmnest.bedcode.session.sidebar.title')
    expect(sidebarMenuItems[2].labelKey).toBe('com.wasmnest.bedcode.task.historyTitle')
    expect(sidebarMenuItems[3].labelKey).toBe('desktop.sidebar.settings')
  })

  it('深链页（连接历史 / 终端窗口）不进菜单', () => {
    const paths = sidebarMenuItems.map((i) => i.path)
    expect(paths).not.toContain('/history')
    expect(paths).not.toContain('/terminal-window/x')
  })
})
