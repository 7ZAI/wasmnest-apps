/**
 * 项目域激活：注册 `project.*` 文案（双语）
 *
 * 运行面（AppRoot）内直接渲染 `ProjectsPage.vue`，域入口不注册 surface / slot；
 * 文案必须在 app 域运行面 setup 前就位，故 `../index.ts` 把本域排在 app 域之前。
 */
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { messagesEn, messagesZhCN } from './i18n'

export function activateProjectsDomain(context: PluginContext): Disposable {
  context.i18n.registerMessages('zh-CN', messagesZhCN)
  context.i18n.registerMessages('en', messagesEn)
  context.logger.info('[BedCode] projects domain activated')

  return {
    dispose() {
      context.logger.info('[BedCode] projects domain deactivated')
    },
  }
}
