/**
 * Auth Center 中文文案（扁平点号 key，命名空间由 i18n/index.ts 前缀）
 *
 * 文案纪律（issue #6 D3）：就位状态必须区分「确知未就位」与「读不到」；
 * 读不到数据时写「读不到 + 原因」，不用空列表冒充「没有设备」；未接管的区块
 * 显式写「尚未接线」，不显示 0 或空表。
 */
const zhCN: Record<string, string> = {
  title: '认证中心',
  subtitle: '本机入站连接的唯一裁决者：谁被放行、谁被拒绝、凭什么。',
  'banner.loading': '正在读取认证中心就位状态…',
  'banner.registered': '认证中心已就位：入站连接由本中心统一裁决，下方配对码 / 二维码可直接用于接入设备。',
  'banner.not_ready': '认证中心未就位：所有入站连接都会被拒绝（deny_kind = no_center）。请查看原因并检查注册失败日志。',
  'banner.unknown': '读不到认证中心状态：这不等同于「未就位」，请检查后端激活链与宿主通信。',

  'status.title': '就位状态',
  'status.registered': '已就位',
  'status.registered.hint': '中心已注册，入站连接按本中心策略裁决。',
  'status.not_ready': '确知未就位',
  'status.not_ready.hint': '中心未注册：此刻所有入站连接都会被拒绝（deny_kind = no_center）。',
  'status.unknown': '读不到状态',
  'status.unknown.hint': '命令没有返回可判读的状态（后端未就绪或调用失败）——不要当成「未就位」处理。',
  'status.reason': '原因',
  'status.owner': '在册属主',
  'status.none': '—',
  'status.version': '插件版本',

  'methods.title': '认证方式',
  'methods.hint': '本中心声明支持的认证方式；「不可用」= 声明了但当前没有可用实现（不会用空列表冒充）。',
  'methods.pairing_code': '配对码',
  'methods.qr': '二维码',
  'methods.biometric': '生物凭证',
  'methods.jwt': '入场 JWT',
  'methods.available': '可用',
  'methods.unavailable': '不可用',

  'pairing.title': '配对码 / 二维码',
  'pairing.hint':
    '配对码与二维码是移动端接入本机的入场凭证：生成新码会替换旧的；验证成功即消费，过期后自动不可见。',
  'pairing.code.title': '配对码',
  'pairing.qr.title': '二维码 token',
  'pairing.generate': '生成',
  'pairing.clear': '清除',
  'pairing.remaining': '剩余 {seconds} 秒（取回时刻的快照，刷新可更新）',

  'trust.title': '可信设备',
  'trust.hint': '统一视图：已配对设备（认证记录库）+ 可信对端（宿主 peer 信任库）。撤销对已配对设备即软删并连带清空其连接历史。',
  'trust.count': '{count} 条',
  'trust.empty': '暂无可信设备',
  'trust.revoke': '撤销',
  'trust.addedAt': '加入于 {at}',
  'trust.peerError': '可信对端段读取失败（已配对设备段照常可用）：{message}',
  'trust.kind.pairing': '已配对',
  'trust.kind.peer': '对端',

  'history.title': '连接历史',
  'history.hint': '按设备查看连接事件：认证方式与结果取自记录库落库值；清空只清历史，不改变配对状态。',
  'history.device': '设备',
  'history.deviceMeta': '配对于 {at} · 累计连接 {count} 次',
  'history.clear': '清空历史',
  'history.noDevices': '暂无已配对设备（与「读不到」不同：这是空集合）',
  'history.noEvents': '该设备暂无连接记录',
  'history.at': '{at}',
  'history.method.pairing_code': '配对码',
  'history.method.qr': '二维码',
  'history.method.biometric': '生物凭证',
  'history.method.jwt': '入场 JWT',
  'history.result.success': '成功',
  'history.result.failed': '失败',

  'keys.title': '入场密钥代次',
  'keys.hint': '只显示代次标识（不含任何密钥材料）。轮换换的是签发密钥：上一代在宽限期内继续参与验签，既有 token 不会被撤销。',
  'keys.active': '当前签发代次',
  'keys.previous': '上一代（宽限期内）',
  'keys.none': '无',
  'keys.rotate': '轮换密钥',
  'keys.rotated': '已轮换到 {kid}（上一代保留至宽限期结束）',

  'pending.title': '尚未接管的区块',
  'pending.body': '下列区块尚未接线：决策计数需要读宿主的全局指标快照（`metrics:read` 是全局读权限），单独一票评估授权面；此处显式留位，不显示 0 冒充。',
  'pending.counters': '决策计数（allow / deny / require_approval / records_dropped）',

  'preview.hint': '点开查看详情',

  'error.title': '读取失败',
  'error.body': '无法读取：{message}',
  retry: '重试',
  loading: '读取中…',
  refresh: '刷新',
}

export default zhCN
