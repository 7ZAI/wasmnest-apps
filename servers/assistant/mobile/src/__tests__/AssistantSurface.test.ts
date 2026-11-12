/**
 * Nest 移动运行面包装单测（票 07 保险库）
 *
 * 覆盖壳装配与命令接线：挂载后自动执行 `assistant.vault-status`（经宿主
 * commands.execute），保险库视图显性呈现状态；失败路径点名原因。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AssistantSurface from '../components/AssistantSurface.vue'
import { messages } from '../i18n'
import { ASSISTANT_PLUGIN_ID } from '@nest-shared/types'

const NAMESPACE = 'com.wasmnest.assistant'

/** 测试用 i18n：与宿主注册口径一致（插件 ID 前缀的扁平 key） */
function makeI18n(locale = 'zh-CN') {
  const prefixed: Record<string, string> = {}
  for (const [key, value] of Object.entries(messages['zh-CN'])) {
    prefixed[`${NAMESPACE}.${key}`] = value
  }
  const enPrefixed: Record<string, string> = {}
  for (const [key, value] of Object.entries(messages.en)) {
    enPrefixed[`${NAMESPACE}.${key}`] = value
  }
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'zh-CN',
    messages: { 'zh-CN': prefixed, en: enPrefixed },
  })
}

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  vi.restoreAllMocks()
})

function mountSurface(execute: (command: string, ...args: unknown[]) => Promise<unknown>) {
  const context = {
    id: NAMESPACE,
    commands: { execute },
  }
  const wrapper = mount(AssistantSurface, {
    global: {
      plugins: [makeI18n()],
      provide: { pluginContext: context },
    },
  })
  mounted.push(wrapper)
  return wrapper
}

describe('AssistantSurface（移动运行面接线 · 票 07 保险库）', () => {
  it('挂载后自动查保险库状态：渲染视图并显性呈现状态', async () => {
    const execute = vi.fn(async () => ({ exists: true, unlocked: true }))
    const wrapper = mountSurface(execute)

    await flushPromises()

    expect(execute).toHaveBeenCalledWith('assistant.vault-status', undefined)
    expect(wrapper.find('[data-testid="nest-vault"]').exists()).toBe(true)
    const statusEl = wrapper.find('[data-testid="nest-vault-status"]')
    expect(statusEl.text()).toContain('已解锁')
  })

  it('状态查询失败：显性报错，点名原因', async () => {
    const execute = vi.fn(async () => {
      throw new Error('vault missing')
    })
    const wrapper = mountSurface(execute)

    await flushPromises()

    const errorEl = wrapper.find('[data-testid="nest-vault-error"]')
    expect(errorEl.text()).toContain('vault missing')
  })
})
