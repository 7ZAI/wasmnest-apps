export interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface WorkingContext {
  lastOpenedNoteId: string | null
  cursorPosition: { line: number; ch: number } | null
  scrollPosition: number | null
  lastEditTimestamp: number | null
  deletedDividerNotes: string[]
}

export interface AppSettings {
  autoSave: boolean
  autoSaveDebounce: number
  autoSaveMode: 'realtime' | 'onblur' | 'manual'
  theme: 'system' | 'light' | 'dark'
  fontSize: number
  fontFamily: string
  viewMode: 'edit' | 'preview' | 'split'
  timeDivider: {
    format: string
    position: 'top' | 'bottom' | 'cursor'
    triggerInterval: number
    enabled: boolean
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoSave: true,
  autoSaveDebounce: 500,
  autoSaveMode: 'realtime',
  theme: 'system',
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  viewMode: 'split',
  timeDivider: {
    format: '--- {{date}} {{weekday}} {{time}} ---',
    position: 'bottom',
    triggerInterval: 5,
    enabled: true,
  },
}

export const DEFAULT_CONTEXT: WorkingContext = {
  lastOpenedNoteId: null,
  cursorPosition: null,
  scrollPosition: null,
  lastEditTimestamp: null,
  deletedDividerNotes: [],
}
