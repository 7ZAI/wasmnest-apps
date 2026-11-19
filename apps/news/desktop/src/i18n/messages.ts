/**
 * 文案表类型真源。
 *
 * key 集合由简体中文表推导：英文表缺项 = 编译错误，因此不存在「切到英文还剩
 * 中文硬编码」的静默缺口。
 */
import zhCN from './zh-CN'

/** 本 app 的全部文案 key（不含命名空间前缀）。 */
export type MessageKey = keyof typeof zhCN

/** 某个 locale 的完整文案表。 */
export type MessageTable = Record<MessageKey, string>
