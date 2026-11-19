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

  // ==================== Conversation (ticket 08) ====================
  'assistant.chat.empty': 'Nest is a system assistant, not a person. Say something to start, or configure a provider in settings first.',
  'assistant.chat.placeholder': 'Say something…',
  'assistant.chat.send': 'Send',
  'assistant.chat.stop': 'Stop',
  'assistant.chat.retry': 'Retry',
  'assistant.chat.thinking': 'Thinking',
  'assistant.chat.error': 'Request failed',
  'assistant.chat.stopped': 'Generation stopped',
  'assistant.chat.newConversation': 'New conversation',
  'assistant.chat.newTask': 'New task',
  'assistant.chat.taskTitle': 'Task',
  'assistant.chat.defaultCompanion': 'Default companion conversation (cannot be archived)',
  'assistant.chat.archived': 'Archived',
  'assistant.chat.archive': 'Archive',
  'assistant.chat.restore': 'Restore',
  'assistant.chat.rename': 'Rename',

  // ==================== Settings (ticket 08) ====================
  'assistant.settings.title': 'Settings',
  'assistant.settings.close': 'Close',
  'assistant.settings.providers': 'Model providers',
  'assistant.settings.apiStyle': 'API style',
  'assistant.settings.styleOpenai': 'OpenAI-compatible',
  'assistant.settings.styleAnthropic': 'Anthropic',
  'assistant.settings.styleGemini': 'Gemini',
  'assistant.settings.addProvider': 'Add provider',
  'assistant.settings.editProvider': 'Edit provider',
  'assistant.settings.edit': 'Edit',
  'assistant.settings.delete': 'Delete',
  'assistant.settings.save': 'Save',
  'assistant.settings.cancel': 'Cancel',
  'assistant.settings.name': 'Name',
  'assistant.settings.baseUrl': 'Base URL',
  'assistant.settings.model': 'Model',
  'assistant.settings.apiKey': 'API key',
  'assistant.settings.keySet': 'Key set',
  'assistant.settings.keyMissing': 'No key set',
  'assistant.settings.keyLeaveBlank': 'Leave blank to keep unchanged',
  'assistant.settings.setDefault': 'Set as default',
  'assistant.settings.default': 'Default',
  'assistant.settings.noProviders': 'No provider yet — add one before chatting.',
  'assistant.settings.fieldsRequired': 'Name, base URL and model are all required',
  'assistant.settings.privacyHint': 'Conversations are sent to your chosen provider. Keys stay in the local vault and are never uploaded.',
}

export default en
