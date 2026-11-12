/**
 * 设备行直达发送的前置编排（T23，无头纯函数）
 *
 * 只负责「确保已连接 + 切到该设备」，不碰文件选择器：连接失败必须发生在
 * 弹选择器之前（否则用户白选一堆文件）；`connect` 内部的活跃兜底可能把
 * 活跃对端留在旧设备上，所以连接成功后仍要显式切一次。
 *
 * 选择 / 中继提示 / 入队仍由各端现有发送流程接管（桌面 `handleUpload`、
 * 移动 `uploadFile`），避免把两套发送路径复制成第三套。
 */
import type { DeviceRow, DialStatus } from './deviceState'

export type DeviceSendPreparation =
  { ok: true } | { ok: false; reason: 'skipped' | 'connect-failed' | 'switch-failed' }

export interface DeviceSendDeps {
  connect: (nodeId: string) => Promise<DialStatus | null>
  switchPeer: (nodeId: string) => Promise<boolean>
}

export async function prepareDeviceSend(
  nodeId: string,
  row: DeviceRow | undefined,
  deps: DeviceSendDeps,
): Promise<DeviceSendPreparation> {
  if (!row || !row.fileTransfer) return { ok: false, reason: 'skipped' }
  if (row.status !== 'connected') {
    const status = await deps.connect(nodeId)
    if (status !== 'connected') return { ok: false, reason: 'connect-failed' }
  }
  if (!(await deps.switchPeer(nodeId))) return { ok: false, reason: 'switch-failed' }
  return { ok: true }
}
