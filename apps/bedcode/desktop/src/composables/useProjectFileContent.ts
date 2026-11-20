/**
 * 项目文件内容读取与语法高亮（只读查看器 / 工程文件多标签共用）
 *
 * 读文件走 `project.file-content`（后端复用 file_browse 的 2MB 上限、越界与
 * 二进制判定）；错误显性展示，不用空正文冒充「文件是空的」。
 *
 * 高亮是渐进增强：正文先以纯文本出现，高亮完成后原地替换；超大 / 未知语言 /
 * 高亮失败都退回纯文本，不阻断阅读。
 */
import { computed, ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useProjectFiles } from '@/composables/useProjectFiles'
import { resolvePluginErrorText } from '@/utils/pluginError'
import { logger } from '@/utils/frontendLogger'

export function useProjectFileContent(
  context: PluginContext,
  projectId: Ref<string>,
  path: Ref<string>,
) {
  const { readFile } = useProjectFiles(context, projectId)

  const isLoading = ref(false)
  const error = ref<unknown>(null)
  const content = ref('')
  const fileName = ref('')
  const highlightedHtml = ref('')
  const highlightTooLarge = ref(false)
  let loadSeq = 0

  const errorText = computed(() =>
    resolvePluginErrorText(context, error.value, 'project.fileViewer.loadFailed'),
  )

  const lineCount = computed(() => (content.value === '' ? 0 : content.value.split('\n').length))
  const lineNumbers = computed(() =>
    Array.from({ length: lineCount.value }, (_, index) => index + 1).join('\n'),
  )
  const gutterWidth = computed(
    () => `calc(${Math.max(2, String(lineCount.value).length)}ch + 1.5rem)`,
  )

  async function applyHighlight(seq: number, text: string, file: string): Promise<void> {
    try {
      const { highlightFileContent } = await import('@/utils/codeHighlight')
      const result = await highlightFileContent(text, file)
      if (seq !== loadSeq) return
      if (result.status === 'highlighted') {
        highlightedHtml.value = result.html
      } else if (result.status === 'too-large') {
        highlightTooLarge.value = true
      }
    } catch (e) {
      if (seq !== loadSeq) return
      logger.warn('[Project File] syntax highlight failed, falling back to plain text:', e)
    }
  }

  async function load(): Promise<void> {
    const filePath = path.value
    if (!filePath) return
    const seq = ++loadSeq
    isLoading.value = true
    error.value = null
    content.value = ''
    fileName.value = ''
    highlightedHtml.value = ''
    highlightTooLarge.value = false
    try {
      const result = await readFile(filePath)
      if (seq !== loadSeq) return
      content.value = result.content
      fileName.value = result.fileName
      void applyHighlight(seq, result.content, result.fileName)
    } catch (e) {
      if (seq !== loadSeq) return
      logger.error('[Project File] read file failed:', e)
      error.value = e
    } finally {
      if (seq === loadSeq) isLoading.value = false
    }
  }

  function invalidate(): void {
    loadSeq += 1
  }

  return {
    isLoading,
    error,
    errorText,
    content,
    fileName,
    highlightedHtml,
    highlightTooLarge,
    lineCount,
    lineNumbers,
    gutterWidth,
    load,
    invalidate,
  }
}
