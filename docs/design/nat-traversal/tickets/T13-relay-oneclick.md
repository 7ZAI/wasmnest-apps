# [feat] T13 · `wasmnest-relay`：一键配置/一键运行交付包（仅 Linux）

- **落仓**：`7ZAI/wasmnest-lib`（新 crate + `deploy/relay/`）
- **标签**：`kind:feature`
- **阶段**：P2 ｜ **依赖**：T01（可与 P1 并行开发）｜ **状态**：待提交 GitHub（gh 未认证）；**代码与一键交付物已落地（2026-11-08，能力仓 `feat/relay-oneclick`），真机/VPS 验收与镜像构建待补**
- **设计依据**：§4.2、§4.2.1、§6.3、不变量 5/13
- **已裁定**：仅 Linux（amd64/arm64）+ Docker，不做 Windows/macOS；默认 open + 配额（目标端匹配是授权权威）；官方公共 relay 是否提供另议（§9.2#1，不阻塞本 ticket）

## 需求描述

自建 relay 的主路径不能要求用户手写 libp2p 配置：单文件二进制 + Docker/Compose + `init`/`doctor`/`print-addrs`，导入地址即可用。relay 是独立守护进程，不是 wasm、不是宿主内嵌服务。

## 落点 app 与端

机制：能力仓新 crate `wasmnest-relay` + `deploy/relay/`；公网 VPS / 用户自建 Linux 服务器。

## 验收条件

**守护进程**

- [x] libp2p swarm：TCP + Noise + Yamux；relay v2 server（`Status::Enable` + 对外通告地址）；ping；`libp2p-stream` 控制协议；默认监听 `0.0.0.0:4001/tcp`，v1 不启用 UDP。
- [x] reservation 准入：默认「开放 + 配额」；`--allowlist` / enrollment token 供私有 relay（准入接在 relay 限量器，白名单外的 peer 仍可连上来兑换 token）。
- [x] 配额：`max_reservations` / `reservation_ttl` / `max_circuit_duration` / `max_circuit_bytes` / 每 peer 并发 circuit / 每 IP 连接上限；默认单 circuit 1 GiB / 1 小时，保留 libp2p 默认的按 peer / 按 IP 速率限制。
- [x] 指标/健康端点绑 `127.0.0.1:9090`，不默认公网暴露（非回环地址必须显式 `expose_public`）；只聚合计数、**不记 payload/文件名/路径**（不变量 5）；不接触 token 明文（不变量 13）。**字节数不提供**：`libp2p-relay` 0.22 的 `CircuitClosed` 不带字节计数，不伪造。

**一键交付物**

- [x] `init --dir --advertise`：生成身份密钥/配置/导入载荷（multiaddr + PeerId + 指纹 + JSON）；已有密钥/配置拒绝覆盖（需 `--force`）。二维码由导入端渲染（见「实施记录」偏差记录）。
- [x] `run --config`；`doctor`（身份/配置/端口/时钟/数据目录/token/版本；公网可达如实标 `unknown` 并给外部验证路径）；`print-addrs --json`（带载荷版本与控制协议名）；`token create --label [--max-uses]`。
- [ ] Linux amd64/arm64 静态二进制；Docker 多架构镜像 `ghcr.io/7zai/wasmnest-relay:<version>` + Compose（`restart: unless-stopped`、healthcheck、数据卷、生产 digest 钉住）；可选 `install.sh` + systemd unit。**现状**：Dockerfile / Compose / install.sh / unit 全部就位且 `docker compose config` 与 `sh -n` 通过；**镜像构建未实证**（本机无法访问 Docker Hub 与 crates.io），故静态 musl 产物与 arm64 依赖树随之待 CI 验证。
- [x] 身份与配置落 `/data`，**重启不换 PeerId**（同一身份重载 PeerId/指纹不变有单测 + 实跑复核）；版本独立轴 `relay-vX.Y.Z`（打 tag 属发布动作，本轮未打）。

**全流程验收**

- [ ] 全新 Linux VPS 一键起 relay → 应用导入地址 → 跨 NAT 可用；重启后 PeerId 不变（归 T15，需真实 VPS 与另一台网络）。
- [ ] relay 侧抓包只有密文（Noise 不被终止）。
- [ ] `doctor` 各项自检通过/失败均给出可操作原因。

## 实施记录（2026-11-08）

落点：能力仓分支 `feat/relay-oneclick`（工作树 `.worktrees/wasmnest-lib/relay-oneclick`），
提交 `feat(lib): 新增 wasmnest-relay 中继守护进程与一键部署包（T13）`。

**代码面**

- 新 crate `wasmnest-relay`（顶层，`src/` 11 个模块 + `main.rs`）：swarm 装配（TCP + Noise +
  Yamux + relay v2 + ping + `libp2p-stream` 控制协议）、事件循环、配额、准入、enrollment
  token、指标端点、自检、CLI 全在位。
- `deploy/relay/`：`Dockerfile`（alpine/musl 静态构建，多架构）、`docker-compose.yml`
  （`restart: unless-stopped` + healthcheck + 数据卷 + `no-new-privileges`）、`install.sh`
  （systemd 一键装）、`wasmnest-relay.service`、`config.example.toml`、`README.md`（运维手册）。
- 形态锁（crate 内单测）：生产依赖零内部 crate / 零 `path` 边；libp2p 保持
  `default-features = false` 且不含 quic/tls/webrtc；控制协议名只在 `wire.rs` 定义；
  `config.example.toml` 必须能被当前版本解析；`deploy/relay/` 资产在位。
- 平台侧登记：`capability_crates_no_product_ids` 的 `SCANNED_CRATES` 增 `wasmnest-relay`
  （C-3 反向断言要求新 `wasmnest-*` 目录归桶）——该改动留在平台仓工作树未提交。

**关键取舍**

1. 配额默认值按 1GB 验收设定（单 circuit 1 GiB / 1 小时）：libp2p 默认 128 KiB / 2 分钟，
   沿用会让大文件传输中途失败且难以归因。默认的按 peer / 按 IP 速率限制保留。
2. 准入（allowlist / enrollment）接在 `libp2p::relay::RateLimiter` 而不是连接层：白名单外
   的设备必须仍能连上来走控制协议兑换 token，否则 enrollment 永远用不上。
3. 控制协议 `/wasmnest/relay-control/1`（`u32be len | JSON`，与 `/wasmnest/tunnel/1` 同款分帧）：
   `hello` 回报版本 / 模式 / 是否可预留；`enroll` 用一次性 token 换白名单席位。token 只落
   `sha256`、日志只打 PeerId 短指纹与标签。
4. 指标只聚合计数（reservation / circuit / 连接 / 按原因分桶的拒绝）：`libp2p-relay` 0.22 的
   `CircuitClosed` 不带字节数（`CopyFuture::bytes_sent` 为私有字段），不伪造该数字。
5. `doctor` 只把本机能证明的标 ✓：公网可达性标 `unknown` 并给出外部验证路径（应用侧「检测
   连通性」或另一台机器实测），私网/回环通告地址给警告。
6. 失败清场：指标端口占用、监听失败等启动中途错误会收回已起的 swarm 与任务，不留孤儿监听。

**验收状态**

- 已通过：`cargo test --lib --offline` 127 passed（含「经 relay 建立 circuit 并原样转发字节」端到端
  用例、白名单拒绝用例、端口/指标占用失败清场用例、enrollment 兑换与跨重启持久化用例）；
  `cargo fmt --check` 绿；`cargo build --release` 产出 8.8 MB 二进制；`init` / `doctor`（8 项通过、
  1 项如实 unknown）/ `print-addrs --json` / `token create` / `run`（`/healthz` 200、404 兜底、
  SIGTERM 优雅退出）实跑通过。
- **未验证（环境阻塞，非代码判定）**：Docker 镜像构建（本机无法访问 Docker Hub 与 crates.io，
  构建阶段整体未跑，故「静态 musl 产物」「linux/arm64 依赖树」也未实证）；镜像多架构推送属 CI。
- **待人工验收（归 T15）**：全新 Linux VPS 一键起 relay → 应用导入 → 跨 NAT 可用；重启后
  PeerId 不变；relay 侧抓包只有密文。
- **偏差记录**：`init` 输出导入载荷（multiaddr + PeerId + 指纹 + JSON），**不**渲染二维码图片——
  QR 编码属导入端（T14 桌面卡片 / 移动端）职责，中继只产出可编码的载荷，避免为一张图引入
  QR 依赖。

## 相关契约与锁

- relay 不是授权点：reservation ≠ 信任；allowlist 只防滥用（不变量 10）。
- 无需 TLS 证书（Noise 在 libp2p 层）；防火墙只需 TCP 4001。
- `print-addrs` 输出格式是 T14 桌面卡片导入契约；协议版本供导入/doctor 校验。