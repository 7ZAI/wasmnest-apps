import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from '@nest-shared/markdown/parse'

describe('parseMarkdown', () => {
  it('空输入返回空块列表', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n')).toEqual([])
  })

  it('解析 1 到 6 级标题', () => {
    const blocks = parseMarkdown('# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六')
    expect(blocks).toHaveLength(6)
    expect(blocks.map((block) => (block.type === 'heading' ? block.level : null))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
  })

  it('井号后没有空格时按段落处理', () => {
    const blocks = parseMarkdown('#标题')
    expect(blocks[0]?.type).toBe('paragraph')
  })

  it('解析无序与有序列表', () => {
    const blocks = parseMarkdown('- 甲\n- 乙\n\n1. 丙\n2. 丁')
    expect(blocks).toHaveLength(2)
    const [unordered, ordered] = blocks
    expect(unordered?.type).toBe('list')
    expect(ordered?.type).toBe('list')
    if (unordered?.type === 'list' && ordered?.type === 'list') {
      expect(unordered.ordered).toBe(false)
      expect(unordered.items).toHaveLength(2)
      expect(ordered.ordered).toBe(true)
      expect(ordered.items).toHaveLength(2)
    }
  })

  it('解析围栏代码块并保留语言标记', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1\n```')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'codeBlock', lang: 'ts', text: 'const a = 1' })
  })

  it('未闭合围栏把剩余内容收进代码块', () => {
    const blocks = parseMarkdown('```\n第一行\n第二行')
    expect(blocks[0]).toMatchObject({ type: 'codeBlock', text: '第一行\n第二行' })
  })

  it('连续非空行合并为一个段落', () => {
    const blocks = parseMarkdown('第一行\n第二行\n\n第三行')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.type).toBe('paragraph')
  })

  it('HTML 标签与链接按普通文本保留', () => {
    const blocks = parseMarkdown('<b onclick="x">粗</b> 和 [链接](https://example.com)')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('paragraph')
    if (blocks[0]?.type === 'paragraph') {
      const text = blocks[0].children
        .map((node) => (node.type === 'text' ? node.text : node.type === 'code' ? node.text : ''))
        .join('')
      expect(text).toContain('<b onclick="x">')
      expect(text).toContain('[链接](https://example.com)')
    }
  })

  it('解析粗体与行内代码', () => {
    const nodes = parseInline('前 **重点** 与 `code` 后')
    expect(nodes.map((node) => node.type)).toEqual(['text', 'strong', 'text', 'code', 'text'])
    expect(nodes[1]).toMatchObject({ type: 'strong' })
    expect(nodes[3]).toMatchObject({ type: 'code', text: 'code' })
  })

  it('未闭合的行内标记按普通文本处理', () => {
    const nodes = parseInline('未闭合 **粗体 和 `代码')
    expect(nodes.every((node) => node.type === 'text')).toBe(true)
  })

  it('列表项内支持行内标记', () => {
    const blocks = parseMarkdown('- 第 **一** 项\n- 第 `二` 项')
    const list = blocks[0]
    expect(list?.type).toBe('list')
    if (list?.type === 'list') {
      expect(list.items[0]?.some((node) => node.type === 'strong')).toBe(true)
      expect(list.items[1]?.some((node) => node.type === 'code')).toBe(true)
    }
  })
})