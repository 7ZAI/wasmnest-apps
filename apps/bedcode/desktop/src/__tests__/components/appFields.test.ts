/**
 * 表单控件契约（ui/AppTextField、ui/AppSelectField）
 *
 * 只断言外部行为：输入/选择后对外抛出什么、错误态如何暴露给辅助技术、
 * 下拉展开后有哪些可选项、禁用项能不能被选中。不测 class 名与 DOM 结构。
 *
 * 这两个组件是被「原生 UI 禁令」替换后的落点：文本框保留原生 `<input>`（允许项，
 * 但必须 token 化），下拉用 reka-ui 原语（`<select>` 的选项面板会走系统绘制，禁止）。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AppTextField from '@/components/ui/AppTextField.vue'
import AppSelectField from '@/components/ui/AppSelectField.vue'

/**
 * happy-dom 缺 Pointer Capture 与 scrollIntoView（reka-ui 的触发器/选项会调），
 * 补成 no-op 才能测指针路径；键盘路径不依赖它们。
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
})

// 下拉内容走 portal 到 body：用例之间必须清干净，否则上一条的选项会让下一条数错
// （实测同一文件里连续挂 Select 会读出 6 个 option 而不是 3 个）
afterEach(() => {
  document.body.innerHTML = ''
})

describe('AppTextField（token 化文本框）', () => {
  it('输入即向上抛 update:modelValue，标签与输入框经 for/id 配对', async () => {
    const wrapper = mount(AppTextField, {
      props: { modelValue: '', label: '项目名称', testid: 'field-name' },
    })

    const input = wrapper.get('input')
    await input.setValue('支付重构')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['支付重构'])

    const label = wrapper.get('label')
    expect(label.text()).toContain('项目名称')
    expect(label.attributes('for')).toBe(input.attributes('id'))
  })

  it('必填项在标签上给出可见标记', () => {
    const wrapper = mount(AppTextField, {
      props: { modelValue: '', label: '目录', required: true },
    })
    expect(wrapper.get('label').text()).toContain('*')
  })

  it('错误态：aria-invalid + role=alert，且提示与输入框经 aria-describedby 关联', () => {
    const wrapper = mount(AppTextField, {
      props: { modelValue: '', label: '目录', error: '请选择目录' },
    })

    const input = wrapper.get('input')
    expect(input.attributes('aria-invalid')).toBe('true')

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe('请选择目录')
    expect(input.attributes('aria-describedby')).toBe(alert.attributes('id'))
  })

  it('错误优先于帮助文案：两者同时传入时不重复渲染', () => {
    const wrapper = mount(AppTextField, {
      props: { modelValue: '', error: '内容不合法', help: '留空取目录末段' },
    })

    expect(wrapper.text()).toContain('内容不合法')
    expect(wrapper.text()).not.toContain('留空取目录末段')
  })

  it('禁用态透传到原生 input（不是只靠样式）', () => {
    const wrapper = mount(AppTextField, { props: { modelValue: 'x', disabled: true } })
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
  })
})

describe('AppSelectField（reka-ui 原语 + token 皮肤）', () => {
  const options = [
    { value: 'linux', label: 'Linux' },
    { value: 'windows', label: 'Windows' },
    { value: 'wsl2', label: 'WSL2', disabled: true },
  ]

  it('未选时显示 placeholder，且不把空字符串当成可选项', () => {
    const wrapper = mount(AppSelectField, {
      props: { modelValue: '', options, label: '执行环境', placeholder: '请选择' },
    })

    expect(wrapper.get('[role="combobox"]').text()).toContain('请选择')
  })

  it('已选值渲染为可读标签（不是原始 value）', () => {
    const wrapper = mount(AppSelectField, {
      props: { modelValue: 'linux', options, label: '执行环境' },
    })

    expect(wrapper.get('[role="combobox"]').text()).toContain('Linux')
    expect(wrapper.get('[role="combobox"]').text()).not.toContain('windows')
  })

  it('展开后列出全部选项（含禁用项）；选中可用项向上抛 update:modelValue', async () => {
    const wrapper = mount(AppSelectField, {
      props: { modelValue: 'linux', options, label: '执行环境' },
      attachTo: document.body,
    })

    const trigger = wrapper.get('[role="combobox"]')
    await trigger.trigger('pointerdown')
    await trigger.trigger('keydown', { key: 'ArrowDown' })

    const items = Array.from(document.querySelectorAll('[role="option"]'))
    expect(items.map((el) => el.textContent?.trim())).toEqual(['Linux', 'Windows', 'WSL2'])
    expect(items[2]?.hasAttribute('data-disabled')).toBe(true)

    // 选中走键盘：与真实用户「方向键 + Enter」同一条通路（reka-ui 的 Enter 属于选中键）。
    // 选项的选中处理器内部 await nextTick，断言前必须 flush。
    const windows = items[1] as HTMLElement
    windows.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['windows'])
    wrapper.unmount()
  })

  it('可选「未选」：占位项能来回切换，对外仍是空字符串', async () => {
    const wrapper = mount(AppSelectField, {
      props: { modelValue: 'linux', options, label: 'WSL 发行版', placeholder: '请选择' },
      attachTo: document.body,
    })

    const trigger = wrapper.get('[role="combobox"]')
    await trigger.trigger('pointerdown')
    await trigger.trigger('keydown', { key: 'ArrowDown' })

    // 占位项排在首位
    const first = document.querySelector('[role="option"]') as HTMLElement
    expect(first.textContent).toContain('请选择')
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    // 哨兵值不泄到对外接口
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
    wrapper.unmount()
  })

  it('禁用整体控件时触发器带 disabled（不接受键盘/指针）', () => {
    const wrapper = mount(AppSelectField, {
      props: { modelValue: 'linux', options, disabled: true },
    })

    expect(wrapper.get('[role="combobox"]').attributes('disabled')).toBeDefined()
  })
})
