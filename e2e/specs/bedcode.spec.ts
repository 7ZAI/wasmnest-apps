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

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { browser } from '@wdio/globals'
import {
  attr,
  attrs,
  allowFsAuthPrompts,
  click,
  clickContaining,
  clickNth,
  count,
  DEFAULT_TIMEOUT,
  exists,
  isDisabled,
  text,
  typeInto,
  value,
  visible,
  waitFor,
  waitForAttr,
  waitForCount,
  waitForHostReady,
  waitForTerminalOutput,
  waitForText,
  waitGone,
} from '../harness/driver'
import { expectEqual } from '../harness/expect'
import { goHome, openApp } from '../harness/shell'

/** 应用显示名（= bedcode 的 plugin.json `name`） */
const APP_NAME = 'BedCode'

/** 侧边栏七个目录（= `useSidebarMenu` 的菜单项 id，顺序即视觉顺序） */
const NAV_ITEMS = [
  { id: 'pairing', view: 'pairing-view' },
  { id: 'projects', view: 'projects-view' },
  { id: 'sessions', view: 'sessions-view' },
  { id: 'agents', view: 'hub-view' },
  { id: 'orchestrations', view: 'orchestration-list' },
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

/** 文件树锚点文件：内容固定，真实宿主里点开可断言「读到的就是磁盘上的字节」 */
const E2E_PROJECT_FILE = 'bedcode-e2e.txt'
const E2E_PROJECT_FILE_TEXT = 'bedcode e2e file tree'
writeFileSync(join(E2E_PROJECT_DIR, E2E_PROJECT_FILE), `${E2E_PROJECT_FILE_TEXT}\n`)

/**
 * 项目目录做成真实 git 仓库（幂等）：Git 页签用例要在真实宿主里读到提交图，
 * 而不是只验非仓库空态。用 `-c user.*` 传身份，不依赖机器全局 git 配置。
 */
function ensureGitSeed(): void {
  if (existsSync(join(E2E_PROJECT_DIR, '.git'))) {
    try {
      // 已有仓库也可能停在「init 了但没有提交」的中间态（上次中断）
      execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
        cwd: E2E_PROJECT_DIR,
        stdio: 'ignore',
      })
      return
    } catch {
      // 无 HEAD：继续补一次 seed commit
    }
  } else {
    execFileSync('git', ['init', '-q'], { cwd: E2E_PROJECT_DIR })
  }
  // 只提交本用例的锚点文件：项目目录可能混有 agent 运行产物，别把无关文件塞进种子仓库
  execFileSync('git', ['add', E2E_PROJECT_FILE], { cwd: E2E_PROJECT_DIR })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=BedCode E2E',
      '-c',
      'user.email=bedcode-e2e@example.invalid',
      'commit',
      '-qm',
      'e2e seed commit',
    ],
    { cwd: E2E_PROJECT_DIR },
  )
}
ensureGitSeed()

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

  it('侧边栏渲染七个目录项', async () => {
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
    // 同目录项目跨次复用：进工作台时**可能**已有历史运行，终端主面不是本步骤
    // 产生的元素（无运行时主面渲染 workbench-empty）。这里只断言主面结构在位。
    expectEqual(await exists('pane-terminal'), true, '终端主面在位')

    // 折叠状态 / 拼屏模式都是按项目持久化的偏好：用例先归一到「两侧展开 + 单屏」，
    // 不依赖上一轮或人工操作留下的布局（否则第一下点收起反而会把已收起的面板展开）。
    if (await exists('pane-runs-rail')) {
      await click('run-collapse')
      await waitFor('pane-runs')
    }
    if (await exists('pane-inspector-rail')) {
      await click('inspector-collapse')
      await waitFor('pane-inspector')
    }
    if ((await attr('run-tile-toggle', 'aria-pressed')) === 'true') {
      await click('run-tile-toggle')
      await waitGone('run-tile-grid')
    }

    // 右栏「文件」页签：真实宿主里按项目 workingDir 读目录（project.file-tree），
    // 点文件走 project.file-content 读出真实字节。手输目录的项目首次读树会触发
    // fs 授权，这里同真实用户一样点允许。
    //
    // 页签选择会持久化（工作台记住上次停留位置），用例显式切回文件页签，不依赖
    // 宿主持久状态——上一轮停在 Git / 变更时「默认文件页签」不是必然事实。
    await click('inspector-tab-files')
    await waitFor('project-files')
    expectEqual(await attr('inspector-tab-files', 'aria-selected'), 'true', '文件页签选中')
    expectEqual(await visible('project-files'), true, '文件面板可见')
    await allowFsAuthPrompts()
    await waitForCount('file-tree-item', 1)
    expectEqual(
      await clickContaining('file-tree-item', E2E_PROJECT_FILE),
      true,
      '目录树里有锚点文件',
    )
    await waitFor('project-file-viewer')
    await waitForText('project-file-viewer', E2E_PROJECT_FILE_TEXT)
    expectEqual(await text('project-file-viewer-name'), E2E_PROJECT_FILE, '查看器标题 = 文件名')
    await click('file-viewer-close')
    await waitGone('project-file-viewer')

    // Git 页签：文件树旁的提交图。项目目录是真 git 仓库（脚本预置 seed commit），
    // 在真实宿主里走 project.git-log 读提交并渲染提交行与当前分支。
    await click('inspector-tab-git')
    await waitFor('project-git')
    await waitForCount('git-commit-row', 1)
    expectEqual(await visible('inspector-git'), true, 'Git 面板可见')
    expectEqual(await visible('project-files'), false, 'Git 页签隐藏文件面板')
    expectEqual(await exists('git-not-repo'), false, '目录是真 git 仓库')
    expectEqual((await text('git-branch')).length > 0, true, '显示当前分支')

    // 页签切换：文件 ↔ 变更
    //
    // 变更面板有两种形态：有选中运行 = 占位卡（inspector-changes），无运行 = 先选一条
    // 运行（inspector-empty）。本步骤只验页签切换，不能假定项目已有历史运行——
    // 全新项目（或刚清理过数据）里没有任何运行，钉死 inspector-changes 就是状态依赖。
    await click('inspector-tab-changes')
    await waitForAttr('inspector-tab-changes', 'aria-selected', 'true', 5_000)
    expectEqual(await visible('project-files'), false, '变更页签隐藏文件面板')
    expectEqual(
      (await exists('inspector-changes')) || (await exists('inspector-empty')),
      true,
      '变更面板在位（占位卡或先选运行）',
    )
    await click('inspector-tab-files')
    await waitFor('project-files')

    // 两侧面板可折叠：收起后完全不渲染（宽度还给终端），窄轨常驻当恢复入口
    await click('run-collapse')
    await waitFor('pane-runs-rail')
    expectEqual(await exists('pane-runs'), false, '收起后不渲染运行列表')
    expectEqual(await exists('split-runs'), false, '收起后不留空手柄')
    await click('run-collapse')
    await waitFor('pane-runs')
    expectEqual(await visible('split-runs'), true, '再点同一入口展开运行列表')

    await click('inspector-collapse')
    await waitFor('pane-inspector-rail')
    expectEqual(await exists('pane-inspector'), false, '收起后不渲染检查器面板')
    await click('inspector-collapse')
    await waitFor('pane-inspector')
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
    expectEqual(await visible('run-terminal'), true, '终端主面显示该运行的终端')

    // 终端真实字节：证明 PTY 已起且输出进了渲染管线（不是只有空面板）
    const output = await waitForTerminalOutput()
    expectEqual(output.trim().length > 0, true, '终端主面有真实输出')

    // 第二条运行：同一项目并发
    await click('run-new')
    await waitFor('run-agent-opencode')
    await click('run-agent-opencode')
    await allowFsAuthPrompts()
    await waitForCount('run-item', runsBefore + 2)
    const runsAfter = await count('run-item')
    expectEqual(runsAfter, runsBefore + 2, '同一项目可并发第二条运行')

    // 运行间切换：选中态跟随点击，终端主面保持
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
    expectEqual(await visible('run-terminal'), true, '切换运行后终端主面仍在位')

    // 拼屏（多终端同屏）：两条存活运行各一格，点格子换焦点，退出回单屏。
    // 只铺存活运行——本用例刚起了两条 running，格子数应为 2。
    await click('run-tile-toggle')
    await waitFor('run-tile-grid')
    await waitForCount('run-tile', 2)
    expectEqual(await count('run-tile'), 2, '拼屏铺开两条存活运行')
    expectEqual(await exists('run-terminal'), false, '拼屏时不渲染单屏主面')
    // 点第二格的标题条换焦点（格中心的 xterm 也会经 focusin 换焦点，但标题条更稳定）
    expectEqual(await clickNth('run-tile-header', 1), true, '可点选第二格')
    const tileActive = await attrs('run-tile', 'data-active')
    expectEqual(tileActive[1], 'true', '焦点格跟随点击')
    expectEqual(tileActive.filter((value) => value === 'true').length, 1, '始终只有一格聚焦')
    await click('run-tile-toggle')
    await waitGone('run-tile-grid')
    await waitFor('run-terminal')
    expectEqual(await visible('run-terminal'), true, '退出拼屏回到单屏终端')

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
      expectEqual(await clickContaining('project-card', E2E_PROJECT_DIR), true, '刷新后项目卡仍在')
      await waitFor('project-workbench')
    }
    await waitForCount('run-item', runsAfter)
    expectEqual(await count('run-item'), runsAfter, '刷新后运行列表仍在')
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

    // 表单会预填「上次成功保存的默认值」（workingDir / command），在跑过用例的机器上
    // 字段非空——「空表单」的前提要由用例自己建立，不能指望机器是干净的。
    await typeInto('session-input-working-dir', '')

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

  /**
   * 任务日志时间筛选：日期框必须为日历图标留出间隔。
   *
   * 回归成因（2026-11-05）：Agent 管理把日期框主题全局注入 document.head，
   * `.dp__input` 左内边距被改成 16px（对齐 hub 的 .ah-input），而 vendor 日历
   * 图标占 8–22px → 任务日志的开始/结束时间文字压在图标上。用例先访问 Agent
   * 管理再回来，覆盖的正是「样式泄漏」路径。
   */
  /**
   * Agent 池：编排的选人面。默认用例只验入口与稳定锚点，不创建成员——
   * 创建依赖本机已安装 pi/opencode，属于显式 E2E（bedcode.visual.spec.ts）
   * 的机器前提，不能污染默认套件的「不依赖机器状态」纪律。
   */
  it('Agent 池：从 Agent 编排进入，空态 / 成员清单可见', async () => {
    await click('nav-orchestrations')
    await waitFor('orchestration-list')
    await click('orchestration-tab-pool')
    await waitFor('orchestration-pool')

    // 池成员是异步取数：等「卡片 / 空态 / 错误」之一落定，避免把加载态当空态
    await browser.waitUntil(
      async () =>
        (await exists('orchestration-pool-card')) ||
        (await exists('orchestration-pool-empty')) ||
        (await exists('orchestration-pool-error')),
      { timeout: 15_000, interval: 150, timeoutMsg: 'Agent 池取数未落定' },
    )
    const hasCards = await exists('orchestration-pool-card')
    const hasEmpty = await exists('orchestration-pool-empty')
    expectEqual(hasCards || hasEmpty, true, 'Agent 池渲染成员清单或空态')
    expectEqual(await exists('orchestration-pool-create'), true, '新建 Agent 入口可见')
    // 复位到会话页：本用例只验入口，不把下一个用例的起始路由留在编排域
    await click('orchestration-tab-list')
    await waitFor('orchestration-list')
    await click('nav-sessions')
    await waitFor('sessions-view')
  })

  it('任务日志时间筛选：日期框为日历图标留出间隔（先访问 Agent 管理后仍成立）', async () => {
    await click('nav-agents')
    await waitFor('hub-view')
    await click('nav-tasks')
    await waitFor('tasks-view')
    await click('tasks-tab-records')
    await waitFor('tasks-panel-records')
    await waitFor('task-filter-since')

    const spacing = (await browser.execute(() => {
      const root = document.querySelector('[data-testid="task-filter-since"]') as HTMLElement | null
      const input = root?.querySelector('input') as HTMLElement | null
      const icon = root?.querySelector('.dp__input_icon') as HTMLElement | null
      if (!root || !input || !icon) return null
      const inputRect = input.getBoundingClientRect()
      const iconRect = icon.getBoundingClientRect()
      const padLeft = parseFloat(getComputedStyle(input).paddingLeft || '0')
      return {
        padLeft,
        gap: inputRect.left + padLeft - iconRect.right,
        iconWidth: iconRect.width,
      }
    })) as { padLeft: number; gap: number; iconWidth: number } | null

    expectEqual(spacing !== null, true, '开始时间日期框渲染出输入框与日历图标')
    expectEqual((spacing?.iconWidth ?? 0) > 0, true, '日历图标可见')
    expectEqual((spacing?.padLeft ?? 0) >= 30, true, '左内边距为图标预留 ≥30px')
    expectEqual((spacing?.gap ?? -1) >= 4, true, '图标与文字间隔 ≥4px')
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
