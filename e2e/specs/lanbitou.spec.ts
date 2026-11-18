/**
 * Lanbitou 桌面端 E2E —— 真实宿主里挂载真实 wasm app 后，脚本驱动界面做功能测试
 *
 * 跑法（应用仓根）：
 *   node scripts/e2e.mjs --app lanbitou
 *
 * 判据纪律见 docs/E2E.md：
 * - 不依赖机器状态（本机已有多少笔记都不影响用例，必要时先清理）；
 * - 文案断言跨语言（保存状态取 zh-CN / en 并集）；
 * - 等状态不 sleep。
 */

import {
  allowFsAuthPrompts,
  click,
  exists,
  isDisabled,
  setValue,
  text,
  visible,
  waitFor,
  waitForHostReady,
  waitForText,
  waitGone,
} from '../harness/driver'
import { expectEqual } from '../harness/expect'
import { clickAppCard, goHome, waitForAppRoute } from '../harness/shell'
import {
  APP_NAME,
  ARCHIVED_TEXTS,
  COPIED_TEXTS,
  ARCHIVE_BANNER,
  ARCHIVE_BUTTON,
  ARCHIVE_CLOSE,
  ARCHIVE_LIST,
  READ_ONLY_TEXTS,
  SAVED_TEXTS,
  SCRATCH_ITEM,
  TAB_ARCHIVES,
  archiveItemsStartingWith,
  clearEditor,
  clickArchiveStartingWith,
  clickEditor,
  selectScratchNote,
  dragSelectFirstLine,
  editorText,
  firstNoteItemTestId,
  focusEditor,
  noteItemCount,
  selectedText,
  typeInEditor,
  waitForEditorText,
} from '../pages/lanbitou'

/** 新建一篇干净笔记（断言列表真的新增 + 编辑器为空，避免「新建没生效却打进上一篇」假绿） */
async function createNote(): Promise<void> {
  const before = await noteItemCount()
  await click('new-note')
  await waitFor('editor')
  // 列表项 testid 是 `note-item-<id>`（带后缀），不能按精确 testid 计数
  await browser.waitUntil(async () => (await noteItemCount()) === before + 1, {
    timeout: 10_000,
    interval: 120,
    timeoutMsg: `新建笔记后列表应变为 ${before + 1} 条`,
  })
  await browser.waitUntil(async () => (await editorText()).trim() === '', {
    timeout: 5_000,
    interval: 100,
    timeoutMsg: '新建笔记后编辑器应为空（新建可能没有生效）',
  })
}

describe('Lanbitou（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await goHome()
    // 首次打开会弹「文件访问授权」（挡住路由切换）：先点卡 → 点允许 → 再等路由。
    // 本 app 的数据根按 HOME 隔离（scripts/e2e.mjs 的 HOME_SCOPED_APPS），
    // 每次运行都是全新路径，所以每次首开都会弹一次。
    await clickAppCard(APP_NAME)
    await allowFsAuthPrompts()
    await waitForAppRoute(APP_NAME)
    await waitFor('lanbitou-root')
    // 视图模式是**持久化的工作偏好**：上一个用例切到「预览」后，本次打开就没有编辑器。
    // 用例之间不能靠隐式顺序耦合，统一显式回到分屏。
    await click('view-mode-split')
    await waitFor('editor')
  })

  it('主界面渲染：侧边栏 / 分区切换 / 工具栏 / 新建入口 / 状态栏就位', async () => {
    expectEqual(await visible('sidebar'), true, '侧边栏可见')
    expectEqual(await visible('toolbar'), true, '工具栏可见')
    expectEqual(await visible('sidebar-new-note'), true, '新建笔记入口可见')
    expectEqual(await visible('status-bar'), true, '状态栏可见')
    expectEqual(await exists('search-input'), true, '搜索框存在')
    expectEqual(await visible('sidebar-tab-notes'), true, '「笔记」分区可见')
    expectEqual(await visible(TAB_ARCHIVES), true, '「归档」分区可见')
  })

  it('新建笔记 → 输入 → 自动保存状态 → 预览渲染', async () => {
    await createNote()

    await typeInEditor('# 会议记录\n\n- 第一项\n- 第二项')
    await waitForEditorText('会议记录')
    // 实时自动保存（默认 500ms 防抖）：状态栏最终落到「已保存 / Saved」
    await waitForTextAny(['save-status'], SAVED_TEXTS)

    await click('view-mode-preview')
    await waitFor('markdown-preview')
    // 预览有 300ms 防抖：等内容真的渲染出来，而不是只等容器出现
    await waitForText('markdown-preview', '会议记录')
    const preview = (await text('markdown-preview')) ?? ''
    expectEqual(preview.includes('会议记录'), true, '预览包含标题文本')
    expectEqual(preview.includes('第一项'), true, '预览包含列表项')
  })

  it('搜索按标题过滤，清空恢复完整列表', async () => {
    await createNote()
    await typeInEditor('独特的检索词 Alpha')
    await waitForTextAny(['save-status'], SAVED_TEXTS)

    await createNote()
    await typeInEditor('另一篇 Beta')
    await waitForTextAny(['save-status'], SAVED_TEXTS)

    const before = await noteItemCount()
    expectEqual(before > 0, true, '列表存在条目')

    await setValue('search-input', 'Alpha')
    await waitForTextAny(['note-list'], ['Alpha'])

    await setValue('search-input', '')
    await waitFor('note-list')
    expectEqual((await noteItemCount()) >= before, true, '清空搜索后恢复完整列表')
  })

  it('插入时间分隔符：正文出现 --- … --- 行', async () => {
    await createNote()
    await typeInEditor('正文')
    await waitForTextAny(['save-status'], SAVED_TEXTS)

    await click('insert-time-divider')
    await waitForTextAny(['save-status'], SAVED_TEXTS)
    const content = await editorText()
    expectEqual(/--- .+ ---/.test(content), true, `正文应包含时间分隔符，实际：${content}`)
  })

  it('删除笔记：确认弹窗 → 取消保留 / 确认移除', async () => {
    await createNote()
    await typeInEditor('待删除笔记')
    await waitForTextAny(['save-status'], SAVED_TEXTS)

    await click('delete-note')
    await waitFor('confirm-dialog')
    await click('confirm-cancel')
    await waitGone('confirm-dialog')
    expectEqual((await editorText()).includes('待删除笔记'), true, '取消删除后内容仍在')

    const before = await noteItemCount()
    await click('delete-note')
    await waitFor('confirm-dialog')
    await click('confirm-ok')
    await waitGone('confirm-dialog')
    // 真删：列表少一条，且被删笔记的正文不再出现在编辑器里（不是只关弹窗）
    await browser.waitUntil(async () => (await noteItemCount()) === before - 1, {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: '确认删除后笔记列表应少一条',
    })
    expectEqual((await editorText()).includes('待删除笔记'), false, '被删笔记不再打开')
  })

  it('默认进入「临时记事」：常驻默认文档固定置顶、不给重命名/删除', async () => {
    // 默认文档存在且在列表第一位
    expectEqual(await exists(SCRATCH_ITEM), true, '临时记事在笔记列表里')
    const first = await firstNoteItemTestId()
    expectEqual(first, SCRATCH_ITEM, '临时记事固定在列表首位（不参与更新时间排序）')

    // 启动即打开它：编辑器已聚焦且内容 = 该笔记（这里只断言编辑器在场 + 标题是固定名）
    await waitFor('editor')
    const title = (await text(SCRATCH_ITEM)) ?? ''
    expectEqual(
      title.includes('临时记事') || title.includes('Scratchpad'),
      true,
      `默认文档标题应为固定名，实际：${title}`,
    )

    // 不给重命名 / 删除入口（默认文档不可删）
    expectEqual(await exists('note-rename-scratch'), false, '默认文档没有重命名入口')
    expectEqual(await exists('note-delete-scratch'), false, '默认文档没有删除入口')
  })

  it('鼠标框选：拖过正文能选中文字，复制链路取得到选区', async () => {
    await selectScratchNote()
    await clearEditor()
    await typeInEditor('鼠标框选测试 ABCDEFG')
    await waitForTextAny(['save-status'], SAVED_TEXTS)

    await dragSelectFirstLine()
    const selected = await selectedText()
    expectEqual(selected.length > 0, true, `拖选后应选中文本，实际选中：${JSON.stringify(selected)}`)

    // 复制链路（编辑器选区 → 工具栏 → 宿主剪贴板）：用键盘全选驱动。
    // 鼠标拖选在 WebDriver 里只落到 WebView 的原生选区层，CodeMirror 收不到合成指针
    // 事件（自动化通道限制，不是产品行为；真实指针下的选区/Ctrl+C 由
    // docs/E2E.md §9 的人工目验与 WebKit harness 覆盖）。
    await clickEditor()
    await browser.keys(['Control', 'a'])
    await click('copy-selection')
    await waitForTextAny(['status-toast'], COPIED_TEXTS)

    // 选区配色：token 必须解析成非透明色（否则框选看起来像没生效）
    const tokenBg = await browser.execute(() =>
      getComputedStyle(document.querySelector('.lanbitou-root'))
        .getPropertyValue('--lb-selection-bg')
        .trim(),
    )
    expectEqual(
      !!tokenBg && !/^transparent$|^rgba\(0, 0, 0, 0\)$/.test(tokenBg),
      true,
      `选区底色 token 必须是可见色，实际：${tokenBg}`,
    )
  })

  it('Ctrl+Z 不吞正文：切回已保存笔记后撤销不会清空', async () => {
    await selectScratchNote()
    await clearEditor()
    await typeInEditor('撤销测试正文')
    await waitForTextAny(['save-status'], SAVED_TEXTS)

    // 切到另一篇再切回来：程序化换文档进了撤销栈的话，这里 Ctrl+Z 会把正文撤成空
    await createNote()
    await click(SCRATCH_ITEM)
    await browser.waitUntil(async () => (await editorText()).includes('撤销测试正文'), {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: '切回笔记后编辑器没有载入正文',
    })

    await focusEditor()
    await browser.keys(['Control', 'z'])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expectEqual(
      (await editorText()).includes('撤销测试正文'),
      true,
      '刚打开的正文不得被 Ctrl+Z 撤掉（否则自动保存会把空内容写回磁盘）',
    )
  })

  it('归档临时记事：确认后剪空源文档，归档页出现时间范围记录且只读', async () => {
    await selectScratchNote()
    await clearEditor()
    await typeInEditor('--- 2026-01-02 周五 09:00 ---\n归档内容甲')
    await waitForEditorText('2026-01-02')
    await waitForTextAny(['save-status'], SAVED_TEXTS)

    // 归档按钮只对「有正文的临时记事」可用：先把不可点的原因说清楚（不然只会等到弹窗超时）
    expectEqual(
      await isDisabled(ARCHIVE_BUTTON),
      false,
      `归档按钮应可点（当前正文：${await editorText()}）`,
    )
    await click(ARCHIVE_BUTTON)
    await waitFor('confirm-dialog')
    await click('confirm-ok')
    await waitGone('confirm-dialog')

    // 源文档被剪空 + 状态栏提示归档名
    await browser.waitUntil(async () => (await editorText()).trim() === '', {
      timeout: 10_000,
      interval: 150,
      timeoutMsg: '归档后临时记事应被清空',
    })
    await waitForTextAny(['status-toast'], ARCHIVED_TEXTS)

    // 归档清单出现「起日_今日」记录（终落日随运行当天变，只钉前缀）
    await click(TAB_ARCHIVES)
    await waitFor(ARCHIVE_LIST)
    await browser.waitUntil(async () => (await archiveItemsStartingWith('2026-01-02')) > 0, {
      timeout: 10_000,
      interval: 150,
      timeoutMsg: '归档页应出现以起日开头的时间范围记录',
    })

    // 打开归档：只读横幅 + 内容原样
    expectEqual(await clickArchiveStartingWith('2026-01-02'), true, '归档条目应可点开')
    await waitFor(ARCHIVE_BANNER)
    const banner = (await text(ARCHIVE_BANNER)) ?? ''
    expectEqual(banner.includes('只读') || banner.includes('Read-only'), true, `归档横幅应标明只读，实际：${banner}`)
    expectEqual((await editorText()).includes('归档内容甲'), true, '归档正文应为剪走的原文')

    // 只读：输入不改变内容
    await focusEditor()
    await browser.keys(['X', 'Y', 'Z'])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expectEqual(
      (await editorText()).includes('归档内容甲'),
      true,
      '归档文档不可被就地改写',
    )
    expectEqual((await editorText()).includes('XYZ'), false, '归档文档不接受键盘输入')

    // 返回笔记：回到编辑面，归档按钮回到禁用（临时记事已空）
    await click(ARCHIVE_CLOSE)
    await waitGone(ARCHIVE_BANNER)
    expectEqual(await isDisabled(ARCHIVE_BUTTON), true, '临时记事为空时归档按钮应禁用')
  })

  it('设置页：打开 → 切换深色主题 → 保存后不重载页面', async () => {
    await click('open-settings')
    await waitFor('settings-dialog')

    await click('setting-theme')
    await waitFor('setting-theme-panel')
    await click('setting-theme-option-dark')
    await click('settings-save')
    await waitGone('settings-dialog')

    // 保存不再触发整页重载：应用根仍在、编辑器仍可用
    expectEqual(await visible('lanbitou-root'), true, '应用根仍在')
    expectEqual(
      await browser.execute(() =>
        document.querySelector('[data-testid="lanbitou-root"]')?.getAttribute('data-theme'),
      ),
      'dark',
      '主题覆盖已应用',
    )
  })
})

/** 等待 testid 文本命中任一期望值（跨语言文案断言；沿用 harness 的 waitUntil 轮询，不用固定 sleep） */
async function waitForTextAny(
  testids: string[],
  expected: string[],
  timeout = 10_000,
): Promise<void> {
  await browser.waitUntil(
    async () => {
      for (const testid of testids) {
        const current = (await text(testid)) ?? ''
        if (expected.some((value) => current.includes(value))) return true
      }
      return false
    },
    {
      timeout,
      interval: 150,
      timeoutMsg: `等待文案超时：${testids.join(', ')} ∈ ${expected.join(' / ')}`,
    },
  )
}
