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

// Every pattern here is anchored and has no two neighbouring quantifiers that can match the same
// characters: descriptions come from the file, and a backtracking pattern on a long run of spaces
// would freeze the page. Where that is hard to say as a pattern, the code scans by hand.
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const QUOTE = /^ {0,3}>/
const QUOTE_STRIP = /^ {0,3}> ?/
const LIST = /^( {0,3})([*+-]|\d{1,9}[.)])([ \t]+|$)/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const HTML_BLOCK = /^ {0,3}<(?:[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$)|\/[A-Za-z][A-Za-z0-9-]*\s*>|!--)/
const DEFINITION = /^ {0,3}\[((?:[^\]\\]|\\.){1,999})\]:[ \t]*(?:<([^>\n]*)>|(\S+))(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/
const MAX_DEPTH = 24
/** Emphasis nested deeper than this stays text: the renderer and plain-text walks recurse. */
const MAX_EMPHASIS = 32
/** A table with more columns is a paragraph; past MAX_CELLS short rows are not padded. */
const MAX_COLUMNS = 64
const MAX_CELLS = 20_000

const isSpaceOrTab = (c: string | undefined) => c === ' ' || c === '\t'

function isBlank(line: string): boolean {
  for (let i = 0; i < line.length; i++) if (!isSpaceOrTab(line[i])) return false
  return true
}

/** `line` without trailing spaces and tabs. */
function trimEndSpaces(line: string): string {
  let end = line.length
  while (end > 0 && isSpaceOrTab(line[end - 1])) end--
  return end === line.length ? line : line.slice(0, end)
}

/** An ATX heading: up to three spaces, one to six `#`, then the text without a closing `#` run. */
export function atxHeading(line: string): { level: number; text: string } | null {
  let i = 0
  while (i < 3 && line[i] === ' ') i++
  let level = 0
  while (line[i + level] === '#') level++
  if (level < 1 || level > 6) return null
  let start = i + level
  if (start < line.length && !isSpaceOrTab(line[start])) return null
  let end = line.length
  while (end > start && isSpaceOrTab(line[end - 1])) end--
  let hashes = end
  while (hashes > start && line[hashes - 1] === '#') hashes--
  if (hashes < end && (hashes === start || isSpaceOrTab(line[hashes - 1]))) {
    end = hashes
    while (end > start && isSpaceOrTab(line[end - 1])) end--
  }
  while (start < end && isSpaceOrTab(line[start])) start++
  return { level, text: line.slice(start, end) }
}

/** A table's delimiter row: cells of `-` with optional `:` at either end, split by `|`. */
function isTableDelimiter(line: string): boolean {
  if (indentOf(line) > 3) return false
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  if (row.trim() === '') return false
  return row.split('|').every((cell) => /^:?-+:?$/.test(cell.trim()))
}

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
      const atx = atxHeading(line)
      if (atx) {
        out.push({ t: 'h', level: atx.level, c: this.inline.parse(atx.text) })
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
      if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
        const head = splitRow(line)
        const delims = splitRow(lines[i + 1])
        if (head.length === delims.length && head.length <= MAX_COLUMNS) {
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
      const text = trimEndSpaces(para.map((l) => l.replace(/^[ \t]+/, '')).join('\n'))
      out.push(heading ? { t: 'h', level: heading, c: this.inline.parse(text) } : { t: 'p', c: this.inline.parse(text) })
    }
    return out
  }

  /** Whether a line ends a paragraph above it. */
  private interrupts(line: string): boolean {
    if (indentOf(line) >= 4) return false
    const f = FENCE.exec(line)
    if (f && !(f[2][0] === '`' && f[3].includes('`'))) return true
    if (atxHeading(line) || HR.test(line) || QUOTE.test(line)) return true
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
    let count = head.length
    while (i < lines.length && !isBlank(lines[i]) && !this.interrupts(lines[i])) {
      const cells = splitRow(lines[i])
      const row: Inline[][] = []
      // Short rows get empty cells, as in GFM, until the table is large; then only their own.
      const width = count < MAX_CELLS ? head.length : Math.min(head.length, cells.length)
      for (let c = 0; c < width; c++) row.push(c < cells.length ? this.inline.parse(cells[c]) : [])
      count += width
      rows.push(row)
      i++
    }
    out.push({ t: 'table', align, head: head.map((cell) => this.inline.parse(cell)), rows })
    return i
  }

  /** HTML is never rendered: its tags go, its text stays, block tags and `<br>` break lines. */
  private htmlBlock(html: string): Block[] {
    const text = replaceBlockTags(removeComments(removeElements(html, ['script', 'style']))).replace(/<br\s*\/?>/gi, '\n')
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

/**
 * `<script>…</script>` and `<style>…</style>` with their content. Scans forward with indexOf: once
 * no closing tag is left, no later opening tag can have one either.
 */
function removeElements(html: string, names: string[]): string {
  let out = html
  for (const name of names) {
    const lower = out.toLowerCase()
    const open = new RegExp(`<${name}\\b`, 'g')
    const parts: string[] = []
    let at = 0
    for (let m = open.exec(lower); m; m = open.exec(lower)) {
      const close = lower.indexOf(`</${name}`, m.index)
      if (close < 0) break
      let end = close + name.length + 2
      while (end < lower.length && /\s/.test(lower[end])) end++
      if (lower[end] !== '>') {
        open.lastIndex = close + 1
        continue
      }
      parts.push(out.slice(at, m.index))
      at = end + 1
      open.lastIndex = at
    }
    parts.push(out.slice(at))
    out = parts.join('')
  }
  return out
}

function removeComments(html: string): string {
  const parts: string[] = []
  let at = 0
  for (;;) {
    const open = html.indexOf('<!--', at)
    if (open < 0) break
    const close = html.indexOf('-->', open + 4)
    if (close < 0) break
    parts.push(html.slice(at, open))
    at = close + 3
  }
  parts.push(html.slice(at))
  return parts.join('')
}

const BLOCK_TAG = /<\/?(?:p|div|li|tr|h[1-6]|ul|ol|table|thead|tbody|blockquote|pre|hr|details|summary|section|dl|dt|dd)\b/gi

/** Block-level tags become line breaks. A tag runs to the next `>`; with none left, it stays. */
function replaceBlockTags(html: string): string {
  const parts: string[] = []
  let at = 0
  BLOCK_TAG.lastIndex = 0
  for (let m = BLOCK_TAG.exec(html); m; m = BLOCK_TAG.exec(html)) {
    const end = html.indexOf('>', m.index)
    if (end < 0) break
    parts.push(html.slice(at, m.index), '\n')
    at = end + 1
    BLOCK_TAG.lastIndex = at
  }
  parts.push(html.slice(at))
  return parts.join('')
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

/** `orig`: the length of the whole run, for the rule of three. */
type Delim = { kind: 'delim'; ch: '*' | '_' | '~'; count: number; orig: number; open: boolean; close: boolean }
type Tok = { kind: 'node'; node: Inline } | Delim

const ASCII_PUNCT = /[!-/:-@[-`{-~]/
const PUNCT = /[\p{P}\p{S}]/u
const isWs = (c: string) => c === '' || /\s/.test(c)
const isPunct = (c: string) => c !== '' && PUNCT.test(c)
const AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/
const EMAIL = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/
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
/** Drops the backslash before escaped ASCII punctuation, as in a link destination. */
function unescapePunctuation(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, (_whole, char: string) => char)
}

function trimUrl(url: string): string {
  let open = 0
  let close = 0
  for (let k = 0; k < url.length; k++) {
    if (url[k] === '(') open++
    else if (url[k] === ')') close++
  }
  let end = url.length
  while (end > 0) {
    const c = url[end - 1]
    if ('?!.,:*_~\'"'.includes(c)) {
      end--
      continue
    }
    if (c === ')' && close > open) {
      close--
      end--
      continue
    }
    if (c === ';') {
      // A trailing entity reference such as `&amp;` goes as a whole.
      let k = end - 1
      while (k > 0 && /[a-zA-Z0-9]/.test(url[k - 1])) k--
      if (k < end - 1 && k > 0 && url[k - 1] === '&') {
        for (let n = k - 1; n < end; n++) {
          if (url[n] === '(') open--
          else if (url[n] === ')') close--
        }
        end = k - 1
        continue
      }
    }
    break
  }
  return url.slice(0, end)
}

/**
 * `indexOf` for many searches that move forward through one text: a search that found nothing
 * from some point finds nothing from any later point, so long unclosed runs cost one scan in all.
 */
class Finder {
  private readonly found = new Map<string, { from: number; at: number }>()
  constructor(private readonly src: string) {}

  next(needle: string, from: number): number {
    const last = this.found.get(needle)
    if (last && from >= last.from && (last.at < 0 || from <= last.at)) return last.at
    const at = this.src.indexOf(needle, from)
    this.found.set(needle, { from, at })
    return at
  }
}

/** The end of an inline HTML tag or comment that starts at `start`, or -1. */
function htmlTagEnd(src: string, start: number, find: Finder): number {
  if (src.startsWith('<!--', start)) {
    const close = find.next('-->', start + 4)
    return close < 0 || close - start > 2048 ? -1 : close + 3
  }
  const limit = Math.min(src.length, start + 2048)
  let i = start + 1
  const closing = src[i] === '/'
  if (closing) i++
  if (!/[A-Za-z]/.test(src[i] ?? '')) return -1
  i++
  while (i < limit && /[A-Za-z0-9-]/.test(src[i])) i++
  const skip = () => {
    const from = i
    while (i < limit && /\s/.test(src[i])) i++
    return i - from
  }
  if (closing) {
    skip()
    return src[i] === '>' ? i + 1 : -1
  }
  for (;;) {
    const space = skip()
    if (src[i] === '>') return i + 1
    if (src[i] === '/' && src[i + 1] === '>') return i + 2
    if (space === 0 || i >= limit || !/[A-Za-z_:]/.test(src[i])) return -1
    i++
    while (i < limit && /[\w:.-]/.test(src[i])) i++
    const afterName = i
    skip()
    if (src[i] !== '=') {
      i = afterName
      continue
    }
    i++
    skip()
    const q = src[i]
    if (q === '"' || q === "'") {
      const close = find.next(q, i + 1)
      if (close < 0 || close >= limit) return -1
      i = close + 1
    } else {
      const from = i
      while (i < limit && !/[\s"'=<>`]/.test(src[i])) i++
      if (i === from) return -1
    }
  }
}

/**
 * The `]` that closes each `[`, skipping escapes and code spans, in one pass with a stack: -1 when
 * unclosed or when the label would be longer than 4000 characters.
 */
function bracketMatches(src: string, ticks: Backticks): Map<number, number> {
  const matches = new Map<number, number>()
  const stack: number[] = []
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') i++
    else if (c === '`') {
      let run = 1
      while (src[i + run] === '`') run++
      const close = ticks.find(i + run, run)
      i = close >= 0 ? close + run - 1 : i + run - 1
    } else if (c === '[') stack.push(i)
    else if (c === ']' && stack.length > 0) {
      const open = stack.pop()!
      if (i - open < 4000) matches.set(open, i)
    }
  }
  return matches
}

/** Backtick runs by length, found once, so each code span looks up its closing run directly. */
class Backticks {
  private runs: Map<number, number[]> | null = null
  constructor(private readonly src: string) {}

  /** The first run of exactly `run` backticks at or after `from`, or -1. */
  find(from: number, run: number): number {
    if (!this.runs) {
      this.runs = new Map()
      let i = this.src.indexOf('`')
      while (i >= 0) {
        let n = 1
        while (this.src[i + n] === '`') n++
        const list = this.runs.get(n)
        if (list) list.push(i)
        else this.runs.set(n, [i])
        i = this.src.indexOf('`', i + n)
      }
    }
    const list = this.runs.get(run)
    if (!list) return -1
    let lo = 0
    let hi = list.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (list[mid] < from) lo = mid + 1
      else hi = mid
    }
    return lo < list.length ? list[lo] : -1
  }
}

export class InlineParser {
  constructor(private readonly defs: Map<string, Definition>) {}

  parse(src: string, depth = 0): Inline[] {
    const toks: Tok[] = []
    const scan: Scan = { find: new Finder(src), ticks: new Backticks(src), brackets: null }
    // Text so far, as pieces: a space is always a piece of its own, so trailing spaces are
    // counted and dropped at a line break without looking at (or copying) the whole text.
    const buf: string[] = []
    let spaces = 0
    const add = (piece: string) => {
      buf.push(piece)
      spaces = piece === ' ' ? spaces + 1 : 0
    }
    const flush = () => {
      if (buf.length > 0) toks.push({ kind: 'node', node: { t: 'text', v: buf.join('') } })
      buf.length = 0
      spaces = 0
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
          add(n)
          i += 2
        } else {
          add(c)
          i++
        }
        continue
      }
      if (c === '`') {
        let run = 1
        while (src[i + run] === '`') run++
        const close = scan.ticks.find(i + run, run)
        if (close < 0) {
          add('`'.repeat(run))
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
          add(c.repeat(run))
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
        toks.push({ kind: 'delim', ch: c, count: run, orig: run, open, close })
        i += run
        continue
      }
      if (c === '!' && src[i + 1] === '[') {
        const link = this.link(src, i + 1, true, depth, scan)
        if (link) {
          push(link.node)
          i = link.end
          continue
        }
      }
      if (c === '[') {
        const link = this.link(src, i, false, depth, scan)
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
        const end = htmlTagEnd(src, i, scan.find)
        if (end > 0) {
          if (/^<br\s*\/?>$/i.test(src.slice(i, end))) push({ t: 'br' })
          i = end
          continue
        }
      }
      if (c === '&') {
        const m = ENTITY.exec(src.slice(i, i + 40))
        const decoded = m ? decodeEntity(m) : null
        if (m && decoded !== null) {
          add(decoded)
          spaces = 0
          i += m[0].length
          continue
        }
      }
      if (c === '\n') {
        const hard = spaces >= 2
        buf.length -= spaces
        spaces = 0
        if (hard) push({ t: 'br' })
        else add(' ')
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
      add(c)
      i++
    }
    flush()
    return emphasis(toks)
  }

  private link(src: string, start: number, image: boolean, depth: number, scan: Scan): { node: Inline; end: number } | null {
    scan.brackets ??= bracketMatches(src, scan.ticks)
    const close = scan.brackets.get(start) ?? -1
    if (close < 0) return null
    const label = src.slice(start + 1, close)
    const make = (href: string, title?: string): Inline =>
      image
        ? { t: 'image', src: href, alt: depth > 3 ? label : plainText(this.parse(label, depth + 1)) }
        : { t: 'link', href, title, c: depth > 3 ? [{ t: 'text', v: label }] : this.parse(label, depth + 1) }
    const j = close + 1
    if (src[j] === '(') {
      const dest = destination(src, j + 1, scan.find)
      if (dest) return { node: make(dest.href, dest.title), end: dest.end }
    }
    let ref = label
    let end = j
    if (src[j] === '[') {
      const c2 = scan.find.next(']', j + 1)
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

interface Scan {
  find: Finder
  ticks: Backticks
  brackets: Map<number, number> | null
}

/** `(href "title")` after a link's text; `start` is just past the `(`. */
function destination(src: string, start: number, find: Finder): { href: string; title?: string; end: number } | null {
  let i = start
  const skip = () => {
    while (i < src.length && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n')) i++
  }
  skip()
  let href = ''
  if (src[i] === '<') {
    const close = find.next('>', i + 1)
    if (close < 0) return null
    const newline = find.next('\n', i + 1)
    if (newline >= 0 && newline < close) return null
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
    href = unescapePunctuation(src.slice(from, i))
  }
  skip()
  let title: string | undefined
  const q = src[i]
  if (q === '"' || q === "'" || q === '(') {
    const closeChar = q === '(' ? ')' : q
    const close = find.next(closeChar, i + 1)
    if (close < 0) return null
    title = src.slice(i + 1, close)
    i = close + 1
    skip()
  }
  if (src[i] !== ')') return null
  return { href, title, end: i + 1 }
}

/** An opening delimiter run still waiting for its closer, and what has come after it. */
interface Frame {
  id: number
  delim: Delim
  items: Inline[]
  /** The deepest emphasis among `items`. */
  depth: number
}

/** Open runs kept at once; past this the oldest one becomes text. */
const MAX_OPEN = 64
const depthOf = new WeakMap<Inline, number>()

function pushAll(target: Inline[], items: Inline[]): void {
  for (const item of items) target.push(item)
}

/**
 * CommonMark's delimiter algorithm for `*`, `_` and `~~`, over a stack of open runs. A closer looks
 * down the stack for an opener, but never below where the last failed search for its kind stopped
 * (CommonMark's `openers_bottom`); every item is moved at most once, so the pass is linear.
 * Emphasis that would nest deeper than MAX_EMPHASIS is not made: its delimiters stay text.
 */
function emphasis(toks: Tok[]): Inline[] {
  const root = { items: [] as Inline[], depth: 0 }
  const stack: Frame[] = []
  const bottom = new Map<string, number>()
  let ids = 0
  const top = () => (stack.length > 0 ? stack[stack.length - 1] : root)
  const add = (into: { items: Inline[]; depth: number }, node: Inline) => {
    into.items.push(node)
    into.depth = Math.max(into.depth, depthOf.get(node) ?? 0)
  }
  const asText = (delim: Delim): Inline | null => (delim.count > 0 ? { t: 'text', v: delim.ch.repeat(delim.count) } : null)
  /** Frames from `from` up, in order, as text and items appended to `into`. */
  const collapse = (into: { items: Inline[]; depth: number }, from: number) => {
    for (const frame of stack.splice(from)) {
      const marks = asText(frame.delim)
      if (marks) into.items.push(marks)
      pushAll(into.items, frame.items)
      into.depth = Math.max(into.depth, frame.depth)
    }
  }
  for (const tok of toks) {
    if (tok.kind === 'node') {
      add(top(), tok.node)
      continue
    }
    const closer = tok
    while (closer.close && closer.count > 0) {
      const key = `${closer.ch}${closer.open ? 1 : 0}${closer.orig % 3}`
      const floor = bottom.get(key) ?? -1
      let at = stack.length - 1
      for (; at >= 0 && stack[at].id > floor; at--) {
        const o = stack[at].delim
        if (o.ch !== closer.ch || o.count === 0) continue
        // The rule of three: `*foo**bar*` must not pair `*` with `**`.
        if (o.ch !== '~' && (o.close || closer.open) && (o.orig + closer.orig) % 3 === 0 && !(o.orig % 3 === 0 && closer.orig % 3 === 0)) continue
        break
      }
      if (at < 0 || stack[at].id <= floor) {
        bottom.set(key, stack.length > 0 ? stack[stack.length - 1].id : -1)
        break
      }
      let depth = stack[at].depth
      for (let k = at + 1; k < stack.length; k++) depth = Math.max(depth, stack[k].depth)
      if (depth + 1 > MAX_EMPHASIS) break
      const frame = stack[at]
      // Runs between the opener and the closer can no longer match: they become text.
      collapse(frame, at + 1)
      const opener = frame.delim
      const use = closer.ch === '~' ? 2 : opener.count >= 2 && closer.count >= 2 ? 2 : 1
      opener.count -= use
      closer.count -= use
      const node: Inline = { t: closer.ch === '~' ? 'del' : use === 2 ? 'strong' : 'em', c: flatten(frame.items) }
      depthOf.set(node, depth + 1)
      if (opener.count > 0) {
        frame.items = [node]
        frame.depth = depth + 1
      } else {
        stack.pop()
        add(top(), node)
      }
    }
    if (closer.count === 0) continue
    if (closer.open) {
      if (stack.length >= MAX_OPEN) {
        // The oldest open run gives up: it and what follows it move to the text before.
        const oldest = stack[0]
        stack.shift()
        const marks = asText(oldest.delim)
        if (marks) root.items.push(marks)
        pushAll(root.items, oldest.items)
        root.depth = Math.max(root.depth, oldest.depth)
      }
      stack.push({ id: ids++, delim: closer, items: [], depth: 0 })
    } else {
      const marks = asText(closer)
      if (marks) add(top(), marks)
    }
  }
  collapse(root, 0)
  return flatten(root.items)
}

function flatten(nodes: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const node of nodes) {
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
