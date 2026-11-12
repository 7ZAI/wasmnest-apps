/**
 * 代码高亮 composable 单元测试（2026-11-12 真机空白排查补测）
 *
 * 背景：shiki 的 Oniguruma 引擎经动态 import 装载，插件包一旦被代码分割，chunk 会
 * 解析到 `http://asset.localhost/<chunk>`（asset scope 外，403）而失败。旧实现把失败
 * 吞进 composable 内部的 `error`，调用方只看到空 `highlightedHtml` —— 界面就是
 * 「点了文件一片空白」。这里锁三条行为契约：
 * 1) 成功：`highlightedHtml` 落地；
 * 2) 失败：必须在调用方可观测的 `error` 上留痕并清空 html（+ 落日志）；
 * 3) 切文件重高亮：先清掉上一份结果，不得把旧内容留在画面上。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useFileExplorerHost } from '../host'

const shikiState = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'throw' }))

vi.mock('shiki/core', () => ({
  createHighlighterCore: async () => ({
    getLoadedLanguages: () => ['rust'],
    codeToHtml: (code: string) => {
      if (shikiState.mode === 'throw') throw new Error('engine unavailable')
      return `<pre class="shiki"><code><span class="line" data-line="1">${code}</span></code></pre>`
    },
  }),
}))
vi.mock('shiki/engine/oniguruma', () => ({ createOnigurumaEngine: () => ({}) }))
vi.mock('shiki/wasm', () => ({ default: {} }))

import { useCodeHighlight } from '../composables/useCodeHighlight'

describe('useCodeHighlight', () => {
  beforeEach(() => {
    shikiState.mode = 'ok'
  })

  it('success: publishes highlighted html and leaves error empty', async () => {
    const { highlightedHtml, error, highlight } = useCodeHighlight()
    await highlight('fn main() {}', 'rust', 'vitesse-dark')
    expect(highlightedHtml.value).toContain('fn main() {}')
    expect(error.value).toBeNull()
  })

  it('engine failure is observable on error (not a silent blank) and logs', async () => {
    const errorSpy = vi.spyOn(useFileExplorerHost().logger, 'error').mockImplementation(() => {})
    shikiState.mode = 'throw'
    const { highlightedHtml, error, highlight } = useCodeHighlight()

    await highlight('fn main() {}', 'rust')

    expect(highlightedHtml.value).toBe('')
    expect(error.value).toBe('engine unavailable')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('re-highlight clears the previous result before rendering the next one', async () => {
    const errorSpy = vi.spyOn(useFileExplorerHost().logger, 'error').mockImplementation(() => {})
    const { highlightedHtml, highlight } = useCodeHighlight()
    await highlight('first', 'rust')
    expect(highlightedHtml.value).toContain('first')

    shikiState.mode = 'throw'
    await highlight('second', 'rust')
    // 失败时不得回退显示上一份文件内容
    expect(highlightedHtml.value).toBe('')
    errorSpy.mockRestore()
  })

  it('diff highlight failure is also surfaced on error', async () => {
    const errorSpy = vi.spyOn(useFileExplorerHost().logger, 'error').mockImplementation(() => {})
    shikiState.mode = 'throw'
    const { highlightedHtml, error, highlightDiff } = useCodeHighlight()

    await highlightDiff(
      [{ type: 'added', content: '+let x = 1;', oldLineNo: null, newLineNo: 1 }],
      'rust',
    )

    expect(highlightedHtml.value).toBe('')
    expect(error.value).toBe('engine unavailable')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
