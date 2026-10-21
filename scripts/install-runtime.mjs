#!/usr/bin/env node
/**
 * install-runtime —— 构建 / 取用 **L2 通用 runtime crate**（`wasmnest-desktop-runtime`）
 *
 * spec D4 / CONTRACT §5.2：宿主机制也可以「作为依赖」直接被构建，用于比 packed 宿主更细
 * 的断言面。app 维度**只用 `WASMNEST_PLUGINS_DIR` 表达**（不生成 per-app runtime crate）。
 *
 * ## 两条通道
 *
 * | 通道 | 命令 | 前置 |
 * | --- | --- | --- |
 * | `crates-io`（默认） | `cargo install wasmnest-desktop-runtime --version =<lock 版本> --root <缓存>` | 平台仓把该 crate 发到 crates.io（L2 的发布动作，本票据只实现不发布） |
 * | `platform`（`--from <平台仓>`） | 在平台仓里 `cargo build --features tauri/custom-protocol --manifest-path .../src-tauri/Cargo.toml --bin wasmnest-desktop`（debug 产物）后**复制**进缓存 | 本机有平台仓工作树 |
 *
 * `--from` 走 build + 复制而不是 `cargo install --path`：`--install` 会要求该 crate 的
 * `Cargo.lock` 与依赖解析在应用仓工作目录下也成立，而 cargo 的 config 发现按 **cwd**
 * 而不是 manifest 路径 —— 平台仓 `.cargo/config.toml` 里的 `[patch]`（能力仓兄弟目录 +
 * 尚未发布的 crates.io SDK）会吃不到，结果是解析失败或拉到与本地不同码的依赖。
 * build + 复制把这条不确定性去掉，代价是多一次复制（宿主二进制本来就 ~百 MB）。
 *
 * `--host-mode runtime` 只在这条 **platform 通道**下可跑：crates.io 的 `cargo install`
 * 产出 release 二进制，而 E2E 依赖 `#[cfg(debug_assertions)]` 才注册的 wdio 插件；
 * registry 通道因此只用于「作为依赖被消费」的编译期校验。
 *
 * **为什么没有 `cargo install --git --tag`**：平台仓刻意**没有根 Cargo workspace**
 * （30+ 独立 Cargo.toml、8 个 target 落点，见平台仓根 `.cargo/config.toml` 头注），
 * git 依赖只能在 workspace 成员里定位包，`--git` 通道因此不成立。该偏离 CONTRACT §5.4
 * 已写进票据与实施记录，等 owner 复核。
 *
 * ## 与宿主产物（packed）的边界
 *
 * 本脚本产出的是 **dev / 验证期**二进制（D8：发布链路不带，见 `scripts/ci/check-release-purity.mjs`）；
 * `fetch-host.mjs` 下载的是已发布宿主产物。两者都只经 `--host` / `WASMNEST_HOST_BIN`
 * 进入 `host-runtime.mjs` 的显式档，app 侧解析逻辑不分叉。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/install-runtime.mjs                      # crates.io 通道
 * node scripts/install-runtime.mjs --from <平台仓根>     # 本地平台源码通道
 * node scripts/install-runtime.mjs --print              # 只打印缓存里的 bin 路径（不安装、不建目录）
 * node scripts/e2e.mjs --app <slug> --host-mode runtime # 用它跑 E2E
 * ```
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  APPS_ROOT,
  normalizeArch,
  normalizePlatform,
  resolveCacheRoot,
} from './host-runtime.mjs'

/** runtime crate 包名：恒为通用名，不追加 app slug（CONTRACT §5.2） */
export const RUNTIME_CRATE = 'wasmnest-desktop-runtime'
/** 二进制名：与宿主产物同名（平台仓显式 `[[bin]]`） */
export const RUNTIME_BIN = 'wasmnest-desktop'

/** 缓存分层：`<宿主缓存>/runtime/<version>/<platform>-<arch>`（与 fetch-host 的产物缓存同根不同目录） */
export function runtimeCacheDir({
  cacheRoot = resolveCacheRoot(),
  version,
  platform = normalizePlatform(),
  arch = normalizeArch(),
} = {}) {
  return join(cacheRoot, 'runtime', version, `${platform}-${arch}`)
}

/**
 * 安装计划（纯函数）：版本 → 缓存位置 → 命令。
 *
 * 版本口径与宿主解析器一致：`version` 参数 > `WASMNEST_HOST_VERSION` >
 * `host-runtime.lock.json`。三者都没有 ⇒ **抛错**（不猜默认值：runtime 版本决定
 * WIT / 挂载契约，猜一个就是把错位静默放过去）。
 */
export function resolveRuntimePlan({
  appsRoot = APPS_ROOT,
  cacheRoot = resolveCacheRoot(),
  version,
  from,
  platform = normalizePlatform(),
  arch = normalizeArch(),
  env = process.env,
} = {}) {
  const lockPath = join(appsRoot, 'host-runtime.lock.json')
  let resolved = (version || env.WASMNEST_HOST_VERSION || '').trim()
  if (!resolved) {
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf-8'))
      resolved = lock?.hostRuntime?.version ?? ''
    }
  }
  if (!resolved) {
    throw new Error(
      `[install-runtime] 无法确定 runtime 版本：既没有 WASMNEST_HOST_VERSION，` +
        `${lockPath} 也不存在 / 没有 hostRuntime.version。\n` +
        `[install-runtime]   → node scripts/ci/sync-host-lock.mjs 从平台 release-manifest 签入 lock，` +
        '或显式 `--version <x.y.z>`。',
    )
  }

  const binName = platform === 'windows' ? `${RUNTIME_BIN}.exe` : RUNTIME_BIN
  const root = runtimeCacheDir({ cacheRoot, version: resolved, platform, arch })
  const bin = join(root, 'bin', binName)

  if (from) {
    const manifestDir = join(from, 'wasmnest-desktop', 'src-tauri')
    const manifest = join(manifestDir, 'Cargo.toml')
    if (!existsSync(manifest)) {
      throw new Error(
        `[install-runtime] --from 指向的目录不是平台仓：缺 src-tauri/Cargo.toml（${manifest}）`,
      )
    }
    return {
      version: resolved,
      root,
      bin,
      source: 'platform',
      mode: 'build-copy',
      cwd: from,
      // debug + `tauri/custom-protocol`，与 host:pack 的 `tauri build --debug --no-bundle` 同形：
      //  - tauri 的 `dev` cfg = **!custom-protocol**（tauri build.rs），纯 debug 产物走
      //    `devUrl`（:1420），没有平台前端 dev server 时页面 `about:blank`；
      //  - 但 E2E 又**必须**是 debug（`tauri-plugin-wdio` 被 `#[cfg(debug_assertions)]` 门住，
      //    release 产物里没有它 ⇒ `browser.tauri.execute` 不可用）。
      // 两条合起来 = 只有「debug + custom-protocol」这一种形态能跑，这里显式钉住它。
      builtBin: join(manifestDir, 'target', 'debug', binName),
      command: {
        command: 'cargo',
        args: [
          'build',
          '--features',
          'tauri/custom-protocol',
          '--manifest-path',
          manifest,
          '--bin',
          RUNTIME_BIN,
        ],
      },
    }
  }

  return {
    version: resolved,
    root,
    bin,
    source: 'crates-io',
    mode: 'install',
    builtBin: null,
    command: {
      command: 'cargo',
      args: ['install', RUNTIME_CRATE, '--version', `=${resolved}`, '--root', root, '--locked'],
    },
  }
}

/**
 * runtime 未安装时的可执行指引（形态与 host-runtime 的缺失指引一致：给路，不说「找不到」）。
 *
 * @param {{version?: string, channel?: string}} [info]
 */
export function runtimeMissingHint({ version = '<lock 版本>', channel = 'crates-io' } = {}) {
  return [
    `[install-runtime] 未安装通用 runtime crate ${RUNTIME_CRATE}@${version}（当前通道=${channel}）。三选一：`,
    '  1) registry 通道（需平台仓已把该 crate 发布到 crates.io）：',
    '       node scripts/install-runtime.mjs',
    '  2) 本机有平台仓时源码构建 + 复制进缓存（走平台仓 .cargo/config.toml 的 [patch]）：',
    '       node scripts/install-runtime.mjs --from <平台仓根>',
    '  3) 不装 runtime，改用已发布的宿主产物做完整前后端验证（G2 默认形态）：',
    '       node scripts/fetch-host.mjs && node scripts/e2e.mjs --app <slug>',
  ].join('\n')
}

/** 默认执行器：真实 cargo（测试注入假实现，不碰网络 / 不编 Tauri） */
function defaultExec(command, args, options = {}) {
  return spawnSync(command, args, { stdio: 'inherit', ...options })
}

/**
 * 执行安装计划。
 *
 * - `print` ⇒ 只解析 bin 路径，**不执行命令、不建目录**（给 `WASMNEST_HOST_BIN=$(...)` 用）；
 * - 缓存里已有 bin ⇒ 复用（幂等）；`force` 才重装；
 * - 命令成功但产物不在预期位置 ⇒ 显性报错点名路径（不静默返回半套状态）。
 */
export function installRuntime({
  appsRoot,
  cacheRoot,
  version,
  from,
  print = false,
  force = false,
  exec = defaultExec,
} = {}) {
  const plan = resolveRuntimePlan({ appsRoot, cacheRoot, version, from })

  if (print) {
    return { bin: plan.bin, version: plan.version, installed: false, source: plan.source, printed: true }
  }
  if (!force && existsSync(plan.bin)) {
    return { bin: plan.bin, version: plan.version, installed: false, source: plan.source, reused: true }
  }

  const res = exec(plan.command.command, plan.command.args, plan.cwd ? { cwd: plan.cwd } : {})
  const status = res?.status ?? 1

  if (plan.mode === 'install') {
    if (status !== 0) {
      throw new Error(
        `[install-runtime] ✗ cargo install 失败（exit=${status}）。\n` +
          `[install-runtime]   最常见原因：${RUNTIME_CRATE} 尚未发布到 crates.io（L2 的发布动作）。\n` +
          `[install-runtime]   出路：① 本机有平台仓 → node scripts/install-runtime.mjs --from <平台仓根>；` +
          '② 只要跑 E2E → node scripts/fetch-host.mjs 用已发布宿主产物。',
      )
    }
    if (!existsSync(plan.bin)) {
      throw new Error(
        `[install-runtime] ✗ cargo install 报成功，但缓存里找不到 ${RUNTIME_BIN}：${plan.bin}`,
      )
    }
    return { bin: plan.bin, version: plan.version, installed: true, source: plan.source }
  }

  if (status !== 0) {
    throw new Error(
      `[install-runtime] ✗ 平台仓 cargo build 失败（exit=${status}）：${plan.command.args.join(' ')}\n` +
        `[install-runtime]   → 该通道需要平台仓工作树可用（依赖走其 .cargo/config.toml 的 [patch]）；` +
        '或改用发布通道 / fetch-host。',
    )
  }
  if (!existsSync(plan.builtBin)) {
    throw new Error(
      `[install-runtime] ✗ cargo build 成功但找不到产物二进制（target/debug/${RUNTIME_BIN}）：${plan.builtBin}`,
    )
  }
  mkdirSync(dirname(plan.bin), { recursive: true })
  copyFileSync(plan.builtBin, plan.bin)
  // 复制可能丢执行位（Linux/macOS 上 = 宿主直接起不来）：按源文件模式补齐可执行位
  if (process.platform !== 'win32') {
    const mode = statSync(plan.builtBin).mode || 0o644
    chmodSync(plan.bin, mode | ((mode & 0o111) === 0 ? 0o755 : 0))
  }
  return { bin: plan.bin, version: plan.version, installed: true, source: plan.source }
}

// ==================== CLI ====================

function parseArgs(argv) {
  const args = { from: null, version: null, cacheRoot: null, print: false, force: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--from') args.from = argv[++i]
    else if (a === '--version') args.version = argv[++i]
    else if (a === '--cache') args.cacheRoot = argv[++i]
    else if (a === '--print') args.print = true
    else if (a === '--force') args.force = true
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`[install-runtime] 未知参数：${a}（--help 看用法）`)
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      [
        '用法：node scripts/install-runtime.mjs [--from <平台仓根>] [--version x.y.z] [--print] [--force]',
        '',
        '  --from <平台仓>  本地平台源码通道（cargo build + 复制进缓存）；缺省走 crates.io 安装',
        '  --version        覆盖 host-runtime.lock.json 钉住的宿主运行时版本',
        '  --cache <目录>   覆盖宿主缓存根（默认按平台缓存目录）',
        '  --print          只打印缓存里的二进制路径（不安装、不建目录）',
        '  --force          缓存已有二进制也重装',
      ].join('\n'),
    )
    return
  }
  const result = installRuntime({
    from: args.from,
    version: args.version,
    cacheRoot: args.cacheRoot ? join(process.cwd(), args.cacheRoot) : undefined,
    print: args.print,
    force: args.force,
  })
  if (args.print) {
    if (!existsSync(result.bin)) {
      console.error(`[install-runtime] ✗ 缓存里没有二进制：${result.bin}`)
      console.error('[install-runtime]   → 先安装：node scripts/install-runtime.mjs --from <平台仓根>（或发布后不带 --from）')
      process.exit(1)
    }
    console.log(result.bin)
    return
  }
  console.log(
    result.installed
      ? `[install-runtime] ✓ runtime 二进制：${result.bin}（通道=${result.source}）`
      : `[install-runtime] ✓ 复用缓存里的 runtime：${result.bin}（--force 可重装）`,
  )
  console.log('[install-runtime]   E2E：node scripts/e2e.mjs --app <slug> --host-mode runtime')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main()
  } catch (e) {
    console.error(`[install-runtime] ✗ ${e?.message ?? e}`)
    process.exit(1)
  }
}
