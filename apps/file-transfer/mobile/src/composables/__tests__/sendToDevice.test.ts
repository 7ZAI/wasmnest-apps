/**
 * 设备行直达发送（T23，移动端）— 与桌面同判据
 */
import { describe, it, expect, vi } from 'vitest'
import type { DeviceRow, DialStatus } from '../deviceState'
import { prepareDeviceSend } from '../sendToDevice'

const NODE = 'b'.repeat(64)

function row(overrides: Partial<DeviceRow> = {}): DeviceRow {
  return {
    nodeId: NODE,
    deviceName: '桌面',
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
    lanAvailable: false,
    connectionModes: 'none',
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

describe('prepareDeviceSend（移动端）', () => {
  it('should_connectBeforeSwitchWhenIdle', async () => {
    const d = deps('connected')
    expect(await prepareDeviceSend(NODE, row(), d)).toEqual({ ok: true })
    expect(d.order).toEqual(['connect', 'switch'])
  })

  it('should_skipConnectWhenAlreadyConnected', async () => {
    const d = deps('connected')
    expect(await prepareDeviceSend(NODE, row({ status: 'connected' }), d)).toEqual({ ok: true })
    expect(d.connect).not.toHaveBeenCalled()
    expect(d.order).toEqual(['switch'])
  })

  it('should_stopOnConnectFailure', async () => {
    const d = deps('denied')
    expect(await prepareDeviceSend(NODE, row(), d)).toEqual({
      ok: false,
      reason: 'connect-failed',
    })
    expect(d.switchPeer).not.toHaveBeenCalled()
  })

  it('should_reportSwitchFailure', async () => {
    const d = deps('connected', false)
    expect(await prepareDeviceSend(NODE, row({ status: 'connected' }), d)).toEqual({
      ok: false,
      reason: 'switch-failed',
    })
  })

  it('should_skipUnsupportedOrMissingRow', async () => {
    const d = deps('connected')
    expect(await prepareDeviceSend(NODE, row({ fileTransfer: false }), d)).toEqual({
      ok: false,
      reason: 'skipped',
    })
    expect(await prepareDeviceSend(NODE, undefined, d)).toEqual({ ok: false, reason: 'skipped' })
    expect(d.connect).not.toHaveBeenCalled()
  })
})
