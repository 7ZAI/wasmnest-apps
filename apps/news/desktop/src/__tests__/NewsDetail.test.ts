import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import NewsDetail from '../components/NewsDetail.vue'
import type { NewsItem, ReaderView } from '../types'

const ITEM: NewsItem = {
  id: 'i1',
  title: 'Item title',
  url: 'https://example.com/a',
  summary: 'Summary text',
  publishedAt: 1,
  firstSeenAt: 1,
  sourceId: 's1',
  sourceName: 'Source',
  circleName: '未分组',
  read: false,
  favorite: false,
  originCount: 1,
  score: 1,
}

const READY: ReaderView = {
  itemId: 'i1',
  state: 'ready',
  blocks: [{ kind: 'paragraph', text: 'Reader body' }],
  textLength: 11,
  truncated: false,
  stale: false,
  archived: false,
  fetchedAt: 1,
  lastAttemptAt: 1,
  errorKind: null,
  errorDetail: null,
}

function context(execute: (command: string, args?: Record<string, unknown>) => unknown): PluginContext {
  return {
    i18n: { t: (key: string) => key, getI18n: () => ({}) },
    commands: { execute: vi.fn(execute) },
    events: { on: () => ({ dispose: () => {} }), emit: () => {} },
    storage: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      flush: async () => {},
    },
  } as unknown as PluginContext
}

function mountDetail(
  readerEnabled: boolean,
  execute: (command: string, args?: Record<string, unknown>) => unknown = () => READY,
): ReturnType<typeof mount> {
  return mount(NewsDetail, {
    props: { item: ITEM, origins: [], now: 10, readerEnabled },
    global: { provide: { pluginContext: context(execute) } },
  })
}

describe('NewsDetail reader entry', () => {
  it('开关关闭时不渲染阅读入口', () => {
    const wrapper = mountDetail(false)
    expect(wrapper.find('[data-testid="news-reader-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="news-copy"]').exists()).toBe(true)
  })

  it('开关开启时点阅读全文切到阅读态并加载正文', async () => {
    const execute = vi.fn(
      async (_command: string, _args?: Record<string, unknown>) => READY,
    )
    const wrapper = mountDetail(true, execute)
    const button = wrapper.get('[data-testid="news-reader-open"]')

    await button.trigger('click')
    await flushPromises()

    expect(execute.mock.calls.some(([command]) => command === 'news.read-item')).toBe(true)
    expect(wrapper.find('[data-testid="news-reader"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Reader body')
  })

  it('返回摘要后恢复摘要视图并清除阅读态', async () => {
    const wrapper = mountDetail(true)
    await wrapper.get('[data-testid="news-reader-open"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="news-reader-back"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="news-reader"]').exists()).toBe(false)
    expect(wrapper.get('[data-news-detail-summary]').text()).toContain('Summary text')
  })
})