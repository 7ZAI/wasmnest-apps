/**
 * 源码高亮模块契约：语言映射表与降级判据
 *
 * 只测纯函数 / early-return 分支——真渲染一次 shiki 要编译 oniguruma wasm，
 * 那是集成层的成本，不给单测背。
 */
import { describe, it, expect } from 'vitest'
import {
  getLangByFilename,
  highlightFileContent,
  MAX_HIGHLIGHT_CHARS,
} from '@/utils/codeHighlight'

describe('getLangByFilename', () => {
  it('按扩展名映射常见语言', () => {
    expect(getLangByFilename('main.rs')).toBe('rust')
    expect(getLangByFilename('App.vue')).toBe('vue')
    expect(getLangByFilename('index.d.ts')).toBe('typescript')
    expect(getLangByFilename('config.yml')).toBe('yaml')
    expect(getLangByFilename('README.md')).toBe('markdown')
  })

  it('无扩展名文件按整名匹配（Dockerfile / Makefile）', () => {
    expect(getLangByFilename('Dockerfile')).toBe('dockerfile')
    expect(getLangByFilename('Makefile')).toBe('makefile')
  })

  it('未知 / 无扩展名返回 null（调用方纯文本渲染）', () => {
    expect(getLangByFilename('LICENSE')).toBeNull()
    expect(getLangByFilename('notes.unknownext')).toBeNull()
  })
})

describe('highlightFileContent 降级判据', () => {
  it('未知语言直接 unsupported，不初始化高亮器', async () => {
    await expect(highlightFileContent('hello', 'LICENSE')).resolves.toEqual({
      status: 'unsupported',
    })
  })

  it('超过上限返回 too-large（大文件不 tokenize）', async () => {
    const content = 'a'.repeat(MAX_HIGHLIGHT_CHARS + 1)
    await expect(highlightFileContent(content, 'main.rs')).resolves.toEqual({
      status: 'too-large',
    })
  })
})
