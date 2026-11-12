import type { MessageSchema } from './messages'

/** 中文文案（key 与 messages.ts MessageSchema 一一对应） */
const zhCN: MessageSchema = {
  // ==================== 占位页（骨架阶段） ====================
  'assistant.title': '巢',
  'assistant.subtitle': '系统级个人助手 · 骨架阶段（占位页）',

  // 命令链路验证状态（占位页自动跑一次 assistant.ping）
  'assistant.state.idle': '等待验证命令链路',
  'assistant.state.running': '正在验证命令链路…',
  'assistant.state.ok': '命令链路已连通',
  'assistant.state.error': '命令链路验证失败',

  // ping 结果行
  'assistant.result': '已连通 {appId}',
}

export default zhCN
