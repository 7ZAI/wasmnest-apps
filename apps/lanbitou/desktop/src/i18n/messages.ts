/** Lanbitou i18n 消息表形状（zh-CN / en 必须同键） */
export interface MessageSchema {
  appTitle: string

  newNote: string
  untitled: string
  renameNote: string
  deleteNote: string
  deleteConfirmTitle: string
  deleteConfirmBody: string
  cancel: string
  save: string

  searchPlaceholder: string
  clearSearch: string
  noNotes: string
  noNotesHint: string
  noSearchResults: string

  editMode: string
  previewMode: string
  splitMode: string

  insertTimeDivider: string
  timeDividerSettings: string

  settings: string
  settingsSectionEditor: string
  autoSaveMode: string
  autoSaveRealtime: string
  autoSaveOnBlur: string
  autoSaveManual: string
  autoSaveDebounce: string
  fontSize: string
  fontFamily: string
  fontMonospace: string
  fontSansSerif: string
  fontSerif: string
  theme: string
  themeSystem: string
  themeLight: string
  themeDark: string
  language: string
  decrease: string
  increase: string

  timeDividerEnabled: string
  timeDividerFormat: string
  timeDividerFormatHint: string
  timeDividerPosition: string
  positionTop: string
  positionBottom: string
  positionCursor: string
  timeDividerInterval: string
  intervalOff: string
  intervalMinutes: string

  saveNow: string
  copySelection: string
  pasteFromClipboard: string
  toggleSidebar: string

  saveStatusIdle: string
  saveStatusUnsaved: string
  saveStatusSaving: string
  saveStatusSaved: string
  saveStatusError: string
  saveFailed: string
  copied: string
  pasteEmpty: string
  clipboardReadFailed: string

  wordCount: string
  charCount: string
  lastModified: string
  never: string

  justNow: string
  minutesAgo: string
  hoursAgo: string
  daysAgo: string

  previewRecentNote: string
  previewNoteCount: string
  previewNoNote: string
  previewNoNoteHint: string
}
