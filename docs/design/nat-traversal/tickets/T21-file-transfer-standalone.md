# [feat] T21 · file-transfer 独立化（去 BedCode 依赖）

- **落仓**：`7ZAI/wasmnest-apps`
- **真源**：GitHub issue [#27](https://github.com/7ZAI/wasmnest-apps/issues/27)
- **状态**：**已实施（2026-11-12）**——能力仓 `node-info` / `configure-relay` + 平台 SDK/宿主接线 + 应用侧闭环；桌面二维码与移动多档扫码同批落地
- **依赖**：无（后续可接 T18 配置中心，但不是依赖）

## 一句话

file-transfer 自持「我的设备」连接串与 relay 接入：被连方在 file-transfer 内配置一次
relay 并建立预留，连接方只粘贴/扫码；不再要求 BedCode 打开、也不再要求添加设备时
先配中继。

## 缺的两条宿主原语（真源见 issue #27）

```wit
record peer-node-info {
    node-id: string,
    addrs: list<string>,
    relay-state: string,
}
node-info: func() -> result<peer-node-info, string>;
configure-relay: func(relay-addrs-json: string, enable: bool) -> result<peer-node-info, string>;
```

## 本仓已落（应用侧）

- `rust/core/src/settings.rs`：`relayAddrs` 持久化 + `normalize_relay_addrs` 校验。
- `rust/plugin/src/peer.rs`：`get-my-device` 读面 + `relayAddrs` 设置；宿主能力未就绪时
  显性 `supported=false`（不伪造 nodeId / addrs）。
- 双端 `pairingLink.ts`：v3 连接串生成（`buildRemotePeerLink`）+ 解析兼容。
- 双端「我的设备」UI（桌面 dialog / 移动 sheet）：连接串、relay 状态、外网接入配置；
  宿主未就绪时显性说明。
- 去 BedCode 化：添加设备来源提示改指本应用「我的设备」；移除产品文案与注释里的
  BedCode 关联。

## 实施记录（2026-11-12）

### 能力仓 `wasmnest-lib`

- `wasmnest-server-peer-net/wit/peer.wit`：新增 `peer-node-info` record +
  `node-info` / `configure-relay`（权限复用 `peer`，独立 `peer:relay` 位留待权限细分票）。
- 新增 `relay_reservation.rs`：host-tunnel 与 host-peer 共用 owner 表，取并集后串行下发；
  节点重启 `reapply`、节点关停 `reset_applied`，一个 owner 退出只回收自己份额。
- 新增 `node_info.rs`：本机 nodeId / 设备名 / 可拨地址 / relay 状态；**只有
  `RelayState::Reserved` 才把 circuit 放进 addrs**（与 tunnel `NodeSnapshot` 同判据）。
- `TunnelManager` 的 reserve/release 改走同一协调器；`PeerNetState` 增加 `device_name`
  与 relay owner 表。

### 平台仓 `wasmnest`

- `compose-wit --all` 重拼双端 SDK WIT；桌面 SDK `HostPeer` 新增
  `peer_node_info` / `peer_configure_relay`（`PeerNodeInfo` DTO）+ `WasmHost` 实现。
- 桌面 / 移动宿主 `cargo check` 通过（共享 peer 绑定层自动获得新原语，无端差异）。

### 应用仓 `wasmnest-apps`

- `HOST_NODE_INFO_SUPPORTED` / `HOST_RELAY_RESERVATION_SUPPORTED` 置 `true`；
  `get-my-device` 填真实 `nodeId / deviceName / addrs / relayState`。
- relay 真源统一到配置中心（桌面读 `com.wasmnest.net-config`，中心不可用回退 KV；
  移动读本地设置）；「我的设备」桌面端只读 + 跳转 `/network`，不再保留第二份编辑器。
- activate / `set-settings` / `get-my-device` 幂等收敛预留；deactivate 释放本插件份额。
- 桌面「我的设备」新增二维码（`qrcode` + 按模块数计算画布，与 BedCode 同判据）；
  移动扫码改为多档解码（原生 BarcodeDetector → ZXing 全尺寸 / 降采样 / ROI），
  替换固定 `qrbox: 250` 的单次解码。

### 验证

- lib：`wasmnest-server-peer-net` 323 tests + `common-host,relay` cargo check/clippy（本文件新增代码无告警）。
- 平台：双端宿主 `cargo check` 通过；`compose-wit --all --check` 通过。
- 应用：plugin 124 tests / core 96 tests / desktop 106 tests / mobile 72 tests；
  wasm 组件化构建与双端前端构建通过；eslint 0 error。
- 未跑：真实宿主跨 NAT 手工验收（需先重建并安装含新 WIT 的宿主运行时；
  当前 `host-runtime.lock.json` 的 artifacts 仍为空）。
