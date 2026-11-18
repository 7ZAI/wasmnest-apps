/**
 * 穿透配置展示辅助（设置页「内网穿透」区块）
 *
 * 只做展示层归一：relay 地址脱敏、来源词表映射、时间格式化。
 * 配置读写与校验在 Rust（`normalize_relay_addrs` / `import-relay-config`），
 * 本模块不复制第二套判据。
 */

/**
 * relay 地址脱敏：保留传输 / 端口段，PeerId 只留头尾。
 *
 * 地址来自配置中心或导入，不属于秘密；默认脱敏是为了避免用户截图 / 投屏时
 * 一眼暴露完整中继身份，需要核对时可点「显示完整地址」。
 */
export function maskRelayAddr(addr: string): string {
  const marker = '/p2p/'
  const idx = addr.indexOf(marker)
  if (idx < 0) return addr
  const peer = addr.slice(idx + marker.length)
  if (peer.length <= 10) return addr
  return `${addr.slice(0, idx + marker.length)}${peer.slice(0, 6)}…${peer.slice(-4)}`
}

/** relay 来源 → 文案 key（未知来源不猜，按「未标注」） */
export function relaySourceKey(source: string | undefined): string {
  switch (source) {
    case 'center':
      return 'transfer.relayConfig.sourceCenter'
    case 'cache':
      return 'transfer.relayConfig.sourceCache'
    case 'invite':
      return 'transfer.relayConfig.sourceInvite'
    case 'qr':
      return 'transfer.relayConfig.sourceQr'
    case 'sync':
      return 'transfer.relayConfig.sourceSync'
    default:
      return 'transfer.relayConfig.sourceUnknown'
  }
}

/** relayState 词表（与引擎 `RelayState::as_str()` 同字面；未知不猜） */
export function relayStateKey(state: string | undefined): string {
  switch (state) {
    case 'relay-idle':
      return 'transfer.relayConfig.stateIdle'
    case 'relay-connecting':
      return 'transfer.relayConfig.stateConnecting'
    case 'relay-reserved':
      return 'transfer.relayConfig.stateReserved'
    case 'relay-lost':
      return 'transfer.relayConfig.stateLost'
    default:
      return 'transfer.relayConfig.stateUnknown'
  }
}

/** Unix 毫秒 → 本地时间文本（0 / 非法值返回空串，由界面显性回避） */
export function formatSyncedAt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}
