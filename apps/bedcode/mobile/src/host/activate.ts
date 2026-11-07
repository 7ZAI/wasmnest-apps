/**
 * 宿主页域激活（票 2026-10-09：旧宿主主流程下沉 —— 设备 / 连接态整体页）
 *
 * - 注册域 i18n（hub.*，双语）
 * - 宿主壳首页快捷卡片（活跃会话数，ShellHome 槽位）——**按存活会话动态挂载**
 *
 * 快捷卡片的生命周期（用户 2026-11-06 裁决）：卡片不是应用启动就常驻的入口，
 * 而是「当前有存活会话」的读数。`activeSessions` 为空（或只剩已停止的历史记录）
 * 时不得注册槽位——否则宿主首页会出现一张 0 /「无活跃会话」的空卡；最后一个
 * 会话停止后立即回收槽位，卡片随之消失。宿主槽位没有可见性开关，因此这里用
 * 注册 / dispose 表达显隐（registry 对壳清单是响应式投影）。
 *
 * 运行面（底部导航 + 页签容器）自票 2026-10-10 起归 app 域（见 ../app/activate.ts）——
 * 本域只出设备内容面，导航与页面容器不再由本域承担；项目内容面归 `../projects`。
 *
 * 返回 Disposable；deactivate 对称回收（观测器与槽位一起收掉）。
 */
import { watch } from 'vue'
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { getMobileApi } from '@binblink/wasmnest-plugin-sdk-mobile'
import SlotCard from './SlotCard.vue'
import { messagesEn, messagesZhCN } from './i18n'
import { isSessionActive } from './utils'

/** 存活会话数（running / waitingInput）；stopped 只是历史记录，不算「有会话」 */
function liveSessionCount(): number {
  const sessions = getMobileApi().activeSessions.value ?? []
  return sessions.filter((session: { status?: string }) => isSessionActive(session.status ?? ''))
    .length
}

export function activateHostPageDomain(context: PluginContext): Disposable {
  context.i18n.registerMessages('zh-CN', messagesZhCN)
  context.i18n.registerMessages('en', messagesEn)

  let slot: Disposable | null = null

  /** 会话集合变化 → 有会话就挂卡片，没有就回收（Disposable 可重复 dispose，幂等由空值判据保证） */
  function syncSlot(): void {
    const hasLiveSessions = liveSessionCount() > 0

    if (hasLiveSessions && !slot) {
      slot = context.ui.registerSlot({
        id: 'host-sessions',
        component: SlotCard,
        order: 10,
      })
    } else if (!hasLiveSessions && slot) {
      slot.dispose()
      slot = null
    }
  }

  // immediate：激活时若已有会话（壳重挂 / 插件重激活），卡片立即补挂
  const stopWatch = watch(liveSessionCount, syncSlot, { immediate: true })

  context.logger.info('[BedCode] host page domain activated')

  return {
    dispose() {
      stopWatch()
      slot?.dispose()
      slot = null
      context.logger.info('[BedCode] host page domain deactivated')
    },
  }
}
