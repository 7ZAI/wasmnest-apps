/**
 * Lanbitou 页面对象（桌面 E2E）
 *
 * 组件内部结构（CodeMirror 的 `.cm-*`、笔记项 testid 前缀）只出现在这里；
 * spec 里只写「用户做了什么 + 看得见什么」（docs/E2E.md 分层纪律）。
 */

/** 应用显示名（= lanbitou/desktop/plugin.json `name`） */
export const APP_NAME = 'Lanbitou'

/** 编辑容器（笔记面与归档只读面共用同一个 testid，同屏只会有一个） */
export const EDITOR = 'editor'

/** 侧栏分区与归档面 */
export const TAB_NOTES = 'sidebar-tab-notes'
export const TAB_ARCHIVES = 'sidebar-tab-archives'
export const ARCHIVE_BUTTON = 'archive-scratch'
export const ARCHIVE_LIST = 'archive-list'
export const ARCHIVE_BANNER = 'archive-banner'
export const ARCHIVE_CLOSE = 'archive-close'
/** 归档条目 testid 前缀（完整值 = 前缀 + 时间范围名） */
export const ARCHIVE_ITEM_PREFIX = 'archive-item-'
/** 临时记事（默认文档）固定 id，列表项 testid = `note-item-scratch` */
export const SCRATCH_ITEM = 'note-item-scratch'

/** 已保存文案（zh-CN / en 并集：文案断言跨语言） */
export const SAVED_TEXTS = ['已保存', 'Saved'] as const
/** 归档完成提示前缀 */
export const ARCHIVED_TEXTS = ['已归档', 'Archived'] as const
/** 只读标注（归档面） */
export const READ_ONLY_TEXTS = ['只读', 'Read-only'] as const
/** 复制成功提示（工具栏复制选中内容） */
export const COPIED_TEXTS = ['已复制', 'Copied'] as const

/** 聚焦编辑器内容区（contenteditable，非 input/textarea） */
export async function focusEditor(): Promise<void> {
  await browser.execute((testid) => {
    const el = document.querySelector(`[data-testid="${testid}"] .cm-content`) as HTMLElement | null
    el?.focus()
  }, EDITOR)
}

/**
 * 真点编辑器把焦点和光标落进去
 *
 * 只用 JS `.focus()` 在 WebKit 里不稳定（contenteditable 需要真实指针事件才算进编辑态），
 * 之后 `browser.keys` 可能打给别的元素。
 */
export async function clickEditor(): Promise<void> {
  const content = await $('[data-testid="editor"] .cm-content')
  if (!(await content.isExisting())) throw new Error('编辑器内容区未渲染')
  await content.click()
}

/**
 * 向当前聚焦的编辑器逐键输入（真实编辑事件）
 *
 * 按行切块：`browser.keys` 一次塞入「多字节字符 + Enter」时，WebKitWebDriver 偶尔
 * 会把 Enter 与后一个字符挤在一起（实测出现过 "会-议" 这种串行化错位），
 * 分行发送并把 Enter 单独按，稳得多。
 */
export async function typeInEditor(value: string): Promise<void> {
  await clickEditor()
  const lines = value.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await browser.keys(['Enter'])
    if (lines[i]) await browser.keys(lines[i].split(''))
  }
}

/** 读取编辑器可见文本（CodeMirror 每行一个元素，textContent 不含换行） */
export function editorText(): Promise<string> {
  return browser.execute((testid) => {
    const el = document.querySelector(`[data-testid="${testid}"] .cm-content`)
    return el?.textContent ?? ''
  }, EDITOR)
}

/** 清空编辑器（全选删除），并等到真清空 */
export async function clearEditor(): Promise<void> {
  await clickEditor()
  await browser.keys(['Control', 'a'])
  await browser.keys(['Backspace'])
  await browser.waitUntil(async () => (await editorText()).trim() === '', {
    timeout: 5_000,
    interval: 100,
    timeoutMsg: `清空编辑器失败（Ctrl+A / Backspace 没生效），当前内容：${await editorText()}`,
  })
}

/**
 * 在首行做真实鼠标拖选
 *
 * 用 **element origin**：宿主窗口带标题栏，viewport 坐标在 tauri-driver →
 * WebKitWebDriver 链路上会与页面坐标偏移，落点跑到工具栏上。
 * 注意 W3C 语义：element origin 的 x/y 是**相对元素中心**的偏移，不是左上角。
 */
export async function dragSelectFirstLine(): Promise<void> {
  const line = await $('[data-testid="editor"] .cm-line')
  if (!(await line.isExisting())) throw new Error('编辑器首行不存在，无法拖选')

  const { width, height } = await line.getSize()
  const fromX = Math.round(-width / 2 + 6)
  const toX = Math.round(-width / 2 + Math.max(60, Math.min(width - 8, 300)))
  const y = Math.round(height / 2 - height / 2) // 元素中心线

  await browser
    .action('pointer', { parameters: { pointerType: 'mouse' } })
    .move({ origin: line, x: fromX, y })
    .down({ button: 0 })
    .move({ origin: line, x: toX, y, duration: 150 })
    .up({ button: 0 })
    .perform()
}

/** 当前 WebView 的选区文本 */
export function selectedText(): Promise<string> {
  return browser.execute(() => window.getSelection()?.toString() ?? '')
}

/** 笔记列表条目数（scratch + 普通笔记） */
export function noteItemCount(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll('[data-testid^="note-item-"]').length,
  )
}

/** 切到「笔记」分区并选中临时记事（用例之间不要依赖「上次停在哪个文档」） */
export async function selectScratchNote(): Promise<void> {
  const notesTab = await $('[data-testid="sidebar-tab-notes"]')
  await notesTab.click()
  const item = await $(`[data-testid="${SCRATCH_ITEM}"]`)
  await item.click()
  await browser.waitUntil(async () => (await $('[data-testid="editor"] .cm-content')).isExisting(), {
    timeout: 5_000,
    interval: 100,
    timeoutMsg: '选中临时记事后编辑器未渲染',
  })
}

/** 当前笔记列表首项的 testid（默认文档应固定在首位） */
export function firstNoteItemTestId(): Promise<string | null> {
  return browser.execute(
    () => document.querySelector('[data-testid^="note-item-"]')?.getAttribute('data-testid') ?? null,
  )
}

/** 点开归档页里以某前缀开头的第一条（终落日随运行当天变，只能按前缀定位） */
export async function clickArchiveStartingWith(prefix: string): Promise<boolean> {
  return browser.execute((p) => {
    const el = document.querySelector(`[data-testid^="archive-item-${p}"]`) as HTMLElement | null
    if (!el) return false
    el.click()
    return true
  }, prefix)
}

/** 等编辑器正文包含某段文本（输入是否真落进正文的判据） */
export async function waitForEditorText(needle: string, timeout = 10_000): Promise<void> {
  await browser.waitUntil(async () => (await editorText()).includes(needle), {
    timeout,
    interval: 120,
    timeoutMsg: `编辑器正文未出现「${needle}」，当前：${await editorText()}`,
  })
}

/** 归档页里以某前缀开头的条目数（终落日随运行当天变，只能钉前缀） */
export function archiveItemsStartingWith(prefix: string): Promise<number> {
  return browser.execute(
    (p) => document.querySelectorAll(`[data-testid^="${p}"]`).length,
    `${ARCHIVE_ITEM_PREFIX}${prefix}`,
  )
}
