/**
 * 认证中心页面 wire 类型（真源 = 本 app Rust 命令面 `auth-center.*`）
 *
 * 就位状态三态（issue #6 D3）：`registered` / `not_ready` / `unknown`。
 * `unknown` 是**读不到**（注册结果尚未写入 / 状态记录不可用），与 `not_ready`
 * （确知未注册）必须分开呈现——两者的排障方向完全不同。
 *
 * 其余类型的字段名逐字对齐 Rust 侧 serde（camelCase）：配对码 / QR / 密钥代次
 * 由 `lib.rs` 命令面组装。改一边必须改另一边（wire 即契约）。
 * 页面只保留页面上仍在展示的 wire；配对码 / QR / 信任 / 连接历史 wire 由互调
 * 消费方自持（BedCode 设备中心 / File Transfer），本页不再消费。
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
