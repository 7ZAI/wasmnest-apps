/**
 * PreviewCard 行为契约（T18 · 多任务卡片只读预览）
 *
 * - 已配置 / 未配置按状态如实呈现；
 * - 命令失败 / 回执畸形 / **存储损坏**（relayError / wanError 非空）一律按
 *   「读取失败」呈现，不冒充「尚未导入」（fail-visible）；
 * - 预览只读：只调 `net-config.status`，不写存储、不改策略。
 */

import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PreviewCard from '@/preview/PreviewCard.vue'
import i18n, { MESSAGE_NAMESPACE } from '@/i18n'
import type { AppPreviewEnv } from '@/entry'
import type { NetConfigStatus } from '@/types'

const t = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})

function makeEnv(appInvoke: AppPreviewEnv['appInvoke']): AppPreviewEnv {
  return {
    appId: 'com.wasmnest.net-config',
    appInvoke,
    appStorageGet: async () => undefined,
    locale: 'zh-CN',
    theme: 'light',
  }
}

function status(overrides: Partial<NetConfigStatus> = {}): NetConfigStatus {
  return {
    configured: false,
    relayAddrsCount: 0,
    relayError: null,
    wanApps: 0,
    wanError: null,
    version: '0.0.1',
    ...overrides,
  }
}

async function mountCard(appInvoke: AppPreviewEnv['appInvoke']) {
  const wrapper = mount(PreviewCard, { props: { env: makeEnv(appInvoke) } })
  await flushPromises()
  return wrapper
}

describe('PreviewCard 只读预览', () => {
  it('已配置：显示地址数量', async () => {
    const invoke = vi.fn(async () => status({ configured: true, relayAddrsCount: 2 }))
    const wrapper = await mountCard(invoke)
    expect(wrapper.get('[data-testid="net-config-preview-state"]').text()).toBe(
      t('preview.configured', { count: 2 }),
    )
    expect(invoke).toHaveBeenCalledWith('net-config.status')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('未配置：显示空态', async () => {
    const wrapper = await mountCard(async () => status())
    expect(wrapper.get('[data-testid="net-config-preview-state"]').text()).toBe(t('preview.empty'))
  })

  it('存储损坏（relayError 非空）：显示读取失败，不冒充未配置', async () => {
    const wrapper = await mountCard(async () =>
      status({ relayError: 'relay settings version unsupported: 7' }),
    )
    const state = wrapper.get('[data-testid="net-config-preview-state"]')
    expect(state.text()).toBe(t('preview.unavailable'))
    expect(state.attributes('title')).toBe('relay settings version unsupported: 7')
  })

  it('策略存储损坏（wanError 非空）：同样显示读取失败', async () => {
    const wrapper = await mountCard(async () =>
      status({ wanError: 'wan policy version unsupported: 9' }),
    )
    const state = wrapper.get('[data-testid="net-config-preview-state"]')
    expect(state.text()).toBe(t('preview.unavailable'))
    expect(state.attributes('title')).toBe('wan policy version unsupported: 9')
  })

  it('命令失败 / 回执畸形：显示读取失败', async () => {
    const failed = await mountCard(async () => {
      throw new Error('centre down')
    })
    expect(failed.get('[data-testid="net-config-preview-state"]').text()).toBe(
      t('preview.unavailable'),
    )

    const malformed = await mountCard(async () => ({ configured: 'yes' }) as never)
    expect(malformed.get('[data-testid="net-config-preview-state"]').text()).toBe(
      t('preview.unavailable'),
    )
  })
})
