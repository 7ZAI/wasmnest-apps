<script lang="ts">
/**
 * Markdown 正文渲染
 *
 * 用渲染函数直接产出元素节点，不拼接 HTML、不使用 `v-html`。样式由本组件的
 * scoped 块负责，正文长度不影响解析复杂度（单次线性扫描）。
 */
import { computed, defineComponent, h, type VNode } from 'vue'
import { parseMarkdown } from '../markdown/parse'
import type { MdBlock, MdInline } from '../markdown/ast'

function renderInline(nodes: MdInline[]): Array<VNode | string> {
  return nodes.map((node) => {
    if (node.type === 'text') return node.text
    if (node.type === 'strong') return h('strong', { class: 'nest-md__strong' }, renderInline(node.children))
    return h('code', { class: 'nest-md__inline-code' }, node.text)
  })
}

function renderBlocks(blocks: MdBlock[]): VNode[] {
  return blocks.map((block) => {
    switch (block.type) {
      case 'heading':
        return h(`h${block.level}`, { class: 'nest-md__heading' }, renderInline(block.children))
      case 'paragraph':
        return h('p', { class: 'nest-md__paragraph' }, renderInline(block.children))
      case 'list':
        return h(
          block.ordered ? 'ol' : 'ul',
          { class: 'nest-md__list' },
          block.items.map((item) => h('li', { class: 'nest-md__item' }, renderInline(item))),
        )
      case 'codeBlock':
        return h('pre', { class: 'nest-md__code-block' }, [
          h('code', { class: block.lang ? `language-${block.lang}` : undefined }, block.text),
        ])
      default:
        return h('p', { class: 'nest-md__paragraph' })
    }
  })
}

export default defineComponent({
  name: 'MarkdownBlock',
  props: {
    source: { type: String, required: true },
    compact: { type: Boolean, default: false },
  },
  setup(props) {
    const blocks = computed(() => parseMarkdown(props.source))
    return () =>
      h(
        'div',
        { class: ['nest-md', props.compact ? 'nest-md--compact' : ''] },
        renderBlocks(blocks.value),
      )
  },
})
</script>

<style scoped>
.nest-md {
  color: var(--nest-text);
  font-size: var(--nest-font-lg);
  line-height: 1.72;
  overflow-wrap: anywhere;
}

.nest-md__paragraph {
  margin: 0 0 12px;
  white-space: pre-wrap;
}

.nest-md__paragraph:last-child {
  margin-bottom: 0;
}

.nest-md__heading {
  margin: 18px 0 8px;
  font-weight: 600;
  line-height: 1.4;
}

.nest-md__heading:first-child {
  margin-top: 0;
}

h1.nest-md__heading {
  font-size: var(--nest-font-xl);
}

h2.nest-md__heading {
  font-size: var(--nest-font-lg);
}

h3.nest-md__heading,
h4.nest-md__heading,
h5.nest-md__heading,
h6.nest-md__heading {
  font-size: var(--nest-font-md);
}

.nest-md__list {
  margin: 0 0 12px;
  padding-left: 1.4em;
}

.nest-md__item {
  margin: 4px 0;
}

.nest-md__strong {
  font-weight: 650;
}

.nest-md__inline-code {
  padding: 1px 5px;
  border-radius: var(--nest-radius-ctl);
  background: var(--nest-surface-2);
  font-family: var(--nest-font-mono);
  font-size: 0.92em;
}

.nest-md__code-block {
  margin: 0 0 12px;
  padding: 12px 14px;
  border: 1px solid var(--nest-border);
  border-radius: var(--nest-radius-card);
  background: var(--nest-surface-2);
  font-family: var(--nest-font-mono);
  font-size: var(--nest-font-sm);
  line-height: 1.6;
  overflow-x: auto;
}

.nest-md__code-block code {
  font-family: inherit;
  white-space: pre;
}

.nest-md--compact {
  font-size: var(--nest-font-lg);
}

.nest-md--compact .nest-md__paragraph {
  margin-bottom: 8px;
}
</style>