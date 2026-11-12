/**
 * 宿主页连接 / 会话 / 配对编排 composable（票 2026-10-09：旧宿主主流程下沉）
 *
 * 数据面全部走宿主投影与插件命令（零宿主 Tauri 直连）：
 * - 连接引擎面：mobileApi（connectDevice / connectionStatus / onConnectionEvent /
 *   connectionHistory / mDNS 原始事实 / 生物凭证状态）
 * - 配对 / 会话：插件命令面（bedcode.request-pairing / verify-pairing-code /
 *   list-sessions / start-session / stop-session / remove-session）
 * - 配对事件：context.events（ws_pairing_request / ws_paired / ws_auth_failed 白名单）
 *
 * 归属（§5.1）：派生状态（发现列表归约 / 会话展示形状）在本 composable 内自持，
 * 宿主只投引擎事实；凭据零过境（C4），本域不接触任何 token。
 * 类型注意：mobileApi 的 Ref 来自宿主共享运行时（SDK 声明），直接透传其类型，
 * 不做跨 vue 拷贝的本地 Ref 强转。
 *
 * 机制对齐（旧前端机制 → 新界面，见 ./errors.ts 与 host/i18n.ts）：
 * - 国际化：文案一律 `context.i18n.t`（域内键 `hub.*`）；错误槽位存「i18n key 或原始文案」，
 *   渲染一律 `t(...)`（旧 DevicesView 同口径）
 * - 错误码：`./errors.ts` —— 连接错误分类表（timeout/refused/unreachable/other）+
 *   `ensureCommandOk`（`{code,message}`，code!==0 抛 message||fallbackKey）
 * - 日志：`context.logger`，带 `[host]` 上下文前缀；catch 内必须落日志（禁止静默 catch）
 */

import { computed, inject, ref } from 'vue'
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { getMobileApi } from '@binblink/wasmnest-plugin-sdk-mobile'
import { connectionErrorKey, ensureCommandOk, type CommandResult } from './errors'
import type { QrPayload } from './qr'
import {
  TUNNEL_EVENT,
  applyModeEvent,
  parseConnectResult,
  parseModeEvent,
  tunnelConnectArgs,
  tunnelErrorKey,
  type PeerTarget,
  type TunnelProxyTarget,
  type TunnelStatus,
} from './tunnel'

/** 插件命令 id 前缀（manifest contributes.commands） */
const CMD = 'bedcode.'

/** 错误对象 → 日志文本（旧前端 `logger.error('[域] 动作失败:', e)` 的文本化口径） */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 配对流程状态机（引擎事实 + 本域推进） */
export type PairingStage = 'idle' | 'requested' | 'verifying'

/** 建连目标（最小形状，与 SDK MobileDeviceTarget 一致） */
export interface HostDeviceTarget {
  address: string
  port: number
  name?: string
}

export function useHostPage(provided?: PluginContext) {
  const context = provided ?? inject<PluginContext>('pluginContext')
  if (!context) throw new Error('[host] pluginContext not provided')
  // 闭包捕获收窄后的类型（异步闭包内 TS 不保留窄化）
  const ctx = context
  const api = getMobileApi()
  /** 统一日志入口（与宿主 frontendLogger 同源机制：单参、带 [域] 上下文前缀） */
  const logger = ctx.logger

  // ── 连接引擎态（SDK 类型透传） ──
  // ── 内网穿透（T09）：通道状态 / 拨号 / 生命周期 ──
  /**
   * 当前隧道状态快照（宿主 `host-tunnel.status` 投影）。
   *
   * 模式一律以宿主为准：本域不推断「是不是内网」，只把事实映射成文案;
   * 事件（`peer:mode` 等）到达时并入快照，重启后用 `status` 对账。
   */
  const tunnelStatus = ref<TunnelStatus | null>(null)
  /** 当前隧道句柄（null = 当前连接不经隧道，如旧版 LAN 直连） */
  const tunnelHandle = ref<string | null>(null)
  /** 当前隧道对端 nodeId（状态查询 / 事件归约用） */
  const tunnelNodeId = ref<string | null>(null)

  /** 刷新隧道状态（只读；失败只记日志，不阻断连接流程） */
  async function refreshTunnelStatus(): Promise<void> {
    try {
      const status = (await ctx.commands.execute(`${CMD}tunnel-status`, {
        nodeId: tunnelNodeId.value ?? undefined,
      })) as TunnelStatus
      if (status && typeof status === 'object') tunnelStatus.value = status
    } catch (e) {
      // 宿主无隧道面 / 插件权限缺失：状态不可得（界面显示「未知」，不伪造）
      logger.warn(`[tunnel] status unavailable: ${errText(e)}`)
    }
  }

  /**
   * 建隧道（QR v2 / 连接串带 `peer` 时）：宿主拨号 → 本地回环代理地址。
   *
   * 返回 `null` = 载荷没有 `peer`（旧版 LAN 直连路径，行为不回归）。
   * 失败按宿主错误码映射文案上抛——「内网不可达」必须可区分于「配对失败」。
   */
  async function openTunnel(payload: QrPayload): Promise<TunnelProxyTarget | null> {
    const args = tunnelConnectArgs(payload, Date.now())
    if (!args) return null
    return connectTunnel(args)
  }

  /**
   * 手动「尝试外网」：用已记录的 relay 地址重建拨号（LAN 候选故意不带）。
   *
   * 用户动作即判据（宿主侧 `user` 归因）——本域不自己把「内网不可达」改判成外网，
   * 只把用户意图 + 已知 relay 候选交给宿主重试。
   */
  async function tryWan(target: PeerTarget): Promise<TunnelProxyTarget> {
    if (!target.relayAddrs || target.relayAddrs.length === 0) {
      throw new Error('hub.tunnelErrorRelayUnavailable')
    }
    if (!target.port) throw new Error('hub.tunnelErrorPortNotExposed')
    return connectTunnel({
      nodeId: target.nodeId,
      port: target.port,
      kind: 'http',
      addrs: target.relayAddrs.slice(),
      nowMs: Date.now(),
    })
  }

  /** 拨号公共路径：先关旧句柄（句柄不叠加），再建新通道 → 回环代理地址 */
  async function connectTunnel(args: {
    nodeId: string
    port: number
    kind: 'http'
    addrs: string[]
    pairingTicket?: string
    nowMs: number
  }): Promise<TunnelProxyTarget> {
    tunnelNodeId.value = args.nodeId
    await closeTunnel()
    try {
      const result = await ctx.commands.execute(`${CMD}tunnel-connect`, args)
      const proxy = parseConnectResult(result)
      tunnelHandle.value = proxy.handle
      await refreshTunnelStatus()
      return proxy
    } catch (e) {
      const message = errText(e)
      // 状态仍要刷新：失败模式（如 lan-unreachable）是界面给手动入口的判据
      await refreshTunnelStatus()
      throw new Error(tunnelErrorKey(message) ?? message)
    }
  }

  /**
   * 关隧道（显式断开 / 卸载时）：先关通道再断 WS。
   *
   * 顺序反了会让宿主自动重连去拨一个已关闭的 127.0.0.1 端口（静默重试，
   * 表现为「一直重连」而无任何可操作提示）。
   */
  async function closeTunnel(): Promise<void> {
    const handle = tunnelHandle.value
    tunnelHandle.value = null
    if (!handle) return
    try {
      await ctx.commands.execute(`${CMD}tunnel-close`, { handle })
    } catch (e) {
      logger.warn(`[tunnel] close ${handle} failed: ${errText(e)}`)
    }
  }

  /** 写 `allowWan`（关闭只关外网通道；加密与内网入口不受影响） */
  async function setAllowWan(allowWan: boolean): Promise<void> {
    await ctx.commands.execute(`${CMD}set-allow-wan`, { allowWan })
    await refreshTunnelStatus()
  }

  /** 忘记对端（解配 / 撤销后清理本地记录；宿主信任表由配对域处理） */
  async function forgetPeer(nodeId: string): Promise<void> {
    try {
      await ctx.commands.execute(`${CMD}forget-peer`, { nodeId })
    } catch (e) {
      logger.warn(`[tunnel] forget ${nodeId} failed: ${errText(e)}`)
    }
    await refreshTunnelStatus()
  }

  const connectionStatus = api.connectionStatus
  const currentDevice = api.currentDevice
  const isConnecting = api.isConnecting

  /** 已认证（paired）：传输层连上只算 connected，未认证时受保护端点一律 401 */
  const isAuthenticated = computed(() => api.isPaired.value)

  /** 已连上但尚未认证（等待配对 / 请求配对中）：连接页据此露出认证入口 */
  const needsAuth = computed(
    () =>
      !isAuthenticated.value &&
      (connectionStatus.value === 'connected' || connectionStatus.value === 'pairing'),
  )

  const connectionError = ref('')
  const reconnectBanner = ref('')
  const connectingName = ref('')
  const deviceError = ref('')

  /**
   * 连接目标设备：探测 + 建 WS 事件通道（引擎动作）。失败按 errors.ts 分类表落 i18n key。
   *
   * 默认在连上后尝试「用宿主持有的凭据静默换新 JWT」——重启后宿主只有恢复的 global
   * token，不换新则永远停在 connected（事件通道建不起来、受保护端点 401），返回用户
   * 还得重新配对。`silentAuth=false` 跳过：扫码连接自带一次性 token，先试旧凭据只会
   * 多跑一次注定被拒的请求。
   *
   * 返回值 `authenticated` **以本次静默认证的结果为准**，而不是读 `api.isPaired`：
   * 认证成功与 `ws_paired` 事件到达宿主是两步，调用方若拿状态位做判据会在竞态里
   * 把「已静默换新成功」误判成「未认证」而弹出配对口。
   */
  async function connectDevice(
    device: HostDeviceTarget,
    options: { silentAuth?: boolean; pairingOnly?: boolean } = {},
  ): Promise<{ authenticated: boolean }> {
    deviceError.value = ''
    connectingName.value = device.name || device.address
    try {
      // pairingOnly 由宿主壳实现：只写目标 + HTTP base，不探测（隧道配对窗口只
      // 放行 /api/auth/*，探测会先消费一次性票据）。认证成功后事件 WS 由宿主
      // supervisor 自动建立，不需要再连接一次。
      if (options.pairingOnly) {
        await api.connectDevice(device, { pairingOnly: true })
        return { authenticated: false }
      }
      await api.connectDevice(device)
      let authenticated = api.isPaired.value
      if (options.silentAuth !== false && !authenticated) {
        authenticated = await api.authenticateWithStoredToken()
        if (!authenticated) {
          logger.info(`[host] stored credentials unusable, pairing required: ${device.address}`)
        }
      }
      return { authenticated }
    } catch (e) {
      deviceError.value = connectionErrorKey(errText(e))
      logger.error(
        `[host] connect failed: address=${device.address} port=${device.port} ${errText(e)}`,
      )
      throw e
    } finally {
      connectingName.value = ''
    }
  }

  /** 取消进行中的连接（引擎取消动作；失败只记日志，UI 由状态事件收敛） */
  async function cancelConnect(): Promise<void> {
    try {
      await api.cancelConnection()
    } catch (e) {
      logger.warn(`[host] cancel connection failed: ${errText(e)}`)
    }
  }

  function disconnect(): Promise<void> {
    return api.disconnect()
  }

  // ── mDNS 原始事实（SDK 类型透传） ──
  const mdnsServices = api.mdnsServices
  const mdnsScanning = api.mdnsScanning

  async function startScan(keepResults = false): Promise<void> {
    try {
      await api.mdnsStart({ keepResults })
    } catch (e) {
      // 引擎启动失败：UI 保持当前扫描态（旧 DevicesView 同口径，不弹错误），但必须可观测
      logger.error(`[host] mdns start failed: ${errText(e)}`)
    }
  }
  async function stopScan(): Promise<void> {
    try {
      await api.mdnsStop()
    } catch (e) {
      logger.warn(`[host] mdns stop failed: ${errText(e)}`)
    }
  }

  // ── 连接历史（引擎事实） ──
  const connectionHistory = api.connectionHistory
  async function loadHistory(force = false): Promise<void> {
    await api.loadConnectionHistory(force)
  }
  async function clearHistory(): Promise<void> {
    await api.clearConnectionHistory()
  }
  /**
   * 写入/更新一条连接历史（旧 DevicesView 在认证成功后调用）
   *
   * 去重置顶与上限由宿主域（`useMobileConnection.addToConnectionHistory`）决定，
   * 插件只负责「何时记一笔」——认证成功。失败只记日志：历史是锦上添花，
   * 不能因为写历史失败而让一次成功的连接变红。
   */
  async function addHistory(address: string, name?: string): Promise<void> {
    try {
      await api.addToConnectionHistory(address, name)
    } catch (e) {
      logger.warn(`[host] add connection history failed: ${errText(e)}`)
    }
  }
  /** 从连接历史移除单条（旧连接历史行上的 × 按钮） */
  async function removeHistory(address: string): Promise<void> {
    try {
      await api.removeFromConnectionHistory(address)
    } catch (e) {
      logger.warn(`[host] remove connection history failed: ${errText(e)}`)
    }
  }

  /**
   * 宿主机设置只读投影（旧 DevicesView 读 `useMobileSettings().settings` 的同源面）
   *
   * 连接页据此取「首选认证方式 / 默认端口」，会话页取「终端上限」——设置页经
   * KV 桥写同名键时宿主会写穿该单例，故这里的读与设置页的写同源、不回退到默认值。
   */
  const mobileSettings = api.mobileSettings

  // ── 配对编排（插件命令面；事件驱动进度） ──
  const pairingStage = ref<PairingStage>('idle')
  const pairingError = ref('')
  const pairingCode = ref('')

  async function requestPairing(): Promise<void> {
    pairingError.value = ''
    await ctx.commands.execute(`${CMD}request-pairing`)
    pairingStage.value = 'requested'
  }

  async function verifyPairingCode(code: string): Promise<boolean> {
    pairingError.value = ''
    pairingStage.value = 'verifying'
    try {
      const res = ensureCommandOk(
        (await ctx.commands.execute(`${CMD}verify-pairing-code`, { code })) as {
          accepted?: boolean
        },
        'hub.pairingFailed',
      )
      if (!res?.accepted) {
        // 业务拒绝：指令面受理（{accepted:false}）而不是抛错 —— 记 warn 并落可展示文案
        pairingError.value = 'hub.pairingFailed'
        pairingStage.value = 'idle'
        logger.warn('[host] pairing code rejected by host')
        return false
      }
      pairingStage.value = 'idle'
      pairingCode.value = ''
      return true
    } finally {
      if (pairingStage.value === 'verifying') pairingStage.value = 'idle'
    }
  }

  /** 扫码认证（插件命令面；token 来自桌面端二维码，凭据仍留宿主） */
  async function authenticateWithQr(token: string): Promise<boolean> {
    const res = ensureCommandOk(
      (await ctx.commands.execute(`${CMD}authenticate-with-qr`, { token })) as {
        accepted?: boolean
      },
      'hub.qrFailed',
    )
    if (!res?.accepted) logger.warn('[host] qr auth rejected by host')
    return !!res?.accepted
  }

  /** 生物登录（插件命令面；凭据仍留宿主） */
  async function authenticateWithBiometric(): Promise<boolean> {
    const res = ensureCommandOk(
      (await ctx.commands.execute(`${CMD}authenticate-with-biometric`)) as {
        accepted?: boolean
      },
      'hub.pairingFailed',
    )
    if (!res?.accepted) logger.warn('[host] biometric auth rejected by host')
    return !!res?.accepted
  }

  /** 生物凭证状态（引擎窄读投影；材料零过境） */
  const biometric = ref<{ deviceSupported: boolean; deviceReason: number; hasKey: boolean } | null>(
    null,
  )
  async function refreshBiometric(): Promise<void> {
    try {
      biometric.value = await api.getBiometricKeyStatus()
    } catch (e) {
      // 状态读取失败：置空即隐藏生物入口（不阻断主流程），但失败必须可观测
      biometric.value = null
      logger.warn(`[host] biometric status probe failed: ${errText(e)}`)
    }
  }
  async function bindBiometric(): Promise<boolean> {
    const ok = await api.bindBiometricCredential()
    if (!ok) logger.warn('[host] bind biometric credential rejected')
    return ok
  }
  async function unbindBiometric(): Promise<boolean> {
    const ok = await api.unbindBiometricCredential()
    if (!ok) logger.warn('[host] unbind biometric credential rejected')
    return ok
  }

  // ── 会话 / 会话配置（宿主连接域投影 + 插件命令面） ──
  const sessions = api.activeSessions
  const sessionConfigs = api.sessionConfigs

  async function refreshSessions(): Promise<void> {
    await api.loadActiveSessions()
    await api.loadSessionConfigs()
  }

  /** 从会话配置启动会话；成功返回新会话 id，失败抛 `message || 'hub.startFailed'` */
  async function startSession(configId: string): Promise<string | null> {
    const res = ensureCommandOk(
      (await ctx.commands.execute(`${CMD}start-session`, { configId })) as CommandResult<{
        sessionId?: string
      }>,
      'hub.startFailed',
    )
    return res?.data?.sessionId ?? null
  }

  async function stopSession(sessionId: string): Promise<void> {
    ensureCommandOk(
      (await ctx.commands.execute(`${CMD}stop-session`, { sessionId })) as CommandResult,
      'hub.stopFailed',
    )
  }

  async function removeSession(sessionId: string): Promise<void> {
    ensureCommandOk(
      (await ctx.commands.execute(`${CMD}remove-session`, { sessionId })) as CommandResult,
      'hub.removeFailed',
    )
  }

  // ── 事件订阅（白名单） ──
  function subscribe(): Disposable[] {
    const disposables: Disposable[] = []

    // 配对进度事件（host-events 逐字透传，载荷形状与退役前一致）
    disposables.push(
      ctx.events.on('ws_pairing_request', () => {
        pairingStage.value = 'requested'
      }),
    )
    disposables.push(
      ctx.events.on('ws_pairing_verified', () => {
        pairingStage.value = 'idle'
        pairingCode.value = ''
      }),
    )
    disposables.push(
      ctx.events.on('ws_paired', () => {
        pairingStage.value = 'idle'
        pairingCode.value = ''
        pairingError.value = ''
      }),
    )
    disposables.push(
      ctx.events.on('ws_auth_failed', (payload: any) => {
        pairingError.value = payload?.reason || payload?.message || 'hub.pairingFailed'
      }),
    )

    // 连接生命周期事件（引擎事实）：横幅 + 认证拒绝提示
    disposables.push(
      api.onConnectionEvent((event) => {
        switch (event.type) {
          case 'reconnecting':
            reconnectBanner.value = String(event.retry ?? 0)
            break
          case 'reconnected':
          case 'unexpected_disconnect':
          case 'reconnect_failed':
            reconnectBanner.value = ''
            break
          case 'reauth_rejected':
            pairingError.value = 'hub.pairingFailed'
            break
          default:
            break
        }
      }),
    )

    // 隧道 / 传输事件（T09）：模式变更并入快照；错误进状态槽（不弹模态）
    disposables.push(
      ctx.events.on(TUNNEL_EVENT, (envelope: any) => {
        const topic = envelope?.topic
        const payload = envelope?.payload
        if (topic === 'peer:mode') {
          const event = parseModeEvent(payload)
          if (event)
            tunnelStatus.value = applyModeEvent(tunnelStatus.value, tunnelNodeId.value, event)
          return
        }
        if (topic === 'tunnel:error') {
          const detail = payload?.detail || payload?.message || ''
          const key = tunnelErrorKey(detail)
          if (key) deviceError.value = key
          logger.warn(`[tunnel] host error: ${detail}`)
          return
        }
        // tunnel:state / peer:transport：状态快照对账（字段以宿主为准）
        void refreshTunnelStatus()
      }),
    )

    return disposables
  }

  return {
    /** 插件上下文（命令 / 事件 / 组件内透传） */
    context,
    api,
    /** 统一日志入口（组件 catch 内必须用：禁止静默 catch） */
    logger,
    // state
    connectionStatus,
    isAuthenticated,
    needsAuth,
    currentDevice,
    isConnecting,
    connectionError,
    reconnectBanner,
    connectingName,
    // 错误槽位：i18n key 或原始文案，渲染一律 `t(...)`（旧前端既定口径）
    deviceError,
    mdnsServices,
    mdnsScanning,
    connectionHistory,
    mobileSettings,
    sessions,
    sessionConfigs,
    pairingStage,
    pairingError,
    pairingCode,
    biometric,
    // tunnel（T09）
    tunnelStatus,
    tunnelHandle,
    tunnelNodeId,
    // actions
    connectDevice,
    cancelConnect,
    disconnect,
    refreshTunnelStatus,
    openTunnel,
    tryWan,
    closeTunnel,
    setAllowWan,
    forgetPeer,
    startScan,
    stopScan,
    loadHistory,
    clearHistory,
    addHistory,
    removeHistory,
    requestPairing,
    verifyPairingCode,
    authenticateWithQr,
    authenticateWithBiometric,
    refreshBiometric,
    bindBiometric,
    unbindBiometric,
    refreshSessions,
    startSession,
    stopSession,
    removeSession,
    subscribe,
    t: context.i18n.t.bind(context.i18n),
    toast: context.dialogs,
  }
}