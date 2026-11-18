# 中继服务器构建教程（wasmnest-relay）

本教程面向**内网穿透（NAT Traversal）的中继服务**：讲清如何在一台公网 / 自建的中继服务器上，从源码或镜像**构建**并运行 `wasmnest-relay`，验证后把地址导入应用，打通跨 NAT 的远程连接。

> **中继是什么**：`wasmnest-relay` 是跑在公网服务器上的**独立守护进程**（libp2p Circuit Relay v2 服务端），替两端转发 Noise 密文。它**不是 wasm 插件**，也不参与设备配对判定——reservation 只代表「可以经我转发」，真正的访问授权仍在目标设备的匹配校验上。详见 [`nat-traversal.md`](./nat-traversal.md) §4.2。

## 0. 先了解三件事

| 项 | 说明 |
| --- | --- |
| 源码位置 | 能力仓 [`wasmnest-lib`](https://github.com/7ZAI/wasmnest-lib) 的 `wasmnest-relay/` crate |
| 构建产物 | 单文件二进制 `wasmnest-relay`（**仅 Linux**：amd64 / arm64） |
| 版本轴 | 独立发版 `relay-vX.Y.Z`，与能力仓 / 应用仓版本无关；镜像 `ghcr.io/7zai/wasmnest-relay:<version>` |

**构建的关键前提**：`wasmnest-relay` **零内部 crate 依赖**（`src/boundary_lock.rs` 单测钉死，Cargo.toml 内不得出现 path 依赖），只依赖 libp2p 传输栈 / tokio 等机制级库。因此它可以**脱离整个能力仓单独构建**——在中继服务器上只需拿到 `wasmnest-relay/` 这一个目录即可编译，不必拉全仓。

**监听与证书**：v1 只启 TCP + Noise + Yamux，**无需 TLS 证书**（Noise 已在 libp2p 层完成加密）；防火墙只需放行 **TCP 4001**。

## 1. 前置条件

构建机（即中继服务器）需满足：

- **操作系统**：Linux（amd64 / arm64）。Windows / macOS 不做二进制或服务包，请用 Docker 或在 Linux 上构建。
- **构建方式二选一**：
  - **源码构建**：Rust 工具链（stable，≥ 1.88）、`cargo`；如需静态 musl 产物，另需 musl C 工具链（`musl-gcc` 或 Alpine 的 `build-base`）。
  - **镜像构建**：Docker（含 buildx，用于多架构）或 `docker compose`。
- **运行前置**：一个可被客户端拨到的**公网域名或公网 IP**（通告地址 `--advertise` 用）；域名只需 DNS 解析，无需证书。
- **端口**：服务器放行 **TCP 4001**；指标端点默认绑回环 `127.0.0.1:9090`，不对外。

## 2. 方式一：源码构建（cargo）

适合想直接在中继服务器上跑二进制、或需要自定义构建的场景。

### 2.1 取源码

在中继服务器上克隆能力仓（只需 `wasmnest-relay/` 一个目录，但整仓克隆最省事）：

```bash
git clone https://github.com/7ZAI/wasmnest-lib.git
cd wasmnest-lib
```

> 只想最小化拉取：可只取 `wasmnest-relay/` 子目录（含 `Cargo.toml`、`Cargo.lock`、`src/`）。因为它零内部依赖，单独放在任意目录都能构建。

### 2.2 原生构建（推荐：构建机 = 运行机）

在本机 glibc 上直接构建，产物与本机匹配，最简单：

```bash
cd wasmnest-lib
cargo build --release --locked --manifest-path wasmnest-relay/Cargo.toml

# 产物路径
wasmnest-relay/target/release/wasmnest-relay
```

`--locked` 用 `Cargo.lock` 钉住依赖版本，保证可复现。构建完成后用 `--version` 自检：

```bash
./wasmnest-relay/target/release/wasmnest-relay --version
```

### 2.3 静态 musl 构建（可移植产物）

需要把二进制拷到**其它** Linux 机器（不同 glibc）时，构建静态 musl 产物：

```bash
# 添加 musl 目标
rustup target add x86_64-unknown-linux-musl      # arm64 用 aarch64-unknown-linux-musl

# 安装 musl C 工具链（ring/Noise 需要 C/asm 编译器）
#   Debian/Ubuntu: sudo apt install musl-tools
#   Alpine:        apk add build-base

cargo build --release --locked \
  --target x86_64-unknown-linux-musl \
  --manifest-path wasmnest-relay/Cargo.toml

# 产物：wasmnest-relay/target/x86_64-unknown-linux-musl/release/wasmnest-relay
```

静态产物不依赖宿主 glibc，可直接丢到任意 Linux VPS 上运行。

## 3. 方式二：构建 Docker 镜像

适合用容器部署。**构建上下文必须是能力仓根**（Dockerfile 只复制 `wasmnest-relay/`，见 `deploy/relay/Dockerfile`）。

在能力仓根目录执行：

```bash
cd wasmnest-lib

# 单架构构建
docker build -f deploy/relay/Dockerfile \
  -t ghcr.io/7zai/wasmnest-relay:0.0.1 .

# 多架构构建（需 buildx；amd64 上跑 arm64 走 QEMU，慢但正确）
docker buildx build --platform linux/amd64,linux/arm64 \
  -f deploy/relay/Dockerfile \
  -t ghcr.io/7zai/wasmnest-relay:0.0.1 --push .
```

镜像用 **alpine + musl 静态链接**，运行层只装 CA 证书与时区，以非 root 用户 `relay` 运行，身份与配置落在 `/data` 卷。镜像内已带 `HEALTHCHECK`（探测 `127.0.0.1:9090/healthz`）。

> 镜像构建原理：构建阶段用 `rust:1.88-alpine` + `build-base` + `perl` 编译并 `strip`，运行阶段只拷贝二进制。详见 `deploy/relay/Dockerfile` 头注。

## 4. 方式三：直接用发布镜像（免构建）

如果不想在中继服务器上构建，直接拉取官方发布镜像即可：

```bash
docker run -d --name wasmnest-relay --restart unless-stopped \
  -p 4001:4001 -v wasmnest-relay-data:/data \
  ghcr.io/7zai/wasmnest-relay:0.0.1
```

> 生产建议把 tag 换成 **digest 钉住**（`ghcr.io/7zai/wasmnest-relay:0.0.1@sha256:<digest>`），避免上游 tag 漂移。

## 5. 初始化与配置

构建（或拉镜像）完成后，**首次运行前必须先初始化**——生成身份密钥与 `config.toml`。**身份丢了 = PeerId 变 = 所有客户端要重新导入中继地址**。

### 5.1 初始化（生成身份 + 配置）

```bash
# systemd / 二进制方式
wasmnest-relay init --dir /etc/wasmnest-relay --advertise relay.example.com

# Docker 方式（身份与配置落 /data 卷）
docker run --rm -v wasmnest-relay-data:/data \
  ghcr.io/7zai/wasmnest-relay:0.0.1 \
  init --dir /data --advertise relay.example.com
```

`init` 的要点：

- `--advertise` 给**公网域名或公网 IP**，客户端据此拼 `/p2p-circuit`；监听 `0.0.0.0` 时**必须**提供，否则客户端拿到不可拨地址。
- 可选 `--port <端口>`（默认 4001）、`--allowlist <PeerId,...>`（直接预置白名单）、`--force`（覆盖既有身份与配置，会换 PeerId）。
- 已有配置时 `init` 会拒绝覆盖，需显式 `--force`。

### 5.2 配置项（config.toml）

初始化生成的 `config.toml` 各段（完整样例见能力仓 `deploy/relay/config.example.toml`）：

| 段 | 关键字段 | 说明 |
| --- | --- | --- |
| `[identity]` | `key_file` | 身份密钥路径；丢失 = PeerId 变化 |
| `[listen]` | `addrs` | 监听地址，默认 `/ip4/0.0.0.0/tcp/4001`（仅 TCP） |
| `[advertise]` | `addrs` | 对外通告地址（公网域名/IP），**不要手写 `/p2p`**，`print-addrs` 会按本机 PeerId 追加 |
| `[quota]` | `max_circuit_bytes` 等 | 配额，见 §7；默认按「跨 NAT 传 1GB」验收口径设定 |
| `[access]` | `mode` / `allowlist` | `open`（默认，靠配额防滥用）或 `allowlist`（白名单 + enrollment） |
| `[metrics]` | `listen` / `expose_public` | 指标端点，默认回环；公网抓取需显式 `expose_public = true` 并自加反代 TLS |

> 配置路径解析顺序：`--config` → `WASMNEST_RELAY_CONFIG` → `/data/config.toml` → `/etc/wasmnest-relay/config.toml`。

## 6. 运行与开机自启

### 6.1 前台运行（验证用）

```bash
wasmnest-relay run --config /etc/wasmnest-relay/config.toml
# Docker
docker compose up -d          # 在 deploy/relay 目录，或 docker run 见 §4
```

### 6.2 systemd 常驻（二进制方式）

用能力仓 `deploy/relay/install.sh` 一键装服务（装二进制 → 建系统用户 → 生成身份/配置 → 装 unit → 启动）：

```bash
./install.sh --advertise relay.example.com --binary ./wasmnest-relay
# 卸载（不删配置目录，含 PeerId）
./install.sh --uninstall
```

脚本只支持 **systemd 发行版**（Debian/Ubuntu/CentOS/Fedora 等），Alpine+openrc 请用 Docker Compose。

### 6.3 Docker Compose 常驻（镜像方式，推荐）

```bash
cd deploy/relay
docker compose run --rm relay init --dir /data --advertise relay.example.com   # 首次
docker compose up -d
```

Compose 带 `restart: unless-stopped`、healthcheck 与数据卷；身份/配置/token/白名单都在 `relay-data` 卷里，重启不换 PeerId。

## 7. 验证与导入应用

### 7.1 自检（doctor）

`doctor` 做**本机能查的实检**，本机不能自证的如实标 `unknown`：

```bash
wasmnest-relay doctor --config /etc/wasmnest-relay/config.toml
# 退出码：有 Fail 即 1，否则 0（Warn / Unknown 不阻断）
```

检查项包括：`identity`（密钥可解析、ed25519、权限 600）、`config`、`listen`（真实 bind 一次）、`clock`、`data_dir`（写入探针）、`tokens`、`metrics`、`reachability`、`version`。

### 7.2 取导入地址（print-addrs）

```bash
wasmnest-relay print-addrs --config /etc/wasmnest-relay/config.toml --json
```

`--json` 输出**应用契约格式**，复制到桌面端「设置 → 中转服务器 → 导入 relay 地址」（粘贴 JSON / multiaddr / 二维码）。导入后在应用内「检测连通性」，用 peer 引擎拨中继，应显示 PeerId 指纹与 RTT。

### 7.3 健康 / 指标端点

```bash
curl -s http://127.0.0.1:9090/healthz   # PeerId / 指纹 / 准入模式 / 通告地址
curl -s http://127.0.0.1:9090/metrics   # Prometheus 文本：reservation / circuit / 拒绝原因
```

> **Docker 例外**：容器内 relay 绑容器回环，Docker 端口映射指向 eth0，映射 9090 也连不通。容器内取数用 `docker compose exec relay wget -qO- http://127.0.0.1:9090/metrics`；要从宿主抓取，先在 config 把 `metrics.listen` 改成 `0.0.0.0:9090` 并显式 `expose_public = true`（容器语义），宿主侧仍只发布到回环。

## 8. 运维速查

### 8.1 准入：开放 vs 白名单

```toml
[access]
mode = "open"      # 默认：任何人可预留，靠配额防滥用
allowlist = []     # mode = "allowlist" 时生效：PeerId 白名单（base58）
```

白名单模式下，白名单外设备**仍能连上**（否则没法自助开通），但 reservation / circuit 请求会被拒并计入指标。开通两条路：

1. **静态**：把设备 PeerId 写进 `allowlist`（设备侧在应用里能看到自己的 PeerId）。
2. **enrollment token**（推荐）：

```bash
wasmnest-relay token create --config /etc/wasmnest-relay/config.toml --label phone
```

明文 token 只显示这一次，落盘只有 `sha256` 摘要，默认一次兑换即失效（`--max-uses N` 可放宽）。**relay 不是授权点**：白名单只决定「谁能蹭带宽」，不决定「谁能访问哪台设备」。

### 8.2 配额（默认值）

| 配置项 | 默认 | 含义 |
| --- | --- | --- |
| `max_reservations` / `max_reservations_per_peer` | 1024 / 4 | reservation 总量 / 单 peer |
| `reservation_ttl_secs` | 3600 | reservation 有效期 |
| `max_circuits` / `max_circuits_per_peer` | 512 / 64 | 并发 circuit 总量 / 单 peer |
| `max_circuit_duration_secs` | 3600 | 单 circuit 最长存活 |
| `max_circuit_bytes` | 1 GiB | 单 circuit 字节上限（0 = 不限） |
| `max_connections_per_ip` | 32 | 单 IP 入站连接上限 |

> `max_circuit_bytes` 是**单条 circuit** 上限。libp2p 自带默认值只有 128 KiB，直接沿用会让大文件传输中途被掐断（表现为随机失败），默认值已按「跨 NAT 传 1GB」调好，**不要调小**。

### 8.3 升级与身份纪律

```bash
# Docker
docker compose pull && docker compose up -d
# systemd
./install.sh --advertise relay.example.com --binary ./wasmnest-relay   # 保留现有身份
```

- 升级**不换** PeerId：`identity.key` 不动即可。
- `init --force` 才覆盖身份；覆盖后所有客户端必须重新导入中继地址。
- **备份只需 `identity.key`**（配置可重建，token 可重发，enrollment 可重做）。

## 9. 排障

| 症状 | 排查顺序 |
| --- | --- |
| 客户端报「中继不可达」 | 云安全组 / 防火墙是否放行 **TCP 4001**；`doctor` 的 `listen` 项；域名是否解析到本机 |
| 客户端报「中继拒绝预留（配额/白名单）」 | `access.mode` 是否 `allowlist`；`tokens` 项剩余可用次数；`/metrics` 的 `rejected{reason="reservation-denied"}` |
| 预留成功但连不上对端 | 对端是否在线并已预留；两边是否导入**同一份**中继地址（含 `/p2p/<relay PeerId>`） |
| 大文件传到一半失败 | `max_circuit_bytes` / `max_circuit_duration_secs` 是否被调小；`doctor` 的 `version` 项会提示 < 1 GiB |
| 容器起来就退出 | 首次运行前没 `init`：`run` 找不到 `identity.key` 会显性失败；`docker compose logs relay` |
| 重启后 PeerId 变了 | `/data` 卷没挂上或换了卷；用 `print-addrs` 对比 `peerIdSha256` |
| 源码构建报错 | 确认用 `--locked` 且 Rust ≥ 1.88；musl 构建缺 C 工具链时补装 `build-base` / `musl-tools` |

日志级别用环境变量 `WASMNEST_RELAY_LOG=debug`（容器可 `-e WASMNEST_RELAY_LOG=debug`）。

## 10. 相关文档

- 架构与机制设计：[`nat-traversal.md`](./nat-traversal.md)、[`spec.md`](./spec.md)
- 中继节点设计（§4.2）：[`nat-traversal.md`](./nat-traversal.md) §4.2
- 部署手册（能力仓，含完整排障）：能力仓 [`deploy/relay/README.md`](https://github.com/7ZAI/wasmnest-lib/blob/main/deploy/relay/README.md)
- 网络配置中心（relay 地址的跨应用真源）：[`servers/net-config`](../../servers/net-config/)
