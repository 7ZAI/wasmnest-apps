/**
 * 项目 Git 数据层契约（project.git-log）
 *
 * 只验外部行为：发哪条命令、入参形状、返回被解析成什么状态、错误是否显性、
 * 非仓库是否被当成正常空态而不是错误。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { PROJECT_GIT_LIMIT, toGitCommit, useProjectGit } from '@/composables/useProjectGit'

type Handler = (args: any) => unknown

const execute = vi.fn()
let routes: Record<string, Handler>

function commitRecord(hash: string, overrides: Record<string, unknown> = {}) {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: [],
    author: 'Alice',
    email: 'alice@example.com',
    date: '2026-10-29T00:00:00+08:00',
    refs: [],
    subject: `subject ${hash}`,
    ...overrides,
  }
}

function defaultRoutes(): Record<string, Handler> {
  return {
    'project.git-log': () => ({
      isGitRepo: true,
      currentBranch: 'dev',
      truncated: false,
      commits: [
        commitRecord('aaaaaaa1111', { refs: ['HEAD -> dev'], parents: ['bbbbbbb2222'] }),
        commitRecord('bbbbbbb2222', { refs: ['tag: v0.1.0'] }),
      ],
    }),
  }
}

function makeContext(): PluginContext {
  return {
    id: 'com.wasmnest.bedcode',
    i18n: { t: (key: string) => key, getI18n: () => ({ global: { t: (k: string) => k } }) },
    commands: { execute },
    session: {},
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    events: { on: () => ({ dispose: () => {} }), emit: () => {} },
  } as unknown as PluginContext
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
})

describe('toGitCommit（纯函数）', () => {
  it('解析 wire 字段；缺 hash 返回 null；字段缺失按空值兜底', () => {
    expect(
      toGitCommit({
        hash: 'abcdef123456',
        shortHash: 'abcdef1',
        parents: ['p1', 2, 'p2'],
        author: 'Alice',
        email: 'a@e',
        date: '2026-10-29T00:00:00Z',
        refs: ['HEAD -> dev', null],
        subject: 'fix',
      }),
    ).toEqual({
      hash: 'abcdef123456',
      shortHash: 'abcdef1',
      parents: ['p1', 'p2'],
      author: 'Alice',
      email: 'a@e',
      date: '2026-10-29T00:00:00Z',
      refs: ['HEAD -> dev'],
      subject: 'fix',
    })

    expect(toGitCommit(null)).toBeNull()
    expect(toGitCommit({})).toBeNull()

    const minimal = toGitCommit({ hash: 'abcdef123456' })
    expect(minimal).toMatchObject({
      shortHash: 'abcdef1',
      parents: [],
      refs: [],
      author: '',
      date: '',
      subject: '',
    })
  })
})

describe('useProjectGit', () => {
  it('读取提交图：带项目 id 与上限；非仓库标记保留', async () => {
    const domain = useProjectGit(makeContext(), ref('p-1'))
    await domain.load()

    expect(commandsTo('project.git-log')[0][1]).toEqual({
      projectId: 'p-1',
      limit: PROJECT_GIT_LIMIT,
    })
    expect(domain.isGitRepo.value).toBe(true)
    expect(domain.currentBranch.value).toBe('dev')
    expect(domain.commits.value.map((commit) => commit.hash)).toEqual([
      'aaaaaaa1111',
      'bbbbbbb2222',
    ])
    expect(domain.commits.value[0].refs).toEqual(['HEAD -> dev'])
    expect(domain.isLoaded.value).toBe(true)
  })

  it('非 git 仓库：isGitRepo=false、空历史，不是错误', async () => {
    routes['project.git-log'] = () => ({
      isGitRepo: false,
      currentBranch: null,
      commits: [],
      truncated: false,
    })
    const domain = useProjectGit(makeContext(), ref('p-1'))
    await domain.load()

    expect(domain.isGitRepo.value).toBe(false)
    expect(domain.currentBranch.value).toBe('')
    expect(domain.commits.value).toEqual([])
    expect(domain.error.value).toBeNull()
    expect(domain.isLoaded.value).toBe(true)
  })

  it('已加载：普通调用不重发；force 才重新取数；truncated 保留', async () => {
    routes['project.git-log'] = () => ({
      isGitRepo: true,
      currentBranch: 'dev',
      truncated: true,
      commits: [commitRecord('aaaaaaa1111')],
    })
    const domain = useProjectGit(makeContext(), ref('p-1'))
    await domain.load()
    expect(domain.truncated.value).toBe(true)

    await domain.load()
    expect(commandsTo('project.git-log')).toHaveLength(1)

    await domain.load(true)
    expect(commandsTo('project.git-log')).toHaveLength(2)
  })

  it('读取失败：显性上抛、清空历史、不标记已加载', async () => {
    routes['project.git-log'] = () => {
      throw new Error('git missing')
    }
    const domain = useProjectGit(makeContext(), ref('p-1'))
    await domain.load()

    expect(domain.error.value).toBeInstanceOf(Error)
    expect(domain.commits.value).toEqual([])
    expect(domain.isLoaded.value).toBe(false)
    expect(domain.isLoading.value).toBe(false)
  })

  it('reset：清空历史 / 分支 / 截断标记与错误', async () => {
    const domain = useProjectGit(makeContext(), ref('p-1'))
    await domain.load()
    expect(domain.commits.value.length).toBeGreaterThan(0)

    domain.reset()
    expect(domain.commits.value).toEqual([])
    expect(domain.currentBranch.value).toBe('')
    expect(domain.truncated.value).toBe(false)
    expect(domain.isLoaded.value).toBe(false)
    expect(domain.isGitRepo.value).toBe(true)
  })
})
