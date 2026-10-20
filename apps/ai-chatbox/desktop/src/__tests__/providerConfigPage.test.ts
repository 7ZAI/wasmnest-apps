/**
 * ProviderConfigPage 集成单测（接缝 4：设置页 ⇄ 供应商添加/编辑契约）
 *
 * 覆盖：默认落在设置页（供应商折叠摘要 + 应用设置直接展示）、
 * 折叠摘要展开/收起、「添加供应商」直达模板选择、摘要行进入编辑、
 * 逐级返回、设置变更整表上抛（changePluginConfig）、initialView=templates。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import i18n from '../i18n'
import ProviderConfigPage from '../components/ProviderConfigPage.vue'
import { DEFAULT_PLUGIN_CONFIG, type PluginConfig } from '../types'
import { createMockContext, makeProvider } from './mockContext'

/** Select 桩：避免测试依赖 SDK 下拉的 Teleport / 定位逻辑 */
const SelectStub = defineComponent({
  name: 'Select',
  props: { modelValue: { type: [String, Number], required: true } },
  emits: ['update:modelValue'],
  template: '<button class="select-stub"></button>',
})

function mountPage(
  options: {
    pluginConfig?: Partial<PluginConfig>
    providers?: any[]
    initialView?: 'settings' | 'templates'
  } = {},
) {
  return mount(ProviderConfigPage, {
    props: {
      providers: options.providers ?? [],
      activeProviderId: options.providers?.[0]?.id,
      fetchModels: async () => [],
      testConnection: async () => '',
      pluginConfig: { ...DEFAULT_PLUGIN_CONFIG, ...options.pluginConfig },
      initialView: options.initialView,
    },
    global: {
      plugins: [i18n],
      stubs: { Select: SelectStub },
      // ProviderForm 经 inject('pluginContext') 取通道；测试给最小替身避免 Vue 警告
      provide: { pluginContext: createMockContext().context },
    },
  })
}

describe('ProviderConfigPage（设置页 + 供应商添加/编辑）', () => {
  it('默认视图为设置页：标题「设置」，设置项目直接展示（无需跳转）', () => {
    const wrapper = mountPage()
    expect(wrapper.find('h3').text()).toBe('设置')
    const text = wrapper.text()
    expect(text).toContain('已配置的供应商')
    expect(text).toContain('代码渲染')
    expect(text).toContain('思考模式')
    expect(text).toContain('限流重试')
    // 设置页摘要底部即「添加供应商」入口
    expect(wrapper.get('[data-testid="provider-summary-add"]').text()).toContain('添加供应商')
    // 模板选择页不在当前视图
    expect(text).not.toContain('选择模板')
  })

  it('已配置供应商折叠区：默认展开显示行，点击折叠头隐藏', async () => {
    const wrapper = mountPage({ providers: [makeProvider({ id: 'p1', name: 'DeepSeek' })] })
    const list = wrapper.get('[data-testid="provider-summary-list"]')
    expect((list.element as HTMLElement).style.display).not.toBe('none')
    expect(list.text()).toContain('DeepSeek')

    await wrapper.get('[data-testid="provider-summary-toggle"]').trigger('click')
    // v-show 直接落到内联样式（happy-dom 的 computed style 不可靠，按内联断言）
    expect((list.element as HTMLElement).style.display).toBe('none')
  })

  it('「添加供应商」直达模板选择；模板 → 表单 → 逐级返回设置页', async () => {
    const wrapper = mountPage()
    await wrapper.get('[data-testid="provider-summary-add"]').trigger('click')
    expect(wrapper.find('h3').text()).toBe('选择模板')

    // 选预设 → 添加表单
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('DeepSeek'))!
      .trigger('click')
    expect(wrapper.find('h3').text()).toBe('添加供应商')

    const back = () => wrapper.findAll('button').find((b) => b.text().includes('返回'))!
    await back().trigger('click')
    expect(wrapper.find('h3').text()).toBe('选择模板')
    await back().trigger('click')
    expect(wrapper.find('h3').text()).toBe('设置')

    const backToChat = wrapper.findAll('button').find((b) => b.text().includes('返回聊天'))!
    await backToChat.trigger('click')
    expect(wrapper.emitted('back')).toHaveLength(1)
  })

  it('点击摘要中的供应商行进入编辑表单；返回回到设置页', async () => {
    const wrapper = mountPage({
      providers: [makeProvider({ id: 'p1', name: 'DeepSeek', activeModel: 'deepseek-chat' })],
    })
    await wrapper.get('[data-testid="provider-summary-row"]').trigger('click')
    expect(wrapper.find('h3').text()).toBe('编辑供应商')

    const back = wrapper.findAll('button').find((b) => b.text().includes('返回'))!
    await back.trigger('click')
    expect(wrapper.find('h3').text()).toBe('设置')
  })

  it('initialView=templates：空态「配置模型」可直达模板选择', () => {
    const wrapper = mountPage({ initialView: 'templates' })
    expect(wrapper.find('h3').text()).toBe('选择模板')
  })

  it('设置变更：整表上抛 changePluginConfig（步进一次即 codeFontSize+1）', async () => {
    const wrapper = mountPage({ pluginConfig: { codeFontSize: 13 } })
    const plus = wrapper.findAll('button').find((b) => b.attributes('aria-label') === '增大')!
    await plus.trigger('click')

    const events = wrapper.emitted('changePluginConfig') as unknown[][]
    expect(events).toHaveLength(1)
    const next = events[0][0] as PluginConfig
    expect(next.codeFontSize).toBe(14)
    expect(next.thinkingMode).toBe(DEFAULT_PLUGIN_CONFIG.thinkingMode)
  })
})
