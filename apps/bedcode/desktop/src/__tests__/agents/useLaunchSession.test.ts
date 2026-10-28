/**
 * useLaunchSession 单测（启动会话 glue：配置复用/创建 → session.create → 开终端窗）
 *
 * 覆盖：表单预填（formDefaults + binary 兜底）、必填校验（fail-visible 不发命令）、
 * 配置复用命中（不再 upsert）、未命中新建（upsert 载荷逐字段）、启动失败内联错误。
 * AgentDescriptor.binary 的解析与回退一并在此覆盖（parseAgentList / fallbackAgents）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useLaunchSession } from '../../agents/composables/useLaunchSession'
import { fallbackAgents, parseAgentList } from '../../agents/composables/useAgentCatalog'

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

const AGENT = {
  id: 'pi',
  displayName: 'Pi',
  binary: 'pi',
  capabilities: { install: true, provider: true, skills: true, usage: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  execute.mockResolvedValue(null)
  storageGet.mockResolvedValue(undefined)
  predictTerminalSize.mockResolvedValue({ cols: 120, rows: 40 })
  openTerminal.mockResolvedValue(undefined)
})

describe('useLaunchSession 弹窗预填', () => {
  it('show() 读 formDefaults：环境/目录预填，command 缺省 = binary', async () => {
    storageGet.mockResolvedValue({ environment: 'wsl2', workingDir: '~/proj' })
    const s = useLaunchSession(makeContext())
    await s.show(AGENT)
    expect(s.open.value).toBe(true)
    expect(s.form.environment).toBe('wsl2')
    expect(s.form.workingDir).toBe('~/proj')
    expect(s.form.command).toBe('pi')
  })

  it('show()：formDefaults 非法环境回退 linux，读取失败不阻断', async () => {
    storageGet.mockRejectedValue(new Error('storage down'))
    const s = useLaunchSession(makeContext())
    await s.show(AGENT)
    expect(s.form.environment).toBe('linux')
    expect(s.form.workingDir).toBe('')
    expect(s.form.command).toBe('pi')
  })
})

describe('useLaunchSession submit', () => {
  it('必填缺失：内联错误，不发任何命令', async () => {
    const s = useLaunchSession(makeContext())
    await s.show(AGENT)
    s.form.workingDir = ''
    const out = await s.submit()
    expect(out).toBeNull()
    expect(s.error.value).toBe('hub.launch.required')
    expect(execute).not.toHaveBeenCalled()
  })

  it('配置复用：同 (env, dir, command) 命中 → 不 upsert，直接 create + 开终端', async () => {
    execute.mockImplementation(async (cmd: string) => {
      if (cmd === 'session.config.list') {
        return [{ id: 'cfg-1', environment: 'linux', workingDir: '/w', command: 'pi' }]
      }
      if (cmd === 'session.create') return { sessionId: 's-1' }
      if (cmd === 'session.get') return { name: 'Pi (2)' }
      return null
    })
    const s = useLaunchSession(makeContext())
    await s.show(AGENT)
    s.form.workingDir = '/w'
    s.form.command = 'pi'
    const out = await s.submit()
    expect(out).toEqual({ sessionId: 's-1' })
    expect(execute).not.toHaveBeenCalledWith('session.config.upsert', expect.anything())
    expect(execute).toHaveBeenCalledWith('session.create', {
      configId: 'cfg-1',
      cols: 120,
      rows: 40,
      start: true,
    })
    expect(openTerminal).toHaveBeenCalledWith({ id: 's-1', name: 'Pi (2)' })
    expect(s.open.value).toBe(false)
  })

  it('配置未命中：upsert 新建（载荷逐字段）→ create 用新 configId', async () => {
    execute.mockImplementation(async (cmd: string) => {
      if (cmd === 'session.config.list') return []
      if (cmd === 'session.config.upsert') return { id: 'cfg-new' }
      if (cmd === 'session.create') return { sessionId: 's-2' }
      if (cmd === 'session.get') return null
      return null
    })
    const s = useLaunchSession(makeContext())
    await s.show(AGENT)
    s.form.workingDir = '/w2'
    s.form.command = 'pi'
    await s.submit()
    expect(execute).toHaveBeenCalledWith('session.config.upsert', {
      name: 'Pi',
      environment: 'linux',
      workingDir: '/w2',
      command: 'pi',
      autoStart: false,
    })
    expect(execute).toHaveBeenCalledWith(
      'session.create',
      expect.objectContaining({ configId: 'cfg-new' }),
    )
  })

  it('启动失败：内联错误 + 返回 null，弹窗保持打开', async () => {
    execute.mockImplementation(async (cmd: string) => {
      if (cmd === 'session.config.list') return []
      throw new Error('spawn failed')
    })
    const s = useLaunchSession(makeContext())
    await s.show(AGENT)
    s.form.workingDir = '/w'
    const out = await s.submit()
    expect(out).toBeNull()
    expect(s.error.value).toBe('hub.launch.failed')
    expect(s.open.value).toBe(true)
    expect(openTerminal).not.toHaveBeenCalled()
  })
})

describe('AgentDescriptor.binary（会话 command 取值来源）', () => {
  it('parseAgentList：binary 缺省回退 id', () => {
    const parsed = parseAgentList({
      agents: [
        { id: 'pi', displayName: 'Pi', binary: 'pi-x', capabilities: { install: true, provider: true, skills: true, usage: true } },
        { id: 'claude', displayName: 'Claude Code', capabilities: { install: true, provider: true, skills: true, usage: true } },
      ],
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.[0].binary).toBe('pi-x')
    expect(parsed?.[1].binary).toBe('claude')
  })

  it('fallbackAgents：binary = id（后端清单不可用时的启动兜底）', () => {
    for (const a of fallbackAgents()) {
      expect(a.binary).toBe(a.id)
    }
  })
})
