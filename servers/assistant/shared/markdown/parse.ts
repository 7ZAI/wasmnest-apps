/**
 * 轻量 Markdown 解析
 *
 * 白名单式：只识别标题、段落、有序 / 无序列表、围栏代码块，以及粗体与行内代码。
 * 不做 HTML 解析、不做链接与图片，因此渲染端不需要注入 HTML，也不存在脚本注入面。
 * 未闭合的围栏与行内标记按普通文本处理，保证流式增量不会产生半截结构。
 */
import type { MdBlock, MdInline } from './ast'

const HEADING = /^(#{1,6})\s+(.*)$/
const UNORDERED = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
const FENCE = /^```([^\s`]*)\s*$/
const FENCE_END = /^```\s*$/

export function parseInline(text: string): MdInline[] {
  const nodes: MdInline[] = []
  let buffer = ''
  let index = 0

  const flush = () => {
    if (buffer) {
      nodes.push({ type: 'text', text: buffer })
      buffer = ''
    }
  }

  while (index < text.length) {
    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2)
      if (end > index + 2) {
        flush()
        nodes.push({ type: 'strong', children: parseInline(text.slice(index + 2, end)) })
        index = end + 2
        continue
      }
    }

    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1)
      if (end > index + 1) {
        flush()
        nodes.push({ type: 'code', text: text.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }

    buffer += text[index]
    index += 1
  }

  flush()
  return nodes
}

export function parseMarkdown(source: string): MdBlock[] {
  if (!source) return []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let paragraphLines: string[] = []
  let index = 0

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return
    blocks.push({ type: 'paragraph', children: parseInline(paragraphLines.join('\n')) })
    paragraphLines = []
  }

  while (index < lines.length) {
    const line = lines[index]

    const fence = line.match(FENCE)
    if (fence) {
      flushParagraph()
      const lang = fence[1] || null
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE_END.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: 'codeBlock', lang, text: body.join('\n') })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      flushParagraph()
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2]),
      })
      index += 1
      continue
    }

    if (/^\s*$/.test(line)) {
      flushParagraph()
      index += 1
      continue
    }

    const ordered = ORDERED.test(line)
    const unordered = UNORDERED.test(line)
    if (ordered || unordered) {
      flushParagraph()
      const pattern = ordered ? ORDERED : UNORDERED
      const items: MdInline[][] = []
      while (index < lines.length) {
        const item = lines[index].match(pattern)
        if (!item) break
        items.push(parseInline(item[1]))
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    paragraphLines.push(line)
    index += 1
  }

  flushParagraph()
  return blocks
}