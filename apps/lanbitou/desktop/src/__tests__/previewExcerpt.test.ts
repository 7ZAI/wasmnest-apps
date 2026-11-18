import { describe, expect, it } from 'vitest'
import { toPlainExcerpt } from '../preview/excerpt'

describe('toPlainExcerpt', () => {
  it('跳过标题行并把 Markdown 标记还原成纯文本', () => {
    const content = [
      '# 设计评审',
      '',
      '**日期**：2026-11-03',
      '',
      '> 一句话结论',
      '',
      '- [x] 第一项',
      '',
      '```ts',
      'const a = 1',
      '```',
    ].join('\n')
    expect(toPlainExcerpt(content)).toBe('日期：2026-11-03 一句话结论 第一项')
  })

  it('链接保留文字、图片与表格分隔行丢弃', () => {
    const content = [
      '标题',
      '看[文档](https://example.com) ![图](a.png)',
      '| 场景 | 行为 |',
      '| --- | --- |',
      '| 新建 | 落位 |',
    ].join('\n')
    expect(toPlainExcerpt(content)).toBe('看文档 场景 行为 新建 落位')
  })

  it('超长内容截断并加省略号', () => {
    const content = `标题\n${'字'.repeat(100)}`
    expect(toPlainExcerpt(content, 10)).toBe(`${'字'.repeat(10)}…`)
  })

  it('空正文返回空串', () => {
    expect(toPlainExcerpt('')).toBe('')
  })
})
