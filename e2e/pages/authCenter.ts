/**
 * Auth Center 页面对象（桌面端 · 系统服务面）
 *
 * 认证中心是宿主系统级服务（internal-business）：入口在主屏「服务」宫格，
 * 不进应用网格。页面只读展示就位三态、认证方式、接入应用与密钥代次。
 */

/** 应用显示名（= plugin.json `name`） */
export const APP_NAME = 'Auth Center'

/** 主屏服务宫格显示名（宿主本地化：zh-CN「认证中心」/ en「Auth Center」） */
export const SYS_ENTRY_NAMES = ['认证中心', 'Auth Center'] as const

export const PAGE = 'auth-center-page'
export const STATUS = 'auth-center-status'
export const STATE = 'auth-center-state'
export const REFRESH = 'auth-center-refresh'
export const ERROR = 'auth-center-error'
export const RETRY = 'auth-center-retry'

export const METHODS = 'auth-center-methods'
export const METHOD_IDS = ['pairing_code', 'qr', 'biometric', 'jwt'] as const
export const methodId = (id: string): string => `auth-center-method-${id}`

export const CONSUMERS = 'auth-center-consumers'
export const CONSUMERS_COUNT = 'auth-center-consumers-count'
export const CONSUMERS_REFRESH = 'auth-center-consumers-refresh'
export const CONSUMERS_ERROR = 'auth-center-consumers-error'
export const CONSUMER_BEDCODE = 'com.wasmnest.bedcode'
export const CONSUMER_FILE_TRANSFER = 'com.wasmnest.file-transfer'
export const consumerRow = (id: string): string => `auth-center-consumer-${id}`
export const consumerState = (id: string): string => `auth-center-consumer-state-${id}`
export const consumerSurface = (id: string, surface: string): string =>
  `auth-center-consumer-surface-${id}-${surface}`

export const KEYS = 'auth-center-keys'
export const KEYS_KID = 'auth-center-keys-kid'
export const KEYS_PREVIOUS = 'auth-center-keys-previous'
export const KEYS_REFRESH = 'auth-center-keys-refresh'
export const KEYS_ROTATE = 'auth-center-keys-rotate'
export const KEYS_ERROR = 'auth-center-keys-error'

/** 状态取值域（页面三态；不把读不到写成未就位） */
export const STATE_DOMAIN = ['registered', 'not_ready', 'unknown'] as const
