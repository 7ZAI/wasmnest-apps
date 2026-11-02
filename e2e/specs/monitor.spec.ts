/**
 * Monitor 桌面端 E2E —— 真实宿主里挂载真实 wasm app 后，脚本验证指标页可用
 *
 * 跑法（应用仓根）：
 *   node scripts/e2e.mjs --app monitor
 *
 * 判据纪律：
 * 1. 隔离插件目录里只有 monitor 一个 app → 快照至少包含本应用自身的指标；
 *    断言「本应用出现在插件列表」是稳定事实，不依赖本机装了什么。
 * 2. monitor 是随包应用（PluginSource::Wasm，非 UserInstalled），宿主审批门对
 *    `UserInstalled` 以外的来源直接跳过（wasm-core `builtin_source_skips_approval_gate`）
 *    ——E2E 不会弹授权窗，页面应直接出数据。
 * 3. 不断言具体指标数值（每次运行都不同）；只断言结构、状态与交互。
 */
import {
  attr,
  click,
  exists,
  text,
  visible,
  waitFor,
  waitForAttr,
  waitForAttrGone,
  waitForEnabled,
  waitForHostReady,
} from '../harness/driver'
import { expectEqual, expectInSet } from '../harness/expect'
import { goHome, homeAppCards, homeSystemCards, openSystemApp } from '../harness/shell'
import {
  ALERTS,
  ALERTS_EMPTY,
  ALERTS_ENABLED_TOGGLE,
  ALERTS_LIST,
  ALERTS_NOTIFY_TOGGLE,
  ALERTS_PLATFORM_WARN,
  ALERTS_SETTINGS_SUMMARY,
  APP_NAME,
  FILTER_ALL,
  FILTER_APPS,
  FILTER_SERVICES,
  MONITOR_PLUGIN_ID,
  OVERVIEW,
  OVERVIEW_COMPUTE,
  OVERVIEW_MEMORY,
  OVERVIEW_MEMORY_RATIO,
  PAGE_TABS,
  PROCESS,
  PROCESS_TREE,
  PROCESS_UNAVAILABLE,
  PROCESS_WEBVIEW,
  PROCESS_WEBVIEW_NOTE,
  SELF_CARD,
  SELF_QUOTA_NOTE,
  SELF_QUOTA_TOGGLE,
  SELF_ROLE,
  SYS_ENTRY_NAMES,
} from '../pages/monitor'

/**
 * 元素在**文档坐标系**里的 y（px；不存在返回 null）。
 *
 * 不用视口坐标：展开下拉会让上文变高、页面可能滚动，视口 top 会跟着变；
 * 文档坐标才能判「这块面板自己在版面里的位置有没有被顶动」。
 */
function pageTop(testid: string): Promise<number | null> {
  return browser.execute((t: string) => {
    const el = document.querySelector(`[data-testid="${t}"]`)
    if (!el) return null
    return Math.round((el.getBoundingClientRect().top + window.scrollY) * 100) / 100
  }, testid)
}

/** 在主屏系统宫格找到 Monitor 入口（宿主语言决定显示名）并打开 */
async function openMonitor(): Promise<void> {
  await goHome()
  const cards = await homeSystemCards()
  const hit = cards.find((card) => (SYS_ENTRY_NAMES as readonly string[]).includes(card.name))
  if (!hit) {
    throw new Error(
      `主屏系统宫格找不到 Monitor 入口（可接受：${SYS_ENTRY_NAMES.join(' / ')}）；实际：${JSON.stringify(cards)}`,
    )
  }
  await openSystemApp(hit.name)
  await waitFor('monitor-view')
  await waitFor(SELF_CARD)
  // 全量运行时 staging 含多个 app，默认选中行不一定是 monitor；先选中自身。
  await click(SELF_CARD)
  await waitForAttr(SELF_CARD, 'aria-current', 'true', 5_000)
  // 保活实例会保留上一次的过滤态；统一回「全部」再开始
  if ((await attr(FILTER_ALL, 'aria-pressed')) !== 'true') {
    await click(FILTER_ALL)
    await waitForAttr(FILTER_ALL, 'aria-pressed', 'true', 5_000)
  }
  // 配额展开态也可能被上一用例带回来；统一收起
  const quota = `monitor-quota-${MONITOR_PLUGIN_ID}`
  if ((await attr(quota, 'open')) !== null) {
    await click(SELF_QUOTA_TOGGLE)
    await waitForAttrGone(quota, 'open')
  }
}

describe('Monitor（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await openMonitor()
  })

  it('主屏「服务」区显示 Monitor 入口；应用网格不含系统服务', async () => {
    await goHome()
    const sysCards = await homeSystemCards()
    expectEqual(
      sysCards.some((card) => (SYS_ENTRY_NAMES as readonly string[]).includes(card.name)),
      true,
      '主屏系统宫格存在 Monitor 入口',
    )
    const appCards = await homeAppCards()
    expectEqual(
      appCards.some((card) => card.name === APP_NAME),
      false,
      '主屏应用网格不含系统服务 Monitor',
    )

    await openSystemApp(
      sysCards.find((card) => (SYS_ENTRY_NAMES as readonly string[]).includes(card.name))!.name,
    )
    await waitFor('monitor-view')
    await waitForEnabled('monitor-refresh')
    await waitFor('monitor-live')
    expectEqual(await visible('monitor-refresh'), true, '刷新按钮可见')
    expectEqual(await visible('monitor-live'), true, '实时状态可见')
  })

  it('实时指标就绪：KPI / 插件卡 / 本应用状态徽章渲染，无错误 banner', async () => {
    await waitFor('monitor-kpi-plugins')
    await waitFor('monitor-plugin-list')
    await waitFor(SELF_CARD)

    expectEqual(await exists(`monitor-state-${MONITOR_PLUGIN_ID}`), true, '本应用状态徽章在场')
    expectInSet(
      await text(`monitor-state-${MONITOR_PLUGIN_ID}`),
      [
        '运行中',
        'Running',
        '降级',
        'Degraded',
        '待授权',
        'Needs approval',
        '错误',
        'Error',
        '未运行',
        'Not running',
        '状态未知',
        'Unknown',
      ],
      '状态徽章落在已知取值域',
    )
    expectEqual(await visible('monitor-error'), false, '无错误 banner')
  })

  it('刷新按钮可用，手动刷新后不进入错误态', async () => {
    await waitFor('monitor-kpi-plugins')
    // 后台 1s 轮询不驱动按钮加载态（只有手动刷新才短暂 disabled），这里仍先等可点态
    await waitForEnabled('monitor-refresh')
    await click('monitor-refresh')
    expectEqual(await visible('monitor-error'), false, '手动刷新后无错误')
    await waitFor(SELF_CARD)
  })

  it('配额详情默认可展开，展开后标注「上限不是实时占用」，且不顶动左侧宿主段', async () => {
    await waitFor(SELF_CARD)
    expectEqual(await exists(SELF_QUOTA_TOGGLE), true, '配额折叠头在场')

    // 以原生 details 的 open 属性判定展开态（WebKit 下隐藏内容的
    // getClientRects() 仍可能非空，不能用视觉判定代替状态判定）
    const quota = `monitor-quota-${MONITOR_PLUGIN_ID}`
    expectEqual(await attr(quota, 'open'), null, '配额详情默认收起')

    // 展开前记下左下「宿主维度段」的文档坐标：右列变高只该让右列变长，
    // 左列位置必须纹丝不动（曾用跨行 grid，高度分摊把这块顶下去几十像素）
    await waitFor('monitor-system-list')
    const hostTopBefore = await pageTop('monitor-system-list')
    expectEqual(typeof hostTopBefore, 'number', '宿主维度段有布局盒')

    await click(SELF_QUOTA_TOGGLE)
    await waitFor(SELF_QUOTA_NOTE)
    expectEqual(await attr(quota, 'open'), '', '展开后 details open')
    expectInSet(
      await text(SELF_QUOTA_NOTE),
      ['以上是宿主配额上限，不是实时占用。', 'These are host quota limits, not live usage.'],
      '配额说明是诚实边界',
    )
    expectEqual(await pageTop('monitor-system-list'), hostTopBefore, '展开配额后左侧宿主段位置不变')
    // 收起，避免保活实例把展开态带给后续用例
    await click(SELF_QUOTA_TOGGLE)
    await waitForAttrGone(quota, 'open')
  })

  it('manifest kind 端到端：本应用带「内部业务」服务角色徽标', async () => {
    await waitFor(SELF_CARD)
    expectEqual(await exists(SELF_ROLE), true, '服务角色徽标在场（kind 从 manifest 透传到台账）')
    expectInSet(
      await text(SELF_ROLE),
      ['内部业务', 'Internal business'],
      'monitor 作为 L2 系统服务的角色文案',
    )
  })

  it('角色过滤：服务区含本应用，应用区不含（取数仍全量）', async () => {
    await waitFor(SELF_CARD)

    await click(FILTER_SERVICES)
    await waitForAttr(FILTER_SERVICES, 'aria-pressed', 'true', 5_000)
    expectEqual(await exists(SELF_CARD), true, '服务过滤仍显示 monitor')

    await click(FILTER_APPS)
    await waitForAttr(FILTER_APPS, 'aria-pressed', 'true', 5_000)
    expectEqual(await exists(SELF_CARD), false, '应用过滤不显示系统服务')

    await click(FILTER_ALL)
    await waitForAttr(FILTER_ALL, 'aria-pressed', 'true', 5_000)
    expectEqual(await exists(SELF_CARD), true, '全部过滤恢复全量')
  })

  it('无应用注册监控面板：页头不出现整页页签，监控页照常', async () => {
    await waitFor(SELF_CARD)
    expectEqual(await exists(PAGE_TABS), false, '无注册时页签条不出现')
    expectEqual(await exists('monitor-page-title'), true, '标题照常显示')
    expectEqual(await exists('monitor-panels'), false, '不渲染面板区')
    expectEqual(await exists('monitor-panel-error'), false, '也不出现错误态')
  })

  it('KPI 五项与台账：本应用运行中、指标可用、详情对应当前行', async () => {
    for (const key of ['plugins', 'calls', 'inflight', 'traps', 'memory']) {
      await waitFor(`monitor-kpi-${key}`)
    }
    // 全量 staging 可能含未就绪插件；有就显示数量，没有则不渲染，都是诚实态
    if (await exists('monitor-kpi-unavailable')) {
      expectEqual((await text('monitor-kpi-unavailable'))?.length > 0, true, '未就绪数有文案')
    }
    expectEqual(await attr(SELF_CARD, 'data-state'), 'running', '本应用运行中')
    expectEqual(await attr(SELF_CARD, 'data-metrics-available'), 'true', '本应用指标可用')
    expectEqual(await attr(SELF_CARD, 'aria-current'), 'true', '自身行被选中')
    expectEqual(
      await attr('monitor-inspector', 'data-plugin-id'),
      MONITOR_PLUGIN_ID,
      '详情对应当前行',
    )
  })

  it('详情：内存水位、耗时分布、Trap 区块可见，不显示指标不可用', async () => {
    await click(SELF_CARD)
    await waitForAttr(SELF_CARD, 'aria-current', 'true', 5_000)
    await waitFor('monitor-inspector')
    for (const id of [
      `monitor-memory-ratio-${MONITOR_PLUGIN_ID}`,
      `monitor-memory-${MONITOR_PLUGIN_ID}`,
      `monitor-inflight-${MONITOR_PLUGIN_ID}`,
      `monitor-histogram-${MONITOR_PLUGIN_ID}`,
      `monitor-traps-${MONITOR_PLUGIN_ID}`,
    ]) {
      await waitFor(id)
    }
    expectEqual(await exists('monitor-metrics-unavailable'), false, '不显示指标不可用原因')
    expectEqual(await exists('monitor-inspector-role'), true, '详情角色徽标在场')
  })

  it('系统维度：桌面宿主提供 task 段（不要求 page 级面板）', async () => {
    await waitFor('monitor-system-list')
    expectEqual(await visible('monitor-system-list'), true, '宿主维度区可见')
    await waitFor('monitor-system-task')
    expectEqual(await visible('monitor-system-task'), true, 'task 维度段可见')
  })

  it('宿主进程：WebView 与 wasm 台账分开，归属本宿主进程树', async () => {
    await waitFor(PROCESS)
    expectEqual(await visible(PROCESS), true, '宿主进程面板可见')
    // 本次宿主已装配 process 段：不得落回「宿主未提供」
    expectEqual(await exists(PROCESS_UNAVAILABLE), false, '宿主提供了 process 段')
    expectEqual(await visible(PROCESS_WEBVIEW), true, 'WebView 维度可见')
    expectEqual(await visible(PROCESS_TREE), true, '进程树合计可见')
    // Linux 真实宿主：WebKit 子进程在本进程树内 → 不得出现「不在树内」标注
    expectEqual(await exists(PROCESS_WEBVIEW_NOTE), false, 'WebView 归属本宿主进程树')
    // 整机口径与 wasm 台账同时在场（两块各说各的事实，不是二选一）
    expectEqual(await visible(SELF_CARD), true, 'wasm 台账仍按原口径展示')

    // 版面顺序：平台总览 → 宿主进程 → 台账 → 预警（预警必须最后）。
    // 用文档坐标比较，不受滚动 / 视口影响。
    const tops: Array<[string, number | null]> = [
      ['overview', await pageTop(OVERVIEW)],
      ['process', await pageTop(PROCESS)],
      ['ledger', await pageTop('monitor-plugin-list')],
      ['alerts', await pageTop(ALERTS)],
    ]
    for (const [name, top] of tops) expectEqual(top !== null, true, `${name} 在版面内`)
    const ys = tops.map(([, top]) => top as number)
    expectEqual(
      ys.every((y, i) => i === 0 || y > ys[i - 1]!),
      true,
      `版面顺序应为 总览 → 宿主进程 → 台账 → 预警；实际 y=${JSON.stringify(ys)}`,
    )
  })

  it('平台总览与预警：合计内存 / 计算负载 / 阈值设置可见', async () => {
    await waitFor(OVERVIEW)
    expectEqual(await visible(OVERVIEW_MEMORY), true, '平台内存合计可见')
    expectEqual((await text(OVERVIEW_MEMORY))?.length > 0, true, '平台内存有数值文案')
    // 无配额时比例是 —，有配额时是百分比：两者都是诚实态，不锁具体数值
    expectEqual((await text(OVERVIEW_MEMORY_RATIO))?.length > 0, true, '配额比例有文案')
    expectEqual(await visible(OVERVIEW_COMPUTE), true, '计算负载可见')

    await waitFor(ALERTS)
    // 本机是否越界取决于装机与配额：空态或预警卡都合法，但必须有明确态
    const hasEmpty = await exists(ALERTS_EMPTY)
    const hasCards = await exists(ALERTS_LIST)
    expectEqual(hasEmpty || hasCards, true, '预警区有明确态（空态或卡片）')

    // 阈值设置可展开（原生 details）：展开后四个输入在场
    await click(ALERTS_SETTINGS_SUMMARY)
    await waitFor(ALERTS_ENABLED_TOGGLE)
    expectEqual(await exists(ALERTS_NOTIFY_TOGGLE), true, '系统通知开关在场')
    expectEqual(await exists(ALERTS_PLATFORM_WARN), true, '平台内存阈值输入在场')
  })
})
