/**
 * 项目文件树数据层契约（project.file-tree / project.file-content）
 *
 * 只验外部行为：发哪条命令、入参形状、返回被解析成什么状态、错误是否显性。
 * 树的展开态是视图态，但「懒加载一次 / 失败回退展开 / 全部收起」属于数据层
 * 编排，单测在这里锁住，避免只靠整页挂载用例兜底。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import {
  PROJECT_FILE_EXCLUDES,
  toProjectFileNode,
  useProjectFiles,
} from '@/composables/useProjectFiles'

type Handler = (args: any) => unknown

const execute = vi.fn()
let routes: Record<string, Handler>

function defaultRoutes(): Record<string, Handler> {
  return {
    'project.file-tree': () => ({
      children: [
        { name: 'src', nodeType: 'folder', path: 'src' },
        { name: 'README.md', nodeType: 'file', path: 'README.md' },
      ],
    }),
    'project.file-content': () => ({ content: 'hello', fileName: 'README.md' }),
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

describe('节点转换（纯函数）', () => {
  it('nodeType → type、反斜杠归一、文件夹默认收起、children 递归转换', () => {
    const node = toProjectFileNode({
      name: 'src',
      nodeType: 'folder',
      path: 'src\\nested',
      children: [{ name: 'main.ts', nodeType: 'file', path: 'src\\nested\\main.ts' }],
    })
    expect(node).toMatchObject({
      name: 'src',
      type: 'folder',
      path: 'src/nested',
      expanded: false,
    })
    expect(node.children?.[0]).toMatchObject({
      name: 'main.ts',
      type: 'file',
      path: 'src/nested/main.ts',
    })
    expect(node.children?.[0].expanded).toBeUndefined()
  })
})

describe('useProjectFiles', () => {
  it('读根目录：带项目 id 与默认排除项；成功后缓存，force 才重发', async () => {
    const domain = useProjectFiles(makeContext(), ref('p-1'))

    await domain.loadRoot()
    expect(commandsTo('project.file-tree')[0][1]).toEqual({
      projectId: 'p-1',
      excludeDirs: PROJECT_FILE_EXCLUDES,
    })
    expect(domain.tree.value.map((node) => node.name)).toEqual(['src', 'README.md'])
    expect(domain.isLoaded.value).toBe(true)

    // 已加载：普通调用不重发（页签来回切不重复取数）
    await domain.loadRoot()
    expect(commandsTo('project.file-tree')).toHaveLength(1)

    await domain.loadRoot(true)
    expect(commandsTo('project.file-tree')).toHaveLength(2)
  })

  it('展开文件夹懒加载一次；收起再展开不重发；collapseAll 递归收起', async () => {
    routes['project.file-tree'] = (args: any) =>
      args.dirPath === 'src'
        ? { children: [{ name: 'main.ts', nodeType: 'file', path: 'src/main.ts' }] }
        : { children: [{ name: 'src', nodeType: 'folder', path: 'src' }] }

    const domain = useProjectFiles(makeContext(), ref('p-1'))
    await domain.loadRoot()
    const folder = domain.tree.value[0]

    await domain.toggleNode(folder)
    expect(folder.expanded).toBe(true)
    expect(commandsTo('project.file-tree')[1][1]).toEqual({
      projectId: 'p-1',
      dirPath: 'src',
      excludeDirs: PROJECT_FILE_EXCLUDES,
    })
    expect(folder.children?.[0].name).toBe('main.ts')

    // 收起再展开：children 已缓存，不再请求
    await domain.toggleNode(folder)
    expect(folder.expanded).toBe(false)
    await domain.toggleNode(folder)
    expect(folder.expanded).toBe(true)
    expect(commandsTo('project.file-tree')).toHaveLength(2)

    domain.collapseAll()
    expect(folder.expanded).toBe(false)
    // 缓存保留：收起不是清空
    expect(folder.children).toHaveLength(1)
  })

  it('子目录读取失败：回退收起并上抛（不静默当空目录）', async () => {
    routes['project.file-tree'] = (args: any) => {
      if (args.dirPath === 'src') throw new Error('boom')
      return { children: [{ name: 'src', nodeType: 'folder', path: 'src' }] }
    }

    const domain = useProjectFiles(makeContext(), ref('p-1'))
    await domain.loadRoot()
    const folder = domain.tree.value[0]

    await expect(domain.toggleNode(folder)).rejects.toThrow('boom')
    expect(folder.expanded).toBe(false)
    expect(folder.children).toBeUndefined()
  })

  it('根目录读取失败：error 显性、树清空、isLoaded 保持 false（重试还能再取）', async () => {
    routes['project.file-tree'] = () => {
      throw new Error('denied')
    }

    const domain = useProjectFiles(makeContext(), ref('p-1'))
    await domain.loadRoot()

    expect(domain.error.value).toBeInstanceOf(Error)
    expect(domain.tree.value).toEqual([])
    expect(domain.isLoaded.value).toBe(false)
  })

  it('读文件：返回内容与文件名；响应缺 content 显性报错', async () => {
    const domain = useProjectFiles(makeContext(), ref('p-1'))

    const file = await domain.readFile('README.md')
    expect(commandsTo('project.file-content')[0][1]).toEqual({
      projectId: 'p-1',
      filePath: 'README.md',
    })
    expect(file).toEqual({ content: 'hello', fileName: 'README.md' })

    routes['project.file-content'] = () => ({})
    await expect(domain.readFile('ghost.txt')).rejects.toThrow(
      'project.file-content returned no content',
    )
  })

  it('reset：切项目时清空树与加载状态', async () => {
    const domain = useProjectFiles(makeContext(), ref('p-1'))
    await domain.loadRoot()
    expect(domain.tree.value).toHaveLength(2)

    domain.reset()
    expect(domain.tree.value).toEqual([])
    expect(domain.isLoaded.value).toBe(false)
    expect(domain.error.value).toBeNull()
  })

  it('加载中 force 刷新不被静默丢弃：新响应生效，旧响应被丢弃', async () => {
    let releaseFirst: ((value: unknown) => void) | null = null
    let calls = 0
    routes['project.file-tree'] = () => {
      calls += 1
      if (calls === 1) {
        return new Promise((resolve) => {
          releaseFirst = resolve
        })
      }
      return { children: [{ name: 'fresh', nodeType: 'file', path: 'fresh' }] }
    }

    const domain = useProjectFiles(makeContext(), ref('p-1'))
    const first = domain.loadRoot()
    await vi.waitFor(() => expect(commandsTo('project.file-tree')).toHaveLength(1))

    const second = domain.loadRoot(true)
    await vi.waitFor(() => expect(commandsTo('project.file-tree')).toHaveLength(2))

    releaseFirst!({ children: [{ name: 'stale', nodeType: 'file', path: 'stale' }] })
    await Promise.all([first, second])

    expect(domain.tree.value.map((node) => node.name)).toEqual(['fresh'])
    expect(domain.isLoading.value).toBe(false)
  })
})
