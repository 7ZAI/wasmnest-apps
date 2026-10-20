/**
 * BedCode 多任务卡片只读预览面单测（apps 仓 spec 2026-10-20 · Testing Decisions Seam 4）
 *
 * 覆盖外部可观察行为：
 * ① 正常数据渲染（当前 / 最近会话、运行状态、工作区路径、并行会话行）；
 * ② 无会话 / 命令失败 → 诚实空态且不抛；
 * ③ 工作区配置读失败不拖垮整张卡（会话摘要仍显示）；
 * ④ 只读无副作用（无 interval / 全局 listener / 写存储 / 会话启停）；
 * ⑤ 卸载清理（晚到数据不写已卸载预览面；mountPreview 卸载后容器清空）；
 * ⑥ 预览 DOM 无可聚焦控件（ready / 空态 / 骨架）；
 * ⑦ `mountPreview` 不等待数据即返回句柄（首帧先骨架）；
 * ⑧ `entry.ts` 源码导出 `mountPreview` 且契约关键字段在场（L5 drift 锁的 app 侧前提）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// entry.ts 的导入图会带出 appContext → useSessionWindows 的模块级窗口监听初始化；
// 测试环境没有 Tauri，给 `getCurrentWindow` 一个无副作用桩（否则未处理 rejection）。
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onMoved: async () => () => {},
    onResized: async () => () => {},
  }),
  PhysicalPosition: class {},
}))

import i18n from '../i18n'
import PreviewCard from '../preview/PreviewCard.vue'
import { mountPreview, type AppPreviewEnv } from '../entry'
// 源码扫描用：Vite `?raw` 读原文（避免引入 node fs）
import entrySource from '../entry.ts?raw'
import previewCardSource from '../preview/PreviewCard.vue?raw'

/** 可聚焦控件选择器（spec Seam 4 逐字） */
const FOCUSABLE_SELECTOR =
  'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const SESSIONS = [
  { id: 'sess-run-2', configId: 'cfg-2', name: '后端服务', status: 'running' },
  { id: 'sess-run-1', configId: 'cfg-1', name: '前端开发', status: 'running' },
  { id: 'sess-wait', configId: 'cfg-2', name: '等待输入会话', status: 'waitingInput' },
  { id: 'sess-old', configId: 'cfg-1', name: '旧会话', status: 'stopped' },
]

const CONFIGS = [
  { id: 'cfg-1', name: '默认配置', workingDir: '/workspace/web' },
  { id: 'cfg-2', name: '服务配置', workingDir: '/workspace/api' },
]

type ListHandler = () => Promise<unknown>

interface EnvOptions {
  sessions?: unknown[] | (() => Promise<unknown>)
  configs?: unknown[] | (() => Promise<unknown>)
  lastRoute?: string
  locale?: string
  theme?: string
}

interface EnvHarness {
  env: AppPreviewEnv
  calls: { command: string; args: unknown[] }[]
}

/** 构造只读预览环境（与宿主注入面同形：无 invoke / 无写存储 / 无事件出口） */
function makeEnv(options: EnvOptions = {}): EnvHarness {
  const calls: { command: string; args: unknown[] }[] = []

  const resolveSessionList: ListHandler = async () => {
    if (typeof options.sessions === 'function') return options.sessions()
    return { sessions: options.sessions ?? SESSIONS }
  }
  const resolveConfigList: ListHandler = async () => {
    if (typeof options.configs === 'function') return options.configs()
    return options.configs ?? CONFIGS
  }

  const env: AppPreviewEnv = {
    appId: 'com.wasmnest.terminal-session',
    lastRoute: options.lastRoute,
    locale: options.locale ?? 'zh-CN',
    theme: options.theme ?? 'light',
    platform: 'desktop',
    appStorageGet: async <T = unknown,>(): Promise<T | undefined> => undefined as T,
    appInvoke: async <T = unknown,>(command: string, ...args: unknown[]): Promise<T> => {
      calls.push({ command, args })
      if (command === 'session.list') return (await resolveSessionList()) as T
      if (command === 'session.config.list') return (await resolveConfigList()) as T
      throw new Error(`预览不得调用该命令: ${command}`)
    },
  }

  return { env, calls }
}

async function mountCard(env: AppPreviewEnv) {
  const wrapper = mount(PreviewCard, {
    props: { env },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return wrapper
}

function expectNoFocusable(root: ParentNode): void {
  expect(root.querySelectorAll(FOCUSABLE_SELECTOR)).toHaveLength(0)
}

beforeEach(() => {
  i18n.global.locale.value = 'zh-CN'
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('PreviewCard 正常数据', () => {
  it('渲染当前会话、状态、工作区路径与并行会话行', async () => {
    const { env } = makeEnv()
    const wrapper = await mountCard(env)

    expect(wrapper.attributes('data-state')).toBe('ready')
    const text = wrapper.text()
    // 当前会话 = 第一条运行中（会话中心按最近活动排序返回）
    expect(text).toContain('后端服务')
    expect(text).toContain('运行中')
    expect(text).toContain('3 个运行中')
    expect(text).toContain('工作区')
    expect(text).toContain('/workspace/api')
    // 缩略摘要最多 3 行
    expect(wrapper.findAll('.bc-preview__row')).toHaveLength(3)
    expect(text).toContain('前端开发')
    expect(text).toContain('等待输入')

    wrapper.unmount()
  })

  it('lastRoute 点名会话 id（终端窗口深链）时优先展示该会话', async () => {
    const { env } = makeEnv({ lastRoute: '/terminal-window/sess-wait' })
    const wrapper = await mountCard(env)

    expect(wrapper.text()).toContain('等待输入会话')
    // 当前会话的工作区来自它自己的 config
    expect(wrapper.text()).toContain('/workspace/api')
    expect(wrapper.text()).toContain('上次停留：/terminal-window/sess-wait')

    wrapper.unmount()
  })

  it('无会话 → 诚实空态（不编造运行中内容）', async () => {
    const { env } = makeEnv({ sessions: [] })
    const wrapper = await mountCard(env)

    expect(wrapper.attributes('data-state')).toBe('empty')
    expect(wrapper.text()).toContain('还没有终端会话')
    expect(wrapper.text()).toContain('在会话中心启动一个会话')
    expect(wrapper.findAll('.bc-preview__row')).toHaveLength(0)

    wrapper.unmount()
  })

  it('工作区配置读失败 → 会话摘要仍显示（附加信息不拖垮整张卡）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { env } = makeEnv({
      configs: async () => {
        throw new Error('config denied')
      },
    })
    const wrapper = await mountCard(env)

    expect(wrapper.attributes('data-state')).toBe('ready')
    expect(wrapper.text()).toContain('后端服务')
    expect(wrapper.text()).not.toContain('工作区')
    expect(warn).toHaveBeenCalled()

    wrapper.unmount()
  })
})

describe('PreviewCard 诚实失败', () => {
  it('会话命令失败 → 「预览暂不可用」，不抛错、不弹窗', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { env } = makeEnv({
      sessions: async () => {
        throw new Error('boom')
      },
    })
    const wrapper = await mountCard(env)

    expect(wrapper.attributes('data-state')).toBe('unavailable')
    expect(wrapper.text()).toContain('预览暂不可用')
    expect(warn).toHaveBeenCalled()

    wrapper.unmount()
  })
})

describe('PreviewCard 只读无副作用', () => {
  it('不启动 interval / 全局监听，只调用只读命令，不碰会话启停', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const windowListenerSpy = vi.spyOn(window, 'addEventListener')
    const documentListenerSpy = vi.spyOn(document, 'addEventListener')
    const { env, calls } = makeEnv()

    const wrapper = await mountCard(env)

    expect(intervalSpy).not.toHaveBeenCalled()
    expect(timeoutSpy).not.toHaveBeenCalled()
    expect(windowListenerSpy).not.toHaveBeenCalled()
    expect(documentListenerSpy).not.toHaveBeenCalled()
    // 只读命令白名单：无 session.create / session.close / session.action.*
    expect(calls.map((c) => c.command).sort()).toEqual(['session.config.list', 'session.list'])
    // 预览环境是收窄面（宿主机契约）：没有宿主 invoke / 写存储 / 事件出口
    expect('invoke' in env).toBe(false)
    expect('appStorageSet' in env).toBe(false)
    expect('appStorageDelete' in env).toBe(false)
    expect('onEvent' in env).toBe(false)

    wrapper.unmount()
  })

  it('预览组件源码不含写存储 / 定时器 / 全局监听 / 会话启停调用', () => {
    const source = previewCardSource
    expect(source).not.toMatch(/appStorageSet|appStorageDelete/)
    expect(source).not.toMatch(/setInterval|setTimeout/)
    expect(source).not.toMatch(/addEventListener/)
    expect(source).not.toMatch(/session\.(create|close|action\.)/)
    // 只读命令确实只用这两条
    expect(source).toContain("'session.list'")
    expect(source).toContain("'session.config.list'")
  })
})

describe('PreviewCard 卸载清理', () => {
  it('卸载后晚到数据不写入已卸载预览面，也不报错', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let resolveSessions!: (value: unknown) => void
    const pending = new Promise<unknown>((resolve) => {
      resolveSessions = resolve
    })
    const { env } = makeEnv({ sessions: () => pending })
    const wrapper = mount(PreviewCard, {
      props: { env },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    await flushPromises()
    // 数据未到时先渲染骨架，不阻塞挂载
    expect(wrapper.attributes('data-state')).toBe('loading')
    expect(wrapper.text()).toContain('终端会话')

    wrapper.unmount()
    expect(document.querySelector('.bc-preview')).toBeNull()

    resolveSessions({ sessions: SESSIONS })
    await flushPromises()

    // 晚到结果被 disposed 标志丢弃：不重建 DOM、不写状态、不报警
    expect(document.querySelector('.bc-preview')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('PreviewCard 无障碍：预览面无可聚焦控件', () => {
  it('ready 状态无可聚焦控件', async () => {
    const wrapper = await mountCard(makeEnv().env)

    expectNoFocusable(wrapper.element)
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.findAll('a[href]')).toHaveLength(0)

    wrapper.unmount()
  })

  it('空态 / 骨架状态同样无可聚焦控件', async () => {
    const empty = await mountCard(makeEnv({ sessions: [] }).env)
    expectNoFocusable(empty.element)
    empty.unmount()

    let resolveSessions!: (value: unknown) => void
    const pending = new Promise<unknown>((resolve) => {
      resolveSessions = resolve
    })
    const skeleton = mount(PreviewCard, {
      props: { env: makeEnv({ sessions: () => pending }).env },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(skeleton.attributes('data-state')).toBe('loading')
    expectNoFocusable(skeleton.element)
    skeleton.unmount()
    resolveSessions({ sessions: SESSIONS })
    await flushPromises()
  })
})

describe('mountPreview 入口契约', () => {
  it('不等待数据就返回句柄（首帧先骨架，数据后到）', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    let resolveSessions!: (value: unknown) => void
    const pending = new Promise<unknown>((resolve) => {
      resolveSessions = resolve
    })
    const { env } = makeEnv({ sessions: () => pending })

    // 数据仍 pending 时 handle 必须已返回
    const handle = await mountPreview(root, env)
    expect(typeof handle.unmount).toBe('function')
    expect(root.querySelector('.bc-preview')).not.toBeNull()
    expect(root.textContent).toContain('终端会话')

    resolveSessions({ sessions: SESSIONS })
    await flushPromises()
    expect(root.textContent).toContain('后端服务')

    await handle.unmount()
    expect(root.childElementCount).toBe(0)
  })

  it('env.locale 适配：英文环境渲染英文预览文案', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { env } = makeEnv({ sessions: [], locale: 'en' })

    const handle = await mountPreview(root, env)
    await flushPromises()
    expect(root.textContent).toContain('No terminal sessions yet')

    await handle.unmount()
  })

  it('entry.ts 源码导出 mountPreview 且含契约关键字段（L5 app 侧前提）', () => {
    const source = entrySource

    expect(source).toMatch(/export async function mountPreview\(/)
    for (const token of [
      'AppPreviewEnv',
      'AppPreviewHandle',
      'MountPreview',
      'appId',
      'lastRoute',
      'appInvoke',
      'appStorageGet',
      'locale',
      'theme',
    ]) {
      expect(source).toContain(token)
    }
    // 预览面必须走专用组件，不复用主 App / 主 router / 主 pinia
    expect(source).toContain("'./preview/PreviewCard.vue'")
  })
})
