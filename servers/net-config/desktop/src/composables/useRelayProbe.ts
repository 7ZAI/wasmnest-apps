/**
 * relay 连通性探测（T19）
 *
 * 只导出一个动作：对**已保存**的中继地址做一次只读探测。地址不接受前端入参——
 * 真源在 `network.relay.relayAddrs`，命令自己读，前端只按结果渲染（否则这个按钮
 * 会变成任意 multiaddr 拨号器）。
 *
 * 失败语义（fail-visible）：宿主返回 `code: detail` 串，本层只拆码与明细，**不**
 * 把失败降级成「未配置」或「不可用」；未知码原样展示明细，不吞。
 */
import { ref, type Ref } from 'vue'
import type { NetConfigContext } from '@/appContext'

/** 命令名（manifest `contributes.commands` 的真源字面量） */
export const RELAY_PROBE_COMMAND = 'net-config.relay.probe'

/** 探测报告（能力域 `host-tunnel.probe-relay` 的 JSON 形状，v1） */
export interface RelayProbeReport {
  v: number
  addr: string
  peerId: string
  peerIdSha256: string
  handshakeMs: number
  rttMs: number | null
  checkedAt: string
}

export type RelayProbeErrorKey =
  | 'relay.probe.errorUnreachable'
  | 'relay.probe.errorIdentity'
  | 'relay.probe.errorAddress'
  | 'relay.probe.errorRateLimited'
  | 'relay.probe.errorNotConfigured'
  | 'relay.probe.errorPermission'
  | 'relay.probe.unsupported'
  | 'relay.probe.errorUnknown'

export interface RelayProbeFailure {
  /** i18n 键（按错误码映射；未知码走 errorUnknown） */
  key: RelayProbeErrorKey
  /** 原始错误码（未知码也保留，便于排查） */
  code: string
  detail: string
}

export interface RelayProbeState {
  running: Ref<boolean>
  report: Ref<RelayProbeReport | null>
  failure: Ref<RelayProbeFailure | null>
  run: () => Promise<void>
  reset: () => void
}

/** 错误码 → 文案键（能力域 `tunnel/probe.rs` 的词表） */
const ERROR_KEYS: Record<string, RelayProbeErrorKey> = {
  'relay-unreachable': 'relay.probe.errorUnreachable',
  'relay-identity-mismatch': 'relay.probe.errorIdentity',
  'relay-address-invalid': 'relay.probe.errorAddress',
  'probe-rate-limited': 'relay.probe.errorRateLimited',
  'relay-not-configured': 'relay.probe.errorNotConfigured',
  'tunnel-unavailable': 'relay.probe.unsupported',
  permission: 'relay.probe.errorPermission',
}

export function probeErrorKey(code: string): RelayProbeErrorKey {
  return ERROR_KEYS[code] ?? 'relay.probe.errorUnknown'
}

/**
 * `code: detail` → 结构化失败
 *
 * 只认「行首 kebab-case 码 + 冒号」：宿主返回的都是这个形状（能力域 `as_wire_error`
 * 与权限门串）；对不上形状的（例如平台层包了一层的 `xxx: yyy`）整串进 detail，
 * 不猜码——猜错会把权限拒绝渲染成「relay 不可达」。
 */
export function splitWireError(message: string): { code: string; detail: string } {
  const text = message.trim()
  // 权限门串是既有词汇（`permission denied: tunnel:probe`，中间带空格），先认它
  const denied = 'permission denied:'
  if (text.startsWith(denied)) {
    return { code: 'permission', detail: text.slice(denied.length).trim() }
  }
  const match = /^([a-z][a-z0-9-]*):\s?([\s\S]*)$/.exec(text)
  if (!match) return { code: '', detail: text }
  return { code: match[1], detail: match[2].trim() }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 回执形状校验：能力域契约变动时显性报错，不把 undefined 当字段渲染 */
export function isProbeReport(value: unknown): value is RelayProbeReport {
  if (!value || typeof value !== 'object') return false
  const report = value as Record<string, unknown>
  return (
    typeof report.addr === 'string' &&
    typeof report.peerId === 'string' &&
    typeof report.peerIdSha256 === 'string' &&
    typeof report.handshakeMs === 'number' &&
    (report.rttMs === null || typeof report.rttMs === 'number') &&
    typeof report.checkedAt === 'string'
  )
}

export function useRelayProbe(context: NetConfigContext): RelayProbeState {
  const running = ref(false)
  const report = ref<RelayProbeReport | null>(null)
  const failure = ref<RelayProbeFailure | null>(null)

  function reset(): void {
    report.value = null
    failure.value = null
  }

  async function run(): Promise<void> {
    if (running.value) return
    running.value = true
    // 新一轮开始即清掉上一轮结论：不让旧「成功」与新一轮失败同屏
    reset()
    try {
      const payload = await context.appInvoke<RelayProbeReport>(RELAY_PROBE_COMMAND)
      if (!isProbeReport(payload)) {
        throw new Error('unexpected payload from net-config.relay.probe')
      }
      report.value = payload
    } catch (error) {
      const { code, detail } = splitWireError(messageOf(error))
      failure.value = { key: probeErrorKey(code), code, detail }
    } finally {
      running.value = false
    }
  }

  return { running, report, failure, run, reset }
}
