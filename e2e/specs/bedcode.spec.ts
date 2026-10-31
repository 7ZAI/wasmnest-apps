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
  DEFAULT_TIMEOUT,
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

/**
 * 等运行列表到稳态再读数：进工作台（project-workbench 可见）≠ 运行列表已加载，
 * 项目复用历史运行时立刻 count 会读到 0，让「新增一条」断言整体错位。
 */
async function waitForRunsSettled(): Promise<void> {
  await browser.waitUntil(
    async () => (await count('run-item')) > 0 || (await visible('run-empty')),
    {
      timeout: DEFAULT_TIMEOUT,
      interval: 150,
      timeoutMsg: '运行列表未到稳态（无 run-item 也无空态提示）',
    },
  )
}

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
    await waitForRunsSettled()
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

  // ==================== 对话面（ADR 0004 / issue #23 M3） ====================

  /**
   * 对话面接 run.events 的真实回环：桥接扩展随 run.start 部署进项目目录 →
   * opencode 启动后回连 run-events / run-commands 回环（任意轮询都 touch 心跳）
   * → 输入解锁 → 消息经 run.send 上行并回显 → 停止后输入带原因禁用。
   *
   * 判据纪律：断言状态位（testid 有无 / data-status）而非文案；不依赖模型
   * 可用性——助手侧流式 / 工具状态机 / patch 卡属人工验收（handoff §5.1），
   * 脚本层只证「事件回环 + 发送 / 停止入口」。
   */
  it('项目：对话面桥接在线、事件上行、发送与停止入口', async () => {
    await click('nav-projects')
    await waitFor('projects-view')

    await click('projects-create')
    await waitFor('project-form-dir')
    await typeInto('project-form-dir', E2E_PROJECT_DIR)
    await click('project-form-submit')
    await waitFor('project-workbench')

    // 起一条真实 opencode 运行（桥接扩展随会话创建部署进项目目录）
    await waitForRunsSettled()
    const runsBefore = await count('run-item')
    await click('run-new')
    await waitFor('run-agent-opencode')
    await click('run-agent-opencode')
    await allowFsAuthPrompts()
    await waitForCount('run-item', runsBefore + 1)
    await waitFor('run-terminal')

    // 对话面在位；桥接回连后输入才解锁——chat-input 只在启用态渲染 testid，
    // 禁用态只有 chat-input-reason（禁用必给原因，不渲染灰假输入框）。
    await waitFor('conversation-surface')
    await waitFor('chat-input', 30_000)
    expectEqual(await exists('chat-mirror-banner'), false, '桥接在线不显示镜像横幅')
    // status / session.meta 不进时间线：桥接在线但尚无对话行时是空态而非报错
    expectEqual(await visible('chat-empty'), true, '无对话行时显示空态')

    // 发送入口：文本经 run.send 上行，命令被桥接领取并执行（现场建会话 + prompt
    // 被接受）——「排队中」本地气泡即发送链路的 UI 证词；事件流回显（用户气泡
    // chat-row-user）依赖可用模型（本机 opencode 工作区隐私门拒绝其默认模型），
    // 属人工验收（handoff §5.1），不进脚本判据。
    await typeInto('chat-input', 'e2e 对话面探针：收到请原样回复 ok')
    await click('chat-send')
    await waitFor('chat-row-pending', 15_000)

    // 事件上行：检查器「事件」页签出现归一行——桥接对 session.created 的
    // status 上行不依赖模型（会话由发送侧现场创建），足以证明回环闭环
    await click('inspector-tab-events')
    await waitForCount('inspector-event-row', 1, 30_000)

    // 停止入口：复用 session.close 停止链 → 运行转终态 → 输入带原因禁用
    await click('chat-stop')
    await waitGone('chat-input')
    await waitFor('chat-input-reason')
    await browser.waitUntil(
      async () => {
        const statuses = await attrs('run-item', 'data-status')
        const actives = await attrs('run-item', 'data-active')
        const idx = actives.indexOf('true')
        return idx >= 0 && statuses[idx] !== 'running' && statuses[idx] !== 'starting'
      },
      { timeout: 15_000, interval: 200, timeoutMsg: '停止后运行未转终态（run-item data-status）' },
    )
  })
})
