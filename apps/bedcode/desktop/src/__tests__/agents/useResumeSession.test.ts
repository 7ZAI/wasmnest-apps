/**
 * useResumeSession 单测（日志恢复 glue：guest 生成 resume 命令 → 会话配置复用/创建 →
 * session.create → 开终端窗）
 *
 * 覆盖：工作目录取日志项目、环境默认值、恢复命令生成（成功 / 缺会话 ID /
 * guest 拒绝）、必填校验（fail-visible 不发命令）、配置复用命中、启动失败内联错误。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useResumeSession } from '../../agents/composables/useResumeSession'
import type { UsageSessionRow } from '../../agents/types'

const execute = vi.fn()
const storageGet = vi.fn()
const predictTerminalSize = vi.fn()
const openTerminal = vi.fn()

function makeContext(): PluginContext {
  return {
    commands: { execute },
    storage: { get: storageGet, set: vi.fn(), delete: vi.fn() },
    session: { predictTerminalSize, openTerminal },
    i18n: { t: (k: string) => k },
  } as unknown as PluginContext
}

function sessionRow(over: Partial<UsageSessionRow> = {}): UsageSessionRow {
  return {
    id: 7,
    adapter: 'claude',
    cli_session_id: 's-1',
    project: '/work/proj',
    title: '修复登录',
    started_at: 1,
    ended_at: 2,
    duration_ms: 1000,
    model: 'm',
    tokens_in: 1,
    tokens_out: 2,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    tokens_reasoning: 0,
    cost_total: null,
    ...over,
  }
}

const RESUME_INFO = {
  command: 'claude --resume s-1',
  binary: 'claude',
  displayName: 'Claude Code',
}

beforeEach(() => {
  vi.clearAllMocks()
  execute.mockResolvedValue(null)
  storageGet.mockResolvedValue(undefined)
  predictTerminalSize.mockResolvedValue({ cols: 120, rows: 40 })
  openTerminal.mockResolvedValue(undefined)
})

describe('useResumeSession show', () => {
  it('工作目录取日志项目；环境取 formDefaults；恢复命令由 guest 生成', async () => {
    storageGet.mockResolvedValue({ environment: 'wsl2', workingDir: '/ignored' })
    execute.mockImplementation(async (cmd: string) => {
      if (cmd === 'agent.get-resume-command') return RESUME_INFO
      return null
    })
    const s = useResumeSession(makeContext())
    await s.show(sessionRow())

    expect(s.open.value).toBe(true)
    expect(s.form.workingDir).toBe('/work/proj')
    expect(s.form.environment).toBe('wsl2')
    expect(s.form.command).toBe('claude --resume s-1')
    expect(s.agentName.value).toBe('Claude Code')
    expect(execute).toHaveBeenCalledWith('agent.get-resume-command', {
      adapter: 'claude',
      cliSessionId: 's-1',
    })
    expect(s.error.value).toBe('')
  })

  it('project 缺失时工作目录留空（不用启动默认值顶替，避免恢复进错项目）', async () => {
    storageGet.mockResolvedValue({ environment: 'linux', workingDir: '/last-used' })
    execute.mockResolvedValue(RESUME_INFO)
    const s = useResumeSession(makeContext())
    await s.show(sessionRow({ project: null }))
    expect(s.form.workingDir).toBe('')
  })

  it('缺 CLI 会话 ID：不请求恢复命令，弹窗内联报错（fail-visible）', async () => {
    const s = useResumeSession(makeContext())
    await s.show(sessionRow({ cli_session_id: '' }))
    expect(s.open.value).toBe(true)
    expect(s.form.command).toBe('')
    expect(s.error.value).toBe('hub.lg.resume.unsupported')
    expect(execute).not.toHaveBeenCalledWith('agent.get-resume-command', expect.anything())
  })

  it('guest 拒绝（未知 agent / 不安全 ID）：命令留空并报错，确认由必填校验兜住', async () => {
    execute.mockRejectedValue(new Error('unsafe cliSessionId'))
    const s = useResumeSession(makeContext())
    await s.show(sessionRow())
    expect(s.open.value).toBe(true)
    expect(s.loading.value).toBe(false)
    expect(s.form.command).toBe('')
    expect(s.error.value).toBe('hub.lg.resume.unsupported')
    const out = await s.submit()
    expect(out).toBeNull()
    expect(s.error.value).toBe('hub.lg.resume.required')
  })
})

describe('useResumeSession submit', () => {
  it('必填缺失：内联错误，不发任何会话命令', async () => {
    execute.mockResolvedValue(RESUME_INFO)
    const s = useResumeSession(makeContext())
    await s.show(sessionRow())
    s.form.workingDir = ''
    const out = await s.submit()
    expect(out).toBeNull()
    expect(s.error.value).toBe('hub.lg.resume.required')
    expect(execute).not.toHaveBeenCalledWith('session.config.list', expect.anything())
  })

  it('配置复用：同 (env, dir, command) 命中 → 不 upsert，直接 create + 开终端', async () => {
    execute.mockImplementation(async (cmd: string) => {
      if (cmd === 'agent.get-resume-command') return RESUME_INFO
      if (cmd === 'session.config.list') {
        return [
          {
            id: 'cfg-1',
            environment: 'linux',
            workingDir: '/work/proj',
            command: 'claude --resume s-1',
          },
        ]
      }
      if (cmd === 'session.create') return { sessionId: 's-9' }
      if (cmd === 'session.get') return { name: '恢复 · 修复登录' }
      return null
    })
    const s = useResumeSession(makeContext())
    await s.show(sessionRow())
    const out = await s.submit()
    expect(out).toEqual({ sessionId: 's-9' })
    expect(execute).not.toHaveBeenCalledWith('session.config.upsert', expect.anything())
    expect(execute).toHaveBeenCalledWith('session.create', {
      configId: 'cfg-1',
      cols: 120,
      rows: 40,
      start: true,
    })
    expect(openTerminal).toHaveBeenCalledWith({ id: 's-9', name: '恢复 · 修复登录' })
    expect(s.open.value).toBe(false)
  })

  it('配置未命中：upsert 新建（载荷逐字段）→ create 用新 configId', async () => {
    execute.mockImplementation(async (cmd: string) => {
      if (cmd === 'agent.get-resume-command') return RESUME_INFO
      if (cmd === 'session.config.list') return []
      if (cmd === 'session.config.upsert') return { id: 'cfg-new' }
      if (cmd === 'session.create') return { sessionId: 's-10' }
      return null
    })
    const s = useResumeSession(makeContext())
    await s.show(sessionRow())
    await s.submit()
    expect(execute).toHaveBeenCalledWith('session.config.upsert', {
      name: 'Claude Code',
      environment: 'linux',
      workingDir: '/work/proj',
      command: 'claude --resume s-1',
      autoStart: false,
    })
    expect(execute).toHaveBeenCalledWith(
      'session.create',
      expect.objectContaining({ configId: 'cfg-new' }),
    )
  })

  it('启动失败：内联错误 + 返回 null，弹窗保持打开', async () => {
    execute.mockImplementation(async (cmd: string) => {
      if (cmd === 'agent.get-resume-command') return RESUME_INFO
      if (cmd === 'session.config.list') return []
      throw new Error('spawn failed')
    })
    const s = useResumeSession(makeContext())
    await s.show(sessionRow())
    const out = await s.submit()
    expect(out).toBeNull()
    expect(s.error.value).toBe('hub.lg.resume.failed')
    expect(s.open.value).toBe(true)
    expect(openTerminal).not.toHaveBeenCalled()
  })
})
