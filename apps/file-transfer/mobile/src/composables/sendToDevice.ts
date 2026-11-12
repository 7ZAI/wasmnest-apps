/**
 * 设备行直达发送的前置编排（T23，移动端同构）
 *
 * 只负责「确保已连接 + 切到该设备」，选文件 / 中继提示 / 入队交给现有
 * `uploadFile`。连接失败不进入选择器；连接成功后显式切活跃，避免把文件
 * 发给 `connect` 兜底留下的旧设备。
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
