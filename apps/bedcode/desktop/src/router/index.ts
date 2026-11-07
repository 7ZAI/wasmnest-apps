/**
 * bedcode app 内存路由表（独立挂载包形态；桌面 UI 宿主修正 2026-10-17）
 *
 * 路由归属（§5.1.1 工程设计）：**宿主持有 history 路由表**（useShellApps 前缀集
 * 逐条声明 → AppMountSlot 装载本包），本 app 内部用**内存路由**消化宿主传入的
 * 路径（env.initialRoute / handle.setRoute），自身导航不进宿主 URL。
 *
 * 应用路由（业务面单一事实源）：
 * - 菜单项（进侧边栏，order 即视觉顺序）：/pairing 100 / /projects 190 /
 *   /agents 205（Agent 管理域，原 agent-hub 并入）/ /orchestrations 207 /
 *   /tasks 210；
 * - 设置（业务分组：配对 / 会话；平台分组在宿主系统页 /sys/settings）：
 *   /settings、/settings/authorization（遗留深链 → 宿主 /sys/perms，此处兜底）；
 * - 平台页（URL 直达、不进导航）：/server（诊断页，常驻不可开关）；
 * - 深链页（不进菜单）：/history（设备列表「历史」按钮 query 深链）、
 *   /terminal-window/:id（bareWindow：独立终端窗口，不套侧边栏外壳）；
 * - 未匹配 → 显性 not-found（fail-visible，不白屏）。
 *
 * 终端会话中心（原 /sessions 路由）已于 2026-11-06 停用（用户裁定）：项目运行是
 * 唯一的一级容器，终端会话面不再作为入口——后端 `session.list` 同步只返回无项目
 * 归属的行，项目运行的会话不再从该面透出。路由整条注释保留，便于回滚。
 */
import { createRouter, createMemoryHistory } from 'vue-router'

/** 应用默认落地页（入口与卸载回位共用；终端会话面停用后归项目列表） */
export const DEFAULT_ROUTE = '/projects'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: DEFAULT_ROUTE },
    {
      path: '/pairing',
      name: 'pairing',
      component: () => import('@/components/DeviceCenterView.vue'),
    },
    {
      // 项目列表（ADR 0003：项目 = 目录 + 执行环境，取代终端会话成为一级容器）
      path: '/projects',
      name: 'projects',
      component: () => import('@/views/projects/ProjectListView.vue'),
    },
    {
      // 项目工作台（左运行列表 / 中对话面 / 右检查器）；id = 项目 id
      path: '/projects/:id',
      name: 'project-workbench',
      component: () => import('@/views/projects/ProjectWorkbenchView.vue'),
    },
    // 终端会话中心：2026-11-06 停用（入口与读面一并摘除）。回滚时取消注释即可，
    // 同时去掉 `lib.rs` 里 `session.list` 的 `{ scope: "session" }`。
    // {
    //   path: '/sessions',
    //   name: 'sessions',
    //   component: () => import('@/components/SessionCenterView.vue'),
    // },
    {
      // Agent 管理域（原 agent-hub 并入）：安装/引导/Skills/供应商/用量/日志，
      // 与会话启动联动（安装卡片「启动会话」→ 会话配置 → 终端）
      path: '/agents',
      name: 'agents',
      component: () => import('@/agents/components/AgentHubView.vue'),
    },
    {
      // Agent 编排（v1）：计划 / 执行 / 证据三平面；列表 + 详情
      path: '/orchestrations',
      name: 'orchestrations',
      component: () => import('@/views/orchestration/OrchestrationListView.vue'),
    },
    {
      path: '/orchestrations/:id',
      name: 'orchestration-detail',
      component: () => import('@/views/orchestration/OrchestrationDetailView.vue'),
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
