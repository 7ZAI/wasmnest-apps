import { onMounted, onBeforeUnmount } from 'vue'

export interface ShortcutHandlers {
  onSave?: () => void
  onNewNote?: () => void
  onBold?: () => void
  onItalic?: () => void
  onTimeDivider?: () => void
  onToggleSidebar?: () => void
  onFind?: () => void
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  function handleKeydown(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey

    if (ctrl && e.key === 's') {
      e.preventDefault()
      handlers.onSave?.()
    } else if (ctrl && e.key === 'n') {
      e.preventDefault()
      handlers.onNewNote?.()
    } else if (ctrl && e.key === 'b') {
      e.preventDefault()
      handlers.onBold?.()
    } else if (ctrl && e.key === 'i') {
      e.preventDefault()
      handlers.onItalic?.()
    } else if (ctrl && e.shiftKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault()
      handlers.onTimeDivider?.()
    } else if (ctrl && e.key === '\\') {
      e.preventDefault()
      handlers.onToggleSidebar?.()
    } else if (ctrl && e.key === 'f') {
      e.preventDefault()
      handlers.onFind?.()
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleKeydown)
  })
}
