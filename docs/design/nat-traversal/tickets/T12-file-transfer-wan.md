# [feat] T12 · file-transfer：远程设备连接串、多地址拨号、中继状态与固定加密

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P2 ｜ **依赖**：T11、T06 ｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.6、§4.9、§4.10、§5.2、不变量 9/12
- **默认执行口径（待裁定项按设计默认）**：§9.2#3 同网段不可达不自动切；#4 大文件无阈值、经 relay 一次提示；#7 前台接收（不做后台常驻）

## 需求描述

file-transfer 跨 NAT：远程设备连接串/QR 导入、多地址拨号（内网默认）、中继传输状态与限额；**应用层加密固定开启**（WAN/LAN 都强制，移除关闭项）。传输帧协议、断点续传、暂停/恢复、并发闸门全部复用现有实现。

## 落点 app 与端

`file-transfer` / 双端（共用 wasm + 双端前端）。

## 验收条件

- [ ] 远程设备连接串 `wasmnest://pair/<base64url(json)>` / 纯 JSON：桌面「添加远程设备」、移动「扫码或粘贴」共用解析；只放 nodeId + addrs + 一次性票据，不放长期密钥。
- [ ] 拨号策略：mDNS/上次 LAN 地址先试（2-3s 短超时）；只有 §4.9 明确判据才 `dial-peer-addrs` 走 relay；同网段不可达显示「设备离线/服务未启动」，不自动烧中继。
- [ ] `PeerLink.transport` 记录 lan/wan；状态栏 `内网直连`/`外网中继`/`内网不可达`/`已暂停`。
- [ ] **加密固定 `true`**：`settings.rs:35,51` 默认改 `true` 并移除关闭项；UI 显示「始终加密」而非可切换项；WAN/LAN 批次都强制；旧对端不支持显性失败（不变量 12）。
- [ ] `allowWan`（默认开，可关；关闭 ≠ 关闭加密）与 `relayMaxBytesPerTask` 设置项；大文件经 relay 给一次「可能较慢」提示，可取消（不改变模式判定）。
- [ ] relay 配额断开 circuit → 断点续传重新拨号建新 circuit 继续（预期行为，非错误）。
- [ ] 已配对设备按 nodeId 持久化 `{deviceName, relayAddrs[], lastSeen}`；地址变化由应用更新。
- [ ] 双端 `test:run`（移动无 vitest 则按现状说明）+ `cargo test` + 双端构建绿；真实环境目验。

## 相关契约与锁

- 依赖 T11 `dial-peer-addrs`；T06 模式事件与 `allowWan` 门控。
- 加密吞吐影响需实测（§9.1 风险 10），结果记入 T15 验收。
- 撤销设备 → peer 信任同步撤销（不变量 7，consent 写入同一份信任列表）。
- i18n / 锚点 / `docs/verification/file-transfer.md` 同步（T15 收口）。