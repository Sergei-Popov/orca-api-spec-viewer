// A small Markdown parser for descriptions: the blocks and inlines of CommonMark plus GFM tables,
// strikethrough and bare links. It builds a plain tree; the renderer turns it into DOM nodes with
// text content only, so no HTML from a file ever reaches the page. HTML tags in a description are
// dropped and their text kept; `<br>` becomes a line break. Images are never loaded.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'em' | 'strong' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; title?: string; c: Inline[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'br' }

export type Align = 'left' | 'center' | 'right' | null

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; tight: boolean; items: Block[][] }
  | { t: 'hr' }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }

interface Definition {
  href: string
  title?: string
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const QUOTE = /^ {0,3}>/
const QUOTE_STRIP = /^ {0,3}> ?/
const LIST = /^( {0,3})([*+-]|\d{1,9}[.)])([ \t]+|$)/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const HTML_BLOCK = /^ {0,3}<(?:[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$)|\/[A-Za-z][A-Za-z0-9-]*\s*>|!--)/
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const DEFINITION = /^ {0,3}\[((?:[^\]\\]|\\.){1,999})\]:[ \t]*(?:<([^>\n]*)>|(\S+))(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/
const MAX_DEPTH = 24

const isBlank = (line: string) => /^[ \t]*$/.test(line)

function indentOf(line: string): number {
  let n = 0
  while (n < line.length && line[n] === ' ') n++
  return n
}

/** Leading tabs become spaces to the next multiple of four. */
function expandTabs(line: string): string {
  if (!line.includes('\t')) return line
  let out = ''
  let i = 0
  for (; i < line.length && (line[i] === ' ' || line[i] === '\t'); i++) {
    out += line[i] === ' ' ? ' ' : ' '.repeat(4 - (out.length % 4))
  }
  return out + line.slice(i)
}

function stripIndent(line: string, n: number): string {
  const has = Math.min(n, indentOf(line))
  return line.slice(has)
}

export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n').map(expandTabs)
  const defs = new Map<string, Definition>()
  const kept = collectDefinitions(lines, defs)
  return new BlockParser(new InlineParser(defs)).blocks(kept, 0)
}

/** Link reference definitions anywhere outside code, so later references find earlier or later ones. */
function collectDefinitions(lines: string[], defs: Map<string, Definition>): string[] {
  const out: string[] = []
  let fence: string | null = null
  let previousBlank = true
  for (const line of lines) {
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[2][0] === fence[0] && f[2].length >= fence.length && !f[3].trim()) fence = null
      out.push(line)
      continue
    }
    if (f && !(f[2][0] === '`' && f[3].includes('`'))) {
      fence = f[2]
      out.push(line)
      previousBlank = false
      continue
    }
    const d = previousBlank || DEFINITION.test(out[out.length - 1] ?? '') ? DEFINITION.exec(line) : null
    if (d) {
      const label = normalizeLabel(d[1])
      if (label && !defs.has(label)) defs.set(label, { href: d[2] ?? d[3] ?? '', title: d[4] ?? d[5] ?? d[6] })
      continue
    }
    out.push(line)
    previousBlank = isBlank(line)
  }
  return out
}

class BlockParser {
  constructor(private readonly inline: InlineParser) {}

  blocks(lines: string[], depth: number): Block[] {
    const out: Block[] = []
    if (depth > MAX_DEPTH) {
      out.push({ t: 'p', c: [{ t: 'text', v: lines.join('\n') }] })
      return out
    }
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (isBlank(line)) {
        i++
        continue
      }
      if (indentOf(line) >= 4) {
        const code: string[] = []
        while (i < lines.length && (isBlank(lines[i]) || indentOf(lines[i]) >= 4)) code.push(stripIndent(lines[i++], 4))
        while (code.length > 0 && isBlank(code[code.length - 1])) code.pop()
        out.push({ t: 'code', lang: '', v: code.join('\n') })
        continue
      }
      let m: RegExpExecArray | null
      if ((m = FENCE.exec(line)) && !(m[2][0] === '`' && m[3].includes('`'))) {
        const fence = m[2]
        const pad = m[1].length
        const code: string[] = []
        i++
        while (i < lines.length) {
          const close = FENCE.exec(lines[i])
          if (close && close[2][0] === fence[0] && close[2].length >= fence.length && !close[3].trim()) {
            i++
            break
          }
          code.push(stripIndent(lines[i++], pad))
        }
        out.push({ t: 'code', lang: m[3].trim().split(/\s+/)[0] ?? '', v: code.join('\n') })
        continue
      }
      if ((m = ATX.exec(line))) {
        out.push({ t: 'h', level: m[1].length, c: this.inline.parse(m[2] ?? '') })
        i++
        continue
      }
      if (HR.test(line)) {
        out.push({ t: 'hr' })
        i++
        continue
      }
      if (QUOTE.test(line)) {
        const inner: string[] = []
        while (i < lines.length) {
          const l = lines[i]
          if (QUOTE.test(l)) {
            inner.push(l.replace(QUOTE_STRIP, ''))
            i++
          } else if (!isBlank(l) && inner.length > 0 && !isBlank(inner[inner.length - 1]) && !this.interrupts(l)) {
            inner.push(l)
            i++
          } else break
        }
        out.push({ t: 'quote', c: this.blocks(inner, depth + 1) })
        continue
      }
      if (LIST.test(line)) {
        i = this.list(lines, i, out, depth)
        continue
      }
      if (HTML_BLOCK.test(line)) {
        const html: string[] = []
        while (i < lines.length && !isBlank(lines[i])) html.push(lines[i++])
        out.push(...this.htmlBlock(html.join('\n')))
        continue
      }
      if (line.includes('|') && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1])) {
        const head = splitRow(line)
        const delims = splitRow(lines[i + 1])
        if (head.length === delims.length) {
          i = this.table(lines, i, head, delims, out)
          continue
        }
      }
      const para: string[] = [line]
      i++
      let heading = 0
      while (i < lines.length) {
        const l = lines[i]
        if (isBlank(l)) break
        const sx = SETEXT.exec(l)
        if (sx) {
          heading = sx[1][0] === '=' ? 1 : 2
          i++
          break
        }
        if (this.interrupts(l)) break
        para.push(l)
        i++
      }
      const text = para.map((l) => l.replace(/^[ \t]+/, '')).join('\n').replace(/[ \t]+$/, '')
      out.push(heading ? { t: 'h', level: heading, c: this.inline.parse(text) } : { t: 'p', c: this.inline.parse(text) })
    }
    return out
  }

  /** Whether a line ends a paragraph above it. */
  private interrupts(line: string): boolean {
    if (indentOf(line) >= 4) return false
    const f = FENCE.exec(line)
    if (f && !(f[2][0] === '`' && f[3].includes('`'))) return true
    if (ATX.test(line) || HR.test(line) || QUOTE.test(line)) return true
    const m = LIST.exec(line)
    if (m && line.slice(m[0].length).trim() !== '') {
      // An ordered list interrupts a paragraph only when it starts at 1.
      if (!/\d/.test(m[2]) || parseInt(m[2], 10) === 1) return true
    }
    return /^ {0,3}<(?:\/?(?:p|div|table|ul|ol|li|h[1-6]|pre|blockquote|details|summary|section|hr|br)\b|!--)/i.test(line)
  }

  private list(lines: string[], start: number, out: Block[], depth: number): number {
    const first = LIST.exec(lines[start])!
    const ordered = /\d/.test(first[2])
    const marker = ordered ? first[2].slice(-1) : first[2]
    const items: Block[][] = []
    let tight = true
    let i = start
    while (i < lines.length) {
      const m = LIST.exec(lines[i])
      if (!m || HR.test(lines[i])) break
      const isOrdered = /\d/.test(m[2])
      if (isOrdered !== ordered || (isOrdered ? m[2].slice(-1) : m[2]) !== marker) break
      const rest = lines[i].slice(m[0].length)
      const spaces = m[3].length
      const empty = rest.trim() === ''
      const width = spaces >= 5 || empty ? 1 : spaces
      const contentIndent = m[1].length + m[2].length + width
      const itemLines: string[] = [spaces >= 5 ? ' '.repeat(spaces - 1) + rest : rest]
      i++
      let lastBlank = empty
      while (i < lines.length) {
        const l = lines[i]
        if (isBlank(l)) {
          itemLines.push('')
          lastBlank = true
          i++
          continue
        }
        if (indentOf(l) >= contentIndent) {
          itemLines.push(l.slice(contentIndent))
          lastBlank = false
          i++
          continue
        }
        if (!lastBlank && !this.interrupts(l) && !LIST.test(l)) {
          itemLines.push(l)
          i++
          continue
        }
        break
      }
      let trailing = 0
      while (itemLines.length > 0 && isBlank(itemLines[itemLines.length - 1])) {
        itemLines.pop()
        trailing++
      }
      if (hasInnerBlank(itemLines)) tight = false
      items.push(this.blocks(itemLines, depth + 1))
      if (trailing > 0) {
        const next = i < lines.length ? LIST.exec(lines[i]) : null
        if (next && /\d/.test(next[2]) === ordered) tight = false
        else break
      }
    }
    out.push({ t: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, tight, items })
    return i
  }

  private table(lines: string[], start: number, head: string[], delims: string[], out: Block[]): number {
    const align: Align[] = delims.map((d) => {
      const left = d.startsWith(':')
      const right = d.endsWith(':')
      return left && right ? 'center' : right ? 'right' : left ? 'left' : null
    })
    const rows: Inline[][][] = []
    let i = start + 2
    while (i < lines.length && !isBlank(lines[i]) && !this.interrupts(lines[i])) {
      const cells = splitRow(lines[i])
      const row: Inline[][] = []
      for (let c = 0; c < head.length; c++) row.push(this.inline.parse(cells[c] ?? ''))
      rows.push(row)
      i++
    }
    out.push({ t: 'table', align, head: head.map((cell) => this.inline.parse(cell)), rows })
    return i
  }

  /** HTML is never rendered: its tags go, its text stays, block tags and `<br>` break lines. */
  private htmlBlock(html: string): Block[] {
    const text = html
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(?:p|div|li|tr|h[1-6]|ul|ol|table|thead|tbody|blockquote|pre|hr|details|summary|section|dl|dt|dd)\b[^>]*>/gi, '\n')
    const out: Block[] = []
    for (const chunk of text.split(/\n[ \t]*\n/)) {
      const lines = chunk.split('\n').map((l) => l.trim()).filter((l) => l !== '')
      if (lines.length === 0) continue
      const c: Inline[] = []
      lines.forEach((line, index) => {
        if (index > 0) c.push({ t: 'br' })
        c.push(...this.inline.parse(line))
      })
      out.push({ t: 'p', c })
    }
    return out
  }
}

function hasInnerBlank(lines: string[]): boolean {
  let fence = false
  for (let i = 1; i < lines.length - 1; i++) {
    if (FENCE.test(lines[i])) fence = !fence
    if (!fence && isBlank(lines[i])) return true
  }
  return false
}

/** Table cells: split on `|` outside code spans and escapes. */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  let code = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') {
      cell += '|'
      i++
    } else if (c === '`') {
      let run = 1
      while (s[i + run] === '`') run++
      code = code === run ? 0 : code === 0 ? run : code
      cell += '`'.repeat(run)
      i += run - 1
    } else if (c === '|' && code === 0) {
      cells.push(cell.trim())
      cell = ''
    } else cell += c
  }
  cells.push(cell.trim())
  return cells
}

// Inlines --------------------------------------------------------------------------------------

type Delim = { kind: 'delim'; ch: '*' | '_' | '~'; count: number; open: boolean; close: boolean }
type Tok = { kind: 'node'; node: Inline } | Delim

const ASCII_PUNCT = /[!-/:-@[-`{-~]/
const PUNCT = /[\p{P}\p{S}]/u
const isWs = (c: string) => c === '' || /\s/.test(c)
const isPunct = (c: string) => c !== '' && PUNCT.test(c)
const AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/
const EMAIL = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/
const HTML_TAG = /^(?:<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<!--[\s\S]*?-->)/
const ENTITY = /^&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<]+/i
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  bull: '•',
  times: '×',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  sect: '§',
  para: '¶',
  shy: ''
}

function decodeEntity(m: RegExpExecArray): string | null {
  if (m[1] || m[2]) {
    const code = m[1] ? parseInt(m[1], 16) : parseInt(m[2], 10)
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�'
    return String.fromCodePoint(code)
  }
  return Object.prototype.hasOwnProperty.call(NAMED, m[3]) ? NAMED[m[3]] : null
}

/** GFM: a bare link drops trailing punctuation and an unbalanced closing parenthesis. */
function trimUrl(url: string): string {
  let end = url.length
  for (;;) {
    const c = url[end - 1]
    if ('?!.,:*_~\'"'.includes(c)) {
      end--
      continue
    }
    if (c === ')') {
      const body = url.slice(0, end)
      const open = (body.match(/\(/g) ?? []).length
      const close = (body.match(/\)/g) ?? []).length
      if (close > open) {
        end--
        continue
      }
    }
    if (c === ';' && /&[a-zA-Z0-9]+;$/.test(url.slice(0, end))) {
      end = url.slice(0, end).lastIndexOf('&')
      continue
    }
    break
  }
  return url.slice(0, end)
}

export class InlineParser {
  constructor(private readonly defs: Map<string, Definition>) {}

  parse(src: string, depth = 0): Inline[] {
    const toks: Tok[] = []
    let text = ''
    const flush = () => {
      if (text) toks.push({ kind: 'node', node: { t: 'text', v: text } })
      text = ''
    }
    const push = (node: Inline) => {
      flush()
      toks.push({ kind: 'node', node })
    }
    let i = 0
    while (i < src.length) {
      const c = src[i]
      if (c === '\\') {
        const n = src[i + 1] ?? ''
        if (n === '\n') {
          push({ t: 'br' })
          i += 2
          while (src[i] === ' ') i++
        } else if (ASCII_PUNCT.test(n)) {
          text += n
          i += 2
        } else {
          text += c
          i++
        }
        continue
      }
      if (c === '`') {
        let run = 1
        while (src[i + run] === '`') run++
        const close = findBackticks(src, i + run, run)
        if (close < 0) {
          text += '`'.repeat(run)
          i += run
          continue
        }
        let code = src.slice(i + run, close).replace(/\n/g, ' ')
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1)
        push({ t: 'code', v: code })
        i = close + run
        continue
      }
      if (c === '*' || c === '_' || c === '~') {
        let run = 1
        while (src[i + run] === c) run++
        if (c === '~' && run !== 2) {
          text += c.repeat(run)
          i += run
          continue
        }
        const before = i > 0 ? src[i - 1] : ''
        const after = src[i + run] ?? ''
        const left = !isWs(after) && (!isPunct(after) || isWs(before) || isPunct(before))
        const right = !isWs(before) && (!isPunct(before) || isWs(after) || isPunct(after))
        let open = left
        let close = right
        if (c === '_') {
          open = left && (!right || isPunct(before))
          close = right && (!left || isPunct(after))
        }
        flush()
        toks.push({ kind: 'delim', ch: c, count: run, open, close })
        i += run
        continue
      }
      if (c === '!' && src[i + 1] === '[') {
        const link = this.link(src, i + 1, true, depth)
        if (link) {
          push(link.node)
          i = link.end
          continue
        }
      }
      if (c === '[') {
        const link = this.link(src, i, false, depth)
        if (link) {
          push(link.node)
          i = link.end
          continue
        }
      }
      if (c === '<') {
        const head = src.slice(i, i + 2048)
        const auto = AUTOLINK.exec(head)
        if (auto) {
          push({ t: 'link', href: auto[1], c: [{ t: 'text', v: auto[1] }] })
          i += auto[0].length
          continue
        }
        const email = EMAIL.exec(head)
        if (email) {
          push({ t: 'link', href: 'mailto:' + email[1], c: [{ t: 'text', v: email[1] }] })
          i += email[0].length
          continue
        }
        const tag = HTML_TAG.exec(head)
        if (tag) {
          if (/^<br\s*\/?>$/i.test(tag[0])) push({ t: 'br' })
          i += tag[0].length
          continue
        }
      }
      if (c === '&') {
        const m = ENTITY.exec(src.slice(i, i + 40))
        const decoded = m ? decodeEntity(m) : null
        if (m && decoded !== null) {
          text += decoded
          i += m[0].length
          continue
        }
      }
      if (c === '\n') {
        const hard = / {2,}$/.test(text)
        text = text.replace(/ +$/, '')
        if (hard) push({ t: 'br' })
        else text += ' '
        i++
        while (src[i] === ' ') i++
        continue
      }
      if ((c === 'h' || c === 'H' || c === 'w' || c === 'W') && (i === 0 || /[\s(*_~]/.test(src[i - 1])) && depth === 0) {
        const m = BARE_URL.exec(src.slice(i, i + 2048))
        if (m) {
          const url = trimUrl(m[0])
          if (/^https?:\/\/[A-Za-z0-9[]/i.test(url) || /^www\.[^.\s]+\.[^\s]/i.test(url)) {
            push({ t: 'link', href: /^www\./i.test(url) ? 'https://' + url : url, c: [{ t: 'text', v: url }] })
            i += url.length
            continue
          }
        }
      }
      text += c
      i++
    }
    flush()
    return emphasis(toks)
  }

  private link(src: string, start: number, image: boolean, depth: number): { node: Inline; end: number } | null {
    const close = matchBracket(src, start)
    if (close < 0) return null
    const label = src.slice(start + 1, close)
    const make = (href: string, title?: string): Inline =>
      image
        ? { t: 'image', src: href, alt: plainText(this.parse(label, depth + 1)) }
        : { t: 'link', href, title, c: depth > 3 ? [{ t: 'text', v: label }] : this.parse(label, depth + 1) }
    const j = close + 1
    if (src[j] === '(') {
      const dest = destination(src, j + 1)
      if (dest) return { node: make(dest.href, dest.title), end: dest.end }
    }
    let ref = label
    let end = j
    if (src[j] === '[') {
      const c2 = src.indexOf(']', j + 1)
      if (c2 >= 0 && c2 - j < 1000) {
        const second = src.slice(j + 1, c2)
        if (second.trim()) ref = second
        end = c2 + 1
      }
    }
    const def = this.defs.get(normalizeLabel(ref))
    return def ? { node: make(def.href, def.title), end } : null
  }
}

function findBackticks(src: string, from: number, run: number): number {
  let i = from
  while (i < src.length) {
    const at = src.indexOf('`', i)
    if (at < 0) return -1
    let n = 1
    while (src[at + n] === '`') n++
    if (n === run) return at
    i = at + n
  }
  return -1
}

/** The `]` that closes the `[` at `start`, skipping escapes and code spans. */
function matchBracket(src: string, start: number): number {
  let depth = 0
  const limit = Math.min(src.length, start + 4000)
  for (let i = start; i < limit; i++) {
    const c = src[i]
    if (c === '\\') {
      i++
    } else if (c === '`') {
      let run = 1
      while (src[i + run] === '`') run++
      const close = findBackticks(src, i + run, run)
      if (close >= 0) i = close + run - 1
      else i += run - 1
    } else if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** `(href "title")` after a link's text; `start` is just past the `(`. */
function destination(src: string, start: number): { href: string; title?: string; end: number } | null {
  let i = start
  const skip = () => {
    while (i < src.length && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n')) i++
  }
  skip()
  let href = ''
  if (src[i] === '<') {
    const close = src.indexOf('>', i + 1)
    if (close < 0 || src.slice(i + 1, close).includes('\n')) return null
    href = src.slice(i + 1, close)
    i = close + 1
  } else {
    let parens = 0
    const from = i
    while (i < src.length && i - from < 2048) {
      const c = src[i]
      if (c === '\\' && i + 1 < src.length) {
        i += 2
        continue
      }
      if (/\s/.test(c)) break
      if (c === '(') parens++
      if (c === ')') {
        if (parens === 0) break
        parens--
      }
      i++
    }
    href = src.slice(from, i).replace(/\\([!-/:-@[-`{-~])/g, '$1')
  }
  skip()
  let title: string | undefined
  const q = src[i]
  if (q === '"' || q === "'" || q === '(') {
    const closeChar = q === '(' ? ')' : q
    const close = src.indexOf(closeChar, i + 1)
    if (close < 0) return null
    title = src.slice(i + 1, close)
    i = close + 1
    skip()
  }
  if (src[i] !== ')') return null
  return { href, title, end: i + 1 }
}

/** CommonMark's delimiter algorithm for `*`, `_` and `~~`. */
function emphasis(toks: Tok[]): Inline[] {
  for (let ci = 0; ci < toks.length; ci++) {
    const closer = toks[ci]
    if (closer.kind !== 'delim' || !closer.close || closer.count === 0) continue
    let oi = ci - 1
    for (; oi >= 0; oi--) {
      const o = toks[oi]
      if (o.kind !== 'delim' || o.ch !== closer.ch || !o.open || o.count === 0) continue
      // The rule of three: `*foo**bar*` must not pair `*` with `**`.
      if (o.ch !== '~' && (o.close || closer.open) && (o.count + closer.count) % 3 === 0 && !(o.count % 3 === 0 && closer.count % 3 === 0)) continue
      break
    }
    if (oi < 0) continue
    const opener = toks[oi] as Delim
    const use = closer.ch === '~' ? 2 : opener.count >= 2 && closer.count >= 2 ? 2 : 1
    const node: Inline = { t: closer.ch === '~' ? 'del' : use === 2 ? 'strong' : 'em', c: flatten(toks.slice(oi + 1, ci)) }
    opener.count -= use
    closer.count -= use
    toks.splice(oi + 1, ci - oi - 1, { kind: 'node', node })
    let nodeAt = oi + 1
    if (opener.count === 0) {
      toks.splice(oi, 1)
      nodeAt--
    }
    if (closer.count === 0) toks.splice(nodeAt + 1, 1)
    // The loop moves on to the closer again when it has delimiters left.
    ci = nodeAt
  }
  return flatten(toks)
}

function flatten(toks: Tok[]): Inline[] {
  const out: Inline[] = []
  for (const tok of toks) {
    const node: Inline | null = tok.kind === 'node' ? tok.node : tok.count > 0 ? { t: 'text', v: tok.ch.repeat(tok.count) } : null
    if (!node) continue
    const last = out[out.length - 1]
    if (node.t === 'text' && last?.t === 'text') out[out.length - 1] = { t: 'text', v: last.v + node.v }
    else out.push(node)
  }
  return out
}

export function plainText(inlines: Inline[]): string {
  let out = ''
  for (const node of inlines) {
    if (node.t === 'text' || node.t === 'code') out += node.v
    else if (node.t === 'br') out += ' '
    else if (node.t === 'image') out += node.alt
    else out += plainText(node.c)
  }
  return out
}

/** The first paragraph's text, for one-line summaries. */
export function firstLine(source: string, max = 160): string {
  const blocks = parseMarkdown(source.length > 4000 ? source.slice(0, 4000) : source)
  for (const block of blocks) {
    if (block.t === 'p' || block.t === 'h') {
      const text = plainText(block.c).trim()
      if (text) return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
    }
  }
  return ''
}
