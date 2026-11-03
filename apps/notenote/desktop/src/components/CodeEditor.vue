<template>
  <div ref="editorContainer" class="h-full w-full"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const props = defineProps<{
  modelValue: string
  fontSize?: number
  fontFamily?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'blur': []
}>()

const editorContainer = ref<HTMLElement>()
let view: EditorView | null = null

const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-page, #1a1a2e)',
    color: 'var(--text-primary, #e2e8f0)',
  },
  '.cm-content': {
    caretColor: 'var(--color-primary, #3b82f6)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-sidebar, #16162a)',
    color: 'var(--text-tertiary, #64748b)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--bg-hover, #2a2a4a)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover, #2a2a4a)',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--color-primary, #3b82f6)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-primary-light, rgba(59, 130, 246, 0.2))',
  },
}, { dark: true })

const lightTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-page, #ffffff)',
    color: 'var(--text-primary, #1f2937)',
  },
  '.cm-content': {
    caretColor: 'var(--color-primary, #3b82f6)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-sidebar, #f8f9fa)',
    color: 'var(--text-tertiary, #9ca3af)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--bg-hover, #f0f0f0)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover, #f0f0f0)',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--color-primary, #3b82f6)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-primary-light, rgba(59, 130, 246, 0.15))',
  },
}, { dark: false })

const mdHighlighting = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: 'bold', fontSize: '1.6em' },
  { tag: tags.heading2, fontWeight: 'bold', fontSize: '1.4em' },
  { tag: tags.heading3, fontWeight: 'bold', fontSize: '1.2em' },
  { tag: tags.heading4, fontWeight: 'bold', fontSize: '1.1em' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.link, textDecoration: 'underline', color: 'var(--color-primary, #3b82f6)' },
  { tag: tags.url, color: 'var(--color-primary, #3b82f6)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono, monospace)', backgroundColor: 'var(--bg-hover, rgba(0,0,0,0.05))', padding: '0 2px', borderRadius: '3px' },
  { tag: tags.quote, fontStyle: 'italic', color: 'var(--text-secondary, #6b7280)' },
  { tag: tags.list, color: 'var(--color-primary, #3b82f6)' },
  { tag: tags.processingInstruction, color: 'var(--text-tertiary, #9ca3af)' },
])

onMounted(() => {
  if (!editorContainer.value) return

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      emit('update:modelValue', update.state.doc.toString())
    }
  })

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxHighlighting(mdHighlighting),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      markdown({ base: markdownLanguage }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      lightTheme,
      darkTheme,
      updateListener,
      EditorView.lineWrapping,
    ],
  })

  view = new EditorView({
    state,
    parent: editorContainer.value,
  })

  editorContainer.value.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!editorContainer.value?.contains(document.activeElement)) {
        emit('blur')
      }
    }, 0)
  })
})

watch(() => props.modelValue, (newVal) => {
  if (view && view.state.doc.toString() !== newVal) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: newVal },
    })
  }
})

watch(() => props.fontSize, (size) => {
  if (editorContainer.value && size) {
    editorContainer.value.style.setProperty('--editor-font-size', `${size}px`)
  }
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

function getSelection(): string {
  if (!view) return ''
  const { from, to } = view.state.selection.main
  if (from === to) return ''
  return view.state.doc.sliceString(from, to)
}

function insertTextAtCursor(text: string) {
  if (!view) return
  const pos = view.state.selection.main.head
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
  })
  view.focus()
}

defineExpose({ getSelection, insertTextAtCursor })
</script>
