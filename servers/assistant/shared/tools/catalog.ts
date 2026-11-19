/**
 * 核心工具目录（票 13 / spec §5.6）
 *
 * 端无关的本地工具（不经桥、不落库）。应用工具（app.list / app.open /
 * app.invoke.* / monitor.*）随票 15 由会话从桥目录动态装配，记忆工具
 * 随票 14 注册，均不在本文件。
 */
import type { ToolDescriptor } from './types'

/** 系统时间（read，自动执行）：时区 / 本地时间 */
export function timeNowDescriptor(): ToolDescriptor {
  return {
    name: 'time.now',
    label: '当前时间',
    description:
      '获取当前系统时间（ISO 时间、本地时间与时区名）。只读操作，无需确认。当需要「现在几点」「今天日期」「时区」等信息时使用。',
    argsSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    async executor() {
      const now = new Date()
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      return {
        text: JSON.stringify({
          iso: now.toISOString(),
          local: now.toLocaleString(),
          timestamp: now.getTime(),
          timeZone,
        }),
      }
    },
  }
}

/** 核心本地工具目录（票 13） */
export function buildCoreToolDescriptors(): ToolDescriptor[] {
  return [timeNowDescriptor()]
}
