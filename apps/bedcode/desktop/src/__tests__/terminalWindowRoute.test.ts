/**
 * 终端窗口直渲染契约（D6：不经 PluginViewHost 间接渲染）
 *
 * 桌面宿主前端整体下沉前，`/terminal-window/:id` 经宿主 PluginWindowHostView →
 * PluginViewHost 间接渲染插件视图（两段式等就绪 + 懒激活 + 宿主能力注入）。
 * 下沉后该路由**直接**指向 app 的 TerminalWindowView：无插件 loader、无激活态
 * 仲裁、无等就绪两段式。本测试钉住这条直渲染链（fail-visible：链路被改回间接
 * 形态即红）：
 * - 路由记录的懒加载组件解析后即 TerminalWindowView 本身；
 * - bareWindow meta 在位（不套侧边栏外壳）。
 */

import { describe, it, expect, vi } from 'vitest'
import router from '@/router'
import TerminalWindowView from '@/views/terminal/TerminalWindowView.vue'

// TerminalWindowView 模块级取当前窗口（happy-dom 无 Tauri 内部对象，需打桩）
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
    onMoved: async () => () => {},
    onResized: async () => () => {},
    innerPosition: async () => ({ x: 0, y: 0 }),
    outerPosition: async () => ({ x: 0, y: 0 }),
    innerSize: async () => ({ width: 800, height: 600 }),
    scaleFactor: async () => 1,
    setPosition: async () => {},
    setSize: async () => {},
    label: 'main',
  }),
  PhysicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}))

describe('终端窗口直渲染（D6）', () => {
  it('/terminal-window/:id 路由直接指向 TerminalWindowView', async () => {
    const route = router.getRoutes().find((r) => r.name === 'terminal-window')
    expect(route, 'terminal-window 路由必须存在').toBeTruthy()
    expect(route!.meta.bareWindow).toBe(true)
    // 懒加载组件解析后即 app 视图本体（中间不经任何插件宿主组件）
    const component = route!.components?.default
    expect(typeof component).toBe('function')
    const resolved = await (component as () => Promise<{ default: unknown }>)()
    expect(resolved.default).toBe(TerminalWindowView)
  })

  it('全路由表无插件视图宿主残留（PluginViewHost / 插件窗口路由不存在）', () => {
    const paths = router.getRoutes().map((r) => r.path)
    expect(paths.filter((p) => p.startsWith('/plugin/'))).toEqual([])
    expect(paths.filter((p) => p.startsWith('/plugins'))).toEqual([])
  })
})
