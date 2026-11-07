/**
 * 宿主页域激活 行为契约测试
 * （票 2026-10-09-mobile-host-into-wasm-apps，阶段 A4/A5；票 2026-10-10 调整）
 *
 * 被测：`src/host/activate.ts`（activateHostPageDomain）。
 *
 * 票 2026-10-10 起本域职责收窄：运行面（底部导航 + 页签容器）迁至 app 域
 * （`src/app/activate.ts`），本域只出内容面（设备 / 会话）与首页槽位。
 * 「旧读路径删除」在此钉住——域入口不得再注册运行面。
 *
 * 2026-11-06 起槽位不再是激活期常驻项：只在有存活会话时注册（用户裁决
 * 「卡片不是启动即创建，没有会话就消失」）。契约随之下移为「卡片生命周期」。
 *
 * | 契约 | 来源 | 规则 | 预期 |
 * |---|---|---|---|
 * | C-P1 | registerMessages ×2 | zh-CN / en 两份文案都注册 | 2 次调用，locale 各一 |
 * | C-P2 | 注册顺序 | 文案必须在运行面 setup 前就位 | 文案调用早于槽位 |
 * | C-P3 | 退役面 | 本域**不再**注册运行面（票 2026-10-10） | registerSurface 零调用 |
 * | C-P4 | registerSlot | 有存活会话时注册首页槽位 id='host-sessions'、order=10 | 入参形状 |
 * | C-P5 | 槽位生命周期 | 无存活会话不注册；会话出现补注册；最后一个存活会话结束即回收 | 注册 / 回收次数 |
 * | C-P6 | dispose | 观测器停止 + 槽位回收一次（重复 dispose 不重复回收） | dispose 1 次 |
 * | C-P7 | i18n 双语同步 | zh-CN 与 en 的 hub 键集合完全一致 | 键路径数组相等 |
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { activateHostPageDomain } from '../activate'
import { messagesEn, messagesZhCN } from '../i18n'

/** 收集对象树的键路径（双语键集合比对用） */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value && typeof value === 'object'
      ? keyPaths(value as Record<string, unknown>, path)
      : [path]
  })
}

/** 安装宿主共享运行时替身（本域只依赖 mobileApi.activeSessions） */
function installShared(sessions: any[] = []): Ref<any[]> {
  const activeSessions = ref(sessions)
  ;(window as any).__WASMNEST_SHARED__ = { mobileApi: { activeSessions } }
  return activeSessions
}

/** 最小插件上下文替身（本域用到的面：i18n / ui / logger） */
function createFakeContext() {
  const slotDispose = vi.fn()
  const surfaceDispose = vi.fn()
  const registerMessages = vi.fn((_locale: string, _messages: Record<string, unknown>) => {})
  const registerSlot = vi.fn((_slot: unknown) => ({ dispose: slotDispose }))
  const registerSurface = vi.fn((_surface: unknown) => ({ dispose: surfaceDispose }))
  const logInfo = vi.fn()
  const context = {
    i18n: { registerMessages, t: (key: string) => key },
    ui: { registerSlot, registerSurface },
    logger: { info: logInfo },
  } as unknown as PluginContext
  return {
    context,
    registerMessages,
    registerSlot,
    registerSurface,
    slotDispose,
    surfaceDispose,
  }
}

/** 会话夹具用工厂：测试会改写 status，字面量常量会被后续用例串改 */
const running = () => ({ id: 's1', status: 'running' })
const waiting = () => ({ id: 's2', status: 'waitingInput' })
const stopped = () => ({ id: 's3', status: 'stopped' })

beforeEach(() => {
  installShared()
})

afterEach(() => {
  ;(window as any).__WASMNEST_SHARED__ = undefined
})

describe('C-P1/C-P2 文案注册与顺序', () => {
  it('should_registerBothLocalesBeforeSlot_when_activated', () => {
    installShared([running()])
    const fake = createFakeContext()
    activateHostPageDomain(fake.context)

    expect(fake.registerMessages).toHaveBeenCalledTimes(2)
    expect(fake.registerMessages.mock.calls.map((c) => c[0]).sort()).toEqual(['en', 'zh-CN'])
    expect(fake.registerMessages.mock.calls[0][1]).toBe(messagesZhCN)
    expect(fake.registerMessages.mock.calls[1][1]).toBe(messagesEn)

    // 文案先于注册项：组件 setup 期就要能取到 hub.* 键
    const [firstMessagesCall] = fake.registerMessages.mock.invocationCallOrder
    const [slotCall] = fake.registerSlot.mock.invocationCallOrder
    expect(firstMessagesCall).toBeLessThan(slotCall)
  })
})

describe('C-P3 退役面：运行面已迁 app 域', () => {
  it('should_notRegisterSurface_when_domainActivated', () => {
    installShared([running()])
    const fake = createFakeContext()
    activateHostPageDomain(fake.context)

    expect(fake.registerSurface).not.toHaveBeenCalled()
  })
})

describe('C-P4 槽位注册', () => {
  it('should_registerHomeSlot_when_liveSessionExists', () => {
    installShared([running()])
    const fake = createFakeContext()
    activateHostPageDomain(fake.context)

    expect(fake.registerSlot).toHaveBeenCalledTimes(1)
    expect(fake.registerSlot.mock.calls[0][0]).toEqual({
      id: 'host-sessions',
      component: expect.anything(),
      order: 10,
    })
  })

  it('should_treatWaitingInputAsLive_when_sessionAwaitsInput', () => {
    installShared([waiting()])
    const fake = createFakeContext()
    activateHostPageDomain(fake.context)

    expect(fake.registerSlot).toHaveBeenCalledTimes(1)
  })
})

describe('C-P5 槽位生命周期：有会话才存在', () => {
  it('should_notRegisterSlot_when_noSessions', () => {
    const fake = createFakeContext()
    activateHostPageDomain(fake.context)

    expect(fake.registerSlot).not.toHaveBeenCalled()
  })

  it('should_notRegisterSlot_when_onlyStoppedSessions', () => {
    installShared([stopped()])
    const fake = createFakeContext()
    activateHostPageDomain(fake.context)

    expect(fake.registerSlot).not.toHaveBeenCalled()
  })

  it('should_registerSlot_when_firstLiveSessionAppears', async () => {
    const sessions = installShared()
    const fake = createFakeContext()
    activateHostPageDomain(fake.context)

    sessions.value = [running()]
    await nextTick()

    expect(fake.registerSlot).toHaveBeenCalledTimes(1)
  })

  it('should_disposeSlot_when_lastLiveSessionStops', async () => {
    const sessions = installShared([running()])
    const fake = createFakeContext()
    activateHostPageDomain(fake.context)
    expect(fake.registerSlot).toHaveBeenCalledTimes(1)

    sessions.value = [stopped()]
    await nextTick()

    expect(fake.slotDispose).toHaveBeenCalledTimes(1)
  })

  it('should_notReRegisterSlot_when_sessionsChangeButStayLive', async () => {
    const sessions = installShared([running()])
    const fake = createFakeContext()
    activateHostPageDomain(fake.context)

    sessions.value.push(waiting())
    await nextTick()

    expect(fake.registerSlot).toHaveBeenCalledTimes(1)
    expect(fake.slotDispose).not.toHaveBeenCalled()
  })
})

describe('C-P6 回收语义', () => {
  it('should_disposeSlotOnce_when_domainDisposed', () => {
    installShared([running()])
    const fake = createFakeContext()
    const domain = activateHostPageDomain(fake.context)

    domain.dispose()

    expect(fake.slotDispose).toHaveBeenCalledTimes(1)
    expect(fake.surfaceDispose).not.toHaveBeenCalled()
  })

  it('should_beIdempotent_when_domainDisposedTwice', () => {
    installShared([running()])
    const fake = createFakeContext()
    const domain = activateHostPageDomain(fake.context)

    domain.dispose()
    domain.dispose()

    // 本域自持 slot 句柄：置空后再 dispose 不再触达下游（宿主 registry 的 drop 本就幂等）
    expect(fake.slotDispose).toHaveBeenCalledTimes(1)
  })

  it('should_stopWatching_when_domainDisposed', async () => {
    const sessions = installShared()
    const fake = createFakeContext()
    const domain = activateHostPageDomain(fake.context)

    domain.dispose()
    sessions.value = [running()]
    await nextTick()

    expect(fake.registerSlot).not.toHaveBeenCalled()
  })
})

describe('C-P7 i18n 双语同步', () => {
  it('should_haveIdenticalKeySets_when_bothLocalesAuthored', () => {
    const zhKeys = keyPaths(messagesZhCN as unknown as Record<string, unknown>).sort()
    const enKeys = keyPaths(messagesEn as unknown as Record<string, unknown>).sort()

    expect(zhKeys.length).toBeGreaterThan(0)
    expect(enKeys).toEqual(zhKeys)
  })

  it('should_registerRunTimeKeys_when_sessionCardRenders（useRunTime 引用的键必须双语在场）', () => {
    const expected = ['hub.runTimeSeconds', 'hub.runTimeMinutesSeconds', 'hub.runTimeHoursMinutes']
    for (const locale of [messagesZhCN, messagesEn]) {
      expect(keyPaths(locale as unknown as Record<string, unknown>)).toEqual(
        expect.arrayContaining(expected),
      )
    }
  })
})
