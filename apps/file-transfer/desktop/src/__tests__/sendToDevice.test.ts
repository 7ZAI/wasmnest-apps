/**
 * 设备行直达发送（T23）— 前置编排契约测试
 *
 * 锁住顺序与早退：
 * ① 已连接：不重复拨号，显式切活跃；
 * ② 未连接：先 connect，成功后才 switch（连接失败不进入选择器）；
 * ③ 连接失败 / 切换失败分别返回原因，且不再调用后续步骤；
 * ④ 无能力 / 不存在的行直接跳过。
 */
import { describe, it, expect, vi } from 'vitest'
import type { DeviceRow, DialStatus } from '../composables/deviceState'
import { prepareDeviceSend } from '../composables/sendToDevice'

const NODE = 'a'.repeat(64)

function row(overrides: Partial<DeviceRow> = {}): DeviceRow {
  return {
    nodeId: NODE,
    deviceName: 'NAS',
    addr: '',
    fileTransfer: true,
    status: 'idle',
    dialError: null,
    isActive: false,
    recent: false,
    paired: false,
    relay: false,
    transport: null,
    lastTransport: null,
    wanAvailable: false,
    relayOnlyRecommended: false,
    ...overrides,
  }
}

function deps(connectResult: DialStatus | null, switched = true) {
  const order: string[] = []
  return {
    order,
    connect: vi.fn(async () => {
      order.push('connect')
      return connectResult
    }),
    switchPeer: vi.fn(async () => {
      order.push('switch')
      return switched
    }),
  }
}

describe('prepareDeviceSend', () => {
  it('已连接：不重复拨号，仍显式切活跃', async () => {
    const d = deps('connected')
    const result = await prepareDeviceSend(NODE, row({ status: 'connected' }), d)

    expect(result).toEqual({ ok: true })
    expect(d.connect).not.toHaveBeenCalled()
    expect(d.order).toEqual(['switch'])
  })

  it('未连接：先连接成功再切活跃', async () => {
    const d = deps('connected')
    const result = await prepareDeviceSend(NODE, row(), d)

    expect(result).toEqual({ ok: true })
    expect(d.order).toEqual(['connect', 'switch'])
  })

  it('连接失败：不切活跃（调用方据此不弹选择器）', async () => {
    const d = deps('timeout')
    const result = await prepareDeviceSend(NODE, row(), d)

    expect(result).toEqual({ ok: false, reason: 'connect-failed' })
    expect(d.order).toEqual(['connect'])
  })

  it('连接中重复触发（connect 返回 null）按失败早退', async () => {
    const d = deps(null)
    const result = await prepareDeviceSend(NODE, row({ status: 'connecting' }), d)

    expect(result).toEqual({ ok: false, reason: 'connect-failed' })
    expect(d.switchPeer).not.toHaveBeenCalled()
  })

  it('切换失败：返回 switch-failed', async () => {
    const d = deps('connected', false)
    const result = await prepareDeviceSend(NODE, row({ status: 'connected' }), d)

    expect(result).toEqual({ ok: false, reason: 'switch-failed' })
  })

  it('无能力行 / 不存在的行直接跳过，不产生任何调用', async () => {
    const d = deps('connected')
    expect(await prepareDeviceSend(NODE, row({ fileTransfer: false }), d)).toEqual({
      ok: false,
      reason: 'skipped',
    })
    expect(await prepareDeviceSend(NODE, undefined, d)).toEqual({
      ok: false,
      reason: 'skipped',
    })
    expect(d.connect).not.toHaveBeenCalled()
    expect(d.switchPeer).not.toHaveBeenCalled()
  })
})
