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
- [ ] Linux amd64/arm64 静态二进制；Docker 多架构镜像 `ghcr.io/7zai/wasmnest-relay:<version>` + Compose（`restart: unless-stopped`、healthcheck、数据卷、生产 digest 钉住）；可选 `install.sh` + systemd unit。**现状**：Dockerfile / Compose / install.sh / unit 全部就位；**amd64 镜像已在本地实构实跑**（2026-11-08，见下节；产物 `static-pie`，14.7 MiB 镜像）；**arm64 交叉构建与 ghcr 推送未验证**（本机 buildx 无法拉 buildkit 镜像、需 CI）。
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
- **未验证**：linux/arm64 依赖树与多架构推送（本机 buildx 需要拉 buildkit 镜像，Docker Hub
  对 daemon 不可达；归 CI）；ghcr 上的镜像分发本身未跑。
- **待人工验收（归 T15）**：全新 Linux VPS 一键起 relay → 应用导入 → 跨 NAT 可用；重启后
  PeerId 不变；relay 侧抓包只有密文。
- 本地 Docker 验证结论与三个缺陷及修复见下节。
- **偏差记录**：`init` 输出导入载荷（multiaddr + PeerId + 指纹 + JSON），**不**渲染二维码图片——
  QR 编码属导入端（T14 桌面卡片 / 移动端）职责，中继只产出可编码的载荷，避免为一张图引入
  QR 依赖。

## 本地 Docker 验证（2026-11-08，linux/amd64）

环境：Docker 29.9.2 + Compose v5.6.1；宿主机直连 Docker Hub 被墙（daemon 无代理），
基础镜像经代理用 `crane pull` → `docker load` 落到本地 canonical tag；构建时用
`--network host` + Docker 预置代理 build-arg（`HTTPS_PROXY=...`）让 cargo 走出索引，
**Dockerfile 与 Compose 未做任何改动**。构建耗时：cargo 步 209.5s（16 核）。

| 项 | 结果 |
| --- | --- |
| `docker build -f deploy/relay/Dockerfile` | ✅ 14.7 MiB 运行镜像；产物 `ELF 64-bit LSB pie executable, static-pie linked, stripped`（6.4 MiB） |
| `compose run relay init --dir /data --advertise 127.0.0.1` | ✅ 生成身份/配置，卷首建时 `/data` 归属 10001 |
| `compose up -d` | ✅ 状态 `Up (healthy)`；容器内 `/healthz` 200、未知路径 404 |
| `compose exec relay doctor` | ✅ 7 通过 / 2 警告 / 0 失败（警告 = 端口被自身占用、回环 advertise，符合口径） |
| `print-addrs --json` | ✅ 字段 v/kind/relay_version/peer_id/peer_id_sha256/control_protocol/addrs/access/quota |
| 重启容器 | ✅ PeerId 不变（`12D3KooWJmdr…A7QD` 前后一致） |
| 重复 `init` | ✅ 非零退出并点名「配置已存在…请加 `--force`」，身份未被覆盖 |
| 经容器 relay 的真实转发 | ✅ 外部 libp2p 探针：A 预留 → B 经 `/p2p-circuit` 拨 A → 8 MiB 往返一致（53.3 MiB/s，circuit 建立 4.7ms） |
| 指标计数 | ✅ 1 次 reservation / 1 次 circuit / 2 条连接；断连后 closed=1（修复前为 2） |
| allowlist 负路径 | ✅ 未登记 peer 的 reservation 被拒，`rejected{reason="reservation-denied"}=1`，closed=0（修复前为 1） |
| `token create` | ✅ 明文只打印一次；`/data/tokens.json` 只落 sha256（与明文 sha256 实算一致） |
| SIGTERM | ✅ 优雅关闭日志 + `ExitCode=0`，非 OOM |
| `install.sh`（Debian 12 + systemctl 桩） | ✅ 装二进制 / 建用户组 / 0700 配置目录 / 0600 身份 / 重装保留 PeerId / `--uninstall` 只删 unit 留配置；`doctor` 8 通过 0 警告（`/dns4` 通告 → reachability 如实 unknown） |

**发现与修复（2026-11-08，均已落地并重跑验证）**

1. **Compose 注释里的指标端口映射不可用**：`ports: "127.0.0.1:9090:9090"` 指向容器 eth0，
   而 relay 在容器内绑 `127.0.0.1:9090`，实测宿主 `curl` 被 reset。**修复**：compose / README §6 /
   `config.example.toml` 统一改成「容器内用 `compose exec … wget /metrics`；要宿主拓取先把
   `metrics.listen` 改 `0.0.0.0:9090` + `expose_public = true`（容器网卡语义）再把端口发布到
   宿主回环」，并注明不要再把它理解成公网暴露。
2. **`reservations_closed_total` / `reservations_active` 计错**：`libp2p-relay` 0.22 在
   **任何 peer 连接关闭**时都会发 `ReservationClosed`（`on_connection_established` 为每条连接
   插入 `Reservation::None`，关闭时不判状态），原实现按事件直接累加 closed 并递减 active。
   实测 allowlist 拒绝路径：`reservations_total=0` 而 `reservations_closed_total=1`；open 模式
   1 次预留 / 2 次 closed。**修复**：事件泵增 `AcceptedReservations`（按 peer 记已接受的
   预留数，续期不加、关闭/超时只在计数 > 0 时才消费），并补 3 条锁：纯函数计数、普通连接
   关闭不计入、拒绝后断连不计入；e2e 用例尾部加 closed==1 / active==0 断言。重跑：
   `cargo test --lib --offline` 129 passed（+2）；容器重建后 open 模式 total=1 / closed=1，
   allowlist 拒绝 total=0 / closed=0 / rejected=1。残留限制：事件不带 connection_id，同一 peer
   的普通连接与带预留连接一起关闭时仍可能多减一次（只用饱和减法兜底），已在代码注释写明。
3. **`install.sh` 在无 useradd 的降级路径上失败**：`adduser -S` 不建同名组，随后
   `install -g wasmnest-relay` 报 `unknown group`。**修复**：先显式建组（`groupadd`/`addgroup`）
   再用 `--gid`/`-G` 建用户，并断言用户/组存在；开头加 `/etc/systemd/system` 存在性检查，
   非 systemd 发行版显性拒绝并指向 compose（Alpine 实测：立即报「只支持 systemd 发行版」）。
   Debian 12（systemctl 桩）重跑仍全绿：8 通过 / 0 警告，重装保 PeerId，卸载留配置。

## 相关契约与锁

- relay 不是授权点：reservation ≠ 信任；allowlist 只防滥用（不变量 10）。
- 无需 TLS 证书（Noise 在 libp2p 层）；防火墙只需 TCP 4001。
- `print-addrs` 输出格式是 T14 桌面卡片导入契约；协议版本供导入/doctor 校验。