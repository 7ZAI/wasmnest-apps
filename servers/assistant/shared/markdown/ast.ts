/**
 * 轻量 Markdown 的中间表示
 *
 * 只覆盖对话正文需要的子集：标题、段落、列表、代码块，以及粗体与行内代码。
 * 链接、图片、表格、引用等语法不进入 AST，按普通文本渲染。
 */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'code'; text: string }

export type MdBlock =
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { type: 'list'; ordered: boolean; items: MdInline[][] }
  | { type: 'codeBlock'; lang: string | null; text: string }