# [feat] T11 · `dial-peer-addrs`：多地址拨号契约与数据面地址记忆

- **落仓**：`7ZAI/wasmnest-lib`（WIT 真源仓；契约类）
- **标签**：`kind:contract`
- **阶段**：P2 ｜ **依赖**：T02 ｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.6（方案 B）、§5.1

## 需求描述

让 file-transfer 的 peer 拨号接受多地址（LAN 直连 + relay multiaddr），数据面记住全部候选地址。采用**方案 B**：保留旧 `dial-peer` 不动，新增 `dial-peer-addrs(endpoint-json)`，避免破坏性变更与旧产物全量重建。

## 落点 app 与端

机制：`wasmnest-server-peer-net`（WIT + 绑定）+ `wasmnest-p2p-engine`（多地址 dial 已在 T02）；双端共用。

## 验收条件

- [ ] 新 WIT 函数 `dial-peer-addrs(endpoint-json)`：`{nodeId, addrs:[multiaddr...]}`；旧 `dial-peer` 路径不回归。
- [ ] 会话句柄记忆**全部**候选地址（现只记一个 endpoint）；断线重拨按调用方策略顺序重试。
- [ ] 数据面 `send/browse/pull` 自动重拨复用同一策略；**不再要求对端在 mDNS 发现缓存里**。
- [ ] 拨号策略语义留给应用层（T12）：先 LAN 短超时（2-3s），只有 §4.9 判定明确不在内网才试 relay；本层不擅自自动切换。
- [ ] 契约测试 + native 测试 + 双端 app 构建绿（WIT 变更全量重建纪律）。

## 相关契约与锁

- WIT 变更：compose 重拼 + `witSha256` + SDK/lock 同步 + tag 钉住。
- `PeerLink` 记录 `transport: lan|wan`（wan 下含 relay 地址）供 UI/指标（T12 消费）。
- 寻址由调用方显式传入；宿主 trust store 不存 relay 地址（保持「谁可信」单一语义，§4.3）。