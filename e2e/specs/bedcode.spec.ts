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

import { click, exists, visible, waitFor, waitForHostReady, waitGone } from '../harness/driver'
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
  })

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
})
