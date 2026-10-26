/**
 * Agent Hub 桌面端 E2E —— 真实宿主里挂载真实 wasm app 后，脚本驱动界面做功能测试
 *
 * 跑法（应用仓根）：
 *   node scripts/e2e.mjs --app agent-hub
 *
 * 覆盖的是**用户可感知的交互契约**：应用能挂载、分区能切、各分区的开合动作能用。
 * 断言一律落在「用户看得见的文字 / 控件状态」上，不碰实现细节。
 *
 * 判据纪律（这三条是本文件能长期不脆的关键）：
 * 1. **不依赖机器状态**（本机装没装 claude / 有没有会话日志 / 网络通不通）：断言只取
 *    「取值域」与「交互前后状态翻转」，不取具体业务值；
 * 2. **文案断言跨语言**：宿主语言随用户设置变，期望值取 app i18n 各语言取值域的并集
 *    （见 `pages/agentHub.ts` 的 `labelSet`），不写死中文；
 * 3. **等状态不 sleep**：一律等「目标状态出现 / 消失」，不用固定 sleep 赌时序。
 */

import {
  attr,
  click,
  exists,
  isDisabled,
  setValue,
  text,
  value,
  visible,
  waitFor,
  waitForAttr,
  waitForDisabled,
  waitForEnabled,
  waitForHostReady,
  waitGone,
} from '../harness/driver'
import { expectEqual, expectInSet } from '../harness/expect'
import { goHome, homeAppCards, openApp } from '../harness/shell'
import {
  HUB_CLI_NAMES,
  HUB_CLIS,
  HUB_TABS,
  labelSet,
  openTab,
  selectedTab,
  type HubCli,
  type HubTab,
} from '../pages/agentHub'

/** 应用显示名（= agent-hub 的 plugin.json `name`） */
const APP_NAME = 'Agent Hub'

describe('Agent Hub（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    // 每条用例从「主屏 → 点应用卡」重新进入 app：挂载实例与面板状态都归零，
    // 用例之间不互相污染（分区展开 / 表单打开这类状态必须隔离）。
    await goHome()
    await openApp(APP_NAME)
    await waitFor('hub-view')
    // 壳回主屏只 detach 不销毁实例：上一用例停在别的分区会随实例带回来。
    // 每条用例统一回到概览，后续断言不依赖执行顺序。
    await openTab('overview')
  })

  it('主屏可见 Agent Hub 应用卡，点卡后应用挂载并落地概览分区', async () => {
    await goHome()
    const cards = await homeAppCards()
    const card = cards.find((c) => c.name === APP_NAME)
    expectEqual(card !== undefined, true, '主屏存在 Agent Hub 应用卡')

    await openApp(APP_NAME)
    await waitFor('hub-view')
    expectEqual(await visible('panel-overview'), true, '概览分区可见')
    expectEqual(await visible('hub-tabs'), true, '分区标签栏可见')
  })

  it('分区标签栏渲染六个分区，默认选中概览', async () => {
    expectEqual(await visible('hub-tabs'), true, '分区标签栏可见')
    for (const tab of HUB_TABS) {
      expectEqual(await visible(`hub-tab-${tab}`), true, `分区标签 ${tab} 可见`)
    }
    expectEqual(await selectedTab(), 'hub-tab-overview', '默认选中分区')
    expectEqual(await visible('panel-overview'), true, '概览面板可见')
  })

  it('逐个切换分区：目标面板可见、前一面板退场、选中态跟随', async () => {
    let previous: HubTab | null = null
    for (const tab of HUB_TABS) {
      await openTab(tab)
      expectEqual(await visible(`panel-${tab}`), true, `分区 ${tab} 面板可见`)
      expectEqual(await selectedTab(), `hub-tab-${tab}`, `分区 ${tab} 选中态`)
      if (previous) {
        // 退场是过渡动画：旧面板在动画结束前仍在 DOM 里（且仍有布局盒 → 可见）。
        // 必须等它**被移除**，不能只看「切换后立刻是不是还可见」。
        await waitGone(`panel-${previous}`)
        expectEqual(await visible(`panel-${previous}`), false, `前一分区 ${previous} 已退场`)
      }
      previous = tab
    }
  })

  it('概览：四张 CLI 卡片渲染，状态徽章落在已知取值域内', async () => {
    expectEqual(await visible('overview-clis'), true, 'CLI 卡片区可见')
    const badgeDomain = [
      ...labelSet('hub.card.installed'),
      ...labelSet('hub.card.installedNoSessions'),
      ...labelSet('hub.card.notInstalled'),
      ...labelSet('hub.card.error'),
      ...labelSet('hub.card.unavailable'),
      ...labelSet('hub.card.detecting'),
      ...labelSet('hub.card.idle'),
    ]
    for (const cli of HUB_CLIS) {
      expectEqual(await visible(`cli-card-${cli}`), true, `CLI 卡片 ${cli} 可见`)
      expectEqual(await text(`cli-name-${cli}`), HUB_CLI_NAMES[cli], `CLI ${cli} 名称`)
      // 只断言「取值域」不断言「具体值」——具体值取决于本机装没装该 CLI。
      expectInSet(await text(`cli-badge-${cli}`), badgeDomain, `CLI ${cli} 状态徽章`)
    }
  })

  it('概览：卸载动作两击确认——第一击进入确认态，不直接执行', async function () {
    // 卸载按钮只在「已装且可自动卸载」的卡片上渲染（未安装的 CLI 没有该按钮），
    // 故按实际渲染的卡片断言，不假设某台机器装了哪个 CLI。
    const withButton = (
      await Promise.all(
        HUB_CLIS.map(async (c) => ((await exists(`cli-uninstall-${c}`)) ? c : null)),
      )
    ).filter((c): c is HubCli => c !== null)
    if (withButton.length === 0) {
      // 本机没有可自动卸载的 CLI：该分支不可测，显式跳过而不是假绿。
      this.skip()
    }
    const cli = withButton[0]
    const before = await text(`cli-uninstall-${cli}`)
    expectInSet(before, labelSet('hub.card.uninstall'), `CLI ${cli} 卸载按钮初始文案`)

    await click(`cli-uninstall-${cli}`)
    expectInSet(
      await text(`cli-uninstall-${cli}`),
      labelSet('hub.card.uninstallConfirm'),
      `CLI ${cli} 第一击后应进入确认态`,
    )
    // 第一击不得触发卸载：卡片与按钮都还在
    expectEqual(await visible(`cli-card-${cli}`), true, `CLI ${cli} 卡片仍在`)
    expectEqual(await visible(`cli-uninstall-${cli}`), true, `CLI ${cli} 卸载按钮仍在`)
  })

  it('Skills：GitHub 安装入口按授权状态门控（已授权可展开表单，未授权显示横幅且禁用）', async () => {
    await openTab('skills')

    if (await isDisabled('open-github')) {
      // 未授权：入口禁用 + 授权横幅可见 = 门控生效（授权状态由宿主设置/持久化决定，
      // 两种状态下这条断言都必须成立）。
      expectEqual(await visible('skills-auth'), true, '未授权时显示授权横幅')
      return
    }

    expectEqual(await exists('github-form'), false, '初始无 GitHub 表单')
    await click('open-github')
    await waitFor('github-form')
    expectEqual(await visible('github-url'), true, 'GitHub 仓库输入框可见')

    // 再点一次收起
    await click('open-github')
    await waitGone('github-form')
    expectEqual(await exists('github-form'), false, '再次点击后表单收起')
  })

  it('供应商：新建预设打开编辑器，关闭按钮收起编辑器', async () => {
    await openTab('providers')
    expectEqual(await exists('preset-editor'), false, '初始无预设编辑器')

    await click('new-preset')
    await waitFor('preset-editor')
    expectEqual(await visible('preset-name'), true, '预设名称输入框可见')

    await click('preset-editor-close')
    await waitGone('preset-editor')
    expectEqual(await visible('preset-editor'), false, '编辑器已收起')
  })

  it('会话日志：来源面板可展开可收起', async () => {
    await openTab('logs')
    expectEqual(await attr('lg-sources-toggle', 'aria-expanded'), 'false', '来源面板初始收起')

    await click('lg-sources-toggle')
    await waitFor('lg-sources-body')
    expectEqual(await attr('lg-sources-toggle', 'aria-expanded'), 'true', '来源面板已展开')

    await click('lg-sources-toggle')
    await waitGone('lg-sources-body')
    expectEqual(await attr('lg-sources-toggle', 'aria-expanded'), 'false', '来源面板已收起')
  })

  it('使用统计：时间范围切换改变选中态', async () => {
    await openTab('stats')
    // 初始选中哪个区间取决于 app 的默认/持久化状态（不写死）：只断言「恰好选中一个」。
    const ranges = [7, 30, 90, 0]
    const pressedOf = async (r: number) => attr(`range-${r}`, 'aria-pressed')
    const initiallyPressed = (await Promise.all(ranges.map(pressedOf))).filter(
      (v) => v === 'true',
    ).length
    expectEqual(initiallyPressed, 1, '初始恰好选中一个时间范围')

    // 选一个与当前不同的档位，才能证明「切换」而不是重复点当前值。
    const target = (await pressedOf(90)) === 'true' ? 30 : 90
    await click(`range-${target}`)
    await waitForAttr(`range-${target}`, 'aria-pressed', 'true', 5_000)
    const stillPressed = (await Promise.all(ranges.map(pressedOf))).filter(
      (v) => v === 'true',
    ).length
    expectEqual(stillPressed, 1, '切换后仍恰好选中一个时间范围')
  })

  it('安装与更新：CLI 行常驻、临时镜像默认开且可切换、自定义源空值禁用', async () => {
    await openTab('install')
    for (const cli of HUB_CLIS) {
      await waitFor(`inst-row-${cli}`)
    }
    expectEqual(await attr('inst-use-mirror', 'data-checked'), 'true', '临时镜像默认开启')
    await click('inst-use-mirror')
    await waitForAttr('inst-use-mirror', 'data-checked', 'false', 5_000)
    await click('inst-use-mirror')
    await waitForAttr('inst-use-mirror', 'data-checked', 'true', 5_000)

    expectEqual(await isDisabled('inst-custom-add'), true, '自定义源空值不可添加')
    await setValue('inst-custom-url', 'https://registry.example.invalid')
    await waitForEnabled('inst-custom-add')
    expectEqual(await isDisabled('inst-custom-add'), false, '填入 URL 后可添加')
    await setValue('inst-custom-url', '')
    await waitForDisabled('inst-custom-add')
    expectEqual(await isDisabled('inst-custom-add'), true, '清空后重新禁用')
    expectEqual(await visible('inst-check-updates'), true, '检查更新入口可见')
  })

  it('供应商：模板快选回填字段，空表单不可保存', async () => {
    await openTab('providers')
    await click('new-preset')
    await waitFor('preset-editor')
    expectEqual(await isDisabled('preset-save'), true, '空名称不可保存')

    await click('preset-template-deepseek')
    await waitForAttr('preset-style-openai', 'aria-pressed', 'true', 5_000)
    expectEqual(await value('preset-name'), 'DeepSeek', '模板回填名称')
    expectEqual(
      (await value('preset-baseurl'))?.includes('api.deepseek.com'),
      true,
      '模板回填 Base URL',
    )
    expectEqual((await value('preset-models'))?.includes('deepseek-chat'), true, '模板回填模型列表')
    expectEqual(await isDisabled('preset-save'), false, '名称就绪后保存可用')

    await click('preset-editor-close')
    await waitGone('preset-editor')
  })

  it('使用统计：指标选择始终恰好一个，切换后选中态跟随', async () => {
    await openTab('stats')
    const metrics = [
      'tokens',
      'sessions',
      'tokens_in',
      'tokens_out',
      'tokens_cache_read',
      'tokens_cache_write',
      'tokens_reasoning',
      'duration_ms',
      'cost_total',
    ]
    const pressedOf = async (m: string) => attr(`metric-${m}`, 'aria-pressed')
    const selected = async () =>
      (await Promise.all(metrics.map(pressedOf))).filter((v) => v === 'true')
    expectEqual((await selected()).length, 1, '初始恰好选中一个指标')

    const target = (await pressedOf('tokens')) === 'true' ? 'sessions' : 'tokens'
    await click(`metric-${target}`)
    await waitForAttr(`metric-${target}`, 'aria-pressed', 'true', 5_000)
    expectEqual((await selected()).length, 1, '切换后仍恰好选中一个指标')
  })
})
