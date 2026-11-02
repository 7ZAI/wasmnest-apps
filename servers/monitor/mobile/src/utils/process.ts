/**
 * `process` 段解析 + WebView 自报堆（移动端）
 *
 * **与 wasm 段分开的理由**：`plugins` 段是每个 wasm 实例的线性内存，`process` 段是
 * 宿主进程的 OS 账。移动端口径更窄：Android 的 WebView 渲染进程是独立 uid、父进程
 * 是 `webview_zygote`（真机实测），不在本进程树内也读不到 `/proc` ⇒ 宿主下发
 * `webview.present: false`，本层不拿 0 冒充。
 *
 * 缺失语义（fail-visible，禁止用 0 冒充）：
 * - 快照没有 `process` 段（旧宿主）→ `null`，页面显示「未提供」；
 * - `available: false` → 原样透传原因；
 * - `pssBytes` / `cpuPercent` 为 `null` → 宿主明确表示该项不可得。
 */
import type {
  HostProcessMetrics,
  MetricsSnapshot,
  ProcessRoleTag,
  ProcessSample,
  ProcessScope,
  WebviewHeap,
} from '../types'
import { isFiniteNumber } from './format'

const ROLES: readonly ProcessRoleTag[] = ['host', 'webview', 'network', 'gpu', 'other']

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function countOf(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined
}

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

/** 从全量快照取 `process` 段；`null` = 段缺失（旧宿主） */
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
        // 只认布尔 true：宿主漏发就是「没找到」，不按进程条数反推
        present: webviewRecord.present === true,
        reason: typeof webviewRecord.reason === 'string' ? webviewRecord.reason : undefined,
        processes: samplesOf(webviewRecord.processes),
      }
    : undefined
  const otherChildren = otherRecord
    ? { ...(scopeOf(otherRecord) ?? {}), processes: samplesOf(otherRecord.processes) }
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

/**
 * 读 WebView 自报的 JS 堆（`performance.memory`；Chromium 专有）
 *
 * - 只有 Chromium 系（Android WebView / 桌面 WebView2）有这个 API；WebKitGTK 与
 *   WKWebView 返回 `null`（页面据此不显示这一行，也不拿别的数顶替）；
 * - 未开启跨源隔离时 Chromium **量化**返回值（实测 used 按 ~10 MB 取整），
 *   故 `quantized` 跟随 `crossOriginIsolated`，页面必须标「粗粒度」。
 */
export function webviewHeapOf(scope: unknown): WebviewHeap | null {
  const record = recordOf(scope)
  if (!record) return null
  const performance = recordOf(record.performance)
  const memory = recordOf(performance?.memory)
  if (!memory) return null
  const usedBytes = countOf(memory.usedJSHeapSize)
  if (usedBytes === undefined) return null
  return {
    usedBytes,
    totalBytes: nullableOf(memory.totalJSHeapSize),
    limitBytes: nullableOf(memory.jsHeapSizeLimit),
    quantized: record.crossOriginIsolated !== true,
  }
}
