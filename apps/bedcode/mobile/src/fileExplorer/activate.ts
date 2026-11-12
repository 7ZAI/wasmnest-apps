/**
 * 文件浏览器域激活（issue #24：宿主提供组件五件套自移动宿主迁入）
 *
 * - 注入域宿主服务（PluginContext → host.ts）
 * - 注册文件浏览器域文案（zh-CN / en；键自动加插件 id 前缀，取文案走 host.t）
 * - 组件不注册独立扩展点：与迁移前同一挂载形态——PresetTasksTab / TaskEditDialog /
 *   TerminalView 在各自运行面内直接 import 渲染（宿主 wasmnestHostComponents
 *   provide 面随本次迁移整面退役）
 */

import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { createFileExplorerHostServices, initFileExplorerHost } from './host'
import { messagesEn, messagesZhCN } from './i18n'

/** 激活文件浏览器域；返回 Disposable（deactivate 时回收） */
export function activateFileExplorerDomain(context: PluginContext): Disposable {
  initFileExplorerHost(createFileExplorerHostServices(context))
  context.i18n.registerMessages('zh-CN', messagesZhCN)
  context.i18n.registerMessages('en', messagesEn)

  return {
    dispose() {
      initFileExplorerHost(null)
    },
  }
}
