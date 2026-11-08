# [feat] T08 · auth-center：QR v2 载荷、配对票据透传与 peerNodeId 配对记录

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P1 ｜ **依赖**：T06 ｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.3、§4.1 规则 2、§5.2

## 需求描述

把现有 `{host, port, token}` QR 升级为 v2：追加 `peer` 字段（nodeId + 多地址 + 一次性传输票据），让移动端扫码即可建立隧道；配对记录保存 peerNodeId，配对成功事件供 bedcode 桌面写入 peer 信任。旧版移动端忽略未知字段仍走 LAN（兼容承诺仅对已支持 link-crypto 的旧客户端成立）。

## 落点 app 与端

`auth-center` / 桌面（载荷生成与配对记录）；`bedcode` 双端消费（生成入口在桌面设置页，解析在移动）。

## 验收条件

- [ ] QR v2 载荷：`{v:2, host, port, token, peer:{nodeId, addrs[], ticket}}`；`host/port` 仅旧版兼容与诊断，不作新版数据入口。
- [ ] `peer.addrs`：同一 peer 节点多地址——LAN 直连地址在前（宿主枚举非虚拟网卡 IP，**不返回 `0.0.0.0`**，多网卡列多条，端口取 `host-tunnel.status` 实际监听端口，不写死 47613）+ relay 地址在后。
- [ ] `ticket` 经 `host-tunnel.issue-pairing-ticket` 签发：绑目标端口、TTL ≤ 120s、一次性、LAN/relay 均可用；票据不落日志。
- [ ] 连接串形态 `wasmnest://pair/<base64url(json)>` 与 QR 共用一套解析；不放长期密钥。
- [ ] 配对记录保存 `peerNodeId`；配对成功事件触发 bedcode 桌面写 peer 信任（T07 消费）。
- [ ] 旧版 QR（无 `peer` 字段）解析不回归；v2 载荷缺字段时 fail-visible。
- [ ] app `test:run` + `cargo test` + 构建绿。

## 相关契约与锁

- QR token 仍是 128-bit 一次性（`servers/auth-center/desktop/rust/src/pairing/qr.rs`）；token 只走带外，relay 不接触（不变量 13）。
- 6 位码 v1 仅 LAN；远程 rendezvous / PAKE 不在本 ticket（§9.2#5）。
- 与 T07（信任写入）、T09（移动解析与 connect 带票据）接口对齐。