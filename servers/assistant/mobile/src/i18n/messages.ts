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
}
