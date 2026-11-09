//! 拨号候选组装（T12）：把「设备缓存里的单地址」与「配对连接串带来的多地址」
//! 合成一次拨号的 multiaddr 候选表，并把 §4.9 的自动/手动 WAN 判据收敛成一个
//! 纯函数（双端共用、可直测，不触宿主）。
//!
//! ## 判据（设计 §4.9 + T12 验收）
//!
//! - LAN 直连候选永远排最前（地址顺序 = 调用方策略顺序，宿主不重排）；
//! - relay（`.../p2p-circuit/...`）候选**只有**满足下列之一才纳入：
//!   ① 用户显式点「尝试外网」；② 没有任何 LAN 候选（「明确不在内网」的保守
//!   近似——没有内网地址就别无选择）；③ 上次拨号已走 relay（重连沿用同一路径，
//!   否则 WAN 会话一断就永远回不来）；
//! - `allow_wan = false` 时永远不纳入 relay，**但不影响加密**（不变量 12：关的
//!   只是中继，不是链路加密）；只有 relay 候选时显性报错，不静默降级成「无地址」；
//! - 空候选表显性报错并点名原因（fail-visible，不返回空表让上层猜）。

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

fn dedup_push(out: &mut Vec<String>, addr: String) {
    if !addr.is_empty() && !out.iter().any(|a| a == &addr) {
        out.push(addr);
    }
}

/// 组装拨号计划。
///
/// `manual_wan` = 用户显式「尝试外网」；`ep.wan` = 上次拨号已走 relay（重连沿用）。
/// 两个意图取并集，再受 `allow_wan` 闸门约束。
pub fn dial_plan(ep: &DialEndpoint, allow_wan: bool, manual_wan: bool) -> Result<DialPlan, String> {
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
            return Err("no LAN address known and relay is disabled (allow-wan=false)".to_string());
        }
        return Err("no dialable address for peer (addr/port and addrs are all empty)".to_string());
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
        assert!(err.contains("allow-wan=false"), "实得 {err}");
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
        assert!(err.contains("no dialable address"), "实得 {err}");
        // 空白项跳过而不是当成地址
        assert!(dial_plan(&ep(" ", 0, &["  "]), true, false).is_err());
    }
}
