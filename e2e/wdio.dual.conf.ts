/**
 * 双端 E2E 配置（桌面 WebDriver 通道不变，另加真机 CDP 通道）
 *
 * 与 `wdio.conf.ts` 的唯一差异是 spec 集合与超时预算：
 *
 * - spec 只跑 `e2e/dual/**`（桌面单端用例不受影响，仍由 `scripts/e2e.mjs` 驱动）；
 * - 真机冷启动 + wasm 编译 + USB 传输比桌面慢一个量级，单条用例给 180s；
 * - 仍由 `scripts/e2e-dual.mjs` 预检宿主二进制 / 驱动 / adb / 设备，本文件不重复预检。
 *
 * 为什么桌面通道直接复用 `wdio.conf.ts`：双端用例里桌面侧仍然是「真实宿主 + 真实
 * wasm app + 脚本点击」，与单端 E2E 同一条驱动链；另起一套 WebDriver 客户端只会
 * 让两条链的宿主启动参数漂移。
 */

import { resolve } from 'node:path'
import type { Options } from '@wdio/types'

import { config as base } from './wdio.conf'

const HERE = resolve(process.cwd())

export const config: Options.Testrunner = {
  ...base,
  specs: [resolve(HERE, 'e2e', 'dual', '**', '*.spec.ts')],
  maxInstances: 1,
  mochaOpts: {
    ui: 'bdd',
    // 真机冷启动（清数据后要重抽插件 + 编译 wasm）+ 6 次触摸往返 + 双端等待；
    // 单条用例预算要覆盖 before 钩子里的两段冷启动等待，失败时也要留出截图时间
    timeout: 300_000,
  },
}
