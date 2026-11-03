<template>
  <div class="markdown-preview" v-html="renderedContent"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'

const props = defineProps<{
  content: string
}>()

marked.setOptions({
  breaks: true,
  gfm: true,
})

const renderedContent = computed(() => {
  if (!props.content) return '<p class="text-[var(--text-tertiary)] italic">Empty note</p>'
  try {
    return marked(props.content) as string
  } catch {
    return '<p class="text-red-500">Render error</p>'
  }
})
</script>

<style scoped>
.markdown-preview {
  line-height: 1.7;
  word-wrap: break-word;
}

.markdown-preview :deep(h1) {
  font-size: 1.8em;
  font-weight: 700;
  margin: 0.8em 0 0.4em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}

.markdown-preview :deep(h2) {
  font-size: 1.5em;
  font-weight: 600;
  margin: 0.7em 0 0.3em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid var(--border);
}

.markdown-preview :deep(h3) {
  font-size: 1.25em;
  font-weight: 600;
  margin: 0.6em 0 0.3em;
}

.markdown-preview :deep(h4) {
  font-size: 1.1em;
  font-weight: 600;
  margin: 0.5em 0 0.2em;
}

.markdown-preview :deep(p) {
  margin: 0.5em 0;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.markdown-preview :deep(li) {
  margin: 0.2em 0;
}

.markdown-preview :deep(code) {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.9em;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  background: var(--bg-hover);
}

.markdown-preview :deep(pre) {
  padding: 1em;
  border-radius: 6px;
  background: var(--bg-hover);
  overflow-x: auto;
  margin: 0.8em 0;
}

.markdown-preview :deep(pre code) {
  padding: 0;
  background: none;
}

.markdown-preview :deep(blockquote) {
  margin: 0.8em 0;
  padding: 0.5em 1em;
  border-left: 4px solid var(--color-primary);
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.markdown-preview :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
}

.markdown-preview :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5em 0;
}

.markdown-preview :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  border: 1px solid var(--border);
  padding: 0.4em 0.8em;
  text-align: left;
}

.markdown-preview :deep(th) {
  background: var(--bg-hover);
  font-weight: 600;
}

.markdown-preview :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}
</style>
