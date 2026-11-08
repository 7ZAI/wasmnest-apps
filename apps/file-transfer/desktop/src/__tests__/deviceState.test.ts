/**
 * `parseFoundPayload`（mdns:found 载荷 → 设备缓存条目）+ devMock 种子契约测试
 *
 * 背景（2026-11-02）：devMock 的 nodeId 曾是 32 位 hex，而本解析器只认 64 位小写
 * hex（引擎 node_id = 64 位公钥指纹），种子被整批**静默丢弃**——dev-shell 里一台
 * 设备都不出现且没有任何报错。devMock 已改 64 位，但当时没有用例覆盖
 * 「种子 ↔ 解析器」这条契约，同类漂移会再次无提示发生，故在此钉死：
 * ① 每台种子都能被解析（回归点）；
 * ② 校验的边界：长度 / 非 hex / 缺失 / 非对象一律丢弃；
 * ③ 解析的归一与兜底：大写 id 归一为小写、设备名缺失回退实例名末段、cap 位解读。
 */
import { describe, it, expect } from 'vitest'
import devMock, { NODE_PIXEL, NODE_XIAOMI } from '../devMock'
import type { PeerDevMock } from '../devMockTypes'
import {
  DEVICE_TTL_MS,
  deriveDeviceRows,
  parseFoundPayload,
  sweepStaleDevices,
} from '../composables/deviceState'

const peer = devMock.peer as PeerDevMock
const seeds = peer.deviceSeeds
const firstFound = seeds[0].found

/** 复制一份 found 载荷并替换其中一个 TXT 字段（保持其余形状不变） */
function withTxt(overrides: Record<string, unknown>) {
  return { ...firstFound, txtRecords: { ...firstFound.txtRecords, ...overrides } }
}

describe('devMock 种子与 parseFoundPayload 的契约', () => {
  it('每台设备种子都能解析出缓存条目（32 位 nodeId 曾整批静默丢弃）', () => {
    expect(seeds).toHaveLength(5)
    for (const seed of seeds) {
      const parsed = parseFoundPayload(seed.found)
      expect(parsed, `种子未被解析：${seed.found.txtRecords.name}`).not.toBeNull()
      expect(parsed!.nodeId).toBe(seed.found.txtRecords.id)
      expect(parsed!.nodeId).toHaveLength(64)
      expect(parsed!.deviceName).toBe(seed.found.txtRecords.name)
      expect(parsed!.addr).toBe(seed.found.addresses[0])
      expect(parsed!.port).toBe(seed.found.port)
    }
  })

  it('导出的 nodeId 常量是 64 位互异小写 hex', () => {
    for (const id of [NODE_XIAOMI, NODE_PIXEL]) {
      expect(id).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(NODE_XIAOMI).not.toBe(NODE_PIXEL)
  })

  it('TXT id 非 64 位 / 非 hex / 缺失时丢弃整条载荷', () => {
    expect(parseFoundPayload(withTxt({ id: NODE_XIAOMI.slice(0, 32) }))).toBeNull()
    expect(parseFoundPayload(withTxt({ id: NODE_XIAOMI.slice(0, 63) }))).toBeNull()
    expect(parseFoundPayload(withTxt({ id: `${NODE_XIAOMI}0` }))).toBeNull()
    expect(parseFoundPayload(withTxt({ id: 'z'.repeat(64) }))).toBeNull()
    expect(parseFoundPayload(withTxt({ id: '' }))).toBeNull()
    expect(parseFoundPayload(withTxt({ id: undefined }))).toBeNull()
    // 无 txtRecords / 非对象载荷
    expect(parseFoundPayload({ instanceName: firstFound.instanceName })).toBeNull()
    expect(parseFoundPayload(null)).toBeNull()
    expect(parseFoundPayload('mdns')).toBeNull()
  })

  it('64 位大写 id 归一为小写（指纹展示源口径统一）', () => {
    const parsed = parseFoundPayload(withTxt({ id: NODE_XIAOMI.toUpperCase() }))
    expect(parsed!.nodeId).toBe(NODE_XIAOMI)
  })

  it('设备名缺失时回退实例名末段（去掉引擎前缀）', () => {
    const parsed = parseFoundPayload(withTxt({ name: '' }))
    expect(parsed!.deviceName).toBe(firstFound.instanceName.slice('wasmnest-peer-'.length))
  })

  it('cap 能力位：bit0 清除的设备仍入缓存但不可传文件', () => {
    const capable = parseFoundPayload(withTxt({ cap: '1' }))
    expect(capable!.fileTransfer).toBe(true)
    expect(capable!.capabilitiesHex).toBe('1')
    // 种子里 HomeNAS 就是 cap=0 的「可发现但不可传」设备
    const homeNas = seeds.find((s) => s.found.txtRecords.cap === '0')
    expect(homeNas, '种子需保留一台 cap=0 的设备以覆盖该分支').toBeDefined()
    expect(parseFoundPayload(homeNas!.found)!.fileTransfer).toBe(false)
  })
})


// ==================== T12：传输形态 / 远程设备 ====================

const RELAY_ADDR =
  '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTarget'
const LAN_ADDR = '/ip4/192.168.1.5/tcp/47613'
const NODE_REMOTE = 'f'.repeat(64)

function derive(overrides: Partial<Parameters<typeof deriveDeviceRows>[0]> = {}) {
  return deriveDeviceRows({
    devices: [],
    connectingIds: new Set(),
    connectedIds: new Set(),
    dialErrors: {},
    activePeerId: '',
    ...overrides,
  })
}

describe('deriveDeviceRows · 传输形态与远程设备', () => {
  it('已连接时带出宿主 transport；断开后不残留', () => {
    const device = { nodeId: NODE_REMOTE, deviceName: 'Remote', addr: '', port: 0 }
    const rows = derive({
      devices: [device],
      connectedIds: new Set([NODE_REMOTE]),
      transports: { [NODE_REMOTE]: 'wan-relay' },
    })
    expect(rows[0].transport).toBe('wan-relay')
    const offline = derive({ devices: [device] })
    expect(offline[0].transport).toBeNull()
  })

  it('有 relay 候选才给「尝试外网」入口（LAN-only 设备没有手动入口）', () => {
    const paired = derive({
      devices: [
        { nodeId: NODE_REMOTE, deviceName: 'Remote', addr: '', port: 0, addrs: [LAN_ADDR, RELAY_ADDR], paired: true },
      ],
    })
    expect(paired[0].paired).toBe(true)
    expect(paired[0].wanAvailable).toBe(true)

    const lanOnly = derive({
      devices: [{ nodeId: NODE_XIAOMI, deviceName: 'Phone', addr: '192.168.1.108', port: 47821 }],
    })
    expect(lanOnly[0].wanAvailable).toBe(false)
  })

  it('已建立 relay 连接时即使候选表为空也保留「可尝试外网」事实', () => {
    const rows = derive({
      devices: [{ nodeId: NODE_REMOTE, deviceName: 'Remote' }],
      connectedIds: new Set([NODE_REMOTE]),
      transports: { [NODE_REMOTE]: 'wan-relay' },
    })
    expect(rows[0].wanAvailable).toBe(true)
  })
})

describe('sweepStaleDevices · 配对设备不被 TTL 清扫', () => {
  it('过期远程设备保留，过期发现设备移除', () => {
    const now = Date.now()
    const list = [
      { nodeId: NODE_REMOTE, addr: '', port: 0, addrs: [RELAY_ADDR], paired: true, lastSeenMs: now - DEVICE_TTL_MS * 10 },
      { nodeId: NODE_PIXEL, addr: '192.168.1.132', port: 51044, lastSeenMs: now - DEVICE_TTL_MS * 10 },
    ]
    const kept = sweepStaleDevices(list, now, new Set())
    expect(kept.map((d) => d.nodeId)).toEqual([NODE_REMOTE])
  })
})
