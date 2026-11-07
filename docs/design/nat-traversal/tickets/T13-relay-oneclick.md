# [feat] T13 · `wasmnest-relay`：一键配置/一键运行交付包（仅 Linux）

- **落仓**：`7ZAI/wasmnest-lib`（新 crate + `deploy/relay/`）
- **标签**：`kind:feature`
- **阶段**：P2 ｜ **依赖**：T01（可与 P1 并行开发）｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.2、§4.2.1、§6.3、不变量 5/13
- **已裁定**：仅 Linux（amd64/arm64）+ Docker，不做 Windows/macOS；默认 open + 配额（目标端匹配是授权权威）；官方公共 relay 是否提供另议（§9.2#1，不阻塞本 ticket）

## 需求描述

自建 relay 的主路径不能要求用户手写 libp2p 配置：单文件二进制 + Docker/Compose + `init`/`doctor`/`print-addrs`，导入地址即可用。relay 是独立守护进程，不是 wasm、不是宿主内嵌服务。

## 落点 app 与端

机制：能力仓新 crate `wasmnest-relay` + `deploy/relay/`；公网 VPS / 用户自建 Linux 服务器。

## 验收条件

**守护进程**

- [ ] libp2p swarm：TCP + Noise + Yamux；relay v2 server；ping；`libp2p-stream` 控制协议；默认监听 `0.0.0.0:4001/tcp`，v1 不启用 UDP。
- [ ] reservation 准入：默认「开放 + 配额」；`--allowlist` / enrollment token 供私有 relay。
- [ ] 配额：`max_reservations` / `reservation_ttl` / `max_circuit_duration` / `max_circuit_bytes` / 每 peer 并发 circuit / 每 IP 连接上限；默认值与 P2 1GB 验收对齐（单 circuit ≥ 1GB 或显式文档化续传重建）。
- [ ] 指标/健康端点绑 `127.0.0.1:9090`，不默认公网暴露；只聚合计数与字节数，**不记 payload/文件名/路径**（不变量 5）；不接触 token/票据明文（不变量 13）。

**一键交付物**

- [ ] `init --dir --advertise`：生成身份密钥/配置/multiaddr/二维码；已有密钥拒绝覆盖（需 `--force`）。
- [ ] `run --config`；`doctor`（身份/端口/公网可达/时钟/磁盘/版本）；`print-addrs --json`（带协议版本）；`token create --label`。
- [ ] Linux amd64/arm64 静态二进制；Docker 多架构镜像 `ghcr.io/7zai/wasmnest-relay:<version>` + Compose（`restart: unless-stopped`、healthcheck、数据卷、生产 digest 钉住）；可选 `install.sh` + systemd unit。
- [ ] 身份与配置落 `/data`，**重启不换 PeerId**；版本独立轴 `relay-vX.Y.Z`，身份密钥与版本解耦。

**全流程验收**

- [ ] 全新 Linux VPS 一键起 relay → 应用导入地址 → 跨 NAT 可用；重启后 PeerId 不变。
- [ ] relay 侧抓包只有密文（Noise 不被终止）。
- [ ] `doctor` 各项自检通过/失败均给出可操作原因。

## 相关契约与锁

- relay 不是授权点：reservation ≠ 信任；allowlist 只防滥用（不变量 10）。
- 无需 TLS 证书（Noise 在 libp2p 层）；防火墙只需 TCP 4001。
- `print-addrs` 输出格式是 T14 桌面卡片导入契约；协议版本供导入/doctor 校验。