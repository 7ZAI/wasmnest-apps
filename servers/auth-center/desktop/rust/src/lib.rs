//! Auth Center Plugin (WASM, wasm32-wasip3)
//!
//! 认证中心（issue #6）。本文件是**命令面 + 互调 api 面 + 生命周期**的唯一接线处；
//! 域实现在 [`pairing`] / [`policy`] / [`trust`] / [`consent`] / [`auth_records`] /
//! [`auth_http`] 六个模块里，HTTP 路由表在 [`http_routes`]。
//!
//! ## 本版本做什么 / 不做什么
//!
//! **已落地（按域分票，逐票搬入；两条触发面共用同一实现体）**
//!
//! - `auth-center.status`：就位三态（`registered` / `not_ready` / `unknown`）、声明
//!   支持的认证方式及其可用性、在册属主与插件版本。页面据此显式告诉用户「中心是否
//!   就位」，而不是让「手机连不上」变成玄学。
//! - [`pairing`]：入场凭证密码学（HS256 签发/验签、wire 冻结向量）+ 签发密钥环
//!   （host-auth secret-store、最多两代、轮换宽限期）+ 门面 [`pairing::token`]。
//!   激活期引导密钥环（**失败阻断激活**，见 [`bootstrap_keyring`]）。
//! - [`pairing::code`] / [`pairing::qr`]：6 位配对码与 QR token 状态机（一次性
//!   消费、过期即清、两种 TTL 边界语义 `>` 与 `>=` 逐字保留），命令面
//!   `auth-center.pairing-code.*` / `auth-center.qr-code.*`；TTL 默认取 bedcode
//!   设置的默认值（60s / 300s），设置项搬迁后只换来源、状态机不动。
//! - [`consent`]：peer 首连确认决策（**已信任免确认 > 用户意向 > ask**，信任状态
//!   不可验证时 fail-closed 落到 ask），命令面 `auth-center.consent.decide`。
//! - [`policy`]：验签 + 四类策略 + 信任撤销检查，即宿主 `auth-policy` 导出的实现体
//!   （[`WasmPlugin::verify_device_token_policy`]）。宿主只对在册认证中心调这个导出，
//!   故本插件注册成功后它就是**生产路径**。
//! - [`trust`] + [`auth_records`]：统一信任视图（pairing + peer 合并、三态撤销裁决）
//!   与认证记录库（`auth_pairings` / `auth_biometric_keys` / `auth_connection_history`，
//!   插件私有库 = 唯一真源）。记录库在 activate 建表（**失败只降级记录域**，D7）；
//!   本库是切换后的**新库冷启动**（D5）——legacy 配对行不迁移，升级后既有移动端
//!   需重新配对。
//! - [`auth_http`] + [`http_routes`]：`/api/auth/*` 七端点的插件侧编排与动态路由注册。
//!
//! **互调 api 面已声明**（[`AuthCenterApi`] + `plugin.json.api`，20 条）：配对码 /
//! QR / 信任 / 首连确认 / 认证记录 / 就位状态 / 密钥轮换 / `auth-grant`（宿主
//! `auth-method-invoke` 的零解析窄转发目标）。声明名从
//! `com.wasmnest.terminal-session.*` 变为 `com.wasmnest.auth-center.*`——
//! **消费方（bedcode 设备中心 / file-transfer consent）已与本次切换同批改指**。
//!
//! **注册已接管**：`activate` 末尾调 `auth_center_register`（就位 = 前面全部硬失败
//! 步骤成功），并按注册结果决定是否登记 `/api/auth/*` 七端点；`deactivate` 注销。
//! K4 单中心意味着这不是可灰度并存的能力：BedCode 已同批去注册，切换必须整体回滚。
//! 注册失败不阻断激活（它是最后一步），但会以 error 留痕并记录原因，页面据此如实
//! 显示 `not_ready`（fail-closed：入站全拒，`deny_kind = no_center`）。
//!
//! ## 为什么 `state` 有三态而不是布尔
//!
//! 「确知未注册」与「读不到」的排障方向完全不同：前者是没启用（去看为什么没
//! 注册），后者是后端没答（去看为什么没答）。压成布尔会让后者被误报成前者，
//! 用户被引向错误的结论。

// native（cargo test）只跑纯函数 / 命令分发 / 编排语义：域名下的**宿主原语调用点**
// 全部 `#[cfg(target_arch = "wasm32")]`，故 native 编译面看不到一批 item 的调用方
// （它们是 cfg 分流的正常产物，不是遗留垃圾）。告警按目标分流抑制——**wasm 面不抑制**，
// 生产目标的 dead_code 告警仍完整：那正是「搬了却没人用」必须被抓到的地方。
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

// consent 的决策核心只从 **wasm** 适配器（`decide_consent_via_host`）被调用：
// native 适配器是显性失败的桩（无宿主就没有可信集），故 native 编译面看不到
// `decide` / `ConsentDecision::{accept,deny,ask}` 的调用方——这是 cfg 分流的正常
// 形态，不是死代码（wasm 目标零告警，用例也覆盖了决策矩阵）。
mod consent;
// 各域的实现体随域搬入并已全部接线（命令面 + 互调 api 面各一条实现路径）。
// 曾经的 `#[allow(dead_code)]` 是搬迁中间态标记：记录库落地 + 接线完成后已按
// 约定删除，让编译器重新盯着「搬了却没人用」。
mod auth_http;
mod auth_records;
mod http_routes;
mod pairing;
mod policy;
mod trust;

use pairing::code::PairingCode;
use pairing::qr::QrTokenManager;
use std::sync::{Mutex, OnceLock};
// `HostBus` 供 `#[plugin_api]` 生成的 `Dispatcher::register()` 使用（订阅全部请求
// topic）——trait 不在作用域内时宏展开会报「no method bus_subscribe」。
use wasmnest_plugin_api::host::{HostAuth, HostBus, HostLog};
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::{plugin_api, CommandArgs, WasmHost, WasmPlugin};

const PLUGIN_ID: &str = "com.wasmnest.auth-center";

/// 本中心声明支持的认证方式（与 BedCode 迁移前注册的清单同源，见 spec D2/D3）
const SUPPORTED_METHODS: [&str; 4] = ["pairing_code", "qr", "biometric", "jwt"];

/// 未激活原因码：`status` 在注册结果尚未写入时使用（正常路径不可达——
/// 命令面只在激活成功后可用；保留它是为了让 `unknown` 也有可读原因）。
const REASON_NOT_ACTIVATED: &str = "auth-center-not-activated";

/// 本插件作为认证中心的注册结果（`activate` 末尾写入）
///
/// `Some(Ok(center_id))` = 注册成功（`center_id` = 宿主铸的 `authc-<uuid>`）；
/// `Some(Err(why))` = 注册失败（fail-closed，`deny_kind=no_center`）；
/// `None` = 尚未 activate。
///
/// 它是**本插件对自己注册结果的记录**：注册失败的后果发生在入站方向，而页面照常
/// 打开——没有这份状态，用户只能看到「配对码能生成、手机却连不上」，无法区分
/// 「本机中心没就位」与「对方网络问题」。
static CENTER_REGISTRATION: Mutex<Option<std::result::Result<String, String>>> = Mutex::new(None);

fn set_center_registration(outcome: std::result::Result<String, String>) {
    if let Ok(mut slot) = CENTER_REGISTRATION.lock() {
        *slot = Some(outcome);
    }
}

fn clear_center_registration() {
    if let Ok(mut slot) = CENTER_REGISTRATION.lock() {
        *slot = None;
    }
}

/// 就位三态
///
/// `Unknown` = 读不到注册结果（尚未 activate / 状态记录不可用）。它与 `NotReady`
/// （确知未注册）必须分开呈现：前者查通信与激活链，后者查注册被拒的原因。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CenterState {
    /// 已注册为认证中心（入站在此裁决）
    Registered,
    /// 确知未注册（此刻入站全拒，`deny_kind = no_center`）
    NotReady,
    /// 读不到状态（后端未答 / 响应不可判读）——**不等于**未就位
    Unknown,
}

impl CenterState {
    /// wire 值（前端 `CenterState` 逐字对齐）
    fn as_str(self) -> &'static str {
        match self {
            Self::Registered => "registered",
            Self::NotReady => "not_ready",
            Self::Unknown => "unknown",
        }
    }
}

/// 组装 `auth-center.status` 载荷（纯函数：native 单测直接覆盖）
///
/// 不变式：
/// - 只有 `registered` 才能把认证方式标成可用——未注册时「声明支持」不等于
///   「现在能用」，标成可用会让用户以为能配对了；
/// - `registered` 时 `reason` 必须为空（就位还带原因说明状态自相矛盾）；
/// - 各字段缺失一律 `null`（前端渲染 `—`），不用 `0` / `""` 冒充。
fn status_payload(
    state: CenterState,
    reason: Option<&str>,
    owner: Option<&str>,
    center_id: Option<&str>,
) -> serde_json::Value {
    let available = state == CenterState::Registered;
    let methods: Vec<serde_json::Value> = SUPPORTED_METHODS
        .iter()
        .map(|id| serde_json::json!({ "id": id, "available": available }))
        .collect();

    serde_json::json!({
        "state": state.as_str(),
        "reason": if available { None } else { reason },
        "owner": owner,
        "centerId": center_id,
        "methods": methods,
        "version": env!("CARGO_PKG_VERSION"),
    })
}

/// 注册结果 → 就位载荷（纯函数：三个分支由单测钉死）
fn status_from_outcome(
    outcome: Option<std::result::Result<String, String>>,
) -> serde_json::Value {
    match outcome {
        Some(Ok(center_id)) => status_payload(
            CenterState::Registered,
            None,
            Some(PLUGIN_ID),
            Some(&center_id),
        ),
        Some(Err(reason)) => status_payload(CenterState::NotReady, Some(&reason), None, None),
        None => status_payload(
            CenterState::Unknown,
            Some(REASON_NOT_ACTIVATED),
            None,
            None,
        ),
    }
}

/// 读本插件 `activate` 末尾那次注册的结果（不反查宿主注册表：单中心下本插件
/// 只需知道**自己**是否注册成功；全局属主查询是宿主面的职责）
fn status_value() -> Result<serde_json::Value, String> {
    let outcome = CENTER_REGISTRATION
        .lock()
        .map_err(|e| format!("center registration lock: {e}"))?
        .clone();
    Ok(status_from_outcome(outcome))
}

// ==================== 激活期密钥环引导 ====================

/// 激活期读回密钥环（首启生成），**失败阻断激活**（fail-visible）
///
/// 为什么不能降级成 warn 继续：那会让中心在没有可用入场密钥的情况下对外服务，
/// 表现为「配对时看着成功、之后一律连不上」，比直接失败难排障得多。此步与
/// bedcode `activate` 的同名步骤行为等价（那边另有一步「清理退役 `jwt.key` 行」
/// 是 bedcode 历史遗留的一次性动作，本插件从未写过那行，故不做）。
#[cfg(target_arch = "wasm32")]
fn bootstrap_keyring() -> anyhow::Result<()> {
    let keyring = pairing::keys::keyring_from_host_auth()
        .map_err(|e| anyhow::anyhow!("auth keyring unavailable at activate: {e}"))?;
    WasmHost.log_info(&format!(
        "device token signing keyring ready from plugin-owned secret-store (kid {}, len {})",
        keyring.active_kid(),
        keyring.signing_key().map(|k| k.len()).unwrap_or(0)
    ));
    Ok(())
}

/// native（cargo test）：无 host-auth，跳过（activate 只由宿主在 wasm 内调用）
#[cfg(not(target_arch = "wasm32"))]
fn bootstrap_keyring() -> anyhow::Result<()> {
    Ok(())
}

// ==================== pairing 状态机（配对码 / QR） ====================
//
// 状态与实现体自 bedcode 逐字搬入（`pair_code_*` / `qr_*`）。状态**必须**是
// `static`：wasip3 的 thread_local 是真 TLS，实例状态放 thread_local 会变成
// 「每次调用都是空的」。
//
// 有效期（TTL）取值：bedcode 侧由认证域设置项（host-auth `auth-setting` 的
// `pairing_code_ttl` / `qr_token_ttl`）决定，那是「设备页设置」域，尚未搬入。
// 本票按 **bedcode 设置的默认值**（60s / 300s）落地，并允许调用方显式传 `ttl`
// 覆盖——设置项搬迁时只需把默认值的来源换掉，状态机不动。
//
// 注册切换后本插件是在册认证中心：宿主的 `/api/auth/pairing|verify|qr-connect`
// 路由由本插件登记（`http_routes`），HTTP 编排（`auth_http`）与命令面 / 互调 api
// 共用这里的**同一份**状态机——本页生成的码与移动端扫到的码不会再分叉。

/// QR token 默认有效期（秒）——与 bedcode 设备页 `DEFAULT_QR_TOKEN_TTL_SECS` 同值
/// （配对码默认值取 `pairing::code::PAIRING_CODE_TTL_SECS`，那里本来就是状态机
/// 的一部分；QR 的这个默认值是**页面策略**，bedcode 放在 device_face，故本仓也
/// 放在接线层而不是状态机里）
const DEFAULT_QR_TOKEN_TTL_SECS: u64 = 300;

/// 配对码状态（跨调用持久）
static CURRENT_CODE: Mutex<Option<PairingCode>> = Mutex::new(None);

/// QR token 管理器（OnceLock：首次访问初始化一次，返回 `&'static`）
static QR_MANAGER: OnceLock<QrTokenManager> = OnceLock::new();

fn qr_manager() -> &'static QrTokenManager {
    QR_MANAGER.get_or_init(QrTokenManager::new)
}

/// 生成配对码（宿主 `PairingCode` serde 形状：code / created_at / expires_in 剩余秒）
fn pair_code_generate(ttl: u64) -> Result<serde_json::Value, String> {
    let now = pairing::jwt::now_secs();
    let code = PairingCode::generate_with_ttl_at(ttl, now);
    *CURRENT_CODE
        .lock()
        .map_err(|e| format!("pairing code lock: {e}"))? = Some(code.clone());
    serde_json::to_value(code).map_err(|e| format!("pairing code serialize: {e}"))
}

/// 当前配对码状态（过滤过期）→ null | 宿主 `PairingCode` 形状
fn pair_code_status() -> Result<Option<serde_json::Value>, String> {
    let now = pairing::jwt::now_secs();
    let guard = CURRENT_CODE
        .lock()
        .map_err(|e| format!("pairing code lock: {e}"))?;
    match guard.as_ref().filter(|c| !c.is_expired_at(now)) {
        Some(code) => serde_json::to_value(code)
            .map(Some)
            .map_err(|e| format!("pairing code serialize: {e}")),
        None => Ok(None),
    }
}

/// 验证配对码（一次性：成功即消耗；过期顺带清除）→ valid 布尔
fn pair_code_verify(input: &str) -> Result<bool, String> {
    let mut guard = CURRENT_CODE
        .lock()
        .map_err(|e| format!("pairing code lock: {e}"))?;
    let now = pairing::jwt::now_secs();
    let valid = match guard.as_ref() {
        Some(code) => {
            let ok = code.verify_at(input, now);
            if ok {
                *guard = None; // 成功即消耗（宿主 verify_and_consume 语义）
            } else if code.is_expired_at(now) {
                *guard = None; // 过期顺带清除（宿主语义）
            }
            ok
        }
        None => false,
    };
    Ok(valid)
}

/// 清除当前配对码（幂等：本来就没有也算成功）
fn pair_code_clear() -> Result<(), String> {
    *CURRENT_CODE
        .lock()
        .map_err(|e| format!("pairing code lock: {e}"))? = None;
    Ok(())
}

/// 生成 QR token → `{token, ttl, remaining}`
fn qr_generate(ttl: u64) -> Result<serde_json::Value, String> {
    let manager = qr_manager();
    let token = manager.generate(ttl);
    // 刚生成的 token 必须活跃：若管理器实现异常（生成即不可见），显性报错而不
    // abort 整个插件（非测试路径 expect 会把 WASM 插件 trap）
    let (_, ttl, remaining) = manager
        .get_active()
        .ok_or_else(|| format!("qr token generate produced no active token (ttl={ttl})"))?;
    Ok(serde_json::json!({ "token": token, "ttl": ttl, "remaining": remaining }))
}

/// 当前 QR token 状态（过滤过期 / 已用）→ null | `{token, ttl, remaining}`
fn qr_status() -> Result<Option<serde_json::Value>, String> {
    let active = qr_manager().get_active();
    Ok(active
        .map(|(token, ttl, remaining)| serde_json::json!({ "token": token, "ttl": ttl, "remaining": remaining })))
}

/// 验证 QR token（一次性：成功即清除）→ `{valid, reason?}`
fn qr_verify(input: &str) -> Result<serde_json::Value, String> {
    match qr_manager().verify(input) {
        Ok(()) => Ok(serde_json::json!({ "valid": true })),
        Err(e) => Ok(serde_json::json!({ "valid": false, "reason": e.message() })),
    }
}

/// 清除当前 QR token（幂等）
fn qr_clear() -> Result<(), String> {
    qr_manager().clear();
    Ok(())
}

/// 取命令参数字符串（缺失 / 非串 / 空串一律显性报错，不猜测语义）
fn required_str_arg(args: &serde_json::Value, key: &str) -> anyhow::Result<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("{} required", key))
}

/// 命令分发（与 `WasmPlugin::invoke_command` 同一实现，抽出来供 native 单测直调）
fn dispatch_command(name: &str, args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    match name {
        "auth-center.status" => status_value().map_err(anyhow::Error::msg),
        // ==================== pairing 域（配对码 / QR） ====================
        // 与互调 api **同一实现体**：api 面给移动端配对端点（宿主
        // `auth-method-invoke`）与 bedcode 设备中心命令，命令面给本 app 页面与
        // 宿主闭环测试 / 调试直调。
        "auth-center.pairing-code.generate" => {
            let ttl = args
                .get("ttl")
                .and_then(|v| v.as_u64())
                .unwrap_or(pairing::code::PAIRING_CODE_TTL_SECS);
            pair_code_generate(ttl).map_err(anyhow::Error::msg)
        }
        "auth-center.pairing-code.status" => {
            let status = pair_code_status().map_err(anyhow::Error::msg)?;
            serde_json::to_value(status)
                .map_err(|e| anyhow::anyhow!("pairing code status serialize: {}", e))
        }
        "auth-center.pairing-code.verify" => {
            let code = required_str_arg(&args, "code")?;
            Ok(serde_json::json!({
                "valid": pair_code_verify(&code).map_err(anyhow::Error::msg)?,
            }))
        }
        "auth-center.pairing-code.clear" => {
            pair_code_clear().map_err(anyhow::Error::msg)?;
            Ok(serde_json::json!({ "cleared": true }))
        }
        "auth-center.qr-code.generate" => {
            let ttl = args
                .get("ttl")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_QR_TOKEN_TTL_SECS);
            qr_generate(ttl).map_err(anyhow::Error::msg)
        }
        "auth-center.qr-code.status" => {
            let status = qr_status().map_err(anyhow::Error::msg)?;
            serde_json::to_value(status)
                .map_err(|e| anyhow::anyhow!("qr code status serialize: {}", e))
        }
        "auth-center.qr-code.verify" => {
            let token = required_str_arg(&args, "token")?;
            qr_verify(&token).map_err(anyhow::Error::msg)
        }
        "auth-center.qr-code.clear" => {
            qr_clear().map_err(anyhow::Error::msg)?;
            Ok(serde_json::json!({ "cleared": true }))
        }
        // ==================== consent 域（首连确认） ====================
        // args 即 `ConsentRequest`（camelCase wire）；决策与 api 面同一实现体
        "auth-center.consent.decide" => {
            let request: consent::model::ConsentRequest = serde_json::from_value(args)
                .map_err(|e| anyhow::anyhow!("invalid consent request: {}", e))?;
            let decision =
                consent::ops::decide_consent_via_host(request).map_err(anyhow::Error::msg)?;
            serde_json::to_value(decision)
                .map_err(|e| anyhow::anyhow!("consent decision serialize: {}", e))
        }
        // 操作员手动轮换（自 bedcode `session.auth.rotate-key` 搬入，同一实现体）。
        // 返回 `{rotated, kid, previousKid}`：`kid` 只是代次标识，**不含密钥材料**
        // （凭据红线）。不撤销既有 token——撤销归撤销域；上一代在宽限期内继续验签。
        "auth-center.keys.rotate" => {
            pairing::token::rotate_signing_key().map_err(anyhow::Error::msg)
        }
        // 当前签发代次（纯读，**不含密钥材料**——凭据红线）。页面的「策略与密钥代次」
        // 分区要展示「现在是哪一代、上一代是谁（宽限期内仍可验签）」，轮换是写动作，
        // 读动作必须另有入口，否则用户只能靠「轮换一次」看结果。
        "auth-center.keys.status" => keys_status().map_err(anyhow::Error::msg),
        // ==================== 信任域（auth_records 真源） ====================
        // 与互调 api `trust-list` / `trust-revoke` 同一实现体（见 [`AuthCenterApi`]）。
        "auth-center.trust.list" => trust::ops::list_via_host().map_err(anyhow::Error::msg),
        "auth-center.trust.revoke" => {
            let id = required_str_arg(&args, "id")?;
            trust::ops::revoke_via_host(&id).map_err(anyhow::Error::msg)
        }
        // ==================== 认证记录域（配对设备 / 连接历史 / 迁移） ====================
        // 记录库是配对设备与连接历史的**唯一真源**（宿主 host-auth 记录面原语已退役），
        // 故这三条读命令 + 迁移入口是本插件的数据面。
        "auth-center.devices.list" => auth_records::paired_list().map_err(anyhow::Error::msg),
        "auth-center.history.list" => {
            let device_id = required_str_arg(&args, "deviceId")?;
            auth_records::history_list(&device_id).map_err(anyhow::Error::msg)
        }
        "auth-center.history.clear" => {
            let device_id = required_str_arg(&args, "deviceId")?;
            auth_records::history_clear(&device_id).map_err(anyhow::Error::msg)
        }
        // ==================== HTTP 端点入口（ABI v29，路径全等匹配） ====================
        // 宿主 `/api/plugin/com.wasmnest.auth-center/{path}` 命中后调本命令，`path` 即
        // 去掉前缀的相对段；`/api/auth/*` 别名经 `http_routes` 登记后同样落到这里
        // （网关只换入口，编排一处）。
        "_http_endpoint" => {
            let a = CommandArgs::new(args);
            let method = a.str_or("method", "");
            let path = a.str_or("path", "");
            let body = a.value_owned("body").unwrap_or(serde_json::Value::Null);
            let query = a
                .value_owned("query")
                .unwrap_or_else(|| serde_json::json!({}));
            Ok(auth_http::handle_http_endpoint(
                &WasmHost, &method, &path, &body, &query,
            ))
        }
        other => Err(anyhow::anyhow!("Unknown command: {}", other)),
    }
}

// ==================== 互调 api 面（ADR 0017） ====================

/// 认证中心对外互调契约（声明方）
///
/// 方法名 ↔ manifest `api` 条目（`com.wasmnest.auth-center.<方法>`）：`#[plugin_api]`
/// 在编译期比对防漂移（`plugin.json` 是唯一真源）。
///
/// **契约由 bedcode 的两段面拆出**：配对码 / QR / 信任 / 首连确认 / 认证记录原本是
/// `com.wasmnest.terminal-session.*`，已随六域搬迁与本切换票改指本插件；消费方
/// （bedcode 设备中心 / file-transfer）同批改指，不存在「按旧名调用」的中间态。
///
/// 每条命令面（`auth-center.*`）都复用同一实现体，两条触发面不重复编排：
/// 命令面服务本 app 页面与宿主闭环测试，api 面服务其他插件（bedcode / file-transfer）
/// 与宿主的窄转发（`auth-method-invoke` → `auth-grant`）。
#[plugin_api(manifest = "../plugin.json")]
pub trait AuthCenterApi {
    /// 就位三态 + 声明支持的认证方式（`{state, reason, owner, centerId, methods, version}`）
    #[api("status")]
    fn status() -> Result<serde_json::Value, String>;

    /// 生成配对码（替换旧的）→ `{code, created_at, expires_in}`
    #[api("pairing-code-generate")]
    fn pairing_code_generate(ttl: u64) -> Result<serde_json::Value, String>;

    /// 当前配对码状态（过滤过期）→ 同 generate 形状 | null
    #[api("pairing-code-status")]
    fn pairing_code_status() -> Result<Option<serde_json::Value>, String>;

    /// 验证配对码（一次性：成功即消耗）→ valid 布尔
    #[api("pairing-code-verify")]
    fn pairing_code_verify(code: String) -> Result<bool, String>;

    /// 清除当前配对码
    #[api("pairing-code-clear")]
    fn pairing_code_clear() -> Result<(), String>;

    /// 生成 QR token（替换旧的）→ `{token, ttl, remaining}`
    #[api("qr-code-generate")]
    fn qr_code_generate(ttl: u64) -> Result<serde_json::Value, String>;

    /// 当前 QR token 状态（过滤过期 / 已用）→ `{token, ttl, remaining}` | null
    #[api("qr-code-status")]
    fn qr_code_status() -> Result<Option<serde_json::Value>, String>;

    /// 验证 QR token（一次性）→ `{valid, reason?}`
    #[api("qr-code-verify")]
    fn qr_code_verify(token: String) -> Result<serde_json::Value, String>;

    /// 清除当前 QR token
    #[api("qr-code-clear")]
    fn qr_code_clear() -> Result<(), String>;

    /// 统一信任视图（认证记录库 pairing 段 + 宿主 peer 段）→ `{devices, peerError}`
    #[api("trust-list")]
    fn trust_list() -> Result<serde_json::Value, String>;

    /// 撤销统一条目 → `{removed, kind}`
    #[api("trust-revoke")]
    fn trust_revoke(id: String) -> Result<serde_json::Value, String>;

    /// 首连确认决策（两阶段：无意向评估信任 → 回传用户意向定终局）
    #[api("consent-decide")]
    fn consent_decide(
        request: consent::model::ConsentRequest,
    ) -> Result<consent::model::ConsentDecision, String>;

    /// 轮换入场签发密钥（消费方 = bedcode 设备中心命令面；与命令面
    /// `auth-center.keys.rotate` 同一实现体）。保留上一代用于宽限期验签，
    /// 不撤销既有 token；返回 `{rotated, kid, previousKid}`，不含密钥材料。
    #[api("keys-rotate")]
    fn keys_rotate() -> Result<serde_json::Value, String>;

    /// 活跃配对设备列表（`PairedDeviceInfo[]`，`pairedAt` 倒序）
    #[api("devices-list")]
    fn devices_list() -> Result<serde_json::Value, String>;

    /// 设备连接历史（`deviceId` = 配对记录 id，倒序）
    #[api("history-list")]
    fn history_list(device_id: String) -> Result<serde_json::Value, String>;

    /// 清空设备连接历史（不影响配对状态）→ `{cleared}`
    #[api("history-clear")]
    fn history_clear(device_id: String) -> Result<serde_json::Value, String>;

    /// 连接计数 / last_seen 刷新（宿主 WS 认证路径回调）
    #[api("connection-touch")]
    fn connection_touch(fingerprint: String) -> Result<(), String>;

    /// 断开回填（最近一条 open 连接的 `disconnected_at`）
    #[api("connection-close")]
    fn connection_close(fingerprint: String) -> Result<(), String>;

    /// 组合式认证出口（ADR 0031 K6）：宿主 `auth-method-invoke` 的**零解析窄转发**
    /// 目标。`method` ∈ 注册时声明的四种；`params` 为该方式的入参形状。
    #[api("auth-grant")]
    fn auth_grant(method: String, params: serde_json::Value) -> Result<serde_json::Value, String>;
}

/// 当前签发代次（纯读）
///
/// 只回代次标识（`g<n>`），**不含任何密钥材料**（凭据红线）。`previousKid` 存在 =
/// 上一代仍在密钥环内参与验签（宽限期），页面的「旧设备需重新配对」提示据此判断。
fn keys_status() -> Result<serde_json::Value, String> {
    let ring = pairing::keys::keyring_from_host_auth()?;
    Ok(serde_json::json!({
        "kid": ring.active_kid(),
        "previousKid": ring.previous_kid(),
    }))
}

impl AuthCenterApi for AuthCenterPlugin {
    fn status() -> Result<serde_json::Value, String> {
        status_value()
    }

    fn pairing_code_generate(ttl: u64) -> Result<serde_json::Value, String> {
        pair_code_generate(ttl)
    }

    fn pairing_code_status() -> Result<Option<serde_json::Value>, String> {
        pair_code_status()
    }

    fn pairing_code_verify(code: String) -> Result<bool, String> {
        pair_code_verify(&code)
    }

    fn pairing_code_clear() -> Result<(), String> {
        pair_code_clear()
    }

    fn qr_code_generate(ttl: u64) -> Result<serde_json::Value, String> {
        qr_generate(ttl)
    }

    fn qr_code_status() -> Result<Option<serde_json::Value>, String> {
        qr_status()
    }

    fn qr_code_verify(token: String) -> Result<serde_json::Value, String> {
        qr_verify(&token)
    }

    fn qr_code_clear() -> Result<(), String> {
        qr_clear()
    }

    fn trust_list() -> Result<serde_json::Value, String> {
        trust::ops::list_via_host()
    }

    fn trust_revoke(id: String) -> Result<serde_json::Value, String> {
        trust::ops::revoke_via_host(&id)
    }

    fn consent_decide(
        request: consent::model::ConsentRequest,
    ) -> Result<consent::model::ConsentDecision, String> {
        consent::ops::decide_consent_via_host(request)
    }

    fn keys_rotate() -> Result<serde_json::Value, String> {
        pairing::token::rotate_signing_key()
    }

    fn devices_list() -> Result<serde_json::Value, String> {
        auth_records::paired_list()
    }

    fn history_list(device_id: String) -> Result<serde_json::Value, String> {
        auth_records::history_list(&device_id)
    }

    fn history_clear(device_id: String) -> Result<serde_json::Value, String> {
        auth_records::history_clear(&device_id)
    }

    fn connection_touch(fingerprint: String) -> Result<(), String> {
        auth_records::touch(&fingerprint)
    }

    fn connection_close(fingerprint: String) -> Result<(), String> {
        auth_records::close_open_connection(&fingerprint)
    }

    /// 组合式认证出口：method → 实现映射表（逐字搬迁 bedcode 的同名分派，除 JWT
    /// 门面由 `auth_http::jwt` 改为 `pairing::token`——密钥域与它同源，迁到一处更近）
    ///
    /// action 键接受 `action` / `phase` 两种拼写；未知 method / action 显性报错
    /// （不猜、不回退）。
    fn auth_grant(method: String, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let action = params
            .get("action")
            .or_else(|| params.get("phase"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let str_field = |key: &str| {
            params
                .get(key)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        match method.as_str() {
            "pairing_code" => match action.as_str() {
                "generate" => {
                    let ttl = params
                        .get("ttl")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(pairing::code::PAIRING_CODE_TTL_SECS);
                    pair_code_generate(ttl)
                }
                "status" => Ok(pair_code_status()?.unwrap_or(serde_json::Value::Null)),
                "verify" => {
                    let code = str_field("code");
                    Ok(serde_json::json!({ "valid": pair_code_verify(&code)? }))
                }
                "clear" => {
                    pair_code_clear()?;
                    Ok(serde_json::json!({}))
                }
                other => Err(format!("auth-grant: unknown pairing_code action '{other}'")),
            },
            "qr" => match action.as_str() {
                "generate" => {
                    let ttl = params
                        .get("ttl")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(DEFAULT_QR_TOKEN_TTL_SECS);
                    qr_generate(ttl)
                }
                "status" => Ok(qr_status()?.unwrap_or(serde_json::Value::Null)),
                "verify" => {
                    let token = str_field("token");
                    qr_verify(&token)
                }
                "clear" => {
                    qr_clear()?;
                    Ok(serde_json::json!({}))
                }
                other => Err(format!("auth-grant: unknown qr action '{other}'")),
            },
            "biometric" => match action.as_str() {
                "challenge" => {
                    let fingerprint = str_field("fingerprint");
                    let nonce = auth_http::biometric::issue_challenge(&WasmHost, &fingerprint)?;
                    Ok(serde_json::json!(nonce))
                }
                "verify" => {
                    let fingerprint = str_field("fingerprint");
                    let nonce = str_field("challenge");
                    let signature = str_field("signature");
                    auth_http::biometric::verify_signature(
                        &WasmHost,
                        &fingerprint,
                        &nonce,
                        &signature,
                    )
                }
                other => Err(format!("auth-grant: unknown biometric action '{other}'")),
            },
            "jwt" => match action.as_str() {
                "issue" => {
                    let sub = str_field("sub");
                    if sub.is_empty() {
                        return Err("auth-grant: jwt issue requires non-empty sub".to_string());
                    }
                    let device_name = str_field("deviceName");
                    let fingerprint = str_field("fingerprint");
                    let (token, expires_in) = pairing::token::issue_device_token(
                        &sub,
                        (!device_name.is_empty()).then_some(device_name.as_str()),
                        (!fingerprint.is_empty()).then_some(fingerprint.as_str()),
                    )?;
                    Ok(serde_json::json!({"token": token, "expires_in": expires_in}))
                }
                "verify" => {
                    let token = str_field("token");
                    pairing::token::verify_device_token(&token)
                }
                // v33（ADR 0033 D4）：轮换入场签发密钥——保留上一代用于宽限期验签，
                // 不撤销既有 token（撤销归撤销域）。宿主命令面经 `auth-method-invoke`
                // 零解析转发进来，不新增 method 登记。
                "rotate-key" => pairing::token::rotate_signing_key(),
                other => Err(format!("auth-grant: unknown jwt action '{other}'")),
            },
            other => Err(format!(
                "auth-grant: unknown method '{other}' (registered: pairing_code, qr, biometric, jwt)"
            )),
        }
    }
}

struct AuthCenterPlugin;

impl WasmPlugin for AuthCenterPlugin {
    const ID: &'static str = PLUGIN_ID;

    fn manifest() -> PluginManifest {
        serde_json::from_str(include_str!("../../plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        let host = WasmHost;
        // ① 互调 api 面：订阅本 trait 声明的全部请求 topic。**失败即激活失败**——
        //    订不到就是「调用方永远等不到回执」的静默断裂（与 bedcode 同口径）。
        AuthCenterApiDispatcher::register()?;
        // ② 密钥环就位（失败即激活失败）：切换后第一个入站请求就会用到它，
        //    没准备好就必须在激活期暴露，而不是等到用户配对失败。
        bootstrap_keyring()?;
        // ③ 认证记录库建表（幂等）。**失败只降级记录域**（D7 故障隔离）：配对 /
        //    信任 / 认证链按「无记录」降级（撤销是唯一显式拒绝信号，读失败从宽），
        //    不能让「私有库建不出来」把整个中心打成不可用——那会让入站全拒。
        //    本库是**新库冷启动**（D5）：不接收宿主主库的 legacy 配对行，也不在此拉取
        //    任何存量——升级后既有移动端需重新配对。
        match auth_records::ensure_schema_via_host() {
            Ok(()) => host.log_info(
                "auth records store ready (private tables auth_pairings / auth_connection_history)",
            ),
            Err(e) => host.log_warn(&format!(
                "auth records schema init failed at activate (auth records face degraded): {e}"
            )),
        }
        // ④ 注册为本机**认证中心**（K1/K4，`activate` 的最后一个硬边界）。
        //    注册即「就位」：必须排在此前全部硬失败步骤之后——否则激活中途失败会
        //    留下一个**在册的半死中心**（宿主 `is_registered()` 为真，认证面去找
        //    一个没有密钥环的中心，表现为 `unavailable` 而非 `no_center`，排障方向
        //    被带偏）。注册失败**不阻断激活**（它已经是最后一步），但入站随之
        //    fail-closed，必须 error 留痕并记录原因供页面读取。
        let reg_methods = SUPPORTED_METHODS
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        let as_center = match host.auth_center_register(reg_methods) {
            Ok(center_id) => {
                host.log_info(&format!("auth center registered: {center_id}"));
                set_center_registration(Ok(center_id));
                true
            }
            Err(e) => {
                host.log_error(&format!(
                    "auth center registration failed (auth surfaces stay fail-closed): {e}"
                ));
                set_center_registration(Err(e.to_string()));
                false
            }
        };
        // ⑤ HTTP 路由：**只在本插件确为在册中心时登记**（`as_center` = ④ 的结果）。
        //    理由见 `http_routes::register_all`：别名是全局唯一资源，且内部路径同样
        //    是自助配对入口——未注册时暴露任何一条都会留下无效却看似可用的入场凭证。
        //    注册失败时一条都不登记（暴露面为零，页面走命令面）。
        http_routes::register_all(&host, as_center);
        host.log_info(if as_center {
            "auth center activated (registered; api surface + private records + auth http routes wired)"
        } else {
            "auth center activated but NOT registered (auth surfaces fail-closed; see registration error)"
        });
        Ok(())
    }

    fn deactivate() -> anyhow::Result<()> {
        // 注销认证中心角色（仅属主本人；宿主 purge 兜底回收）。注销失败不阻断停用
        // 流程——宿主侧回收兜底，故只留痕，但状态记录必须清掉（不能让停用后的
        // 重激活读取到上一轮的成功结果）。
        let host = WasmHost;
        if let Err(e) = host.auth_center_unregister() {
            host.log_warn(&format!(
                "auth center unregister failed (host purge backs up): {e}"
            ));
        }
        clear_center_registration();
        http_routes::unregister_all(&host);
        WasmHost.log_info("auth center deactivated (center role released)");
        Ok(())
    }

    fn invoke_command(name: &str, args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        dispatch_command(name, args)
    }

    /// 认证策略导出（宿主 `auth-policy` 能力，自 bedcode `policy` 域搬入）
    ///
    /// 宿主只对在册认证中心调本导出，故本插件注册成功后它就是**生产路径**；
    /// 语义与搬迁前逐条一致（先验签再四类策略 + 撤销检查）。
    fn verify_device_token_policy(token: &str) -> Result<String, String> {
        policy::verify_device_token(token)
    }
}

wasmnest_plugin_api::wasm_entry!(AuthCenterPlugin);

// ==================== native 单测 ====================
//
// 只测外部可观察行为（载荷形状 / 三态不变式 / 命令分发 / 导出接线），不测内部调用顺序。

#[cfg(test)]
mod tests {
    use super::*;

    /// 未注册：三态落 `not_ready`，原因码上屏，认证方式一律不可用
    #[test]
    fn not_ready_payload_reports_reason_and_disables_methods() {
        let payload = status_payload(
            CenterState::NotReady,
            Some("already registered by 'other-plugin'"),
            None,
            None,
        );
        assert_eq!(payload["state"], serde_json::json!("not_ready"));
        assert_eq!(
            payload["reason"],
            serde_json::json!("already registered by 'other-plugin'")
        );
        assert_eq!(payload["owner"], serde_json::Value::Null);
        assert_eq!(payload["centerId"], serde_json::Value::Null);

        let methods = payload["methods"].as_array().expect("methods array");
        assert_eq!(methods.len(), SUPPORTED_METHODS.len(), "声明的方式必须全部列出");
        for method in methods {
            assert_eq!(
                method["available"],
                serde_json::json!(false),
                "未注册时不得把声明当成可用（否则用户以为能配对）"
            );
        }
    }

    /// 已就位：不再带原因，方式全部可用，属主与中心句柄如实透出
    #[test]
    fn registered_payload_drops_reason_and_enables_methods() {
        let payload = status_payload(
            CenterState::Registered,
            Some("stale-reason-must-be-ignored"),
            Some(PLUGIN_ID),
            Some("authc-1234"),
        );
        assert_eq!(payload["state"], serde_json::json!("registered"));
        assert_eq!(
            payload["reason"],
            serde_json::Value::Null,
            "就位还带原因 = 状态自相矛盾，必须清成 null"
        );
        assert_eq!(payload["owner"], serde_json::json!(PLUGIN_ID));
        assert_eq!(payload["centerId"], serde_json::json!("authc-1234"));
        let methods = payload["methods"].as_array().expect("methods array");
        assert!(methods.iter().all(|m| m["available"] == serde_json::json!(true)));
    }

    /// 读不到：仍是 `unknown` + 原因，不因为「没有数据」被降级成 not_ready
    #[test]
    fn unknown_payload_keeps_unknown_state() {
        let payload = status_payload(CenterState::Unknown, Some("host-call-failed"), None, None);
        assert_eq!(payload["state"], serde_json::json!("unknown"));
        assert_eq!(payload["reason"], serde_json::json!("host-call-failed"));
        assert_eq!(
            payload["methods"].as_array().map(|m| m.len()),
            Some(SUPPORTED_METHODS.len()),
            "读不到状态时仍要列出声明面（它不依赖宿主应答）"
        );
    }

    /// 注册结果 → 三态映射：成功/失败/未记录三个分支都必须如实，不互相冒充
    #[test]
    fn status_from_outcome_maps_registration_result() {
        let registered = status_from_outcome(Some(Ok("authc-1234".to_string())));
        assert_eq!(registered["state"], serde_json::json!("registered"));
        assert_eq!(registered["owner"], serde_json::json!(PLUGIN_ID));
        assert_eq!(registered["centerId"], serde_json::json!("authc-1234"));
        assert_eq!(registered["reason"], serde_json::Value::Null);

        let failed = status_from_outcome(Some(Err("permission denied".to_string())));
        assert_eq!(failed["state"], serde_json::json!("not_ready"));
        assert_eq!(failed["reason"], serde_json::json!("permission denied"));
        assert_eq!(failed["centerId"], serde_json::Value::Null);

        let not_activated = status_from_outcome(None);
        assert_eq!(
            not_activated["state"],
            serde_json::json!("unknown"),
            "没有注册记录 ≠ 确知未注册（后者要有明确失败原因）"
        );
        assert_eq!(
            not_activated["reason"],
            serde_json::json!(REASON_NOT_ACTIVATED)
        );
    }

    /// 命令面：状态命令可调；未知命令显性报错（不返回空对象冒充成功）
    #[test]
    fn dispatch_serves_status_and_rejects_unknown_commands() {
        // native 不跑 activate → 没有注册记录，状态如实落 unknown
        let ok = dispatch_command("auth-center.status", serde_json::json!(null)).expect("status");
        assert_eq!(ok["state"], serde_json::json!("unknown"));
        assert_eq!(ok["reason"], serde_json::json!(REASON_NOT_ACTIVATED));
        assert_eq!(ok["version"], serde_json::json!(env!("CARGO_PKG_VERSION")));

        let err = dispatch_command("auth-center.nope", serde_json::json!(null)).unwrap_err();
        assert!(err.to_string().contains("Unknown command"), "实际: {err}");
    }

    /// 注册必须排在全部硬失败步骤之后、HTTP 路由登记之前（结构锁）
    ///
    /// 注册即「就位」：若排在 `Dispatcher::register()?` / `bootstrap_keyring()?` 之前，
    /// 激活中途失败会留下在册的半死中心（宿主看到 registered，认证面却缺密钥环）。
    /// 路由必须排在注册之后：注册失败时不得登记 `/api/auth/*`（见
    /// `http_routes::register_all` 的暴露面判据）。
    #[test]
    fn auth_center_registration_is_the_last_activate_step() {
        let src = include_str!("lib.rs");
        let activate_start = src
            .find("    fn activate() -> anyhow::Result<()> {")
            .expect("activate fn found");
        let deactivate_start = src
            .find("    fn deactivate() -> anyhow::Result<()> {")
            .expect("deactivate fn found");
        assert!(
            activate_start < deactivate_start,
            "activate 必须先于 deactivate 出现"
        );
        let body = &src[activate_start..deactivate_start];

        let reg = body
            .find("host.auth_center_register(reg_methods)")
            .expect("activate 必须调 auth_center_register");
        for hard_fail_step in [
            "AuthCenterApiDispatcher::register()?",
            "bootstrap_keyring()?",
        ] {
            let at = body.find(hard_fail_step).unwrap_or_else(|| {
                panic!("activate 必须含硬失败步骤 `{hard_fail_step}`（否则本锁已失效）")
            });
            assert!(
                reg > at,
                "认证中心注册必须排在硬失败步骤 `{hard_fail_step}` 之后（注册在前 = 激活失败留下半死中心）"
            );
        }
        let routes = body
            .find("http_routes::register_all(&host, as_center);")
            .expect("activate 必须按注册结果登记 http 路由");
        assert!(
            reg < routes,
            "路由登记必须使用注册结果且排在注册之后（注册失败不得登记 /api/auth/*）"
        );
    }

    /// 命令面接线：`auth-center.keys.rotate` 必须**派发到轮换实现体**而非落到
    /// `Unknown command` 兜底。
    ///
    /// native（cargo test）下密钥环依赖宿主 secret-store，轮换实现体显性失败——
    /// 断言的正是**这条错误文案**（区别于未知命令）。它锁住「命令面确实接到了
    /// `rotate_signing_key`，且失败是显性的（不静默成功）」。跨代验签 / 宽限期 /
    /// 幂等的真实行为由 `pairing::keys` 与 `pairing::token` 的用例覆盖。
    #[test]
    fn keys_rotate_command_routes_to_rotation_and_fails_loudly_on_native() {
        let err = dispatch_command("auth-center.keys.rotate", serde_json::json!({}))
            .expect_err("native 下密钥环不可用，必须显性失败");
        assert!(
            err.to_string().contains("unavailable outside wasm runtime"),
            "got: {err}"
        );
    }

    /// 互调 api 面同样接到轮换实现体（bedcode 设备中心经 api 触发，命令面只是
    /// 本页按钮——两条触发面必须共用同一实现，不能一条通一条断）
    #[test]
    fn keys_rotate_api_routes_to_rotation_and_fails_loudly_on_native() {
        let err = AuthCenterPlugin::keys_rotate().expect_err("native 下密钥环不可用，必须显性失败");
        assert!(
            err.contains("unavailable outside wasm runtime"),
            "got: {err}"
        );
    }

    /// 策略导出必须**真的接到** `policy` 域，而不是落回 SDK 的默认实现
    ///
    /// SDK 默认拒绝的文案是 `auth-policy not provided by this plugin`；native 下
    /// 本插件应给出自己的显性失败文案。若哪天有人删掉这个覆盖，宿主侧就会在切换后
    /// 变成「一律拒绝」——用文案区分即可在单测里抓到（不必等真实宿主）。
    #[test]
    fn auth_policy_export_is_wired_to_the_policy_domain() {
        let err = AuthCenterPlugin::verify_device_token_policy("a.b.c").expect_err("native 验签失败");
        assert!(
            err.contains("unavailable outside wasm runtime"),
            "策略导出必须接到 policy 域（SDK 默认文案是 'not provided by this plugin'）: {err}"
        );
    }

    // ==================== pairing / QR / consent 命令面 ====================
    //
    // 配对码与 QR 的状态是 `static`：多个用例并行会互相踩状态，故每个域**只用一个
    // 用例**跑完整条闭环（生成 → 状态 → 错输入 → 正确输入 → 清空）。

    /// 配对码闭环：生成 → 状态可见 → 错码不消耗 → 正确码一次性消费 → 清除幂等
    #[test]
    fn pairing_code_commands_are_single_use_and_clearable() {
        let generated = dispatch_command(
            "auth-center.pairing-code.generate",
            serde_json::json!({ "ttl": 120 }),
        )
        .expect("generate");
        let code = generated["code"].as_str().expect("code").to_string();
        assert_eq!(code.len(), pairing::code::PAIRING_CODE_DIGITS);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
        // 序列化写的是**剩余**秒而非原始 TTL，跨秒边界时可能是 119 → 给区间
        let remaining = generated["expires_in"].as_u64().expect("expires_in");
        assert!((118..=120).contains(&remaining), "got {remaining}");
        assert!(
            generated["created_at"].as_str().expect("created_at").ends_with('Z'),
            "created_at 必须是 RFC3339 UTC"
        );

        let status = dispatch_command("auth-center.pairing-code.status", serde_json::json!(null))
            .expect("status");
        assert_eq!(status["code"].as_str(), Some(code.as_str()));

        // 错码：valid=false 且**不消耗**（宿主 verify 语义：只有成功才消费）
        let wrong = if code == "000000" { "111111" } else { "000000" };
        let rejected = dispatch_command(
            "auth-center.pairing-code.verify",
            serde_json::json!({ "code": wrong }),
        )
        .expect("verify wrong");
        assert_eq!(rejected["valid"], serde_json::json!(false));
        let still = dispatch_command("auth-center.pairing-code.status", serde_json::json!(null))
            .expect("status after wrong");
        assert_eq!(still["code"].as_str(), Some(code.as_str()), "错码不得消耗");

        // 正确码：一次性（成功即清空）
        let accepted = dispatch_command(
            "auth-center.pairing-code.verify",
            serde_json::json!({ "code": &code }),
        )
        .expect("verify");
        assert_eq!(accepted["valid"], serde_json::json!(true));
        let after = dispatch_command("auth-center.pairing-code.status", serde_json::json!(null))
            .expect("status after consume");
        assert!(after.is_null(), "成功消费后状态必须为空");

        // 二次校验 → false（不报错）；清除幂等
        let again = dispatch_command(
            "auth-center.pairing-code.verify",
            serde_json::json!({ "code": &code }),
        )
        .expect("verify again");
        assert_eq!(again["valid"], serde_json::json!(false));
        for _ in 0..2 {
            let cleared =
                dispatch_command("auth-center.pairing-code.clear", serde_json::json!(null))
                    .expect("clear");
            assert_eq!(cleared["cleared"], serde_json::json!(true));
        }
    }

    /// QR 闭环：生成 → 状态可见 → 不匹配不消费 → 正确 token 一次性消费 → 清除幂等
    #[test]
    fn qr_code_commands_are_single_use_and_clearable() {
        let generated = dispatch_command(
            "auth-center.qr-code.generate",
            serde_json::json!({ "ttl": 300 }),
        )
        .expect("generate");
        let token = generated["token"].as_str().expect("token").to_string();
        assert_eq!(token.len(), 32, "128-bit → 32 hex 字符");
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(generated["ttl"], serde_json::json!(300));
        assert!(generated["remaining"].as_u64().expect("remaining") <= 300);

        let status = dispatch_command("auth-center.qr-code.status", serde_json::json!(null))
            .expect("status");
        assert_eq!(status["token"].as_str(), Some(token.as_str()));

        // 不匹配：原因上屏（文案与 bedcode / 宿主逐字一致）且**不消费**
        let rejected = dispatch_command(
            "auth-center.qr-code.verify",
            serde_json::json!({ "token": "deadbeef" }),
        )
        .expect("verify mismatch");
        assert_eq!(rejected["valid"], serde_json::json!(false));
        assert_eq!(rejected["reason"], serde_json::json!("Invalid QR token"));
        let still = dispatch_command("auth-center.qr-code.status", serde_json::json!(null))
            .expect("status after mismatch");
        assert_eq!(
            still["token"].as_str(),
            Some(token.as_str()),
            "不匹配不得消费"
        );

        // 正确 token：一次性消费
        let accepted = dispatch_command(
            "auth-center.qr-code.verify",
            serde_json::json!({ "token": &token }),
        )
        .expect("verify");
        assert_eq!(accepted["valid"], serde_json::json!(true));
        let after = dispatch_command("auth-center.qr-code.status", serde_json::json!(null))
            .expect("status after consume");
        assert!(after.is_null(), "消费后必须清空");

        let again = dispatch_command(
            "auth-center.qr-code.verify",
            serde_json::json!({ "token": &token }),
        )
        .expect("verify again");
        assert_eq!(again["valid"], serde_json::json!(false));
        assert_eq!(again["reason"], serde_json::json!("No active QR token"));

        for _ in 0..2 {
            let cleared = dispatch_command("auth-center.qr-code.clear", serde_json::json!(null))
                .expect("clear");
            assert_eq!(cleared["cleared"], serde_json::json!(true));
        }
    }

    /// 命令面入参缺失必须显性报错（不揣着空串去比一个空 code / token）
    #[test]
    fn pairing_and_qr_verify_require_their_argument() {
        for (name, args) in [
            ("auth-center.pairing-code.verify", serde_json::json!({})),
            (
                "auth-center.pairing-code.verify",
                serde_json::json!({ "code": "" }),
            ),
            ("auth-center.qr-code.verify", serde_json::json!({})),
            (
                "auth-center.qr-code.verify",
                serde_json::json!({ "token": "" }),
            ),
        ] {
            let err = dispatch_command(name, args).expect_err("缺参数必须报错");
            assert!(err.to_string().contains("required"), "{name}: {err}");
        }
    }

    /// consent 命令面：native 无宿主 → 显性失败（不假放行 / 不静默 ask 冒充决策）
    ///
    /// 决策取值矩阵（trusted / explicit / one_time / ask / 缺身份）由
    /// `consent::ops::tests` 的纯函数用例覆盖；这里只锁「命令面确实接到决策实现体」
    /// 与「入参畸形报解析错误、不落到未知命令兜底」。
    #[test]
    fn consent_command_routes_to_decider_and_fails_loudly_on_native() {
        let err = dispatch_command(
            "auth-center.consent.decide",
            serde_json::json!({ "requestId": "r1", "nodeId": "aabbcc" }),
        )
        .expect_err("native 无宿主：既拿不到可信集也不敢假设，必须显性失败");
        assert!(
            err.to_string().contains("unavailable outside wasm runtime"),
            "got: {err}"
        );

        let err = dispatch_command(
            "auth-center.consent.decide",
            serde_json::json!({ "requestId": "r1" }),
        )
        .expect_err("缺 nodeId 必须解析失败");
        assert!(
            err.to_string().contains("invalid consent request"),
            "got: {err}"
        );
    }

    // ==================== 互调 api 面 / 记录域 / HTTP 入口接线 ====================

    /// manifest 的 api 清单必须与 trait 声明**精确一致**（声明方口径）
    ///
    /// 宏已在编译期比对，本用例锁住**规模**：漏搬一整段 api（例如 records 五项）时，
    /// 编译期只会说「少一条」而不会说「少了一整域」——数量断言让规模漂移可见。
    #[test]
    fn manifest_api_matches_declared_surface() {
        let manifest = AuthCenterPlugin::manifest();
        let mut expected = AuthCenterApiDispatcher::API_NAMES
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        expected.sort();
        let mut actual = manifest.api.clone();
        actual.sort();
        assert_eq!(actual, expected, "manifest api 必须与 trait 声明一致");
        assert_eq!(
            manifest.api.len(),
            19,
            "配对码四项 + QR 四项 + trust 两项 + consent 一项 + 密钥轮换一项 + 认证记录五项\
             （devices-list / history-list / history-clear / connection-touch / \
             connection-close）+ 就位状态一项 + auth-grant 一项（宿主 \
             auth-method-invoke 的零解析窄转发目标，未声明即被互调门禁整片拒）；\
             旧 auth-records-import 已按 issue #6 D5（新库冷启动、不迁 owner）删除"
        );
        // 权限面：六域各自的宿主原语门（auth/peer 是人审口径，storage 是记录库，
        // network:http 是路由注册）
        for perm in ["auth", "network:http", "peer", "storage"] {
            assert!(
                manifest.permissions.iter().any(|p| p == perm),
                "manifest 缺权限 {perm}（缺了对应域在运行时会被权限门整片拒）"
            );
        }
    }

    /// 信任 / 记录域命令面：native 无宿主 → 逐条**显性失败**
    ///
    /// 它锁的是「命令确实接到了域实现体」：漏接线时会落到 `Unknown command` 兜底
    /// （文案不同），而静默返回空列表会让页面显示「没有设备」而不是「读不到」。
    #[test]
    fn trust_and_records_commands_fail_loudly_on_native() {
        let cases: Vec<(&str, serde_json::Value)> = vec![
            ("auth-center.trust.list", serde_json::json!(null)),
            (
                "auth-center.trust.revoke",
                serde_json::json!({ "id": "p-1" }),
            ),
            ("auth-center.devices.list", serde_json::json!(null)),
            (
                "auth-center.history.list",
                serde_json::json!({ "deviceId": "p-1" }),
            ),
            (
                "auth-center.history.clear",
                serde_json::json!({ "deviceId": "p-1" }),
            ),
            ("auth-center.keys.status", serde_json::json!(null)),
        ];
        for (name, args) in cases {
            let err = dispatch_command(name, args).expect_err("native 无宿主必须显性失败");
            let msg = err.to_string();
            assert!(
                msg.contains("outside wasm runtime"),
                "{name} 未接到域实现体（疑似落到未知命令兜底）: {msg}"
            );
        }
    }

    /// 记录域读命令的必填参数：缺 `deviceId` 必须报参数错，不揣空串去查
    #[test]
    fn history_commands_require_device_id() {
        for name in ["auth-center.history.list", "auth-center.history.clear"] {
            for args in [serde_json::json!({}), serde_json::json!({ "deviceId": "" })] {
                let err = dispatch_command(name, args).expect_err("缺参数必须报错");
                assert!(err.to_string().contains("deviceId required"), "{name}: {err}");
            }
        }
    }

    /// `_http_endpoint`：宿主 HTTP 入口必须落到认证链分派器（不是未知命令）
    ///
    /// native 下七端点只能答「不可用」信封（无宿主 = 无记录库 / 无密钥环），断言的是
    /// **信封形状**（`{status, body}`）与**业务码**：宿主 `plugin_controller` 按这个
    /// 形状提取响应，形状错了就是 500 而不是可读的业务错误。
    #[test]
    fn http_endpoint_command_routes_to_auth_dispatch() {
        let reply = dispatch_command(
            "_http_endpoint",
            serde_json::json!({ "method": "POST", "path": "auth/pairing", "body": {} }),
        )
        .expect("_http_endpoint 必须可调");
        assert_eq!(reply["status"], serde_json::json!(200));
        assert_eq!(
            reply["body"]["message"],
            serde_json::json!("auth endpoints unavailable outside wasm runtime"),
            "必须落到 auth_http 分派器（未知命令兜底是 Err，不会有响应信封）"
        );

        // native 桩**不区分路径**（按 path 分派的 404 分支在 wasm 实现里）——这里只锁
        // 「宿主入口永远拿到响应信封而不是 Err」。别把这条当路径契约用：路径白名单
        // 由 `http_routes::ROUTES` + `auth_http::AUTH_HTTP_ENDPOINTS` 的用例守。
        let unknown = dispatch_command(
            "_http_endpoint",
            serde_json::json!({ "method": "POST", "path": "auth/nope", "body": {} }),
        )
        .expect("未知路径仍要回信封");
        assert_eq!(unknown["status"], serde_json::json!(200));
        assert!(unknown["body"].is_object(), "信封必须有 body 对象");
    }
}
