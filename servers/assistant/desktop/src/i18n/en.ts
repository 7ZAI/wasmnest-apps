import type { MessageSchema } from './messages'

/** 英文文案（key 与 messages.ts MessageSchema 一一对应） */
const en: MessageSchema = {
  // ==================== 占位页（骨架阶段） ====================
  'assistant.title': 'Nest',
  'assistant.subtitle': 'System personal assistant · skeleton (placeholder page)',

  // Command wiring check state (placeholder page runs assistant.ping once on mount)
  'assistant.state.idle': 'Command wiring check pending',
  'assistant.state.running': 'Verifying command wiring…',
  'assistant.state.ok': 'Command wiring OK',
  'assistant.state.error': 'Command wiring check failed',

  // ping result line
  'assistant.result': 'Connected to {appId}',
}

export default en
