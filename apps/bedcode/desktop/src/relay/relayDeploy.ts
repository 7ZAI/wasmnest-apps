/**
 * 自建 relay 部署文本生成（T14）——只产出**文本**，不执行远端命令、不碰凭据
 *
 * 产出方真源 = 能力仓 `wasmnest-relay`（T13）：
 * - `deploy/relay/docker-compose.yml`（Compose 形态）
 * - `deploy/relay/install.sh` + `wasmnest-relay.service`（systemd 形态）
 * - `Dockerfile` / README 的单命令形态
 *
 * 卡片只替换三处用户输入：对外域名 / IP、对外端口、镜像版本。生成的文本里
 * **不含 enrollment token**（那是一次性凭据，由服务器侧 `wasmnest-relay token
 * create` 单独产出、带外交付）。
 */

/** 镜像仓库（`ghcr.io/7zai/wasmnest-relay:<tag>`） */
export const RELAY_IMAGE_REPO = 'ghcr.io/7zai/wasmnest-relay'
/** relay 默认监听端口（T13：`0.0.0.0:4001/tcp`，v1 不启 UDP） */
export const RELAY_DEFAULT_PORT = 4001
/** 卡片默认镜像版本（与 T13 落地的 crate 版本一致；发布后按 `relay-vX.Y.Z` 更新） */
export const RELAY_DEFAULT_VERSION = '0.0.1'
/** Docker 数据卷名（身份 / 配置 / token 表都在这里） */
export const RELAY_VOLUME_NAME = 'wasmnest-relay-data'

/** 部署形态 */
export type RelayDeployMode = 'compose' | 'docker' | 'systemd'

/** 部署输入 */
export interface RelayDeployInput {
  /** 对外域名或 IP 字面量（客户端可拨地址） */
  advertise: string
  /** 对外 TCP 端口 */
  port: number
  /** 镜像标签（Docker 形态）/ 由 user 显式确认的版本 */
  version: string
}

/** 生成失败原因（组件按 key 取文案） */
export type RelayDeployErrorKey =
  'relay.deploy.invalidAdvertise' | 'relay.deploy.invalidPort' | 'relay.deploy.invalidTag'

/** 生成结果 */
export type RelayDeployResult =
  { ok: true; text: string } | { ok: false; errorKey: RelayDeployErrorKey }

/** IPv4 字面量（与导入侧同口径：拒绝前导零） */
function isIpv4(text: string): boolean {
  const parts = text.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && String(Number(part)) === part)
}

/** IPv6 字面量 */
function isIpv6(text: string): boolean {
  if (!text.includes(':') || text.includes('%')) return false
  try {
    new URL(`http://[${text}]/`)
    return true
  } catch {
    return false
  }
}

/** 域名（允许单标签内网名） */
function isDomain(text: string): boolean {
  if (!text || text.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(text)) return false
  return text
    .split('.')
    .every(
      (label) =>
        label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'),
    )
}

/** 校验对外主机（与 T13 `describe_host` 同口径：域名或 IP 字面量，不含路径/空格） */
export function validateAdvertiseHost(host: string): boolean {
  const text = host.trim()
  if (!text) return false
  if (text.includes('/') || /\s/.test(text)) return false
  return isIpv4(text) || isIpv6(text) || isDomain(text)
}

/** 校验 Docker 镜像标签（ASCII，Docker tag 字符集） */
export function validateRelayVersion(version: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(version.trim())
}

/** 规范化输入（trim；端口留给上层校验） */
export function normalizeDeployInput(input: RelayDeployInput): RelayDeployInput {
  return {
    advertise: input.advertise.trim(),
    port: input.port,
    version: input.version.trim(),
  }
}

function validate(input: RelayDeployInput): RelayDeployErrorKey | null {
  if (!validateAdvertiseHost(input.advertise)) return 'relay.deploy.invalidAdvertise'
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return 'relay.deploy.invalidPort'
  }
  if (!validateRelayVersion(input.version)) return 'relay.deploy.invalidTag'
  return null
}

/** Compose 文件（可直接下载为 `docker-compose.yml`） */
export function buildComposeText(input: RelayDeployInput): RelayDeployResult {
  const normalized = normalizeDeployInput(input)
  const error = validate(normalized)
  if (error) return { ok: false, errorKey: error }
  const { advertise, port, version } = normalized
  const text = `# ==================== wasmnest-relay（Docker Compose） ====================
# 由 WasmNest 桌面「中转服务器」卡片按 T13 交付物生成；不含任何凭据。
#
# 首次生成身份与配置（身份丢了 = PeerId 变 = 所有客户端要重新导入）：
#   docker compose run --rm relay init --dir /data --advertise ${advertise}
# 起服务：
#   docker compose up -d
# 取客户端导入用的地址（贴回卡片）：
#   docker compose exec relay wasmnest-relay print-addrs --config /data/config.toml --json
#
# 生产建议把 image 换成 digest 钉住的形式：
#   image: ${RELAY_IMAGE_REPO}:${version}@sha256:<digest>
services:
  relay:
    image: ${RELAY_IMAGE_REPO}:${version}
    container_name: wasmnest-relay
    restart: unless-stopped
    command: ["run", "--config", "/data/config.toml"]
    ports:
      # 只放行 TCP ${port}；v1 不启用 UDP（QUIC 属后续评估）
      - "${port}:4001/tcp"
      # 指标端点默认只绑容器内回环；需要本地抓取时再解开下面这行（不要直接对公网开放）
      # - "127.0.0.1:9090:9090/tcp"
    volumes:
      # 身份 / 配置 / token 表 / 已 enrollment 白名单都在这个卷里
      - relay-data:/data
    environment:
      WASMNEST_RELAY_LOG: info
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:9090/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    # 只转发密文，不需要特权或额外 capability
    security_opt:
      - no-new-privileges:true
    ulimits:
      nofile:
        soft: 65535
        hard: 65535

volumes:
  relay-data:
`
  return { ok: true, text }
}

/** Docker 单命令形态（init → run → print-addrs） */
export function buildDockerText(input: RelayDeployInput): RelayDeployResult {
  const normalized = normalizeDeployInput(input)
  const error = validate(normalized)
  if (error) return { ok: false, errorKey: error }
  const { advertise, port, version } = normalized
  const image = `${RELAY_IMAGE_REPO}:${version}`
  const text = `# ==================== wasmnest-relay（Docker 单命令） ====================
# 由 WasmNest 桌面「中转服务器」卡片按 T13 交付物生成；不含任何凭据。

# 1) 首次生成身份与配置（身份丢了 = PeerId 变 = 所有客户端要重新导入）
docker run --rm -v ${RELAY_VOLUME_NAME}:/data ${image} \\
  init --dir /data --advertise ${advertise}

# 2) 起服务（restart 策略与数据卷保证重启不换 PeerId）
docker run -d --name wasmnest-relay --restart unless-stopped \\
  -p ${port}:4001/tcp \\
  -v ${RELAY_VOLUME_NAME}:/data \\
  ${image}

# 3) 取客户端导入用的地址（贴回卡片）
docker exec wasmnest-relay wasmnest-relay print-addrs --config /data/config.toml --json
`
  return { ok: true, text }
}

/** systemd 形态（install.sh + 自检 + 取地址） */
export function buildSystemdText(input: RelayDeployInput): RelayDeployResult {
  const normalized = normalizeDeployInput(input)
  const error = validate(normalized)
  if (error) return { ok: false, errorKey: error }
  const { advertise, port } = normalized
  const portHint =
    port === RELAY_DEFAULT_PORT
      ? ''
      : `# 注意：install.sh 与 systemd unit 默认使用 4001；你选择了 ${port}，\n` +
        `# 需同步编辑 /etc/wasmnest-relay/config.toml 的 listen/addrs 与 advertise/addrs（tcp/${port}），\n` +
        `# 并在防火墙放行 TCP ${port} 后 systemctl restart wasmnest-relay。\n`
  const text = `# ==================== wasmnest-relay（systemd 单文件二进制） ====================
# 由 WasmNest 桌面「中转服务器」卡片按 T13 交付物生成；不含任何凭据。
# 在能力仓 deploy/relay 目录执行（同目录含 install.sh 与 wasmnest-relay.service）。
${portHint}
# 1) 一键安装（装二进制 / 建用户 / 生成身份与配置 / 装 unit / 启动）
./install.sh --advertise ${advertise} --binary ./wasmnest-relay

# 2) 自检（公网可达性会如实标 unknown，需从另一台网络实测）
wasmnest-relay doctor --config /etc/wasmnest-relay/config.toml

# 3) 取客户端导入用的地址（贴回卡片）
wasmnest-relay print-addrs --config /etc/wasmnest-relay/config.toml --json
`
  return { ok: true, text }
}

/** 按形态生成部署文本 */
export function buildRelayDeployText(
  mode: RelayDeployMode,
  input: RelayDeployInput,
): RelayDeployResult {
  switch (mode) {
    case 'compose':
      return buildComposeText(input)
    case 'docker':
      return buildDockerText(input)
    case 'systemd':
      return buildSystemdText(input)
  }
}
