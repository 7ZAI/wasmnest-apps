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

  // ==================== 保险库（票 07） ====================
  'assistant.vault.title': '保险库',
  'assistant.vault.subtitle': '口令加密你的会话、记忆与密钥',
  'assistant.vault.unlocked': '已解锁',
  'assistant.vault.locked': '已锁定',
  'assistant.vault.loading': '处理中…',
  'assistant.vault.setupDesc': '首次使用：设置一个口令。口令只用于本地加密，不会上传；请记住它，丢失无法找回。',
  'assistant.vault.password': '口令',
  'assistant.vault.passwordConfirm': '确认口令',
  'assistant.vault.setup': '设置口令',
  'assistant.vault.unlockDesc': '输入口令解锁，解锁后才能查看会话与记忆正文。',
  'assistant.vault.unlock': '解锁',
  'assistant.vault.lock': '锁定',
  'assistant.vault.changePassword': '修改口令',
  'assistant.vault.currentPassword': '当前口令',
  'assistant.vault.newPassword': '新口令',
  'assistant.vault.passwordTooShort': '口令至少 4 位',
  'assistant.vault.passwordMismatch': '两次输入的口令不一致',
}

export default zhCN
