/**
 * 扫码模块共享的最小类型面
 *
 * 只放「契约」不放实现：扫描子模块不依赖 `vue` / 插件上下文，日志按最小接口注入，
 * 便于纯函数单测与离线评测（`node scripts/qr-decode-bench.mjs`）。
 */

/** 日志最小面（与 `PluginContext.logger` 兼容的子集；`info` 可选，便于测试传最小桩） */
export interface LoggerLike {
  warn: (message: string) => void
  /** 正常路径的排障信息（成功命中档位 / 耗时）；缺省时调用方不记录 */
  info?: (message: string) => void
}
