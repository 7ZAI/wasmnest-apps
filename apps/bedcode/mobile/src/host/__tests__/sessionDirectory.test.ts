/**
 * 会话目录行为契约（项目化适配：桌面 /api/sessions scope:"session" 后，
 * 项目运行只经 `bedcode.list-runs` 可见）
 *
 * 只断言外部行为：
 * - 合并：宿主 activeSessions（无项目终端会话）+ 运行列表（含项目运行），按 id 去重；
 * - 同 id 时宿主条目优先（WS 事件更新，且带任务槽字段）；
 * - 运行条目映射成会话形状（title 优先名 / configId 双键 / 旧 `{error}` 状态归一）；
 * - 刷新时机：配对完成、会话事件 300ms 合并、重连；未配对不取数；
 * - 失败口径：拉取失败保留旧值并留痕；掉认证清空运行侧；dispose 清空全部。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import {
  directorySessionById,
  getDirectorySessions,
  disposeSessionDirectory,
  initSessionDirectory,
  refreshSessionDirectory,
  runToSession,
} from '../sessionDirectory'
import {
  installMockMobileApi,
  uninstallMockMobileApi,
  type MockMobileApi,
} from '../../terminal/__tests__/testKit'

function runView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    projectId: 'p-1',
    configId: 'cfg-1',
    agentId: 'pi',
    agentSessionId: 'ses-1',
    title: '修复支付回调',
    name: '支付重构',
    status: 'running',
    model: null,
    createdAt: '2026-10-31T00:00:00Z',
    startedAt: '2026-10-31T00:00:01Z',
    stoppedAt: null,
    updatedAt: '2026-10-31T00:00:05Z',
    active: true,
    truncated: false,
    bridgeSeenAt: null,
    bridgeConnected: false,
    ...overrides,
  }
}

interface Harness {
  api: MockMobileApi
  ctx: PluginContext
  calls: { command: string; args?: any }[]
  logs: string[]
  emitSession(event: { type: string; sessionId?: string }): void
  emitConnection(event: { type: string }): void
  /** 运行列表响应（用例可改写） */
  setRuns(runs: unknown[] | (() => unknown)): void
}

function createHarness(options: { paired?: boolean } = {}): Harness {
  const api = installMockMobileApi({ isPaired: options.paired ?? true })
  const calls: Harness['calls'] = []
  const logs: string[] = []
  const sessionHandlers: ((event: any) => void)[] = []
  const connectionHandlers: ((event: any) => void)[] = []
  let runsReply: unknown[] | (() => unknown) = [runView()]

  api.onSessionEvent = (handler: (event: any) => void) => {
    sessionHandlers.push(handler)
    return { dispose: vi.fn() }
  }
  api.onConnectionEvent = (handler: (event: any) => void) => {
    connectionHandlers.push(handler)
    return { dispose: vi.fn() }
  }

  const ctx = {
    commands: {
      execute: vi.fn(async (command: string, args?: any) => {
        calls.push({ command, args })
        if (command === 'bedcode.list-runs') {
          const pending = typeof runsReply === 'function' ? runsReply() : runsReply
          const value = await pending
          if (value instanceof Error) throw value
          return { code: 0, message: 'ok', data: { runs: value } }
        }
        throw new Error(`unexpected command: ${command}`)
      }),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn((message: string) => logs.push(message)),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as PluginContext

  return {
    api,
    ctx,
    calls,
    logs,
    emitSession: (event) => {
      for (const handler of sessionHandlers) handler(event)
    },
    emitConnection: (event) => {
      for (const handler of connectionHandlers) handler(event)
    },
    setRuns: (runs) => {
      runsReply = runs
    },
  }
}

beforeEach(() => {
  disposeSessionDirectory()
})

afterEach(() => {
  disposeSessionDirectory()
  uninstallMockMobileApi()
  vi.useRealTimers()
})

describe('合并视图', () => {
  it('should_merge_host_sessions_and_project_runs_when_initialized_paired', async () => {
    const h = createHarness()
    h.api.activeSessions.value = [{ id: 's-legacy', name: '独立终端', status: 'running' }]
    initSessionDirectory(h.ctx)
    await flushPromises()

    const ids = getDirectorySessions()
      .map((s) => s.id)
      .sort()
    expect(ids).toEqual(['r-1', 's-legacy'])
    const run = directorySessionById('r-1')
    expect(run).toMatchObject({
      id: 'r-1',
      name: '修复支付回调',
      status: 'running',
      configId: 'cfg-1',
      config_id: 'cfg-1',
      projectId: 'p-1',
      agentId: 'pi',
    })
  })

  it('should_prefer_host_entry_when_same_id_appears_in_both_sources', async () => {
    const h = createHarness()
    // 宿主条目来自 WS 事件：状态比拉取新，且带任务槽字段
    h.api.activeSessions.value = [
      {
        id: 'r-1',
        name: '事件名',
        status: 'waitingInput',
        configId: 'cfg-1',
        task_status: 'asking',
      },
    ]
    h.setRuns([runView({ status: 'running', title: '拉取名' })])
    initSessionDirectory(h.ctx)
    await flushPromises()

    expect(getDirectorySessions()).toHaveLength(1)
    expect(getDirectorySessions()[0]).toMatchObject({
      name: '事件名',
      status: 'waitingInput',
      task_status: 'asking',
    })
  })

  it('should_fill_project_run_without_host_entry_when_only_runs_have_it', async () => {
    const h = createHarness()
    initSessionDirectory(h.ctx)
    await flushPromises()

    // 桌面先起运行、移动后连：宿主投影无此运行，目录仍可见
    expect(directorySessionById('r-1')).toMatchObject({ status: 'running', config_id: 'cfg-1' })
  })
})

describe('运行 → 会话形状', () => {
  it('should_prefer_title_and_carry_config_keys_when_mapping_run', () => {
    const session = runToSession(runView({ title: null, name: '回退名' }) as any)
    expect(session.name).toBe('回退名')
    expect(session.configId).toBe('cfg-1')
    expect(session.config_id).toBe('cfg-1')
  })

  it('should_normalize_legacy_error_object_when_fetching_runs', async () => {
    const h = createHarness()
    h.setRuns([runView({ status: { error: 'pty closed' } })])
    initSessionDirectory(h.ctx)
    await flushPromises()

    expect(directorySessionById('r-1')?.status).toBe('error')
  })
})

describe('刷新时机与门控', () => {
  it('should_not_fetch_when_unpaired', async () => {
    const h = createHarness({ paired: false })
    initSessionDirectory(h.ctx)
    await flushPromises()

    expect(h.calls.filter((c) => c.command === 'bedcode.list-runs')).toHaveLength(0)
    expect(getDirectorySessions()).toHaveLength(0)
  })

  it('should_fetch_once_when_pairing_completes_after_init', async () => {
    const h = createHarness({ paired: false })
    initSessionDirectory(h.ctx)
    await flushPromises()
    expect(h.calls).toHaveLength(0)

    h.api.isPaired.value = true
    await flushPromises()
    expect(h.calls.filter((c) => c.command === 'bedcode.list-runs')).toHaveLength(1)
    expect(directorySessionById('r-1')).toBeTruthy()
  })

  it('should_debounce_session_events_into_one_refresh', async () => {
    vi.useFakeTimers()
    const h = createHarness()
    initSessionDirectory(h.ctx)
    await flushPromises()
    const before = h.calls.filter((c) => c.command === 'bedcode.list-runs').length

    h.emitSession({ type: 'session_status' })
    h.emitSession({ type: 'session_stopped' })
    h.emitSession({ type: 'session_removed' })
    await vi.advanceTimersByTimeAsync(299)
    expect(h.calls.filter((c) => c.command === 'bedcode.list-runs')).toHaveLength(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls.filter((c) => c.command === 'bedcode.list-runs')).toHaveLength(before + 1)
  })

  it('should_refresh_after_reconnect', async () => {
    vi.useFakeTimers()
    const h = createHarness()
    initSessionDirectory(h.ctx)
    await flushPromises()
    const before = h.calls.filter((c) => c.command === 'bedcode.list-runs').length

    h.emitConnection({ type: 'reconnected' })
    await vi.advanceTimersByTimeAsync(300)
    expect(h.calls.filter((c) => c.command === 'bedcode.list-runs')).toHaveLength(before + 1)
  })
})

describe('失败与生命周期', () => {
  it('should_keep_previous_runs_and_log_when_refresh_fails', async () => {
    const h = createHarness()
    initSessionDirectory(h.ctx)
    await flushPromises()
    expect(directorySessionById('r-1')).toBeTruthy()

    h.setRuns(() => new Error('network down'))
    await refreshSessionDirectory()

    // 一次失败不等于运行全没了：保留旧值，终端/任务面不被误判
    expect(directorySessionById('r-1')).toBeTruthy()
    expect(h.logs.some((line) => line.includes('refresh runs failed'))).toBe(true)
  })

  it('should_clear_runs_when_reauth_rejected', async () => {
    const h = createHarness()
    initSessionDirectory(h.ctx)
    await flushPromises()
    expect(directorySessionById('r-1')).toBeTruthy()

    h.emitConnection({ type: 'reauth_rejected' })
    expect(directorySessionById('r-1')).toBeUndefined()
  })

  it('should_clear_all_state_on_dispose', async () => {
    const h = createHarness()
    h.api.activeSessions.value = [{ id: 's-legacy', status: 'running' }]
    const directory = initSessionDirectory(h.ctx)
    await flushPromises()
    expect(getDirectorySessions().length).toBeGreaterThan(0)

    directory.dispose()
    h.api.activeSessions.value = []
    expect(getDirectorySessions()).toHaveLength(0)
  })

  it('should_ignore_stale_response_when_refresh_races_dispose', async () => {
    let release: ((runs: unknown[]) => void) | null = null
    const h = createHarness()
    h.setRuns(
      () =>
        new Promise<unknown[]>((resolve) => {
          release = resolve
        }),
    )
    initSessionDirectory(h.ctx)
    await flushPromises()

    disposeSessionDirectory()
    release!([runView({ id: 'stale-run' })])
    await flushPromises()
    expect(getDirectorySessions()).toHaveLength(0)
  })
})
