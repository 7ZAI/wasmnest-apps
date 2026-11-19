/**
 * 真机单端 E2E —— News（移动宿主运行面）
 *
 * 跑法（应用仓根；需 debug APK + 真机，见 docs/E2E.md §11）：
 *   node scripts/e2e-mobile.mjs --app news
 *
 * 覆盖的是「移动运行面」这一层：全屏单页、底部分段、宿主二级页设置与系统返回逐级、
 * 详情浮层返回、下拉刷新手势、窄屏无横向溢出。真实抓取 / 授权询问分支 / 剪贴板
 * 回退属于真实网络与系统行为，按 `docs/verification/news.md` 的 F-09 / F-15 人工验证。
 *
 * 判据纪律（docs/E2E.md §11.4）：只断言状态位（`aria-current` / `aria-pressed` /
 * `disabled` / `data-*`），不断言文案（设备语言可能是 zh-CN / en）；等状态不 sleep。
 */
import { expectEqual } from '../harness/expect-node'
import { MobileApp } from '../harness/mobile'

/** 应用显示名（= news 双端 plugin.json 的 name；壳应用卡的 aria-label 前缀） */
const APP_NAME = 'News'

/** 失败现场目录（编排器传入；缺省落 e2e/artifacts） */
const ARTIFACTS = process.env.WASMNEST_E2E_ARTIFACTS

const ROOT = '[data-testid="mobile-news-root"]'
const FEED = '[data-testid="mobile-news-feed"]'
const SETTINGS_PAGE = '[data-testid="mobile-news-settings-page"]'
const EMPTY = '[data-testid="mobile-news-empty"]'

const tab = (key: string): string => `[data-testid="mobile-news-tab-${key}"]`
const settingsTab = (key: string): string => `[data-testid="mobile-news-settings-tab-${key}"]`

let mobile: MobileApp | null = null

/** 已初始化的移动端句柄（before 未跑完就进用例属于编排错误，直接失败） */
function phone(): MobileApp {
  if (!mobile) throw new Error('移动端句柄未初始化：before 钩子未完成')
  return mobile
}

/** 当前是否有条目卡（`data-testid` 带条目 id，只能按前缀数） */
function cardCount(): Promise<number> {
  return phone().count('[data-testid^="mobile-news-item-"]')
}

/** 打开设置二级页（宿主路由），等设置页可见 */
async function openSettingsPage(): Promise<void> {
  await phone().tap('[data-testid="mobile-news-settings"]')
  await phone().waitFor(SETTINGS_PAGE, 30_000)
}

/** 系统返回键离开设置页，等回到应用运行面 */
async function backToSurface(): Promise<void> {
  await phone().pressBack()
  await phone().waitGone(SETTINGS_PAGE, 30_000)
  await phone().waitFor(ROOT, 30_000)
}

describe('News（真机 · 移动宿主运行面）', () => {
  before(async function () {
    this.timeout(300_000)
    mobile = await MobileApp.launch({
      apkPath: process.env.WASMNEST_E2E_APK || undefined,
      install: process.env.WASMNEST_E2E_INSTALL === '1',
      clearData: false,
      artifactsDir: ARTIFACTS,
      stopOnClose: false,
    })
    // 首次启动（尤其 pm clear 后）要抽取插件资源 + 编译 wasm，慢设备可达 1-2 分钟
    await mobile.waitForAriaLabelPrefix(APP_NAME, 180_000)
    await mobile.tapByAriaLabelPrefix(APP_NAME)
    await mobile.waitFor(ROOT, 120_000)
  })

  after(async () => {
    await mobile?.close()
    mobile = null
  })

  afterEach(async function () {
    if (this.currentTest?.state !== 'failed') return
    try {
      const shot = await phone().screenshot('news-failure.png')
      const log = await phone().dumpLogcat('news-failure.log')
      console.error(`[mobile] 失败现场已保存：${shot} / ${log}`)
    } catch (artifactError) {
      console.error(`[mobile] 失败现场采集失败：${artifactError}`)
    }
  })

  it('应用在真宿主里挂载：全屏运行面与四段底栏就位', async function () {
    this.timeout(120_000)
    expectEqual(await phone().visible(ROOT), true, '运行面可见')
    expectEqual(await phone().visible(FEED), true, '卡片流容器可见')
    for (const key of ['today', 'circles', 'realtime', 'saved']) {
      expectEqual(await phone().visible(tab(key)), true, `底栏分段 ${key} 可见`)
    }
    expectEqual(await phone().attr(tab('today'), 'aria-current'), 'page', '默认落在今日')
    expectEqual(await phone().visible('[data-testid="mobile-news-settings"]'), true, '设置入口可见')
  })

  it('底部分段切换：aria-current 随点击推进，实时视图出源状态条', async function () {
    this.timeout(120_000)
    await phone().tap(tab('realtime'))
    await phone().waitForAttr(tab('realtime'), 'aria-current', 'page', 15_000)
    expectEqual(await phone().attr(tab('today'), 'aria-current'), null, '切走后今日解除选中')
    await phone().waitFor('[data-testid="mobile-news-status"]', 30_000)
    expectEqual(
      await phone().visible('[data-testid="mobile-news-status"]'),
      true,
      '实时源状态条可见',
    )

    await phone().tap(tab('circles'))
    await phone().waitForAttr(tab('circles'), 'aria-current', 'page', 15_000)
    expectEqual(
      await phone().visible('[data-testid="mobile-news-circle-chips"]'),
      true,
      '圈子筛选 chip 可见',
    )

    await phone().tap(tab('saved'))
    await phone().waitForAttr(tab('saved'), 'aria-current', 'page', 15_000)
    // 收藏视图要么有卡片，要么是显性空态；不允许「无解释空白」
    const hasCards = (await cardCount()) > 0
    const hasEmpty = await phone().visible(EMPTY)
    expectEqual(hasCards || hasEmpty, true, '收藏视图有显性状态（卡片或空态）')

    await phone().tap(tab('today'))
    await phone().waitForAttr(tab('today'), 'aria-current', 'page', 15_000)
  })

  it('设置二级页：宿主路由进入，系统返回回到运行面（不直接退出应用）', async function () {
    this.timeout(120_000)
    await openSettingsPage()
    expectEqual(await phone().visible(SETTINGS_PAGE), true, '设置页可见')
    for (const key of ['sources', 'circles', 'ai', 'log', 'data']) {
      expectEqual(await phone().exists(settingsTab(key)), true, `设置页签 ${key} 在场`)
    }
    // 切到「关于」页签不改变路由；返回键仍应回到运行面
    await phone().tap(settingsTab('about'))
    await phone().waitForAttr(settingsTab('about'), 'aria-selected', 'true', 15_000)

    await backToSurface()
    expectEqual(await phone().visible(ROOT), true, '返回后仍在 News 运行面（未退出应用）')
    expectEqual(await phone().visible(SETTINGS_PAGE), false, '设置页已退场')
  })

  it('条目详情（两分支）：有卡片时打开 → 收藏状态位翻转 → 返回收详情', async function () {
    this.timeout(180_000)
    if ((await cardCount()) === 0) {
      // 空库（未抓取）：详情无入口，断言空态自带「去添加源」并可进设置
      await phone().waitFor(EMPTY, 30_000)
      expectEqual(await phone().visible(EMPTY), true, '无条目时显示空态')
      await phone().waitFor('[data-testid="mobile-news-empty-add"]', 30_000)
      await phone().tap('[data-testid="mobile-news-empty-add"]')
      await phone().waitFor(SETTINGS_PAGE, 30_000)
      expectEqual(await phone().visible(SETTINGS_PAGE), true, '空态入口可进设置页')
      await backToSurface()
      return
    }

    const first = await phone().eval<string | null>(
      `document.querySelector('[data-testid^="mobile-news-item-"]')?.getAttribute('data-testid') ?? null`,
    )
    expectEqual(typeof first, 'string', '找到首个条目卡片')
    await phone().tap(`[data-testid="${first}"]`)
    await phone().waitFor('[data-testid="mobile-news-detail"]', 30_000)

    const before = await phone().attr('[data-testid="mobile-news-favorite"]', 'aria-pressed')
    await phone().tap('[data-testid="mobile-news-favorite"]')
    await phone().waitForAttr(
      '[data-testid="mobile-news-favorite"]',
      'aria-pressed',
      before === 'true' ? 'false' : 'true',
      15_000,
    )

    await phone().tap('[data-testid="mobile-news-copy"]')
    // 复制成功给 toast，失败给可选中文本浮层——两条都是显性反馈
    await phone()
      .waitFor('[data-testid="mobile-news-toast"]', 15_000)
      .catch(async () => {
        await phone().waitFor('[data-testid="mobile-news-copy-fallback"]', 15_000)
      })

    // 系统返回键由应用 onBackPressed 消费：先收详情，不退出应用
    await phone().pressBack()
    await phone().waitGone('[data-testid="mobile-news-detail"]', 30_000)
    expectEqual(await phone().visible(ROOT), true, '收详情后仍在运行面')
  })

  it('下拉刷新手势：指示条出现并触发一次刷新（有显性结果反馈）', async function () {
    this.timeout(180_000)
    await phone().tap(tab('today'))
    await phone().waitForAttr(tab('today'), 'aria-current', 'page', 15_000)

    await phone().swipeDown(FEED, 140)

    // 刷新结果只有三种诚实形态：成功 toast、失败 banner、加载错误；三者任一都算有反馈
    const hasToast = () => phone().visible('[data-testid="mobile-news-toast"]')
    const hasBanner = () => phone().visible('[data-testid="mobile-news-banner"]')
    const hasError = () => phone().visible('[data-testid="mobile-news-error"]')
    const deadline = Date.now() + 120_000
    let feedback = false
    while (Date.now() < deadline) {
      if ((await hasToast()) || (await hasBanner()) || (await hasError())) {
        feedback = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    expectEqual(feedback, true, '下拉刷新后有显性反馈（toast / banner / error）')
    expectEqual(await phone().visible(ROOT), true, '刷新期间运行面未崩溃')
  })

  it('窄屏不横向溢出：页面宽度不超视口（标题 / 来源 / 时间不撑破布局）', async function () {
    this.timeout(120_000)
    const overflow = await phone().eval<number>(
      `Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth`,
    )
    expectEqual(overflow <= 1, true, `页面无横向溢出（超出 ${overflow}px）`)
  })
})
