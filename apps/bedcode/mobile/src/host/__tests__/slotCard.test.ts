/**
 * 首页快捷卡片（宿主槽位）
 *
 * 被测：`src/host/SlotCard.vue`。
 *
 * 槽位挂载/回收由 `activate.ts` 负责（无存活会话不注册），本文件只钉卡片内容。
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | C-S1 | 内容由应用自持 | 存活会话数作为卡片主值 |
 * | C-S2 | 零值说明 | count=0 时显示空态说明，非零不显示 |
 * | C-S3 | 点击归宿主 | 卡片内不得自带按钮 / 交互（整卡由宿主壳包成按钮） |
 * | C-S4 | 存活口径 | 只有 running / waitingInput 计数，stopped 历史不计数 |
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import SlotCard from '../SlotCard.vue'

const APP_PROP = { app: { id: 'com.wasmnest.bedcode', name: 'BedCode' } }

const LABEL_KEY = 'com.wasmnest.bedcode.hub.slotTitle'
const EMPTY_KEY = 'com.wasmnest.bedcode.hub.slotEmpty'

/** 生成指定数量的存活会话（默认 running） */
function sessions(count: number, status = 'running') {
  return Array.from({ length: count }, (_, i) => ({ id: i, status }))
}

function installShared(messages: Record<string, string>, sessionList: any[]): void {
  ;(window as any).__WASMNEST_SHARED__ = {
    i18n: { global: { t: (key: string) => messages[key] ?? key } },
    mobileApi: { activeSessions: ref(sessionList) },
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
    installShared({ [LABEL_KEY]: '活跃会话' }, sessions(3))
    const wrapper = mount(SlotCard, { props: APP_PROP })

    expect(wrapper.text()).toContain('活跃会话')
    expect(wrapper.find('.quick-card__value').text()).toBe('3')
  })
})

describe('C-S2 零值说明', () => {
  it('should_showEmptyHint_when_noSessions', () => {
    installShared({ [LABEL_KEY]: '活跃会话', [EMPTY_KEY]: '暂无活跃会话' }, [])
    const wrapper = mount(SlotCard, { props: APP_PROP })

    expect(wrapper.find('.quick-card__value').text()).toBe('0')
    expect(wrapper.find('.quick-card__hint').text()).toBe('暂无活跃会话')
  })

  it('should_hideEmptyHint_when_sessionsActive', () => {
    installShared({ [LABEL_KEY]: '活跃会话', [EMPTY_KEY]: '暂无活跃会话' }, sessions(2))

    expect(mount(SlotCard, { props: APP_PROP }).find('.quick-card__hint').exists()).toBe(false)
  })
})

describe('C-S3 点击归宿主', () => {
  it('should_notRenderOwnButton_when_mounted', () => {
    installShared({ [LABEL_KEY]: '活跃会话' }, sessions(1))

    expect(mount(SlotCard, { props: APP_PROP }).find('button').exists()).toBe(false)
  })
})

describe('C-S4 存活口径', () => {
  it('should_countOnlyLiveSessions_when_stoppedHistoryExists', () => {
    installShared({ [LABEL_KEY]: '活跃会话' }, [
      { id: 'a', status: 'running' },
      { id: 'b', status: 'stopped' },
      { id: 'c', status: 'stopped' },
    ])

    expect(mount(SlotCard, { props: APP_PROP }).find('.quick-card__value').text()).toBe('1')
  })

  it('should_countWaitingInputAsLive_when_agentAwaitsInput', () => {
    installShared({ [LABEL_KEY]: '活跃会话' }, [
      { id: 'a', status: 'waitingInput' },
      { id: 'b', status: 'stopped' },
    ])

    expect(mount(SlotCard, { props: APP_PROP }).find('.quick-card__value').text()).toBe('1')
  })
})
