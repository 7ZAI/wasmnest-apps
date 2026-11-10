/**
 * 项目页行为契约（ADR 0003 移动消费面：项目 → 运行 → 终端）
 *
 * 只断言外部行为：
 * - 项目卡渲染 / 进入项目后按 projectId 取运行；
 * - 活跃运行点击 → prewarm + emit open-terminal；终态运行拒绝打开；
 * - 新建运行 → 选 agent → `bedcode.start-run` → 打开新运行终端；
 * - missing agent 不启动；停止运行先确认再走 `bedcode.stop-session`；
 * - 未认证空态 → 去连接；系统返回键详情 → 列表；
 * - 中英文案键集合一致。
 *
 * 取数 / 弹窗全部经 pluginContext 替身，不触真实宿主 / 网络。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import ProjectsPage from '../ProjectsPage.vue'
import { clearRememberedProject } from '../useProjects'
import { messagesEn, messagesZhCN } from '../i18n'
import {
  installMockMobileApi,
  uninstallMockMobileApi,
  type MockMobileApi,
} from '../../terminal/__tests__/testKit'

// ==================== 测试数据 ====================

function projectView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    environment: 'wsl2',
    wslDistro: 'Ubuntu',
    workingDir: '/srv/pay',
    name: '支付重构',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-31T00:00:00Z',
    lastOpenedAt: '2026-10-31T00:00:00Z',
    activeRuns: 2,
    runCount: 5,
    lastActivityAt: new Date(Date.now() - 120_000).toISOString(),
    lastAgentId: 'pi',
    ...overrides,
  }
}

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

function agentView(overrides: Record<string, unknown> = {}) {
  return { id: 'pi', displayName: 'Pi', binary: 'pi', readiness: 'ready', ...overrides }
}

// ==================== 插件上下文替身 ====================

interface Responders {
  [command: string]: (args?: any) => unknown
}

function makePluginContext(responders: Responders) {
  return {
    id: 'com.wasmnest.bedcode',
    commands: {
      execute: vi.fn(async (id: string, args?: any) => {
        const responder = responders[id]
        if (!responder) throw new Error(`no responder for ${id}`)
        return responder(args)
      }),
    },
    events: { on: vi.fn(() => ({ dispose: vi.fn() })) },
    i18n: { t: (key: string) => key },
    dialogs: {
      showToast: vi.fn(),
      showConfirm: vi.fn(async () => true),
      showPrompt: vi.fn(async () => null),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as PluginContext
}

let api: MockMobileApi
let ctx: PluginContext
let routers: Responders

function installRouters(overrides: Partial<Responders> = {}): void {
  routers = {
    'bedcode.list-projects': () => ({ code: 0, data: { projects: [projectView()] } }),
    'bedcode.list-runs': (args) => ({
      code: 0,
      data: { runs: args?.projectId === 'p-1' ? [runView()] : [] },
    }),
    'bedcode.list-agents': () => ({ code: 0, data: { agents: [agentView()] } }),
    'bedcode.start-run': () => ({
      code: 0,
      data: { runId: 'r-new', name: '支付重构', configId: 'cfg-1' },
    }),
    'bedcode.stop-session': () => ({ code: 0, data: {} }),
    'bedcode.prewarm': () => ({ ok: true }),
    ...overrides,
  }
}

function mountPage() {
  return mount(ProjectsPage, {
    global: { provide: { pluginContext: ctx } },
  })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

/** 进入项目详情（项目卡点击） */
async function enterProject(wrapper: ReturnType<typeof mountPage>): Promise<void> {
  await wrapper.find('.project-card').trigger('click')
  await settle()
}

function commandCalls(command: string): any[][] {
  return (ctx.commands.execute as any).mock.calls.filter((call: any[]) => call[0] === command)
}

beforeEach(() => {
  clearRememberedProject()
  api = installMockMobileApi({ isPaired: true, isConnected: true })
  installRouters()
  ctx = makePluginContext(routers)
})

afterEach(() => {
  uninstallMockMobileApi()
  document.body.innerHTML = ''
})

// ==================== 契约 ====================

describe('项目列表', () => {
  it('渲染项目卡：名称 / 路径 / 环境 / 活跃运行数，并按后端顺序展示', async () => {
    routers['bedcode.list-projects'] = () => ({
      code: 0,
      data: {
        projects: [
          projectView({
            id: 'p-2',
            name: '清单服务',
            workingDir: '/srv/list',
            activeRuns: 0,
            environment: 'linux',
          }),
          projectView(),
        ],
      },
    })
    const wrapper = mountPage()
    await settle()

    const cards = wrapper.findAll('.project-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain('清单服务')
    expect(cards[0].text()).toContain('/srv/list')
    expect(cards[0].text()).toContain('Linux')
    expect(cards[1].text()).toContain('支付重构')
    expect(cards[1].text()).toContain('WSL2')
    expect(cards[1].find('.status-badge').text()).toContain('2')
    wrapper.unmount()
  })

  it('项目为空：显性空态（不渲染空列表）', async () => {
    routers['bedcode.list-projects'] = () => ({ code: 0, data: { projects: [] } })
    const wrapper = mountPage()
    await settle()

    expect(wrapper.text()).toContain('project.empty')
    expect(wrapper.findAll('.project-card')).toHaveLength(0)
    wrapper.unmount()
  })

  it('取数失败：错误槽 + 重试入口', async () => {
    routers['bedcode.list-projects'] = () => ({ code: 1002, message: 'desktop offline' })
    const wrapper = mountPage()
    await settle()

    expect(wrapper.text()).toContain('desktop offline')
    expect(wrapper.text()).toContain('project.retry')
    wrapper.unmount()
  })
})

describe('项目详情与运行', () => {
  it('进入项目：按 projectId 取运行并渲染标题 / Agent / 状态', async () => {
    const wrapper = mountPage()
    await settle()
    await enterProject(wrapper)

    expect(commandCalls('bedcode.list-runs')[0][1]).toEqual({ projectId: 'p-1' })
    expect(wrapper.text()).toContain('修复支付回调')
    expect(wrapper.text()).toContain('pi')
    expect(wrapper.text()).toContain('hub.statusRunning')
    expect(wrapper.find('.run-row--active').exists()).toBe(true)
    expect(wrapper.text()).toContain('project.run.new')
    wrapper.unmount()
  })

  it('Error 状态是 `{error}` 对象：折成 error 文案，不显示成空闲', async () => {
    routers['bedcode.list-runs'] = () => ({
      code: 0,
      data: {
        runs: [
          runView({
            id: 'r-err',
            title: '失败运行',
            status: { error: 'pty closed' },
            active: false,
          }),
        ],
      },
    })
    const wrapper = mountPage()
    await settle()
    await enterProject(wrapper)

    expect(wrapper.text()).toContain('project.status.error')
    expect(wrapper.text()).not.toContain('project.status.idle')
    wrapper.unmount()
  })

  it('点活跃运行：prewarm 传输面 + emit open-terminal（sessionId 即 runId）', async () => {
    const wrapper = mountPage()
    await settle()
    await enterProject(wrapper)

    await wrapper.find('.run-row--active .run-open').trigger('click')
    await settle()

    expect(wrapper.emitted('open-terminal')?.[0]).toEqual(['r-1', '修复支付回调'])
    expect(api.activeSessionId.value).toBe('r-1')
    expect(ctx.commands.execute).toHaveBeenCalledWith('bedcode.prewarm', { sessionId: 'r-1' })
    wrapper.unmount()
  })

  it('点终态运行：提示已结束，不打开终端、不预热', async () => {
    routers['bedcode.list-runs'] = () => ({
      code: 0,
      data: { runs: [runView({ id: 'r-old', status: 'stopped', active: false })] },
    })
    const wrapper = mountPage()
    await settle()
    await enterProject(wrapper)

    await wrapper.find('.run-row .run-open').trigger('click')
    await settle()

    expect(wrapper.emitted('open-terminal')).toBeUndefined()
    expect(ctx.commands.execute).not.toHaveBeenCalledWith('bedcode.prewarm', { sessionId: 'r-old' })
    expect(ctx.dialogs.showToast).toHaveBeenCalledWith('project.run.ended', 'warning')
    wrapper.unmount()
  })

  it('新建运行：选 agent → start-run → 打开新运行终端', async () => {
    routers['bedcode.list-runs'] = (args) => ({
      code: 0,
      data: {
        runs:
          args?.projectId === 'p-1'
            ? [runView({ id: 'r-new', title: '新运行', status: 'starting' })]
            : [],
      },
    })
    const wrapper = mountPage()
    await settle()
    await enterProject(wrapper)

    await wrapper.find('.new-run-btn').trigger('click')
    await settle()
    expect(document.querySelector('[data-testid="mobile-agent-pi"]')).toBeTruthy()

    document.querySelector<HTMLButtonElement>('[data-testid="mobile-agent-pi"]')!.click()
    await settle()

    // P0-1：启动时随请求带上本端预估网格（桌面端据此建 PTY，手机启动的
    // 运行不再先画一屏 120 列；正统端由桌面从 JWT 取，前端不传 sourceDevice）
    const startCall = (ctx.commands.execute as unknown as {
      mock: { calls: [string, Record<string, unknown>][] }
    }).mock.calls.find(([id]) => id === 'bedcode.start-run')
    expect(startCall?.[1]).toMatchObject({ projectId: 'p-1', agentId: 'pi' })
    expect(startCall?.[1].cols).toBeGreaterThan(0)
    expect(startCall?.[1].rows).toBeGreaterThan(0)
    expect(startCall?.[1]).not.toHaveProperty('sourceDevice')
    expect(wrapper.emitted('open-terminal')?.[0]).toEqual(['r-new', '支付重构'])
    wrapper.unmount()
  })

  it('启动期间切走页签：完成后不抢开终端，只提示可在项目页打开', async () => {
    let resolveStart!: (value: unknown) => void
    routers['bedcode.start-run'] = () =>
      new Promise((resolve) => {
        resolveStart = resolve
      })
    const wrapper = mountPage()
    await settle()
    await enterProject(wrapper)

    await wrapper.find('.new-run-btn').trigger('click')
    await settle()
    document.querySelector<HTMLButtonElement>('[data-testid="mobile-agent-pi"]')!.click()
    await nextTick()

    await wrapper.setProps({ active: false })
    resolveStart({ code: 0, data: { runId: 'r-new', name: '支付重构', configId: 'cfg-1' } })
    await settle()

    expect(wrapper.emitted('open-terminal')).toBeUndefined()
    expect(ctx.dialogs.showToast).toHaveBeenCalledWith(
      'project.run.startedInBackground',
      'success',
    )
    wrapper.unmount()
  })

  it('未安装 agent：只提示去桌面安装，不发 start-run', async () => {
    routers['bedcode.list-agents'] = () => ({
      code: 0,
      data: {
        agents: [
          agentView({
            id: 'claude',
            displayName: 'Claude',
            binary: 'claude',
            readiness: 'missing',
          }),
        ],
      },
    })
    const wrapper = mountPage()
    await settle()
    await enterProject(wrapper)

    await wrapper.find('.new-run-btn').trigger('click')
    await settle()
    document.querySelector<HTMLButtonElement>('[data-testid="mobile-agent-claude"]')!.click()
    await settle()

    expect(ctx.commands.execute).not.toHaveBeenCalledWith('bedcode.start-run', expect.anything())
    expect(ctx.dialogs.showToast).toHaveBeenCalledWith('project.run.installOnDesktop', 'warning')
    wrapper.unmount()
  })

  it('停止运行：确认后走 stop-session 并重取运行', async () => {
    const wrapper = mountPage()
    await settle()
    await enterProject(wrapper)

    const before = commandCalls('bedcode.list-runs').length
    await wrapper.find('button[title="project.run.stop"]').trigger('click')
    await settle()

    expect(ctx.dialogs.showConfirm).toHaveBeenCalled()
    expect(ctx.commands.execute).toHaveBeenCalledWith('bedcode.stop-session', { sessionId: 'r-1' })
    expect(commandCalls('bedcode.list-runs').length).toBeGreaterThan(before)
    expect(ctx.dialogs.showToast).toHaveBeenCalledWith('project.run.stoppedOk', 'success')
    wrapper.unmount()
  })

  it('停止确认取消：不发 stop-session', async () => {
    ;(ctx.dialogs.showConfirm as any).mockResolvedValueOnce(false)
    const wrapper = mountPage()
    await settle()
    await enterProject(wrapper)

    await wrapper.find('button[title="project.run.stop"]').trigger('click')
    await settle()

    expect(ctx.commands.execute).not.toHaveBeenCalledWith('bedcode.stop-session', expect.anything())
    wrapper.unmount()
  })
})

describe('未认证与返回键', () => {
  it('未认证：空态 + 去连接入口（不发受保护请求）', async () => {
    api.isPaired.value = false
    const wrapper = mountPage()
    await settle()

    expect(wrapper.text()).toContain('hub.notConnected')
    expect(wrapper.text()).toContain('project.notConnectedHint')
    expect(commandCalls('bedcode.list-projects')).toHaveLength(0)

    const button = wrapper.findAll('button').find((item) => item.text().includes('hub.qrConnect'))
    expect(button).toBeTruthy()
    await button!.trigger('click')
    expect(wrapper.emitted('open-connection')).toBeTruthy()
    wrapper.unmount()
  })

  it('断开后重连：重新取项目列表，不展示断线前的旧数据', async () => {
    const wrapper = mountPage()
    await settle()
    expect(wrapper.findAll('.project-card')).toHaveLength(1)
    const callsBefore = commandCalls('bedcode.list-projects').length

    api.isPaired.value = false
    await settle()
    expect(wrapper.text()).toContain('hub.notConnected')

    api.isPaired.value = true
    await settle()
    expect(commandCalls('bedcode.list-projects').length).toBeGreaterThan(callsBefore)
    expect(wrapper.findAll('.project-card')).toHaveLength(1)
    wrapper.unmount()
  })

  it('系统返回键：详情可退 → 列表；列表不再消费', async () => {
    const wrapper = mountPage()
    await settle()
    expect((wrapper.vm as any).canGoBack()).toBe(false)

    await enterProject(wrapper)
    expect((wrapper.vm as any).canGoBack()).toBe(true)

    ;(wrapper.vm as any).goBack()
    await settle()
    expect((wrapper.vm as any).canGoBack()).toBe(false)
    expect(wrapper.findAll('.project-card')).toHaveLength(1)
    wrapper.unmount()
  })

  it('agent 弹窗打开时：返回键先收弹窗，再退详情', async () => {
    const wrapper = mountPage()
    await settle()
    await enterProject(wrapper)

    await wrapper.find('.new-run-btn').trigger('click')
    await settle()
    expect(document.querySelector('[data-testid="mobile-agent-pi"]')).toBeTruthy()
    expect((wrapper.vm as any).canGoBack()).toBe(true)

    ;(wrapper.vm as any).goBack()
    await settle()
    // 弹窗已收，仍在项目详情（不是直接掉回列表）
    expect(document.querySelector('[data-testid="mobile-agent-pi"]')).toBeNull()
    expect(wrapper.text()).toContain('修复支付回调')

    ;(wrapper.vm as any).goBack()
    await settle()
    expect(wrapper.findAll('.project-card')).toHaveLength(1)
    wrapper.unmount()
  })

  it('终端返回后重挂载：恢复上次查看的项目', async () => {
    const first = mountPage()
    await settle()
    await enterProject(first)
    first.unmount()

    // AppRoot 打开终端时卸载页签容器；关闭终端后本页以新实例挂载
    const second = mountPage()
    await settle()

    expect((second.vm as any).canGoBack()).toBe(true)
    expect(second.text()).toContain('修复支付回调')
    second.unmount()
  })
})

describe('文案', () => {
  it('中英键集合完全一致', () => {
    const flatten = (
      source: Record<string, unknown>,
      prefix = '',
      out: string[] = [],
    ): string[] => {
      for (const [key, value] of Object.entries(source)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (value && typeof value === 'object') flatten(value as Record<string, unknown>, path, out)
        else out.push(path)
      }
      return out
    }
    expect(flatten(messagesEn as unknown as Record<string, unknown>).sort()).toEqual(
      flatten(messagesZhCN as unknown as Record<string, unknown>).sort(),
    )
  })
})
