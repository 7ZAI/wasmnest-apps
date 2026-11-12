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

  // ==================== Vault (ticket 07) ====================
  'assistant.vault.title': 'Vault',
  'assistant.vault.subtitle': 'A passphrase encrypts your conversations, memory and keys',
  'assistant.vault.unlocked': 'Unlocked',
  'assistant.vault.locked': 'Locked',
  'assistant.vault.loading': 'Working…',
  'assistant.vault.setupDesc': 'First run: set a passphrase. It is used for local encryption only and never uploaded; remember it — it cannot be recovered if lost.',
  'assistant.vault.password': 'Passphrase',
  'assistant.vault.passwordConfirm': 'Confirm passphrase',
  'assistant.vault.setup': 'Set passphrase',
  'assistant.vault.unlockDesc': 'Enter your passphrase to unlock. Conversations and memory are only visible when unlocked.',
  'assistant.vault.unlock': 'Unlock',
  'assistant.vault.lock': 'Lock',
  'assistant.vault.changePassword': 'Change passphrase',
  'assistant.vault.currentPassword': 'Current passphrase',
  'assistant.vault.newPassword': 'New passphrase',
  'assistant.vault.passwordTooShort': 'Passphrase must be at least 4 characters',
  'assistant.vault.passwordMismatch': 'The two passphrase entries do not match',
}

export default en
