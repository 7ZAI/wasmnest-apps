/**
 * 多任务预览卡摘要：把 Markdown 正文压成纯文本片段。
 *
 * 卡片是只读缩略面，不跑 markdown 渲染（避免在预览路径引入额外开销）；
 * 这里只做轻量去标记：标题井号、强调符号、行内代码、链接、图片、引用、
 * 列表标记、表格分隔行、时间分隔符都还原成可读文字。
 */
export function toPlainExcerpt(content: string, maxLength = 72): string {
  // 保留换行做行级去标记，最后再压平空白
  const body = content.split('\n').slice(1).join('\n')
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-:|\s]{3,}$/gm, ' ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain
}
