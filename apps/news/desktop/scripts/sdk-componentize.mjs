/**
 * 组件化工具 manifest 定位（G2：工具随 npm SDK 分发，不引平台仓源码）
 *
 * news 是双端单产物（wasm32-unknown-unknown + 组件化），需要 `componentize`
 * 工具把 core module 编码成 Component Model。该 crate 的发布落点 = 桌面 SDK
 * 包内 `tools/componentize/`，这里只经包名定位。
 *
 * 缺失即显性报错并给出路（不静默跳过组件化——跳过 = 产出一个宿主装不上的
 * core module）。
 */
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const SDK_PACKAGE_JSON = '@binblink/wasmnest-plugin-sdk-desktop/package.json'
const REL_MANIFEST = 'tools/componentize/Cargo.toml'

/**
 * 纯解析：给定 SDK 的 package.json 路径 + exists 探针，返回组件化工具 manifest 路径。
 *
 * @param {string} sdkPackageJson `.../@binblink/wasmnest-plugin-sdk-desktop/package.json`
 * @param {(p: string) => boolean} exists 存在性探针（测试注入）
 * @returns {string} `<sdk 包根>/tools/componentize/Cargo.toml`
 */
export function resolveComponentizeManifest(sdkPackageJson, exists = existsSync) {
  const manifest = resolve(dirname(sdkPackageJson), REL_MANIFEST)
  if (!exists(manifest)) {
    throw new Error(
      `[build] 组件化工具缺失：${manifest}\n` +
        '[build]   该工具应随 @binblink/wasmnest-plugin-sdk-desktop 一起发布（tools/componentize）。\n' +
        '[build]   修法：① 升级到自带 tools/componentize 的 SDK 版本；' +
        '② 平台仓开发者跑 node scripts/link-platform-sdk.mjs 把 SDK 指回本地平台仓。',
    )
  }
  return manifest
}

/** 应用侧调用面：经包名解析 SDK 位置（Node ESM 用 createRequire 拿 package.json） */
export function componentizeManifest() {
  const require = createRequire(import.meta.url)
  let pkgJson
  try {
    pkgJson = require.resolve(SDK_PACKAGE_JSON)
  } catch (e) {
    throw new Error(
      `[build] 解析 ${SDK_PACKAGE_JSON} 失败：${e.message}\n` +
        '[build]   本 app 依赖桌面 SDK 提供组件化工具；先在该工程目录 pnpm install。',
    )
  }
  return resolveComponentizeManifest(pkgJson)
}

/**
 * 把组件化工具物化到本 app 可写目录后返回其 manifest 路径。
 *
 * node_modules 里的包目录是 pnpm 只读硬链接仓库，cargo 要在 manifest 旁边写
 * `Cargo.lock` 会失败。物化 = 拷 Cargo.toml / Cargo.lock / src/** 到
 * `.build/componentize/`，构建可写、可复现，且仍然只消费 SDK 发布物。
 *
 * @param {string} sdkManifest `<sdk 包根>/tools/componentize/Cargo.toml`
 * @param {string} destDir 本 app 内的可写目录（如 `<app>/.build/componentize`）
 * @returns {string} 物化后的 manifest 路径
 */
export function stageComponentizeTool(sdkManifest, destDir) {
  const srcRoot = dirname(sdkManifest)
  if (!existsSync(join(srcRoot, 'src', 'main.rs'))) {
    throw new Error(
      `[build] SDK 包内组件化工具形态不完整：缺 ${join(srcRoot, 'src', 'main.rs')}` +
        '（Cargo.toml 在但源码缺失 = 发布物损坏，请重新安装 SDK）',
    )
  }
  mkdirSync(destDir, { recursive: true })
  for (const rel of ['Cargo.toml', 'Cargo.lock']) {
    const from = join(srcRoot, rel)
    if (existsSync(from)) cpSync(from, join(destDir, rel))
  }
  cpSync(join(srcRoot, 'src'), join(destDir, 'src'), { recursive: true })
  return join(destDir, 'Cargo.toml')
}

/** 一站式：定位 SDK 内工具 → 物化到本 app 可写目录 → 返回可 `cargo run` 的 manifest */
export function componentizeManifestForBuild({ destDir }) {
  return stageComponentizeTool(componentizeManifest(), destDir)
}