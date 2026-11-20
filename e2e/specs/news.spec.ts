/**
 * News 桌面端 E2E —— 真实宿主里挂载真实 wasm app 后，脚本驱动界面做功能测试
 *
 * 跑法（应用仓根；`--isolate` 让源 / 抓取记录不写进真实用户数据目录）：
 *   WASMNEST_PLATFORM_ROOT=<含 /news 路由的平台树> \
 *     node scripts/e2e.mjs --app news --isolate --host-mode cargo
 * （packed 模式也可，但宿主产物需含 news 路由：`--host <宿主目录>`）
 *
 * 判据纪律（docs/E2E.md §6）：
 * - 不依赖机器状态：本机有没有历史条目、网络通不通都不该让用例变红。卡片流只断言
 *   「显性状态」（有列表 / 有空态），详情类用例按两分支写全。
 * - 文案断言跨语言：需要文案时取 i18n 取值域，不锁中文。
 * - 等状态不 sleep：一律等 `data-*` / `aria-*` 翻转。
 *
 * 真实网络抓取（刷新全部拿真实条目、跨源合并、授权源、AI 摘要）不在本套件内：
 * 它们依赖外网与凭据，按 `docs/verification/news.md` 的人工步骤验证。套件内的
 * 网络面只覆盖「失败可见性」——首屏补抓与手动重试引起的宿主授权询问一律拒绝，
 * 请求立即失败而不依赖外网（也顺带验证 net.denied / net.failed 的上屏路径）。
 */
import {
  attr,
  click,
  denyNetworkAuthIfPresent,
  denyNetworkAuthPrompt,
  exists,
  isDisabled,
  typeInto,
  value,
  visible,
  waitFor,
  waitForAttr,
  waitForEnabled,
  waitForHostReady,
  waitForText,
  waitGone,
} from '../harness/driver'
import { expectEqual } from '../harness/expect'
import { goHome } from '../harness/shell'
import {
  APP_NAME,
  addCircle,
  addRssSource,
  circleChip,
  closeSettings,
  ensureFeedView,
  firstItemTestId,
  hasText,
  isViewSelected,
  labelSet,
  openNews,
  openReaderSettings,
  openReaderSettingsFromFailure,
  openSelect,
  openSettings,
  openSettingsTab,
  pickSelectOption,
  readerEnabledState,
  readerSettingsWarningVisible,
  selectCircleChip,
  setReaderEnabled,
  SETTINGS_TABS,
  settingsPane,
  settingsTab,
  sourceError,
  sourceNames,
  switchView,
  VIEW_KEYS,
  viewTab,
  waitForFeedState,
  waitForItems,
  waitForSourceEnabled,
} from '../pages/news'

/** 每次运行用不同地址：非隔离模式下重复添加也不会被「URL 已存在」挡住 */
const RUN = Date.now()

/** 首屏归一：壳只 detach 不销毁实例，上一用例停在设置页 / 详情 / 非今日视图都会带回来 */
async function resetToFeed(): Promise<void> {
  // 上一用例若在授权窗前失败，弹窗是 Teleport 到 body 的独立层，会跨路由残留：先清掉
  await denyNetworkAuthIfPresent()
  await ensureFeedView()
  if (await exists('news-banner')) {
    await click('news-banner-dismiss')
    await waitGone('news-banner')
  }
}

/**
 * 等阅读失败态：有授权询问就拒绝，没有则等失败记录或请求返回
 *
 * 失败记录会保留 10 分钟，后续用例可能直接命中失败态而不弹窗；这里两种都收。
 */
async function settleReaderFailure(): Promise<void> {
  await browser.waitUntil(
    async () => {
      if (await denyNetworkAuthIfPresent()) return false
      return exists('news-reader-error')
    },
    { timeout: 60_000, interval: 200, timeoutMsg: '阅读失败态未出现' },
  )
}

describe('News（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await openNews()
    await resetToFeed()
  })

  it('主屏可进入：四分段与工具栏就位，默认落在今日', async () => {
    expectEqual(await visible('news-view'), true, '应用根可见')
    expectEqual(await visible('news-feed'), true, '卡片流可见')
    for (const key of VIEW_KEYS) {
      expectEqual(await exists(viewTab(key)), true, `分段 ${key} 在场`)
    }
    expectEqual(await isViewSelected('today'), true, '默认选中今日')
    expectEqual(await exists('news-refresh'), true, '刷新入口在场')
    expectEqual(await exists('news-mark-all-read'), true, '全部已读入口在场')
    expectEqual(await exists('news-open-settings'), true, '设置入口在场')
    expectEqual(await exists('news-error'), false, '首屏没有错误 banner')
  })

  it('三分区切换：aria-selected 翻转，实时顶部出源状态条', async () => {
    await switchView('circles')
    expectEqual(await isViewSelected('circles'), true, '圈子被选中')
    expectEqual(await isViewSelected('today'), false, '今日解除选中')
    expectEqual(await visible('news-chip-all'), true, '圈子筛选 chip 在场')

    await switchView('realtime')
    expectEqual(await isViewSelected('realtime'), true, '实时被选中')
    await waitFor('news-status')
    expectEqual(await visible('news-status'), true, '源状态条可见')

    await switchView('saved')
    expectEqual(await isViewSelected('saved'), true, '收藏被选中')
    // 收藏空态与列表都是显性状态，不允许「无解释空白」
    const state = await waitForFeedState()
    expectEqual(state === 'cards' || state === 'empty', true, `收藏视图有显性状态（实际 ${state}）`)

    await switchView('today')
    expectEqual(await isViewSelected('today'), true, '回到今日')
  })

  it('卡片流状态明确：空态入口直达设置；有条目时列表可见', async () => {
    const state = await waitForFeedState()
    if (state === 'empty') {
      expectEqual(await visible('news-empty'), true, '空态可见')
      await click('news-empty-add')
      await waitFor('news-page-settings')
      expectEqual(await visible('news-settings'), true, '空态入口打开设置页')
      await closeSettings()
    } else {
      expectEqual(await visible('news-cards'), true, '条目列表可见')
      expectEqual(await visible('news-empty'), false, '有条目时不显示空态')
    }
  })

  it('设置页：六个页签各自渲染对应面板，可关闭回到卡片流', async () => {
    await openSettings()
    expectEqual(await visible('news-settings'), true, '设置根可见')
    for (const key of SETTINGS_TABS) {
      expectEqual(await exists(settingsTab(key)), true, `页签 ${key} 在场`)
      await openSettingsTab(key)
      expectEqual(await visible(settingsPane(key)), true, `面板 ${key} 可见`)
    }
    await closeSettings()
    expectEqual(await visible('news-feed'), true, '关闭设置后回到卡片流')
  })

  it('源管理：新增 RSS 源 → 停用 → 启用 → 改权重；重复 URL 被表单拦下', async () => {
    await openSettings()
    await openSettingsTab('sources')

    const name = `E2E Feed ${RUN}`
    const url = `https://example.com/e2e-${RUN}.xml`
    const id = await addRssSource(name, url)
    expectEqual(await visible(`news-source-${id}`), true, '新源出现在列表')
    expectEqual(await attr(`news-source-${id}`, 'data-news-enabled'), 'true', '新源默认启用')

    await click(`news-source-toggle-${id}`)
    await waitForSourceEnabled(id, false)
    expectEqual(await attr(`news-source-${id}`, 'data-news-enabled'), 'false', '停用后状态位翻转')

    await click(`news-source-toggle-${id}`)
    await waitForSourceEnabled(id, true)
    expectEqual(await attr(`news-source-${id}`, 'data-news-enabled'), 'true', '再次启用后恢复')

    // 编辑权重：保存后列表行显示新权重（数值跨语言，断言可读）
    await click(`news-source-edit-${id}`)
    await waitFor('news-source-form')
    await typeInto('news-source-weight', '1.7')
    await click('news-source-save')
    await waitGone('news-source-form')
    await waitForText(`news-source-${id}`, '1.7')

    // 重复 URL：真正填同一个地址 + 不同名称提交，本地校验拦下且不落库
    await click('news-add-source')
    await waitFor('news-source-form')
    await typeInto('news-source-name', `${name} dup`)
    await openSelect('news-source-kind')
    await pickSelectOption(labelSet('news.settings.sources.kind.rss'))
    await typeInto('news-source-url', url)
    await click('news-source-save')
    await waitFor('news-source-form-error')
    expectEqual(await hasText('news-source-form-error'), true, '重复 URL 有可读报错')
    await click('news-source-cancel')
    await waitGone('news-source-form')
    const names = await sourceNames()
    expectEqual(
      names.filter((row) => row.includes(name)).length,
      1,
      '重复提交后列表里仍只有一条该源',
    )
    expectEqual(await visible(sourceError(id)), false, '重复提交没有改动已有源')
  })

  it('实验性源：选 x-graphql 出现凭据入口；保存凭据后列表显示掩码', async () => {
    await openSettings()
    await openSettingsTab('sources')

    await click('news-add-source')
    await waitFor('news-source-form')
    expectEqual(await exists('news-source-credential'), false, 'rss 源不需要凭据下拉')
    // 宿主共享 Select：选中实验性种类会触发 needsCredential
    await openSelect('news-source-kind')
    await pickSelectOption(labelSet('news.settings.sources.kind.x-graphql'))
    await waitFor('news-source-credential')
    await click('news-source-cancel')
    await waitGone('news-source-form')

    const label = `E2E Credential ${RUN}`
    await click('news-add-credential')
    await waitFor('news-credential-form')
    await browser.execute((text: string) => {
      const root = document.querySelector('[data-testid="news-credential-form"]')
      const labelInput = root?.querySelector(
        '[data-testid="news-credential-label"]',
      ) as HTMLInputElement | null
      const cookieInput = root?.querySelector(
        '[data-testid="news-credential-cookie"]',
      ) as HTMLInputElement | null
      if (!labelInput || !cookieInput) return
      labelInput.value = text
      labelInput.dispatchEvent(new Event('input', { bubbles: true }))
      cookieInput.value = 'e2e-cookie-not-a-real-secret'
      cookieInput.dispatchEvent(new Event('input', { bubbles: true }))
    }, label)
    await click('news-credential-save')
    await waitGone('news-credential-form')
    await waitFor('news-credential-list')
    expectEqual(
      await browser.execute(() => {
        const list = document.querySelector('[data-testid="news-credential-list"]')
        return (list?.textContent || '').includes('···')
      }),
      true,
      '凭据列表只显示掩码（含省略号），不回显明文',
    )
  })

  it('失败可见性：不可达源刷新失败 → 错误分类上屏，抓取记录落一行', async function () {
    this.timeout(120_000)
    await openSettings()
    await openSettingsTab('sources')

    const name = `E2E Broken ${RUN}`
    const id = await addRssSource(name, `https://news-e2e.invalid/feed-${RUN}.xml`)

    await click(`news-source-retry-${id}`)
    // 首次访问新 origin 会弹宿主网络授权窗；拒绝后宿主回 net.denied，界面照样要标红。
    // 没有弹窗（已授权 / 无头策略）时请求会自己失败，两条路径都必须落到错误分类上。
    await denyNetworkAuthPrompt(8_000)

    await waitFor(sourceError(id), 60_000)
    expectEqual(await hasText(sourceError(id)), true, '错误分类有可读文案')
    expectEqual(
      ['true', 'false'].includes((await attr(`news-source-${id}`, 'data-news-failing')) ?? ''),
      true,
      '失败状态位存在（一次失败不标红，状态位必须是显性值）',
    )

    await openSettingsTab('log')
    await waitFor('news-log-table')
    // 只断言「有行」不够：首屏补抓的失败也会落行。这里点名本次构造的源，
    // 证明失败记录确实对应这次重试（失败也记账，不静默）。
    expectEqual(
      await browser.execute((needle: string) => {
        const table = document.querySelector('[data-testid="news-log-table"]')
        return (table?.textContent || '').includes(needle)
      }, name),
      true,
      '抓取记录里有该源的失败行',
    )
  })

  it('AI 摘要默认关闭：开关未勾选、入口禁用、提示先开启', async () => {
    await openSettings()
    await openSettingsTab('ai')
    expectEqual(await attr('news-ai-enabled', 'checked'), null, 'AI 开关默认未勾选')
    expectEqual(await visible('news-ai-disabled'), true, '未开启提示可见')
    expectEqual(await isDisabled('news-ai-summarize'), true, '摘要入口禁用')
  })

  it('数据页：自启只读展示；导出 JSON 成功且不含凭据字段', async () => {
    await openSettings()
    await openSettingsTab('data')

    await waitFor('news-autostart')
    expectEqual(await hasText('news-autostart'), true, '自启状态有只读文案')

    await waitForEnabled('news-export')
    await click('news-export')
    await waitFor('news-export-json')
    const json = (await value('news-export-json')) ?? ''
    expectEqual(json.length > 0, true, '导出文本非空')
    const parsed = JSON.parse(json) as Record<string, unknown>
    expectEqual(
      Object.prototype.hasOwnProperty.call(parsed, 'credentials'),
      false,
      '导出不含凭据表',
    )
    expectEqual(json.includes('secret'), false, '导出不含 secret 字段')
  })

  it('news-reader-01 默认开启：设置开关为开，详情入口可见且仍从摘要态开始', async function () {
    this.timeout(120_000)
    await openReaderSettings()
    expectEqual(await visible('news-reader-settings'), true, '数据页有阅读区')
    expectEqual(await readerEnabledState(), true, '隔离环境下阅读默认开启')
    expectEqual(await readerSettingsWarningVisible(), false, '设置读取成功时无失败提示')
    expectEqual(await hasText('news-reader-usage'), true, '用量是显性状态')
    await closeSettings()

    const state = await waitForFeedState()
    if (state === 'empty') {
      expectEqual(await visible('news-empty'), true, '无条目时给出显式空态（入口链路未验）')
      return
    }
    await waitForItems(1)
    const itemTestId = await firstItemTestId()
    await click(itemTestId as string)
    await waitFor('news-detail')
    expectEqual(await exists('news-reader-open'), true, '默认开启后详情出现阅读入口')
    expectEqual(await exists('news-reader'), false, '入口可见但详情仍从摘要态开始')
    await click('news-detail-close')
    await waitGone('news-detail')
  })

  it('news-reader-02 显式关闭：入口消失，v1 操作保留，结束归位开启', async function () {
    this.timeout(120_000)
    await openReaderSettings()
    await setReaderEnabled(false)
    await closeSettings()

    const state = await waitForFeedState()
    if (state === 'empty') {
      expectEqual(await visible('news-empty'), true, '无条目时给出显式空态（关闭态入口未验）')
    } else {
      await waitForItems(1)
      const itemTestId = await firstItemTestId()
      await click(itemTestId as string)
      await waitFor('news-detail')
      expectEqual(await exists('news-reader-open'), false, '关闭后详情无阅读入口')
      expectEqual(await exists('news-copy'), true, '复制链接保留')
      expectEqual(await exists('news-favorite'), true, '收藏保留')
      expectEqual(await exists('news-toggle-read'), true, '已读保留')
      await click('news-detail-close')
      await waitGone('news-detail')
    }

    await openReaderSettings()
    await setReaderEnabled(true)
    await closeSettings()
  })

  it('news-reader-03 重新开启：入口出现，点击后同一抽屉出现阅读态容器', async function () {
    this.timeout(120_000)
    await openReaderSettings()
    await setReaderEnabled(true)
    await closeSettings()

    const state = await waitForFeedState()
    if (state === 'empty') {
      expectEqual(await visible('news-empty'), true, '无条目时给出显式空态（阅读态未验）')
      return
    }
    await waitForItems(1)
    const itemTestId = await firstItemTestId()
    await click(itemTestId as string)
    await waitFor('news-detail')
    expectEqual(await exists('news-reader-open'), true, '重新开启后入口出现')
    expectEqual(await exists('news-reader'), false, '点击前不自动进入阅读态')
    await click('news-reader-open')
    await waitFor('news-reader')
    await settleReaderFailure()
    await click('news-reader-back')
    await waitGone('news-reader')
    await click('news-detail-close')
    await waitGone('news-detail')
  })

  it('news-reader-04 拒绝授权：失败分类、重试、复制与去设置可见', async function () {
    this.timeout(150_000)
    await openReaderSettings()
    await setReaderEnabled(true)
    await closeSettings()

    const state = await waitForFeedState()
    if (state === 'empty') {
      expectEqual(await visible('news-empty'), true, '无条目时给出显式空态（授权失败态未验）')
      return
    }
    await waitForItems(1)
    const itemTestId = await firstItemTestId()
    await click(itemTestId as string)
    await waitFor('news-detail')
    await click('news-reader-open')
    await settleReaderFailure()
    // 失败记录会保留 10 分钟；重试强制绕过缓存，重新构造一次授权拒绝
    await click('news-reader-retry')
    await settleReaderFailure()
    expectEqual(await hasText('news-reader-error'), true, '失败态有分类文案')
    expectEqual(await exists('news-reader-retry'), true, '失败态有重试')
    expectEqual(await exists('news-reader-copy'), true, '失败态有复制链接')
    expectEqual(await exists('news-reader-open-settings'), true, '授权类失败有去设置')

    await openReaderSettingsFromFailure()
    expectEqual(await visible('news-page-settings'), true, '去设置打开同一壳层设置页')
    await closeSettings()
  })

  it('news-reader-05 返回摘要：阅读态退场，详情与选中条目不变', async function () {
    this.timeout(120_000)
    await openReaderSettings()
    await setReaderEnabled(true)
    await closeSettings()

    const state = await waitForFeedState()
    if (state === 'empty') {
      expectEqual(await visible('news-empty'), true, '无条目时给出显式空态（返回摘要未验）')
      return
    }
    await waitForItems(1)
    const itemTestId = await firstItemTestId()
    await click(itemTestId as string)
    await waitFor('news-detail')
    await click('news-reader-open')
    await waitFor('news-reader')
    await settleReaderFailure()
    await click('news-reader-back')
    await waitGone('news-reader')
    expectEqual(await visible('news-detail'), true, '返回后详情抽屉仍在')
    expectEqual(await visible('news-copy'), true, '返回后摘要态操作可用')
    await click('news-detail-close')
    await waitGone('news-detail')
  })

  it('news-reader-06 清除阅读缓存：空缓存也有显性反馈且用量仍显示', async function () {
    this.timeout(120_000)
    await openReaderSettings()
    expectEqual(await hasText('news-reader-usage'), true, '用量是显性状态')
    await click('news-reader-clear-cache')
    await waitFor('news-reader-clear-confirm')
    await click('news-reader-clear-confirm-yes')
    await waitFor('news-toast')
    expectEqual(await hasText('news-toast'), true, '清除缓存有结果提示')
    expectEqual(await hasText('news-reader-usage'), true, '清理后用量仍显示')
    await waitGone('news-toast', 8_000)
    await closeSettings()
  })

  it('圈子：新建后出现在列表，圈子视图出现同名筛选 chip 且可选中', async () => {
    await openSettings()
    await openSettingsTab('circles')
    const name = `E2E Circle ${RUN}`
    const id = await addCircle(name, 1.5)
    expectEqual(await visible(`news-circle-row-${id}`), true, '圈子行可见')

    await closeSettings()
    await switchView('circles')
    await waitFor(circleChip(id))
    await selectCircleChip(id)
    expectEqual(await attr(circleChip(id), 'aria-selected'), 'true', '圈子 chip 选中态翻转')
    const state = await waitForFeedState()
    expectEqual(
      state === 'cards' || state === 'empty',
      true,
      `圈子过滤后有显性状态（实际 ${state}）`,
    )
  })

  it('条目详情（两分支）：有条目时已读 / 收藏 / 复制 / 助手入口都给显性反馈', async () => {
    const state = await waitForFeedState()
    if (state === 'empty') {
      // 空库（--isolate 或首次运行且未抓取）：详情交互无入口，断言空态自身可解释，
      // 详情链路按 docs/verification/news.md 的人工步骤验证。
      expectEqual(await visible('news-empty'), true, '无条目时给出空态与添加源入口')
      expectEqual(await visible('news-empty-add'), true, '空态带「去添加源」入口')
      return
    }

    await waitForItems(1)
    const itemTestId = await firstItemTestId()
    expectEqual(typeof itemTestId, 'string', '找到首个条目卡片')
    await click(itemTestId as string)
    await waitFor('news-detail')

    await waitForAttr('news-toggle-read', 'aria-pressed', 'true', 10_000)
    expectEqual(await attr('news-toggle-read', 'aria-pressed'), 'true', '打开条目即已读')

    const before = await attr('news-favorite', 'aria-pressed')
    await click('news-favorite')
    await waitForAttr('news-favorite', 'aria-pressed', before === 'true' ? 'false' : 'true')
    expectEqual(
      await attr('news-favorite', 'aria-pressed'),
      before === 'true' ? 'false' : 'true',
      '收藏状态位翻转',
    )

    await click('news-copy')
    // 成功走 toast，失败给可选中文本浮层——两条都是显性反馈，不能静默
    await browser.waitUntil(
      async () => (await visible('news-toast')) || (await visible('news-copy-fallback')),
      { timeout: 10_000, interval: 120, timeoutMsg: '复制后既没有 toast 也没有回退浮层' },
    )
    if (await visible('news-copy-fallback')) {
      await click('news-copy-fallback-close')
      await waitGone('news-copy-fallback')
    }
    // 复制提示会自己消失；等它退场，助手入口的提示才是本条动作的反馈
    await waitGone('news-toast', 8_000)

    await click('news-assistant-fetch')
    await waitFor('news-toast')
    expectEqual(await hasText('news-toast'), true, '助手代抓给出显性不可用提示')

    await click('news-detail-close')
    await waitGone('news-detail')
    expectEqual(await visible('news-feed'), true, '关闭详情后回到卡片流')
  })

  it('主屏应用卡指向本应用：应用名与 plugin.json 一致', async () => {
    await goHome()
    const cards = await browser.execute(() => {
      const grid = document.querySelector('[role="list"]')
      if (!grid) return []
      return Array.from(grid.querySelectorAll('[role="listitem"]')).map((el) => {
        const label = el.getAttribute('aria-label') || ''
        return (el.querySelector('.nm')?.textContent || label.split('，')[0] || '').trim()
      })
    })
    expectEqual((cards as string[]).includes(APP_NAME), true, `主屏有应用卡「${APP_NAME}」`)
    await openNews()
    await waitFor('news-view')
  })
})
