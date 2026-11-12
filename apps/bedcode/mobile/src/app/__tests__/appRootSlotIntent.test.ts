/**
 * 运行面入口意图（AppRoot）行为契约测试（2026-11-11）
 *
 * 被测：`src/app/AppRoot.vue` 的 `ui.onSurfaceIntent` 订阅与「按会话 id 进终端」。
 *
 * | 契约 | 来源 | 规则 | 预期 |
 * |---|---|---|---|
 * | C-AI1 | 订阅即收 | 宿主排队 → 运行面晚创建 | 挂载后收到排队意图，直接进该会话终端 |
 * | C-AI2 | 预热 + 焦点 | 存活会话 | `activeSessionId` 指向会话 + `bedcode.prewarm` 调用 |
 * | C-AI3 | 目标已消失 | 会话不在目录（已停止 / 移除） | 不开死终端，落到项目页并留痕 |
 * | C-AI4 | 载荷形状校验 | 缺 sessionId / 非字符串 | 忽略该意图（不猜 id） |
 * | C-AI5 | 键不匹配 | 其它入口键 | 不动作（键是应用自持契约） |
 *
 * 子组件全部 shallow 桩：本测试只看 AppRoot 自己的入口处理，不重测子页面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { shallowMount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import AppRoot from '../AppRoot.vue'
import { SLOT_INTENT_OPEN_SESSION } from '../../host/slotIntent'
import {
  installMockMobileApi,
  uninstallMockMobileApi,
  type MockMobileApi,
} from '../../terminal/__tests__/testKit'

type IntentHandler = (intent: { key: string; payload?: unknown }) => void

interface FakeHost {
  context: PluginContext
  /** 模拟宿主：运行面订阅时补投排队意图（与 shell/surfaceIntent.ts 同语义） */
  queue(intent: { key: string; payload?: unknown }): void
  pendingCount(): number
}

function makeHost(): FakeHost {
  let handler: IntentHandler | null = null
  const pending: { key: string; payload?: unknown }[] = []
  const detach = () => {
    handler = null
  }
  const deliver = () => {
    if (!handler) return
    for (const intent of pending.splice(0)) handler(intent)
  }

  const disposable = () => ({ dispose: () => {} })
  const context = {
    i18n: { t: (key: string) => key, registerMessages: () => {} },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    events: { on: () => disposable(), emit: () => {} },
    commands: { execute: vi.fn(async () => ({ code: 0, message: 'ok' })) },
    dialogs: { showToast: vi.fn(), showConfirm: vi.fn(async () => true) },
    notifications: { show: vi.fn() },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    status: { reportReady: vi.fn(), reportError: vi.fn() },
    lifecycle: { onAppStartup: () => disposable(), onAppShutdown: () => disposable() },
    ui: {
      onBackPressed: () => disposable(),
      onSurfaceIntent: (cb: IntentHandler) => {
        handler = cb
        deliver()
        return { dispose: detach }
      },
    },
  } as unknown as PluginContext

  return {
    context,
    queue(intent) {
      pending.push(intent)
      deliver()
    },
    pendingCount: () => pending.length,
  }
}

function installApi(): MockMobileApi {
  const api = installMockMobileApi({ isPaired: true, isConnected: true })
  // useAppSettings 首帧加载走宿主 KV 桥（本测试不关心设置值，给空表即可）
  ;(api as unknown as Record<string, unknown>).readAllSettings = async () => ({})
  ;(api as unknown as Record<string, unknown>).writeSetting = async () => {}
  return api
}

function mountRoot(host: FakeHost) {
  return shallowMount(AppRoot, {
    global: { provide: { pluginContext: host.context } },
  })
}

let api: MockMobileApi

beforeEach(() => {
  api = installApi()
})

afterEach(() => {
  uninstallMockMobileApi()
  vi.clearAllMocks()
})

describe('C-AI1/C-AI2 排队意图 → 直接进会话终端', () => {
  it('should_openTerminalForQueuedSession_when_surfaceMountsLater', async () => {
    api.activeSessions.value = [
      { id: 's1', name: '支付重构', status: 'running' },
      { id: 's2', name: '另一个会话', status: 'running' },
    ]
    const host = makeHost()
    // 点击发生在运行面创建之前：宿主先排队
    host.queue({ key: SLOT_INTENT_OPEN_SESSION, payload: { sessionId: 's2' } })
    expect(host.pendingCount()).toBe(1)

    const wrapper = mountRoot(host)
    await nextTick()

    expect(host.pendingCount(), '订阅时补投，不留在队列里').toBe(0)
    const terminal = wrapper.findComponent({ name: 'TerminalView' })
    expect(terminal.exists()).toBe(true)
    expect(terminal.props('sessionId')).toBe('s2')
    // 预热只建连，sessionId 即运行 id（与项目页 openRun 同一条链路）
    expect(host.context.commands.execute).toHaveBeenCalledWith('bedcode.prewarm', {
      sessionId: 's2',
    })
    expect(api.activeSessionId.value).toBe('s2')
    wrapper.unmount()
  })

  it('should_openTerminalImmediately_when_intentArrivesWhileMounted', async () => {
    api.activeSessions.value = [{ id: 's1', name: '支付重构', status: 'waitingInput' }]
    const host = makeHost()
    const wrapper = mountRoot(host)
    await nextTick()

    host.queue({ key: SLOT_INTENT_OPEN_SESSION, payload: { sessionId: 's1' } })
    await nextTick()

    expect(wrapper.findComponent({ name: 'TerminalView' }).props('sessionId')).toBe('s1')
    wrapper.unmount()
  })
})

describe('C-AI3 目标会话已消失（已停止 / 移除）', () => {
  it('should_notOpenDeadTerminal_when_sessionMissing', async () => {
    api.activeSessions.value = []
    const host = makeHost()
    const wrapper = mountRoot(host)
    await nextTick()

    host.queue({ key: SLOT_INTENT_OPEN_SESSION, payload: { sessionId: 'gone' } })
    await nextTick()

    expect(wrapper.findComponent({ name: 'TerminalView' }).exists()).toBe(false)
    expect(host.context.logger.warn).toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('C-AI4/C-AI5 意图校验', () => {
  it('should_ignoreIntent_when_payloadMalformed', async () => {
    api.activeSessions.value = [{ id: 's1', name: '支付重构', status: 'running' }]
    const host = makeHost()
    const wrapper = mountRoot(host)
    await nextTick()

    for (const payload of [undefined, null, {}, { sessionId: 42 }]) {
      host.queue({ key: SLOT_INTENT_OPEN_SESSION, payload })
    }
    await nextTick()

    expect(wrapper.findComponent({ name: 'TerminalView' }).exists()).toBe(false)
    expect(host.context.logger.warn).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('should_ignoreIntent_when_keyIsNotOpenSession', async () => {
    api.activeSessions.value = [{ id: 's1', name: '支付重构', status: 'running' }]
    const host = makeHost()
    const wrapper = mountRoot(host)
    await nextTick()

    host.queue({ key: 'settings', payload: { sessionId: 's1' } })
    await nextTick()

    expect(wrapper.findComponent({ name: 'TerminalView' }).exists()).toBe(false)
    wrapper.unmount()
  })
})
