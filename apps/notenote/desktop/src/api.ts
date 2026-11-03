import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { Note, AppSettings, WorkingContext } from './types'

let ctx: PluginContext

export function initApi(pluginContext: PluginContext) {
  ctx = pluginContext
}

function exec<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return ctx.commands.execute(command, args ?? {}) as Promise<T>
}

export const api = {
  createNote(id: string): Promise<Note> {
    return exec<Note>('notenote.note.create', { id })
  },
  readNote(id: string): Promise<Note> {
    return exec<Note>('notenote.note.read', { id })
  },
  updateNote(id: string, content: string): Promise<Note> {
    return exec<Note>('notenote.note.update', { id, content })
  },
  deleteNote(id: string): Promise<{ id: string; deleted: boolean }> {
    return exec('notenote.note.delete', { id })
  },
  renameNote(id: string, title: string): Promise<Note> {
    return exec<Note>('notenote.note.rename', { id, title })
  },
  listNotes(): Promise<Note[]> {
    return exec<Note[]>('notenote.note.list', {})
  },
  searchNotes(query: string): Promise<Note[]> {
    return exec<Note[]>('notenote.note.search', { query })
  },
  readSettings(): Promise<AppSettings> {
    return exec<AppSettings>('notenote.settings.read', {})
  },
  saveSettings(settings: AppSettings): Promise<AppSettings> {
    return exec<AppSettings>('notenote.settings.save', settings as unknown as Record<string, unknown>)
  },
  readContext(): Promise<WorkingContext> {
    return exec<WorkingContext>('notenote.context.read', {})
  },
  saveContext(context: WorkingContext): Promise<WorkingContext> {
    return exec<WorkingContext>('notenote.context.save', context as unknown as Record<string, unknown>)
  },
  clipboardRead(): Promise<{ text: string | null }> {
    return exec<{ text: string | null }>('notenote.clipboard.read', {})
  },
  clipboardWrite(text: string): Promise<{ written: boolean }> {
    return exec<{ written: boolean }>('notenote.clipboard.write', { text })
  },
}
