# [feat] T06 · 平台仓：权限词汇、compose/SDK、双端宿主装配与传输模式判定

- **落仓**：`7ZAI/wasmnest`（平台协调 issue，正文点名 lib / apps 子任务交叉引用）
- **标签**：`kind:feature`、`cross-repo`
- **阶段**：P1 ｜ **依赖**：T05（WIT 定稿）｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.2（地址解析）、§4.8、§4.9、§5.1/§5.2、§8 P1 顺序 4
- **基线对齐（2026-11-08 用户裁定：对齐多包基线，已开工）**：平台工作树 `.worktrees/wasmnest/nat-traversal`（分支 `feat/nat-traversal`，基于 `dev` 9a0fb2bc）已建立；能力仓对齐工作树为 `.worktrees/wasmnest-lib/nat-traversal-v2`（分支 `feat/nat-traversal-v2`，基于 `dev` 6b4275f）。旧单包 nat 工作树保留归档，不再作为实施基线。T06 在平台 v2 工作树上做 caps.tunnel 登记 / 宿主 bindings / compose 重拼 / `witSha256` / 全量重建。详见 spec §8。
- **装配已具备的机制面（2026-11-08）**：T05 已提供 `TunnelServer::handle_stream` / `TunnelPolicy` / `TicketIssuer` / `PairingRegistry::resolver()` / `ClientConnector` / `BackendConnector` / `TunnelStreamOpener` / `PipeLimits`，宿主只需注入实际端口与信任表、注册 `TUNNEL`（`require_admitted=false`）、实现引擎拨号与句柄表，不重复实现安全判定。

## 需求描述

把 T02–T05 的能力装进双端宿主：权限词汇、compose/SDK 绑定、服务租约、reservation 引用计数、peer face 生命周期、移动本地回环代理与前台服务协作，以及 §4.9 的宿主侧网络判定（不暴露给前端 JS）。

## 落点 app 与端

平台：桌面宿主 + 移动宿主；权限真源 `plugin-sdk-desktop/rust/src/permission.rs`。

## 验收条件

**契约与装配**

- [ ] 权限词汇新增 `tunnel:serve`（expose/unexpose/issue-pairing-ticket）与 `tunnel:connect`（connect/close；status 归属一并定）；manifest 校验同步；未声明应用永远 lan-only。
- [ ] compose.json / SDK 绑定 / `witSha256` / host-runtime lock / `release-manifest.json` 同步；`check:manifest` 绿。
- [ ] 桌面装配 `net.tunnel` 服务租约（或复用 `net.peer-node`）；peer face 启动/关闭跟随 `tunnel:serve` 规则。
- [ ] 移动装配 `host-tunnel` client 绑定、本地回环代理、前台服务协作（前台建立、离开终端页关闭）。

**reservation 引用计数（单一所有权）**

- [ ] 宿主隧道管理器统一引用计数：计数来源 = 生效 expose 规则（`allowWan=true` 才计入）+ 客户端在飞 WAN 拨号；0→1 建立、1→0 释放。
- [ ] `expose`/`unexpose`、`allowWan` 开关、服务租约只改计数，不各自直接管理 reservation。
- [ ] `allowWan=false` 时即使有 expose 规则也不建立/保留 reservation（LAN 入口不受影响）；lan-active 期间 reservation 可保留（控制面），受同一计数与 `allowWan` 门控。

**§4.9 宿主侧模式判定**

- [ ] 网络类型（Android `ConnectivityManager`）与接口子网枚举由宿主完成；应用只读 `host-tunnel.status` 与 `peer:mode` 事件。
- [ ] 「明确不在内网」判据表全实现：蜂窝直切；候选 IP 不在任何接口子网且无 mDNS；无 LAN 候选；`EHOSTUNREACH`/`ENETUNREACH`。同网段 timeout/`ECONNREFUSED`/服务未启动 → `lan-unreachable` + 手动入口；认证/信任/Noise 失败不切；刚换网等 5s 发现窗口。
- [ ] 状态机：`pairing / lan-probing / lan-active / lan-unreachable / wan-connecting / wan-active / wan-unavailable / offline`；wan-active 周期（30s）/换网探测 LAN，连续两次成功才切回。
- [ ] relay 域名经宿主 `lookup_host` 解析（T02 口径）。

## 相关契约与锁

- 平台桌面 + 移动测试全量绿（含 `hostAppBoundaryLock` 不受影响）；新增隧道/对等面测试。
- 事件词表：`peer:transport` / `peer:mode` / `peer:encryption` / `tunnel:state` / `tunnel:error`（设计 §7.2）。
- 模式是**每对端**的，不是全局开关；手动「尝试外网」本次网络会话内保持，换网回自动策略。