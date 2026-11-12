/**
 * Nest 助手插件入口（移动端）— 宿主壳运行面 · 票 05 骨架
 *
 * 骨架阶段：注册 i18n 消息后经 `ui.registerSurface` 注册整页运行面（包装组件
 * `AssistantSurface` 做移动侧宿主适配，渲染共享占位视图）。占位页挂载后自动
 * 跑一次 `assistant.ping`，验证「前端 commands.execute → 共享 crate 命令 →
 * 宿主返回」链路（spec §2.4：失败点名原因，不静默假装可用）。
 */
import AssistantSurface from './components/AssistantSurface.vue'
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
  context.ui.registerSurface({ component: AssistantSurface })

  activeLogger = context.logger
  activeLogger.info('[Nest] assistant skeleton activated (mobile, ping wiring only)')
}

export async function deactivate(): Promise<void> {
  activeLogger?.info('[Nest] assistant skeleton deactivated (mobile)')
  activeLogger = null
}
