/**
 * 下载完成 → 打开本地所在目录（插件命令 → 宿主原语 `host-platform.reveal-in-dir`）
 *
 * 两种失败都必须让用户看见，不能静默：
 * - 没配下载目录（前端拼不出落盘路径）→ 提示去设置里选目录；
 * - 宿主报错（文件已被移动 / 删除，或历史记录落点与当前下载目录不一致）→ 失败 toast。
 * 技术详情（宿主错误信封 / 原文）只进控制台日志，不进用户文案。
 */
import { toast } from 'vue-sonner'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/**
 * 打开 `path` 所在目录；成功返回 `true`，失败已弹 toast 并返回 `false`。
 *
 * `path` 为空 = 没有下载目录（`TaskPanel` 侧拼不出路径），同样弹可见提示。
 */
export async function revealLocalPath(
  context: Pick<PluginContext, 'commands' | 'i18n'>,
  path: string,
): Promise<boolean> {
  if (!path) {
    toast.error(context.i18n.t('transfer.history.openFolderNoDir'))
    return false
  }
  try {
    await context.commands.execute('file-transfer.reveal-in-dir', { path })
    return true
  } catch (e) {
    console.error('[File Transfer] open folder failed:', e)
    toast.error(context.i18n.t('transfer.history.openFolderFailed'))
    return false
  }
}
