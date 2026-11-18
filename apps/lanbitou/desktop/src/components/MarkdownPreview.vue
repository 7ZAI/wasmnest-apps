<template>
  <div
    class="markdown-preview prose-lanbitou text-[length:var(--font-size-base)] text-[var(--text-primary)]"
    :class="{ 'markdown-preview--large': isLarge }"
    data-testid="markdown-preview"
    v-html="renderedContent"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { PREVIEW_DEBOUNCE_MS } from '../types'

const props = defineProps<{
  content: string
}>()

/** 预览渲染防抖（spec §31：300ms，避免打字时反复重排） */
const debouncedContent = ref(props.content)
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.content,
  (value) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      debouncedContent.value = value
    }, PREVIEW_DEBOUNCE_MS)
  },
)

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

const renderedContent = computed(() => {
  // raw HTML 由 DOMPurify 清洗（spec §34：转义 / 剔除原始 HTML）
  const html = marked.parse(debouncedContent.value || '', { async: false }) as string
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
})

/** >5000 行的长笔记：交给浏览器 content-visibility 跳过屏外块渲染（spec §31） */
const isLarge = computed(() => debouncedContent.value.split('\n').length > 5000)
</script>

<style scoped>
/* 长笔记：屏外块跳过布局 / 绘制，滚动进入视口时再渲染（保持内容完整、无分页错位） */
.markdown-preview--large :deep(h1),
.markdown-preview--large :deep(h2),
.markdown-preview--large :deep(h3),
.markdown-preview--large :deep(p),
.markdown-preview--large :deep(li),
.markdown-preview--large :deep(pre),
.markdown-preview--large :deep(blockquote) {
  content-visibility: auto;
  contain-intrinsic-size: auto 2em;
}

.markdown-preview {
  line-height: 1.7;
  word-break: break-word;
}
/* 分屏时与编辑器首行对齐：首个块级元素不吃 top margin */
.markdown-preview > :deep(:first-child) {
  margin-top: 0;
}
.markdown-preview :deep(h1) {
  font-size: 1.5em;
  font-weight: 600;
  margin: 1em 0 0.5em;
}
.markdown-preview :deep(h2) {
  font-size: 1.3em;
  font-weight: 600;
  margin: 1em 0 0.5em;
}
.markdown-preview :deep(h3) {
  font-size: 1.1em;
  font-weight: 600;
  margin: 1em 0 0.5em;
}
.markdown-preview :deep(h4) {
  font-size: 1em;
  font-weight: 600;
  margin: 1em 0 0.5em;
}
.markdown-preview :deep(h5) {
  font-size: 0.95em;
  font-weight: 600;
  margin: 1em 0 0.5em;
}
.markdown-preview :deep(h6) {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 1em 0 0.5em;
}
.markdown-preview :deep(p) {
  margin-bottom: 0.75em;
}
.markdown-preview :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-tag);
}
.markdown-preview :deep(code) {
  background-color: var(--bg-hover);
  padding: 0.15em 0.35em;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.markdown-preview :deep(pre) {
  background-color: var(--bg-hover);
  padding: 1em;
  border-radius: var(--radius-tag);
  overflow-x: auto;
  margin-bottom: 0.75em;
}
.markdown-preview :deep(pre code) {
  background: none;
  padding: 0;
}
.markdown-preview :deep(ul) {
  margin: 0 0 0.75em 1.5em;
  list-style: disc;
}
.markdown-preview :deep(ol) {
  margin: 0 0 0.75em 1.5em;
  list-style: decimal;
}
.markdown-preview :deep(li) {
  margin-bottom: 0.25em;
}
/* GFM 任务列表：去掉圆点，复选框用 token 自绘 */
.markdown-preview :deep(li:has(> input[type='checkbox'])) {
  list-style: none;
  margin-left: -1.2em;
}
.markdown-preview :deep(input[type='checkbox']) {
  appearance: none;
  display: inline-grid;
  place-content: center;
  width: 1em;
  height: 1em;
  margin: 0 0.4em 0 0;
  vertical-align: -0.1em;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-input);
}
.markdown-preview :deep(input[type='checkbox']:checked) {
  border-color: var(--color-primary);
  background: var(--color-primary);
}
.markdown-preview :deep(input[type='checkbox']:checked)::after {
  content: '';
  width: 0.42em;
  height: 0.22em;
  border-left: 1.5px solid var(--color-primary-contrast);
  border-bottom: 1.5px solid var(--color-primary-contrast);
  transform: rotate(-45deg) translateY(-0.05em);
}
/* 表格：GFM 表格默认没有边框 / 内边距，必须补 token 样式 */
.markdown-preview :deep(table) {
  width: 100%;
  margin-bottom: 0.75em;
  border-collapse: collapse;
  font-size: 0.95em;
}
.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  padding: 0.4em 0.65em;
  border: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
.markdown-preview :deep(th) {
  background: var(--bg-hover);
  font-weight: 600;
}
.markdown-preview :deep(tbody tr:nth-child(even) td) {
  background: color-mix(in srgb, var(--bg-hover) 35%, transparent);
}
.markdown-preview :deep(blockquote) {
  border-left: 3px solid var(--border-strong);
  padding-left: 1em;
  color: var(--text-secondary);
  margin-bottom: 0.75em;
}
.markdown-preview :deep(a) {
  color: var(--color-info);
  text-decoration: underline;
}
.markdown-preview :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1em 0;
}
</style>
