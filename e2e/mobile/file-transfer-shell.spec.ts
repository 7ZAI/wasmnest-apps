/**
 * 真机单端 E2E —— File Transfer（移动宿主运行面）
 *
 * 跑法（应用仓根）：
 *   node scripts/e2e-mobile.mjs --app file-transfer
 *
 * ## 这条 lane 补的是哪个盲区
 *
 * 移动端应用此前只有两条验证面：vitest 单测（逻辑）与 SDK dev-shell（界面）。
 * dev-shell 是**壳的 mock 形态**：后端通道全是浏览器实现（`mock-context.ts`：
 * 权限全放行、WASM 不跑、命令只跑前端 handler）。于是「应用在**真宿主**里能不能跑起来」
 * ——真 wasm 组件装载、真权限门、真宿主路由——没有任何自动化覆盖，只能靠人肉在真机上看。
 *
 * 本 lane 就是那条缺口：真机 + 真宿主（APK 内置）+ 真 wasm + 真壳路由，
 * 只驱动手机这一端（不需要桌面宿主在场）。
 *
 * ## 为什么这些断言有牙（不是「界面能开」的空断言）
 *
 * file-transfer 移动端的 `devMock.ts` 给 dev-shell 播了**已连接的活跃对端**
 * （「小米 14 Pro」connected + active）。真宿主**忽略 devMock**（真实宿主不消费该导出），
 * 所以真机上必然「无对端」。于是：
 *
 * - `mobile-ft-peer-status[data-online="false"]` —— 真机为 false、mock 为 true；
 * - 上传入口 `disabled` —— 真机为禁用、mock 为可用。
 *
 * 这两条断言一旦为真，就同时证明了「跑的是真宿主真 wasm，不是 mock 壳」。
 *
 * ## 判据纪律（与 `docs/E2E.md` §6 / §10.4 同口径）
 *
 * - 只断言状态位（`aria-pressed` / `data-online` / `disabled`），不断言文案（设备语言可能是 zh-CN / en）；
 * - 等状态，不 sleep；
 * - 失败时落截图 + logcat（现场可查，不靠复现）。
 */

import { expectEqual } from '../harness/expect-node'
import { MobileApp } from '../harness/mobile'

/** 应用显示名（= file-transfer 双端 `plugin.json` 的 name；壳应用卡的 aria-label 前缀） */
const APP_NAME = 'File Transfer'

/** 失败现场目录（编排器传入；缺省落 e2e/artifacts） */
const ARTIFACTS = process.env.WASMNEST_E2E_ARTIFACTS

let mobile: MobileApp | null = null

/** 已初始化的移动端句柄（before 未跑完就进用例属于编排错误，直接失败） */
function phone(): MobileApp {
  if (!mobile) throw new Error('移动端句柄未初始化：before 钩子未完成')
  return mobile
}

describe('File Transfer（真机 · 移动宿主运行面）', () => {
  before(async function () {
    this.timeout(300_000)
    // 安装 / 清数据由编排器完成（adb install 在慢设备上可达数分钟，超出单条用例预算）；
    // 这里只负责启动 + 连 CDP + 从壳主屏进入应用。
    mobile = await MobileApp.launch({
      apkPath: process.env.WASMNEST_E2E_APK || undefined,
      install: process.env.WASMNEST_E2E_INSTALL === '1',
      clearData: false,
      artifactsDir: ARTIFACTS,
      stopOnClose: false,
    })
    // 首次启动（尤其 `pm clear` 之后）要重新抽取插件资源 + 编译 wasm，慢设备可达 1-2 分钟
    await mobile.waitForAriaLabelPrefix(APP_NAME, 180_000)
    await mobile.tapByAriaLabelPrefix(APP_NAME)
    await mobile.waitFor('[data-testid="mobile-ft-root"]', 120_000)
  })

  after(async () => {
    await mobile?.close()
    mobile = null
  })

  afterEach(async function () {
    // 失败现场（截图 + logcat）：真机上的失败现场不靠复现，靠留证
    if (this.currentTest?.state !== 'failed') return
    try {
      const shot = await phone().screenshot('file-transfer-failure.png')
      const log = await phone().dumpLogcat('file-transfer-failure.log')
      console.error(`[mobile] 失败现场已保存：${shot} / ${log}`)
    } catch (artifactError) {
      console.error(`[mobile] 失败现场采集失败：${artifactError}`)
    }
  })

  it('应用在真宿主里挂载成功：运行面与主分段就位', async function () {
    this.timeout(60_000)
    expectEqual(
      await phone().visible('[data-testid="mobile-ft-root"]'),
      true,
      '文件传输运行面可见',
    )
    for (const key of ['transfers', 'browse', 'devices']) {
      expectEqual(
        await phone().visible(`[data-testid="mobile-ft-tab-${key}"]`),
        true,
        `主分段 ${key} 可见`,
      )
    }
  })

  it('主分段可切换：状态位随点击推进（aria-pressed）', async function () {
    this.timeout(60_000)
    const tab = (key: string) => `[data-testid="mobile-ft-tab-${key}"]`

    // 默认落在传输页（应用的第一目标）
    expectEqual(await phone().attr(tab('transfers'), 'aria-pressed'), 'true', '默认选中传输分段')
    expectEqual(await phone().attr(tab('browse'), 'aria-pressed'), 'false', '默认未选中浏览分段')

    await phone().tap(tab('browse'))
    await phone().waitForAttr(tab('browse'), 'aria-pressed', 'true', 15_000)
    expectEqual(await phone().attr(tab('transfers'), 'aria-pressed'), 'false', '切到浏览后传输分段解除')

    await phone().tap(tab('devices'))
    await phone().waitForAttr(tab('devices'), 'aria-pressed', 'true', 15_000)
    expectEqual(await phone().attr(tab('browse'), 'aria-pressed'), 'false', '切到设备后浏览分段解除')
  })

  it('无对端时上传入口禁用（真实 wasm 的对端判定生效，非 mock 壳）', async function () {
    this.timeout(60_000)
    // 真宿主忽略 devMock 的「已连接活跃对端」种子 → 必然离线；
    // dev-shell 会显示在线（小米 14 Pro）→ 这条断言对 mock 壳是红的。
    await phone().waitForAttr('[data-testid="mobile-ft-peer-status"]', 'data-online', 'false', 30_000)

    const uploadDisabled = await phone().eval<boolean | null>(`(() => {
      const el = document.querySelector('[data-testid="mobile-ft-upload"]')
      return el ? el.disabled === true : null
    })()`)
    expectEqual(uploadDisabled, true, '无对端时上传按钮禁用')
  })

  it('设置二级页可达：宿主路由跳转到插件设置页', async function () {
    this.timeout(60_000)
    await phone().tap('[data-testid="mobile-ft-settings"]')
    await phone().waitFor('[data-testid="mobile-ft-settings-page"]', 30_000)
    expectEqual(
      await phone().visible('[data-testid="mobile-ft-settings-page"]'),
      true,
      '设置页可见（宿主路由跳转成功）',
    )
  })
})
