/**
 * 网络配置中心 i18n 消息类型（唯一 key 来源）
 *
 * zh-CN 与 en 两个语言文件都必须实现该类型：新增 / 遗漏 key 在编译期即报错。
 * key 为域相对键；注册时经插件 ID 前缀隔离为 `com.wasmnest.net-config.<key>`。
 * 用 type 别名而非 interface：TS 给类型别名隐式索引签名，便于转成扁平表。
 */
export type MessageSchema = {
  // ==================== 页面 ====================
  title: string
  subtitle: string
  loading: string
  refresh: string
  'error.body': string

  // ==================== 当前配置 ====================
  'relay.state.configured': string
  'relay.state.empty': string
  'relay.current.title': string
  'relay.current.addrs': string
  'relay.current.peerId': string
  'relay.current.fingerprint': string
  'relay.current.verified': string
  'relay.current.access': string
  'relay.current.accessOpen': string
  'relay.current.accessAllowlist': string
  'relay.current.accessUnknown': string
  'relay.current.quota': string
  'relay.current.quotaValue': string
  'relay.current.quotaUnknown': string
  'relay.current.version': string
  'relay.current.importedAt': string
  'relay.current.source': string
  'relay.current.sourceJson': string
  'relay.current.sourceText': string
  'relay.import.clear': string
  'relay.import.cleared': string
  'relay.import.clearFailed': string
  'relay.import.loadFailed': string

  // ==================== 部署文本 ====================
  'relay.deploy.title': string
  'relay.deploy.desc': string
  'relay.deploy.advertise': string
  'relay.deploy.advertisePlaceholder': string
  'relay.deploy.port': string
  'relay.deploy.version': string
  'relay.deploy.mode.compose': string
  'relay.deploy.mode.docker': string
  'relay.deploy.mode.systemd': string
  'relay.deploy.emptyHint': string
  'relay.deploy.copy': string
  'relay.deploy.copied': string
  'relay.deploy.copyFailed': string
  'relay.deploy.download': string
  'relay.deploy.downloadFailed': string
  'relay.deploy.imageHint': string
  'relay.deploy.noCreds': string
  'relay.deploy.invalidAdvertise': string
  'relay.deploy.invalidPort': string
  'relay.deploy.invalidTag': string

  // ==================== 导入 ====================
  'relay.import.title': string
  'relay.import.desc': string
  'relay.import.placeholder': string
  'relay.import.submit': string
  'relay.import.success': string
  'relay.import.saveFailed': string

  // ==================== 导入错误 ====================
  'relay.error.empty': string
  'relay.error.json': string
  'relay.error.version': string
  'relay.error.kind': string
  'relay.error.peerId': string
  'relay.error.fingerprintMissing': string
  'relay.error.fingerprintMismatch': string
  'relay.error.controlProtocol': string
  'relay.error.addrs': string
  'relay.error.addrShape': string
  'relay.error.addrPeer': string
  'relay.error.multiPeer': string
  'relay.error.metadata': string
  'relay.error.access': string
  'relay.error.quota': string
  'relay.error.line': string
  'relay.error.crypto': string

  // ==================== 连通性探测 ====================
  'relay.probe.title': string
  'relay.probe.desc': string
  'relay.probe.action': string
  'relay.probe.empty': string
  'relay.probe.unsupported': string
  'relay.probe.publicHint': string

  // ==================== 业务注册表 ====================
  'wan.title': string
  'wan.desc': string
  'wan.empty': string
  'wan.id': string
  'wan.allow': string
  'wan.block': string
  'wan.state.allowed': string
  'wan.state.blocked': string
  'wan.updatedAt': string
  'wan.note': string
  'wan.saveFailed': string
  'wan.toggleFailed': string
  'wan.unknown': string
  'wan.loadFailed': string

  // ==================== 预览 ====================
  'preview.title': string
  'preview.configured': string
  'preview.empty': string
  'preview.unavailable': string
}

export type Messages = Record<keyof MessageSchema, string>
