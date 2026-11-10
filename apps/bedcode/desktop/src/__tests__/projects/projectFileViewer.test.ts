/**
 * 文件查看器的高亮接线（票：文件树源码高亮）
 *
 * 高亮模块整体桩掉（wasm 编译成本不进单测），只断言查看器在三种结果下的
 * 外部行为：高亮就绪 → shiki HTML；超大 → 纯文本 + 显性提示；异常 → 纯文本。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ProjectFileViewer from '@/components/projects/ProjectFileViewer.vue'

const highlightFileContent = vi.fn()

vi.mock('@/utils/codeHighlight', () => ({
  highlightFileContent: (content: string, file: string) => highlightFileContent(content, file),
}))

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn() } }))

function makeContext(execute: any) {
  return {
    id: 'com.wasmnest.bedcode',
    i18n: { t: (key: string) => key, getI18n: () => ({}) },
    commands: { execute },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    events: { on: () => ({ dispose: () => {} }), emit: () => {} },
  }
}

function mountViewer(execute: any) {
  return mount(ProjectFileViewer, {
    props: { modelValue: true, projectId: 'p-1', path: 'src/main.ts', name: 'main.ts' },
    global: {
      provide: { pluginContext: makeContext(execute) },
      // 弹窗走 <Teleport to="body">：stub 掉让内容留在组件树内可断言
      stubs: { teleport: true },
    },
  })
}

const readFileOk = () =>
  vi.fn(async () => ({ content: 'const a = 1', fileName: 'main.ts' }))

beforeEach(() => {
  vi.clearAllMocks()
  highlightFileContent.mockResolvedValue({ status: 'unsupported' })
})

describe('ProjectFileViewer 语法高亮', () => {
  it('高亮就绪后用 shiki HTML 替换纯文本正文', async () => {
    highlightFileContent.mockResolvedValue({
      status: 'highlighted',
      html: '<pre class="shiki"><code><span class="line">HIGHLIGHTED</span></code></pre>',
    })

    const wrapper = mountViewer(readFileOk())
    await flushPromises()
    await flushPromises()

    const host = wrapper.get('[data-testid="project-file-viewer-highlighted"]')
    expect(host.html()).toContain('HIGHLIGHTED')
    expect(wrapper.find('[data-testid="project-file-viewer-highlight-skipped"]').exists()).toBe(
      false,
    )
  })

  it('文件超大时保留纯文本并显性提示高亮已关闭', async () => {
    highlightFileContent.mockResolvedValue({ status: 'too-large' })

    const wrapper = mountViewer(readFileOk())
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="project-file-viewer-highlighted"]').exists()).toBe(false)
    expect(
      wrapper.get('[data-testid="project-file-viewer-content"]').text(),
    ).toContain('const a = 1')
    expect(wrapper.find('[data-testid="project-file-viewer-highlight-skipped"]').exists()).toBe(
      true,
    )
  })

  it('高亮失败降级纯文本，不影响文件可读', async () => {
    highlightFileContent.mockRejectedValue(new Error('wasm unavailable'))

    const wrapper = mountViewer(readFileOk())
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="project-file-viewer-highlighted"]').exists()).toBe(false)
    expect(
      wrapper.get('[data-testid="project-file-viewer-content"]').text(),
    ).toContain('const a = 1')
  })

  it('把文件名交给高亮语言判定', async () => {
    const wrapper = mountViewer(readFileOk())
    await flushPromises()
    await flushPromises()

    expect(highlightFileContent).toHaveBeenCalledWith('const a = 1', 'main.ts')
    expect(wrapper.find('[data-testid="project-file-viewer-content"]').exists()).toBe(true)
  })
})
