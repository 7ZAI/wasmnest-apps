//! 连通性探测的命令面（T19）：只探测**已保存**的 relay 地址。
//!
//! ## 为什么不接受前端传地址
//!
//! 地址真源是本插件 KV 的 `network.relay.relayAddrs`。若命令允许任意
//! `relayAddrs` 入参，这个诊断按钮就变成「任意 multiaddr 拨号器」（SSRF 面）；
//! 只读已保存值，天然与配置真源一致（不变量 P4）。
//!
//! ## 分层
//!
//! ```text
//! 本文件      读配置 → 选地址 → 调宿主原语（trait 注入，native 可测）
//! SDK         HostTunnel::tunnel_probe_relay → WIT host-tunnel.probe-relay
//! 能力域      地址校验 / 域名解析 / 限流 / 错误码（wasmnest-server-peer-net::tunnel::probe）
//! ```
//!
//! 失败一律 `code: detail` 串（与 WIT 错误形状一致），前端按首个 `: ` 拆代码与明细
//! 分别渲染——不把「不可达」和「身份不符」混成一句笼统错误。

use serde_json::Value;
use wasmnest_plugin_api::host::HostTunnel;
use wasmnest_plugin_api::WasmHost;

use crate::ops::load_relay;
use crate::store::NetConfigStore;

/// 尚未导入 relay 地址（按钮禁用态的兜底；命令被直接调用时也要显性）
pub(crate) const CODE_NOT_CONFIGURED: &str = "relay-not-configured";

/// 探测原语（宿主注入；native 测试用替身，不触发 wasm import）
pub(crate) trait ProbeHost {
    /// `addrs` = 已保存地址（原样透传，不在本层改写）；`timeout_ms` = 0 表示宿主缺省
    fn probe_relay(&self, addrs: &[String], timeout_ms: u32) -> Result<Value, String>;
}

/// SDK 给错误加的 API 名前缀（`WasmHost` 的 `host_err` 形态）
///
/// 能力域的错误本身已是 `code: detail`；不剥掉这层前缀，前端会把
/// `tunnel_probe_relay` 当成错误码，所有失败都落到「未识别」。
const SDK_ERROR_PREFIX: &str = "tunnel_probe_relay: ";

/// 去掉 SDK 的 API 名前缀，只留能力域的 `code: detail`
fn normalize_host_error(message: String) -> String {
    message
        .strip_prefix(SDK_ERROR_PREFIX)
        .unwrap_or(&message)
        .to_string()
}

/// 生产实现：SDK 的 `HostTunnel::tunnel_probe_relay`
pub(crate) struct WasmProbeHost;

impl ProbeHost for WasmProbeHost {
    fn probe_relay(&self, addrs: &[String], timeout_ms: u32) -> Result<Value, String> {
        WasmHost
            .tunnel_probe_relay(addrs, timeout_ms)
            .map_err(|e| normalize_host_error(e.message))
    }
}

/// 探测当前已保存的 relay 配置 → report JSON（成功）或 `code: detail`（失败）
pub(crate) fn probe_saved_relay(
    store: &impl NetConfigStore,
    host: &impl ProbeHost,
    timeout_ms: u32,
) -> Result<Value, String> {
    let config = load_relay(store)?.ok_or_else(|| {
        format!("{CODE_NOT_CONFIGURED}: 尚未导入中转地址（先导入 print-addrs 输出再探测）")
    })?;
    if config.relay_addrs.is_empty() {
        return Err(format!(
            "{CODE_NOT_CONFIGURED}: 已保存的中转配置没有可用地址（重新导入 print-addrs 输出）"
        ));
    }
    host.probe_relay(&config.relay_addrs, timeout_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::RELAY_KEY;
    use crate::store::MemoryStore;
    use serde_json::json;
    use std::cell::RefCell;

    const ADDR: &str = "/ip4/113.45.43.60/tcp/4001/p2p/12D3KooWBSCkgKRqQWpPhGGC61TfEWno22bcEGXxQvohhPbQBkud";

    fn stored_config() -> Value {
        json!({
            "version": 1,
            "relayAddrs": [ADDR],
            "peerId": "12D3KooWBSCkgKRqQWpPhGGC61TfEWno22bcEGXxQvohhPbQBkud",
            "peerIdSha256": "bc1420f7ef30a98de637c87ab49581bf3c9a649e7c82f5719aeb9388d61b29b7",
            "importedAt": "2026-11-10T13:26:37Z",
            "source": "json"
        })
    }

    /// 记录调用并回放固定结果
    struct FakeHost {
        reply: Result<Value, String>,
        calls: RefCell<Vec<(Vec<String>, u32)>>,
    }

    impl FakeHost {
        fn new(reply: Result<Value, String>) -> Self {
            Self {
                reply,
                calls: RefCell::new(Vec::new()),
            }
        }
    }

    impl ProbeHost for FakeHost {
        fn probe_relay(&self, addrs: &[String], timeout_ms: u32) -> Result<Value, String> {
            self.calls
                .borrow_mut()
                .push((addrs.to_vec(), timeout_ms));
            self.reply.clone()
        }
    }

    fn store_with(value: Value) -> MemoryStore {
        MemoryStore::with(RELAY_KEY, value)
    }

    #[test]
    fn 未配置时显性拒绝_不调用宿主() {
        let store = MemoryStore::default();
        let host = FakeHost::new(Ok(json!({})));
        let err = probe_saved_relay(&store, &host, 0).unwrap_err();
        assert!(err.starts_with("relay-not-configured:"), "{err}");
        assert!(host.calls.borrow().is_empty(), "未配置不得触达宿主");
    }

    #[test]
    fn 已保存地址与超时原样透传给宿主() {
        let store = store_with(stored_config());
        let host = FakeHost::new(Ok(json!({ "v": 1, "addr": ADDR })));
        let report = probe_saved_relay(&store, &host, 5_000).expect("探测成功");
        assert_eq!(report["addr"], ADDR);
        let calls = host.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, vec![ADDR.to_string()]);
        assert_eq!(calls[0].1, 5_000);
    }

    #[test]
    fn 宿主错误码原样上抛() {
        let store = store_with(stored_config());
        let host = FakeHost::new(Err("relay-unreachable: 127.0.0.1:4001 → 拒绝连接".to_string()));
        let err = probe_saved_relay(&store, &host, 0).unwrap_err();
        assert!(err.starts_with("relay-unreachable:"), "{err}");
    }

    #[test]
    fn 剥掉_sdk_api_前缀_保留能力域错误码() {
        assert_eq!(
            normalize_host_error("tunnel_probe_relay: relay-unreachable: 拒绝连接".to_string()),
            "relay-unreachable: 拒绝连接",
            "SDK 前缀不得进入前端错误码位"
        );
        assert_eq!(
            normalize_host_error("relay-unreachable: 拒绝连接".to_string()),
            "relay-unreachable: 拒绝连接",
            "已无前缀时原样返回"
        );
        assert_eq!(normalize_host_error("permission denied: tunnel:probe".to_string()),
            "permission denied: tunnel:probe");
    }

    #[test]
    fn 存储损坏时保留原值并报错() {
        let store = store_with(json!({ "version": 99 }));
        let host = FakeHost::new(Ok(json!({})));
        let err = probe_saved_relay(&store, &host, 0).unwrap_err();
        assert!(err.contains("version"), "{err}");
        assert!(host.calls.borrow().is_empty());
        assert!(
            store.read(RELAY_KEY).expect("存储仍可读").is_some(),
            "损坏的配置不得被静默清除"
        );
    }
}
