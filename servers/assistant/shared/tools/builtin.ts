/**
 * 内置工具（票 13 / spec §5.6）
 *
 * M1 只放**本应用本地**的两个工具：
 * - `time.now`（read）：模型需要「现在几点 / 今天几号」时的真实时间源；
 * - `test.echo`（write）/ `test.danger`（danger）：仅由设置项
 *   `tools.testToolsEnabled` 打开，用于人工验证四档确认与急停真的生效。
 *   `test.danger` **不做任何破坏性动作**（只回显 scope），是风险档位的试验品。
 *
 * 应用工具（`app.list` / `app.open` / `app.invoke.*` / `monitor.snapshot`）归票 15，
 * 本模块不提前实现跨应用调用面。
 */
import type { ToolSpec } from './types'

/** 工具结果回给模型的文本上限（超出截断并明示，不静默丢数据） */
export const TOOL_RESULT_TEXT_LIMIT = 32_000

/** 创建 `time.now`（read；无参） */
export function timeNowTool(now: () => number = Date.now): ToolSpec {
  return {
    id: 'time.now',
    label: '当前时间',
    description:
      '读取本机当前时间与时区。用户问「现在几点 / 今天几号 / 多久之前」时调用，不要猜测时间。',
    risk: 'read',
    appId: null,
    command: 'local:time.now',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => {
      const epochMs = now()
      const date = new Date(epochMs)
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      return {
        iso: date.toISOString(),
        local: date.toLocaleString(),
        timeZone,
        epochMs,
      }
    },
  }
}

/** 创建 `test.echo`（write；只回显，不落盘） */
export function testWriteTool(): ToolSpec {
  return {
    id: 'test.echo',
    label: '测试写操作',
    description: '验证用写工具：把 text 原样回显。仅在开发者开启测试工具时可用，不产生持久副作用。',
    risk: 'write',
    appId: null,
    command: 'local:test.echo',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要回显的文本' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    execute: async (args) => ({ echoed: String(args.text ?? '') }),
    impact: (args) => `将回显文本（${String(args.text ?? '').slice(0, 40)}），不写入任何存储。`,
  }
}

/** 创建 `test.danger`（danger；只回显 scope，不做破坏性动作） */
export function testDangerTool(): ToolSpec {
  return {
    id: 'test.danger',
    label: '测试危险操作',
    description: '验证用危险工具：只回显 scope，不删除 / 不修改任何数据。用于验证二次确认与急停。',
    risk: 'danger',
    appId: null,
    command: 'local:test.danger',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['all', 'memory', 'audit'],
          description: '模拟的影响范围（仅回显）',
        },
      },
      required: ['scope'],
      additionalProperties: false,
    },
    execute: async (args) => ({ dangerous: String(args.scope ?? ''), performed: false }),
    impact: (args) =>
      `影响范围：${String(args.scope ?? '未知')}（测试工具只回显，不会真的删除或修改数据）。`,
  }
}

/** 本地内置工具集合（read 档；票 13） */
export function builtinTools(now: () => number = Date.now): ToolSpec[] {
  return [timeNowTool(now)]
}

/** 测试工具集合（`tools.testToolsEnabled = '1'` 时才注册给模型） */
export function testTools(): ToolSpec[] {
  return [testWriteTool(), testDangerTool()]
}
