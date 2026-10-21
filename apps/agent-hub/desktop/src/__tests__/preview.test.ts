/**
 * 多任务卡片只读预览面行为契约（mountPreview · Phase B）
 *
 * 契约来源：spec D1/D3/D4/D11 + CONTRACT §1 / §6.2 / §6.3。
 * 断言只落在外部可观察行为：
 * ① 正常数据 → 检测概览（已装数 / 版本 / 会话数）渲染；
 * ② `state: null` / 命令失败 → 应用自己的诚实空态，不抛错；
 * ③ 无副作用：只调两条既有只读命令、不碰 env 之外的写面 / 事件面、无定时器与监听；
 * ④ 卸载清理：卸载后晚到数据不报错、不留内容；
 * ⑤ 渲染 DOM 无可聚焦控件（卡片动作由外层覆盖层承接）；
 * ⑥ `entry.ts` 的 `mountPreview` 导出与 `mountPreview` 不等待预览数据的行为。
 *
 * 源码扫描用 Vite `?raw`（避免在 tsconfig 未装 @types/node 的工程里引入 node:fs）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PreviewCard from '../preview/PreviewCard.vue'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import entrySource from '../entry.ts?raw'
import previewSource from '../preview/PreviewCard.vue?raw'
import type { AppPreviewEnv } from '../entry'
import type { AgentHubState, UsageDomainState } from '../types'

/** 本 app 域 i18n 取值（与组件同一实例 / 同一扁平命名空间） */
const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})

/** 可聚焦控件选择器（CONTRACT §6.2：预览 DOM 内必须为空） */
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** 只读命令白名单（预览只允许这两条既有命令） */
const READ_COMMANDS = ['agent-hub.get-state', 'agent-hub.get-usage-state']

/** 正常探测状态：claude / codex / pi 已装，opencode 未安装 */
const DETECTION: AgentHubState = {
  authGranted: true,
  envStatus: 'ok',
  env: null,
  clis: {
    claude: {
      installed: true,
      version: '2.0.1',
      method: 'npm-global',
      paths: ['/usr/local/bin/claude'],
      dual: false,
      status: 'ok',
      error: null,
    },
    codex: {
      installed: true,
      version: '0.44.0',
      method: 'native',
      paths: ['/usr/local/bin/codex'],
      dual: false,
      status: 'ok',
      error: null,
    },
    opencode: {
      installed: false,
      version: null,
      method: 'unknown',
      paths: [],
      dual: false,
      status: 'not-installed',
      error: null,
    },
    pi: {
      installed: true,
      version: '1.2.3',
      method: 'standalone',
      paths: ['/usr/local/bin/pi'],
      dual: false,
      status: 'ok',
      error: null,
    },
  },
}

/** 已扫描 + 已授权：四个适配器会话数合计 100 + 10 + 8 + 10 = 128 */
const USAGE = {
  status: 'ok',
  error: null,
  syncedAt: 1_700_000_000_000,
  authGranted: true,
  home: '/home/dev',
  adapters: {
    claude: { files: 4, parsed: 4, skipped: 0, sessions: 100, error: null },
    codex: { files: 1, parsed: 1, skipped: 0, sessions: 10, error: null },
    opencode: { files: 1, parsed: 1, skipped: 0, sessions: 8, error: null },
    pi: { files: 1, parsed: 1, skipped: 0, sessions: 10, error: null },
  },
  sources: [],
} as unknown as UsageDomainState

type CommandImpl = (command: string, args: unknown[]) => Promise<unknown>

/**
 * env 替身：记录命令调用，并把**契约禁止的面**也塞进 env —— 断言它们从未被触碰
 * （预览环境本身没有这些字段；多塞是防实现越界调用）。
 */
function makeEnv(
  impl: CommandImpl,
  overrides: Partial<AppPreviewEnv> = {},
): {
  env: AppPreviewEnv
  calls: string[]
  forbidden: Record<'invoke' | 'appStorageSet' | 'appStorageDelete' | 'onEvent', ReturnType<typeof vi.fn>>
  storageGet: ReturnType<typeof vi.fn>
} {
  const calls: string[] = []
  const forbidden = {
    invoke: vi.fn(),
    appStorageSet: vi.fn(),
    appStorageDelete: vi.fn(),
    onEvent: vi.fn(),
  }
  const storageGet = vi.fn(async () => undefined)
  const env = {
    appId: 'com.wasmnest.agent-hub',
    locale: 'zh-CN',
    theme: 'dark',
    platform: 'desktop',
    appInvoke: vi.fn(async (command: string, ...args: unknown[]) => {
      calls.push(command)
      return impl(command, args)
    }),
    appStorageGet: storageGet,
    ...forbidden,
    ...overrides,
  } as unknown as AppPreviewEnv
  return { env, calls, forbidden, storageGet }
}

/** 正常数据 env */
function happyEnv(): ReturnType<typeof makeEnv> {
  return makeEnv(async (command) =>
    command === 'agent-hub.get-state' ? { state: DETECTION } : { state: USAGE },
  )
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 去掉块 / 行注释后的源码（源码扫描只看可执行代码，注释里的契约说明不误判） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

beforeEach(() => {
  i18n.global.locale.value = 'zh-CN'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('① 正常数据渲染（只用既有只读命令）', () => {
  it('渲染已装数 / CLI 名称 / 版本 / 会话数，且无空态', async () => {
    const { env, calls } = happyEnv()
    const wrapper = mount(PreviewCard, { props: { env } })
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain(t('hub.preview.subtitle'))
    expect(text).toContain(t('hub.preview.installedCount', { done: 3, total: 4 }))
    expect(text).toContain(t('hub.preview.sessionCount', { n: 128 }))
    for (const name of ['Claude Code', 'Codex CLI', 'OpenCode', 'Pi']) {
      expect(text).toContain(name)
    }
    for (const version of ['2.0.1', '0.44.0', '1.2.3']) {
      expect(text).toContain(version)
    }
    expect(text).toContain(t('hub.preview.notInstalled'))

    expect(wrapper.find('.ahpv-empty').exists()).toBe(false)
    expect(wrapper.find('.ahpv-skeleton').exists()).toBe(false)
    expect(calls).toEqual(READ_COMMANDS)
    wrapper.unmount()
  })

  it('env.theme / env.locale 映射到根节点属性；lastRoute 作为附注展示', async () => {
    const { env } = happyEnv()
    const wrapper = mount(PreviewCard, {
      props: { env: { ...env, theme: 'light', locale: 'en', lastRoute: '/hub/stats' } },
    })
    await flushPromises()

    const root = wrapper.find('.ahpv')
    expect(root.attributes('data-theme')).toBe('light')
    expect(root.attributes('data-locale')).toBe('en')
    expect(wrapper.text()).toContain(t('hub.preview.lastRoute', { path: '/hub/stats' }))
    wrapper.unmount()
  })

  it('首帧（数据未回）渲染可读骨架，不空白', () => {
    const { env } = makeEnv(() => new Promise(() => {}))
    const wrapper = mount(PreviewCard, { props: { env } })
    // 不 await：取数仍在飞
    expect(wrapper.find('.ahpv-skeleton').exists()).toBe(true)
    expect(wrapper.text()).toContain(t('hub.preview.loading'))
    wrapper.unmount()
  })
})

describe('② 空态 / 命令失败 → 诚实空态且不抛', () => {
  it('state: null（从未探测）→ 暂无检测数据空态，不渲染假数据', async () => {
    const { env } = makeEnv(async () => ({ state: null }))
    const wrapper = mount(PreviewCard, { props: { env } })
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain(t('hub.preview.empty'))
    expect(text).toContain(t('hub.preview.emptyHint'))
    expect(text).not.toContain('Claude Code')
    expect(wrapper.find('.ahpv-skeleton').exists()).toBe(false)
    wrapper.unmount()
  })

  it('两条命令都 reject → 不抛错，仍给空态', async () => {
    const { env } = makeEnv(async () => {
      throw new Error('plugin command failed')
    })
    const wrapper = mount(PreviewCard, { props: { env } })
    await flushPromises()

    expect(wrapper.text()).toContain(t('hub.preview.empty'))
    expect(wrapper.find('.ahpv-skeleton').exists()).toBe(false)
    wrapper.unmount()
  })

  it('检测可用但 usage 命令失败 → 检测概览照常，只标「会话数据未同步」', async () => {
    const { env } = makeEnv(async (command) => {
      if (command === 'agent-hub.get-state') return { state: DETECTION }
      throw new Error('usage unavailable')
    })
    const wrapper = mount(PreviewCard, { props: { env } })
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain(t('hub.preview.installedCount', { done: 3, total: 4 }))
    expect(text).toContain(t('hub.preview.sessionUnknown'))
    wrapper.unmount()
  })
})

describe('③ 无副作用（只读、无定时器 / 监听 / 写面）', () => {
  it('只调用两条既有只读命令，且不触碰 env 的写 / 事件面', async () => {
    const addWindow = vi.spyOn(window, 'addEventListener')
    const addDocument = vi.spyOn(document, 'addEventListener')
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    const { env, calls, forbidden, storageGet } = happyEnv()
    const wrapper = mount(PreviewCard, { props: { env } })
    await flushPromises()
    wrapper.unmount()

    expect(calls).toEqual(READ_COMMANDS)
    expect(forbidden.invoke).not.toHaveBeenCalled()
    expect(forbidden.appStorageSet).not.toHaveBeenCalled()
    expect(forbidden.appStorageDelete).not.toHaveBeenCalled()
    expect(forbidden.onEvent).not.toHaveBeenCalled()
    // 预览不需要 KV；用了也只允许读（env 里没有写 / 删）
    expect(storageGet.mock.calls.every((call) => typeof call[0] === 'string')).toBe(true)

    expect(addWindow).not.toHaveBeenCalled()
    expect(addDocument).not.toHaveBeenCalled()
    expect(setIntervalSpy).not.toHaveBeenCalled()
  })

  it('源码扫描：预览组件与 mountPreview 不出现禁止面', () => {
    const previewCode = stripComments(previewSource)
    for (const banned of [
      'refreshChannelToken',
      'appStorageSet',
      'appStorageDelete',
      'setInterval(',
      'setTimeout(',
      'addEventListener(',
      'onEvent(',
      'localStorage',
      'sessionStorage',
      'fetch(',
    ]) {
      expect(previewCode, `预览组件不得出现 ${banned}`).not.toContain(banned)
    }
    expect(previewCode).toContain('agent-hub.get-state')
    expect(previewCode).toContain('agent-hub.get-usage-state')
    expect(previewCode).toContain('disposed')

    const mountPreviewCode = stripComments(
      entrySource.slice(entrySource.indexOf('export async function mountPreview(')),
    )
    expect(mountPreviewCode.length).toBeGreaterThan(0)
    for (const banned of ['refreshChannelToken', 'appStorageSet', 'appStorageDelete', 'setInterval(']) {
      expect(mountPreviewCode, `mountPreview 不得出现 ${banned}`).not.toContain(banned)
    }
  })
})

describe('④ 卸载清理（晚到数据不写已卸载组件）', () => {
  it('卸载后异步数据晚到：不报错、不往已卸载容器写内容', async () => {
    const late = deferred<{ state: AgentHubState | null }>()
    const { env } = makeEnv((command) =>
      command === 'agent-hub.get-state' ? late.promise : new Promise(() => {}),
    )

    const container = document.createElement('div')
    document.body.appendChild(container)
    const wrapper = mount(PreviewCard, { props: { env }, attachTo: container })

    wrapper.unmount()
    expect(container.innerHTML).toBe('')

    // 卸载后数据才回来：只允许「丢弃」，不得抛错 / 回写 DOM
    late.resolve({ state: DETECTION })
    await flushPromises()
    expect(container.innerHTML).toBe('')
    container.remove()
  })
})

describe('⑤ 预览 DOM 无可聚焦控件', () => {
  it('骨架态 / 正常态 / 空态都没有可聚焦控件', async () => {
    // 骨架态：取数永不返回
    const pending = makeEnv(() => new Promise(() => {}))
    const loading = mount(PreviewCard, { props: { env: pending.env } })
    expect(loading.element.querySelectorAll(FOCUSABLE)).toHaveLength(0)
    loading.unmount()

    // 正常态
    const happy = happyEnv()
    const ready = mount(PreviewCard, { props: { env: happy.env } })
    await flushPromises()
    expect(ready.element.querySelectorAll(FOCUSABLE)).toHaveLength(0)
    ready.unmount()

    // 空态
    const empty = makeEnv(async () => ({ state: null }))
    const vacant = mount(PreviewCard, { props: { env: empty.env } })
    await flushPromises()
    expect(vacant.element.querySelectorAll(FOCUSABLE)).toHaveLength(0)
    vacant.unmount()
  })
})

describe('⑥ entry.ts 契约导出与「不等待预览数据」', () => {
  it('entry.ts 导出 mountPreview，且契约字段齐备（含 lastRoute）', () => {
    const code = stripComments(entrySource)
    expect(code).toContain('export async function mountPreview(')
    expect(code).toContain('interface AppPreviewEnv')
    expect(code).toContain('interface AppPreviewHandle')
    expect(code).toContain('type MountPreview')
    for (const field of ['appId', 'appInvoke', 'appStorageGet', 'lastRoute', 'locale', 'theme']) {
      expect(code, `entry.ts 契约缺字段 ${field}`).toContain(field)
    }
    // 挂载契约版本（宿主 MOUNT_CONTRACT 比对；分发化后版本不再天然一致）
    expect(code, "entry.ts AppMountEnv 必须声明 mountContract").toContain('mountContract: string')
    expect(code, "entry.ts 必须导出 mountContract = '1'").toContain(
      "export const mountContract = '1'",
    )
  })

  it('mountPreview 在数据回来前就返回句柄（骨架已挂出），unmount 清空容器', async () => {
    const { mountPreview } = await import('../entry')
    const late = deferred<{ state: AgentHubState | null }>()
    const { env } = makeEnv((command) =>
      command === 'agent-hub.get-state' ? late.promise : new Promise(() => {}),
    )

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = await mountPreview(root, env)

    // 数据仍在飞，但 handle 已返回、骨架已渲染
    expect(typeof handle.unmount).toBe('function')
    expect(root.textContent).toContain(t('hub.preview.loading'))

    late.resolve({ state: DETECTION })
    await flushPromises()
    expect(root.textContent).toContain('2.0.1')

    await handle.unmount()
    expect(root.innerHTML).toBe('')
    root.remove()
  })
})
