# [feat] T02 · p2p-engine：relay client、reservation 生命周期、多地址拨号与传输事件

- **落仓**：`7ZAI/wasmnest-lib`
- **标签**：`kind:feature`
- **阶段**：P1 ｜ **依赖**：T01 ｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§3.3、§4.2（地址解析）、§4.8、§7.2、§8 P1 顺序 1

## 需求描述

把 PoC 的 relay 能力产品化为引擎正式面：relay client、reservation 生命周期、多地址 dial、传输状态事件。本 ticket **先不改 WIT**，用测试夹具验证；WIT 显式化在 T05。

## 落点 app 与端

机制：`wasmnest-p2p-engine`；双端共用（桌面服务端 reservation / 移动拨号方）。

## 验收条件

- [ ] `relay` feature 默认关闭，宿主显式开启；Android 构建树仍零 rustls/aws-lc。
- [ ] reservation 建立/释放/自动重连 + 指数退避；relay 重启后恢复。
- [ ] 多地址 dial：同一 nodeId 的 LAN 直连地址 + relay multiaddr 候选列表，按调用方给定顺序尝试。
- [ ] 传输状态事件：`lan-direct` / `wan-relay` / `relay-reserved` / `relay-lost`（词表与设计 §7.2 一致）。
- [ ] relay 域名地址由**宿主层** `tokio::net::lookup_host` 解析成 IP 再拼 multiaddr（不启用引擎 `dns` feature，避免改 Android feature 面）。
- [ ] relay PeerId 钉住校验：拒绝「同 IP 不同 PeerId」替换。
- [ ] native 测试 + Android `cargo check` 绿。

## 相关契约与锁

- `peer-node-config` 增 `relay-addrs: option<list<string>>` / `enable-relay: bool` 的取舍随 T05 定稿（也可宿主设置驱动）。
- 全局 `PeerCtx` 共享：一个进程一个身份、一个 reservation（`plugin_binding.rs:556-561`）；不做 per-app 多身份。
- reservation 的**引用计数所有权在宿主隧道管理器**（T06），引擎只提供建立/释放原语。