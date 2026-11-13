/**
 * 记忆提取与注入选择单测（票 14 / spec §5.4）
 *
 * 覆盖：提取结果解析（宽松 JSON 提取 / 代码块 / 空 / 非法）、摘要清洗、
 * token 估算、预算内注入选择（scope 优先 + 关键词命中 + 最近使用、
 * 超预算从尾部裁剪、只取已确认、app 作用域不注入）。
 */
import { describe, it, expect } from 'vitest'
import {
  buildExtractionUserPrompt,
  estimateTokens,
  parseExtractedFacts,
  parseSummary,
  selectMemoryForInjection,
  type ExtractedFact,
} from '@nest-shared/memory/extract'
import type { MemoryFact } from '@nest-shared/types'

function fact(over: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'f1',
    scope: 'global',
    scopeRef: null,
    key: '饮食',
    value: '不吃香菜',
    sourceConversationId: 'nest-companion',
    sourceMessageId: null,
    status: 'confirmed',
    createdAt: '1',
    updatedAt: '1',
    ...over,
  }
}

describe('parseExtractedFacts（票 14）', () => {
  it('解析标准 JSON 数组', () => {
    const out = parseExtractedFacts('[{"key":"饮食","value":"不吃香菜"}]')
    expect(out).toEqual([{ key: '饮食', value: '不吃香菜' }])
  })

  it('宽松提取：带 markdown 代码块与前后缀说明', () => {
    const text = '好的，提取如下：\n```json\n[{"key":"工作","value":"远程办公"}]\n```\n以上。'
    expect(parseExtractedFacts(text)).toEqual([{ key: '工作', value: '远程办公' }])
  })

  it('空数组 / 无数组 / 非法 JSON → 空（不抛）', () => {
    expect(parseExtractedFacts('[]')).toEqual([])
    expect(parseExtractedFacts('没有值得记住的内容')).toEqual([])
    expect(parseExtractedFacts('[{bad json}]')).toEqual([])
    expect(parseExtractedFacts('{"not":"array"}')).toEqual([])
  })

  it('缺 key / value 的条目被丢弃', () => {
    const out = parseExtractedFacts('[{"key":"","value":"x"},{"key":"k"},{"value":"v"},{"key":"a","value":"b"}]')
    expect(out).toEqual([{ key: 'a', value: 'b' }])
  })
})

describe('parseSummary（票 14）', () => {
  it('去代码块围栏并 trim', () => {
    expect(parseSummary('```\n较早内容的摘要\n```')).toBe('较早内容的摘要')
    expect(parseSummary('  摘要正文  ')).toBe('摘要正文')
  })
})

describe('estimateTokens（票 14）', () => {
  it('CJK 约 1 字 1 token，拉丁约 4 字符 1 token', () => {
    expect(estimateTokens('不吃香菜')).toBe(4)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('')).toBe(0)
  })
})

describe('selectMemoryForInjection（票 14）', () => {
  it('只取已确认事实；pending / rejected 不注入', () => {
    const sel = selectMemoryForInjection(
      [fact({ id: 'a', status: 'confirmed' }), fact({ id: 'b', status: 'pending' }), fact({ id: 'c', status: 'rejected' })],
      '',
    )
    expect(sel.facts.map((f) => f.id)).toEqual(['a'])
  })

  it('app 作用域不注入（应用数据只作临时上下文）', () => {
    const sel = selectMemoryForInjection([fact({ id: 'a', scope: 'app', scopeRef: 'monitor' })], '')
    expect(sel.facts).toEqual([])
    expect(sel.text).toBe('')
  })

  it('关键词命中提到最前', () => {
    const sel = selectMemoryForInjection(
      [
        fact({ id: 'a', key: '饮食', value: '不吃香菜' }),
        fact({ id: 'b', key: '工作', value: '远程办公' }),
      ],
      '香菜',
    )
    expect(sel.facts.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('global 优先于 conversation', () => {
    const sel = selectMemoryForInjection(
      [
        fact({ id: 'conv', scope: 'conversation', scopeRef: 'c1' }),
        fact({ id: 'glob' }),
      ],
      '',
    )
    expect(sel.facts.map((f) => f.id)).toEqual(['glob', 'conv'])
  })

  it('超预算从尾部裁剪，不截断单条', () => {
    const longValue = 'x'.repeat(200)
    const facts = [
      fact({ id: 'a', value: '短' }),
      fact({ id: 'b', value: longValue }),
      fact({ id: 'c', value: longValue }),
    ]
    const sel = selectMemoryForInjection(facts, '', 60)
    // 第一条必须完整；超预算后停止
    expect(sel.facts.map((f) => f.id)).toEqual(['a'])
    expect(sel.text).toContain('短')
    expect(sel.text).not.toContain(longValue)
  })

  it('注入文本逐条列出键值', () => {
    const sel = selectMemoryForInjection([fact({ key: '饮食', value: '不吃香菜' })], '')
    expect(sel.text).toBe('- 饮食：不吃香菜')
  })
})

describe('buildExtractionUserPrompt（票 14）', () => {
  it('包装用户消息并要求 JSON 数组', () => {
    const prompt = buildExtractionUserPrompt('记住我不吃香菜')
    expect(prompt).toContain('记住我不吃香菜')
    expect(prompt).toContain('JSON 数组')
  })
})

describe('提取结果类型（票 14）', () => {
  it('ExtractedFact 形状与解析结果一致', () => {
    const parsed: ExtractedFact[] = parseExtractedFacts('[{"key":"k","value":"v"}]')
    expect(parsed[0]).toEqual({ key: 'k', value: 'v' })
  })
})
