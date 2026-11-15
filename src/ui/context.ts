// What every page gets from the app (`PageCtx`), and the small building blocks pages share:
// sections, Markdown, code with highlighting, reference chips, tabs, badges.

import type { Analysis } from '../analyze'
import { format, type Strings } from '../i18n'
import { renderMarkdown, type MarkdownHost } from '../markdown/render'
import { prettyJson } from '../spec/example'
import { codeTokens, HIGHLIGHT_LIMIT, type CodeLanguage } from './tokens'
import { isObject, own, str, toPointer } from '../spec/pointer'
import { MAX_HOPS, splitRef, type Loc, type Refs, type Resolution } from '../spec/refs'
import { refName } from '../spec/schema'
import { append, button, clickable, h, svg, type Child } from './dom'
import { icons } from './icons'

export interface PageCtx {
  t: Strings
  locale: string
  analysis: Analysis
  refs: Refs
  /** The page being drawn. */
  pageKey: string
  md: MarkdownHost
  go(key: string, anchor?: string): void
  /** Opens the page that shows a location. */
  goLoc(loc: Loc): void
  /** The page key that shows a location, if any. */
  pageOf(loc: Loc): string | null
  showLine(line: number): void
  lineOf(loc: Loc): number | null
  copy(text: string): void
  isOpen(id: string, byDefault: boolean): boolean
  setOpen(id: string, open: boolean): void
  /** Forgets what was opened or closed under an id prefix (for "Expand all"). */
  clearOpen(prefix: string): void
  tab(id: string, fallback: string): string
  setTab(id: string, value: string): void
  loadFile(): void
  /** Draws the current page again, keeping its scroll position. */
  redraw(): void
  /** A short title of a page, for "Used by" and links. */
  titleOf(key: string): { title: string; method?: string; detail?: string } | null
}

export function sectionTitle(level: 2 | 3, text: Child, ...extra: Child[]): HTMLElement {
  return h(level === 2 ? 'h2' : 'h3', { className: 'h' }, text, ...extra)
}

export function markdown(ctx: PageCtx, text: unknown, className = 'md'): HTMLElement | null {
  if (typeof text !== 'string' || !text.trim()) return null
  return renderMarkdown(text, ctx.md, className)
}

export function copyButton(ctx: PageCtx, text: string | (() => string), label = ctx.t.copy): HTMLButtonElement {
  return button('tool copybtn', svg(icons.copy), label, () => ctx.copy(typeof text === 'string' ? text : text()))
}

export function banner(kind: 'error' | 'warning' | 'info' | 'plain', ...children: Child[]): HTMLElement {
  const icon = kind === 'error' ? icons.error : kind === 'warning' ? icons.warning : icons.info
  return h('div', { className: `banner ${kind}` }, svg(icon), h('div', null, ...children))
}

export function chip(text: Child, className = ''): HTMLElement {
  return h('span', { className: `chip ${className}`.trim() }, text)
}

export function methodBadge(method: string, large = false): HTMLElement {
  const m = method.toLowerCase()
  return h('span', { className: `m m-${m.replace(/[^a-z]/g, '')}${large ? ' lg' : ''}` }, m === 'delete' ? 'del' : m === 'options' ? 'opt' : method.length > 7 ? method.slice(0, 6) + '…' : method)
}

export function methodBadgeFull(method: string): HTMLElement {
  const m = method.toLowerCase()
  return h('span', { className: `m lg m-${m.replace(/[^a-z]/g, '')}` }, method)
}

export function statusBadge(status: string): HTMLElement {
  const first = /^[1-5]/.test(status) ? status[0] : '1'
  return h('span', { className: `st st-${first}` }, status)
}

/** A URL path with its `{parameters}` coloured. */
export function routeEl(route: string, className = 'route'): HTMLElement {
  const el = h('span', { className })
  let at = 0
  for (const m of route.matchAll(/\{[^{}]*\}/g)) {
    if (m.index! > at) el.append(route.slice(at, m.index))
    el.append(h('span', { className: 'param' }, m[0]))
    at = m.index! + m[0].length
  }
  if (at < route.length) el.append(route.slice(at))
  return el
}

export function kvList(pairs: [Child, Child][]): HTMLElement | null {
  const rows = pairs.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '')
  if (rows.length === 0) return null
  const el = h('div', { className: 'kv' })
  for (const [k, v] of rows) append(el, h('div', { className: 'k' }, k), h('div', { className: 'v' }, v))
  return el
}

export function tabs(ctx: PageCtx, id: string, options: { value: string; label: Child; mono?: boolean }[], fallback: string, onChange: (value: string) => void): HTMLElement {
  const el = h('div', { className: 'tabs', role: 'tablist' })
  const saved = ctx.tab(id, fallback)
  const current = options.some((o) => o.value === saved) ? saved : fallback
  for (const option of options) {
    const tab = button(`tab${option.mono ? ' mono' : ''}${option.value === current ? ' on' : ''}`, option.label, undefined, () => {
      ctx.setTab(id, option.value)
      for (const other of Array.from(el.children)) {
        other.classList.toggle('on', other === tab)
        other.setAttribute('aria-selected', String(other === tab))
      }
      onChange(option.value)
    })
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(option.value === current))
    el.append(tab)
  }
  return el
}

/** Lines of a page's link to another page, with the title it shows. */
export function pageLink(ctx: PageCtx, key: string, label: Child, className = 'link'): HTMLElement {
  return clickable(h('a', { className }, label), () => ctx.go(key))
}

// Code ----------------------------------------------------------------------------------------

export type { CodeLanguage }

function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span')
  el.className = className
  el.textContent = text
  return el
}

/**
 * Colours strings, keys, numbers, flags and keywords; everything else stays plain text. Text that
 * was cut short (`plain`) or is very long is shown as it is.
 */
export function highlightCode(text: string, language: CodeLanguage, plain = false): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const token of codeTokens(text, plain ? 'text' : language)) fragment.append(token.kind ? span(token.kind, token.text) : token.text)
  return fragment
}

export function codeBlock(text: string, language: CodeLanguage, plain = false): HTMLElement {
  const pre = h('pre', { className: 'code' })
  pre.append(highlightCode(text, language, plain))
  return pre
}

/** The note under a value that was cut short. */
export function cutNote(ctx: PageCtx): HTMLElement {
  return h('div', { className: 'note' }, svg(icons.info), ctx.t.exampleCut)
}

/** A value as pretty JSON with highlighting, cut off with a note past a size. */
export function jsonBlock(ctx: PageCtx, value: unknown): HTMLElement {
  const { text, cut } = prettyJson(value)
  const wrap = h('div', null, codeBlock(text, 'json', cut))
  if (cut) wrap.append(cutNote(ctx))
  return wrap
}

/** A value as pretty JSON text, and whether it was cut short. */
export function valueText(value: unknown): { text: string; cut: boolean } {
  return prettyJson(value, HIGHLIGHT_LIMIT)
}

export function valueToText(value: unknown): string {
  return valueText(value).text
}

// References ----------------------------------------------------------------------------------

/** The component a local reference names, as a page key, when the viewer has that page. */
export function refTarget(ctx: PageCtx, loc: Loc): string | null {
  const key = 'c:' + toPointer(loc.path)
  return loc.doc === '' && ctx.titleOf(key) ? key : null
}

/** A clickable `Name` for a reference that resolved to a component of this document. */
export function refLink(ctx: PageCtx, ref: string, loc: Loc): HTMLElement {
  const key = refTarget(ctx, loc)
  const label = refName(ref)
  if (!key) return h('span', { className: 'tref', title: ref }, label)
  return clickable(h('span', { className: 'tref', title: ref }, label), (event) => {
    event.stopPropagation()
    ctx.go(key)
  })
}

/** For a reference that does not resolve here: where it points and how to load it. */
export function stopNote(ctx: PageCtx, stop: Exclude<Resolution, { kind: 'local' }>): HTMLElement {
  if (stop.kind === 'external') {
    const { file, fragment } = splitRef(stop.ref)
    return h(
      'div',
      { className: 'banner info' },
      svg(icons.link),
      h(
        'div',
        null,
        h('div', null, h('b', null, ctx.t.externalRef), ' · ', h('span', { className: 'mono' }, format(ctx.t.externalRefIn, { fragment: fragment || '#', file }))),
        h('div', { className: 'sub' }, format(ctx.t.loadFileHint, { file: file.split('/').pop() || file })),
        h('div', { style: 'margin-top:6px' }, button('tool on', [svg(icons.upload), ctx.t.loadFile], undefined, () => ctx.loadFile()))
      )
    )
  }
  if (stop.reason === 'too-long') return banner('warning', format(ctx.t.refChainTooLong, { max: MAX_HOPS }), ' · ', h('span', { className: 'mono' }, stop.ref))
  return banner('error', h('b', null, ctx.t.missingRef), ' · ', h('span', { className: 'mono' }, stop.ref))
}

/** `description`, `summary` and `externalDocs` of an object, as page parts. */
export function describe(ctx: PageCtx, value: unknown): HTMLElement[] {
  if (!isObject(value)) return []
  const out: HTMLElement[] = []
  const description = markdown(ctx, own(value, 'description'))
  if (description) out.push(description)
  const docs = own(value, 'externalDocs')
  if (isObject(docs) && typeof docs.url === 'string') out.push(externalDocsEl(ctx, docs))
  return out
}

export function externalDocsEl(ctx: PageCtx, docs: Record<string, unknown>): HTMLElement {
  const url = str(own(docs, 'url')) ?? ''
  const label = str(own(docs, 'description')) ?? url
  return h('div', { className: 'meta' }, svg(icons.external), externalLink(ctx, url, label))
}

export function externalLink(ctx: PageCtx, url: string, label: Child = url): HTMLElement {
  if (!/^(https?:|mailto:)/i.test(url)) return h('span', { className: 'mono', title: url }, label)
  return clickable(h('a', { className: 'link', title: url }, label), () => ctx.md.openExternal(url))
}
