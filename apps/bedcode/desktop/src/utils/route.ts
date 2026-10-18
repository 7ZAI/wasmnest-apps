/**
 * app 自有 router 的读取
 *
 * 桌面宿主前端下沉后，router 实例由 app 自己持有（`src/router/index.ts`），
 * 不再经宿主共享运行时（SDK 共享 router 访问器随共享全局机制一起退役）。
 * 保留 `sharedRouter` / `currentSessionId` 两个入口名，
 * 调用点（设备页历史跳转 / 连接历史 query 深链 / 任务弹窗会话 id）不变。
 */

import router from '@/router'

/** app 自有 router（模块单例，恒在；测试可经 mock `@/router` 注入桩） */
export function sharedRouter(): typeof router {
  return router
}

/** 终端窗口路由（`/terminal-window/:id`）的会话 id；不在终端窗口返回空串 */
export function currentSessionId(): string {
  const id = sharedRouter().currentRoute.value.params.id
  return typeof id === 'string' ? id : ''
}
