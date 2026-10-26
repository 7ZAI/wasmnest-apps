import { shallowRef } from 'vue'
import { logger } from '@/utils/frontendLogger'
import i18n from '@/i18n'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen, emitTo, type UnlistenFn } from '@tauri-apps/api/event'
import type { SessionInfo } from '@/composables/model'

// Re-export from model
import type { TerminalWindowState } from './model'
export type { TerminalWindowState }

// ==================== 单例模式 ====================
// 模块级别的状态，确保所有组件共享同一个实例
const windows = shallowRef<Map<string, TerminalWindowState>>(new Map())

// 跟踪正在关闭的窗口，防止重复调用
const closingWindows = new Set<string>()

/**
 * 终端窗口管理器
 *
 * 管理每个会话对应的终端窗口的创建、聚焦、关闭
 * 使用单例模式，确保所有组件共享状态
 */
export function useSessionWindows() {
  /**
   * 为会话创建或聚焦终端窗口
   *
   * 返回 Promise：新窗口时在窗口 show 完成后 resolve（页面就绪事件或 4s 兜底），
   * 创建失败时 reject；已有窗口时直接聚焦立即返回（调用方据此决定是否显示 loading）
   *
   * @returns `true` = 新建窗口；`false` = 既有窗口已聚焦
   *          （插件会话页经 `context.session.openTerminal` 消费同一语义）
   */
  async function openTerminalWindow(session: Pick<SessionInfo, 'id' | 'name'>): Promise<boolean> {
    // 检查是否已有窗口
    const existingState = windows.value.get(session.id)
    if (existingState) {
      // 窗口已存在，聚焦它
      try {
        await existingState.window.setFocus()
        return false
      } catch (e) {
        // 窗口可能已关闭，移除引用
        logger.log('[useSessionWindows] Window focus failed, removing reference:', e)
        windows.value.delete(session.id)
      }
    }

    // 获取主窗口
    // Tauri 的 innerSize/outerSize/outerPosition 返回物理像素，
    // 而 WebviewWindow 创建参数（width/height/x/y）需要逻辑像素，
    // 高分屏（缩放 > 1）下不转换会导致终端窗口被放大 scaleFactor 倍
    const mainWindow = getCurrentWindow()
    const scaleFactor = await mainWindow.scaleFactor()
    const mainPosition = (await mainWindow.outerPosition()).toLogical(scaleFactor)
    const mainSize = (await mainWindow.outerSize()).toLogical(scaleFactor)
    const mainInnerSize = (await mainWindow.innerSize()).toLogical(scaleFactor)

    logger.log('[useSessionWindows] Main window position (logical):', mainPosition)
    logger.log('[useSessionWindows] Main window size (outerSize, logical):', mainSize)
    logger.log('[useSessionWindows] Main window size (innerSize, logical):', mainInnerSize)

    // 计算终端窗口位置（紧贴主窗口右侧）
    // 使用 innerSize 确保与主窗口内容区高度一致
    const terminalWidth = Math.floor(mainInnerSize.width * 0.6)
    const terminalHeight = mainInnerSize.height

    logger.log(
      '[useSessionWindows] Terminal window size - width:',
      terminalWidth,
      'height:',
      terminalHeight,
    )

    // 计算新窗口位置，确保不超过屏幕边界（window.screen 为逻辑像素）
    let terminalX = mainPosition.x + mainSize.width
    const screenWidth = window.screen.width

    // 如果窗口会超出屏幕右侧，放到主窗口左侧
    if (terminalX + terminalWidth > screenWidth) {
      terminalX = mainPosition.x - terminalWidth
    }

    // 如果左侧也超出（屏幕太窄），则居中显示
    if (terminalX < 0) {
      terminalX = Math.floor((screenWidth - terminalWidth) / 2)
    }

    const windowLabel = `terminal-${session.id}`

    // 创建终端窗口 - 使用独立的 terminal.html 页面
    // 先隐藏创建，等页面内容就绪后再显示，避免加载过程中的闪屏
    const terminalWindow = new WebviewWindow(windowLabel, {
      url: `/terminal-window/${session.id}`,
      title: i18n.global.t('common.misc.terminalTitle', { name: session.name }),
      width: terminalWidth,
      height: terminalHeight,
      x: terminalX,
      y: mainPosition.y,
      resizable: true,
      decorations: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      center: false,
      visible: false,
      backgroundColor: '#111827',
    })

    // 就绪 Promise：窗口 show 完成后 resolve（调用方据此关闭 loading），
    // 创建失败时 reject 让调用方提示错误
    let resolveReady: (() => void) | null = null
    let rejectReady: ((e: unknown) => void) | null = null
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })

    let unlistenReady: UnlistenFn | null = null
    let readyTimeout: number | null = null
    let readyShown = false

    /**
     * 显示终端窗口并通知页面播放显现动画
     */
    async function showTerminalWindow() {
      if (readyShown) return
      readyShown = true
      if (unlistenReady) {
        unlistenReady()
        unlistenReady = null
      }
      if (readyTimeout !== null) {
        window.clearTimeout(readyTimeout)
        readyTimeout = null
      }
      try {
        // show 成功即视为就绪：焦点与动画是锦上添花，失败不影响窗口展示
        await terminalWindow.show()
        resolveReady?.()
        try {
          await terminalWindow.setFocus()
        } catch (e) {
          logger.error('[useSessionWindows] Focus error after show:', e)
        }
        // 通知终端页面播放显现动画
        try {
          await emitTo(windowLabel, 'terminal-show', { sessionId: session.id })
        } catch (e) {
          logger.error('[useSessionWindows] Emit terminal-show error:', e)
        }
      } catch (e) {
        rejectReady?.(e)
      }
    }

    // 兜底：页面未能发出就绪事件时，超时后仍然显示窗口
    readyTimeout = window.setTimeout(() => {
      showTerminalWindow()
    }, 4000)

    // 页面内容就绪后立即显示（并清除兜底超时）
    unlistenReady = await listen<{ sessionId: string }>('terminal-ready', (event) => {
      if (event.payload.sessionId !== session.id) return
      showTerminalWindow()
    })

    const cleanup = () => {
      if (unlistenReady) {
        unlistenReady()
        unlistenReady = null
      }
      if (readyTimeout !== null) {
        window.clearTimeout(readyTimeout)
        readyTimeout = null
      }
    }

    // 监听窗口关闭事件
    terminalWindow.once('tauri://close-requested', () => {
      cleanup()
      windows.value.delete(session.id)
    })

    // 存储窗口状态
    windows.value.set(session.id, {
      window: terminalWindow,
    })
    logger.log('[useSessionWindows] Window stored, keys:', Array.from(windows.value.keys()))

    // 监听窗口创建失败
    terminalWindow.once('tauri://error', (e) => {
      cleanup()
      logger.error('[useSessionWindows] Window creation error:', e)
      windows.value.delete(session.id)
      rejectReady?.(e)
    })

    // 等待窗口就绪（就绪事件或 4s 兜底超时）
    await ready
    return true
  }

  /**
   * 关闭指定会话的终端窗口
   * @param sessionId - 会话 ID
   */
  async function closeTerminalWindow(sessionId: string) {
    // 防止重复调用
    if (closingWindows.has(sessionId)) {
      logger.log('[useSessionWindows] Window already closing, skipping:', sessionId)
      return
    }

    logger.log('[useSessionWindows] closeTerminalWindow called, sessionId:', sessionId)
    logger.log('[useSessionWindows] windows.value keys:', Array.from(windows.value.keys()))

    // 标记为正在关闭
    closingWindows.add(sessionId)

    try {
      // 使用 getByLabel 检查窗口是否仍然存在
      const windowLabel = `terminal-${sessionId}`
      logger.log('[useSessionWindows] Checking window with label:', windowLabel)

      const window = await WebviewWindow.getByLabel(windowLabel)
      logger.log('[useSessionWindows] getByLabel result:', window)
      logger.log('[useSessionWindows] window type:', window ? typeof window : 'null')

      if (window) {
        logger.log('[useSessionWindows] Window exists, closing...')
        logger.log('[useSessionWindows] window.label:', window.label)
        try {
          await window.close()
          logger.log('[useSessionWindows] Close request sent')
        } catch (e) {
          logger.error('[useSessionWindows] Close error:', e)
        }
      } else {
        logger.log('[useSessionWindows] Window already closed or never existed')
      }

      // 从本地状态中移除
      windows.value.delete(sessionId)
    } catch (e) {
      logger.error('[useSessionWindows] Error checking window:', e)
      windows.value.delete(sessionId)
    } finally {
      // 移除正在关闭的标记
      closingWindows.delete(sessionId)
    }
  }

  /**
   * 关闭所有终端窗口
   */
  async function closeAllTerminalWindows() {
    for (const [sessionId, state] of windows.value) {
      try {
        await state.window.close()
      } catch (e) {
        logger.error('[useSessionWindows] Close window error:', e)
      }
    }
    windows.value.clear()
  }

  /**
   * 检查指定会话是否有打开的终端窗口
   */
  function hasTerminalWindow(sessionId: string): boolean {
    return windows.value.has(sessionId)
  }

  return {
    windows,
    openTerminalWindow,
    closeTerminalWindow,
    closeAllTerminalWindows,
    hasTerminalWindow,
  }
}
