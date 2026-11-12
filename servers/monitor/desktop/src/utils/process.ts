/**
 * `process` 段解析（桌面）：宿主进程 / WebView 的内存与 CPU
 *
 * **与 wasm 段分开的理由**：`plugins` 段是每个 wasm 实例的线性内存（且只在
 * limiter 批准增长时记账），而「整个 wasmnest 占多少」是 OS 账——宿主主进程 +
 * WebKitGTK 渲染 / 网络 / GPU 子进程。两段各说各的事实，本文件只解析、不合并、
 * 不估算。
 *
 * 缺失语义（fail-visible，禁止用 0 冒充）：
 * - 快照里没有 `process` 段（旧宿主）→ `null`，页面显示「宿主未提供」；
 * - `available: false` → 原样返回原因；
 * - `webview.present: false` → WebView **没有**进账（不是 0 字节）；
 * - `pssBytes` / `cpuPercent` 为 `null` → 宿主明确表示该项不可得。
 */
import type {
  HostProcessMetrics,
  MetricsSnapshot,
  ProcessRoleTag,
  ProcessSample,
  ProcessScope,
} from '../types'
import { isFiniteNumber } from './format'

const ROLES: readonly ProcessRoleTag[] = ['host', 'webview', 'network', 'gpu', 'other']

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** 字节 / 计数字段：非有限值 → `undefined`（缺失，不是 0） */
function countOf(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined
}

/** CPU / PSS 字段：非有限值 → `null`（宿主明确说「无此项」或「无基线」） */
function nullableOf(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null
}

function roleOf(value: unknown): ProcessRoleTag {
  return ROLES.includes(value as ProcessRoleTag) ? (value as ProcessRoleTag) : 'other'
}

function sampleOf(value: unknown): ProcessSample | null {
  const record = recordOf(value)
  if (!record) return null
  const pid = countOf(record.pid)
  // 没有 pid 的行不是一条可定位的进程读数：丢弃而非补零
  if (pid === undefined) return null
  return {
    pid,
    name: typeof record.name === 'string' ? record.name : '',
    role: roleOf(record.role),
    rssBytes: countOf(record.rssBytes),
    pssBytes: nullableOf(record.pssBytes),
    cpuPercent: nullableOf(record.cpuPercent),
  }
}

function samplesOf(value: unknown): ProcessSample[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(sampleOf).filter((sample): sample is ProcessSample => sample !== null)
}

function scopeOf(value: unknown): ProcessScope | null {
  const record = recordOf(value)
  if (!record) return null
  return {
    processCount: countOf(record.processCount),
    rssBytes: countOf(record.rssBytes),
    pssBytes: nullableOf(record.pssBytes),
    cpuPercent: nullableOf(record.cpuPercent),
  }
}

/**
 * 从全量快照里取 `process` 段
 *
 * 返回 `null` = 快照没有这一段（旧宿主 / 未装配指标源），调用方按「未提供」
 * 渲染；返回对象时 `available` 才是权威可用性。
 */
export function hostProcessOf(
  snapshot: MetricsSnapshot | null | undefined,
): HostProcessMetrics | null {
  const segment = recordOf(snapshot?.process)
  if (!segment) return null
  if (segment.available !== true) {
    return {
      available: false,
      reason: typeof segment.reason === 'string' ? segment.reason : undefined,
    }
  }

  const webviewRecord = recordOf(segment.webview)
  const otherRecord = recordOf(segment.otherChildren)
  const webview = webviewRecord
    ? {
        ...(scopeOf(webviewRecord) ?? {}),
        // `present` 只认布尔 true：宿主漏发就是「没找到」，不按进程条数反推
        present: webviewRecord.present === true,
        reason: typeof webviewRecord.reason === 'string' ? webviewRecord.reason : undefined,
        processes: samplesOf(webviewRecord.processes),
      }
    : undefined
  const otherChildren = otherRecord
    ? {
        ...(scopeOf(otherRecord) ?? {}),
        processes: samplesOf(otherRecord.processes),
      }
    : undefined

  return {
    available: true,
    sampledAtUnixMs: countOf(segment.sampledAtUnixMs),
    cpuWindowMs: nullableOf(segment.cpuWindowMs),
    cores: nullableOf(segment.cores),
    self: sampleOf(segment.self),
    webview,
    otherChildren,
    tree: scopeOf(segment.tree) ?? undefined,
  }
}
