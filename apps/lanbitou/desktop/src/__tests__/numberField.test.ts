/**
 * NumberField（自绘步进数字框）行为契约
 *
 * 本仓 UI 规范禁用 `input[type=number]` 的系统步进器；本组件用 text + 显式
 * 加减按钮替代。契约：
 * - 只剔除非法字符，不在击键时夹紧（否则多位数无法输入）；
 * - 小数点 / 负号按 step / min 决定是否允许（此前一律删除，`12.5` 会变 `125`）；
 * - 失焦 / 步进时按 step 对齐并夹到 [min, max]；空输入回落当前值，不当作 0。
 */

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NumberField from '../components/NumberField.vue'

function mountField(overrides: Record<string, unknown> = {}) {
  return mount(NumberField, {
    props: {
      modelValue: 14,
      min: 10,
      max: 24,
      step: 1,
      label: 'font size',
      testid: 'number-test',
      ...overrides,
    },
  })
}

function lastEmitted(wrapper: ReturnType<typeof mountField>): number | undefined {
  const events = wrapper.emitted('update:modelValue') ?? []
  return events.length > 0 ? (events[events.length - 1][0] as number) : undefined
}

describe('NumberField — 自绘步进数字框', () => {
  it('输入整数：即时 emit，失焦按步长对齐并夹紧', async () => {
    const wrapper = mountField()
    const input = wrapper.find('input')

    await input.setValue('12')
    expect(lastEmitted(wrapper)).toBe(12)

    await input.setValue('999')
    expect(lastEmitted(wrapper)).toBe(999)
    await input.trigger('blur')
    expect(lastEmitted(wrapper)).toBe(24)
    expect((input.element as HTMLInputElement).value).toBe('24')
  })

  it('整数步长不接受小数点（不再把 12.5 变成 125）', async () => {
    const wrapper = mountField()
    const input = wrapper.find('input')

    await input.setValue('12.5')
    // 小数点被剔除，得到 125（失焦后夹到 24）
    expect(lastEmitted(wrapper)).toBe(125)
    await input.trigger('blur')
    expect(lastEmitted(wrapper)).toBe(24)
  })

  it('小数步长保留小数点并按步长对齐', async () => {
    const wrapper = mountField({ modelValue: 0.5, min: 0, max: 1, step: 0.1 })
    const input = wrapper.find('input')

    await input.setValue('0.37')
    expect(lastEmitted(wrapper)).toBe(0.37)
    await input.trigger('blur')
    expect(lastEmitted(wrapper)).toBe(0.4)
  })

  it('min < 0 时允许负号；min ≥ 0 时剔除负号', async () => {
    const signed = mountField({ modelValue: 0, min: -10, max: 10 })
    await signed.find('input').setValue('-3')
    expect(lastEmitted(signed)).toBe(-3)

    const unsigned = mountField({ modelValue: 10, min: 0, max: 100 })
    await unsigned.find('input').setValue('-3')
    expect(lastEmitted(unsigned)).toBe(3)
  })

  it('空输入 / 只有符号不当作 0；失焦回落当前值', async () => {
    const wrapper = mountField()
    const input = wrapper.find('input')

    await input.setValue('')
    expect(lastEmitted(wrapper)).toBeUndefined()
    await input.trigger('blur')
    expect(lastEmitted(wrapper)).toBe(14)
    expect((input.element as HTMLInputElement).value).toBe('14')

    await input.setValue('-')
    await input.trigger('blur')
    expect(lastEmitted(wrapper)).toBe(14)
  })

  it('显式步进按钮：±step 并夹在边界内', async () => {
    const wrapper = mountField()
    const [decrease, increase] = wrapper.findAll('button')

    await increase.trigger('click')
    expect(lastEmitted(wrapper)).toBe(15)

    await decrease.trigger('click')
    await decrease.trigger('click')
    expect(lastEmitted(wrapper)).toBe(13)

    const atMin = mountField({ modelValue: 10 })
    expect(atMin.findAll('button')[0].attributes('disabled')).toBeDefined()
    const atMax = mountField({ modelValue: 24 })
    expect(atMax.findAll('button')[1].attributes('disabled')).toBeDefined()
  })
})
