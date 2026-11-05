/**
 * RangeField（自绘滑块）行为契约
 *
 * 本仓 UI 规范禁用原生 `input[type=range]`：轨道 / 滑块由浏览器绘制，宿主主题与
 * `--ui-scale` 下不可控。本组件用 `role="slider"` + 指针 / 键盘自绘，契约与原生
 * range 对齐：方向键 ±step、PageUp/PageDown ±10×step、Home/End 到端点。
 */

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RangeField from '../components/RangeField.vue'

function mountField(overrides: Record<string, unknown> = {}) {
  return mount(RangeField, {
    props: {
      modelValue: 14,
      min: 10,
      max: 24,
      step: 1,
      label: 'font size',
      testid: 'range-test',
      ...overrides,
    },
  })
}

function emitted(wrapper: ReturnType<typeof mountField>): number[] {
  return wrapper.emitted('update:modelValue')?.map(([value]) => value as number) ?? []
}

describe('RangeField — 自绘滑块', () => {
  it('渲染为 role=slider，且不含原生 range 控件', () => {
    const wrapper = mountField()
    expect(wrapper.attributes('role')).toBe('slider')
    expect(wrapper.attributes('aria-valuenow')).toBe('14')
    expect(wrapper.attributes('aria-valuemin')).toBe('10')
    expect(wrapper.attributes('aria-valuemax')).toBe('24')
    expect(wrapper.find('input[type="range"]').exists()).toBe(false)
  })

  it('键盘：方向键 / Home / End / PageUp / PageDown 与原生 range 同语义', async () => {
    const wrapper = mountField()

    await wrapper.trigger('keydown', { key: 'ArrowRight' })
    await wrapper.trigger('keydown', { key: 'ArrowLeft' })
    await wrapper.trigger('keydown', { key: 'Home' })
    await wrapper.trigger('keydown', { key: 'End' })
    await wrapper.trigger('keydown', { key: 'PageDown' })
    await wrapper.trigger('keydown', { key: 'PageUp' })

    // 15 / 13 / 10 / 24 / 10（14-10 夹到 min）/ 24（14+10 夹到 max）
    expect(emitted(wrapper)).toEqual([15, 13, 10, 24, 10, 24])
  })

  it('指针拖动：按轨道宽度换算值，并在端点夹紧', async () => {
    const wrapper = mountField()
    const el = wrapper.element as HTMLElement
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 20,
        right: 100,
        bottom: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect

    await wrapper.trigger('pointerdown', { clientX: 50, button: 0, pointerId: 1 })
    await wrapper.trigger('pointermove', { clientX: 200, pointerId: 1 })
    await wrapper.trigger('pointerup', { clientX: 200, pointerId: 1 })

    // 50% → 17；拖到轨道外 → max 24
    expect(emitted(wrapper)).toEqual([17, 24])
  })

  it('step 为小数时按步长对齐（无浮点噪声）', async () => {
    const wrapper = mountField({ modelValue: 0.5, min: 0, max: 1, step: 0.1 })
    await wrapper.trigger('keydown', { key: 'ArrowRight' })
    expect(emitted(wrapper)).toEqual([0.6])
  })
})
