/**
 * 多任务卡片预览面（mountPreview）测试 — 2026-10-20 app preview contract
 *
 * 只断言外部可观察行为：正常只读摘要渲染 / 空态 / 命令失败 / 无副作用 /
 * 卸载清理 / 无可聚焦控件 / entry.ts 契约源码。不打断言内部组件结构。
 * 数据形状以插件 Rust 命令面的既有 wire（camelCase）为准，不猜字段。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PreviewCard from '../preview/PreviewCard.vue'
import i18n from '../i18n'
import { mountPreview, type AppPreviewEnv } from '../entry'
// 源码守卫：`?raw` 由 vite/client 类型声明（app 无 @types/node，不引入 node:fs）
import ENTRY_SRC from '../entry.ts?raw'
import PREVIEW_SRC from '../preview/PreviewCard.vue?raw'

/** 只读命令白名单（预览只允许调用这三条） */
const READ_COMMANDS = [
  'file-transfer.get-device-snapshot',
  'file-transfer.list-tasks',
  'file-transfer.list-receiving',
]

/** 可聚焦控件选择器（spec Seam 4 / D5） */
const FOCUSABLE =
  'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** 有副作用嫌疑的命令 / 状态写面关键词（预览一律不得命中） */
const SIDE_EFFECT_COMMAND =
  /dial|disconnect|refresh|enqueue|save|set-|pick|approve|reject|cancel|clear|revoke|mount|pull|update|remember|respond|storage/i

type Responder = (command: string, args: unknown) => unknown

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeEnv(
  responders: Record<string, Responder> = {},
  overrides: Partial<AppPreviewEnv> = {},
): { env: AppPreviewEnv; calls: string[] } {
  const calls: string[] = []
  const env: AppPreviewEnv = {
    appId: 'com.wasmnest.file-transfer',
    lastRoute: '/files',
    appInvoke: async <T = unknown>(command: string, ...args: unknown[]): Promise<T> => {
      calls.push(command)
      const respond = responders[command]
      if (!respond) throw new Error(`no responder for ${command}`)
      return (await respond(command, args[0])) as T
    },
    appStorageGet: async <T = unknown>(): Promise<T | undefined> => undefined,
    locale: 'zh-CN',
    theme: 'dark',
    platform: 'desktop',
    ...overrides,
  }
  return { env, calls }
}

/** 只读命令全成功的响应表 */
function okResponders(overrides: Record<string, Responder> = {}): Record<string, Responder> {
  return {
    'file-transfer.get-device-snapshot': () => ({
      devices: [
        {
          nodeId: 'a'.repeat(64),
          deviceName: '客厅电脑',
          addr: '10.0.0.2',
          port: 47613,
          capabilitiesHex: '1',
          lastSeenMs: Date.now(),
        },
        {
          nodeId: 'b'.repeat(64),
          deviceName: '书房平板',
          lastSeenMs: Date.now() - 5_000,
        },
      ],
    }),
    'file-transfer.list-tasks': () => [
      {
        batchId: 't1',
        nodeId: 'a'.repeat(64),
        peerName: '客厅电脑',
        direction: 'send',
        status: 'running',
        files: [{ path: '/home/me/report.pdf', size: 2048 }],
        totalBytes: 8192,
        transferredBytes: 2048,
        rateBps: 102_400,
      },
    ],
    'file-transfer.list-receiving': () => [
      {
        batchId: 't2',
        nodeId: 'b'.repeat(64),
        peerName: '书房平板',
        direction: 'receive',
        status: 'pending',
        files: [{ relativePath: 'photos/a.jpg', size: 512 }],
        totalBytes: 0,
        transferredBytes: 0,
        rateBps: 0,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  i18n.global.locale.value = 'zh-CN'
})

afterEach(() => {
  vi.restoreAllMocks()
  i18n.global.locale.value = 'zh-CN'
})

describe('PreviewCard — 只读摘要渲染', () => {
  it('先渲染骨架，再渲染真实对端 / 任务 / 速度摘要', async () => {
    const { env, calls } = makeEnv(okResponders())
    const wrapper = mount(PreviewCard, { props: { env } })

    // onMounted 发起取数但不等数据：首帧是骨架（loading），不是空白
    expect(wrapper.text()).toContain('加载中')

    await flushPromises()

    const text = wrapper.text()
    // 对端（真实快照数据）
    expect(text).toContain('客厅电脑')
    expect(text).toContain('书房平板')
    expect(text).toContain('最近可见')
    // 发送任务：文件名 / 状态 / 进度 / 速率
    expect(text).toContain('report.pdf')
    expect(text).toContain('传输中')
    expect(text).toContain('25%')
    expect(text).toContain('100 KB/s')
    // 接收任务（排队）
    expect(text).toContain('a.jpg')
    expect(text).toContain('排队')
    // 汇总：活跃数 + 合计速度
    expect(text).toContain('2 传输中')
    expect(text).toContain('合计')
    // 主题适配标记（env.theme）
    expect(wrapper.find('.ft-preview').attributes('data-preview-theme')).toBe('dark')

    // 只发只读命令，不碰写面 / 有副作用命令
    expect(calls.every((command) => READ_COMMANDS.includes(command))).toBe(true)
    expect(calls.some((command) => SIDE_EFFECT_COMMAND.test(command))).toBe(false)
  })

  it('env.theme=light 时把主题标记透传到预览根节点', async () => {
    const { env } = makeEnv(okResponders(), { theme: 'light' })
    const wrapper = mount(PreviewCard, { props: { env } })
    await flushPromises()
    expect(wrapper.find('.ft-preview').attributes('data-preview-theme')).toBe('light')
  })

  it('env.locale=en 时预览文案跟随 app i18n（空态英文）', async () => {
    const { env } = makeEnv(
      {
        'file-transfer.get-device-snapshot': () => ({ devices: [] }),
        'file-transfer.list-tasks': () => [],
        'file-transfer.list-receiving': () => [],
      },
      { locale: 'en' },
    )
    const root = document.createElement('div')
    const handle = await mountPreview(root, env)
    await flushPromises()

    expect(root.textContent).toContain('No peers')
    expect(root.textContent).toContain('No tasks')

    await handle.unmount()
  })
})

describe('PreviewCard — 空态 / 命令失败', () => {
  it('无数据时显示诚实空态（不编造运行中内容）', async () => {
    const { env } = makeEnv({
      'file-transfer.get-device-snapshot': () => ({ devices: [] }),
      'file-transfer.list-tasks': () => [],
      'file-transfer.list-receiving': () => [],
    })
    const wrapper = mount(PreviewCard, { props: { env } })
    await flushPromises()

    expect(wrapper.text()).toContain('暂无对端')
    expect(wrapper.text()).toContain('暂无任务')
    // 空态没有活跃 chip / 速度摘要
    expect(wrapper.find('.ft-preview-chip').exists()).toBe(false)
    expect(wrapper.find('.ft-preview-speed').exists()).toBe(false)
  })

  it('命令全部失败时不抛错，退回诚实空态', async () => {
    const { env } = makeEnv({
      'file-transfer.get-device-snapshot': () => {
        throw new Error('denied')
      },
      'file-transfer.list-tasks': () => {
        throw new Error('engine unavailable')
      },
      'file-transfer.list-receiving': () => {
        throw new Error('engine unavailable')
      },
    })
    const wrapper = mount(PreviewCard, { props: { env } })

    // 命令 rejection 由组件内 allSettled 收敛：await 即证明没有未处理 rejection
    await flushPromises()

    expect(wrapper.text()).toContain('暂无对端')
    expect(wrapper.text()).toContain('暂无任务')
  })

  it('单条命令失败不拖垮其余（部分成功照常渲染）', async () => {
    const { env } = makeEnv(
      okResponders({
        'file-transfer.list-tasks': () => {
          throw new Error('list-tasks failed')
        },
        'file-transfer.list-receiving': () => {
          throw new Error('list-receiving failed')
        },
      }),
    )
    const wrapper = mount(PreviewCard, { props: { env } })
    await flushPromises()

    // 对端快照成功 → 照常展示；任务失败 → 空态，不抛错
    expect(wrapper.text()).toContain('客厅电脑')
    expect(wrapper.text()).toContain('暂无任务')
  })
})

describe('PreviewCard — 无副作用', () => {
  it('只调三条只读命令，无 interval / 全局监听 / 存储写面', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const windowListenerSpy = vi.spyOn(window, 'addEventListener')
    const documentListenerSpy = vi.spyOn(document, 'addEventListener')

    const { env, calls } = makeEnv(okResponders())
    const wrapper = mount(PreviewCard, { props: { env } })
    await flushPromises()

    expect(calls).toHaveLength(READ_COMMANDS.length)
    expect(calls.slice().sort()).toEqual(READ_COMMANDS.slice().sort())
    expect(calls.some((command) => SIDE_EFFECT_COMMAND.test(command))).toBe(false)

    expect(setIntervalSpy).not.toHaveBeenCalled()
    expect(windowListenerSpy).not.toHaveBeenCalled()
    expect(documentListenerSpy).not.toHaveBeenCalled()

    // 源码守卫：预览组件不得含定时器 / 监听 / 写面 / 通知 / 主应用依赖
    expect(PREVIEW_SRC).not.toMatch(/setInterval|setTimeout|addEventListener/)
    expect(PREVIEW_SRC).not.toMatch(/appStorageSet|appStorageDelete|refreshChannelToken/)
    expect(PREVIEW_SRC).not.toMatch(/from '\.\.\/notifications'|from '\.\.\/AppRoot\.vue'/)
    expect(PREVIEW_SRC).not.toMatch(/document\.body/)
  })
})

describe('PreviewCard — 卸载清理', () => {
  it('mountPreview 立即返回句柄；卸载后 DOM 清空且晚到数据被丢弃', async () => {
    const snapshot = deferred<unknown>()
    const sendTasks = deferred<unknown>()
    const receiving = deferred<unknown>()

    const { env } = makeEnv({
      'file-transfer.get-device-snapshot': () => snapshot.promise,
      'file-transfer.list-tasks': () => sendTasks.promise,
      'file-transfer.list-receiving': () => receiving.promise,
    })

    const root = document.createElement('div')
    document.body.appendChild(root)

    // 不等待数据即返回 handle（宿主 3s 超时只覆盖句柄）
    const handle = await mountPreview(root, env)
    expect(root.querySelector('.ft-preview')).not.toBeNull()

    await handle.unmount()
    expect(root.innerHTML).toBe('')

    // 卸载后数据才到：不得抛错、不得把 DOM 写回
    snapshot.resolve({ devices: [{ nodeId: 'c'.repeat(64), deviceName: '迟到的对端' }] })
    sendTasks.resolve([])
    receiving.resolve([])
    await flushPromises()

    expect(root.innerHTML).toBe('')

    document.body.removeChild(root)
    // 卸载标志 + onBeforeUnmount 清理（源码守卫）
    expect(PREVIEW_SRC).toMatch(/onBeforeUnmount/)
    expect(PREVIEW_SRC).toMatch(/disposed = true/)
  })
})

describe('PreviewCard — 装饰层无焦点', () => {
  it('加载态与数据态均无可聚焦控件', async () => {
    const snapshot = deferred<unknown>()
    const sendTasks = deferred<unknown>()
    const receiving = deferred<unknown>()
    const { env } = makeEnv({
      'file-transfer.get-device-snapshot': () => snapshot.promise,
      'file-transfer.list-tasks': () => sendTasks.promise,
      'file-transfer.list-receiving': () => receiving.promise,
    })

    const wrapper = mount(PreviewCard, { props: { env } })
    // 加载态
    expect(wrapper.element.querySelectorAll(FOCUSABLE)).toHaveLength(0)

    // 数据态
    snapshot.resolve({
      devices: [{ nodeId: 'a'.repeat(64), deviceName: '客厅电脑', lastSeenMs: Date.now() }],
    })
    sendTasks.resolve([
      {
        batchId: 't1',
        peerName: '客厅电脑',
        status: 'running',
        files: [{ path: '/home/me/report.pdf' }],
        totalBytes: 4096,
        transferredBytes: 1024,
        rateBps: 2048,
      },
    ])
    receiving.resolve([])
    await flushPromises()

    expect(wrapper.element.querySelectorAll(FOCUSABLE)).toHaveLength(0)
    expect(wrapper.findAll('.ft-preview-task')).toHaveLength(1)
  })
})

describe('entry.ts — mountPreview 契约', () => {
  it('导出 mountPreview 与完整 AppPreviewEnv 形状（含 lastRoute）', () => {
    expect(ENTRY_SRC).toMatch(/export async function mountPreview\(/)
    expect(ENTRY_SRC).toContain('export interface AppPreviewEnv')
    expect(ENTRY_SRC).toContain('export interface AppPreviewHandle')
    expect(ENTRY_SRC).toContain('export type MountPreview')
    for (const field of ['appId', 'appInvoke', 'appStorageGet', 'lastRoute', 'locale', 'theme']) {
      expect(ENTRY_SRC).toContain(field)
    }
    // 挂载契约版本（宿主 MOUNT_CONTRACT 比对）
    expect(ENTRY_SRC).toContain('mountContract: string')
    expect(ENTRY_SRC).toContain("export const mountContract = '1'")
    // 预览不接收写面 / 事件出口
    expect(ENTRY_SRC).not.toMatch(/interface AppPreviewEnv[\s\S]*?onEvent/)
  })
})
