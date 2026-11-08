/**
 * 插件设置核心逻辑 (Mobile) — host-peer 契约版
 *
 * 共享目录条目由宿主持久化（SAF 树授权 + 免授权特殊条目，builtin 不可移除），
 * 添加 = 弹 SAF 目录树选择器（host peer_add_shared_directory）；接收策略
 * （ask/accept/reject）与同意超时经 host set_receive_policy 写入。
 * 并发数与下载目录为移动端固定值（只读展示/隐藏）。
 */
import { ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { Settings, SharedRoot, ReceivingPolicy } from '../types'
import { errorMessage } from '../utils/errorMessage'

/** 宿主 SharedDirDto → 前端 SharedRoot */
function mapWireRoot(raw: any): SharedRoot {
  const builtin = raw?.builtin === true
  return {
    id: raw?.id ?? '',
    kind: builtin ? 'private_downloads' : 'saf',
    name: raw?.name ?? '',
    documentId: raw?.treeUri ?? raw?.tree_uri ?? '',
    authorized: true,
  }
}

function mapWireSettings(raw: any): Settings {
  const policy = raw?.policy_mode ?? raw?.policyMode ?? 'ask'
  const normalized: ReceivingPolicy =
    policy === 'always_accept' ? 'accept' : policy === 'always_deny' ? 'reject' : 'ask'
  return {
    roots: Array.isArray(raw?.roots) ? raw.roots.map(mapWireRoot) : [],
    downloadDir: raw?.download_dir ?? raw?.downloadDir ?? 'MediaStore/Downloads',
    concurrency: 3,
    receivingPolicy: normalized,
    approvalTimeoutSec: raw?.ask_timeout_sec ?? raw?.askTimeoutSec ?? 60,
    // 加密固定开启（穿透方案不变量 12）：旧后端返 false 也不采信，UI 无关闭项
    encryption: true,
    // 中继缺省开；旧后端不返该字段时按开处理（只关中继，不关加密）
    allowWan: raw?.allow_wan !== false && raw?.allowWan !== false,
    relayMaxBytesPerTask:
      typeof raw?.relay_max_bytes_per_task === 'number'
        ? Math.max(0, Math.round(raw.relay_max_bytes_per_task))
        : 0,
  }
}

export function useSettings(context: PluginContext) {
  const settings = ref<Settings>({
    roots: [],
    downloadDir: 'MediaStore/Downloads',
    concurrency: 3,
    receivingPolicy: 'ask',
    approvalTimeoutSec: 60,
    encryption: true,
    allowWan: true,
    relayMaxBytesPerTask: 0,
  })
  const loading = ref(false)

  /** 加载设置（宿主读取） */
  async function load(): Promise<void> {
    loading.value = true
    try {
      const data = await context.commands.execute('file-transfer.get-settings', {})
      settings.value = mapWireSettings(data)
    } catch (e) {
      console.error('[File Transfer] get-settings failed:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * 追加共享目录：弹系统目录树选择器（授权由宿主完成）
   * ok / cancelled / failed / unsupported
   *
   * 宿主错误经 `commands.execute` 统一包装成 `{ code, request_id }`，真实原因只在
   * 服务端文案里——判定文案前必须先取出来，否则 `String(e)` 只是 `[object Object]`，
   * 既判不了 `cancelled`（取消会被报成 failed），排障时也无从下手。
   */
  async function addRoot(): Promise<'ok' | 'duplicate' | 'cancelled' | 'failed' | 'unsupported'> {
    try {
      await context.commands.execute('file-transfer.mount-local', {})
    } catch (e) {
      const msg = errorMessage(e)
      if (msg.includes('cancelled')) return 'cancelled'
      if (msg.includes('not supported') || msg.includes('unsupported')) return 'unsupported'
      console.error('[File Transfer] mount-local failed:', msg, e)
      return 'failed'
    }
    await load()
    // 宿主对重复条目幂等（同 URI 复用），此处不再前端判重
    return 'ok'
  }

  /** 移除共享目录条目（builtin 特殊条目由宿主拒绝移除） */
  async function removeRoot(id: string): Promise<boolean> {
    try {
      const result = await context.commands.execute('file-transfer.update-roots', { remove: id })
      if (result?.removed === false) return false
    } catch (e) {
      console.error('[File Transfer] remove root failed:', e)
      return false
    }
    settings.value = { ...settings.value, roots: settings.value.roots.filter((r) => r.id !== id) }
    return true
  }

  /** 设置接收策略（ask/accept/reject） */
  async function setReceivingPolicy(policy: ReceivingPolicy): Promise<boolean> {
    try {
      await context.commands.execute('file-transfer.set-settings', {
        receivingPolicy: policy,
        approvalTimeoutSec: settings.value.approvalTimeoutSec,
      })
      settings.value = { ...settings.value, receivingPolicy: policy }
      return true
    } catch (e) {
      console.error('[File Transfer] set receiving policy failed:', e)
      return false
    }
  }

  /** v2 设置同意超时（秒，10–600，仅 ask 策略生效） */
  async function setApprovalTimeout(secs: number): Promise<boolean> {
    const clamped = Math.min(Math.max(Math.round(secs), 10), 600)
    try {
      await context.commands.execute('file-transfer.set-settings', {
        receivingPolicy: settings.value.receivingPolicy,
        approvalTimeoutSec: clamped,
      })
      settings.value = { ...settings.value, approvalTimeoutSec: clamped }
      return true
    } catch (e) {
      console.error('[File Transfer] set approval timeout failed:', e)
      return false
    }
  }

  /** 设置是否允许中继（T12：只控制拨号候选，不碰加密——不变量 12） */
  async function setAllowWan(allow: boolean): Promise<boolean> {
    if (allow === settings.value.allowWan) return true
    try {
      await context.commands.execute('file-transfer.set-settings', { allowWan: allow })
      settings.value = { ...settings.value, allowWan: allow }
      return true
    } catch (e) {
      console.error('[File Transfer] set allowWan failed:', e)
      return false
    }
  }

  /** 设置中继提示阈值（字节；0 = 每次提示；非法值按 0 收敛） */
  async function setRelayMaxBytes(bytes: number): Promise<boolean> {
    const clamped = Math.max(0, Math.round(Number.isFinite(bytes) ? bytes : 0))
    if (clamped === settings.value.relayMaxBytesPerTask) return true
    try {
      await context.commands.execute('file-transfer.set-settings', {
        relayMaxBytesPerTask: clamped,
      })
      settings.value = { ...settings.value, relayMaxBytesPerTask: clamped }
      return true
    } catch (e) {
      console.error('[File Transfer] set relay threshold failed:', e)
      return false
    }
  }

  /** 设置发送方向并发上限（1–8 钳制；随下次发送载荷脉冲推送宿主闸门） */
  async function setConcurrency(n: number): Promise<boolean> {
    const clamped = Math.min(8, Math.max(1, Math.round(n)))
    if (clamped === settings.value.concurrency) return true
    try {
      await context.commands.execute('file-transfer.set-settings', { concurrency: clamped })
      settings.value = { ...settings.value, concurrency: clamped }
      return true
    } catch (e) {
      console.error('[File Transfer] set concurrency failed:', e)
      return false
    }
  }

  return {
    settings,
    loading,
    load,
    addRoot,
    removeRoot,
    setReceivingPolicy,
    setApprovalTimeout,
    setConcurrency,
    setAllowWan,
    setRelayMaxBytes,
  }
}
