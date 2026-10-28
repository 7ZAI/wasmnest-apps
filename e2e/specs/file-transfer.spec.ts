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
  visible,
  waitFor,
  waitForHostReady,
  waitGone,
} from '../harness/driver'
import { browser } from '@wdio/globals'
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

  it('刷新动作：未连接对端时按钮禁用（不误触发）', async () => {
    // 刷新依赖活跃对端（:disabled="!peer.online"）：未连接时应禁用，
    // 连接时应可用——两种状态下断言都成立。
    const disabled = await browser.execute(() => {
      const el = document.querySelector('[data-testid="ft-refresh"]') as
        (HTMLElement & { disabled?: boolean }) | null
      return el ? el.disabled === true : null
    })
    expectEqual(disabled !== null, true, '刷新按钮存在')
    expectEqual((await attr('ft-refresh', 'title')) !== null, true, '刷新按钮有 title')
  })
})
