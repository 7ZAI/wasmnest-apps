<template>
  <div ref="editorContainer" class="lanbitou-editor h-full" data-testid="editor" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { CursorPosition, FontFamily } from '../types'

const props = withDefaults(
  defineProps<{
    modelValue: string
    fontSize?: number
    fontFamily?: FontFamily
    readOnly?: boolean
    /** 当前文档 id：变化 = 换文档（重置撤销栈，避免 Ctrl+Z 撤到上一篇的正文） */
    documentId?: string | null
  }>(),
  { fontSize: 14, fontFamily: 'monospace', readOnly: false, documentId: null },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'cursor-change': [position: CursorPosition]
  'scroll-change': [scrollTop: number]
  blur: []
}>()

const editorContainer = ref<HTMLElement | null>(null)
let editorView: EditorView | null = null
const appearance = new Compartment()

const FONT_STACKS: Record<FontFamily, string> = {
  monospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  'sans-serif': 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", serif',
}

function appearanceExtension() {
  return [
    EditorView.theme({
      '&': {
        height: '100%',
        fontSize: `${props.fontSize}px`,
        backgroundColor: 'transparent',
        color: 'var(--text-primary)',
        // 宿主壳根是 user-select: none，编辑器必须显式要回文本选中（鼠标框选的前提）
        userSelect: 'text',
        WebkitUserSelect: 'text',
      },
      '.cm-content': {
        fontFamily: FONT_STACKS[props.fontFamily],
        caretColor: 'var(--text-primary)',
        // 与预览区 p-4（1rem）同宽，分屏时两侧留白一致
        padding: '1rem',
        userSelect: 'text',
        WebkitUserSelect: 'text',
      },
      '.cm-scroller': {
        fontFamily: FONT_STACKS[props.fontFamily],
        userSelect: 'text',
        WebkitUserSelect: 'text',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--text-tertiary)',
        border: 'none',
      },
      // 当前行只做极淡底纹：与选区同屏时不能抢眼（此前用 --bg-hover 会盖过选区）
      '.cm-activeLine': { backgroundColor: 'var(--lb-active-line-bg)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-secondary)' },
      '&.cm-focused': { outline: 'none' },
      // 选区用应用 token 上色（style.css 里的 --lb-selection-*）：
      // CM 默认的淡紫在米色纸面上几乎看不见，用户会以为框选坏了
      '.cm-selectionBackground': { backgroundColor: 'var(--lb-selection-bg-idle)' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
        backgroundColor: 'var(--lb-selection-bg)',
      },
      '.cm-content ::selection': { backgroundColor: 'var(--lb-selection-bg)' },
      // 选中词的同名高亮 / 查找高亮
      '.cm-selectionMatch': { backgroundColor: 'var(--lb-selection-bg-idle)' },
      '.cm-searchMatch': { backgroundColor: 'var(--lb-search-match-bg)' },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'var(--lb-search-match-active-bg)',
      },
      // 查找面板（Ctrl+F）跟应用主题走，不用 CM 默认浅灰
      '.cm-panels': {
        backgroundColor: 'var(--bg-card)',
        color: 'var(--text-primary)',
        fontFamily: FONT_STACKS[props.fontFamily],
      },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
      '.cm-panel.cm-search': { padding: '6px 8px' },
      '.cm-panel.cm-search label': { color: 'var(--text-secondary)' },
      '.cm-textfield': {
        backgroundColor: 'var(--bg-input)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-input)',
        borderRadius: 'var(--radius-input)',
        padding: '2px 6px',
      },
      '.cm-button': {
        backgroundImage: 'none',
        backgroundColor: 'var(--bg-input)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-input)',
        borderRadius: 'var(--radius-button)',
      },
      '.cm-panel button[name="close"]': { color: 'var(--text-secondary)' },
    }),
    EditorView.lineWrapping,
    EditorState.readOnly.of(props.readOnly),
  ]
}

function cursorOf(view: EditorView): CursorPosition {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  return { line: line.number, ch: head - line.from }
}

/** 选区包裹 Markdown 标记（有选区 = 包住，无选区 = 插入成对标记） */
function toggleWrap(marker: string): boolean {
  if (!editorView || props.readOnly) return false
  const { from, to } = editorView.state.selection.main
  const selected = editorView.state.sliceDoc(from, to)
  if (to > from) {
    editorView.dispatch({
      changes: { from, to, insert: `${marker}${selected}${marker}` },
      selection: { anchor: from + marker.length, head: to + marker.length },
    })
  } else {
    editorView.dispatch({
      changes: { from, insert: `${marker}${marker}` },
      selection: { anchor: from + marker.length },
    })
  }
  return true
}

/** 快捷键表：基础编辑（全选 / 复制 / 剪切 / 粘贴 / 撤销 / 重做 / 查找）由 basicSetup 提供 */
const formattingKeymap = keymap.of([
  { key: 'Mod-b', run: () => toggleWrap('**') },
  { key: 'Mod-i', run: () => toggleWrap('*') },
  { key: 'Mod-Shift-x', run: () => toggleWrap('~~') },
  { key: 'Mod-e', run: () => toggleWrap('`') },
])

/** 基础扩展：外观 / 只读在 compartment 里（字号、字体、只读可热改） */
function baseExtensions() {
  return [
    basicSetup,
    markdown(),
    appearance.of(appearanceExtension()),
    formattingKeymap,
  ]
}

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      ...baseExtensions(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
        if (update.docChanged || update.selectionSet) {
          emit('cursor-change', cursorOf(update.view))
        }
      }),
    ],
  })
}

let onScroll: (() => void) | null = null

onMounted(() => {
  if (!editorContainer.value) return
  editorView = new EditorView({
    state: createState(props.modelValue),
    parent: editorContainer.value,
  })

  onScroll = () => {
    if (editorView) emit('scroll-change', editorView.scrollDOM.scrollTop)
  }
  editorView.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
  editorView.contentDOM.addEventListener('blur', () => emit('blur'))
})

onBeforeUnmount(() => {
  if (editorView && onScroll) {
    editorView.scrollDOM.removeEventListener('scroll', onScroll)
  }
  editorView?.destroy()
  editorView = null
})

watch(
  () => [props.fontSize, props.fontFamily, props.readOnly] as const,
  () => {
    editorView?.dispatch({ effects: appearance.reconfigure(appearanceExtension()) })
  },
)

/** 换文档：整份换 state（撤销栈随文档走，不跨文档） */
function setDocument(value: string): void {
  if (!editorView) return
  editorView.setState(createState(value))
}

watch(
  () => props.modelValue,
  (value) => {
    if (!editorView || value === editorView.state.doc.toString()) return
    // 程序化写入（打开笔记 / 自动插入分隔符）不进撤销栈：
    // 否则 Ctrl+Z 会把「刚打开的正文」撤成空文档，自动保存再把这个空内容写回磁盘。
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    })
  },
)

// 换文档一律重建 state：即使两篇正文恰好相同，也不能把上一篇的撤销栈带过来
watch(
  () => props.documentId,
  () => setDocument(props.modelValue),
)

function focus(): void {
  editorView?.focus()
}

function getCursor(): CursorPosition | null {
  return editorView ? cursorOf(editorView) : null
}

function setCursor(position: CursorPosition): void {
  if (!editorView) return
  const line = Math.min(Math.max(position.line, 1), editorView.state.doc.lines)
  const lineInfo = editorView.state.doc.line(line)
  const ch = Math.min(Math.max(position.ch, 0), lineInfo.length)
  const anchor = lineInfo.from + ch
  editorView.dispatch({ selection: { anchor } })
  editorView.focus()
}

function getScrollTop(): number {
  return editorView?.scrollDOM.scrollTop ?? 0
}

function setScrollTop(value: number): void {
  if (editorView) editorView.scrollDOM.scrollTop = Math.max(0, value)
}

function insertAtCursor(text: string): void {
  if (!editorView || props.readOnly) return
  const { from, to } = editorView.state.selection.main
  editorView.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  })
  editorView.focus()
}

function getSelection(): string {
  if (!editorView) return ''
  const { from, to } = editorView.state.selection.main
  return editorView.state.sliceDoc(from, to)
}

defineExpose({
  focus,
  getCursor,
  setCursor,
  getScrollTop,
  setScrollTop,
  insertAtCursor,
  getSelection,
  setDocument,
})
</script>
