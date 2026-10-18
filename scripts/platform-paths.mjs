/**
 * 平台仓（wasmnest）路径 resolver —— 三仓拆分 spec §5-E3 / §5-E7（应用 → 平台方向）。
 *
 * 应用构建脚本需要平台仓的三类东西：
 *  - 宿主资源目录（dev 期产物直接写进平台仓宿主 `src-tauri/resources/plugins/**`，
 *    宿主读的就是同一目录，省一份搬运）；
 *  - 平台端脚本与 SDK 工具（`plugin-watch.js` / `wasm-hash.js` / `tools/componentize`）；
 *  - 平台仓根本身（供扩展）。
 *
 * 规则（fail-visible）：
 *  1. `WASMNEST_PLATFORM_ROOT` 显式指定（CI / 非常规布局）；
 *  2. 未设时按 R1 布局推导：应用仓根（本文件上一级）的兄弟目录 `wasmnest`；
 *  3. 目录缺失时抛错，不返回可能无效的路径。
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 应用仓根：本文件在 `<appsRoot>/scripts/` 下 */
export const APPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 平台仓根。 */
export function platformRoot() {
  const override = process.env.WASMNEST_PLATFORM_ROOT
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`[platform-paths] WASMNEST_PLATFORM_ROOT 指向的目录不存在: ${override}`)
    }
    return resolve(override)
  }
  const fallback = resolve(APPS_ROOT, '..', 'wasmnest')
  if (!existsSync(fallback)) {
    throw new Error(
      `[platform-paths] 平台仓缺失: ${fallback}。` +
        `请按 R1 布局把平台仓放在应用仓的兄弟目录，或设置 WASMNEST_PLATFORM_ROOT 指向它。`,
    )
  }
  return fallback
}

/** 桌面宿主插件资源目录（`<platform>/wasmnest-desktop/src-tauri/resources/plugins/desktop`） */
export function desktopHostResourcesDir() {
  return join(platformRoot(), 'wasmnest-desktop', 'src-tauri', 'resources', 'plugins', 'desktop')
}

/** 移动宿主插件资源目录（`<platform>/wasmnest-mobile/src-tauri/resources/plugins/mobile`） */
export function mobileHostResourcesDir() {
  return join(platformRoot(), 'wasmnest-mobile', 'src-tauri', 'resources', 'plugins', 'mobile')
}

/** 组件化工具 manifest（平台仓级单一真源 `tools/componentize`） */
export function componentizeManifest() {
  return join(platformRoot(), 'tools', 'componentize', 'Cargo.toml')
}
