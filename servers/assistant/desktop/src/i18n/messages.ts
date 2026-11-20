/**
 * Nest 助手 i18n 消息类型（唯一 key 来源）
 *
 * zh-CN 与 en 两个语言文件都必须实现该类型：新增 / 遗漏 key 在编译期即报错，
 * 保证两个语言文件的 key 永远同步。所有 key 以 `assistant.` 域命名，注册时经
 * 插件 ID 前缀隔离为 `com.wasmnest.assistant.assistant.*`。
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
  'assistant.vault.errorRuntime': string
  'assistant.vault.errorNotRunning': string
  'assistant.vault.errorUnknown': string

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


  // ==================== 记忆管理（票 12） ====================
  'assistant.memory.title': string
  'assistant.memory.subtitle': string
  'assistant.memory.memorySwitch': string
  'assistant.memory.extractSwitch': string
  'assistant.memory.switchHint': string
  'assistant.memory.tabConfirmed': string
  'assistant.memory.tabPending': string
  'assistant.memory.tabRejected': string
  'assistant.memory.filterAll': string
  'assistant.memory.scopeGlobal': string
  'assistant.memory.scopeApp': string
  'assistant.memory.scopeConversation': string
  'assistant.memory.filterApp': string
  'assistant.memory.inboxHint': string
  'assistant.memory.key': string
  'assistant.memory.save': string
  'assistant.memory.confirm': string
  'assistant.memory.reject': string
  'assistant.memory.rejectedHint': string
  'assistant.memory.delete': string
  'assistant.memory.edit': string
  'assistant.memory.source': string
  'assistant.memory.sourceUnknown': string
  'assistant.memory.empty': string
  'assistant.memory.clearAll': string
  'assistant.memory.clearConfirm': string
  'assistant.memory.clearDone': string
  'assistant.memory.enabledOn': string
  'assistant.memory.enabledOff': string
  'assistant.memory.savedHint': string

  // ==================== 工具运行时（票 13） ====================
  'assistant.tool.running': string
  'assistant.tool.awaiting': string
  'assistant.tool.done': string
  'assistant.tool.error': string
  'assistant.tool.rejected': string
  'assistant.tool.stopped': string
  'assistant.tool.args': string
  'assistant.tool.result': string
  'assistant.tool.confirmPrompt': string
  'assistant.tool.confirmAgain': string
  'assistant.tool.impact': string
  'assistant.tool.confirm': string
  'assistant.tool.reject': string
  'assistant.tool.stopAndLock': string
  'assistant.tool.risk.read': string
  'assistant.tool.risk.ui': string
  'assistant.tool.risk.write': string
  'assistant.tool.risk.danger': string

  // ==================== 审计（票 13） ====================
  'assistant.audit.title': string
  'assistant.audit.subtitle': string
  'assistant.audit.command': string
  'assistant.audit.risk': string
  'assistant.audit.decisionAllowed': string
  'assistant.audit.decisionDenied': string
  'assistant.audit.empty': string
  'assistant.audit.clear': string
  'assistant.audit.clearConfirm': string
  'assistant.audit.clearDone': string
'assistant.memory.injectTitle': string
  'assistant.memory.injectHint': string
  'assistant.memory.notice': string
  // 首次使用非人声明（spec §5.5；locale 已有文案，schema 必须同步，
  // 否则 vue-tsc 在 i18n 字面量上报缺失键）
  'assistant.notice.title': string
  'assistant.notice.body': string
  'assistant.notice.dismiss': string
}
