/**
 * 宿主页域激活（票 2026-10-09：旧宿主主流程下沉 —— 设备 / 连接态整体页）
 *
 * - 注册域 i18n（hub.*，双语）
 * - 注册宿主壳首页快捷卡片（活跃运行数，ShellHome 槽位）
 *
 * 运行面（底部导航 + 页签容器）自票 2026-10-10 起归 app 域（见 ../app/activate.ts）——
 * 本域只出设备内容面，导航与页面容器不再由本域承担；项目内容面归 `../projects`。
 *
 * 返回 Disposable；deactivate 对称回收。
 */
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import SlotCard from './SlotCard.vue'
import { messagesEn, messagesZhCN } from './i18n'

export function activateHostPageDomain(context: PluginContext): Disposable {
  context.i18n.registerMessages('zh-CN', messagesZhCN)
  context.i18n.registerMessages('en', messagesEn)

  const slot = context.ui.registerSlot({
    id: 'host-sessions',
    component: SlotCard,
    order: 10,
  })

  context.logger.info('[BedCode] host page domain activated')

  return {
    dispose() {
      slot.dispose()
      context.logger.info('[BedCode] host page domain deactivated')
    },
  }
}