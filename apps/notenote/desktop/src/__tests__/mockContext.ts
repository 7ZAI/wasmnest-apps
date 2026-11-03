import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { Note, AppSettings, WorkingContext } from '../types'
import { DEFAULT_SETTINGS, DEFAULT_CONTEXT } from '../types'

export interface MockContext {
  context: PluginContext
  calls: { command: string; args: any }[]
  listeners: Record<string, (payload: any) => void>
  storageMap: Map<string, any>
  notes: Map<string, Note>
  settings: AppSettings
  workingContext: WorkingContext
  clipboardText: string | null
}

function makeNote(overrides: Partial<Note> = {}): Note {
  const now = new Date().toISOString()
  return {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'Untitled',
    content: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const DEFAULT_COMMANDS: Record<string, (args: any, mock: MockContext) => any> = {
  'notenote.note.create': (args, mock) => {
    const note = makeNote({ id: args.id })
    mock.notes.set(note.id, note)
    return note
  },
  'notenote.note.read': (args, mock) => {
    const note = mock.notes.get(args.id)
    if (!note) throw new Error(`note not found: ${args.id}`)
    return note
  },
  'notenote.note.update': (args, mock) => {
    const note = mock.notes.get(args.id)
    if (!note) throw new Error(`note not found: ${args.id}`)
    note.content = args.content
    note.title = args.content.split('\n')[0]?.replace(/^#+\s*/, '') || 'Untitled'
    note.updatedAt = new Date().toISOString()
    return note
  },
  'notenote.note.delete': (args, mock) => {
    mock.notes.delete(args.id)
    return { id: args.id, deleted: true }
  },
  'notenote.note.rename': (args, mock) => {
    const note = mock.notes.get(args.id)
    if (!note) throw new Error(`note not found: ${args.id}`)
    note.title = args.title
    note.updatedAt = new Date().toISOString()
    return note
  },
  'notenote.note.list': (_args, mock) => {
    return Array.from(mock.notes.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  },
  'notenote.note.search': (args, mock) => {
    const q = args.query.toLowerCase()
    return Array.from(mock.notes.values()).filter(
      (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
    )
  },
  'notenote.settings.read': (_args, mock) => {
    return { ...mock.settings }
  },
  'notenote.settings.save': (args, mock) => {
    Object.assign(mock.settings, args)
    return { ...mock.settings }
  },
  'notenote.context.read': (_args, mock) => {
    return { ...mock.workingContext }
  },
  'notenote.context.save': (args, mock) => {
    Object.assign(mock.workingContext, args)
    return { ...mock.workingContext }
  },
  'notenote.clipboard.read': (_args, mock) => {
    return { text: mock.clipboardText }
  },
  'notenote.clipboard.write': (args, mock) => {
    mock.clipboardText = args.text
    return { written: true }
  },
}

export function createMockContext(
  overrides?: { commands?: Record<string, (args: any, mock: MockContext) => any> },
): MockContext {
  const storageMap = new Map<string, any>()
  const listeners: Record<string, (payload: any) => void> = {}
  const calls: { command: string; args: any }[] = []
  const notes = new Map<string, Note>()
  const settings: AppSettings = { ...DEFAULT_SETTINGS }
  const workingContext: WorkingContext = { ...DEFAULT_CONTEXT, deletedDividerNotes: [] }
  let clipboardText: string | null = null

  const commands = { ...DEFAULT_COMMANDS, ...overrides?.commands }

  let contextObj: any

  const mock: MockContext = {
    get context() {
      return contextObj as unknown as PluginContext
    },
    set context(v: PluginContext) {
      contextObj = v
    },
    calls,
    listeners,
    storageMap,
    notes,
    settings,
    workingContext,
    get clipboardText() {
      return clipboardText
    },
    set clipboardText(v: string | null) {
      clipboardText = v
    },
  }

  contextObj = {
    id: 'com.wasmnest.notenote',
    extensionPath: '/mock',
    commands: {
      async execute(command: string, args: any = {}): Promise<any> {
        calls.push({ command, args })
        const handler = commands[command]
        if (!handler) throw new Error(`unknown command: ${command}`)
        return handler(args, mock)
      },
    },
    events: {
      on(event: string, handler: (payload: any) => void) {
        listeners[event] = handler
        return { dispose: () => { delete listeners[event] } }
      },
      emit(event: string, ...args: any[]) {
        listeners[event]?.(args[0])
      },
    },
    storage: {
      async get<T = any>(key: string): Promise<T | undefined> {
        return storageMap.get(key) as T | undefined
      },
      async set(key: string, value: any): Promise<void> {
        storageMap.set(key, value)
      },
      async delete(key: string): Promise<void> {
        storageMap.delete(key)
      },
      async flush(): Promise<void> {},
    },
    i18n: {
      getI18n() {
        return {
          t: (key: string) => key,
          locale: { value: 'zh-CN' },
        }
      },
      t(key: string) {
        return key
      },
    },
  }

  mock.context = contextObj as unknown as PluginContext
  return mock
}

export { makeNote }
