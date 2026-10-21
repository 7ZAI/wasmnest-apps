#!/usr/bin/env node
// 撤销 `link-platform-sdk.mjs` 的本地平台源码切换，回到发布物精确版本。
//
// 行为：
//   · 按 marker（.platform-sdk-link.json）记录的原始 spec 写回根与五个 app 的 package.json；
//     marker 缺失时把 `file:` 依赖写回精确版本；
//   · 删除 .cargo/config.toml 的 link patch 块；
//   · 删除 marker；**不自动执行 pnpm install**（发布版 SDK 未发布时 install 会失败）。
// 幂等：重复执行不抛错。
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SDK_EXACT_VERSION, revertLink } from './platform-sdk-link.mjs'

const APPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const result = revertLink({ appsRoot: APPS_ROOT })

if (result.markerExisted) {
  console.log(`[unlink-platform-sdk] 已按 marker 还原 ${result.restored.length} 个 package.json`)
} else {
  console.warn(
    '[unlink-platform-sdk] 未找到 marker（.platform-sdk-link.json）：' +
      `已按精确版本 ${SDK_EXACT_VERSION} 还原 ${result.restored.length} 个 file: 依赖。`,
  )
}
if (result.cargoConfigRestored) console.log('[unlink-platform-sdk] 已删除 .cargo/config.toml 的 link patch 块')
if (result.restored.length === 0 && !result.cargoConfigRestored) {
  console.log('[unlink-platform-sdk] 当前已是发布物状态，无需改动')
}

console.log(
  '[unlink-platform-sdk] 未自动执行 pnpm install：发布版 SDK（' +
    `${SDK_EXACT_VERSION}）未发布 / 未同步时 install 会失败。` +
    '装回发布版 SDK：先发布 SDK，再在根与各 app 目录执行 pnpm install；在此之前可继续用 link 模式。',
)
