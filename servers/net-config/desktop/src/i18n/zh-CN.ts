import type { MessageSchema } from './messages'

/** 网络配置中心（简体中文；key 与 `MessageSchema` 一一对应） */
const zhCN: MessageSchema = {
  title: '网络配置',
  subtitle: '自建 relay 的地址在这里导入一次，所有需要跨网的应用共用；页面同时管理「哪些业务允许走外网」。',
  refresh: '刷新',
  'error.body': '读取失败：{message}',

  'relay.state.configured': '已配置 {count} 个地址',
  'relay.state.empty': '尚未导入中转地址',
  'relay.current.title': '当前中转配置',
  'relay.current.addrs': '可拨地址',
  'relay.current.peerId': 'PeerId',
  'relay.current.fingerprint': '指纹',
  'relay.current.verified': '已本地复算校验',
  'relay.current.access': '准入模式',
  'relay.current.accessOpen': '开放（open）',
  'relay.current.accessAllowlist': '白名单（allowlist）',
  'relay.current.accessUnknown': '未提供',
  'relay.current.quota': '单 circuit 上限',
  'relay.current.quotaValue': '{bytes} 字节 / {secs} 秒',
  'relay.current.quotaUnknown': '未提供',
  'relay.current.version': 'relay 版本',
  'relay.current.importedAt': '导入时间',
  'relay.current.source': '导入来源',
  'relay.current.sourceJson': 'print-addrs JSON',
  'relay.current.sourceText': 'print-addrs 文本',
  'relay.import.clear': '移除',
  'relay.import.cleared': '已移除中转地址',
  'relay.import.clearFailed': '移除失败：请重试',
  'relay.import.loadFailed':
    '已保存的中转配置无法解析（可能来自旧版本或被手工改坏）；未自动清除，请重新导入或显式移除。',

  'relay.deploy.title': '生成部署命令',
  'relay.deploy.desc':
    '选择一种部署方式，把生成的命令复制到你的 Linux 服务器执行；首次必须先 init 生成身份（身份丢失 = PeerId 变化 = 所有客户端要重新导入）。',
  'relay.deploy.advertise': '对外域名 / IP',
  'relay.deploy.advertisePlaceholder': 'relay.example.com',
  'relay.deploy.port': '对外端口',
  'relay.deploy.version': '镜像版本',
  'relay.deploy.mode.compose': 'Docker Compose',
  'relay.deploy.mode.docker': 'Docker run',
  'relay.deploy.mode.systemd': 'systemd',
  'relay.deploy.emptyHint': '填写对外域名 / IP 后生成部署命令（只接受域名或 IP 字面量）。',
  'relay.deploy.copy': '复制命令',
  'relay.deploy.copied': '部署命令已复制',
  'relay.deploy.copyFailed': '复制失败：请手动选择生成的文本',
  'relay.deploy.download': '下载 compose',
  'relay.deploy.downloadFailed': '当前环境不支持下载：请复制文本自行保存',
  'relay.deploy.imageHint': '镜像来自 {repo}；生产环境建议把 image 换成 digest 钉住的形式。',
  'relay.deploy.noCreds':
    '生成结果不含 enrollment token 与任何服务器凭据；token 请在服务器侧用 wasmnest-relay token create 单独生成并带外交付。',
  'relay.deploy.invalidAdvertise': '对外域名 / IP 不合法：只接受域名或 IP 字面量，不含路径与空格',
  'relay.deploy.invalidPort': '端口不合法：必须是 1–65535 的整数',
  'relay.deploy.invalidTag': '镜像版本不合法：只接受 Docker 标签字符（字母 / 数字 / _ . -）',

  'relay.import.title': '导入 relay 地址',
  'relay.import.desc':
    '粘贴 wasmnest-relay print-addrs --json 的 JSON、print-addrs 文本（每行一个地址 + peerId 元数据）或多地址；二维码内容就是这份 JSON，扫码后把文本贴进来即可。',
  'relay.import.placeholder':
    '粘贴 print-addrs --json 的 JSON，或每行一个 multiaddr（如 /dns4/relay.example.com/tcp/4001/p2p/12D3KooW…）',
  'relay.import.submit': '导入并保存',
  'relay.import.success': '中转地址已保存',
  'relay.import.saveFailed': '地址解析通过，但保存失败：请检查宿主存储权限后重试',

  'relay.error.empty': '没有可导入的内容：请粘贴 print-addrs 的 JSON 或地址文本',
  'relay.error.json': 'JSON 解析失败：请确认粘贴的是 print-addrs --json 的完整输出',
  'relay.error.version': '导入载荷版本不受支持：本应用只认 v1',
  'relay.error.kind': '载荷类型不对：不是 wasmnest-relay 的导入载荷',
  'relay.error.peerId': 'PeerId 不是合法的 ed25519 libp2p PeerId',
  'relay.error.fingerprintMissing': '载荷缺少 peer_id_sha256 指纹，无法校验中继身份',
  'relay.error.fingerprintMismatch': '指纹与 PeerId 本地复算结果不一致：载荷可能被篡改或版本不匹配',
  'relay.error.controlProtocol': '控制协议版本不匹配：本应用要求 /wasmnest/relay-control/1',
  'relay.error.addrs': '地址列表为空或超过上限',
  'relay.error.addrShape':
    '地址格式不合法：只接受 /ip4|ip6|dns/tcp/<端口>/p2p/<PeerId> 的 relay 基础地址（带 /p2p-circuit 的是拨号目标，不是中继地址）',
  'relay.error.addrPeer': '地址里的 PeerId 与载荷 peer_id 不一致',
  'relay.error.multiPeer': '多个地址指向不同的中继 PeerId：一次只能导入一个 relay',
  'relay.error.metadata': '文本里的元数据行重复且值不一致',
  'relay.error.access': '准入模式不合法：只认 open / allowlist',
  'relay.error.quota': '配额字段不合法：max_circuit_bytes / max_circuit_duration_secs 必须是非负整数',
  'relay.error.line': '无法识别的行：既不是 relay 地址、也不是已知元数据',
  'relay.error.crypto': '当前环境不支持 WebCrypto，无法本地复算 PeerId 指纹',

  'relay.probe.title': '检测连通性',
  'relay.probe.desc':
    '对「已保存」的中继地址做一次探测：TCP 握手 + Noise 身份校验 + ping 往返。只读，不建立预留、不开放任何端口。',
  'relay.probe.action': '检测连通性',
  'relay.probe.running': '正在检测…',
  'relay.probe.ok': '握手成功',
  'relay.probe.empty': '先导入中转地址再检测。',
  'relay.probe.unsupported':
    '当前宿主未装配 relay 探测原语（旧宿主 / 未重新打包），本页不伪造可用；下面的服务器侧自检是替代路径。',
  'relay.probe.publicHint':
    '公网可达性需要从另一台网络实测；doctor 会如实标 unknown，不会把本机可连说成公网可用。',
  'relay.probe.resultAddr': '实际探测地址',
  'relay.probe.resultPeerId': '握手实测 PeerId',
  'relay.probe.resultRtt': 'RTT',
  'relay.probe.resultRttUnknown': '未取到（对端不支持 ping 或超时；可达性已成立）',
  'relay.probe.resultHandshake': '握手耗时',
  'relay.probe.resultCheckedAt': '检测时间',
  'relay.probe.errorUnreachable': 'relay 不可达：端口未监听 / 防火墙 / DNS / 地址失效，明细见下。',
  'relay.probe.errorIdentity':
    '身份不符：握手实测 PeerId 与地址里钉住的不一致——不要继续使用这套地址（可能被顶替）。',
  'relay.probe.errorAddress': '地址不合法：需要 `.../tcp/<端口>/p2p/<relay PeerId>` 形状的已保存地址。',
  'relay.probe.errorRateLimited': '探测过于频繁：等上一次结束后再试（2 秒冷却）。',
  'relay.probe.errorNotConfigured': '还没有可探测的中转地址：先导入 `print-addrs` 输出。',
  'relay.probe.errorPermission': '本应用未被授予 tunnel:probe 权限，无法探测。',
  'relay.probe.errorUnknown': '探测失败（未识别的错误码，明细见下）。',

  'wan.title': '业务外网注册表',
  'wan.desc':
    '逐业务决定是否允许建立中继预留；关闭后该业务下次配置时不再建立预留（已有预留不会立即撤销），LAN 入口不受影响。地址共享 ≠ 允许被外网访问。',
  'wan.empty': '还没有登记任何业务；业务首次接入时会出现在这里。',
  'wan.allow': '允许外网',
  'wan.block': '禁止外网',
  'wan.state.allowed': '允许',
  'wan.state.blocked': '禁止',
  'wan.noneAllowed':
    '已配置中转地址，但当前没有业务允许走外网：业务仍可局域网访问，跨网入口保持关闭。',
  'wan.unknown': '未登记',

  'preview.title': '网络配置',
  'preview.configured': '{count} 个中转地址',
  'preview.empty': '尚未导入中转地址',
  'preview.unavailable': '配置读取失败',
}

export default zhCN
