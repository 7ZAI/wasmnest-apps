/**
 * 文件浏览器域宿主接入点（issue #24：宿主提供组件五件套自移动宿主迁入）
 *
 * 域内组件（FileExplorer / FileSidebar / FileViewerModal / CodeViewerSettingsModal）
 * 与 codeViewer store 的宿主机制消费统一收口到这里：
 * - 文案：`t` → context.i18n.t（键相对插件命名空间，如 'file.title'）
 * - 日志：`logger` → context.logger（写入宿主 tracing；变参在适配层拼接为单参）
 * - 轻提示：`toast` → context.dialogs.showToast（签名对齐宿主 useToast 的
 *   success/error/info 三方法；duration 参数宿主 sonner 面独有，经 dialogs 面不透传）
 *
 * 激活时由 `activate.ts` 调用 `initFileExplorerHost(createFileExplorerHostServices(ctx))`；
 * 未初始化（单测 / 纯工具模块）时走 fallback：文案回显 key、日志落 console、
 * toast 空实现——保证纯逻辑模块可独立加载（与 terminal/host.ts 同一范式）。
 *
 * 其余宿主机制不进本文件：HTTP 走 `api.ts`（SDK mobileApi.httpRequest 通道）、
 * 深色判定经 SDK `getMobileApi().isDark`、方向检测复用 terminal 域 useOrientation、
 * safeArea 经宿主 App.vue provide 沿组件树 inject（迁移前后同一挂载形态）。
 */
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'

export interface FileExplorerHostServices {
  t: (key: string, params?: Record<string, unknown>) => string
  logger: {
    /** 一般日志（对齐宿主 frontendLogger.log；落 info 级） */
    log(...args: any[]): void
    debug(...args: any[]): void
    info(...args: any[]): void
    warn(...args: any[]): void
    error(...args: any[]): void
  }
  toast: {
    success(message: string): void
    error(message: string): void
    info(message: string): void
  }
}

/** 变参日志参数 → 单行文本（SDK logger 为单参接口） */
function formatArgs(args: any[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

/** 从 PluginContext 构造域内服务（activate / 真机路径） */
export function createFileExplorerHostServices(ctx: PluginContext): FileExplorerHostServices {
  return {
    t: (key, params) => ctx.i18n.t(key, params),
    logger: {
      log: (...a) => ctx.logger.info(formatArgs(a)),
      debug: (...a) => ctx.logger.debug(formatArgs(a)),
      info: (...a) => ctx.logger.info(formatArgs(a)),
      warn: (...a) => ctx.logger.warn(formatArgs(a)),
      error: (...a) => ctx.logger.error(formatArgs(a)),
    },
    toast: {
      success: (m) => ctx.dialogs.showToast(m, 'success'),
      error: (m) => ctx.dialogs.showToast(m, 'error'),
      info: (m) => ctx.dialogs.showToast(m, 'info'),
    },
  }
}

let services: FileExplorerHostServices | null = null

/** 注入域服务（activate 调用；deactivate 可显式置空） */
export function initFileExplorerHost(next: FileExplorerHostServices | null): void {
  services = next
}

/** 未初始化时的降级实现（单测 / 纯工具场景；文案回显 key，日志落 console） */
// 单例：useFileExplorerHost() 未初始化时返回同一实例，单测可稳定 spyOn（如 codeViewer store 的 warn 断言）
const FALLBACK_SERVICES: FileExplorerHostServices = {
  t: (key) => key,
  logger: {
    log: (...a) => console.log('[fileExplorer]', ...a),
    debug: (...a) => console.debug('[fileExplorer]', ...a),
    info: (...a) => console.info('[fileExplorer]', ...a),
    warn: (...a) => console.warn('[fileExplorer]', ...a),
    error: (...a) => console.error('[fileExplorer]', ...a),
  },
  // 未初始化（单测）时的 toast 面：空实现不静默抛错，调用方断言经文案 / 状态面进行
  toast: {
    success: () => {},
    error: () => {},
    info: () => {},
  },
}

/** 域内组件统一入口：取当前域服务（未激活时 fallback） */
export function useFileExplorerHost(): FileExplorerHostServices {
  return services ?? FALLBACK_SERVICES
}
