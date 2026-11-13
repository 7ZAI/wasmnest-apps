/**
 * Nest 助手 i18n 消息类型（唯一 key 来源 · 移动端）
 *
 * zh-CN 与 en 两个语言文件都必须实现该类型：新增 / 遗漏 key 在编译期即报错，
 * 保证两个语言文件的 key 永远同步。所有 key 以 `assistant.` 域命名，注册时
 * 宿主自动加插件 ID 前缀（`com.wasmnest.assistant.<key>`）。
 *
 * 用 type 别名而非 interface：TS 给类型别名隐式索引签名，使 MessageSchema
 * 可直接赋给 `Record<string, unknown>`。
 *
 * 骨架阶段只覆盖占位页；对话 / 记忆 / 保险库等界面的文案随对应票加入。
 */
export type MessageSchema = {
  // ==================== 占位页（骨架阶段） ====================
  'assistant.title': string
  'assistant.subtitle': string

  // 命令链路验证状态（占位页自动跑一次 assistant.ping）
  'assistant.state.idle': string
  'assistant.state.running': string
  'assistant.state.ok': string
  'assistant.state.error': string

  // ping 结果行
  'assistant.result': string

  // ==================== 保险库（票 07） ====================
  'assistant.vault.title': string
  'assistant.vault.subtitle': string
  'assistant.vault.unlocked': string
  'assistant.vault.locked': string
  'assistant.vault.loading': string
  'assistant.vault.setupDesc': string
  'assistant.vault.password': string
  'assistant.vault.passwordConfirm': string
  'assistant.vault.setup': string
  'assistant.vault.unlockDesc': string
  'assistant.vault.unlock': string
  'assistant.vault.lock': string
  'assistant.vault.changePassword': string
  'assistant.vault.currentPassword': string
  'assistant.vault.newPassword': string
  'assistant.vault.passwordTooShort': string
  'assistant.vault.passwordMismatch': string

  // ==================== 对话主链路（票 08） ====================
  'assistant.chat.empty': string
  'assistant.chat.placeholder': string
  'assistant.chat.send': string
  'assistant.chat.stop': string
  'assistant.chat.retry': string
  'assistant.chat.thinking': string
  'assistant.chat.error': string
  'assistant.chat.stopped': string
  'assistant.chat.newConversation': string
  'assistant.chat.newTask': string,
  'assistant.chat.taskTitle': string,
  'assistant.chat.defaultCompanion': string,
  'assistant.chat.archived': string,
  'assistant.chat.archive': string,
  'assistant.chat.restore': string,
  'assistant.chat.rename': string,

  // ==================== 设置（票 08） ====================
  'assistant.settings.title': string
  'assistant.settings.close': string
  'assistant.settings.providers': string
  'assistant.settings.apiStyle': string,
  'assistant.settings.styleOpenai': string,
  'assistant.settings.styleAnthropic': string,
  'assistant.settings.styleGemini': string,
  'assistant.settings.addProvider': string
  'assistant.settings.editProvider': string
  'assistant.settings.edit': string
  'assistant.settings.delete': string
  'assistant.settings.save': string
  'assistant.settings.cancel': string
  'assistant.settings.name': string
  'assistant.settings.baseUrl': string
  'assistant.settings.model': string
  'assistant.settings.apiKey': string
  'assistant.settings.keySet': string
  'assistant.settings.keyMissing': string
  'assistant.settings.keyLeaveBlank': string
  'assistant.settings.setDefault': string
  'assistant.settings.default': string
  'assistant.settings.noProviders': string
  'assistant.settings.fieldsRequired': string
  'assistant.settings.privacyHint': string
}

