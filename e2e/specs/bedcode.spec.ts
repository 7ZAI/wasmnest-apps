/**
 * BedCode（com.wasmnest.bedcode）桌面端 E2E
 *
 * 跑法（应用仓根）：
 *   node scripts/e2e.mjs --app bedcode
 *
 * 判据纪律与 `agent-hub.spec.ts` 同：
 * - 不依赖机器状态（本机有没有配对设备 / 有没有会话配置）；
 * - 文案断言跨语言；
 * - 等状态不 sleep。
 */

import { browser } from '@wdio/globals'
import {
  attr,
  click,
  exists,
  isDisabled,
  text,
  value,
  visible,
  waitFor,
  waitForAttr,
  waitForHostReady,
  waitGone,
} from '../harness/driver'
import { expectEqual } from '../harness/expect'
import { goHome, openApp } from '../harness/shell'

/** 应用显示名（= bedcode 的 plugin.json `name`） */
const APP_NAME = 'BedCode'

/** 侧边栏四个目录（= `useSidebarMenu` 的菜单项 id） */
const NAV_ITEMS = [
  { id: 'pairing', view: 'pairing-view' },
  { id: 'sessions', view: 'sessions-view' },
  { id: 'tasks', view: 'tasks-view' },
  { id: 'settings', view: 'settings-view' },
] as const

describe('BedCode（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await goHome()
    await openApp(APP_NAME)
    await waitFor('bedcode-root')
    // 壳保活：上一条用例可能停在表单弹窗；统一关掉再开始
    if (await visible('session-config-form')) {
      await click('session-config-cancel')
      await waitGone('session-config-form')
    }
  })

  /** 宿主深链直达（bedcode 的 /server、/history 不进侧栏） */
  async function openRoute(path: string): Promise<void> {
    await browser.execute((p: string) => {
      history.pushState(null, '', p)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  }

  it('侧边栏渲染四个目录项', async () => {
    for (const item of NAV_ITEMS) {
      expectEqual(await visible(`nav-${item.id}`), true, `侧边栏目录 ${item.id} 可见`)
    }
  })

  it('逐个切换侧边栏目录：目标视图渲染、前一视图退场', async () => {
    let previous: string | null = null
    for (const item of NAV_ITEMS) {
      await click(`nav-${item.id}`)
      await waitFor(item.view)
      expectEqual(await visible(item.view), true, `视图 ${item.view} 可见`)
      if (previous) {
        // 路由视图走 KeepAlive + 页面过渡：旧视图实例被缓存（仍在 DOM 里），
        // 退场动画结束后才变为不可见——必须等它「不可见」，不能只看「切完了」。
        await waitGone(previous)
        expectEqual(await visible(previous), false, `前一视图 ${previous} 已退场`)
      }
      previous = item.view
    }
  })

  it('终端会话：刷新动作可触发且界面保持在位', async () => {
    await click('nav-sessions')
    await waitFor('sessions-view')
    expectEqual(await visible('sessions-refresh'), true, '刷新按钮可见')

    await click('sessions-refresh')
    // 刷新是异步命令面动作：只断言「界面没被刷坏、按钮仍在位」
    expectEqual(await visible('sessions-view'), true, '会话中心仍在位')
    expectEqual(await visible('sessions-refresh'), true, '刷新按钮仍在位')
  })

  it('终端会话：新建配置打开表单弹窗，可关闭', async () => {
    await click('nav-sessions')
    await waitFor('sessions-view')
    expectEqual(await exists('session-config-form'), false, '初始无配置表单')

    await click('sessions-create')
    await waitFor('session-config-form')
    expectEqual(await visible('session-config-form'), true, '配置表单可见')

    await click('session-config-cancel')
    await waitGone('session-config-form')
    expectEqual(await visible('sessions-view'), true, '已回到会话中心')
  })

  it('设备配对：页签可切换，设备面板出现、配对面板退场', async () => {
    await click('nav-pairing')
    await waitFor('pairing-view')
    expectEqual(await attr('pairing-tab-pairing', 'aria-selected'), 'true', '默认选中配对页签')

    await click('pairing-tab-devices')
    await waitForAttr('pairing-tab-devices', 'aria-selected', 'true', 5_000)
    await waitFor('pairing-devices-panel')
    expectEqual(await attr('pairing-tab-pairing', 'aria-selected'), 'false', '配对页签解除选中')

    await click('pairing-tab-pairing')
    await waitForAttr('pairing-tab-pairing', 'aria-selected', 'true', 5_000)
    await waitGone('pairing-devices-panel')
    expectEqual(await visible('pairing-devices-panel'), false, '设备面板已退场')
  })

  it('终端会话：空表单提交显示必填错误，表单不关闭', async () => {
    await click('nav-sessions')
    await waitFor('sessions-view')
    await click('sessions-create')
    await waitFor('session-config-form')
    await waitFor('session-input-name')
    expectEqual(await exists('session-input-working-dir'), true, '工作目录输入在场')

    await click('session-config-submit')
    await waitFor('session-input-name-error')
    expectEqual((await text('session-input-name-error'))?.length > 0, true, '名称必填错误')
    await waitFor('session-input-working-dir-error')
    expectEqual(await visible('session-config-form'), true, '校验失败时表单仍打开')

    await click('session-config-cancel')
    await waitGone('session-config-form')
  })

  it('Agent 任务：四个页签互斥切换，目标面板跟随出现', async () => {
    await click('nav-tasks')
    await waitFor('tasks-view')
    const tabs = ['current', 'records', 'scheduled', 'stats'] as const
    let previousPanel: string | null = null
    for (const key of tabs) {
      await click(`tasks-tab-${key}`)
      await waitForAttr(`tasks-tab-${key}`, 'aria-selected', 'true', 5_000)
      await waitFor(`tasks-panel-${key}`)
      if (previousPanel) {
        await waitGone(previousPanel)
      }
      previousPanel = `tasks-panel-${key}`
    }
    expectEqual(await visible('tasks-panel-stats'), true, '统计面板可见')
  })

  it('设置：四个业务分组全部渲染', async () => {
    await click('nav-settings')
    await waitFor('settings-view')
    for (const key of ['appearance', 'pairing', 'linkCrypto', 'session']) {
      await waitFor(`settings-section-${key}`)
      expectEqual(await visible(`settings-section-${key}`), true, `设置分组 ${key} 可见`)
    }
  })

  it('服务器诊断页：分区、端口和高级配置折叠可用（不写端口）', async () => {
    await openRoute('/server')
    await waitFor('server-view')
    for (const key of ['status', 'network', 'monitoring']) {
      await waitFor(`server-section-${key}`)
    }
    const port = Number(await value('server-port-input'))
    expectEqual(Number.isInteger(port) && port > 0, true, '端口为数字')
    expectEqual(await isDisabled('server-port-save'), true, '未修改时端口保存禁用')
    expectEqual(await visible('server-status-text'), true, '服务器状态可见')

    if (await exists('server-section-advanced')) {
      expectEqual(await attr('server-advanced-toggle', 'aria-expanded'), 'true', '高级配置默认展开')
      await click('server-advanced-toggle')
      await waitForAttr('server-advanced-toggle', 'aria-expanded', 'false', 5_000)
      await waitGone('server-advanced-panel')
      await click('server-advanced-toggle')
      await waitForAttr('server-advanced-toggle', 'aria-expanded', 'true', 5_000)
      await waitFor('server-advanced-panel')
    }
  })
})
