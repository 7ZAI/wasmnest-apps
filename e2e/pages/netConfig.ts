/**
 * Network Config 页面对象（桌面端 · 系统服务面，T18）
 *
 * 网络配置中心与 auth-center 同为 L2 服务型 wasm：入口在主屏「服务」宫格，
 * 不进应用网格。页面承载 relay 配置（当前值 / 部署文本 / 导入 / 探测出路）与
 * 业务 WAN 注册表。
 */

/** 应用显示名（= plugin.json `name`） */
export const APP_NAME = 'Network Config'

/** 主屏服务宫格显示名（宿主本地化：zh-CN「网络配置」/ en「Network Config」） */
export const SYS_ENTRY_NAMES = ['网络配置', 'Network Config', '网络配置中心'] as const

export const PAGE = 'net-config-page'
export const REFRESH = 'net-config-refresh'

export const CURRENT_CARD = 'net-config-current-card'
export const STATE_CONFIGURED = 'net-config-state-configured'
export const STATE_EMPTY = 'net-config-state-empty'
export const LOAD_ERROR = 'net-config-load-error'
export const CURRENT = 'net-config-current'
export const CURRENT_PEER_ID = 'net-config-current-peer-id'
export const CURRENT_FINGERPRINT = 'net-config-current-fingerprint'
export const CURRENT_ADDRS = 'net-config-current-addrs'
export const CURRENT_SOURCE = 'net-config-current-source'
export const CLEAR = 'net-config-import-clear'

export const DEPLOY = 'net-config-deploy'
export const DEPLOY_ADVERTISE = 'net-config-deploy-advertise'
export const DEPLOY_OUTPUT = 'net-config-deploy-output'
export const DEPLOY_ERROR = 'net-config-deploy-error'
export const DEPLOY_EMPTY = 'net-config-deploy-empty'
export const deployMode = (mode: 'compose' | 'docker' | 'systemd'): string =>
  `net-config-deploy-mode-${mode}`

export const IMPORT = 'net-config-import'
export const IMPORT_INPUT = 'net-config-import-input'
export const IMPORT_SUBMIT = 'net-config-import-submit'
export const IMPORT_ERROR = 'net-config-import-error'
export const IMPORT_OK = 'net-config-import-ok'

export const PROBE = 'net-config-probe'
export const PROBE_BUTTON = 'net-config-probe-button'
export const PROBE_EMPTY = 'net-config-probe-empty'
export const PROBE_RESULT = 'net-config-probe-result'
export const PROBE_RTT = 'net-config-probe-rtt'
export const PROBE_OK = 'net-config-probe-ok'
export const PROBE_ERROR = 'net-config-probe-error'
export const PROBE_UNSUPPORTED = 'net-config-probe-unsupported'
export const PROBE_DOCTOR = 'net-config-probe-doctor'

export const WAN = 'net-config-wan'
export const WAN_EMPTY = 'net-config-wan-empty'
export const WAN_ERROR = 'net-config-wan-error'
export const wanRow = (pluginId: string): string => `net-config-wan-row-${pluginId}`
export const wanState = (pluginId: string): string => `net-config-wan-state-${pluginId}`
export const wanToggle = (pluginId: string): string => `net-config-wan-toggle-${pluginId}`
