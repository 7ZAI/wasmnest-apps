/**
 * AI Chatbox 插件 i18n 消息类型（唯一 key 来源）
 *
 * zh-CN 与 en 两个语言文件都必须实现该接口：
 * 新增/遗漏 key 在编译期即报错，保证两个语言文件的 key 永远同步。
 */

export interface MessageSchema {
  // ==================== 菜单/路由显示文本 ====================
  navTitle: string

  // ==================== 设置页（与供应商配置同页；设置归属 wasm-app） ====================
  settingsTitle: string
  configuredProviders: string
  expandProviders: string
  collapseProviders: string
  noConfiguredProviders: string

  // ==================== 对话页文案（2026-10-27 自宿主 `mobile.plugin.aiChatbox.*` 迁入，原键在平台仓已删除） ====================
  'chat.configureModel': string
  'chat.title': string
  'chat.newConversation': string
  'chat.conversations': string
  'chat.noConversations': string
  'chat.noConversationsHint': string
  'chat.emptyHint': string
  'chat.rename': string
  'chat.send': string
  'chat.stop': string
  'chat.model': string
  'chat.regenerate': string
  'chat.inputPlaceholder': string
  'chat.startNewChat': string
  'chat.name': string
  'chat.pleaseConfigure': string
  'chat.thinkingProcess': string
  'chat.copy': string
  'chat.copied': string
  'chat.delete': string
  'chat.backToChat': string
  'chat.back': string
  'chat.close': string
  'chat.addProvider': string
  'chat.editProvider': string
  'chat.selectTemplate': string
  'chat.customTemplate': string
  'chat.saveProvider': string
  'chat.deleteProvider': string
  'chat.confirmDeleteShort': string
  'chat.confirmDeleteTitle': string
  'chat.confirmDeleteBody': string
  'chat.timeJustNow': string
  'chat.timeMinutesAgo': string
  'chat.timeHoursAgo': string
  'chat.timeDaysAgo': string
  'chat.activeProvider': string
  'chat.baseUrl': string
  'chat.apiKey': string
  'chat.apiKeyHint': string
  'chat.show': string
  'chat.hide': string
  'chat.modelList': string
  'chat.addModel': string
  'chat.modelId': string
  'chat.noModels': string
  'chat.removeModel': string
  'chat.fetchModels': string
  'chat.fetchingModels': string
  'chat.fetchModelsFailed': string
  'chat.fetchModelsEmpty': string
  'chat.testConnection': string
  'chat.testing': string
  'chat.testOk': string
  'chat.contextLimitExceeded': string
  'chat.authRevoked': string
  'chat.apiKeyRequired': string
  'chat.baseUrlInvalid': string
  'chat.rateLimitRetryIn': string
  'chat.rateLimitStop': string
  'chat.rateLimitExhausted': string
  'chat.rateLimitAborted': string
  'chat.rateLimitGroup': string
  'chat.rateLimitMaxRetries': string
  'chat.rateLimitInitialDelay': string
  'chat.rateLimitMaxDelay': string
  'chat.rateLimitOff': string
  'chat.codeRendering': string
  'chat.codeFontSize': string
  'chat.decrease': string
  'chat.increase': string
  'chat.codeLineHeight': string
  'chat.codeTheme': string
  'chat.codeThemeAuto': string
  'chat.codeThemeLight': string
  'chat.codeThemeDark': string
  'chat.codeThemeGithubLight': string
  'chat.codeThemeGithubDark': string
  'chat.codeThemeDracula': string
  'chat.thinking': string
  'chat.thinkingMode': string
  'chat.thinkingDefault': string
  'chat.thinkingEnabled': string
  'chat.thinkingDisabled': string
  'chat.reasoningEffort': string
  'chat.effortLow': string
  'chat.effortHigh': string
  'chat.effortMax': string
  'chat.showReasoning': string
}
