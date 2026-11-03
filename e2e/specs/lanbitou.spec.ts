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
  setValue,
  text,
  visible,
  waitFor,
  waitForHostReady,
  waitGone,
} from '../harness/driver'
import { expectEqual } from '../harness/expect'
import { goHome, openApp } from '../harness/shell'

/** 应用显示名（= lanbitou 的 plugin.json `name`） */
const APP_NAME = 'Lanbitou'

/** CodeMirror 内容区（contenteditable，非 input/textarea —— typeInto 不适用） */
async function focusEditor(): Promise<void> {
  await browser.execute(() => {
    const el = document.querySelector('[data-testid="editor"] .cm-content') as HTMLElement | null
    el?.focus()
  })
}

/** 向当前聚焦的 CodeMirror 输入文本（逐键触发真实编辑事件） */
async function typeInEditor(value: string): Promise<void> {
  await focusEditor()
  await browser.keys(value.split('').map((ch) => (ch === '\n' ? 'Enter' : ch)))
}

/** 当前列表条目数（笔记项 testid 形如 note-item-<uuid>） */
function noteItemCount(): Promise<number> {
  return browser.execute(() => document.querySelectorAll('[data-testid^="note-item-"]').length)
}

/** 读取编辑器可见文本（含换行） */
function editorText(): Promise<string> {
  return browser.execute(() => {
    const el = document.querySelector('[data-testid="editor"] .cm-content')
    return el?.textContent ?? ''
  })
}

/** 新建一篇干净笔记（列表项 id 未知，用工具栏新建入口） */
async function createNote(): Promise<void> {
  await click('new-note')
  await waitFor('editor')
}

describe('Lanbitou（桌面端 · 宿主内挂载）', () => {
  beforeEach(async () => {
    await waitForHostReady()
    await goHome()
    await openApp(APP_NAME)
    // 激活期集中申请数据目录授权：同意一次后宿主记住
    await allowFsAuthPrompts()
    await waitFor('lanbitou-root')
  })

  it('主界面渲染：侧边栏 / 工具栏 / 新建入口 / 状态栏就位', async () => {
    expectEqual(await visible('sidebar'), true, '侧边栏可见')
    expectEqual(await visible('toolbar'), true, '工具栏可见')
    expectEqual(await visible('sidebar-new-note'), true, '新建笔记入口可见')
    expectEqual(await visible('status-bar'), true, '状态栏可见')
    expectEqual(await exists('search-input'), true, '搜索框存在')
  })

  it('新建笔记 → 输入 → 自动保存状态 → 预览渲染', async () => {
    await createNote()

    await typeInEditor('# 会议记录\n\n- 第一项\n- 第二项')
    // 实时自动保存（默认 500ms 防抖）：状态栏最终落到「已保存 / Saved」
    await waitForTextAny(['save-status'], ['已保存', 'Saved'])

    await click('view-mode-preview')
    await waitFor('markdown-preview')
    const preview = (await text('markdown-preview')) ?? ''
    expectEqual(preview.includes('会议记录'), true, '预览包含标题文本')
    expectEqual(preview.includes('第一项'), true, '预览包含列表项')
  })

  it('搜索按标题过滤，清空恢复完整列表', async () => {
    await createNote()
    await typeInEditor('独特的检索词 Alpha')
    await waitForTextAny(['save-status'], ['已保存', 'Saved'])

    await createNote()
    await typeInEditor('另一篇 Beta')
    await waitForTextAny(['save-status'], ['已保存', 'Saved'])

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
    await waitForTextAny(['save-status'], ['已保存', 'Saved'])

    await click('insert-time-divider')
    await waitForTextAny(['save-status'], ['已保存', 'Saved'])
    const content = await editorText()
    expectEqual(/--- .+ ---/.test(content), true, `正文应包含时间分隔符，实际：${content}`)
  })

  it('删除笔记：确认弹窗 → 取消保留 / 确认移除', async () => {
    await createNote()
    await typeInEditor('待删除笔记')
    await waitForTextAny(['save-status'], ['已保存', 'Saved'])

    await click('delete-note')
    await waitFor('confirm-dialog')
    await click('confirm-cancel')
    await waitGone('confirm-dialog')

    await click('delete-note')
    await waitFor('confirm-dialog')
    await click('confirm-ok')
    await waitGone('confirm-dialog')
    expectEqual(await exists('confirm-dialog'), false, '确认弹窗已关闭')
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

/** 等待 testid 文本命中任一期望值（跨语言文案断言） */
async function waitForTextAny(
  testids: string[],
  expected: string[],
  timeout = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const testid of testids) {
      const current = (await text(testid)) ?? ''
      if (expected.some((value) => current.includes(value))) return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`等待文案超时：${testids.join(', ')} ∈ ${expected.join(' / ')}`)
}
