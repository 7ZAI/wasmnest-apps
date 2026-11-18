/**
 * 多任务预览的 i18n 隔离契约
 *
 * `mountPreview` 是只读面：它按宿主 locale 渲染卡片，但**不得**改写主应用的
 * 模块级 i18n 实例（`i18n.global.locale`）。否则用户在主应用里选了英文，进多任务
 * 视图时预览以宿主 locale 挂载，会把主应用语言改回宿主值。
 */

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import i18n from '../i18n'
import PreviewCard from '../preview/PreviewCard.vue'
import type { AppPreviewEnv } from '../entry'

function makeEnv(locale: string, notes: unknown[] = []): AppPreviewEnv {
  return {
    appId: 'com.wasmnest.lanbitou',
    appInvoke: vi.fn(async () => notes),
    appStorageGet: vi.fn(async () => undefined),
    locale,
    theme: 'light',
  } as unknown as AppPreviewEnv
}

describe('PreviewCard — i18n 隔离', () => {
  it('按宿主 locale 渲染卡片，但不改主应用 i18n locale', async () => {
    i18n.global.locale.value = 'zh-CN'

    const wrapper = mount(PreviewCard, { props: { env: makeEnv('en') } })
    await flushPromises()

    expect(wrapper.text()).toContain('Recent Note')
    expect(i18n.global.locale.value).toBe('zh-CN')

    wrapper.unmount()
    expect(i18n.global.locale.value).toBe('zh-CN')
  })

  it('宿主 locale 未知时回落中文', async () => {
    const wrapper = mount(PreviewCard, { props: { env: makeEnv('fr') } })
    await flushPromises()

    expect(wrapper.text()).toContain('最近笔记')
    wrapper.unmount()
  })
})
