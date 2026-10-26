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
  isDisabled,
  text,
  visible,
  waitFor,
  waitForHostReady,
} from '../harness/driver'
import { expectEqual, expectInSet } from '../harness/expect'
import { goHome, homeAppCards, homeSystemCards, openSystemApp } from '../harness/shell'
import {
  APP_NAME,
  FILTER_ALL,
  FILTER_APPS,
  FILTER_SERVICES,
  MONITOR_PLUGIN_ID,
  PAGE_TABS,
  SELF_CARD,
  SELF_QUOTA_NOTE,
  SELF_QUOTA_TOGGLE,
  SELF_ROLE,
  SYS_ENTRY_NAME,
} from '../pages/monitor'

describe('Monitor（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    // 每条用例从主屏重新进入：挂载实例与页面状态归零
    await goHome()
    // monitor 是宿主系统级服务：主屏应用网格不显示它，入口在主屏「系统」区
    await openSystemApp(SYS_ENTRY_NAME)
    await waitFor('monitor-view')
  })

  it('主屏「系统」区显示 Monitor（运行监控）入口；应用网格不含系统服务', async () => {
    await goHome()
    const sysCards = await homeSystemCards()
    expectEqual(
      sysCards.some((card) => card.name === SYS_ENTRY_NAME),
      true,
      '主屏系统宫格存在 Monitor（运行监控）入口',
    )
    const appCards = await homeAppCards()
    expectEqual(
      appCards.some((card) => card.name === APP_NAME),
      false,
      '主屏应用网格不含系统服务 Monitor',
    )

    await openSystemApp(SYS_ENTRY_NAME)
    await waitFor('monitor-view')
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
    expectEqual(await isDisabled('monitor-refresh'), false, '刷新按钮可用')
    await click('monitor-refresh')
    expectEqual(await visible('monitor-error'), false, '手动刷新后无错误')
    await waitFor(SELF_CARD)
  })

  it('配额详情默认可展开，展开后标注「上限不是实时占用」', async () => {
    await waitFor(SELF_CARD)
    expectEqual(await exists(SELF_QUOTA_TOGGLE), true, '配额折叠头在场')

    // 以原生 details 的 open 属性判定展开态（WebKit 下隐藏内容的
    // getClientRects() 仍可能非空，不能用视觉判定代替状态判定）
    const quota = `monitor-quota-${MONITOR_PLUGIN_ID}`
    expectEqual(await attr(quota, 'open'), null, '配额详情默认收起')

    await click(SELF_QUOTA_TOGGLE)
    await waitFor(SELF_QUOTA_NOTE)
    expectEqual(await attr(quota, 'open'), '', '展开后 details open')
    expectInSet(
      await text(SELF_QUOTA_NOTE),
      ['以上是宿主配额上限，不是实时占用。', 'These are host quota limits, not live usage.'],
      '配额说明是诚实边界',
    )
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
    expectEqual(await exists(SELF_CARD), true, '服务过滤仍显示 monitor')

    await click(FILTER_APPS)
    expectEqual(await exists(SELF_CARD), false, '应用过滤不显示系统服务')

    await click(FILTER_ALL)
    expectEqual(await exists(SELF_CARD), true, '全部过滤恢复全量')
  })

  it('无应用注册监控面板：页头不出现整页页签，监控页照常', async () => {
    await waitFor(SELF_CARD)
    expectEqual(await exists(PAGE_TABS), false, '无注册时页签条不出现')
    expectEqual(await exists('monitor-page-title'), true, '标题照常显示')
    expectEqual(await exists('monitor-panels'), false, '不渲染面板区')
    expectEqual(await exists('monitor-panel-error'), false, '也不出现错误态')
  })
})
