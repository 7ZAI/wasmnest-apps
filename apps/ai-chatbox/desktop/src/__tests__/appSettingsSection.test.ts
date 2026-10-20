/**
 * AppSettingsSection 组件单测（接缝 4：设置分区行为契约）
 *
 * 覆盖：三组设置渲染、即改即存（每次变更 emit 整表 change）、
 * 步进器边界、条件行（推理强度仅 thinkingMode=enabled 可见）、滑块键盘步进。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import i18n from '../i18n'
import AppSettingsSection from '../components/AppSettingsSection.vue'
import { DEFAULT_PLUGIN_CONFIG, type PluginConfig } from '../types'

/** Select 桩：点击即 emit 'dark'，避免测试依赖 SDK 下拉的 Teleport / 定位逻辑 */
const SelectStub = defineComponent({
  name: 'Select',
  props: { modelValue: { type: [String, Number], required: true } },
  emits: ['update:modelValue'],
  template: '<button class="select-stub" @click="$emit(\'update:modelValue\', \'dark\')"></button>',
})

function mountPage(overrides: Partial<PluginConfig> = {}) {
  const wrapper = mount(AppSettingsSection, {
    props: { config: { ...DEFAULT_PLUGIN_CONFIG, ...overrides } },
    global: { plugins: [i18n], stubs: { Select: SelectStub } },
  })
  const lastChange = (): PluginConfig => {
    const events = wrapper.emitted('change') as unknown[][] | undefined
    return (events && events.length > 0 ? events[events.length - 1][0] : null) as PluginConfig
  }
  const buttonByText = (text: string) =>
    wrapper.findAll('button').find((b) => b.text().trim() === text)
  return { wrapper, lastChange, buttonByText }
}

describe('AppSettingsSection', () => {
  it('渲染三组设置（代码渲染 / 思考 / 限流重试）', () => {
    const { wrapper } = mountPage()
    const text = wrapper.text()
    expect(text).toContain('代码渲染')
    expect(text).toContain('思考')
    expect(text).toContain('限流重试')
    // 行距 / 主题 / 思考模式 / 限流条目齐备
    expect(text).toContain('行距')
    expect(text).toContain('代码主题')
    expect(text).toContain('自动重试次数')
    expect(text).toContain('初始等待')
    expect(text).toContain('最大等待')
  })

  it('字体大小步进：＋ 发 codeFontSize+1，且上限按钮禁用', () => {
    const { wrapper, lastChange } = mountPage({ codeFontSize: 13 })
    const plus = wrapper.findAll('button').find((b) => b.attributes('aria-label') === '增大')!
    void plus.trigger('click')
    expect(lastChange().codeFontSize).toBe(14)

    const { wrapper: atMax } = mountPage({ codeFontSize: 18 })
    const plusAtMax = atMax.findAll('button').find((b) => b.attributes('aria-label') === '增大')!
    expect(plusAtMax.attributes('disabled')).toBeDefined()
  })

  it('行距滑块键盘右移按 0.1 步进（1.6 → 1.7）', async () => {
    const { wrapper, lastChange } = mountPage({ codeLineHeight: 1.6 })
    const slider = wrapper.find('[role="slider"]')
    await slider.trigger('keydown', { key: 'ArrowRight' })
    expect(lastChange().codeLineHeight).toBe(1.7)
  })

  it('思考模式默认值下不显示推理强度；切到「开启」后显示并可选「最大」', async () => {
    const { wrapper, lastChange, buttonByText } = mountPage({ thinkingMode: 'default' })
    expect(wrapper.text()).not.toContain('推理强度')

    await buttonByText('开启')!.trigger('click')
    expect(lastChange().thinkingMode).toBe('enabled')

    const {
      wrapper: enabled,
      lastChange: lastChangeEnabled,
      buttonByText: buttonByTextEnabled,
    } = mountPage({ thinkingMode: 'enabled' })
    expect(enabled.text()).toContain('推理强度')
    await buttonByTextEnabled('最大')!.trigger('click')
    expect(lastChangeEnabled().reasoningEffort).toBe('max')
  })

  it('显示思考过程：切到「隐藏」发 showReasoning=false', async () => {
    const { lastChange, buttonByText } = mountPage({ showReasoning: true })
    await buttonByText('隐藏')!.trigger('click')
    expect(lastChange().showReasoning).toBe(false)
  })

  it('自动重试次数：0 时显示「关闭」文案，＋ 步进发新值', async () => {
    const { wrapper, lastChange } = mountPage({ rateLimitMaxRetries: 0 })
    const cell = wrapper.get('[data-testid="rate-limit-max-retries"]')
    expect(cell.text()).toBe('关闭')
    // 值单元格的父容器即该行控件组（− / 数值 / ＋），避开字体大小步进器的同名 aria-label
    const controls = cell.element.parentElement as HTMLElement
    const buttons = controls.querySelectorAll('button')
    ;(buttons[1] as HTMLButtonElement).click()
    await nextTick()
    expect(lastChange().rateLimitMaxRetries).toBe(1)
  })

  it('代码主题下拉变更发 codeTheme', async () => {
    const { wrapper, lastChange } = mountPage({ codeTheme: 'auto' })
    await wrapper.get('.select-stub').trigger('click')
    expect(lastChange().codeTheme).toBe('dark')
  })
})
