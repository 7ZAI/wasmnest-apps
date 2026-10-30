/**
 * 项目与运行数据层契约（ADR 0003 / issue #23 M2）
 *
 * 判据只落在外部行为：**命令进 → 形状出**。被测对象是 `useProjects`（真实现）
 * 与一个命令面桩 context，断言的是它发了哪条命令、入参是什么、把返回解析成了
 * 什么状态；不测内部实现细节，也不测 mock 自己。
 *
 * 覆盖：
 * - 纯函数：相对时间四档、环境徽标、运行→会话投影、活跃判据；
 * - 取数：项目列表 / 运行列表 / 单项目缺失 / agent 清单与就绪度（探测失败降级）；
 * - 编排：启动运行（网格预测透传 + 列表刷新）、启动失败不产生幽灵 id、
 *   目录选择取消不是错误、移除项目回执。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import {
  envBadge,
  isLiveRun,
  relativeTimeSpec,
  runAsSession,
  useProjects,
  type RunView,
} from '@/composables/useProjects'

// ==================== 命令面桩 ====================

type Handler = (args: any) => unknown

const execute = vi.fn()

/** 默认命令面路由（逐用例可覆盖单条） */
function defaultRoutes(): Record<string, Handler> {
  return {
    'project.list': () => ({ projects: [project('p-1', '支付重构')] }),
    'project.get': () => project('p-1', '支付重构'),
    'project.create': () => ({ project: project('p-2', '新项目'), created: true }),
    'project.open': () => project('p-1', '支付重构'),
    'project.rename': () => project('p-1', '改名后'),
    'project.remove': () => ({ removed: true, runsRemoved: 2 }),
    'project.pick-dir': () => ({ picked: true, path: '/srv/picked' }),
    'run.list': () => ({ runs: [run('r-1', 'running', true)] }),
    'run.start': () => ({ runId: 'r-new', name: '支付重构', configId: 'cfg-1' }),
    'agent.list-agents': () => ({
      agents: [
        { id: 'opencode', displayName: 'OpenCode', binary: 'opencode' },
        { id: 'pi', displayName: 'Pi', binary: 'pi' },
        { id: 'claude', displayName: 'Claude Code', binary: 'claude' },
      ],
    }),
    'agent.get-state': () => ({
      state: {
        clis: {
          opencode: { status: 'ok' },
          pi: { status: 'not-installed' },
          // claude 无条目 → unknown
        },
      },
    }),
    'session.close': () => ({ stopped: true }),
  }
}

let routes: Record<string, Handler>

function project(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    environment: 'linux',
    wslDistro: null,
    workingDir: '/srv/app',
    name,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    lastOpenedAt: null,
    activeRuns: 0,
    runCount: 0,
    lastActivityAt: null,
    lastAgentId: null,
    ...overrides,
  }
}

function run(id: string, status: string, active: boolean): RunView {
  return {
    id,
    projectId: 'p-1',
    configId: 'cfg-1',
    agentId: 'opencode',
    agentSessionId: 'ses_1',
    title: null,
    name: '支付重构',
    status,
    model: null,
    createdAt: '2026-10-29T00:00:00Z',
    startedAt: '2026-10-29T00:00:01Z',
    stoppedAt: null,
    updatedAt: '2026-10-29T00:00:09Z',
    active,
    truncated: false,
  }
}

const predictTerminalSize = vi.fn(async () => ({ cols: 140, rows: 36 }))
const openTerminal = vi.fn(async () => true)
const closeTerminal = vi.fn(async () => {})

function makeContext(): PluginContext {
  return {
    id: 'com.wasmnest.bedcode',
    i18n: { t: (key: string) => key, getI18n: () => ({ global: { t: (k: string) => k } }) },
    commands: { execute },
    session: {
      predictTerminalSize,
      openTerminal,
      closeTerminal,
      isTerminalOpen: () => false,
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    events: { on: () => ({ dispose: () => {} }), emit: () => {} },
  } as unknown as PluginContext
}

function domain() {
  return useProjects(makeContext())
}

const commandsTo = (id: string) => execute.mock.calls.filter((call) => call[0] === id)

beforeEach(() => {
  vi.clearAllMocks()
  routes = defaultRoutes()
  execute.mockImplementation(async (id: string, args: any) => {
    const handler = routes[id]
    if (!handler) throw new Error(`unexpected command: ${id}`)
    return handler(args)
  })
  predictTerminalSize.mockResolvedValue({ cols: 140, rows: 36 })
})

// ==================== 纯函数 ====================

describe('相对时间（纯函数）', () => {
  const NOW = Date.parse('2026-10-29T12:00:00Z')

  it('四档：刚刚 / 分钟 / 小时 / 天', () => {
    expect(relativeTimeSpec('2026-10-29T11:59:30Z', NOW)).toEqual({
      key: 'project.time.justNow',
      params: {},
    })
    expect(relativeTimeSpec('2026-10-29T11:55:00Z', NOW)).toEqual({
      key: 'project.time.minutesAgo',
      params: { n: 5 },
    })
    expect(relativeTimeSpec('2026-10-29T09:00:00Z', NOW)).toEqual({
      key: 'project.time.hoursAgo',
      params: { n: 3 },
    })
    expect(relativeTimeSpec('2026-10-27T12:00:00Z', NOW)).toEqual({
      key: 'project.time.daysAgo',
      params: { n: 2 },
    })
  })

  it('缺时间 / 不可解析 → null（界面显示「暂无活动」，不显示 NaN 分钟前）', () => {
    expect(relativeTimeSpec(null, NOW)).toBeNull()
    expect(relativeTimeSpec(undefined, NOW)).toBeNull()
    expect(relativeTimeSpec('not-a-date', NOW)).toBeNull()
    expect(relativeTimeSpec('', NOW)).toBeNull()
  })

  it('未来时间按 0 处理（时钟回拨不产出负数分钟）', () => {
    expect(relativeTimeSpec('2026-10-29T12:05:00Z', NOW)).toEqual({
      key: 'project.time.justNow',
      params: {},
    })
  })
})

describe('环境徽标与运行投影（纯函数）', () => {
  it('环境徽标：wsl2 / linux 原样，其余按 win（与会话页同口径）', () => {
    expect(envBadge('wsl2')).toBe('wsl2')
    expect(envBadge('linux')).toBe('linux')
    expect(envBadge('windows')).toBe('win')
    expect(envBadge(null)).toBe('win')
    expect(envBadge(undefined)).toBe('win')
  })

  it('运行 → 会话投影：id / name / status 与 camel+snake 双形态齐全', () => {
    const session = runAsSession(run('r-1', 'running', true))
    expect(session.id).toBe('r-1')
    expect(session.name).toBe('支付重构')
    expect(session.status).toBe('running')
    expect(session.configId).toBe('cfg-1')
    expect(session.config_id).toBe('cfg-1')
    expect(session.createdAt).toBe('2026-10-29T00:00:00Z')
    expect(session.startedAt).toBe('2026-10-29T00:00:01Z')
    expect(session.stoppedAt).toBeUndefined()
  })

  it('活跃判据：只有 stopped / error 是终态', () => {
    expect(isLiveRun('running')).toBe(true)
    expect(isLiveRun('starting')).toBe(true)
    expect(isLiveRun('waitingInput')).toBe(true)
    expect(isLiveRun('stopped')).toBe(false)
    expect(isLiveRun('error')).toBe(false)
  })
})

// ==================== 取数 ====================

describe('取数：项目 / 运行 / agent', () => {
  it('项目列表：解析 {projects}；缺字段按空列表（不把空响应当崩溃）', async () => {
    const d = domain()
    await d.loadProjects()
    expect(d.projects.value.map((p) => p.id)).toEqual(['p-1'])

    routes['project.list'] = () => ({})
    await d.loadProjects()
    expect(d.projects.value).toEqual([])
  })

  it('运行列表：按 projectId 取；返回空数组时不残留上一次结果', async () => {
    const d = domain()
    await d.loadRuns('p-1')
    expect(commandsTo('run.list')[0][1]).toEqual({ projectId: 'p-1' })
    expect(d.runs.value).toHaveLength(1)

    routes['run.list'] = () => ({ runs: [] })
    await d.loadRuns('p-1')
    expect(d.runs.value).toEqual([])
  })

  it('单项目：后端返回 null → project 置空（工作台据此显示「已不存在」）', async () => {
    const d = domain()
    await d.loadProject('p-1')
    expect(d.project.value?.id).toBe('p-1')

    routes['project.get'] = () => null
    const missing = await d.loadProject('gone')
    expect(missing).toBeNull()
    expect(d.project.value).toBeNull()
  })

  it('agent 清单：注册表 + 探测状态 → ready / missing / unknown 三态', async () => {
    const d = domain()
    await d.loadAgents()
    expect(d.agents.value).toEqual([
      { id: 'opencode', displayName: 'OpenCode', binary: 'opencode', readiness: 'ready' },
      { id: 'pi', displayName: 'Pi', binary: 'pi', readiness: 'missing' },
      { id: 'claude', displayName: 'Claude Code', binary: 'claude', readiness: 'unknown' },
    ])
  })

  it('探测取不到时不把整张清单打成空：全部按 unknown（允许尝试启动）', async () => {
    routes['agent.get-state'] = () => {
      throw new Error('detection not ready')
    }
    const d = domain()
    await d.loadAgents()
    expect(d.agents.value.map((a) => a.readiness)).toEqual(['unknown', 'unknown', 'unknown'])
  })
})

// ==================== 编排 ====================

describe('编排：启动 / 停止 / 目录选择 / 移除', () => {
  it('启动运行：透传项目 + agent + 预测网格，并刷新运行列表与项目统计', async () => {
    const d = domain()
    const created = await d.startRun('p-1', 'opencode')

    expect(created).toEqual({ runId: 'r-new', name: '支付重构' })
    expect(commandsTo('run.start')[0][1]).toEqual({
      projectId: 'p-1',
      agentId: 'opencode',
      cols: 140,
      rows: 36,
    })
    // 启动后必须重取运行列表（新运行要立刻出现在列表里）
    expect(commandsTo('run.list')).toHaveLength(1)
    expect(commandsTo('project.get')).toHaveLength(1)
  })

  it('网格预测不可用（null）时按缺省启动，不阻断', async () => {
    predictTerminalSize.mockResolvedValueOnce(null)
    const d = domain()
    await d.startRun('p-1', 'pi')
    expect(commandsTo('run.start')[0][1]).toEqual({
      projectId: 'p-1',
      agentId: 'pi',
      cols: undefined,
      rows: undefined,
    })
  })

  it('后端没给 runId → 抛错（不返回空 id 让界面去开一个空终端）', async () => {
    routes['run.start'] = () => ({ name: 'x' })
    const d = domain()
    await expect(d.startRun('p-1', 'opencode')).rejects.toThrow('run.start returned no runId')
  })

  it('停止运行：走 session.close（运行是会话投影）+ 关终端窗 + 刷新列表', async () => {
    const d = domain()
    await d.stopRun('r-1', 'p-1')
    expect(commandsTo('session.close')[0][1]).toEqual({ sessionId: 'r-1' })
    expect(closeTerminal).toHaveBeenCalledWith('r-1')
    expect(commandsTo('run.list')).toHaveLength(1)
  })

  it('目录选择：picked=true 返回路径，取消（picked=false）返回 null', async () => {
    const d = domain()
    expect(await d.pickDirectory()).toBe('/srv/picked')

    routes['project.pick-dir'] = () => ({ picked: false, path: '' })
    expect(await d.pickDirectory()).toBeNull()

    routes['project.pick-dir'] = () => ({ picked: true, path: '   ' })
    expect(await d.pickDirectory()).toBeNull()
  })

  it('建项目：created=false 时把既有项目回给界面（被带到已有项目）', async () => {
    routes['project.create'] = () => ({ project: project('p-9', '既有'), created: false })
    const d = domain()
    const result = await d.createProject({ environment: 'linux', workingDir: '/srv/app' })
    expect(result.created).toBe(false)
    expect(result.project.id).toBe('p-9')
    expect(commandsTo('project.create')[0][1]).toEqual({
      environment: 'linux',
      workingDir: '/srv/app',
      name: undefined,
      wslDistro: undefined,
    })
    // 建完要刷列表（新建或命中已有都会改变排序）
    expect(commandsTo('project.list')).toHaveLength(1)
  })

  it('移除项目：回执含级联删除的运行数', async () => {
    const d = domain()
    expect(await d.removeProject('p-1')).toEqual({ removed: true, runsRemoved: 2 })
  })

  it('活跃运行数来自运行列表的 active 位（与项目卡同一判据）', async () => {
    routes['run.list'] = () => ({
      runs: [run('r-1', 'running', true), run('r-2', 'stopped', false), run('r-3', 'error', false)],
    })
    const d = domain()
    await d.loadRuns('p-1')
    expect(d.activeRunCount.value).toBe(1)
  })
})
