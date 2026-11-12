/**
 * 已接入认证中心的应用清单（声明式登记）
 *
 * 真源 = 消费方的互调目标声明（`#[plugin_api(manifest = ".../servers/auth-center/desktop/plugin.json")]`）：
 * - `apps/bedcode/desktop/rust/src/auth_center_client.rs`：设备中心 / 可信设备 /
 *   连接记录 / 密钥轮换；
 * - `apps/file-transfer/rust/plugin/src/auth_center.rs`：首连确认 / 信任列表。
 *
 * 为什么要在页面登记而不是反查宿主：`plugin_list_loaded` 只回插件元数据与运行态，
 * 不带各插件声明的 api 面，宿主没有「谁在消费本中心」的查询原语。新增 / 移除消费方
 * 时必须同步这里（页面据同一份清单查运行态），否则会漏展示或展示已退出的接入方。
 */
import type { AuthCenterConsumer, HostPluginInfo } from './types'

export const AUTH_CENTER_CONSUMERS: readonly AuthCenterConsumer[] = [
  {
    id: 'com.wasmnest.bedcode',
    name: 'BedCode',
    surfaces: ['device-center', 'trust', 'history', 'keys'],
  },
  {
    id: 'com.wasmnest.file-transfer',
    name: 'File Transfer',
    surfaces: ['consent', 'trust'],
  },
]

/** 运行态（宿主 `PluginState` 原值 + 本页的「未安装 / 读不到」） */
export type ConsumerPresence =
  | 'activated'
  | 'loaded'
  | 'activating'
  | 'degraded'
  | 'needsApproval'
  | 'error'
  | 'deactivated'
  | 'missing'
  | 'unknown'

const KNOWN_STATES: readonly ConsumerPresence[] = [
  'activated',
  'loaded',
  'activating',
  'degraded',
  'needsApproval',
  'error',
  'deactivated',
]

/**
 * 宿主条目 → 展示态
 *
 * `missing`（清单在、该应用不在 = 未安装）与 `unknown`（清单本身读不到 / 状态值
 * 不可判读）必须分开：前者是「这台机器没有这个应用」，后者是「查不到」。
 */
export function consumerPresence(info: HostPluginInfo | undefined): ConsumerPresence {
  if (!info) return 'missing'
  const raw = typeof info.state === 'string' ? info.state : info.state?.state
  return KNOWN_STATES.includes(raw as ConsumerPresence) ? (raw as ConsumerPresence) : 'unknown'
}

/** 降级 / 激活失败条目的原因（其余状态没有可展示原因） */
export function consumerStateError(info: HostPluginInfo | undefined): string | null {
  if (!info || typeof info.state === 'string') return null
  const presence = consumerPresence(info)
  if (presence !== 'degraded' && presence !== 'error') return null
  return info.state?.error || null
}
