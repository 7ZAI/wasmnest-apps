/**
 * DeviceCenterView 行为契约（票 14，插件前端）
 *
 * 契约来源：宿主 `DevicesView.vue`（搬走前的行为基线）+ spec D2/D3/D6。
 * 断言的是**外部可见行为**——发往插件后端的调用（命令名 + 入参）、渲染出的
 * 可见内容与文案 key、路由跳转；不测内部实现、不测 mock 自身。
 *
 * 演示数据取 `devMock.pairing`（插件工程持有），保证测试数据与 dev-shell
 * 演示数据同源。
 *
 * 契约清单：
 * - C1 加载：网络信息经 `session.network.info`、设备列表经
 *   `session.devices.paired-list` 取得并渲染（配置无 mock 命令面直调）
 * - C2 生成配对码：`session.pairing.generate` → 页面展示码与剩余秒
 * - C3 生成失败（回执无码）：不静默，提示「未收到有效配对码」
 * - C4 取消配对码：`session.pairing.clear` 且码从页面消失
 * - C5 生成 QR：`session.qr.generate` 带当前选中 host，且二维码画到 canvas
 * - C5b 已有活跃 QR：进入页面恢复展示（不重新生成 token）
 * - C5c Tab 切走再切回：canvas 元素重建后按现有载荷重绘（不重绘 → 空白，2026-09-26 修复）
 * - C5d 路由 KeepAlive 切回（重新激活）时重绘二维码
 * - C5e 宿主提供 peer：默认「局域网」Tab 出 v1 码；切「外网」Tab 出 v3 紧凑隧道载荷
 * - C5f peer 残缺：局域网 Tab 不受影响仍出 v1 码；外网 Tab 显性错误（不静默退回）
 * - C5g 恢复路径的 peer 残缺：外网 Tab 显性失败，局域网 Tab 仍可出码
 * - C5h 复制连接串：剪贴板收到与 QR 同载荷的 `wasmnest://pair/…` 链接
 * - C5i 剪贴板不可用：显性失败提示，不假装已复制
 * - C5j QR 内部分页默认局域网；无 peer 时外网 Tab 不出码、无组装错误
 * - C5k QR 页签紧跟标题（同一头部）；外网页有自己的生成按钮，生成前先 prepare 隧道
 * - C5l 外网页生成命令失败：toast + 可见错误（不静默停在占位态）
 * - C5m 外网页 peer 未产出：不出码但原因可见（toast + 提示）
 * - C5n 真实宿主形状（地址尾部 PeerId ≠ nodeId）：外网 Tab 出 v2 完整载荷，不误报地址不可拨号
 * - C6 在线判定：`device:connected` 事件把设备移入在线区
 * - C7 离线判定：`device:disconnected` 事件把设备移回离线区
 * - C8 设备接入即清除已使用配对码（后端事件驱动状态流转）
 * - C9 撤销设备：确认弹窗 → `session.devices.revoke` → 重新取列表 → 成功提示
 * - C10 撤销失败：提示错误且不重复取列表（不留下「已删除」的假象）
 * - C11 查看历史：跳转同插件的历史目录并带 deviceId
 * - C12 移动端请求配对：后端事件 → 展示码 + 提示
 * - C13 配对码倒计时归零：自动清除后端状态（防过期码复用）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import DeviceCenterView from '../components/DeviceCenterView.vue'
import devMock from '../devMock'

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn(async () => {}),
    // 组件按真实矩阵尺寸选画布规格：给出 v2 典型模块数（85）
    create: vi.fn(() => ({ modules: { size: 85 } })),
  },
}))

const routerPush = vi.hoisted(() => vi.fn(async () => {}))

// app 自有 router（宿主前端下沉：sharedRouter 直读 src/router，测试注入桩）
vi.mock('@/router', () => ({
  default: {
    push: routerPush,
    currentRoute: { value: { query: {} } },
  },
}))

const seed = devMock.pairing

/** T18：中心下发的 relay 地址（`session.relay.config` 回执） */
const RELAY_ADDR =
  '/dns4/relay.example.com/tcp/4001/p2p/12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H'

/** 命令面路由：按命令 id 返演示数据，并记录调用（断言入参） */
/**
 * 命令面路由：按命令 id 返演示数据，并记录调用（断言入参）
 *
 * 返回类型显式标 `Promise<unknown>`：各用例组会 mockImplementation 注入本函数
 * 形状之外的回执（如轮换的 `{rotated, kid}`、以及故意畸形的缺字段回执），
 * 让 TS 按联合类型逐条收窄只会把用例拒之门外。断言全在运行时，类型不承载语义。
 */
async function defaultExecute(command: string, args?: unknown): Promise<unknown> {
  switch (command) {
    case 'session.network.info':
      return seed.network
    case 'session.devices.paired-list':
      return seed.pairedDevices
    case 'session.pairing.generate':
      return seed.pairingCode
    case 'session.pairing.status':
      return seed.pairingCode
    case 'session.pairing.clear':
      return { cleared: true }
    // 默认无活跃 QR（本用例组自行指定恢复/生成路径，避免「恢复」静默掩盖「生成」）
    case 'session.qr.info':
      return null
    case 'session.qr.generate':
      return seed.qr
    case 'session.qr.clear':
      return { cleared: true }
    case 'session.devices.revoke':
      return { removed: true, kind: 'pairing' }
    case 'session.auth.rotate-key':
      return { rotated: true, kid: 'g2', previousKid: 'g1' }
    case 'session.auth.center-status':
      return { registered: true, centerId: 'authc-1234' }
    // T18：relay 地址真源 = 网络配置中心（本用例给中心值）
    case 'session.relay.config':
      return {
        configured: true,
        relayAddrs: [RELAY_ADDR],
        source: 'center',
        centerError: null,
        allowWan: true,
        wanPolicyError: null,
      }
    case 'session.tunnel.prepare':
    case 'session.tunnel.status':
      return seed.tunnel
    default:
      throw new Error(`unexpected command: ${command} (args=${JSON.stringify(args)})`)
  }
}

const execute = vi.fn(defaultExecute)

/** 宿主事件订阅收集器（模拟 context.events.on 的 Tauri 桥接） */
const eventHandlers: Record<string, Array<(payload: unknown) => void>> = {}
const eventDispose = vi.fn()

const storageGet = vi.fn(async () => undefined as unknown)
const storageSet = vi.fn(async () => {})
const storageDelete = vi.fn(async () => {})

function makeContext(): PluginContext {
  return {
    id: 'com.wasmnest.bedcode',
    i18n: {
      // 带 {message} 的降级文案按真实 i18n 语义替换：否则桩只返回 key，
      // 用例锁不住「降级原因必须进可见文案」这条行为
      t: (key: string, params?: Record<string, unknown>) =>
        key === 'pairing.qr.relayDegraded' && params?.message
          ? `中继配置降级：${String(params.message)}`
          : key,
      getI18n: () => ({ global: { locale: { value: 'zh-CN' }, t: (key: string) => key } }),
      registerMessages: vi.fn(),
    },
    commands: { execute },
    storage: { get: storageGet, set: storageSet, delete: storageDelete },
    events: {
      on: (event: string, handler: (payload: unknown) => void) => {
        eventHandlers[event] = eventHandlers[event] ?? []
        eventHandlers[event].push(handler)
        return { dispose: eventDispose }
      },
      emit: vi.fn(),
    },
  } as unknown as PluginContext
}

function mountView() {
  return mount(DeviceCenterView, {
    global: {
      provide: { pluginContext: makeContext() },
      stubs: { teleport: true },
    },
  })
}

/** 触发某个宿主事件（backend push） */
async function fireEvent(event: string, payload?: unknown) {
  for (const handler of eventHandlers[event] ?? []) {
    handler(payload)
  }
  await flushPromises()
}

/** 按文案 key 找按钮（i18n 桩直返 key） */
function findButton(wrapper: ReturnType<typeof mountView>, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)
}

function commandsTo(id: string) {
  return execute.mock.calls.filter((c) => c[0] === id)
}

describe('DeviceCenterView（设备与配对页面）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execute.mockImplementation(defaultExecute)
    storageGet.mockResolvedValue(undefined)
    for (const key of Object.keys(eventHandlers)) delete eventHandlers[key]
  })

  it('C1 加载：网络信息与设备列表各自经插件命令通道取得并渲染', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(commandsTo('session.network.info')).toHaveLength(1)
    expect(commandsTo('session.devices.paired-list')).toHaveLength(1)

    // 端口回显 + 两台配对设备（默认 Tab 为「设备配对」，设备卡片需切 Tab 才渲染）
    expect(wrapper.text()).toContain('9000')
    await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('Pixel 9')
    expect(text).toContain('Reno 12')
    expect(text).toContain('pairing.device.sectionOnline')
    expect(text).toContain('pairing.device.sectionOffline')
  })

  it('C2 生成配对码：命令回执驱动页面展示码与剩余秒，并起倒计时', async () => {
    const wrapper = mountView()
    await flushPromises()

    await findButton(wrapper, 'pairing.code.generate')!.trigger('click')
    await flushPromises()

    expect(commandsTo('session.pairing.generate')).toHaveLength(1)
    expect(wrapper.text()).toContain('123456')
    // 倒计时徽标 = 剩余秒 + 秒文案 key
    expect(wrapper.text()).toContain('60pairing.time.seconds')
  })

  it('C3 生成失败（回执无码）：以失败文案提示，不静默', async () => {
    const wrapper = mountView()
    await flushPromises()

    execute.mockImplementation(async (command: string) => {
      if (command === 'session.pairing.generate') return null
      return defaultExecute(command)
    })
    const { toast } = await import('vue-sonner')

    await findButton(wrapper, 'pairing.code.generate')!.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('pairing.code.generateFailedNoCode')
  })

  it('C4 取消配对码：调 session.pairing.clear 且码从页面消失', async () => {
    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.code.generate')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('123456')

    await findButton(wrapper, 'pairing.button.cancel')!.trigger('click')
    await flushPromises()

    expect(commandsTo('session.pairing.clear')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('123456')
  })

  it('C5 生成 QR：命令带当前选中 host，且载荷渲染进 canvas', async () => {
    const wrapper = mountView()
    await flushPromises()

    await findButton(wrapper, 'pairing.qr.generate')!.trigger('click')
    await flushPromises()

    // 未持久化过 host → 自动选第一个可用 IPv4（与宿主原页同口径）
    expect(commandsTo('session.qr.generate')[0][1]).toEqual({ host: seed.network.addresses[0] })
    expect(wrapper.find('canvas').exists()).toBe(true)

    const QRCode = (await import('qrcode')).default
    expect(QRCode.toCanvas).toHaveBeenCalled()
    const payload = JSON.parse((QRCode.toCanvas as any).mock.calls[0][1])
    expect(payload).toEqual({
      host: seed.qr.host,
      port: seed.qr.port,
      token: seed.qr.token,
    })
  })

  it('C5h 画布按**实际模块数**定尺寸（扫码识别回归锁：固定 192px 时每模块只剩 ~2.2px）', async () => {
    const wrapper = mountView()
    await flushPromises()

    await findButton(wrapper, 'pairing.qr.generate')!.trigger('click')
    await flushPromises()

    const QRCode = (await import('qrcode')).default
    const options = (QRCode.toCanvas as any).mock.calls.at(-1)[2]
    const totalModules = 85 + options.margin * 2
    // 每模块 ≥ 4 CSS px（测试环境 DPR = 1，设备像素与 CSS 像素同值）
    expect(options.width / totalModules).toBeGreaterThanOrEqual(4)
    // 模块边界落在整像素上（非整数比例会把模块画成粗细交替的条纹）
    expect(options.width % totalModules).toBe(0)
    // CSS 尺寸按 DPR 还原，不直接沿用设备像素值（DPR > 1 时会被浏览器插值放大）
    const canvas = wrapper.find('canvas').element as HTMLCanvasElement
    expect(canvas.style.width).toBe(`${options.width}px`)
  })

  it('C5b 已有活跃 QR：进入页面恢复展示（不重新生成 token）', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.info') return seed.qr
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()

    expect(commandsTo('session.qr.info')).toHaveLength(1)
    expect(commandsTo('session.qr.generate')).toHaveLength(0)
    expect(wrapper.find('canvas').exists()).toBe(true)
  })

  it('C5c Tab 切走再切回：canvas 元素重建后按现有载荷重绘（QR 不空白）', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.info') return seed.qr
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()

    const QRCode = (await import('qrcode')).default
    expect(wrapper.find('canvas').exists()).toBe(true)

    await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('canvas').exists()).toBe(false)

    const before = (QRCode.toCanvas as any).mock.calls.length
    await findButton(wrapper, 'pairing.tab.pairing')!.trigger('click')
    await flushPromises()

    expect(wrapper.find('canvas').exists()).toBe(true)
    const calls = (QRCode.toCanvas as any).mock.calls
    // 重绘发生，且绘制目标是重建后的当前 canvas（旧 canvas 已脱离文档）
    expect(calls.length).toBeGreaterThan(before)
    expect(calls[calls.length - 1][0]).toBe(wrapper.find('canvas').element)
  })

  it('C5j QR 内部分页：默认选中「局域网」；无 peer 时外网 Tab 不出码、无组装错误', async () => {
    const wrapper = mountView()
    await flushPromises()

    await findButton(wrapper, 'pairing.qr.generate')!.trigger('click')
    await flushPromises()

    // 默认分页 = 局域网（与历史出码行为一致）
    expect(wrapper.find('[data-testid="pairing-qr-tab-lan"]').attributes('aria-selected')).toBe(
      'true',
    )
    expect(wrapper.find('[data-testid="pairing-qr-tab-wan"]').attributes('aria-selected')).toBe(
      'false',
    )

    // seed.qr 无 peer：外网 Tab 不出隧道码；后端没给 peer 不是「组装失败」，
    // 不显示残缺错误（那是外网能力提示的职责）
    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pairing-qr-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pairing-qr-peer-error"]').exists()).toBe(false)

    // 切回局域网：码照常
    await wrapper.find('[data-testid="pairing-qr-tab-lan"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('canvas').exists()).toBe(true)
  })

  it('C5k QR 页签与标题同行；外网页有自己的生成按钮（先 prepare 隧道再生成，出 v3 码）', async () => {
    const peer = {
      nodeId: '12D3KooWTarget',
      addrs: ['/ip4/192.168.1.5/tcp/47613/p2p/12D3KooWTarget'],
      ticket: 'ticket-once',
    }
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.generate') return { ...seed.qr, peer }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()

    // 页签在 QR 卡片头部（紧跟标题），不是独占一整行的分段控件
    const header = wrapper.find('[data-testid="pairing-qr-header"]')
    expect(header.text()).toContain('pairing.qr.title')
    expect(header.text()).toContain('pairing.qr.tabLan')
    expect(header.text()).toContain('pairing.qr.tabWan')

    execute.mockClear()
    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await flushPromises()

    // 外网页无码时按钮是本页的「生成外网二维码」，不是共享的「刷新」
    const generateWan = wrapper.find('[data-testid="pairing-qr-generate-wan"]')
    expect(generateWan.exists()).toBe(true)
    expect(generateWan.text()).toBe('pairing.qr.generateWan')

    await generateWan.trigger('click')
    await flushPromises()

    // 外网码依赖隧道通道：生成前必须先幂等 prepare（否则换网 / 重激活后拿不到 peer）
    const order = execute.mock.calls.map((c) => c[0])
    const prepareAt = order.indexOf('session.tunnel.prepare')
    expect(prepareAt).toBeGreaterThanOrEqual(0)
    expect(prepareAt).toBeLessThan(order.indexOf('session.qr.generate'))

    const QRCode = (await import('qrcode')).default
    expect(wrapper.find('canvas').exists()).toBe(true)
    const payload = JSON.parse((QRCode.toCanvas as any).mock.calls.at(-1)[1])
    expect(payload.v).toBe(3)
    expect(payload.n).toBe(peer.nodeId)
  })

  it('C5l 外网页生成命令失败：toast + 可见错误上屏（不静默停在占位态）', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.generate') throw new Error('auth center unavailable')
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await wrapper.find('[data-testid="pairing-qr-generate-wan"]').trigger('click')
    await flushPromises()

    const { toast } = await import('vue-sonner')
    expect(toast.error).toHaveBeenCalledWith('pairing.qr.generateFailed')

    const error = wrapper.find('[data-testid="pairing-qr-generate-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toBe('pairing.qr.generateFailed')
    // 命令原文进 title：可见文案给用户，细节留给排障
    expect(error.attributes('title')).toBe('auth center unavailable')
    expect(wrapper.find('canvas').exists()).toBe(false)
  })

  it('C5m 外网页 peer 未产出：不出码但原因可见（toast + 提示），不是空占位', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.generate') {
        return { ...seed.qr, peerError: 'tunnel node has no dialable address' }
      }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await wrapper.find('[data-testid="pairing-qr-generate-wan"]').trigger('click')
    await flushPromises()

    const { toast } = await import('vue-sonner')
    expect(toast.error).toHaveBeenCalledWith('pairing.tunnel.onlyLan')

    // 无隧道码就不出码（不假装外网可达），但原因必须上屏
    expect(wrapper.find('canvas').exists()).toBe(false)
    const hint = wrapper.find('[data-testid="pairing-qr-peer-error"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('pairing.tunnel.onlyLan')
  })

  it('C5n 真实宿主形状（地址尾部 PeerId ≠ nodeId）：外网 Tab 出 v2 完整载荷，不报地址不可拨号', async () => {
    // 2026-11-14 现场：nodeId 是应用层指纹，addrs 尾部是 libp2p PeerId
    const peer = {
      nodeId: '56bc2e94ca6a1f119d014c6bd491ef2a7a6fc68f9354c4c9e9c1354446d31e94',
      addrs: [
        '/ip4/192.168.1.10/tcp/47613/p2p/12D3KooWSFCWtAtXSKNhNAr7D6iYPnEJFfUjSrUTFJqopHuD4UDx',
        '/ip4/113.45.43.60/tcp/4001/p2p/12D3KooWBSCkgKRqQWpPhGGC61TfEWno22bcEGXxQvohhPbQBkud/p2p-circuit/p2p/12D3KooWSFCWtAtXSKNhNAr7D6iYPnEJFfUjSrUTFJqopHuD4UDx',
      ],
      ticket: 'ticket-once',
    }
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.generate') return { ...seed.qr, peer }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await wrapper.find('[data-testid="pairing-qr-generate-wan"]').trigger('click')
    await flushPromises()

    // 不再出现「隧道地址不可拨号」的显性失败
    expect(wrapper.find('[data-testid="pairing-qr-error"]').exists()).toBe(false)

    const QRCode = (await import('qrcode')).default
    expect(wrapper.find('canvas').exists()).toBe(true)
    const payload = JSON.parse((QRCode.toCanvas as any).mock.calls.at(-1)[1])
    // v2 完整地址载荷：nodeId 与地址尾部各自保留原值（移动端按地址直接拨号）
    expect(payload.v).toBe(2)
    expect(payload.peer.nodeId).toBe(peer.nodeId)
    expect(payload.peer.addrs).toEqual(peer.addrs)
  })

  it('C5d 路由 KeepAlive 切回（重新激活）时重绘二维码', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.info') return seed.qr
      return defaultExecute(command)
    })
    // 复刻宿主路由出口：KeepAlive 按 key 缓存页面，切走 deactivate、切回 activate（不重建）
    const view = ref<'pairing' | 'other'>('pairing')
    const Other = defineComponent({ render: () => h('div', 'other') })
    const Host = defineComponent({
      render() {
        return h(KeepAlive, null, [
          view.value === 'pairing'
            ? h(DeviceCenterView, { key: 'pairing' })
            : h(Other, { key: 'other' }),
        ])
      },
    })
    const wrapper = mount(Host, {
      global: { provide: { pluginContext: makeContext() }, stubs: { teleport: true } },
    })
    await flushPromises()

    const QRCode = (await import('qrcode')).default
    expect(wrapper.find('canvas').exists()).toBe(true)

    view.value = 'other'
    await flushPromises()
    const before = (QRCode.toCanvas as any).mock.calls.length

    view.value = 'pairing'
    await flushPromises()

    expect(wrapper.find('canvas').exists()).toBe(true)
    expect((QRCode.toCanvas as any).mock.calls.length).toBeGreaterThan(before)
  })

  it('C5e 宿主提供 peer：默认局域网 Tab 出 v1；外网 Tab 出 v3 紧凑隧道载荷', async () => {
    const peer = {
      nodeId: '12D3KooWTarget',
      addrs: [
        '/ip4/192.168.1.5/tcp/47613/p2p/12D3KooWTarget',
        '/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTarget',
      ],
      ticket: 'ticket-once',
    }
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.generate') return { ...seed.qr, peer }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()

    await findButton(wrapper, 'pairing.qr.generate')!.trigger('click')
    await flushPromises()

    const QRCode = (await import('qrcode')).default

    // 默认「局域网」Tab：v1 三要素载荷（与 peer 无关）
    let payload = JSON.parse((QRCode.toCanvas as any).mock.calls.at(-1)[1])
    expect(payload).toEqual({
      host: seed.qr.host,
      port: seed.qr.port,
      token: seed.qr.token,
    })

    // 切「外网」Tab：v3 紧凑隧道载荷
    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await flushPromises()

    payload = JSON.parse((QRCode.toCanvas as any).mock.calls.at(-1)[1])
    expect(payload).toEqual({
      v: 3,
      h: seed.qr.host,
      p: seed.qr.port,
      t: seed.qr.token,
      n: peer.nodeId,
      a: [
        '/ip4/192.168.1.5/tcp/47613',
        '/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRelay/p2p-circuit',
      ],
      tk: peer.ticket,
    })
  })

  it('C5f peer 残缺：局域网 Tab 不受影响仍出 v1 码；外网 Tab 显性报错（不静默退回）', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.generate') {
        return { ...seed.qr, peer: { nodeId: 'n', addrs: [], ticket: 't' } }
      }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()

    await findButton(wrapper, 'pairing.qr.generate')!.trigger('click')
    await flushPromises()

    // 核心修复：peer 残缺不再连坐——局域网 Tab 照常出码，载荷为 v1
    expect(wrapper.find('canvas').exists()).toBe(true)
    const QRCode = (await import('qrcode')).default
    const payload = JSON.parse((QRCode.toCanvas as any).mock.calls.at(-1)[1])
    expect(payload).toEqual({
      host: seed.qr.host,
      port: seed.qr.port,
      token: seed.qr.token,
    })

    // 外网 Tab：不出隧道码 + 显性错误文案
    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pairing-qr-error"]').text()).toBe(
      'pairing.qr.errorPeerIncomplete',
    )
  })

  it('C5g 恢复路径的 peer 残缺：外网 Tab 显性失败，局域网 Tab 仍可出码', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.info') {
        return { ...seed.qr, peer: { nodeId: 'n', addrs: ['/ip4/0.0.0.0/tcp/1/p2p/x'], ticket: 't' } }
      }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()

    // 默认局域网 Tab：恢复出的码照常出（v1）
    expect(wrapper.find('canvas').exists()).toBe(true)

    // 外网 Tab：显性错误文案
    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pairing-qr-error"]').text()).toBe(
      'pairing.qr.errorPeerAddressInvalid',
    )
  })

  it('C5h 复制连接串：剪贴板收到与 QR 同载荷的 wasmnest://pair 链接', async () => {
    const peer = {
      nodeId: '12D3KooWTarget',
      addrs: ['/ip4/192.168.1.5/tcp/47613/p2p/12D3KooWTarget'],
      ticket: 'ticket-once',
    }
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.generate') return { ...seed.qr, peer }
      return defaultExecute(command)
    })
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const { toast } = await import('vue-sonner')

    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.qr.generate')!.trigger('click')
    await flushPromises()

    // 外网 Tab 的连接串：含 peer 的 v3 载荷
    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="pairing-qr-copy-link"]').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledTimes(1)
    const uri = writeText.mock.calls[0][0] as string
    expect(uri.startsWith('wasmnest://pair/')).toBe(true)

    // 解回 JSON：连接串与 QR 同载荷（不额外夹带长期密钥）
    const base64 = uri.slice('wasmnest://pair/'.length).replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const decoded = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0))),
    )
    expect(decoded).toEqual({
      v: 3,
      h: seed.qr.host,
      p: seed.qr.port,
      t: seed.qr.token,
      n: peer.nodeId,
      a: ['/ip4/192.168.1.5/tcp/47613'],
      tk: peer.ticket,
    })
    expect(toast.success).toHaveBeenCalledWith('pairing.qr.copyLinkDone')
  })

  it('C5i 剪贴板不可用：显性失败提示，不假装已复制', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const { toast } = await import('vue-sonner')

    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.qr.generate')!.trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="pairing-qr-copy-link"]').trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('pairing.qr.copyLinkFailed')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('C6/C7 在线与离线判定由后端事件驱动（同一台设备在两个分区之间迁移）', async () => {
    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
    await flushPromises()

    // 初始：无在线连接 → 两台设备都在离线区
    const offlineSection = () => wrapper.findAll('section')[1].text()
    expect(offlineSection()).toContain('Pixel 9')

    await fireEvent('device:connected', { fingerprint: 'fp-pixel-9' })
    const onlineSection = () => wrapper.findAll('section')[0].text()
    expect(onlineSection()).toContain('Pixel 9')
    expect(offlineSection()).not.toContain('Pixel 9')
    expect(onlineSection()).toContain('pairing.device.connected')

    await fireEvent('device:disconnected', { fingerprint: 'fp-pixel-9' })
    expect(offlineSection()).toContain('Pixel 9')
    expect(onlineSection()).not.toContain('Pixel 9')
  })

  it('C8 设备接入：清除已使用的配对码并重新取设备列表', async () => {
    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.code.generate')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('123456')

    await fireEvent('device:connected', { fingerprint: 'fp-new' })

    expect(commandsTo('session.pairing.clear')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('123456')
    // onMounted 一次 + 事件驱动一次
    expect(commandsTo('session.devices.paired-list')).toHaveLength(2)
  })

  it('C9 撤销设备：确认后调 session.devices.revoke 并重新取列表', async () => {
    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
    await flushPromises()

    // 第一台设备的「移除」按钮
    await findButton(wrapper, 'pairing.button.remove')!.trigger('click')
    await flushPromises()

    // 确认弹窗内的「移除」（危险按钮，与卡片内按钮同文案）
    const confirm = wrapper
      .findAll('button')
      .filter((b) => b.text() === 'pairing.button.remove')
      .find((b) => b.element.closest('.fixed') !== null)
    expect(confirm, '撤销确认弹窗必须出现').toBeTruthy()
    await confirm!.trigger('click')
    await flushPromises()

    expect(commandsTo('session.devices.revoke')[0][1]).toEqual({
      id: seed.pairedDevices[0].id,
    })
    expect(commandsTo('session.devices.paired-list')).toHaveLength(2)
    const { toast } = await import('vue-sonner')
    expect(toast.success).toHaveBeenCalledWith('pairing.device.removed')
  })

  it('C10 撤销失败：以错误文案提示且不重复取列表（不留「已删除」假象）', async () => {
    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
    await flushPromises()

    execute.mockImplementation(async (command: string) => {
      if (command === 'session.devices.revoke') throw new Error('revoke failed')
      return defaultExecute(command)
    })
    const { toast } = await import('vue-sonner')

    await findButton(wrapper, 'pairing.button.remove')!.trigger('click')
    await flushPromises()
    const confirm = wrapper
      .findAll('button')
      .filter((b) => b.text() === 'pairing.button.remove')
      .find((b) => b.element.closest('.fixed') !== null)
    await confirm!.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('pairing.error.revokeFailed')
    expect(toast.success).not.toHaveBeenCalled()
    expect(commandsTo('session.devices.paired-list')).toHaveLength(1)
  })

  it('C11 查看历史：跳转同插件历史目录并带上设备 id', async () => {
    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
    await flushPromises()

    await findButton(wrapper, 'pairing.device.historyView')!.trigger('click')
    await flushPromises()

    expect(routerPush).toHaveBeenCalledWith({
      name: 'plugin-sidebar-view',
      params: { pluginId: 'com.wasmnest.bedcode', viewId: 'session.history' },
      query: { deviceId: seed.pairedDevices[0].id },
    })
  })

  it('C12 移动端请求配对：后端事件展示码并以请求文案提示', async () => {
    const wrapper = mountView()
    await flushPromises()
    const { toast } = await import('vue-sonner')

    await fireEvent('pairing-code-generated', { code: '654321', expires_in: 90 })

    expect(wrapper.text()).toContain('654321')
    expect(wrapper.text()).toContain('90pairing.time.seconds')
    expect(toast.info).toHaveBeenCalledWith('pairing.code.request')
  })

  it('C13 配对码倒计时归零：自动清除后端状态并从页面消失（防过期码复用）', async () => {
    vi.useFakeTimers()
    try {
      execute.mockImplementation(async (command: string) => {
        if (command === 'session.pairing.generate') {
          return { code: '111111', created_at: '2026-09-20T05:00:00Z', expires_in: 1 }
        }
        return defaultExecute(command)
      })
      const wrapper = mountView()
      await vi.advanceTimersByTimeAsync(0)

      await findButton(wrapper, 'pairing.code.generate')!.trigger('click')
      await vi.advanceTimersByTimeAsync(0)
      // 正向断言先行：生成后确实展示（避免恒真断言）
      expect(wrapper.text()).toContain('111111')

      await vi.advanceTimersByTimeAsync(2000)

      expect(commandsTo('session.pairing.clear')).toHaveLength(1)
      expect(wrapper.text()).not.toContain('111111')
    } finally {
      vi.useRealTimers()
    }
  })

  // ==================== 入场密钥轮换（ADR 0033 D4） ====================

  it('C14 轮换入场密钥：确认后调 session.auth.rotate-key 并以代次提示成功', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.auth.rotate-key') {
        return { rotated: true, kid: 'g2', previousKid: 'g1' }
      }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
    await flushPromises()
    const { toast } = await import('vue-sonner')

    // 先点页面上的「轮换密钥」→ 出现确认弹窗
    await findButton(wrapper, 'pairing.key.rotate')!.trigger('click')
    await flushPromises()
    const confirm = wrapper
      .findAll('button')
      .filter((b) => b.text() === 'pairing.key.rotate')
      .find((b) => b.element.closest('.fixed') !== null)
    expect(confirm, '轮换确认弹窗必须出现').toBeTruthy()
    await confirm!.trigger('click')
    await flushPromises()

    expect(commandsTo('session.auth.rotate-key')).toHaveLength(1)
    // 提示携带新代次（kid 只是代次标识，不含密钥材料）
    expect(toast.success).toHaveBeenCalledWith('pairing.key.rotatedTo')
  })

  it('C15 轮换不触发设备列表重取（轮换不撤销，上一密钥在宽限期继续验签）', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.auth.rotate-key') {
        return { rotated: true, kid: 'g2', previousKid: 'g1' }
      }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
    await flushPromises()

    await findButton(wrapper, 'pairing.key.rotate')!.trigger('click')
    await flushPromises()
    const confirm = wrapper
      .findAll('button')
      .filter((b) => b.text() === 'pairing.key.rotate')
      .find((b) => b.element.closest('.fixed') !== null)
    await confirm!.trigger('click')
    await flushPromises()

    // 只在初始加载取过一次列表（与撤销的 C9 相反）
    expect(commandsTo('session.devices.paired-list')).toHaveLength(1)
  })

  it('C16 轮换失败（命令报错）：以错误文案提示，不误报成功', async () => {
    const wrapper = mountView()
    await flushPromises()
    await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
    await flushPromises()
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.auth.rotate-key') throw new Error('rotate failed')
      return defaultExecute(command)
    })
    const { toast } = await import('vue-sonner')

    await findButton(wrapper, 'pairing.key.rotate')!.trigger('click')
    await flushPromises()
    const confirm = wrapper
      .findAll('button')
      .filter((b) => b.text() === 'pairing.key.rotate')
      .find((b) => b.element.closest('.fixed') !== null)
    await confirm!.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('pairing.key.error')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('C17 回执缺代次（rotated/kid 任一为空）：视为未轮换，抛错而非误报成功', async () => {
    // 契约：`rotateSigningKey` 对缺 `rotated`/`kid` 的回执抛错（composable 层），
    // UI 捕获后走错误文案——宁可报失败也不能让用户以为密钥已换
    for (const bad of [{}, { rotated: false, kid: 'g2' }, { rotated: true }, { rotated: true, kid: '' }]) {
      execute.mockImplementation(async (command: string) => {
        if (command === 'session.auth.rotate-key') return bad
        return defaultExecute(command)
      })
      const wrapper = mountView()
      await flushPromises()
      await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
      await flushPromises()
      const { toast } = await import('vue-sonner')
      vi.clearAllMocks()
      execute.mockImplementation(async (command: string) => {
        if (command === 'session.auth.rotate-key') return bad
        return defaultExecute(command)
      })

      await findButton(wrapper, 'pairing.key.rotate')!.trigger('click')
      await flushPromises()
      const confirm = wrapper
        .findAll('button')
        .filter((b) => b.text() === 'pairing.key.rotate')
        .find((b) => b.element.closest('.fixed') !== null)
      await confirm!.trigger('click')
      await flushPromises()

      expect(toast.error, `回执 ${JSON.stringify(bad)} 必须判失败`).toHaveBeenCalledWith('pairing.key.error')
      expect(toast.success).not.toHaveBeenCalled()
    }
  })

  // ==================== 认证中心就位横幅（ADR 0031 欠账 / 票 08 §8.1） ====================

  it('C18 中心已就位：不显示横幅（正向断言先行，避免恒真）', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(commandsTo('session.auth.center-status')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('pairing.center.notReadyTitle')
  })

  it('C19 中心未就位：横幅点名「入站会被拒」并给出修复指引', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.auth.center-status') {
        return { registered: false, error: 'permission denied' }
      }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('pairing.center.notReadyTitle')
    expect(text).toContain('pairing.center.notReadyDesc')
    expect(text).toContain('pairing.center.rebuildHint')
  })

  it('C20 横幅不随 Tab 切换隐藏（入站拒绝与当前看哪个 Tab 无关）', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.auth.center-status') return { registered: false }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('pairing.center.notReadyTitle')

    await findButton(wrapper, 'pairing.tab.devices')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('pairing.center.notReadyTitle')

    await findButton(wrapper, 'pairing.tab.pairing')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('pairing.center.notReadyTitle')
  })

  it('C21 读不到状态：不误报成「未就位」（两者排障路径不同）', async () => {
    // 契约：`loadAuthCenterStatus` 对畸形/缺失回执**抛错**而不是当作 registered=false，
    // 页面因此呈现「状态未知」而不是给出「重建产物」的误导指引
    for (const bad of [undefined, {}, { registered: 'yes' }]) {
      execute.mockImplementation(async (command: string) => {
        if (command === 'session.auth.center-status') return bad
        return defaultExecute(command)
      })
      const wrapper = mountView()
      await flushPromises()

      const text = wrapper.text()
      expect(
        text,
        `回执 ${JSON.stringify(bad)} 不得报成「未就位」`,
      ).not.toContain('pairing.center.notReadyTitle')
      expect(text).toContain('pairing.center.statusUnknown')
      wrapper.unmount()
    }
  })

  it('C22 点刷新会重读就位状态（修完立刻看到横幅消失）', async () => {
    let registered = false
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.auth.center-status') return { registered }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('pairing.center.notReadyTitle')

    // 模拟用户停用/重启插件后重新就位
    registered = true
    await findButton(wrapper, 'pairing.button.refresh')!.trigger('click')
    await flushPromises()

    expect(commandsTo('session.auth.center-status')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('pairing.center.notReadyTitle')
  })

  it('C23 存储的 host 已不在当前网卡列表（换网络 / DHCP 变更）：显示回落首个可用地址并覆写存储', async () => {
    // 存储里是上一张网卡/上一个网络写下的地址，当前枚举里没有它
    storageGet.mockResolvedValue('192.168.9.99')
    const wrapper = mountView()
    await flushPromises()

    // 死地址既不能显示，也不能留给下一次启动
    expect(wrapper.text()).not.toContain('192.168.9.99')
    expect(wrapper.text()).toContain(`${seed.network.addresses[0]}:${seed.network.port}`)
    expect(storageSet).toHaveBeenCalledWith('pairing.qrHost', seed.network.addresses[0])
  })

  it('C24 存储的 host 仍在当前列表（多网卡手选非首个地址）：保留用户选择，不覆写', async () => {
    const manual = seed.network.addresses[1]
    storageGet.mockResolvedValue(manual)
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain(`${manual}:${seed.network.port}`)
    // 值本身已是最新（仍在枚举内），不得被首选项覆盖掉用户手选
    expect(storageSet).not.toHaveBeenCalled()
  })

  it('C25 当前无可用 IPv4：不显示陈旧地址，显示「未选择」并清掉存储里的死值', async () => {
    storageGet.mockResolvedValue('192.168.9.99')
    execute.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'session.network.info') return { port: 9000, addresses: [] }
      return defaultExecute(command, args)
    })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).not.toContain('192.168.9.99')
    expect(wrapper.text()).toContain('pairing.network.notSelected:9000')
    expect(storageDelete).toHaveBeenCalledWith('pairing.qrHost')
    expect(storageSet).not.toHaveBeenCalled()
  })

  it('C26 点刷新：重读网络信息（地址变了即显示最新）并重组活跃二维码载荷', async () => {
    // 首次进入：无存储值 → 自动选首个地址；同时恢复一个活跃二维码（host 为旧地址）
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.qr.info') return { ...seed.qr, host: seed.network.addresses[0] }
      return defaultExecute(command)
    })
    const wrapper = mountView()
    await flushPromises()
    expect(commandsTo('session.network.info')).toHaveLength(1)
    expect(wrapper.text()).toContain(`${seed.network.addresses[0]}:${seed.network.port}`)

    // 期间换网：本机只剩 10.9.9.9
    execute.mockImplementation(async (command: string) => {
      if (command === 'session.network.info') return { port: 9000, addresses: ['10.9.9.9'] }
      if (command === 'session.qr.info') return { ...seed.qr, host: '10.9.9.9' }
      return defaultExecute(command)
    })
    await findButton(wrapper, 'pairing.button.refresh')!.trigger('click')
    await flushPromises()

    expect(commandsTo('session.network.info')).toHaveLength(2)
    expect(wrapper.text()).toContain('10.9.9.9:9000')
    expect(wrapper.text()).not.toContain(`${seed.network.addresses[0]}:${seed.network.port}`)
    // 二维码载荷随新地址重组（token 不变）
    expect(commandsTo('session.qr.info').at(-1)![1]).toEqual({ host: '10.9.9.9' })
  })

  it('C27 隧道状态栏：宿主快照 → 传输模式文案 + 「已加密」常量徽标', async () => {
    const wrapper = mountView()
    await flushPromises()

    // prepare 只在进入页面时调一次（幂等写配置 + 暴露）
    expect(commandsTo('session.tunnel.prepare')).toHaveLength(1)
    expect(wrapper.find('[data-testid="pairing-tunnel-status"]').text()).toBe(
      'pairing.tunnel.ready',
    )
    // 加密不可关闭：徽标是常量事实，不是开关
    const badge = wrapper.find('[data-testid="pairing-tunnel-encryption"]')
    expect(badge.text()).toBe('pairing.tunnel.encryption')
    expect(badge.attributes('title')).toBe('pairing.tunnel.encryptionHint')
  })

  it('C27b 隧道 prepare 显式携带中心下发的 relay 地址（T18）', async () => {
    const wrapper = mountView()
    await flushPromises()

    const prepare = commandsTo('session.tunnel.prepare')
    expect(prepare).toHaveLength(1)
    expect(prepare[0][1]).toEqual({ relayAddrs: [RELAY_ADDR], allowWan: true })
    expect(wrapper.find('[data-testid="pairing-tunnel-relay-source"]').exists()).toBe(false)
  })

  it('C27b2 未配置中心地址时显式传空数组 + allowWan（不再让后端重复等中心）', async () => {
    execute.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'session.relay.config') {
        return {
          configured: false,
          relayAddrs: [],
          source: 'center',
          centerError: null,
          allowWan: true,
          wanPolicyError: null,
        }
      }
      return defaultExecute(command, args)
    })
    const wrapper = mountView()
    await flushPromises()

    expect(commandsTo('session.tunnel.prepare').at(-1)![1]).toEqual({
      relayAddrs: [],
      allowWan: true,
    })
    expect(wrapper.find('[data-testid="pairing-tunnel-relay-source"]').exists()).toBe(false)
  })

  it('C27b3 WAN 注册表读不到时显性可见（策略按默认 true 继续）', async () => {
    execute.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'session.relay.config') {
        return {
          configured: true,
          relayAddrs: [RELAY_ADDR],
          source: 'center',
          centerError: null,
          allowWan: true,
          wanPolicyError: 'wan policy unreadable: timeout',
        }
      }
      return defaultExecute(command, args)
    })
    const wrapper = mountView()
    await flushPromises()

    const badge = wrapper.find('[data-testid="pairing-tunnel-wan-policy-error"]')
    expect(badge.exists()).toBe(true)
    expect(badge.attributes('title')).toBe('wan policy unreadable: timeout')
  })

  it('C27c 中心不可用、正在用缓存时显性提示（T18）', async () => {
    execute.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'session.relay.config') {
        return {
          configured: true,
          relayAddrs: [RELAY_ADDR],
          source: 'cache',
          centerError: 'api call host error: timeout',
        }
      }
      return defaultExecute(command, args)
    })
    const wrapper = mountView()
    await flushPromises()

    const badge = wrapper.find('[data-testid="pairing-tunnel-relay-source"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('pairing.tunnel.relayCache')
    expect(badge.attributes('title')).toBe('api call host error: timeout')
    // 缓存地址仍要传给后端，否则「缓存兜底」只停在界面上
    expect(commandsTo('session.tunnel.prepare').at(-1)![1]).toEqual({
      relayAddrs: [RELAY_ADDR],
      allowWan: true,
    })
  })

  it('C28 隧道不可用：命令失败 → 显性「隧道不可用」，不退化成「就绪」', async () => {
    execute.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'session.tunnel.prepare' || command === 'session.tunnel.status') {
        throw new Error('tunnel unavailable outside wasm runtime')
      }
      return defaultExecute(command, args)
    })
    const wrapper = mountView()
    await flushPromises()

    const strip = wrapper.find('[data-testid="pairing-tunnel-status"]')
    expect(strip.text()).toBe('pairing.tunnel.unavailable')
    expect(strip.attributes('title')).toBe('tunnel unavailable outside wasm runtime')
  })

  it('C29 peer 未产出：局域网 Tab 出 v1 码；外网 Tab 显示「仅内网」原因（不静默）', async () => {
    execute.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'session.qr.generate') {
        // 后端不产出残缺 peer：只有 peerError
        return { ...seed.qr, peerError: 'tunnel node addrs unavailable' }
      }
      return defaultExecute(command, args)
    })
    const wrapper = mountView()
    await flushPromises()

    await findButton(wrapper, 'pairing.qr.generate')!.trigger('click')
    await flushPromises()

    // 默认局域网 Tab：v1 载荷仍可用（能扫，只是仅内网）
    expect(wrapper.find('[data-testid="pairing-qr-copy-link"]').exists()).toBe(true)

    // 外网 Tab：无隧道码，显性提示仅内网
    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('canvas').exists()).toBe(false)
    const hint = wrapper.find('[data-testid="pairing-qr-peer-error"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('pairing.tunnel.onlyLan')
  })

  it('C29b QR 载荷里的中继降级 / 关闭外网不再是死字段', async () => {
    execute.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'session.qr.generate') {
        return {
          ...seed.qr,
          relayError: 'api call host error: timeout',
          wanDisabledByPolicy: true,
        }
      }
      return defaultExecute(command, args)
    })
    const wrapper = mountView()
    await flushPromises()

    await findButton(wrapper, 'pairing.qr.generate')!.trigger('click')
    await flushPromises()

    // 提示在外网 Tab 展示（说明该码的外网可达性）
    await wrapper.find('[data-testid="pairing-qr-tab-wan"]').trigger('click')
    await flushPromises()

    const degraded = wrapper.find('[data-testid="pairing-qr-relay-error"]')
    expect(degraded.exists()).toBe(true)
    expect(degraded.attributes('title')).toBe('api call host error: timeout')
    // 降级原因必须进 {message} 插值：只放 title 会让用户看到未替换的占位符
    expect(degraded.text()).toContain('api call host error: timeout')
    expect(degraded.text()).not.toContain('{message}')
    expect(wrapper.find('[data-testid="pairing-qr-wan-disabled"]').exists()).toBe(true)
  })
})
