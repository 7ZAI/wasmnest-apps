/**
 * BedCode（com.wasmnest.bedcode）桌面端 E2E
 *
 * 跑法（应用仓根）：
 *   node scripts/e2e.mjs --app bedcode
 *
 * 判据纪律见 docs/E2E.md（原 agent-hub 套件随应用并入 bedcode 退役）：
 * - 不依赖机器状态（本机有没有配对设备 / 有没有会话配置）；
 * - 文案断言跨语言；
 * - 等状态不 sleep。
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  allowFsAuthPrompts,
  attrs,
  click,
  clickContaining,
  clickNth,
  count,
  exists,
  typeInto,
  visible,
  waitFor,
  waitForCount,
  waitForHostReady,
  waitForTerminalOutput,
  waitGone,
} from '../harness/driver'
import { expectEqual } from '../harness/expect'
import { goHome, openApp } from '../harness/shell'

/** 应用显示名（= bedcode 的 plugin.json `name`） */
const APP_NAME = 'BedCode'

/** 侧边栏六个目录（= `useSidebarMenu` 的菜单项 id，顺序即视觉顺序） */
const NAV_ITEMS = [
  { id: 'pairing', view: 'pairing-view' },
  { id: 'projects', view: 'projects-view' },
  { id: 'sessions', view: 'sessions-view' },
  { id: 'agents', view: 'hub-view' },
  { id: 'tasks', view: 'tasks-view' },
  { id: 'settings', view: 'settings-view' },
] as const

/**
 * 建项目用的目录：用户目录下的专用目录，用例自己创建。
 *
 * 不用 `/tmp`：项目目录会被注入 `.opencode/` 等 agent 原生扩展文件，共享临时目录
 * 既会污染机器、也可能被宿主 fs 沙箱拦掉（表现为 run.start 卡在插件部署）。
 */
const E2E_PROJECT_DIR = join(homedir(), 'bedcode-e2e-project')
mkdirSync(E2E_PROJECT_DIR, { recursive: true })

describe('BedCode（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await goHome()
    await openApp(APP_NAME)
    await waitFor('bedcode-root')
  })

  it('侧边栏渲染六个目录项', async () => {
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

  // ==================== 项目容器（ADR 0003 / issue #23 M2） ====================

  /**
   * 建项目 → 起两条运行 → 终端有真实字节 → 运行间切换 → 刷新后列表仍在。
   *
   * 幂等性靠后端去重：同目录同执行环境已有项目时 `project.create` 返回既有项目
   * （`created:false`）并同样进工作台，所以重复跑本用例不会堆出一排同名项目。
   *
   * 终端字节的 oracle：xterm 渲染在 WebGL 画布，DOM 读不到文本；走 app 暴露的
   * 只读 buffer 句柄（`window.__bedcodeTerminalText`，docs/E2E.md §10.4 口径）。
   */
  it('项目：建项目起运行，终端有真实输出，双运行切换与刷新持久', async () => {
    await click('nav-projects')
    await waitFor('projects-view')

    await click('projects-create')
    await waitFor('project-form-dir')
    await typeInto('project-form-dir', E2E_PROJECT_DIR)
    await click('project-form-submit')

    // 创建成功即跳工作台（重复目录也跳，只是提示不同）
    await waitFor('project-workbench')
    expectEqual(await visible('project-workbench'), true, '项目工作台可见')
    // 同目录项目跨次复用：进工作台时**可能**已有历史运行，终端面板不是本步骤
    // 产生的元素（无运行时检查器渲染 inspector-empty）。这里只断言页签结构在位。
    expectEqual(await exists('inspector-tab-terminal'), true, '检查器终端页签在位')
    const runsBefore = await count('run-item')

    // 第一条运行：弹窗列出注册表里的 agent（与是否已安装无关，未装也能起 PTY）
    await click('run-new')
    await waitFor('run-agent-opencode')
    await click('run-agent-opencode')

    // 首次启动会在项目目录部署 agent 扩展：宿主对未授权路径弹 fs 授权框，
    // 真实用户点「允许」，这里也走 UI（不预置授权记录，不依赖机器状态）。
    await allowFsAuthPrompts()

    // 运行列表**新增**一条运行（历史运行不能替这次启动作证），终端面板随之在位
    await waitForCount('run-item', runsBefore + 1)
    expectEqual(await count('run-item'), runsBefore + 1, '运行列表新增一条运行')
    await waitFor('run-terminal')
    expectEqual(await visible('run-terminal'), true, '终端页签显示该运行的终端')

    // 终端真实字节：证明 PTY 已起且输出进了渲染管线（不是只有空面板）
    const output = await waitForTerminalOutput()
    expectEqual(output.trim().length > 0, true, '终端页签有真实输出')

    // 第二条运行：同一项目并发
    await click('run-new')
    await waitFor('run-agent-opencode')
    await click('run-agent-opencode')
    await allowFsAuthPrompts()
    await waitForCount('run-item', runsBefore + 2)
    const runsAfter = await count('run-item')
    expectEqual(runsAfter, runsBefore + 2, '同一项目可并发第二条运行')

    // 运行间切换：选中态跟随点击，终端页签保持
    const beforeActive = await attrs('run-item', 'data-active')
    expectEqual(
      beforeActive.filter((value) => value === 'true').length,
      1,
      '始终只有一条运行处于选中态',
    )
    const switchIndex = beforeActive.findIndex((value) => value !== 'true')
    expectEqual(await clickNth('run-item', switchIndex), true, '可点选另一条运行')
    await waitFor('run-terminal')
    const afterActive = await attrs('run-item', 'data-active')
    expectEqual(afterActive[switchIndex], 'true', '选中态跟随点击切换')
    expectEqual(await visible('run-terminal'), true, '切换运行后终端页签仍在位')

    // 整页刷新后重新进入项目：运行列表来自后端持久化，不是前端缓存
    await click('project-back')
    await waitFor('projects-view')
    await browser.refresh()
    await waitForHostReady()
    await goHome()
    await openApp(APP_NAME)
    await waitFor('bedcode-root')
    if (!(await visible('project-workbench'))) {
      await click('nav-projects')
      await waitFor('projects-view')
      expectEqual(
        await clickContaining('project-card', E2E_PROJECT_DIR),
        true,
        '刷新后项目卡仍在',
      )
      await waitFor('project-workbench')
    }
    await waitForCount('run-item', runsAfter)
    expectEqual(await count('run-item'), runsAfter, '刷新后运行列表仍在')
  })
})
