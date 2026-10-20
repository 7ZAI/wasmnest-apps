#!/usr/bin/env node
/**
 * 单 app、单端的构建 + 打包（CI 与本地发布共用）。
 *
 * 产物：`dist/release/<slug>-<end>-v<version>.zip` + 同名 `.json` 元数据
 * （插件 id / wasm 摘要 / 源提交 / 平台与能力仓 ref），一个 app 一端一个包。
 *
 * 构建链**复用各 app 自己的脚本**（不在 CI 里另写一套编译命令）：
 *  - desktop：`apps/<slug>/desktop` 的 `pnpm run build`
 *    （vite → cargo → 复制到平台宿主 resources → 注入 wasmHash）；
 *  - mobile：平台仓 `wasmnest-mobile/scripts/plugin-build.js --plugin <id>`
 *    （自有 rust 走 SDK CLI；file-transfer 单产物走共享 crate；两者都写宿主 resources）。
 * 打包复用 `scripts/package-plugins.mjs --skip-build`（同一套 zip 格式 + 桌面 wasmHash 复核）。
 *
 * 版本判据：`--version` 必须等于 `plugin.json` / `package.json` 里已提交的版本，
 * **本脚本不改版本**（改版本 = 发布动作，走 `scripts/ci/set-app-version.mjs`）。
 * 构建后再复核宿主 resources 里的 `plugin.json` 版本，防止拿到陈旧产物。
 *
 * 前置：应用仓根已 `pnpm install`（打包脚本从根 node_modules 解析 SDK bin）、
 * 本端工程已 `pnpm install`、平台侧前置已跑（`prepare-platform.mjs`）。
 *
 * 用法（在应用仓根执行）：
 *   node scripts/ci/build-app.mjs --app <slug> --end desktop|mobile [--version x.y.z]
 *                                 [--out dist/release] [--dry-run]
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

import { APPS_ROOT, appInfo, readJson } from './app-info.mjs'
import {
  desktopHostResourcesDir,
  mobileHostResourcesDir,
  platformRoot,
} from '../platform-paths.mjs'

const PACKAGE_STAGE = join(APPS_ROOT, 'dist', 'ci-packages')

function log(msg) {
  console.log(`[build-app] ${msg}`)
}

function fail(msg) {
  console.error(`[build-app] ${msg}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { app: null, end: null, version: null, out: 'dist/release', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (!a.startsWith('--')) fail(`意外的位置参数: ${a}`)
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const val = argv[i + 1]
    if (val === undefined || val.startsWith('--')) fail(`参数 ${a} 缺少取值`)
    args[key] = val
    i++
  }
  if (!args.app) fail('缺少 --app <slug>')
  if (!['desktop', 'mobile'].includes(args.end)) fail('缺少 --end desktop|mobile')
  return args
}

function run(cmd, cmdArgs, cwd) {
  log(`$ ${cmd} ${cmdArgs.join(' ')}   (cwd=${cwd})`)
  const res = spawnSync(cmd, cmdArgs, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  if (res.error) fail(`执行失败: ${cmd} ${cmdArgs.join(' ')}: ${res.error.message}`)
  if (res.status !== 0) fail(`命令非零退出（${res.status}）: ${cmd} ${cmdArgs.join(' ')}`)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function fileInfo(path, what) {
  if (!existsSync(path)) fail(`${what} 缺失: ${path}`)
  const stat = statSync(path)
  if (!stat.isFile() || stat.size === 0) fail(`${what} 不是有效文件: ${path}`)
  return { bytes: stat.size, sha256: sha256(path) }
}

/** 桌面清单自动填充（与 package-plugins 的构建分支同源；--skip-build 时本脚本负责） */
async function generateDesktopManifest(pluginDir) {
  let mod
  try {
    mod = await import('@binblink/wasmnest-plugin-sdk-desktop/bin/manifest-gen.js')
  } catch (e) {
    fail(
      `无法加载桌面 SDK 的 manifest-gen（${e.message}）。` +
        `先在应用仓根跑 pnpm install（打包/清单生成都靠它）。`,
    )
  }
  const { changed, report } = mod.generateManifest(pluginDir)
  if (changed) for (const line of report) log(`  [manifest] ${line}`)
  else log('  [manifest] plugin.json 已是最新')
}

function writeGithubOutput(pairs) {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  appendFileSync(
    file,
    Object.entries(pairs)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(''),
  )
}

function appendSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (!file) return
  appendFileSync(file, markdown.endsWith('\n') ? markdown : `${markdown}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const info = appInfo(args.app)
  const target = info.ends.find((e) => e.end === args.end)
  if (!target) {
    fail(`${info.slug} 没有 ${args.end} 端（现有: ${info.ends.map((e) => e.end).join(', ')}）`)
  }
  if (!target.rustLibrary) fail(`${target.dir}/plugin.json 缺少 rustLibrary（无法定位 wasm 产物）`)

  const version = args.version || info.version
  if (version !== info.version) {
    fail(
      `${info.slug} 当前版本 ${info.version} ≠ 请求版本 ${version}。\n` +
        `  发布前先跑：node scripts/ci/set-app-version.mjs ${info.slug} ${version}（并提交）`,
    )
  }

  const platform = platformRoot()
  const appDir = join(APPS_ROOT, target.dir)
  const resourcesRoot =
    args.end === 'desktop' ? desktopHostResourcesDir() : mobileHostResourcesDir()

  log(`应用 ${info.slug} / ${args.end} / v${version}（插件 ${target.id}）`)

  if (args.dryRun) {
    log(`dry-run: 跳过构建与打包；将输出到 ${resolve(APPS_ROOT, args.out)}`)
    return
  }

  // ==================== 构建 ====================
  if (args.end === 'desktop') {
    await generateDesktopManifest(appDir)
    run('pnpm', ['run', 'build'], appDir)
  } else {
    // 平台移动构建：自有 rust 走 SDK CLI、file-transfer 共享 crate；统一写宿主 resources。
    // 不用 app 自己的 `build`：ai-chatbox / bedcode 的 `wasmnest-plugin build` 只产自身 dist/，
    // 不写 resources（写 resources 是平台移动构建的职责，见 docs/CODE-MAP.md §4）。
    run(
      process.execPath,
      [join(platform, 'wasmnest-mobile', 'scripts', 'plugin-build.js'), '--plugin', target.id],
      appDir,
    )
  }

  // ==================== 产物复核（版本 / 插件 id） ====================
  const shippedManifestPath = join(resourcesRoot, target.id, 'plugin.json')
  const shipped = readJson(shippedManifestPath, `产物清单 ${shippedManifestPath}`)
  if (shipped.id !== target.id) {
    fail(
      `产物 plugin.json 的 id (${shipped.id}) 与源清单 (${target.id}) 不一致: ${shippedManifestPath}`,
    )
  }
  if (shipped.version !== version) {
    fail(
      `产物 plugin.json 版本 ${shipped.version} ≠ ${version}（源清单已改但产物陈旧？）\n` +
        `  ${shippedManifestPath}\n  清掉该目录后重跑构建。`,
    )
  }

  // ==================== 打包（复用 package-plugins：zip 格式 + 桌面 wasmHash 复核） ====================
  rmSync(PACKAGE_STAGE, { recursive: true, force: true })
  run(
    process.execPath,
    [
      join(APPS_ROOT, 'scripts', 'package-plugins.mjs'),
      '--skip-build',
      '--only',
      info.slug,
      '--target',
      args.end,
      '--out',
      'dist/ci-packages',
      '--version',
      version,
    ],
    APPS_ROOT,
  )

  const stagedZip = join(PACKAGE_STAGE, args.end, `${target.id}.zip`)
  const zipInfo = fileInfo(stagedZip, '插件包 zip')

  const outDir = resolve(APPS_ROOT, args.out)
  mkdirSync(outDir, { recursive: true })
  const base = `${info.slug}-${args.end}-v${version}`
  const artifactPath = join(outDir, `${base}.zip`)
  const metadataPath = join(outDir, `${base}.json`)
  cpSync(stagedZip, artifactPath)

  // wasm 摘要（桌面另带构建期注入的 wasmHash；移动端该字段无生产者，见 package-plugins 头注）
  const wasmPath = join(resourcesRoot, target.id, `${target.rustLibrary}.wasm`)
  const wasmInfo = fileInfo(wasmPath, 'wasm 产物')

  const metadata = {
    schema: 1,
    app: info.slug,
    end: args.end,
    plugin: {
      id: target.id,
      name: target.name,
      version,
      pluginType: target.pluginType,
      rustLibrary: target.rustLibrary,
    },
    artifact: { file: `${base}.zip`, bytes: zipInfo.bytes, sha256: zipInfo.sha256 },
    wasm: {
      file: `${target.rustLibrary}.wasm`,
      bytes: wasmInfo.bytes,
      sha256: wasmInfo.sha256,
      ...(typeof shipped.wasmHash === 'string' ? { wasmHash: shipped.wasmHash } : {}),
    },
    source: {
      appsRef: process.env.GITHUB_REF_NAME || null,
      appsCommit: process.env.WASMNEST_APPS_SHA || gitHead(),
      platformRef: process.env.WASMNEST_PLATFORM_REF || null,
      platformCommit: process.env.WASMNEST_PLATFORM_SHA || null,
      libRef: process.env.WASMNEST_LIB_REF || null,
      libCommit: process.env.WASMNEST_LIB_SHA || null,
      builtAt: new Date().toISOString(),
    },
  }
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8')

  const rel = (p) =>
    p
      .slice(APPS_ROOT.length + 1)
      .split('\\')
      .join('/')
  log(`产物: ${rel(artifactPath)}（${zipInfo.bytes} B, sha256 ${zipInfo.sha256.slice(0, 16)}…）`)
  log(`元数据: ${rel(metadataPath)}`)

  writeGithubOutput({
    version,
    plugin_id: target.id,
    artifact_name: `${base}.zip`,
    artifact_path: artifactPath,
    metadata_path: metadataPath,
    zip_sha256: zipInfo.sha256,
    wasm_sha256: wasmInfo.sha256,
  })

  appendSummary(
    [
      `### ${info.slug} · ${args.end} · v${version}`,
      '',
      '| 项 | 值 |',
      '| --- | --- |',
      `| 插件 id | \`${target.id}\` |`,
      `| 产物 | \`${base}.zip\` (${zipInfo.bytes} B) |`,
      `| zip sha256 | \`${zipInfo.sha256}\` |`,
      `| wasm sha256 | \`${wasmInfo.sha256}\` |`,
      `| 平台仓 | \`${metadata.source.platformRef ?? '?'}\` @ \`${(metadata.source.platformCommit ?? '?').slice(0, 12)}\` |`,
      `| 能力仓 | \`${metadata.source.libRef ?? '?'}\` @ \`${(metadata.source.libCommit ?? '?').slice(0, 12)}\` |`,
      `| 应用仓 | \`${metadata.source.appsRef ?? '?'}\` @ \`${(metadata.source.appsCommit ?? '?').slice(0, 12)}\` |`,
      '',
    ].join('\n'),
  )

  // 中间产物清理（zip 与元数据已落到发布目录）
  rmSync(PACKAGE_STAGE, { recursive: true, force: true })
}

function gitHead() {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: APPS_ROOT, encoding: 'utf8' })
  return res.status === 0 ? res.stdout.trim() : null
}

main().catch((e) => {
  console.error(`[build-app] ${e.message}`)
  process.exit(1)
})
