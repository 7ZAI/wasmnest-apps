/**
 * Lanbitou 领域类型（前端唯一类型真源）
 */

/** 笔记（命令面 camelCase 与 Rust `Note` 同形） */
export interface Note {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  filePath: string
}

/**
 * 临时记事（默认文档）固定 id：与 Rust `store::SCRATCH_ID` 同值
 *
 * 它常驻、默认打开、不可删除，且是归档的唯一源文档。
 */
export const SCRATCH_NOTE_ID = 'scratch'

/** 归档条目（= `archives/<时间范围>.md`） */
export interface Archive {
  id: string
  title: string
  fileName: string
  size: number
}

/** 归档正文（只读面） */
export interface ArchiveDetail {
  archive: Archive
  content: string
}

/** 侧栏分区：笔记 / 归档 */
export type SidebarTab = 'notes' | 'archives'

/** 视图模式：纯编辑 / 纯预览 / 左右分屏 */
export type ViewMode = 'edit' | 'preview' | 'split'

/** 保存状态（状态栏展示） */
export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'

/** 自动保存模式 */
export type AutoSaveMode = 'realtime' | 'onBlur' | 'manual'

/** 主题模式 */
export type ThemeMode = 'system' | 'light' | 'dark'

/** 时间分隔符插入位置 */
export type DividerPosition = 'top' | 'bottom' | 'cursor'

/** 编辑器字体族 */
export type FontFamily = 'monospace' | 'sans-serif' | 'serif'

/** 界面语言 */
export type Locale = 'zh-CN' | 'en'

/** 时间分隔符配置 */
export interface TimeDividerSettings {
  enabled: boolean
  /** 模板：{{date}} {{time}} {{datetime}} {{weekday}} {{timestamp}} */
  format: string
  position: DividerPosition
  /** 触发间隔（分钟；0 = 关闭） */
  triggerInterval: number
}

/** 应用设置（settings.json） */
export interface NoteSettings {
  autoSaveMode: AutoSaveMode
  autoSaveDebounce: number
  theme: ThemeMode
  fontSize: number
  fontFamily: FontFamily
  language: Locale
  /** 上次使用的视图模式（工具栏切换后持久化，重启恢复） */
  viewMode: ViewMode
  timeDivider: TimeDividerSettings
}

/** 光标位置（行号 1 起） */
export interface CursorPosition {
  line: number
  ch: number
}

/** 工作上下文（context.json） */
export interface WorkingContext {
  lastOpenedNoteId: string | null
  cursorPosition: CursorPosition | null
  scrollPosition: number | null
  lastEditTimestamp: number | null
  deletedDividerNotes: string[]
}

export const MIN_FONT_SIZE = 12
export const MAX_FONT_SIZE = 24
export const MIN_AUTO_SAVE_DEBOUNCE = 100
export const MAX_AUTO_SAVE_DEBOUNCE = 5000
export const PREVIEW_DEBOUNCE_MS = 300
export const DIVIDER_INTERVALS = [0, 1, 5, 10, 30] as const

export const DEFAULT_SETTINGS: NoteSettings = {
  autoSaveMode: 'realtime',
  autoSaveDebounce: 500,
  theme: 'system',
  fontSize: 14,
  fontFamily: 'monospace',
  language: 'zh-CN',
  viewMode: 'split',
  timeDivider: {
    enabled: true,
    format: '--- {{date}} {{weekday}} {{time}} ---',
    position: 'bottom',
    triggerInterval: 5,
  },
}

export const DEFAULT_CONTEXT: WorkingContext = {
  lastOpenedNoteId: null,
  cursorPosition: null,
  scrollPosition: null,
  lastEditTimestamp: null,
  deletedDividerNotes: [],
}
