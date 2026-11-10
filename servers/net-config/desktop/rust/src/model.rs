//! 网络配置中心的数据结构（wire 与 T14 落盘形态逐字一致）
//!
//! 两份版本化配置都住本插件私有 KV：
//!
//! - `network.relay`（[`RELAY_KEY`]）：relay 寻址，**唯一真源**；字段与 T14
//!   `useRelaySettings` 的落盘形态同名（camelCase），消费方读法不变。
//! - `network.wanPolicy`（[`WAN_POLICY_KEY`]）：按插件 id 的「是否允许外网」策略；
//!   端口与暴露规则是运行期事实，仍由各业务自己 `expose`，本表不存。
//!
//! **存储内容不可信**：读取路径只做结构 + 形态校验，解析失败显性报错并由调用方
//! 决定提示；任何路径都**不静默清除**（静默清掉等于用户丢了唯一的中继寻址信息）。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// relay 配置 schema 版本（与 T14 一致：只认 1，未来版本显性拒绝）
pub const RELAY_SCHEMA_VERSION: u64 = 1;
/// WAN 策略 schema 版本
pub const WAN_POLICY_VERSION: u64 = 1;
/// 插件 KV：relay 寻址
pub const RELAY_KEY: &str = "network.relay";
/// 插件 KV：业务 WAN 注册表
pub const WAN_POLICY_KEY: &str = "network.wanPolicy";
/// 单次导入的地址上限（产出方通常只给 1–2 条）
pub const MAX_RELAY_ADDRS: usize = 16;
/// sha256 指纹的十六进制长度
pub const FINGERPRINT_HEX_LEN: usize = 64;

/// relay 配额（只保留客户端需要知道的字段）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayQuota {
    pub max_circuit_bytes: u64,
    pub max_circuit_duration_secs: u64,
}

/// relay 配置（`network.relay`）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayConfig {
    pub version: u64,
    /// 可拨地址（已含 `/p2p/<peerId>`，顺序保持产出方顺序）
    pub relay_addrs: Vec<String>,
    /// 中继 PeerId（base58）
    pub peer_id: String,
    /// 指纹：sha256(ed25519 公钥) 十六进制（本地复算值）
    pub peer_id_sha256: String,
    /// 准入模式：`open` / `allowlist` / null（文本形态未给）
    #[serde(default)]
    pub access_mode: Option<String>,
    /// 中继版本（只有 JSON 形态带）
    #[serde(default)]
    pub relay_version: Option<String>,
    /// 控制协议名
    #[serde(default)]
    pub control_protocol: Option<String>,
    /// 配额（只有 JSON 形态带）
    #[serde(default)]
    pub quota: Option<RelayQuota>,
    /// 导入时间（ISO 8601）
    pub imported_at: String,
    /// 导入来源：`json` / `text`
    pub source: String,
}

/// 单个业务的 WAN 策略
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WanPolicyEntry {
    pub allow_wan: bool,
    #[serde(default)]
    pub note: String,
    /// 最近一次更新时间（ISO 8601）
    pub updated_at: String,
}

/// 业务 WAN 注册表（`network.wanPolicy`）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WanPolicy {
    pub version: u64,
    #[serde(default)]
    pub apps: BTreeMap<String, WanPolicyEntry>,
}

impl Default for WanPolicy {
    fn default() -> Self {
        Self {
            version: WAN_POLICY_VERSION,
            apps: BTreeMap::new(),
        }
    }
}

/// 解析存储值 → relay 配置（结构 + 形态校验；版本不认识即拒绝，不猜字段语义）
pub fn parse_relay_config(value: &Value) -> Result<RelayConfig, String> {
    let version = value.get("version").and_then(Value::as_u64);
    if version != Some(RELAY_SCHEMA_VERSION) {
        return Err(format!(
            "relay settings version unsupported: {}",
            version
                .map(|v| v.to_string())
                .unwrap_or_else(|| "<missing>".into())
        ));
    }
    let config: RelayConfig = serde_json::from_value(value.clone())
        .map_err(|e| format!("relay settings unparseable: {e}"))?;
    config.validate()?;
    Ok(config)
}

/// 解析存储值 → WAN 策略（缺省 = 空表；版本不认识即拒绝）
pub fn parse_wan_policy(value: &Value) -> Result<WanPolicy, String> {
    let version = value.get("version").and_then(Value::as_u64);
    if version != Some(WAN_POLICY_VERSION) {
        return Err(format!(
            "wan policy version unsupported: {}",
            version
                .map(|v| v.to_string())
                .unwrap_or_else(|| "<missing>".into())
        ));
    }
    let policy: WanPolicy = serde_json::from_value(value.clone())
        .map_err(|e| format!("wan policy unparseable: {e}"))?;
    policy.validate()?;
    Ok(policy)
}

impl RelayConfig {
    /// 结构不变式（存储 / 导入共用；失败即显性报错）
    pub fn validate(&self) -> Result<(), String> {
        if self.version != RELAY_SCHEMA_VERSION {
            return Err(format!(
                "relay settings version unsupported: {}",
                self.version
            ));
        }
        if self.relay_addrs.is_empty() {
            return Err("relay settings has no relay address".to_string());
        }
        if self.relay_addrs.len() > MAX_RELAY_ADDRS {
            return Err(format!(
                "relay settings has too many addresses (max {MAX_RELAY_ADDRS})"
            ));
        }
        for addr in &self.relay_addrs {
            validate_relay_addr(addr)?;
            // 地址里的 PeerId 必须就是配置声明的中继身份：两者不一致时，客户端会
            // 拨到一个「证书对不上」的节点（或把配置写成了别人的 relay）。
            if addr.rsplit("/p2p/").next() != Some(self.peer_id.as_str()) {
                return Err(format!(
                    "relay address peer id does not match peerId: {addr}"
                ));
            }
        }
        if !peer_id_is_plausible(&self.peer_id) {
            return Err("relay settings has an invalid peerId".to_string());
        }
        if !fingerprint_is_valid(&self.peer_id_sha256) {
            return Err(
                "relay settings has an invalid peerIdSha256 (64 lowercase hex required)"
                    .to_string(),
            );
        }
        if let Some(mode) = &self.access_mode {
            if mode != "open" && mode != "allowlist" {
                return Err(format!("relay settings accessMode unsupported: {mode}"));
            }
        }
        if let Some(version) = &self.relay_version {
            if version.trim().is_empty() {
                return Err("relay settings has an empty relayVersion".to_string());
            }
        }
        if let Some(protocol) = &self.control_protocol {
            if protocol.trim().is_empty() {
                return Err("relay settings has an empty controlProtocol".to_string());
            }
        }
        if self.imported_at.trim().is_empty() {
            return Err("relay settings has an empty importedAt".to_string());
        }
        if self.source != "json" && self.source != "text" {
            return Err(format!(
                "relay settings source unsupported: {}",
                self.source
            ));
        }
        Ok(())
    }
}

impl WanPolicy {
    /// 结构不变式：版本 + 每个 key 是插件 id + updatedAt 非空
    pub fn validate(&self) -> Result<(), String> {
        if self.version != WAN_POLICY_VERSION {
            return Err(format!("wan policy version unsupported: {}", self.version));
        }
        for (plugin_id, entry) in &self.apps {
            if !plugin_id_is_valid(plugin_id) {
                return Err(format!("wan policy has an invalid plugin id: {plugin_id}"));
            }
            if entry.updated_at.trim().is_empty() {
                return Err(format!(
                    "wan policy entry for {plugin_id} has an empty updatedAt"
                ));
            }
        }
        Ok(())
    }

    /// 写入一条策略（`allowWan` 逐业务决定，不因地址统一而自动打开）
    pub fn upsert(
        &mut self,
        plugin_id: &str,
        allow_wan: bool,
        note: &str,
        updated_at: &str,
    ) -> Result<(), String> {
        if !plugin_id_is_valid(plugin_id) {
            return Err(format!("invalid plugin id: {plugin_id}"));
        }
        if updated_at.trim().is_empty() {
            return Err("updatedAt required".to_string());
        }
        self.apps.insert(
            plugin_id.to_string(),
            WanPolicyEntry {
                allow_wan,
                note: note.to_string(),
                updated_at: updated_at.to_string(),
            },
        );
        Ok(())
    }
}

/// 插件 id：非空、含 `.`、无空白、字符集受限（防把任意键写进注册表）
pub fn plugin_id_is_valid(plugin_id: &str) -> bool {
    let text = plugin_id.trim();
    !text.is_empty()
        && text.len() <= 128
        && text == plugin_id
        && text.contains('.')
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// 单条 relay 基础地址形态校验
///
/// 只接受 `/ip4|ip6|dns|dns4|dns6/<host>/tcp/<port>/p2p/<peerId>`；带
/// `/p2p-circuit` 的是拨号目标，不是中继地址，直接拒绝。深度校验（IPv4 / 域名
/// 语法、PeerId 公钥解码与指纹复算）在前端导入期完成；本层守住「存储里不会出现
/// 另一类地址」的结构面。
pub fn validate_relay_addr(addr: &str) -> Result<(), String> {
    let text = addr.trim();
    if text.is_empty() || text != addr {
        return Err("relay address has surrounding whitespace".to_string());
    }
    if !text.starts_with('/') || text.ends_with('/') || text.contains(char::is_whitespace) {
        return Err(format!("relay address shape invalid: {text}"));
    }
    if text.contains("/p2p-circuit") {
        return Err("relay address must not be a /p2p-circuit dial target".to_string());
    }
    let parts: Vec<&str> = text.split('/').skip(1).collect();
    if parts.len() != 6 {
        return Err(format!("relay address shape invalid: {text}"));
    }
    let (host_proto, host, tcp_proto, port, p2p_proto, peer_id) =
        (parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
    if !matches!(host_proto, "ip4" | "ip6" | "dns" | "dns4" | "dns6") {
        return Err(format!(
            "relay address host protocol unsupported: {host_proto}"
        ));
    }
    if host.is_empty() || host.contains(char::is_whitespace) {
        return Err(format!("relay address has an invalid host: {text}"));
    }
    if tcp_proto != "tcp" || p2p_proto != "p2p" {
        return Err(format!("relay address must be tcp + p2p: {text}"));
    }
    let port: u32 = port
        .parse()
        .map_err(|_| format!("relay address has an invalid port: {text}"))?;
    if port == 0 || port > 65535 {
        return Err(format!("relay address port out of range: {text}"));
    }
    if !peer_id_is_plausible(peer_id) {
        return Err(format!("relay address has an invalid peer id: {text}"));
    }
    Ok(())
}

/// PeerId 形态：base58 字母表 + 合理长度（深度解码在前端导入期）
fn peer_id_is_plausible(peer_id: &str) -> bool {
    const BASE58: &str = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    !peer_id.is_empty()
        && peer_id.len() >= 32
        && peer_id.len() <= 128
        && peer_id.chars().all(|c| BASE58.contains(c))
}

/// sha256 十六进制指纹（小写 64 位）
fn fingerprint_is_valid(fingerprint: &str) -> bool {
    fingerprint.len() == FINGERPRINT_HEX_LEN
        && fingerprint
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, 'a'..='f'))
}

/// Unix 秒 → ISO 8601 UTC（`1970-01-01T00:00:00Z` 形态）
///
/// 不引 chrono：只需要一个固定格式的时间戳字段，纯整数换算即可（模块内单测钉住
/// epoch 与一个已知时刻）。
pub fn iso8601_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hour, minute, second) = (rem / 3_600, (rem % 3_600) / 60, rem % 60);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Howard Hinnant 的 civil_from_days（days since 1970-01-01）
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PEER_ID: &str = "12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H";
    const FINGERPRINT: &str = "d842779d48acb8694b01b0091b72e4b81f7a52bad4bca0ee03cf14e3c689cadb";

    fn addr() -> String {
        format!("/dns4/relay.example.com/tcp/4001/p2p/{PEER_ID}")
    }

    fn valid_config() -> Value {
        serde_json::json!({
            "version": 1,
            "relayAddrs": [addr()],
            "peerId": PEER_ID,
            "peerIdSha256": FINGERPRINT,
            "accessMode": "open",
            "relayVersion": "0.0.1",
            "controlProtocol": "/wasmnest/relay-control/1",
            "quota": { "maxCircuitBytes": 1073741824, "maxCircuitDurationSecs": 3600 },
            "importedAt": "2026-11-08T00:00:00Z",
            "source": "json",
        })
    }

    #[test]
    fn relay_config_accepts_t14_shape() {
        let config = parse_relay_config(&valid_config()).expect("parse");
        assert_eq!(config.relay_addrs, vec![addr()]);
        assert_eq!(config.peer_id, PEER_ID);
        assert_eq!(config.access_mode.as_deref(), Some("open"));
        assert_eq!(
            config.quota.expect("quota").max_circuit_bytes,
            1_073_741_824
        );
    }

    #[test]
    fn relay_config_rejects_unknown_or_missing_version() {
        for version in [Value::Null, serde_json::json!(2), serde_json::json!("1")] {
            let mut value = valid_config();
            if version.is_null() {
                value.as_object_mut().expect("obj").remove("version");
            } else {
                value["version"] = version;
            }
            let err = parse_relay_config(&value).expect_err("version must be rejected");
            assert!(err.contains("version"), "{err}");
        }
    }

    #[test]
    fn relay_config_rejects_bad_addrs_identity_and_source() {
        let cases: Vec<(&str, Value)> = vec![
            ("空地址", {
                let mut v = valid_config();
                v["relayAddrs"] = serde_json::json!([]);
                v
            }),
            ("circuit 地址", {
                let mut v = valid_config();
                v["relayAddrs"] = serde_json::json!([format!(
                    "/ip4/203.0.113.9/tcp/4001/p2p/{PEER_ID}/p2p-circuit/p2p/{PEER_ID}"
                )]);
                v
            }),
            ("额外段", {
                let mut v = valid_config();
                v["relayAddrs"] = serde_json::json!([format!(
                    "/dns4/relay.example.com/tcp/4001/p2p/{PEER_ID}/ws"
                )]);
                v
            }),
            ("端口越界", {
                let mut v = valid_config();
                v["relayAddrs"] =
                    serde_json::json!([format!("/dns4/relay.example.com/tcp/70000/p2p/{PEER_ID}")]);
                v
            }),
            ("非法 peerId", {
                let mut v = valid_config();
                v["peerId"] = serde_json::json!("0OIl");
                v
            }),
            ("地址 PeerId 与 peerId 不一致", {
                let mut v = valid_config();
                v["peerId"] =
                    serde_json::json!("12D3KooWD3eckifWpRn9wQpMG9R9hX3sD158z7EqHWmweQAJU5SA");
                v
            }),
            ("非法指纹", {
                let mut v = valid_config();
                v["peerIdSha256"] = serde_json::json!("A".repeat(64));
                v
            }),
            ("非法准入模式", {
                let mut v = valid_config();
                v["accessMode"] = serde_json::json!("everyone");
                v
            }),
            ("非法来源", {
                let mut v = valid_config();
                v["source"] = serde_json::json!("qr");
                v
            }),
            ("空导入时间", {
                let mut v = valid_config();
                v["importedAt"] = serde_json::json!(" ");
                v
            }),
        ];
        for (name, value) in cases {
            assert!(
                parse_relay_config(&value).is_err(),
                "{name} 必须被拒绝（存储里不得出现半可信配置）"
            );
        }
    }

    #[test]
    fn wan_policy_upserts_and_validates_plugin_ids() {
        let mut policy = WanPolicy::default();
        policy
            .upsert(
                "com.wasmnest.bedcode",
                true,
                "desktop",
                "2026-11-09T00:00:00Z",
            )
            .expect("upsert");
        policy
            .upsert(
                "com.wasmnest.file-transfer",
                false,
                "",
                "2026-11-09T00:00:01Z",
            )
            .expect("upsert");
        policy.validate().expect("valid");
        assert!(policy.apps["com.wasmnest.bedcode"].allow_wan);
        assert!(!policy.apps["com.wasmnest.file-transfer"].allow_wan);

        for bad in ["", "bedcode", "com wasmnest", "com/wasmnest"] {
            assert!(
                policy
                    .upsert(bad, true, "", "2026-11-09T00:00:00Z")
                    .is_err(),
                "{bad:?} 不是合法插件 id"
            );
        }
    }

    #[test]
    fn wan_policy_rejects_unknown_version_and_bad_entries() {
        let mut value = serde_json::json!({ "version": 2, "apps": {} });
        assert!(parse_wan_policy(&value).is_err());
        value["version"] = serde_json::json!(1);
        value["apps"] = serde_json::json!({ "com.wasmnest.bedcode": { "allowWan": true } });
        assert!(
            parse_wan_policy(&value).is_err(),
            "缺 updatedAt 的条目必须拒绝（陈旧判断依赖它）"
        );
    }

    #[test]
    fn iso8601_matches_known_instants() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso8601_utc(1_800_000_000), "2027-01-15T08:00:00Z");
    }
}
