/**
 * 宿主运行时兼容声明 resolver —— 发布元数据 `compat` 段的唯一生产者
 *
 * 背景（应用版本更新全链路）：应用包按 GitHub Release 分发后，宿主更新检查需要
 * 知道「这个包要求什么平台」。真源 = 仓根 `host-runtime.lock.json`（构建时刻应用
 * 仓钉住的宿主运行时版本轴），本模块把它盖章进 `build-app.mjs` 的发布元数据：
 *
 * ```json
 * "compat": {
 *   "hostRuntime": "0.0.1",
 *   "mountContract": "1",
 *   "sdkVersion": "0.0.1",
 *   "witVersion": "0.0.1"
 * }
 * ```
 *
 * 口径（fail-visible）：
 * - 锁文件缺失 / JSON 非法 / 任一字段缺失或为空 → **直接抛错**，点名缺失项与
 *   文件路径——发布物宁可发不出，也不发一个没有兼容声明的包（宿主侧对缺
 *   `compat` 的元数据一律判不兼容，见平台仓 `useAppUpdates`）；
 * - 锁文件本身不进任何产物（发布纯净锁 D8 把它列为违规项）；进产物的只是这里的
 *   四个标量值，因此消费方（宿主）不需要理解锁文件全貌。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { APPS_ROOT } from './projects.mjs'

/** 应用仓根下的宿主运行时锁（真源，CI 由 sync-host-lock 从平台仓 manifest 同步） */
export const HOST_RUNTIME_LOCK_PATH = join(APPS_ROOT, 'host-runtime.lock.json')

const REQUIRED_FIELDS = [
  ['version', 'hostRuntime'],
  ['mountContract', 'mountContract'],
  ['sdkVersion', 'sdkVersion'],
  ['witVersion', 'witVersion'],
]

/**
 * 锁对象 → 兼容声明（纯函数，测试钉行为）
 *
 * @param {unknown} lock 反序列化后的 host-runtime.lock.json
 * @returns {{ hostRuntime: string, mountContract: string, sdkVersion: string, witVersion: string }}
 */
export function compatFromLock(lock) {
  if (typeof lock !== 'object' || lock === null) {
    throw new Error('host-runtime.lock.json 不是对象（无法提取兼容声明）')
  }
  const hostRuntime = /** @type {Record<string, unknown>} */ (lock).hostRuntime
  if (typeof hostRuntime !== 'object' || hostRuntime === null) {
    throw new Error('host-runtime.lock.json 缺少 hostRuntime 段（无法提取兼容声明）')
  }
  const out = {}
  for (const [field, compatKey] of REQUIRED_FIELDS) {
    const value = /** @type {Record<string, unknown>} */ (hostRuntime)[field]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`host-runtime.lock.json 的 hostRuntime.${field} 缺失或为空（兼容声明不完整，拒绝发布）`)
    }
    out[compatKey] = value
  }
  return out
}

/**
 * 读仓根锁文件并提取兼容声明（build-app.mjs 构建期调用）
 *
 * @param {string} [lockPath] 缺省 = 仓根 host-runtime.lock.json
 */
export function readHostCompat(lockPath = HOST_RUNTIME_LOCK_PATH) {
  let raw
  try {
    raw = readFileSync(lockPath, 'utf-8')
  } catch (e) {
    throw new Error(
      `无法读取宿主运行时锁 ${lockPath}（${/** @type {Error} */ (e).message}）。` +
        `发布元数据必须携带兼容声明；若在异常检出场景，先恢复该文件再构建。`,
    )
  }
  let lock
  try {
    lock = JSON.parse(raw)
  } catch (e) {
    throw new Error(`host-runtime.lock.json 不是合法 JSON（${/** @type {Error} */ (e).message}）`)
  }
  return compatFromLock(lock)
}
