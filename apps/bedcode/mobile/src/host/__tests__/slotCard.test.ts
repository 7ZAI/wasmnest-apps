/**
 * 首页快捷卡片（宿主槽位）
 *
 * 被测：`src/host/SlotCard.vue`。
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | C-S1 | 内容由应用自持 | 活跃会话数作为卡片主值 |
 * | C-S2 | 零值说明 | count=0 时显示空态说明，非零不显示 |
 * | C-S3 | 点击归宿主 | 卡片内不得自带按钮 / 交互（整卡由宿主壳包成按钮） |
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import SlotCard from '../SlotCard.vue'

const APP_PROP = { app: { id: 'com.wasmnest.bedcode', name: 'BedCode' } }

const LABEL_KEY = 'com.wasmnest.bedcode.hub.slotTitle'
const EMPTY_KEY = 'com.wasmnest.bedcode.hub.slotEmpty'

function installShared(messages: Record<string, string>, sessionCount: number): void {
  ;(window as any).__WASMNEST_SHARED__ = {
    i18n: { global: { t: (key: string) => messages[key] ?? key } },
    mobileApi: { activeSessions: ref(Array.from({ length: sessionCount }, (_, i) => ({ id: i }))) },
  }
}

beforeEach(() => {
  ;(window as any).__WASMNEST_SHARED__ = undefined
})

afterEach(() => {
  ;(window as any).__WASMNEST_SHARED__ = undefined
})

describe('C-S1 卡片内容', () => {
  it('should_showSessionCountAndLabel_when_sessionsActive', () => {
    installShared({ [LABEL_KEY]: '活跃会话' }, 3)
    const wrapper = mount(SlotCard, { props: APP_PROP })

    expect(wrapper.text()).toContain('活跃会话')
    expect(wrapper.find('.quick-card__value').text()).toBe('3')
  })
})

describe('C-S2 零值说明', () => {
  it('should_showEmptyHint_when_noSessions', () => {
    installShared({ [LABEL_KEY]: '活跃会话', [EMPTY_KEY]: '暂无活跃会话' }, 0)
    const wrapper = mount(SlotCard, { props: APP_PROP })

    expect(wrapper.find('.quick-card__value').text()).toBe('0')
    expect(wrapper.find('.quick-card__hint').text()).toBe('暂无活跃会话')
  })

  it('should_hideEmptyHint_when_sessionsActive', () => {
    installShared({ [LABEL_KEY]: '活跃会话', [EMPTY_KEY]: '暂无活跃会话' }, 2)

    expect(mount(SlotCard, { props: APP_PROP }).find('.quick-card__hint').exists()).toBe(false)
  })
})

describe('C-S3 点击归宿主', () => {
  it('should_notRenderOwnButton_when_mounted', () => {
    installShared({ [LABEL_KEY]: '活跃会话' }, 1)

    expect(mount(SlotCard, { props: APP_PROP }).find('button').exists()).toBe(false)
  })
})