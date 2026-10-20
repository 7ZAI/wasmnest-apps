import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Options } from '@wdio/types'
import { desktopHostDir } from '../scripts/platform-paths.mjs'

/**
 * 桌面端 E2E 配置（应用仓层 · WebdriverIO + @wdio/tauri-service）
 *
 * 驱动链：WDIO → `@wdio/tauri-service`（driverProvider: external）→ `tauri-driver`
 * （Rust）→ `WebKitWebDriver`（Linux 原生驱动）→ 桌面宿主 debug 二进制。
 *
 * 三条前置（缺任一则用例必然红，且失败原因会伪装成「功能坏」）：
 * 1. **宿主 debug 二进制**：wdio 插件只在 `#[cfg(debug_assertions)]` 注册，release
 *    产物不含它（平台仓有锁测试保证）。release 二进制另走 `host:pack` 路线。
 * 2. **宿主前端 dev server**：debug 二进制走 `tauri.conf.json` 的 `devUrl`
 *    （`http://localhost:1420`），不启服务时页面是 `about:blank` —— 所有 DOM 断言都会
 *    假绿。`scripts/e2e.mjs` 负责起/复用它。
 * 3. **`tauri-driver` + `WebKitWebDriver`**（Linux）：`scripts/e2e.mjs` 预检并 fail-visible。
 *
 * 宿主二进制路径由 `scripts/e2e.mjs` 经 `WASMNEST_E2E_HOST_BIN` 传入（也可直接指定
 * 打包产物：`WASMNEST_E2E_HOST_BIN=<platform>/wasmnest-desktop/dist/host-desktop/...`）。
 */

const HERE = resolve(process.cwd())

/** 宿主 debug 二进制（默认：平台仓 `src-tauri/target/debug/`） */
const HOST_BIN =
  process.env.WASMNEST_E2E_HOST_BIN ??
  join(desktopHostDir(), 'src-tauri', 'target', 'debug', 'wasmnest-desktop')

if (!existsSync(HOST_BIN)) {
  throw new Error(
    `[e2e] 宿主 debug 二进制不存在：${HOST_BIN}\n` +
      '  构建：cd <平台仓>/wasmnest-desktop && cargo build --manifest-path src-tauri/Cargo.toml\n' +
      '  或指定现成产物：WASMNEST_E2E_HOST_BIN=<binary>',
  )
}

export const config: Options.Testrunner = {
  runner: 'local',
  // 用例目录相对**工作目录**（= 应用仓根，由 `scripts/e2e.mjs` 设定）。
  // 不能用 `import.meta.url` 定位：WDIO 会把 TS 配置打包到临时文件再加载，
  // 那里算出来的路径不是本文件的位置。
  specs: [resolve(HERE, 'e2e', 'specs', '**', '*.spec.ts')],
  // 桌面宿主是**单实例**资源（端口 / 应用数据目录 / 窗口）：并发跑会互相踩。
  maxInstances: 1,

  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: HOST_BIN,
      },
    },
  ],

  services: [
    [
      '@wdio/tauri-service',
      {
        driverProvider: 'external',
        // 不自动 `cargo install`：缺失时由 scripts/e2e.mjs 预检并给出可执行的修复指引
        // （自动安装会静默拉网络、耗时长，且失败原因难读）。
        autoInstallTauriDriver: false,
        logLevel: 'warn',
      },
    ],
  ],

  logLevel: 'warn',
  bail: 0,
  baseUrl: 'http://localhost:4444',
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60_000,
  },

  reporters: ['spec'],
}
