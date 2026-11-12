/**
 * 项目域编排契约：异步竞态护栏
 *
 * 用户返回列表 / 切项目后，旧详情请求可能才回来。契约是：旧响应只允许刷新
 * 项目列表，不得把用户重新拽回详情、不得把旧运行列表或错误写进当前页。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { useProjects, clearRememberedProject } from '../useProjects'
import { installMockMobileApi, uninstallMockMobileApi } from '../../terminal/__tests__/testKit'

function projectView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    environment: 'linux',
    workingDir: '/srv/pay',
    name: '支付重构',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-31T00:00:00Z',
    lastOpenedAt: null,
    activeRuns: 0,
    runCount: 0,
    lastActivityAt: null,
    lastAgentId: null,
    ...overrides,
  }
}

function runView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    projectId: 'p-1',
    configId: 'cfg-1',
    agentId: 'pi',
    agentSessionId: null,
    title: '运行一',
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

function makePluginContext(responders: Record<string, (args?: any) => unknown>) {
  return {
    commands: {
      execute: vi.fn(async (id: string, args?: any) => {
        const responder = responders[id]
        if (!responder) throw new Error(`no responder for ${id}`)
        return responder(args)
      }),
    },
    i18n: { t: (key: string) => key },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as PluginContext
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  clearRememberedProject()
  installMockMobileApi({ isPaired: true, isConnected: true })
})

afterEach(() => {
  uninstallMockMobileApi()
})

describe('异步竞态护栏', () => {
  it('详情刷新在返回列表后才回来：只刷新列表，不重新进入详情', async () => {
    const project = projectView()
    let projectCalls = 0
    let resolveStaleProjects!: (value: unknown) => void
    const staleProjects = new Promise((resolve) => {
      resolveStaleProjects = resolve
    })

    const ctx = makePluginContext({
      'bedcode.list-projects': () => {
        projectCalls += 1
        // 第 1 次 = 首屏（立即）；第 2 次 = 详情刷新（挂起）；第 3 次 = 返回列表（立即）
        if (projectCalls === 2) return staleProjects
        return { code: 0, data: { projects: [project] } }
      },
      'bedcode.list-runs': () => ({ code: 0, data: { runs: [runView()] } }),
    })
    const store = useProjects(ctx)

    await store.loadProjects()
    await store.openProject(project)
    expect(store.currentProject.value?.id).toBe('p-1')
    expect(store.runs.value).toHaveLength(1)

    const pendingRefresh = store.refreshCurrent()
    store.backToList()
    expect(store.currentProject.value).toBeNull()

    resolveStaleProjects({ code: 0, data: { projects: [project] } })
    await pendingRefresh
    await settle()

    expect(store.currentProject.value).toBeNull()
    expect(store.runs.value).toHaveLength(0)
    expect(store.projects.value).toHaveLength(1)
  })

  it('旧运行请求失败且用户已返回：错误不落到列表页', async () => {
    const project = projectView()
    let resolveRuns!: (value: unknown) => void
    const slowRuns = new Promise((resolve) => {
      resolveRuns = resolve
    })
    let runsCalls = 0

    const ctx = makePluginContext({
      'bedcode.list-projects': () => ({ code: 0, data: { projects: [project] } }),
      'bedcode.list-runs': () => {
        runsCalls += 1
        // 第 1 次 = 进项目（立即成功）；第 2 次 = 详情刷新（挂起）
        if (runsCalls === 1) return { code: 0, data: { runs: [runView()] } }
        return slowRuns
      },
    })
    const store = useProjects(ctx)

    await store.loadProjects()
    await store.openProject(project)

    const pendingRefresh = store.refreshCurrent()
    store.backToList()

    resolveRuns({ code: 1002, message: 'desktop offline' })
    await expect(pendingRefresh).rejects.toThrow('desktop offline')
    await settle()

    expect(store.currentProject.value).toBeNull()
    expect(store.loadError.value).toBe('')
  })
})
