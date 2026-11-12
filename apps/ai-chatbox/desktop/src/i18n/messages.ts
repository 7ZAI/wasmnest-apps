/**
 * AI Chatbox 插件 i18n 消息类型（唯一 key 来源）
 *
 * zh-CN 与 en 两个语言文件都必须实现该接口：
 * 新增/遗漏 key 在编译期即报错，保证两个语言文件的 key 永远同步。
 */

export interface MessageSchema {
  // ==================== 菜单/路由显示文本 ====================
  sidebarTitle: string

  // ==================== 对话与供应商配置（宿主 com.wasmnest.ai-chatbox.* 迁入） ====================
  configureModel: string
  title: string
  newConversation: string
  conversations: string
  noConversations: string
  noConversationsHint: string
  collapseConversations: string
  expandConversations: string
  emptyHint: string
  rename: string
  send: string
  stop: string
  regenerate: string
  inputPlaceholder: string
  startNewChat: string
  name: string
  pleaseConfigure: string
  thinkingProcess: string
  copy: string
  copied: string
  copyMessage: string
  delete: string
  deleteMessage: string
  providerConfig: string
  backToChat: string
  back: string
  addProvider: string
  editProvider: string
  saveProvider: string
  deleteProvider: string
  selectTemplate: string
  customTemplate: string
  confirmDeleteTitle: string
  confirmDeleteBody: string
  noProvidersHint: string
  activeProvider: string
  baseUrl: string
  apiKey: string
  apiKeyHint: string
  show: string
  hide: string
  modelList: string
  addModel: string
  modelId: string
  noModels: string
  removeModel: string
  fetchModels: string
  fetchingModels: string
  fetchModelsFailed: string
  fetchModelsEmpty: string
  testConnection: string
  testing: string
  testOk: string
  testFailed: string
  cancel: string
  contextLimitExceeded: string
  authRevoked: string
  apiKeyRequired: string
  baseUrlInvalid: string
  rateLimitRetryIn: string
  rateLimitStop: string
  rateLimitExhausted: string
  rateLimitAborted: string
  /** 未分类 / 未知错误码的兜底文案（ADR 0030：界面永不显示错误码原文） */
  requestFailed: string

  // ==================== 应用设置页（设置归属：wasm-app 自持，宿主无统一设置页） ====================
  pluginSettings: string
  configuredProviders: string
  expandProviders: string
  collapseProviders: string
  noConfiguredProviders: string
  codeRendering: string
  codeFontSize: string
  decrease: string
  increase: string
  codeLineHeight: string
  codeTheme: string
  codeThemeAuto: string
  codeThemeLight: string
  codeThemeDark: string
  codeThemeGithubLight: string
  codeThemeGithubDark: string
  codeThemeDracula: string
  thinking: string
  thinkingMode: string
  thinkingDefault: string
  thinkingEnabled: string
  thinkingDisabled: string
  reasoningEffort: string
  effortLow: string
  effortHigh: string
  effortMax: string
  showReasoning: string
  rateLimitGroup: string
  rateLimitMaxRetries: string
  rateLimitInitialDelay: string
  rateLimitMaxDelay: string
  rateLimitOff: string

  // ==================== 多任务卡片只读预览面（mountPreview · apps 仓 spec 2026-10-20） ====================
  previewRecentConversation: string
  previewNoProvider: string
  previewNoProviderHint: string
  previewNoConversation: string
  previewNoConversationHint: string
  previewMessagesEmpty: string
  previewUnavailable: string
  previewRoleUser: string
  previewRoleAssistant: string
  previewRoleSystem: string
  previewLastRoute: string
}
