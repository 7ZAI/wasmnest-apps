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

  // ==================== 对话主链路（票 08） ====================
  'assistant.chat.empty': 'Nest 是系统助手，不是人。说点什么开始，或先去设置配置供应商。',
  'assistant.chat.placeholder': '说点什么…',
  'assistant.chat.send': '发送',
  'assistant.chat.stop': '停止',
  'assistant.chat.retry': '重试',
  'assistant.chat.thinking': '思考中',
  'assistant.chat.error': '请求失败',
  'assistant.chat.stopped': '已停止生成',
  'assistant.chat.newConversation': '新会话',
  'assistant.chat.newTask': '新建任务',
  'assistant.chat.taskTitle': '任务',
  'assistant.chat.defaultCompanion': '默认陪伴会话（不可归档）',
  'assistant.chat.archived': '已归档',
  'assistant.chat.archive': '归档',
  'assistant.chat.restore': '恢复',
  'assistant.chat.rename': '改名',

  // ==================== 设置（票 08） ====================
  'assistant.settings.title': '设置',
  'assistant.settings.close': '关闭',
  'assistant.settings.providers': '模型供应商',
  'assistant.settings.apiStyle': '接口方言',
  'assistant.settings.styleOpenai': 'OpenAI 兼容',
  'assistant.settings.styleAnthropic': 'Anthropic',
  'assistant.settings.styleGemini': 'Gemini',
  'assistant.settings.addProvider': '添加供应商',
  'assistant.settings.editProvider': '编辑供应商',
  'assistant.settings.edit': '编辑',
  'assistant.settings.delete': '删除',
  'assistant.settings.save': '保存',
  'assistant.settings.cancel': '取消',
  'assistant.settings.name': '名称',
  'assistant.settings.baseUrl': '接口地址（base URL）',
  'assistant.settings.model': '模型',
  'assistant.settings.apiKey': 'API 密钥',
  'assistant.settings.keySet': '已设密钥',
  'assistant.settings.keyMissing': '未设密钥',
  'assistant.settings.keyLeaveBlank': '留空则不修改',
  'assistant.settings.setDefault': '设为默认',
  'assistant.settings.default': '默认',
  'assistant.settings.noProviders': '还没有供应商，添加一个后才能对话。',
  'assistant.settings.fieldsRequired': '名称、接口地址与模型都不能为空',
  'assistant.settings.privacyHint': '会话内容会发送给你选择的供应商；密钥只存本地保险库，不会上传。',
}

export default zhCN
