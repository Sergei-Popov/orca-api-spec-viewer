// Markdown to DOM. Every node is built with createElement and text nodes. Links carry no `href`:
// web and mail links open through Orca after a click (Orca asks first), `#…` links move inside
// the viewer, and anything else stays text. Images are never fetched: they show as their
// alternative text.

import { append, h } from '../ui/dom'
import { parseMarkdown, type Block, type Inline } from './parse'

export interface MarkdownHost {
  openExternal(url: string): void
  /** Returns whether the viewer knows the fragment (`#tag/…`, `#/components/…`). */
  openFragment(fragment: string): boolean
  imageLabel: string
}

const cache = new Map<string, Block[]>()
const MAX_SOURCE = 100_000

function parsed(source: string): Block[] {
  let blocks = cache.get(source)
  if (!blocks) {
    blocks = parseMarkdown(source.length > MAX_SOURCE ? source.slice(0, MAX_SOURCE) + '\n\n…' : source)
    if (cache.size > 2000) cache.clear()
    cache.set(source, blocks)
  }
  return blocks
}

export function isExternalUrl(href: string): boolean {
  return /^(?:https?:\/\/|mailto:)/i.test(href.trim())
}

export function renderMarkdown(source: string, host: MarkdownHost, className = 'md'): HTMLElement {
  const root = h('div', { className })
  appendBlocks(root, parsed(source), host, false)
  return root
}

/** A one-line Markdown text (a summary): inline formatting only. */
export function renderInlineMarkdown(source: string, host: MarkdownHost): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const blocks = parsed(source)
  blocks.forEach((block, index) => {
    if (index > 0) fragment.append(' ')
    if (block.t === 'p' || block.t === 'h') appendInlines(fragment, block.c, host)
  })
  return fragment
}

function appendBlocks(parent: Element, blocks: Block[], host: MarkdownHost, tight: boolean): void {
  for (const block of blocks) {
    switch (block.t) {
      case 'p':
        if (tight) appendInlines(parent, block.c, host)
        else {
          const p = h('p')
          appendInlines(p, block.c, host)
          parent.append(p)
        }
        break
      case 'h': {
        const el = h('div', { className: `md-h md-h${block.level}`, role: 'heading', 'aria-level': String(Math.min(6, block.level + 2)) })
        appendInlines(el, block.c, host)
        parent.append(el)
        break
      }
      case 'code':
        parent.append(h('pre', { className: 'md-pre' }, h('code', block.lang ? { 'data-lang': block.lang } : null, block.v)))
        break
      case 'quote': {
        const q = h('blockquote')
        appendBlocks(q, block.c, host, false)
        parent.append(q)
        break
      }
      case 'list': {
        const list = block.ordered ? h('ol', block.start !== 1 ? { start: block.start } : null) : h('ul')
        for (const item of block.items) {
          const li = h('li')
          appendBlocks(li, item, host, block.tight)
          list.append(li)
        }
        parent.append(list)
        break
      }
      case 'hr':
        parent.append(h('hr'))
        break
      case 'table': {
        const table = h('table', { className: 'md-table' })
        const head = h('tr')
        block.head.forEach((cell, index) => {
          const th = h('th', block.align[index] ? { style: `text-align:${block.align[index]}` } : null)
          appendInlines(th, cell, host)
          head.append(th)
        })
        table.append(h('thead', null, head))
        const body = h('tbody')
        for (const row of block.rows) {
          const tr = h('tr')
          row.forEach((cell, index) => {
            const td = h('td', block.align[index] ? { style: `text-align:${block.align[index]}` } : null)
            appendInlines(td, cell, host)
            tr.append(td)
          })
          body.append(tr)
        }
        table.append(body)
        parent.append(h('div', { className: 'md-table-wrap' }, table))
        break
      }
    }
  }
}

function appendInlines(parent: Element | DocumentFragment, inlines: Inline[], host: MarkdownHost): void {
  for (const node of inlines) {
    switch (node.t) {
      case 'text':
        parent.append(node.v)
        break
      case 'code':
        parent.append(h('code', null, node.v))
        break
      case 'br':
        parent.append(h('br'))
        break
      case 'em':
      case 'strong':
      case 'del': {
        const el = h(node.t === 'del' ? 's' : node.t)
        appendInlines(el, node.c, host)
        parent.append(el)
        break
      }
      case 'link':
        parent.append(link(node.href, node.title, node.c, host))
        break
      case 'image': {
        const label = node.alt ? `${host.imageLabel}: ${node.alt}` : host.imageLabel
        const el = isExternalUrl(node.src) ? link(node.src, node.src, [{ t: 'text', v: label }], host) : h('span', { className: 'md-image', title: node.src }, label)
        el.classList.add('md-image')
        parent.append(el)
        break
      }
    }
  }
}

function link(href: string, title: string | undefined, content: Inline[], host: MarkdownHost): HTMLElement {
  const target = href.trim()
  const external = isExternalUrl(target)
  const fragment = target.startsWith('#')
  if (!external && !fragment) {
    // A relative or unknown link: there is no base to resolve it against.
    const span = h('span', { className: 'md-link-text', title: target })
    appendInlines(span, content, host)
    return span
  }
  const a = h('a', { className: 'md-link', tabindex: '0', role: 'link', title: title ? `${title}\n${target}` : target })
  appendInlines(a, content, host)
  const go = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    if (external) host.openExternal(target)
    else host.openFragment(target)
  }
  a.addEventListener('click', go)
  a.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') go(event)
  })
  return a
}
