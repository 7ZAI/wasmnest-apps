/**
 * File Transfer 桌面端 E2E —— 真实宿主里挂载真实 wasm app 后，脚本驱动界面做功能测试
 *
 * 跑法（应用仓根）：
 *   node scripts/e2e.mjs --app file-transfer
 *
 * 判据纪律见 docs/E2E.md（原 agent-hub 套件随应用并入 bedcode 退役）：
 * - 不依赖机器状态（本机有没有在线对端 / 有没有传输任务）；
 * - 文案断言跨语言；
 * - 等状态不 sleep。
 */

import {
  attr,
  click,
  exists,
  isDisabled,
  text,
  visible,
  waitFor,
  waitForAttr,
  waitForHostReady,
  waitGone,
} from '../harness/driver'
import { expectEqual } from '../harness/expect'
import { goHome, openApp } from '../harness/shell'

/** 应用显示名（= file-transfer 的 plugin.json `name`） */
const APP_NAME = 'File Transfer'

describe('File Transfer（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await goHome()
    await openApp(APP_NAME)
    await waitFor('ft-view')
  })

  it('主界面渲染：顶栏动作就位', async () => {
    expectEqual(await visible('ft-view'), true, '主界面可见')
    for (const id of ['ft-peer-switch', 'ft-queue', 'ft-settings']) {
      expectEqual(await exists(id), true, `顶栏动作 ${id} 存在`)
    }
  })

  it('附近设备面板可展开可收起', async () => {
    expectEqual(await exists('ft-peer-panel'), false, '初始无设备面板')

    await click('ft-peer-switch')
    await waitFor('ft-peer-panel')
    expectEqual(await visible('ft-peer-panel'), true, '设备面板已展开')

    await click('ft-peer-switch')
    await waitGone('ft-peer-panel')
    expectEqual(await exists('ft-peer-panel'), false, '设备面板已收起')
  })

  it('传输队列面板可展开可收起', async () => {
    expectEqual(await exists('ft-queue-panel'), false, '初始无传输队列面板')

    await click('ft-queue')
    await waitFor('ft-queue-panel')
    expectEqual(await visible('ft-queue-panel'), true, '传输队列已展开')

    await click('ft-queue')
    await waitGone('ft-queue-panel')
    expectEqual(await exists('ft-queue-panel'), false, '传输队列已收起')
  })

  it('设置面板可打开可关闭', async () => {
    expectEqual(await exists('ft-settings-panel'), false, '初始无设置面板')

    await click('ft-settings')
    await waitFor('ft-settings-panel')
    expectEqual(await visible('ft-settings-panel'), true, '设置面板已打开')

    await click('ft-settings-close')
    await waitGone('ft-settings-panel')
    expectEqual(await exists('ft-settings-panel'), false, '设置面板已关闭')
  })

  it('刷新动作：按钮禁用态与对端在线态一致', async () => {
    const online = (await attr('ft-peer-status', 'data-online')) === 'true'
    expectEqual(await isDisabled('ft-refresh'), !online, '刷新禁用与对端在线态一致')
    expectEqual(await isDisabled('ft-upload'), !online, '上传禁用与对端在线态一致')
    expectEqual((await attr('ft-refresh', 'title')) !== null, true, '刷新按钮有 title')
  })

  it('附近设备面板：点击面板外收起', async () => {
    await click('ft-peer-switch')
    await waitFor('ft-peer-panel')
    // 点主界面空白根节点（在面板 wrap 之外）；document 监听应收起
    await click('ft-view')
    await waitGone('ft-peer-panel')
    expectEqual(await exists('ft-peer-panel'), false, '面板外点击后收起')
  })

  it('传输队列：四个页签互斥切换，关闭按钮可收起', async () => {
    await click('ft-queue')
    await waitFor('ft-queue-panel')
    expectEqual(await attr('ft-queue-tab-all', 'aria-selected'), 'true', '默认全部页签')
    let previous = 'all'
    for (const tab of ['sending', 'receiving', 'history', 'all']) {
      await click(`ft-queue-tab-${tab}`)
      await waitForAttr(`ft-queue-tab-${tab}`, 'aria-selected', 'true', 5_000)
      expectEqual(
        await attr(`ft-queue-tab-${previous}`, 'aria-selected'),
        'false',
        '前一页签解除选中',
      )
      previous = tab
    }
    await click('ft-queue-close')
    await waitGone('ft-queue-panel')
  })

  it('设置面板：业务分区与策略/并发/加密结构完整（只读）', async () => {
    await click('ft-settings')
    await waitFor('ft-settings-panel')
    for (const key of ['roots', 'download-dir', 'policy', 'concurrency', 'encryption', 'trusted']) {
      await waitFor(`ft-settings-section-${key}`)
    }
    expectEqual(await visible('ft-settings-warning'), true, '明文传输警告可见')

    const selectedCount = (
      await Promise.all(
        ['ask', 'accept', 'reject'].map(async (p) =>
          (await attr(`ft-policy-${p}`, 'aria-selected')) === 'true' ? 1 : 0,
        ),
      )
    ).reduce<number>((a, b) => a + b, 0)
    expectEqual(selectedCount, 1, '接收策略恰有一个选中')
    const askSelected = (await attr('ft-policy-ask', 'aria-selected')) === 'true'
    expectEqual(await exists('ft-settings-timeout'), askSelected, '超时输入仅在 ask 时显示')

    const concurrency = Number(await text('ft-concurrency-value'))
    expectEqual(concurrency >= 1 && concurrency <= 8, true, '并发数落在 1–8')
    await click('ft-settings-close')
    await waitGone('ft-settings-panel')
  })
})
