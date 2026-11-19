/**
 * 应用工具单测（票 15 / spec §4.2、§5.6）
 *
 * 覆盖：app.list / app.open / monitor.snapshot / system.info 的执行与
 * 桥缺失显性降级；app.invoke.<toolId> 目录构建（名 / schema / 风险跟随
 * 声明）；桥拒绝（未声明命令等）经运行时变成 isError toolResult，不静默。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  appListDescriptor,
  appOpenDescriptor,
  buildAppBaseDescriptors,
  buildAppInvokeDescriptorsFromSnapshot,
  bridgeMissingError,
  monitorSnapshotDescriptor,
  systemInfoDescriptor,
} from '@nest-shared/tools/app-tools'
import { buildToolRuntime } from '@nest-shared/tools/runtime'
import type { AppInvokeBridge, AssistantAppDescriptor } from '@nest-shared/types'

// ==================== 假桥 ====================

interface FakeBridge extends AppInvokeBridge {
  invokeCalls: Array<{ appId: string; command: string; args: unknown }>
  openCalls: string[]
  /** invoke 时按 (appId, command) 抛出的错误（模拟未声明 / 未运行） */
  throwOn?: (appId: string, command: string) => Error | null
}

function createBridge(apps: AssistantAppDescriptor[] = []): FakeBridge {
  const invokeCalls: Array<{ appId: string; command: string; args: unknown }> = []
  const openCalls: string[] = []
  return {
    invokeCalls,
    openCalls,
    async list() {
      return apps
    },
    async invoke(appId, command, args) {
      invokeCalls.push({ appId, command, args })
      const err = this.throwOn?.(appId, command)
      if (err) throw err
      return { ok: true, app: appId, command }
    },
    async open(appId) {
      openCalls.push(appId)
    },
  } as FakeBridge
}

const monitorApp: AssistantAppDescriptor = {
  id: 'com.wasmnest.monitor',
  name: 'Monitor',
  version: '1.0.0',
  kind: 'internal-business',
  state: 'running',
  tools: [
    {
      id: 'monitor.runtime-snapshot',
      title: '读取运行指标',
      description: '只读快照',
      command: 'monitor.snapshot',
      argsSchema: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'read',
      output: 'json',
    },
  ],
}

// ==================== 目录构建 ====================

describe('app.invoke.* 目录（票 15）', () => {
  it('按声明构建：名字 / schema / 风险 / 目标', () => {
    const apps = createBridge([monitorApp])
    const descriptors = buildAppInvokeDescriptorsFromSnapshot(apps, [monitorApp])
    expect(descriptors).toHaveLength(1)
    const d = descriptors[0]
    expect(d.name).toBe('app.invoke.monitor.runtime-snapshot')
    expect(d.argsSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false })
    expect(d.risk).toBe('read')
    expect(d.appId).toBe('com.wasmnest.monitor')
    expect(d.appToolId).toBe('monitor.snapshot')
    expect(d.label).toContain('Monitor')
  })

  it('风险跟随应用声明（write 声明 → write）', () => {
    const writeApp: AssistantAppDescriptor = {
      ...monitorApp,
      tools: [
        {
          id: 'x.write-thing',
          title: '写操作',
          description: 'd',
          command: 'x.do',
          argsSchema: { type: 'object', properties: {} },
          risk: 'write',
        },
      ],
    }
    const apps = createBridge([writeApp])
    const [d] = buildAppInvokeDescriptorsFromSnapshot(apps, [writeApp])
    expect(d.risk).toBe('write')
  })

  it('桥缺失：不注册 app.invoke.*', () => {
    expect(buildAppInvokeDescriptorsFromSnapshot(null, [monitorApp])).toEqual([])
  })

  it('多应用多工具：全部注册且按 appId 去重前缀', () => {
    const netApp: AssistantAppDescriptor = {
      id: 'com.wasmnest.net-config',
      name: 'NetConfig',
      version: '1',
      kind: 'business-app',
      state: 'running',
      tools: [
        {
          id: 'net.status',
          title: '状态',
          description: 'd',
          command: 'net.status',
          argsSchema: { type: 'object', properties: {} },
          risk: 'read',
        },
      ],
    }
    const apps = createBridge([monitorApp, netApp])
    const descriptors = buildAppInvokeDescriptorsFromSnapshot(apps, [monitorApp, netApp])
    expect(descriptors.map((d) => d.name).sort()).toEqual([
      'app.invoke.monitor.runtime-snapshot',
      'app.invoke.net.status',
    ])
  })
})

// ==================== 基础件执行 ====================

describe('app.list / app.open / monitor.snapshot / system.info（票 15）', () => {
  it('app.list 格式化应用与声明工具（含风险与状态）', async () => {
    const apps = createBridge([monitorApp])
    const res = await appListDescriptor(apps).executor!({})
    expect(res.error).toBeUndefined()
    expect(res.text).toContain('Monitor')
    expect(res.text).toContain('com.wasmnest.monitor')
    expect(res.text).toContain('monitor.runtime-snapshot')
    expect(res.text).toContain('read')
    expect(res.text).toContain('running')
  })

  it('app.list 无应用时点名', async () => {
    const res = await appListDescriptor(createBridge([])).executor!({})
    expect(res.text).toContain('没有可调度的应用')
  })

  it('桥缺失：app.list 显性报错（不静默返回空）', async () => {
    const res = await appListDescriptor(null).executor!({})
    expect(res.error).toBe(bridgeMissingError())
    expect(res.error).toContain('apps 桥')
  })

  it('app.open 调桥打开目标', async () => {
    const apps = createBridge([monitorApp])
    const res = await appOpenDescriptor(apps).executor!({ appId: 'com.wasmnest.monitor' })
    expect(res.error).toBeUndefined()
    expect(res.text).toContain('正在打开')
    expect(apps.openCalls).toEqual(['com.wasmnest.monitor'])
  })

  it('app.open 缺 appId / 桥缺失：显性报错', async () => {
    const apps = createBridge([monitorApp])
    expect((await appOpenDescriptor(apps).executor!({})).error).toContain('appId')
    const res = await appOpenDescriptor(null).executor!({ appId: 'x' })
    expect(res.error).toBe(bridgeMissingError())
    expect(apps.openCalls).toEqual([])
  })

  it('app.open 桥拒绝（未安装 / 停用）：错误原样上交', async () => {
    const apps = createBridge([monitorApp])
    apps.open = async () => {
      throw new Error('app.not_running')
    }
    const res = await appOpenDescriptor(apps).executor!({ appId: 'com.wasmnest.monitor' })
    expect(res.error).toContain('app.not_running')
  })

  it('monitor.snapshot 经桥调 monitor 命令', async () => {
    const apps = createBridge([monitorApp])
    const res = await monitorSnapshotDescriptor(apps).executor!({})
    expect(res.error).toBeUndefined()
    expect(apps.invokeCalls).toEqual([{ appId: 'com.wasmnest.monitor', command: 'monitor.snapshot', args: {} }])
    const parsed = JSON.parse(res.text!)
    expect(parsed.ok).toBe(true)
  })

  it('monitor.snapshot 桥缺失 / 桥拒绝：显性报错', async () => {
    expect((await monitorSnapshotDescriptor(null).executor!({})).error).toBe(bridgeMissingError())
    const apps = createBridge([monitorApp])
    apps.throwOn = () => new Error('tool.not_declared')
    const res = await monitorSnapshotDescriptor(apps).executor!({})
    expect(res.error).toContain('tool.not_declared')
  })

  it('system.info 返回平台与语言（不含敏感信息）', async () => {
    const res = await systemInfoDescriptor().executor!({})
    expect(res.error).toBeUndefined()
    const info = JSON.parse(res.text!)
    expect(info.platform).toBeTruthy()
    expect(typeof info.language).toBe('string')
    expect(res.text).not.toContain('key')
  })

  it('基础件在桥缺失时仍全部注册（执行时显性降级）', () => {
    const descriptors = buildAppBaseDescriptors(null)
    expect(descriptors.map((d) => d.name)).toEqual([
      'app.list',
      'app.open',
      'monitor.snapshot',
      'system.info',
    ])
    for (const d of descriptors.slice(0, 3)) {
      expect(d.risk).toBeDefined()
    }
  })
})

// ==================== 运行时集成：桥拒绝 → isError toolResult ====================

describe('运行时集成（票 15）', () => {
  it('未声明命令被桥拒绝 → isError toolResult，循环不中断', async () => {
    const apps = createBridge([monitorApp])
    // 桥对 monitor.snapshot 拒绝（模拟未声明）
    apps.throwOn = (appId, command) =>
      command === 'monitor.snapshot' ? new Error('tool.not_declared: monitor.snapshot 未声明') : null

    const invokeMock = vi.fn(
      async <T = unknown>(_command: string, _args?: Record<string, unknown>): Promise<T> => ({ ok: true } as T),
    )
    const invoke = invokeMock as unknown as <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
    const runtime = buildToolRuntime({ invoke, apps })
    const descriptors = buildAppInvokeDescriptorsFromSnapshot(apps, [monitorApp])
    for (const d of descriptors) runtime.register(d)
    runtime.refresh()

    const tool = runtime.tools[0]
    const result = await tool.execute('tc-1', {}, undefined)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('tool.not_declared')
    // 审计仍落一行（decision=allowed，结果摘要记录失败）
    const auditCall = invokeMock.mock.calls.find((c) => c[0] === 'assistant.audit-record')
    expect(auditCall).toBeTruthy()
  })

  it('read 工具自动放行（beforeToolCall 不挂起确认）', async () => {
    const apps = createBridge([monitorApp])
    const runtime = buildToolRuntime({ invoke: vi.fn(async <T = unknown>(): Promise<T> => ({ ok: true } as T)) as <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>, apps })
    const descriptors = buildAppInvokeDescriptorsFromSnapshot(apps, [monitorApp])
    for (const d of descriptors) runtime.register(d)
    runtime.refresh()
    const before = await runtime.beforeToolCall({
      assistantMessage: { role: 'assistant' } as never,
      toolCall: { type: 'toolCall', id: 'tc-1', name: 'app.invoke.monitor.runtime-snapshot', arguments: {} },
      args: {},
      context: { messages: [] } as never,
    })
    expect(before).toBeUndefined()
    expect(runtime.pendingConfirmations).toHaveLength(0)
  })

  it('write 声明的工具：beforeToolCall 挂起确认（风险跟随声明）', async () => {
    const writeApp: AssistantAppDescriptor = {
      ...monitorApp,
      tools: [
        {
          id: 'x.write',
          title: '写',
          description: 'd',
          command: 'x.do',
          argsSchema: { type: 'object', properties: {} },
          risk: 'write',
        },
      ],
    }
    const apps = createBridge([writeApp])
    const runtime = buildToolRuntime({ invoke: vi.fn(async <T = unknown>(): Promise<T> => ({ ok: true } as T)) as <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>, apps })
    const descriptors = buildAppInvokeDescriptorsFromSnapshot(apps, [writeApp])
    for (const d of descriptors) runtime.register(d)
    runtime.refresh()

    const beforePromise = runtime.beforeToolCall({
      assistantMessage: { role: 'assistant' } as never,
      toolCall: { type: 'toolCall', id: 'tc-1', name: 'app.invoke.x.write', arguments: {} },
      args: {},
      context: { messages: [] } as never,
    })
    // 挂起：pendingConfirmations 出现 write 确认项
    await vi.waitFor(() => expect(runtime.pendingConfirmations).toHaveLength(1))
    expect(runtime.pendingConfirmations[0].request.risk).toBe('write')
    runtime.resolveConfirmation(runtime.pendingConfirmations[0].request.id, 'reject')
    const before = await beforePromise
    expect(before?.block).toBe(true)
  })
})
