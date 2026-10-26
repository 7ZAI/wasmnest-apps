/**
 * bedcode app 内存路由表（独立挂载包形态；桌面 UI 宿主修正 2026-10-17）
 *
 * 路由归属（§5.1.1 工程设计）：**宿主持有 history 路由表**（useShellApps 前缀集
 * 逐条声明 → AppMountSlot 装载本包），本 app 内部用**内存路由**消化宿主传入的
 * 路径（env.initialRoute / handle.setRoute），自身导航不进宿主 URL。
 *
 * 应用路由（业务面单一事实源）：
 * - 菜单项（进侧边栏，order 即视觉顺序）：/pairing 100 / /sessions 200 / /tasks 210；
 * - 设置（业务分组：配对 / 会话；平台分组在宿主系统页 /sys/settings）：
 *   /settings、/settings/authorization（遗留深链 → 宿主 /sys/perms，此处兜底）；
 * - 平台页（URL 直达、不进导航）：/server（诊断页，常驻不可开关）；
 * - 深链页（不进菜单）：/history（设备列表「历史」按钮 query 深链）、
 *   /terminal-window/:id（bareWindow：独立终端窗口，不套侧边栏外壳）；
 * - 未匹配 → 显性 not-found（fail-visible，不白屏）。
 */
import { createRouter, createMemoryHistory } from 'vue-router'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/sessions' },
    {
      path: '/pairing',
      name: 'pairing',
      component: () => import('@/components/DeviceCenterView.vue'),
    },
    {
      path: '/sessions',
      name: 'sessions',
      component: () => import('@/components/SessionCenterView.vue'),
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('@/components/TaskHistoryView.vue'),
    },
    {
      // 连接历史：设备列表「历史」按钮 query 深链直达（kind:'page' 语义）
      path: '/history',
      name: 'history',
      component: () => import('@/components/ConnectionHistoryView.vue'),
    },
    {
      // 设置（业务分组：配对 / 会话）
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
    {
      // 遗留深链：授权管理已归宿主系统页（/sys/perms），此处显性重定向
      path: '/settings/authorization',
      name: 'settings-authorization-legacy',
      redirect: '/settings',
    },
    {
      // 服务器诊断页：URL 直达、不进导航
      path: '/server',
      name: 'server',
      component: () => import('@/views/ServerView.vue'),
    },
    {
      // 独立终端窗口：bareWindow = 不套侧边栏外壳，直接渲染终端窗口视图
      path: '/terminal-window/:id',
      name: 'terminal-window',
      component: () => import('@/views/terminal/TerminalWindowView.vue'),
      meta: { bareWindow: true },
    },
    {
      // 未匹配路由兜底（fail-visible）
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
})

export default router
