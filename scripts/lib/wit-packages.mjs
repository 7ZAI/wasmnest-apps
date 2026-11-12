/**
 * `compat.witPackages` 生产者 —— 从**组件二进制本身**提取 WIT 包 → 版本（ADR 0061 §6.2）
 *
 * 为什么不是从源码猜：应用的 import 面由构建决定（feature / 条件编译 / 链路），
 * 只有 `wit_component::decode` 解出的 world 成员是权威事实。实现复用随桌面 SDK
 * 分发的 `tools/componentize`（同 crate 已有 `wit-component`，加一个只读模式
 * `--list-packages`），不新增外部依赖、不引平台仓源码路径。
 *
 * fail-visible：SDK 定位失败 / 工具编译失败 / 解码失败 / 缺 `wasmnest:plugin`
 * 一律抛错——发布物宁可发不出，也不发一个没有包表的包（宿主 vendor 门禁会拒）。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { APPS_ROOT } from './projects.mjs'

const SDK_PACKAGE_JSON = '@binblink/wasmnest-plugin-sdk-desktop/package.json'
const REL_MANIFEST = 'tools/componentize/Cargo.toml'

/** 可写 staging 目录（目标缓存留在 `<staging>/target`，多次构建复用） */
const STAGE_DIR = join(APPS_ROOT, 'target', 'componentize-lister')

/** 解析 SDK 包内组件化工具 manifest（经包名，不出现平台仓相对路径） */
export function sdkComponentizeManifest(requireFn = createRequire(import.meta.url)) {
  let pkgJson
  try {
    pkgJson = requireFn.resolve(SDK_PACKAGE_JSON)
  } catch (e) {
    throw new Error(
      `解析 ${SDK_PACKAGE_JSON} 失败：${e.message}\n` +
        '  本步骤需要桌面 SDK 提供 tools/componentize；先在该工程 / 仓根 pnpm install（或 link-platform-sdk）。',
    )
  }
  const manifest = resolve(dirname(pkgJson), REL_MANIFEST)
  if (!existsSync(manifest)) {
    throw new Error(`组件化工具缺失：${manifest}（升级 SDK 或 link-platform-sdk 指回本地平台仓）`)
  }
  return manifest
}

/** 物化 SDK 内工具到可写 staging（每次覆盖源文件；保留 target 缓存） */
function stageTool(manifest) {
  const srcRoot = dirname(manifest)
  mkdirSync(STAGE_DIR, { recursive: true })
  for (const rel of ['Cargo.toml', 'Cargo.lock']) {
    const from = join(srcRoot, rel)
    if (existsSync(from)) cpSync(from, join(STAGE_DIR, rel))
  }
  cpSync(join(srcRoot, 'src'), join(STAGE_DIR, 'src'), { recursive: true })
  return join(STAGE_DIR, 'Cargo.toml')
}

/**
 * 列出组件实际 import / export 的 `wasmnest:` 包 → 版本。
 *
 * @param {string} wasmPath 构建后的组件 wasm
 * @param {{ stageDir?: string, run?: typeof spawnSync }} [opts] 测试注入
 * @returns {Record<string, string>} 例如 `{ 'wasmnest:plugin': '0.1.0', 'wasmnest:pty': '0.0.1' }`
 */
export function listWitPackages(wasmPath, opts = {}) {
  const run = opts.run ?? spawnSync
  const manifest = stageTool(sdkComponentizeManifest())
  const res = run(
    'cargo',
    ['run', '--release', '--manifest-path', manifest, '--', '--list-packages', wasmPath],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  if (res.error) throw new Error(`组件包表提取失败（cargo run componentize）：${res.error.message}`)
  if (res.status !== 0) {
    throw new Error(`组件包表提取失败（componentize --list-packages 退出码 ${res.status}）: ${wasmPath}`)
  }
  let parsed
  try {
    parsed = JSON.parse(res.stdout.trim())
  } catch (e) {
    throw new Error(`componentize --list-packages 输出不是 JSON（${e.message}）：${res.stdout}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
    throw new Error(`componentize --list-packages 输出为空包表（${wasmPath}）`)
  }
  for (const [pkg, version] of Object.entries(parsed)) {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`组件包表项 ${pkg} 的版本不是三段 semver：${version}`)
    }
  }
  if (!('wasmnest:plugin' in parsed)) {
    throw new Error(
      `组件包表缺 wasmnest:plugin（${wasmPath}）——不是按当前 SDK 构建的插件组件？`,
    )
  }
  return parsed
}
