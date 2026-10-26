/**
 * Auth Center 中文文案（扁平点号 key，命名空间由 i18n/index.ts 前缀）
 *
 * 文案纪律（issue #6 D3）：就位状态必须区分「确知未就位」与「读不到」；
 * 读不到数据时写「读不到 + 原因」，不用空列表冒充「没有设备」；接入应用的
 * 「未安装」与「状态读不到」分开写，不互相冒充。
 */
const zhCN: Record<string, string> = {
  title: '认证中心',
  subtitle: '本机入站连接的唯一裁决者：谁被放行、谁被拒绝、凭什么。',
  'status.title': '就位状态',
  'status.registered': '已就位',
  'status.not_ready': '确知未就位',
  'status.unknown': '读不到状态',
  'status.reason': '原因',
  'status.owner': '在册属主',
  'status.none': '—',
  'status.version': '插件版本',

  'methods.title': '认证方式',
  'methods.pairing_code': '配对码',
  'methods.qr': '二维码',
  'methods.biometric': '生物凭证',
  'methods.jwt': '入场 JWT',
  'methods.available': '可用',
  'methods.unavailable': '不可用',

  'keys.title': '入场密钥代次',
  'keys.active': '当前签发代次',
  'keys.previous': '上一代',
  'keys.none': '无',
  'keys.rotate': '轮换密钥',
  'keys.rotated': '已轮换到 {kid}',

  'consumers.title': '接入应用',
  'consumers.count': '{count} 个接入方',
  'consumers.state.activated': '已激活',
  'consumers.state.loaded': '已加载（未激活）',
  'consumers.state.activating': '激活中',
  'consumers.state.degraded': '已降级',
  'consumers.state.needsApproval': '待授权',
  'consumers.state.error': '激活失败',
  'consumers.state.deactivated': '已停用',
  'consumers.state.missing': '未安装',
  'consumers.state.unknown': '状态读不到',
  'consumers.surface.device-center': '设备中心（配对码 / 二维码）',
  'consumers.surface.trust': '可信设备',
  'consumers.surface.history': '连接历史',
  'consumers.surface.keys': '密钥轮换',
  'consumers.surface.consent': '首连确认',

  'error.title': '读取失败',
  'error.body': '无法读取：{message}',
  retry: '重试',
  loading: '读取中…',
  refresh: '刷新',
}

export default zhCN
