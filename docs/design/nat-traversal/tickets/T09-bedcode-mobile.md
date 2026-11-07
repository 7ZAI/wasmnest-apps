# [feat] T09 · bedcode 移动：tunnel 客户端、本地回环代理接入与模式状态消费

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P1 ｜ **依赖**：T06、T08、T04 ｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.5（对移动端的影响）、§4.8、§4.9、§5.2

## 需求描述

bedcode 移动作为拨号方接入穿透：QR v2 / 已配对记录解析出 peer 信息，`tunnel.connect` 建立隧道后把 `127.0.0.1:<localPort>` 当作现有 `address:port`——HTTP/WS/JWT/重连代码几乎不改。新版始终走 tunnel（LAN 直连地址优先，明确不在内网才 relay），不存在「LAN 直连 HTTP 绕过对等面」的第二条路径。

## 落点 app 与端

`bedcode` / 移动（rust + 前端）。

## 验收条件

- [ ] `PrimaryTarget` 增可选 `peer` 信息；持久化改为 nodeId + relayAddrs + deviceName + 最近一次模式与原因（**不再持久化 LAN IP**），重启后重新判定。
- [ ] `tunnel.connect({nodeId, port, kind:"http", addrs, pairingTicket?})`：首次配对带票据（来自 QR/连接串），已匹配省略；成功后本地代理地址接入现有 HTTP/WS 代码。
- [ ] 模式消费：只读 `host-tunnel.status` + `peer:mode` 事件；Wi-Fi 先 LAN、蜂窝/明确不在内网才 WAN；`lan-unreachable` 显示「内网不可达」+ 手动「尝试外网」入口。
- [ ] 链加密：初始化 link-crypto context；本地代理流量**不触发环回跳过**（T04 判据），正常协商；能力不足/协商失败显性失败（`encryption-required`/`encryption-unsupported`），不降级。
- [ ] 生命周期：前台建立、离开终端页 `close(handle)`；代理关闭后重连拨号映射为显性 `tunnel-closed`/`peer-offline`，**不对已关闭的 127.0.0.1 端口静默重试**；桌面离线显性 `peer-offline`，不退化成 30s 超时。
- [ ] 被撤销后表现：连接失败显性报安全错误，不自动切 relay 绕过（不变量 9）。
- [ ] 状态栏：`内网直连`/`外网中继`/`内网不可达`/`外网已关闭`/`离线` + `已加密` 标记；切换轻提示不弹模态。
- [ ] app `test:run` + `cargo test` + 构建绿；Android dev 目验；`mobile-` 前缀锚点同步。

## 相关契约与锁

- 依赖 T05 `connect` 票据入参、T06 宿主判定与事件、T08 QR v2 解析。
- 平台仓移动测试全量（若动运行面）；真机单端 E2E 在 T10 收口。
- 旧版回退：`host/port` 仅旧版客户端使用；新版不存在明文 LAN HTTP 路径。