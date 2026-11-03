/**
 * 系统剪贴板读写（命令面封装）
 *
 * 只经插件命令 `lanbitou.clipboard-read/write` 调宿主 `host-clipboard`，
 * 前端不直连 `navigator.clipboard`（WebView 授权弹窗 + 环境差异，见 ADR 0006）。
 * 读取的空值归一为 `null`，调用方据此展示「剪贴板为空」而不是插入 `undefined`。
 */
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** 读剪贴板文本；无内容 / 非文本 → null */
export async function readClipboard(ctx: PluginContext): Promise<string | null> {
  const result = (await ctx.commands.execute('lanbitou.clipboard-read')) as
    | { text?: string | null }
    | null
  return typeof result?.text === 'string' ? result.text : null
}

/** 写剪贴板文本（空串是合法值，照常写入） */
export async function writeClipboard(ctx: PluginContext, text: string): Promise<void> {
  await ctx.commands.execute('lanbitou.clipboard-write', { text })
}
