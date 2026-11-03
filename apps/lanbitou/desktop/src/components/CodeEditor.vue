<template>
  <div ref="editorContainer" class="lanbitou-editor h-full" data-testid="editor" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { CursorPosition, FontFamily } from '../types'

const props = withDefaults(
  defineProps<{
    modelValue: string
    fontSize?: number
    fontFamily?: FontFamily
    readOnly?: boolean
  }>(),
  { fontSize: 14, fontFamily: 'monospace', readOnly: false },
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
      },
      '.cm-content': {
        fontFamily: FONT_STACKS[props.fontFamily],
        caretColor: 'var(--text-primary)',
        // 与预览区 p-4（1rem）同宽，分屏时两侧留白一致
        padding: '1rem',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--text-tertiary)',
        border: 'none',
      },
      '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-secondary)' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { fontFamily: FONT_STACKS[props.fontFamily] },
    }),
    EditorView.lineWrapping,
  ]
}

function cursorOf(view: EditorView): CursorPosition {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  return { line: line.number, ch: head - line.from }
}

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

let onScroll: (() => void) | null = null

onMounted(() => {
  if (!editorContainer.value) return

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      basicSetup,
      markdown(),
      appearance.of(appearanceExtension()),
      EditorState.readOnly.of(props.readOnly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
        if (update.docChanged || update.selectionSet) {
          emit('cursor-change', cursorOf(update.view))
        }
      }),
      keymap.of([
        { key: 'Mod-b', run: () => toggleWrap('**') },
        { key: 'Mod-i', run: () => toggleWrap('*') },
      ]),
    ],
  })

  editorView = new EditorView({ state, parent: editorContainer.value })

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
  () => [props.fontSize, props.fontFamily] as const,
  () => {
    editorView?.dispatch({ effects: appearance.reconfigure(appearanceExtension()) })
  },
)

watch(
  () => props.modelValue,
  (value) => {
    if (editorView && value !== editorView.state.doc.toString()) {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: value },
      })
    }
  },
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
})
</script>
