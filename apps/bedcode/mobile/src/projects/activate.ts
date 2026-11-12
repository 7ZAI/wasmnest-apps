/**
 * 项目域激活：注册 `project.*` 文案（双语）+ 初始化会话目录
 *
 * 运行面（AppRoot）内直接渲染 `ProjectsPage.vue`，域入口不注册 surface / slot；
 * 文案必须在 app 域运行面 setup 前就位，故 `../index.ts` 把本域排在 app 域之前。
 *
 * 会话目录（`../host/sessionDirectory`）合并宿主 `activeSessions` 与
 * `bedcode.list-runs`：桌面 `/api/sessions` 的 `scope:"session"` 不含项目运行，
 * 终端 / 任务 / 徽标必须经合并视图才能看到项目运行（ADR 0003 + 2026-11-06 裁定）。
 */
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { initSessionDirectory } from '../host/sessionDirectory'
import { messagesEn, messagesZhCN } from './i18n'

export function activateProjectsDomain(context: PluginContext): Disposable {
  context.i18n.registerMessages('zh-CN', messagesZhCN)
  context.i18n.registerMessages('en', messagesEn)
  const directory = initSessionDirectory(context)
  context.logger.info('[BedCode] projects domain activated')

  return {
    dispose() {
      directory.dispose()
      context.logger.info('[BedCode] projects domain deactivated')
    },
  }
}
