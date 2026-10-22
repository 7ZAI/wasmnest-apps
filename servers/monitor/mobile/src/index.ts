/**
 * Monitor 插件入口（移动端）— 宿主壳运行面
 *
 * 只读运行监控：注册 i18n 消息后经 `ui.registerSurface` 注册整页运行面；
 * 页面每 1s 调 `monitor.snapshot` 拉宿主指标快照（权限 `metrics:read`）。
 * 不在 activate 期发起任何轮询 / 连接：轮询由运行面组件挂载时启动、卸载时清理。
 */
import MonitorView from './components/MonitorView.vue'
import { messages } from './i18n'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'

/** 激活期捕获的统一日志入口（deactivate 无 context 入参） */
let activeLogger: PluginContext['logger'] | null = null

export async function activate(context: PluginContext): Promise<void> {
  // 注册 i18n 消息（自动添加插件 ID 前缀），必须在 UI 注册前完成
  for (const [locale, msgs] of Object.entries(messages)) {
    context.i18n.registerMessages(locale, { ...msgs })
  }

  // 宿主壳运行面：独立页面（appId = 插件 id 由宿主代填）
  context.ui.registerSurface({ component: MonitorView })

  activeLogger = context.logger
  activeLogger.info('[Monitor] plugin activated (mobile, read-only metrics)')
}

export async function deactivate(): Promise<void> {
  activeLogger?.info('[Monitor] plugin deactivated (mobile)')
  activeLogger = null
}
