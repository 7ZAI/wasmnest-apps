/**
 * 认证中心页面 wire 类型（真源 = 本 app Rust 命令面 `auth-center.*`）
 *
 * 就位状态三态（issue #6 D3）：`registered` / `not_ready` / `unknown`。
 * `unknown` 是**读不到**（注册结果尚未写入 / 状态记录不可用），与 `not_ready`
 * （确知未注册）必须分开呈现——两者的排障方向完全不同。
 *
 * 其余类型的字段名逐字对齐 Rust 侧 serde（camelCase）：认证记录域
 * `auth_records/model.rs`、信任视图 `trust/model.rs`、配对码 / QR / 密钥代次
 * 由 `lib.rs` 命令面组装。改一边必须改另一边（wire 即契约）。
 */

/** 就位三态 */
export type CenterState = 'registered' | 'not_ready' | 'unknown'

/** 单条认证方式的可用性（声明 ≠ 可用：未实现的声明必须显式标不可用） */
export interface AuthMethodView {
  /** `pairing_code` / `qr` / `biometric` / `jwt` */
  id: string
  available: boolean
}

/** `auth-center.status` 返回体 */
export interface CenterStatus {
  state: CenterState
  /** 非就位 / 读不到时的原因码（就位时为 null） */
  reason: string | null
  /** 在册属主（插件 id；就位时由宿主注册表给出，其余为 null） */
  owner: string | null
  /** 宿主铸的中心句柄（`authc-<uuid>`；仅就位时非 null） */
  centerId: string | null
  /** 本中心声明的认证方式 */
  methods: AuthMethodView[]
  /** 插件版本（manifest 版本） */
  version: string
}

/** `auth-center.pairing-code.generate|status` → 宿主 `PairingCode` 形状（`null` = 无活跃码） */
export interface PairingCodeView {
  code: string
  /** RFC3339 UTC（宿主同名字段逐字一致） */
  created_at: string
  /** **剩余**秒数（不是原始 TTL） */
  expires_in: number
}

/** `auth-center.qr-code.generate|status` → `null` = 无活跃 token */
export interface QrTokenView {
  token: string
  /** 签发时的有效期（秒） */
  ttl: number
  /** 剩余秒数 */
  remaining: number
}

/** 信任条目来源判别（统一视图第一判别字段） */
export type TrustKind = 'pairing' | 'peer'

/** 统一视图条目（`auth-center.trust.list` → `devices[]`） */
export interface TrustedDeviceView {
  kind: TrustKind
  /** pairing = 配对记录 id；peer = 节点 ID */
  id: string
  name?: string | null
  fingerprint?: string | null
  fingerprintShort?: string | null
  addedAt: string
  lastSeen?: string | null
  connectCount?: number | null
}

/** `auth-center.trust.list` 返回体（peer 段不可用时 `peerError` 透出原因，pairing 段照旧） */
export interface TrustListView {
  devices: TrustedDeviceView[]
  peerError: string | null
}

/** 已配对设备（`auth-center.devices.list` 元素，`pairedAt` 倒序） */
export interface PairedDeviceView {
  id: string
  deviceName: string
  deviceFingerprint: string
  address?: string | null
  pairedAt: string
  lastSeen?: string | null
  connectCount: number
}

/** 连接事件（`auth-center.history.list` 元素，`connectedAt` 倒序） */
export interface ConnectionEventView {
  id?: number
  deviceId: string
  /** `pairing_code` / `qr` / `biometric` / `jwt` */
  authMethod: string
  /** `success` / `failed` */
  result: string
  address?: string | null
  connectedAt: string
  disconnectedAt?: string | null
}

/** `auth-center.keys.status` 返回体（**不含密钥材料**——凭据红线） */
export interface KeyStatusView {
  /** 当前签发代次（`g<n>`） */
  kid: string
  /** 上一代（宽限期内仍参与验签）；无上一代 = null */
  previousKid: string | null
}

/** `auth-center.keys.rotate` 返回体 */
export interface KeyRotationView {
  rotated: boolean
  kid: string
  previousKid?: string | null
}

/** 已接入认证中心的应用（声明式登记，见 `consumers.ts`） */
export interface AuthCenterConsumer {
  /** 消费方插件 id（互调调用方 id） */
  id: string
  /** 展示名（消费方 manifest.name） */
  name: string
  /** 接入面 i18n 短键（`consumers.surface.*`），顺序即展示顺序 */
  surfaces: string[]
}

/**
 * 宿主 `plugin_list_loaded` 条目（只取本页用到的字段）
 *
 * wire 真源 = wasm-core `HostPluginInfo`（camelCase；`state` 为 `{state, error?}` 标签形状）。
 */
export interface HostPluginInfo {
  id: string
  name?: string
  state?: { state?: string; error?: string } | string
}
