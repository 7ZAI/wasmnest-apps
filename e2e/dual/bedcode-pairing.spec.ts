/**
 * 双端 E2E（垂直切片）：真桌面宿主 ↔ 真机配对闭环
 *
 * ## 为什么先做配对
 *
 * 配对是**唯一一条必须双端 UI 同时在场**才能走通的链路：
 * 手机手动填地址 → 桌面后端生成 6 位码 → 桌面界面展示 → 手机输入 → 双端各自进入
 * 「已连接 / 已配对」。它同时覆盖了三件最容易坏的事：
 *
 * 1. 真机经 `adb reverse` 打到桌面宿主（不是 mock 服务器）；
 * 2. 桌面事件通道（`pairing-code-generated`）→ 界面展示；
 * 3. 手机把码提交回桌面 → 设备落库（桌面设备列表出现一行）。
 *
 * ## 为什么不用扫码
 *
 * 扫码需要相机对着桌面屏幕，CI / 无人值守环境不可控（相册导入也要点系统 UI）。
 * 手动地址 + 配对码是产品里**已有的**兜底路径，用它做回归不改变产品行为。
 *
 * ## 判据纪律
 *
 * - 断言**状态位**：手机 `data-connected="true"`、桌面配对码消失、设备列表行数 ≥ 1；
 * - 不断言文案（设备语言可能是 zh-CN / en），不 sleep 赌时序；
 * - 失败时落截图 + logcat（现场可查，不靠复现）。
 */

import { click, count, text, waitFor, waitForHostReady, waitGone } from '../harness/driver'
import { expectEqual } from '../harness/expect'
import { goHome, openApp } from '../harness/shell'
import { MobileApp } from '../harness/mobile'

/** 应用显示名（= bedcode 双端 `plugin.json` 的 name） */
const APP_NAME = 'BedCode'

/** 桌面服务器地址（编排器经 adb reverse 把设备侧 127.0.0.1 打到宿主） */
const SERVER = process.env.WASMNEST_E2E_SERVER ?? '127.0.0.1:8765'

/** 失败现场目录（编排器传入；缺省落 e2e/artifacts） */
const ARTIFACTS = process.env.WASMNEST_E2E_ARTIFACTS

let mobile: MobileApp | null = null

/** 已初始化的移动端句柄（before 未跑完就进用例属于编排错误，直接失败） */
function phone(): MobileApp {
  if (!mobile) throw new Error('移动端句柄未初始化：before 钩子未完成')
  return mobile
}

describe('双端配对（真桌面宿主 + 真机）', () => {
  before(async () => {
    // ==================== 桌面：打开 BedCode 的设备配对页 ====================
    await waitForHostReady()
    await goHome()
    await openApp(APP_NAME)
    await waitFor('bedcode-root')
    await click('nav-pairing')
    await waitFor('pairing-view')

    // ==================== 移动端：冷启动 → 打开 BedCode ====================
    // 安装 / 清数据由编排器完成（安装耗时超出 mocha 单测预算）；
    // 这里只负责启动 + 连 CDP + 从壳主屏进入应用。
    mobile = await MobileApp.launch({
      apkPath: process.env.WASMNEST_E2E_APK || undefined,
      install: process.env.WASMNEST_E2E_INSTALL === '1',
      clearData: false,
      artifactsDir: ARTIFACTS,
      stopOnClose: false,
    })
    // 首次启动（尤其 `pm clear` 之后）要重新抽取插件资源 + 编译 wasm，慢设备可达 1-2 分钟
    await mobile.waitForAriaLabelPrefix(APP_NAME, 120_000)
    await mobile.tapByAriaLabelPrefix(APP_NAME)
    await mobile.waitFor('[data-testid="mobile-bedcode-root"]', 120_000)
    await mobile.waitFor('[data-testid="mobile-manual-connect"]', 60_000)
  })

  after(async () => {
    await mobile?.close()
    mobile = null
  })

  it('移动端手动连接 → 桌面展示配对码 → 手机输入 → 双端进入已连接', async () => {
    try {
      // ==================== 1. 手机发起连接（手动地址，绕开扫码） ====================
      await phone().tap('[data-testid="mobile-manual-connect"]')
      await phone().waitFor('[data-testid="mobile-manual-sheet"]')
      await phone().type('[data-testid="mobile-manual-input"]', SERVER)
      // 输入后 Vue 的 v-model 是异步刷新的：等按钮解除禁用再点，别赌微任务时序
      await waitForEnabled('[data-testid="mobile-manual-confirm"]')
      await phone().tap('[data-testid="mobile-manual-confirm"]')

      // ==================== 2. 桌面展示后端生成的 6 位配对码 ====================
      // 期望来自后端事件 `pairing-code-generated`（移动端请求配对时触发），不是脚本生成。
      await waitFor('pairing-code', 30_000)
      const code = (await text('pairing-code'))?.trim() ?? ''
      expectEqual(/^\d{6}$/.test(code), true, `桌面配对码应为 6 位数字，实际=${JSON.stringify(code)}`)

      // ==================== 3. 手机输入配对码并提交 ====================
      await phone().waitFor('[data-testid="mobile-pairing-dialog"]', 30_000)
      // 默认走 CDP 触摸（坐标由页面算，设备无关）；`WASMNEST_E2E_ADB_TAP=1` 时
      // 第一位改用 `adb shell input tap`（系统 InputManager 路径），并用码格回读校验生效。
      const useAdbTap = process.env.WASMNEST_E2E_ADB_TAP === '1'
      for (const [index, digit] of [...code].entries()) {
        const key = `[data-testid="mobile-pairing-key-${digit}"]`
        if (useAdbTap && index === 0) {
          await phone().tapViaAdb(key, {
            verify: async () => (await phone().text('[data-testid="mobile-pairing-cell-1"]')) === digit,
          })
        } else {
          await phone().tap(key)
        }
      }
      await waitForEnabled('[data-testid="mobile-pairing-submit"]')
      await phone().tap('[data-testid="mobile-pairing-submit"]')

      // ==================== 4. 双端判据 ====================
      // 手机：连接状态置位（语义属性，不依赖 zh-CN / en 文案）
      await phone().waitForAttr('[data-testid="mobile-connection-status"]', 'data-connected', 'true', 30_000)
      // 桌面：配对码被消费（`device:connected` → clearCode），不是过期（TTL 60s，本用例秒级）
      await waitGone('pairing-code', 30_000)

      // 桌面：设备列表出现一行（配对记录真的落库，不是只清了个内存变量）
      await click('pairing-tab-devices')
      await waitFor('paired-device-row', 20_000)
      expectEqual((await count('paired-device-row')) >= 1, true, '桌面设备列表至少有一行已配对设备')
    } catch (error) {
      // 现场采集本身失败（设备掉线等）不能盖住原始失败原因
      try {
        const shot = await phone().screenshot('bedcode-pairing-failure.png')
        const log = await phone().dumpLogcat('bedcode-pairing-failure.log')
        console.error(`[dual] 失败现场已保存：${shot} / ${log}`)
      } catch (artifactError) {
        console.error(`[dual] 失败现场采集失败：${artifactError}`)
      }
      throw error
    }
  })
})

/**
 * 等按钮解除禁用
 *
 * Vue 的 `:disabled` 会同时设置 DOM 属性；这里等属性消失而不是读按钮文案
 * （文案随语言变，属性是产品状态）。
 */
async function waitForEnabled(selector: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    // 元素还没挂上时 attr 返回 null，不能当成「已解除禁用」
    if (await phone().exists(selector)) {
      const disabled = await phone().attr(selector, 'disabled')
      if (disabled === null) return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`按钮在 ${timeout}ms 内未出现或仍处于禁用态：${selector}`)
}
