import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import NewsReader from '../components/NewsReader.vue'
import readerSource from '../components/NewsReader.vue?raw'
import type { ReaderView } from '../types'

const context = {
  i18n: { t: (key: string) => key, getI18n: () => ({}) },
  commands: { execute: vi.fn() },
  events: { on: () => ({ dispose: () => {} }), emit: () => {} },
  storage: {
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
    flush: async () => {},
  },
} as unknown as PluginContext

function view(overrides: Partial<ReaderView> = {}): ReaderView {
  return {
    itemId: 'i1',
    state: 'ready',
    blocks: [
      { kind: 'heading', level: 1, text: 'Top heading' },
      { kind: 'heading', level: 2, text: 'Section heading' },
      { kind: 'heading', level: 3, text: 'Sub heading' },
      { kind: 'paragraph', text: 'Body text' },
      { kind: 'listItem', text: 'First item' },
      { kind: 'listItem', text: 'Second item' },
      { kind: 'quote', text: 'Quoted text' },
      { kind: 'code', text: 'let x = 1;' },
    ],
    textLength: 80,
    truncated: false,
    stale: false,
    archived: false,
    fetchedAt: 1,
    lastAttemptAt: 1,
    errorKind: null,
    errorDetail: null,
    ...overrides,
  }
}

function mountReader(overrides: Partial<ReaderView> = {}, loading = false) {
  return mount(NewsReader, {
    props: {
      view: view(overrides),
      loading,
      error: null,
      itemUrl: 'https://example.com/a',
    },
    global: { provide: { pluginContext: context } },
  })
}

describe('NewsReader', () => {
  it('按层级渲染标题、列表、引用与代码块', () => {
    const wrapper = mountReader()
    expect(wrapper.findAll('h3')).toHaveLength(1)
    expect(wrapper.findAll('h4')).toHaveLength(1)
    expect(wrapper.findAll('h5')).toHaveLength(1)
    expect(wrapper.findAll('.news-reader-list li')).toHaveLength(2)
    expect(wrapper.find('blockquote').text()).toContain('Quoted text')
    expect(wrapper.find('pre code').text()).toContain('let x = 1;')
  })

  it('加载与失败状态使用不同的可见提示', () => {
    const loading = mountReader({}, true)
    expect(loading.get('[data-testid="news-reader-loading"]').text()).toContain(
      'news.reader.loading',
    )

    const failed = mount(NewsReader, {
      props: {
        view: view({
          state: 'failed',
          blocks: [],
          errorKind: 'extract.no_content',
          errorDetail: 'no article',
        }),
        loading: false,
        error: null,
        itemUrl: 'https://example.com/a',
      },
      global: { provide: { pluginContext: context } },
    })
    expect(failed.get('[data-testid="news-reader-error"]').attributes('role')).toBe('alert')
    expect(failed.text()).toContain('news.error.extract.no_content')
    expect(failed.text()).toContain('no article')
  })

  it('stale 与 truncation 提示可见，重试与复制按钮发出事件', async () => {
    const wrapper = mountReader({ stale: true, truncated: true, errorKind: 'net.failed' })
    expect(wrapper.get('[data-testid="news-reader-stale"]').text()).toContain(
      'news.reader.stale',
    )
    expect(wrapper.get('[data-testid="news-reader-truncated"]').text()).toContain(
      'news.reader.truncated',
    )

    const failed = mount(NewsReader, {
      props: {
        view: view({ state: 'failed', blocks: [], errorKind: 'net.failed' }),
        loading: false,
        error: null,
        itemUrl: 'https://example.com/a',
      },
      global: { provide: { pluginContext: context } },
    })
    await failed.get('[data-testid="news-reader-retry"]').trigger('click')
    await failed.get('[data-testid="news-reader-copy"]').trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
    expect(failed.emitted('copy')?.[0]).toEqual(['https://example.com/a'])
  })

  it('授权与禁用类失败显示去设置，其它失败不显示', async () => {
    const denied = mount(NewsReader, {
      props: {
        view: null,
        loading: false,
        error: { code: 'net.denied', detail: 'denied' },
        itemUrl: 'https://example.com/a',
      },
      global: { provide: { pluginContext: context } },
    })
    expect(denied.find('[data-testid="news-reader-open-settings"]').exists()).toBe(true)
    await denied.get('[data-testid="news-reader-open-settings"]').trigger('click')
    expect(denied.emitted('open-settings')).toHaveLength(1)

    const contentFailure = mount(NewsReader, {
      props: {
        view: view({ state: 'failed', blocks: [], errorKind: 'extract.no_content' }),
        loading: false,
        error: null,
        itemUrl: 'https://example.com/a',
      },
      global: { provide: { pluginContext: context } },
    })
    expect(contentFailure.find('[data-testid="news-reader-open-settings"]').exists()).toBe(false)
  })

  it('模板不含 v-html，正文只走文本插值', () => {
    expect(readerSource).not.toContain('v-html')
  })
})