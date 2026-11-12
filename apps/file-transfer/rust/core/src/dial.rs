//! 拨号候选组装（T12 + T20）：把「设备缓存里的单地址」与「配对连接串带来的多地址」
//! 合成一次拨号的 multiaddr 候选表，并把 §4.9 的自动/手动 WAN 判据收敛成一个
//! 纯函数（双端共用、可直测，不触宿主）。
//!
//! ## 判据（设计 §4.9 + T12 / T20 验收）
//!
//! - LAN 直连候选永远排最前（地址顺序 = 调用方策略顺序，宿主不重排）；
//! - relay（`.../p2p-circuit/...`）候选**只有**满足下列之一才纳入：
//!   ① 用户显式点「尝试外网」；② 没有任何 LAN 候选（「明确不在内网」的保守
//!   近似——没有内网地址就别无选择）；③ 上次拨号已走 relay（重连沿用同一路径，
//!   否则 WAN 会话一断就永远回不来）；
//! - `relay_only`（用户显式「仅经中继」）跳过 LAN，候选表只剩 relay；
//! - `allow_wan = false` 时永远不纳入 relay，**但不影响加密**（不变量 12：关的
//!   只是中继，不是链路加密）；只有 relay 候选时显性报错，不静默降级成「无地址」；
//! - 空候选表显性报错并点名原因（fail-visible，不返回空表让上层猜）。
//!
//! 错误码是**契约**：插件命令边界把码原样作为 `dial-peer` 返回载荷的 `status`
//! （前端按 token 给可操作出路，见 `rust/plugin/src/peer.rs` 的 `DialAttemptError`），
//! 数据面命令的错误正文则带 `<code>:` 前缀便于日志关联：`no-endpoint` /
//! `relay-disabled`。

use std::fmt;

use crate::domain::DialEndpoint;

/// relay circuit 的 multiaddr 标记（引擎 `ip4/.../p2p/<relay>/p2p-circuit/p2p/<target>`）
pub const RELAY_MARKER: &str = "/p2p-circuit";

/// 是否为经 relay 的候选（顺序/形状判据只看该标记，与引擎裁决同源）
pub fn is_relay_addr(addr: &str) -> bool {
    addr.contains(RELAY_MARKER)
}

/// 单地址 → LAN 直连 multiaddr（`/ip4|ip6/<addr>/tcp/<port>`）。
///
/// 已是 multiaddr 时原样返回（配对串里的多地址不需要重拼），但**只认合法首段
/// 协议**：任何 `/` 开头的字符串都当 multiaddr 会让 `/some/path` 之类的垃圾
/// 进候选表、被引擎逐个拨（C7——不可拨号就不猜，返回 None）。
/// 空地址 / 端口 0 / 未指定的 `0.0.0.0` / 含空白 → `None`。
pub fn direct_multiaddr(addr: &str, port: u16) -> Option<String> {
    let addr = addr.trim();
    if addr.is_empty() || addr.contains(char::is_whitespace) {
        return None;
    }
    if addr.starts_with('/') {
        let proto = addr.trim_start_matches('/').split('/').next().unwrap_or("");
        let dialable = matches!(proto, "ip4" | "ip6" | "dns" | "dns4" | "dns6" | "p2p");
        return dialable.then(|| addr.to_string());
    }
    if port == 0 || addr == "0.0.0.0" || addr == "::" {
        return None;
    }
    let proto = if addr.contains(':') { "ip6" } else { "ip4" };
    Some(format!("/{proto}/{addr}/tcp/{port}"))
}

/// 一次拨号的候选计划
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DialPlan {
    /// 按序尝试的 multiaddr 候选（LAN 在前，relay 在后）
    pub candidates: Vec<String>,
    /// 本次是否纳入了 relay 候选（成功后写回 endpoint.wan，供重连沿用）
    pub relay_included: bool,
}

/// 拨号计划失败的稳定码（插件侧作为命令返回载荷的 `status` token 下发；前端只按
/// token 分类，不猜正文）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialErrorCode {
    /// 没有任何可拨地址（`addr:port` 与 `addrs` 全空，或「仅经中继」但无 relay 候选）
    NoEndpoint,
    /// 只剩 relay 候选但 `allowWan = false`（策略挡下，不静默降级）
    RelayDisabled,
}

impl DialErrorCode {
    /// wire 字面（前端前缀表同源）
    pub fn as_str(self) -> &'static str {
        match self {
            DialErrorCode::NoEndpoint => "no-endpoint",
            DialErrorCode::RelayDisabled => "relay-disabled",
        }
    }
}

impl fmt::Display for DialErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 拨号计划失败：分类码 + 归因正文（正文只进日志 / 诊断，不进用户文案分类）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DialError {
    pub code: DialErrorCode,
    pub detail: String,
}

impl DialError {
    pub fn new(code: DialErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

impl fmt::Display for DialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for DialError {}

fn dedup_push(out: &mut Vec<String>, addr: String) {
    if !addr.is_empty() && !out.iter().any(|a| a == &addr) {
        out.push(addr);
    }
}

/// 组装拨号计划。
///
/// `manual_wan` = 用户显式「尝试外网」；`ep.wan` = 上次拨号已走 relay（重连沿用）；
/// `ep.relay_only` = 用户显式「仅经中继」（跳过 LAN，优先级最高）。
/// 前两个意图取并集，再受 `allow_wan` 闸门约束。
pub fn dial_plan(
    ep: &DialEndpoint,
    allow_wan: bool,
    manual_wan: bool,
) -> Result<DialPlan, DialError> {
    let mut lan = Vec::new();
    let mut relay = Vec::new();
    if let Some(direct) = direct_multiaddr(&ep.addr, ep.port) {
        if is_relay_addr(&direct) {
            dedup_push(&mut relay, direct);
        } else {
            dedup_push(&mut lan, direct);
        }
    }
    for raw in &ep.addrs {
        let addr = raw.trim();
        if addr.is_empty() {
            continue;
        }
        if is_relay_addr(addr) {
            dedup_push(&mut relay, addr.to_string());
        } else {
            dedup_push(&mut lan, addr.to_string());
        }
    }

    // 「仅经中继」：显式跳过内网。策略关掉 relay 时显性失败——用户的意图无法
    // 满足，不能静默降级成 LAN 拨号（那会让「蜂窝下必走的路径」变成撞墙超时）
    if ep.relay_only {
        if !allow_wan {
            return Err(DialError::new(
                DialErrorCode::RelayDisabled,
                "relay-only dial requested but relay is disabled (allow-wan=false)",
            ));
        }
        if relay.is_empty() {
            return Err(DialError::new(
                DialErrorCode::NoEndpoint,
                "relay-only dial requested but no relay candidate is known",
            ));
        }
        return Ok(DialPlan {
            candidates: relay,
            relay_included: true,
        });
    }

    let relay_wanted = manual_wan || ep.wan;
    let relay_known = !relay.is_empty();
    let include_relay = allow_wan && relay_known && (relay_wanted || lan.is_empty());

    let mut candidates = lan;
    if include_relay {
        candidates.extend(relay);
    }

    if candidates.is_empty() {
        if relay_known {
            // 有地址但被策略挡下：点名是哪个闸门，避免用户以为「设备没地址」
            return Err(DialError::new(
                DialErrorCode::RelayDisabled,
                "no LAN address known and relay is disabled (allow-wan=false)",
            ));
        }
        return Err(DialError::new(
            DialErrorCode::NoEndpoint,
            "no dialable address for peer (addr/port and addrs are all empty)",
        ));
    }

    Ok(DialPlan {
        candidates,
        relay_included: include_relay,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep(addr: &str, port: u16, addrs: &[&str]) -> DialEndpoint {
        DialEndpoint {
            node_id: "n".into(),
            addr: addr.into(),
            port,
            addrs: addrs.iter().map(|s| s.to_string()).collect(),
            wan: false,
            relay_only: false,
        }
    }

    const LAN_MULTIADDR: &str = "/ip4/192.168.1.5/tcp/47613";
    const RELAY_CIRCUIT: &str =
        "/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTarget";

    #[test]
    fn direct_multiaddr_maps_ipv4_ipv6_and_passes_multiaddr_through() {
        assert_eq!(
            direct_multiaddr("192.168.1.5", 47613).as_deref(),
            Some(LAN_MULTIADDR)
        );
        assert_eq!(
            direct_multiaddr("fe80::1", 4001).as_deref(),
            Some("/ip6/fe80::1/tcp/4001")
        );
        assert_eq!(
            direct_multiaddr(LAN_MULTIADDR, 0).as_deref(),
            Some(LAN_MULTIADDR),
            "已是 multiaddr 时端口参数不参与"
        );
        for bad in ["", "   ", "0.0.0.0", "::", "10.0.0.1 5"] {
            assert_eq!(direct_multiaddr(bad, 4001), None, "不可拨号地址：{bad}");
        }
        assert_eq!(direct_multiaddr("10.0.0.1", 0), None, "端口 0 不可拨号");
        // 只有合法 multiaddr 首段协议才透传；其余 `/` 开头字符串不是地址（C7）
        assert_eq!(direct_multiaddr("/some/path", 0), None);
        assert_eq!(direct_multiaddr("//host/a", 0), None);
        assert_eq!(
            direct_multiaddr("/dns/example.com/tcp/4001", 0).as_deref(),
            Some("/dns/example.com/tcp/4001")
        );
    }

    #[test]
    fn lan_address_is_used_alone_and_relay_stays_out_by_default() {
        let plan = dial_plan(
            &ep("192.168.1.5", 47613, &[LAN_MULTIADDR, RELAY_CIRCUIT]),
            true,
            false,
        )
        .unwrap();
        assert_eq!(plan.candidates, vec![LAN_MULTIADDR.to_string()]);
        assert!(!plan.relay_included, "有 LAN 候选时不得自动烧中继（§4.9）");
    }

    #[test]
    fn manual_wan_appends_relay_after_lan() {
        let plan = dial_plan(&ep("192.168.1.5", 47613, &[RELAY_CIRCUIT]), true, true).unwrap();
        assert_eq!(
            plan.candidates,
            vec![LAN_MULTIADDR.to_string(), RELAY_CIRCUIT.to_string()],
            "手动尝试外网：LAN 仍先试，relay 排后"
        );
        assert!(plan.relay_included);
    }

    #[test]
    fn relay_only_endpoint_is_dialed_when_no_lan_candidate_exists() {
        // 无 addr/port：等价于「明确不在内网」的保守近似
        let plan = dial_plan(&ep("", 0, &[RELAY_CIRCUIT]), true, false).unwrap();
        assert_eq!(plan.candidates, vec![RELAY_CIRCUIT.to_string()]);
        assert!(plan.relay_included);
    }

    #[test]
    fn allow_wan_false_never_includes_relay() {
        let plan = dial_plan(&ep("192.168.1.5", 47613, &[RELAY_CIRCUIT]), false, true).unwrap();
        assert_eq!(plan.candidates, vec![LAN_MULTIADDR.to_string()]);
        assert!(!plan.relay_included, "allowWan=false 时手动入口也不得纳入");

        let err = dial_plan(&ep("", 0, &[RELAY_CIRCUIT]), false, true).unwrap_err();
        assert_eq!(err.code, DialErrorCode::RelayDisabled);
        assert!(err.detail.contains("allow-wan=false"), "实得 {err}");
    }

    #[test]
    fn previous_wan_success_keeps_relay_on_redial() {
        let mut e = ep("192.168.1.5", 47613, &[RELAY_CIRCUIT]);
        e.wan = true;
        let plan = dial_plan(&e, true, false).unwrap();
        assert_eq!(
            plan.candidates,
            vec![LAN_MULTIADDR.to_string(), RELAY_CIRCUIT.to_string()],
            "上次走 relay 的会话断线后必须能按同一路径重连"
        );
        assert!(plan.relay_included);
    }

    #[test]
    fn candidates_are_deduped_and_empty_endpoint_reports_reason() {
        let plan = dial_plan(
            &ep(
                "192.168.1.5",
                47613,
                &[LAN_MULTIADDR, "/ip4/192.168.1.5/tcp/47613"],
            ),
            true,
            false,
        )
        .unwrap();
        assert_eq!(plan.candidates.len(), 1, "同一地址去重保序");

        let err = dial_plan(&ep("", 0, &[]), true, false).unwrap_err();
        assert_eq!(err.code, DialErrorCode::NoEndpoint);
        assert!(err.detail.contains("no dialable address"), "实得 {err}");
        // 空白项跳过而不是当成地址
        assert!(dial_plan(&ep(" ", 0, &["  "]), true, false).is_err());
    }

    // ==================== T20：仅经中继 ====================

    #[test]
    fn relay_only_skips_lan_and_dials_relay_first() {
        let mut e = ep("192.168.1.5", 47613, &[LAN_MULTIADDR, RELAY_CIRCUIT]);
        e.relay_only = true;
        let plan = dial_plan(&e, true, false).unwrap();
        assert_eq!(
            plan.candidates,
            vec![RELAY_CIRCUIT.to_string()],
            "仅经中继：不得先等 LAN 超时"
        );
        assert!(plan.relay_included);
        // 不带 manual_wan 也成立：relay_only 自身就是显式意图
        assert!(dial_plan(&e, true, false).unwrap().relay_included);
    }

    #[test]
    fn relay_only_without_relay_candidate_fails_visibly() {
        let mut e = ep("192.168.1.5", 47613, &[LAN_MULTIADDR]);
        e.relay_only = true;
        let err = dial_plan(&e, true, false).unwrap_err();
        assert_eq!(err.code, DialErrorCode::NoEndpoint);
        assert!(err.detail.contains("relay-only"), "实得 {err}");
    }

    #[test]
    fn relay_only_respects_allow_wan_gate() {
        let mut e = ep("192.168.1.5", 47613, &[RELAY_CIRCUIT]);
        e.relay_only = true;
        let err = dial_plan(&e, false, false).unwrap_err();
        assert_eq!(err.code, DialErrorCode::RelayDisabled);
        assert!(err.detail.contains("allow-wan=false"), "实得 {err}");
    }

    #[test]
    fn relay_only_after_wan_memo_keeps_same_path_on_redial() {
        // 上次仅经中继成功：memo 同时带 wan 与 relay_only，断线重拨仍不得回头试 LAN
        let mut e = ep("192.168.1.5", 47613, &[LAN_MULTIADDR, RELAY_CIRCUIT]);
        e.wan = true;
        e.relay_only = true;
        let plan = dial_plan(&e, true, false).unwrap();
        assert_eq!(plan.candidates, vec![RELAY_CIRCUIT.to_string()]);
    }
}
