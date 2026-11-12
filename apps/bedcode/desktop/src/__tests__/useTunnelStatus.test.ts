/**
 * 启动期隧道入口预热 行为契约测试（T09/T18）
 *
 * 被测：`src/composables/useTunnelStatus.ts::warmUpTunnelIngress`。
 *
 * 背景：隧道暴露面此前只在「设备配对」页挂载时 prepare，桌面重启后若没人打开
 * 该页，移动端跨网重连必然失败。`App.vue` 挂载时调用本函数做幂等预热。
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | W1 | 中心可用 | `session.relay.config` → `session.tunnel.prepare` 带中心地址 + allowWan |
 * | W2 | 中心不可用 | prepare 仍执行（LAN-only），中心错误不外溢成预热失败 |
 * | W3 | 宿主无隧道面 / prepare 失败 | 返回失败原因（调用方落日志），不抛 |
 * | W4 | dev-shell 无命令面 | no-op（不能把缺面当失败） |
 */
import { describe, it, expect, vi } from 'vitest'
import {
  warmUpTunnelIngress,
  type RelayConfigView,
  type TunnelStatusEnv,
} from '../composables/useTunnelStatus'

interface Call {
  command: string
  args?: Record<string, unknown>
}

/** 命令面替身：记录调用，按表返回 / 抛错 */
function makeEnv(handlers: Record<string, (args?: Record<string, unknown>) => unknown>): {
  env: TunnelStatusEnv
  calls: Call[]
} {
  const calls: Call[] = []
  return {
    calls,
    env: {
      commands: {
        execute: vi.fn(async (command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args })
          const handler = handlers[command]
          if (!handler) throw new Error(`unexpected command: ${command}`)
          return handler(args)
        }),
      },
    },
  }
}

const centerConfig: RelayConfigView = {
  configured: true,
  relayAddrs: ['/ip4/203.0.113.9/tcp/4001/p2p/relay-id'],
  source: 'center',
  centerError: null,
  allowWan: true,
  wanPolicyError: null,
}

describe('warmUpTunnelIngress', () => {
  it('W1 应用启动即按中心地址准备隧道（无需先打开设备页）', async () => {
    const { env, calls } = makeEnv({
      'session.relay.config': () => centerConfig,
      'session.tunnel.prepare': () => ({ started: true }),
    })

    const error = await warmUpTunnelIngress(env)

    expect(error).toBeNull()
    expect(calls.map((call) => call.command)).toEqual([
      'session.relay.config',
      'session.tunnel.prepare',
    ])
    expect(calls[1]?.args).toEqual({
      relayAddrs: centerConfig.relayAddrs,
      allowWan: true,
    })
  })

  it('W2 中心不可用时仍按仅 LAN 预热（中心错误不冒充隧道失败）', async () => {
    const { env, calls } = makeEnv({
      'session.relay.config': () => {
        throw new Error('center down')
      },
      'session.tunnel.prepare': () => ({ started: true }),
    })

    const error = await warmUpTunnelIngress(env)

    expect(error).toBeNull()
    expect(calls.find((call) => call.command === 'session.tunnel.prepare')?.args).toEqual({
      relayAddrs: [],
      allowWan: true,
    })
  })

  it('W3 prepare 失败 → 返回原因（调用方落日志，不阻断首屏）', async () => {
    const { env } = makeEnv({
      'session.relay.config': () => centerConfig,
      'session.tunnel.prepare': () => {
        throw new Error('host tunnel unavailable')
      },
    })

    await expect(warmUpTunnelIngress(env)).resolves.toBe('host tunnel unavailable')
  })

  it('W4 dev-shell 无命令面 = no-op', async () => {
    await expect(warmUpTunnelIngress(null)).resolves.toBeNull()
    await expect(warmUpTunnelIngress(undefined)).resolves.toBeNull()
  })
})
