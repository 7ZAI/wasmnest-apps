//! 认证中心互调消费面（issue #6 注册切换）
//!
//! 切换后 BedCode 退回纯产品应用：设备中心命令、consent 决策与连接记录不再由
//! 本插件自持，而是经 ADR 0017 互调消费 `com.wasmnest.auth-center`。
//!
//! ## 为什么不保留本地回退
//!
//! 本插件里的六域副本在切换后**停止更新**（注册注销、设备中心改指）。转发失败时
//! 回退本地实现会返回过期数据，让「中心没就位」伪装成「配对成功但手机连不上」——
//! 正是 fail-closed 设计要消除的排障黑洞。故失败一律原样上抛（含超时 / 门禁拒绝），
//! 由调用方按「读不到」呈现。
//!
//! ## native（cargo test）
//!
//! 宏生成的 client 依赖 wasm 专属宿主 import，故只在 wasm 目标声明；native 下每个
//! 入口返回显性错误（不返回空值冒充「没有设备 / 没有历史」）。单测据此断言命令面
//! 确实接到了转发层，而不是落到未知命令兜底。
//!
//! ## 契约真源
//!
//! `#[plugin_api]` 以认证中心 `plugin.json` 为比对源（消费方判据 `trait ⊆ manifest`）：
//! 只镜像本插件真正调用的 api，对侧新增条目不需要跟演。

use serde_json::Value;

/// 认证中心插件 id（互调目标；宿主按注册表寻址的属主同值）
pub(crate) const AUTH_CENTER_ID: &str = "com.wasmnest.auth-center";

/// 单次互调超时（毫秒）：设备页取数与配对动作都在人机交互窗口内
#[cfg(target_arch = "wasm32")]
const CALL_TIMEOUT_MS: u64 = 5_000;

/// 连接事件 touch/close 的超时（毫秒）：事件回调里等太久会阻塞后续事件；
/// 失败只 warn（认证记录是持久真源，写入失败必须可见但不阻断事件发布）
#[cfg(target_arch = "wasm32")]
const EVENT_TIMEOUT_MS: u64 = 3_000;

#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::host::HostBus;
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::plugin_api;

#[cfg(target_arch = "wasm32")]
#[plugin_api(manifest = "../../../../servers/auth-center/desktop/plugin.json")]
#[allow(dead_code)]
trait AuthCenterApi {
    #[api("status")]
    fn status() -> Result<Value, String>;

    #[api("pairing-code-generate")]
    fn pairing_code_generate(ttl: u64) -> Result<Value, String>;

    #[api("pairing-code-status")]
    fn pairing_code_status() -> Result<Option<Value>, String>;

    #[api("pairing-code-clear")]
    fn pairing_code_clear() -> Result<(), String>;

    #[api("qr-code-generate")]
    fn qr_code_generate(ttl: u64) -> Result<Value, String>;

    #[api("qr-code-status")]
    fn qr_code_status() -> Result<Option<Value>, String>;

    #[api("qr-code-clear")]
    fn qr_code_clear() -> Result<(), String>;

    #[api("trust-list")]
    fn trust_list() -> Result<Value, String>;

    #[api("trust-revoke")]
    fn trust_revoke(id: String) -> Result<Value, String>;

    #[api("devices-list")]
    fn devices_list() -> Result<Value, String>;

    #[api("history-list")]
    fn history_list(device_id: String) -> Result<Value, String>;

    #[api("history-clear")]
    fn history_clear(device_id: String) -> Result<Value, String>;

    #[api("consent-decide")]
    fn consent_decide(
        request: crate::consent::model::ConsentRequest,
    ) -> Result<crate::consent::model::ConsentDecision, String>;

    #[api("connection-touch")]
    fn connection_touch(fingerprint: String) -> Result<(), String>;

    #[api("connection-close")]
    fn connection_close(fingerprint: String) -> Result<(), String>;

    #[api("keys-rotate")]
    fn keys_rotate() -> Result<Value, String>;
}

#[cfg(target_arch = "wasm32")]
fn call<R>(
    f: impl FnOnce(AuthCenterApiClient) -> Result<R, wasmnest_plugin_api::api_call::ApiCallError>,
) -> Result<R, String> {
    f(AuthCenterApiClient::new(AUTH_CENTER_ID).with_timeout(CALL_TIMEOUT_MS))
        .map_err(|e| e.to_string())
}

// ==================== wasm 入口（宏生成 client 直连认证中心） ====================

#[cfg(target_arch = "wasm32")]
pub(crate) fn status() -> Result<Value, String> {
    call(|c| c.status())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn pairing_code_generate(ttl: u64) -> Result<Value, String> {
    call(|c| c.pairing_code_generate(ttl))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn pairing_code_status() -> Result<Option<Value>, String> {
    call(|c| c.pairing_code_status())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn pairing_code_clear() -> Result<(), String> {
    call(|c| c.pairing_code_clear())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn qr_code_generate(ttl: u64) -> Result<Value, String> {
    call(|c| c.qr_code_generate(ttl))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn qr_code_status() -> Result<Option<Value>, String> {
    call(|c| c.qr_code_status())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn qr_code_clear() -> Result<(), String> {
    call(|c| c.qr_code_clear())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn trust_list() -> Result<Value, String> {
    call(|c| c.trust_list())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn trust_revoke(id: &str) -> Result<Value, String> {
    call(|c| c.trust_revoke(id.to_string()))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn devices_list() -> Result<Value, String> {
    call(|c| c.devices_list())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn history_list(device_id: &str) -> Result<Value, String> {
    call(|c| c.history_list(device_id.to_string()))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn history_clear(device_id: &str) -> Result<Value, String> {
    call(|c| c.history_clear(device_id.to_string()))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn consent_decide(
    request: crate::consent::model::ConsentRequest,
) -> Result<crate::consent::model::ConsentDecision, String> {
    call(|c| c.consent_decide(request))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn connection_touch(fingerprint: &str) -> Result<(), String> {
    AuthCenterApiClient::new(AUTH_CENTER_ID)
        .with_timeout(EVENT_TIMEOUT_MS)
        .connection_touch(fingerprint.to_string())
        .map_err(|e| e.to_string())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn connection_close(fingerprint: &str) -> Result<(), String> {
    AuthCenterApiClient::new(AUTH_CENTER_ID)
        .with_timeout(EVENT_TIMEOUT_MS)
        .connection_close(fingerprint.to_string())
        .map_err(|e| e.to_string())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn keys_rotate() -> Result<Value, String> {
    call(|c| c.keys_rotate())
}

// ==================== native 入口（无宿主 import → 显性失败） ====================

#[cfg(not(target_arch = "wasm32"))]
macro_rules! unavailable {
    ($name:literal) => {
        Err(concat!($name, " unavailable outside wasm runtime").to_string())
    };
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn status() -> Result<Value, String> {
    unavailable!("auth center status")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn pairing_code_generate(_ttl: u64) -> Result<Value, String> {
    unavailable!("pairing code generate via auth center")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn pairing_code_status() -> Result<Option<Value>, String> {
    unavailable!("pairing code status via auth center")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn pairing_code_clear() -> Result<(), String> {
    unavailable!("pairing code clear via auth center")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn qr_code_generate(_ttl: u64) -> Result<Value, String> {
    unavailable!("qr code generate via auth center")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn qr_code_status() -> Result<Option<Value>, String> {
    unavailable!("qr code status via auth center")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn qr_code_clear() -> Result<(), String> {
    unavailable!("qr code clear via auth center")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn trust_list() -> Result<Value, String> {
    unavailable!("auth center trust list")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn trust_revoke(_id: &str) -> Result<Value, String> {
    unavailable!("auth center trust revoke")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn devices_list() -> Result<Value, String> {
    unavailable!("auth center devices list")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn history_list(_device_id: &str) -> Result<Value, String> {
    unavailable!("auth center connection history")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn history_clear(_device_id: &str) -> Result<Value, String> {
    unavailable!("auth center connection history clear")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn consent_decide(
    _request: crate::consent::model::ConsentRequest,
) -> Result<crate::consent::model::ConsentDecision, String> {
    unavailable!("auth center consent decide")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn connection_touch(_fingerprint: &str) -> Result<(), String> {
    unavailable!("auth center connection touch")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn connection_close(_fingerprint: &str) -> Result<(), String> {
    unavailable!("auth center connection close")
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn keys_rotate() -> Result<Value, String> {
    unavailable!("auth center key rotation")
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// native 下每条转发入口都必须显性失败（不返回空视图冒充「没有数据」）
    #[test]
    fn every_forwarding_entry_fails_loudly_on_native() {
        let request = crate::consent::model::ConsentRequest {
            request_id: "r1".to_string(),
            node_id: "aabb".to_string(),
            fingerprint_short: None,
            device_name: None,
            user_decision: None,
        };
        let cases: Vec<(&str, Result<(), String>)> = vec![
            ("status", status().map(|_| ())),
            ("pairing generate", pairing_code_generate(60).map(|_| ())),
            ("pairing status", pairing_code_status().map(|_| ())),
            ("pairing clear", pairing_code_clear()),
            ("qr generate", qr_code_generate(300).map(|_| ())),
            ("qr status", qr_code_status().map(|_| ())),
            ("qr clear", qr_code_clear()),
            ("trust list", trust_list().map(|_| ())),
            ("trust revoke", trust_revoke("p-1").map(|_| ())),
            ("devices list", devices_list().map(|_| ())),
            ("history list", history_list("p-1").map(|_| ())),
            ("history clear", history_clear("p-1").map(|_| ())),
            ("consent decide", consent_decide(request).map(|_| ())),
            ("connection touch", connection_touch("fp")),
            ("connection close", connection_close("fp")),
            ("keys rotate", keys_rotate().map(|_| ())),
        ];
        for (name, result) in cases {
            let err = result.expect_err("native 必须显性失败");
            assert!(
                err.contains("unavailable outside wasm runtime"),
                "{name} 错误信息缺上下文: {err}"
            );
            assert!(
                err.contains("auth center")
                    || err.contains("via auth center")
                    || err.contains("pairing code")
                    || err.contains("qr code"),
                "{name} 必须点名认证中心转发面（区别于本地旧副本）: {err}"
            );
        }
    }
}
