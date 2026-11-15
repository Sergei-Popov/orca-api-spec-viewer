// A tiny element builder. Text from the file always goes in as text nodes, never as HTML; only the
// static icon strings in icons.ts are parsed as markup.

export type Child = Node | string | number | null | undefined | false
type Props = Record<string, string | number | boolean | undefined | null> & {
  onclick?: never
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props) {
    for (const key of Object.keys(props)) {
      const value = props[key]
      if (value === undefined || value === null || value === false) continue
      if (key === 'className') el.className = String(value)
      else el.setAttribute(key, value === true ? '' : String(value))
    }
  }
  append(el, ...children)
  return el
}

export function append(el: Element | DocumentFragment, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child)
  }
}

export function clear(el: Element): void {
  el.replaceChildren()
}

const iconCache = new Map<string, Element>()

/** One of the static SVG icons from icons.ts as an element. */
export function svg(markup: string): Element {
  let el = iconCache.get(markup)
  if (!el) {
    const template = document.createElement('template')
    template.innerHTML = markup
    const first = template.content.firstElementChild
    if (!first) throw new Error('empty icon')
    el = first
    iconCache.set(markup, el)
  }
  return el.cloneNode(true) as Element
}

/** `text` with every case-insensitive occurrence of each word of `query` wrapped in <mark>. */
export function highlight(text: string, query: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
  if (words.length === 0) {
    fragment.append(text)
    return fragment
  }
  const lower = text.toLowerCase()
  const marks: [number, number][] = []
  for (const word of words) {
    for (let i = lower.indexOf(word); i >= 0; i = lower.indexOf(word, i + word.length)) marks.push([i, i + word.length])
  }
  marks.sort((a, b) => a[0] - b[0])
  let at = 0
  for (const [start, end] of marks) {
    if (end <= at) continue
    const from = Math.max(start, at)
    if (from > at) fragment.append(text.slice(at, from))
    fragment.append(h('mark', null, text.slice(from, end)))
    at = end
  }
  if (at < text.length) fragment.append(text.slice(at))
  return fragment
}

/** Makes an element act like a button for mouse and keyboard. */
export function clickable<T extends HTMLElement>(el: T, handler: (event: Event) => void, label?: string): T {
  if (!(el instanceof HTMLButtonElement)) {
    el.tabIndex = 0
    if (!el.getAttribute('role')) el.setAttribute('role', 'button')
  }
  if (label) {
    el.setAttribute('aria-label', label)
    el.title = label
  }
  el.addEventListener('click', handler)
  if (!(el instanceof HTMLButtonElement)) {
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handler(event)
      }
    })
  }
  return el
}

export function button(className: string, content: Child | Child[], label: string | undefined, handler: (event: Event) => void): HTMLButtonElement {
  const el = h('button', { type: 'button', className })
  append(el, ...(Array.isArray(content) ? content : [content]))
  return clickable(el, handler, label)
}

/** Copies text, falling back to a hidden textarea when the frame has no clipboard access. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = h('textarea', { readonly: true, 'aria-hidden': 'true' })
    area.value = text
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    const focused = document.activeElement
    document.body.append(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
    return ok
  }
}
