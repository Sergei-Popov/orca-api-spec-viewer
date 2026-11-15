// Keyboard choices that depend on the platform or on where the focus is. No DOM here, so they can
// be tested on their own.

/** The search shortcut as the platform writes it. */
export function searchKey(mac: boolean): string {
  return mac ? '⌘F' : 'Ctrl+F'
}

export interface KeyLike {
  key: string
  altKey: boolean
  shiftKey: boolean
  target: unknown
}

const NOT_TEXT_INPUTS = ['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']

/** Whether the element edits text, where Alt+← / Alt+→ (Option on a Mac) moves the caret by a word. */
export function editsText(target: unknown): boolean {
  if (target === null || typeof target !== 'object') return false
  const el = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown }
  if (el.isContentEditable === true) return true
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : ''
  if (tag === 'textarea') return true
  return tag === 'input' && !NOT_TEXT_INPUTS.includes(typeof el.type === 'string' ? el.type.toLowerCase() : 'text')
}

/** Alt+← / Alt+→ go back and forward, except in a text field, which keeps them for the caret. */
export function isHistoryArrow(event: KeyLike, mod: boolean): boolean {
  return event.altKey && !mod && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !editsText(event.target)
}
