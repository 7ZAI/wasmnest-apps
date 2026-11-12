/**
 * 弹窗焦点管理：进入时聚焦首控件、Tab 在弹窗内循环、Esc 关闭、关闭后把焦点还给原处。
 *
 * 弹窗不再 Teleport 到 body（应用主题 token 只作用在 `.lanbitou-root` 内），
 * 因此焦点陷阱只需守住组件根节点。Escape 走冒泡阶段：内部控件（如 SelectField）
 * 可以 `@keydown.esc.stop` 先行消费，避免「关下拉」把整个弹窗一起关掉。
 */
import { onBeforeUnmount, onMounted, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useModalFocus(container: Ref<HTMLElement | null>, onClose: () => void): void {
  let previousFocus: HTMLElement | null = null

  function focusable(): HTMLElement[] {
    const root = container.value
    if (!root) return []
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const list = focusable()
    if (list.length === 0) {
      event.preventDefault()
      container.value?.focus()
      return
    }
    const first = list[0]
    const last = list[list.length - 1]
    const active = document.activeElement as HTMLElement | null

    if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && (active === first || !container.value?.contains(active))) {
      event.preventDefault()
      last.focus()
    }
  }

  onMounted(() => {
    previousFocus = document.activeElement as HTMLElement | null
    const root = container.value
    root?.setAttribute('tabindex', '-1')
    const list = focusable()
    ;(list[0] ?? root)?.focus()
    document.addEventListener('keydown', onKeydown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
    previousFocus?.focus?.()
  })
}
