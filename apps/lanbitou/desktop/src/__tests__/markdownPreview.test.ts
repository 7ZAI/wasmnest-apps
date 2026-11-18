// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MarkdownPreview from '../components/MarkdownPreview.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('MarkdownPreview', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('渲染 Markdown（标题 / 列表 / 代码块）', async () => {
    vi.useFakeTimers()
    const wrapper = mount(MarkdownPreview, {
      props: { content: '# 标题\n\n- 一\n- 二\n\n```js\nconst a = 1\n```' },
    })
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.vm.$nextTick()

    const html = wrapper.get('[data-testid="markdown-preview"]').html()
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<li>一</li>')
    expect(html).toContain('<code class="language-js">')
  })

  it('剔除脚本与事件处理器（XSS 防护）', async () => {
    vi.useFakeTimers()
    const wrapper = mount(MarkdownPreview, {
      props: {
        content:
          '<script>window.__pwned = 1</script>\n\n<img src="x" onerror="alert(1)">\n\n[链接](javascript:alert(1))',
      },
    })
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.vm.$nextTick()

    const html = wrapper.get('[data-testid="markdown-preview"]').html()
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
  })

  it('渲染防抖：300ms 内的连续更新只渲染最后一次', async () => {
    vi.useFakeTimers()
    const wrapper = mount(MarkdownPreview, { props: { content: '' } })

    await wrapper.setProps({ content: '# 一' })
    await wrapper.setProps({ content: '# 二' })
    await wrapper.setProps({ content: '# 三' })
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.vm.$nextTick()

    const html = wrapper.get('[data-testid="markdown-preview"]').html()
    expect(html).toContain('<h1>三</h1>')
    expect(html).not.toContain('<h1>一</h1>')
  })
})
