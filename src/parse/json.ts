// JSON and JSON with comments. Clean JSON goes through the engine's JSON.parse, which is fast on
// a 14 MB spec; anything it refuses (comments, trailing commas, a cut-off file) goes through the
// tolerant parser below, which reports each problem with its offset and keeps what it read.
// Positions are found later and lazily: `JsonLocator` scans only the containers on a path.

import type { ParseIssue } from './types'

const MAX_DEPTH = 1000

class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number
  ) {
    super(message)
  }
}

/** Sets `obj[key]`, defining `__proto__` as a plain own property instead of a prototype. */
export function setKey(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
  } else {
    obj[key] = value
  }
}

export interface JsonParse {
  value: unknown
  issues: ParseIssue[]
  /** Whether the text had comments or trailing commas (JSONC). */
  relaxed: boolean
}

export function parseJson(text: string): JsonParse {
  try {
    return { value: JSON.parse(stripBom(text)), issues: [], relaxed: false }
  } catch {
    return new TolerantParser(text).run()
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

class TolerantParser {
  private pos = 0
  private readonly issues: ParseIssue[] = []
  private relaxed = false

  constructor(private readonly text: string) {}

  run(): JsonParse {
    let root: unknown = undefined
    try {
      this.skipTrivia()
      if (this.pos >= this.text.length) {
        throw new JsonSyntaxError('The file is empty.', this.pos)
      }
      this.parseValue((value) => (root = value), 0)
      this.skipTrivia()
      if (this.pos < this.text.length) {
        throw new JsonSyntaxError('Unexpected text after the end of the JSON value.', this.pos)
      }
    } catch (error) {
      if (error instanceof JsonSyntaxError) {
        this.issues.push({ code: 'json-syntax', severity: 'error', message: error.message, offset: error.offset })
      } else if (error instanceof RangeError) {
        this.issues.push({ code: 'json-syntax', severity: 'error', message: 'The JSON is nested too deeply.', offset: this.pos })
      } else {
        throw error
      }
    }
    return { value: root, issues: this.issues, relaxed: this.relaxed }
  }

  private parseValue(assign: (value: unknown) => void, depth: number): void {
    if (depth > MAX_DEPTH) throw new JsonSyntaxError('The JSON is nested too deeply.', this.pos)
    const text = this.text
    const ch = text.charCodeAt(this.pos)
    if (ch === 0x7b /* { */) {
      const obj: Record<string, unknown> = {}
      assign(obj)
      this.pos++
      this.parseMembers(obj, depth)
    } else if (ch === 0x5b /* [ */) {
      const arr: unknown[] = []
      assign(arr)
      this.pos++
      this.parseItems(arr, depth)
    } else if (ch === 0x22 /* " */) {
      assign(this.readString())
    } else if (ch === 0x2d || (ch >= 0x30 && ch <= 0x39)) {
      assign(this.readNumber())
    } else if (text.startsWith('true', this.pos)) {
      this.pos += 4
      assign(true)
    } else if (text.startsWith('false', this.pos)) {
      this.pos += 5
      assign(false)
    } else if (text.startsWith('null', this.pos)) {
      this.pos += 4
      assign(null)
    } else if (this.pos >= text.length) {
      throw new JsonSyntaxError('The file ends where a value should be.', this.pos)
    } else {
      throw new JsonSyntaxError(`Unexpected character ${describeChar(text, this.pos)}.`, this.pos)
    }
  }

  private parseMembers(obj: Record<string, unknown>, depth: number): void {
    const text = this.text
    let first = true
    for (;;) {
      this.skipTrivia()
      const ch = text.charCodeAt(this.pos)
      if (ch === 0x7d /* } */) {
        this.pos++
        return
      }
      if (!first) {
        if (ch !== 0x2c /* , */) {
          throw new JsonSyntaxError(this.pos >= text.length ? 'The file ends inside an object.' : 'Expected “,” or “}”.', this.pos)
        }
        this.pos++
        this.skipTrivia()
        if (text.charCodeAt(this.pos) === 0x7d) {
          this.relaxed = true // a trailing comma
          this.pos++
          return
        }
      }
      first = false
      if (text.charCodeAt(this.pos) !== 0x22) {
        throw new JsonSyntaxError(this.pos >= text.length ? 'The file ends inside an object.' : 'Expected a property name in double quotes.', this.pos)
      }
      const key = this.readString()
      this.skipTrivia()
      if (text.charCodeAt(this.pos) !== 0x3a /* : */) throw new JsonSyntaxError('Expected “:” after the property name.', this.pos)
      this.pos++
      this.skipTrivia()
      this.parseValue((value) => setKey(obj, key, value), depth + 1)
    }
  }

  private parseItems(arr: unknown[], depth: number): void {
    const text = this.text
    let first = true
    for (;;) {
      this.skipTrivia()
      const ch = text.charCodeAt(this.pos)
      if (ch === 0x5d /* ] */) {
        this.pos++
        return
      }
      if (!first) {
        if (ch !== 0x2c) {
          throw new JsonSyntaxError(this.pos >= text.length ? 'The file ends inside an array.' : 'Expected “,” or “]”.', this.pos)
        }
        this.pos++
        this.skipTrivia()
        if (text.charCodeAt(this.pos) === 0x5d) {
          this.relaxed = true // a trailing comma
          this.pos++
          return
        }
      }
      first = false
      const index = arr.length
      arr.push(null)
      this.parseValue((value) => (arr[index] = value), depth + 1)
    }
  }

  private readString(): string {
    const text = this.text
    const start = this.pos + 1
    let i = start
    // Fast path: no escapes before the closing quote.
    for (; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c === 0x22) {
        this.pos = i + 1
        return text.slice(start, i)
      }
      if (c === 0x5c || c < 0x20) break
    }
    let out = text.slice(start, i)
    for (; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c === 0x22) {
        this.pos = i + 1
        return out
      }
      if (c === 0x0a || c === 0x0d) {
        throw new JsonSyntaxError('A string is not closed before the end of the line.', i)
      }
      if (c === 0x5c) {
        const e = text[i + 1]
        i++
        switch (e) {
          case '"': out += '"'; break
          case '\\': out += '\\'; break
          case '/': out += '/'; break
          case 'b': out += '\b'; break
          case 'f': out += '\f'; break
          case 'n': out += '\n'; break
          case 'r': out += '\r'; break
          case 't': out += '\t'; break
          case 'u': {
            const hex = text.slice(i + 1, i + 5)
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new JsonSyntaxError('Invalid \\u escape in a string.', i - 1)
            out += String.fromCharCode(parseInt(hex, 16))
            i += 4
            break
          }
          default:
            throw new JsonSyntaxError('Invalid escape in a string.', i - 1)
        }
      } else {
        out += text[i]
      }
    }
    throw new JsonSyntaxError('The file ends inside a string.', this.pos)
  }

  private readNumber(): number {
    NUMBER.lastIndex = this.pos
    const match = NUMBER.exec(this.text)
    if (!match) throw new JsonSyntaxError('Invalid number.', this.pos)
    this.pos += match[0].length
    return Number(match[0])
  }

  private skipTrivia(): void {
    const text = this.text
    for (;;) {
      const c = text.charCodeAt(this.pos)
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0xfeff) {
        this.pos++
      } else if (c === 0x2f /* / */ && text.charCodeAt(this.pos + 1) === 0x2f) {
        this.relaxed = true
        const end = text.indexOf('\n', this.pos)
        this.pos = end < 0 ? text.length : end + 1
      } else if (c === 0x2f && text.charCodeAt(this.pos + 1) === 0x2a /* * */) {
        this.relaxed = true
        const end = text.indexOf('*/', this.pos + 2)
        if (end < 0) throw new JsonSyntaxError('A /* comment is not closed.', this.pos)
        this.pos = end + 2
      } else {
        return
      }
    }
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y

function describeChar(text: string, pos: number): string {
  const ch = text.codePointAt(pos) ?? 0
  return ch > 0x20 && ch < 0x7f ? `“${String.fromCodePoint(ch)}”` : `U+${ch.toString(16).toUpperCase().padStart(4, '0')}`
}

interface Member {
  key: number
  value: number
}

/** Finds where a path's node starts in JSON text, scanning only the containers on the path and
 *  caching what it scanned. Duplicate keys resolve to the last one, as JSON.parse does. */
export class JsonLocator {
  private readonly objects = new Map<number, Map<string, Member>>()
  private readonly arrays = new Map<number, number[]>()

  constructor(private readonly text: string) {}

  /** Offset of the member's key for an object member, of the value for an array item or the
   *  root; the deepest existing ancestor when the path runs past the text; null on no text. */
  locate(path: readonly string[]): number | null {
    let pos = this.skip(0)
    if (pos >= this.text.length) return null
    let found = pos
    for (const segment of path) {
      const ch = this.text.charCodeAt(pos)
      if (ch === 0x7b) {
        const member = this.members(pos).get(segment)
        if (!member) return found
        found = member.key
        pos = member.value
      } else if (ch === 0x5b) {
        const items = this.items(pos)
        const index = Number(segment)
        if (!Number.isInteger(index) || index < 0 || index >= items.length) return found
        found = pos = items[index]
      } else {
        return found
      }
    }
    return found
  }

  private members(start: number): Map<string, Member> {
    const cached = this.objects.get(start)
    if (cached) return cached
    const members = new Map<string, Member>()
    this.objects.set(start, members)
    const text = this.text
    let pos = start + 1
    for (;;) {
      pos = this.skip(pos)
      const ch = text.charCodeAt(pos)
      if (ch === 0x2c) {
        pos++
        continue
      }
      if (ch !== 0x22) break
      const keyAt = pos
      const keyEnd = this.skipString(pos)
      const key = decodeKey(text.slice(keyAt, keyEnd))
      pos = this.skip(keyEnd)
      if (text.charCodeAt(pos) !== 0x3a) break
      pos = this.skip(pos + 1)
      members.set(key, { key: keyAt, value: pos })
      const next = this.skipValue(pos)
      if (next <= pos) break
      pos = next
    }
    return members
  }

  private items(start: number): number[] {
    const cached = this.arrays.get(start)
    if (cached) return cached
    const items: number[] = []
    this.arrays.set(start, items)
    const text = this.text
    let pos = start + 1
    for (;;) {
      pos = this.skip(pos)
      const ch = text.charCodeAt(pos)
      if (ch === 0x2c) {
        pos++
        continue
      }
      if (ch === 0x5d || pos >= text.length) break
      items.push(pos)
      const next = this.skipValue(pos)
      if (next <= pos) break
      pos = next
    }
    return items
  }

  /** Past whitespace and comments. */
  private skip(pos: number): number {
    const text = this.text
    for (;;) {
      const c = text.charCodeAt(pos)
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0xfeff) pos++
      else if (c === 0x2f && text.charCodeAt(pos + 1) === 0x2f) {
        const end = text.indexOf('\n', pos)
        pos = end < 0 ? text.length : end + 1
      } else if (c === 0x2f && text.charCodeAt(pos + 1) === 0x2a) {
        const end = text.indexOf('*/', pos + 2)
        pos = end < 0 ? text.length : end + 2
      } else return pos
    }
  }

  /** Offset just past the closing quote of the string starting at `pos`. */
  private skipString(pos: number): number {
    const text = this.text
    for (let i = pos + 1; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c === 0x5c) i++
      else if (c === 0x22) return i + 1
      else if (c === 0x0a) return i
    }
    return text.length
  }

  /** Offset just past the value starting at `pos`. */
  private skipValue(pos: number): number {
    const text = this.text
    const ch = text.charCodeAt(pos)
    if (ch === 0x22) return this.skipString(pos)
    if (ch !== 0x7b && ch !== 0x5b) {
      let i = pos
      while (i < text.length) {
        const c = text.charCodeAt(i)
        if (c === 0x2c || c === 0x7d || c === 0x5d || c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x2f) break
        i++
      }
      return i
    }
    let depth = 0
    let i = pos
    while (i < text.length) {
      const c = text.charCodeAt(i)
      if (c === 0x22) {
        i = this.skipString(i)
        continue
      }
      if (c === 0x2f && (text.charCodeAt(i + 1) === 0x2f || text.charCodeAt(i + 1) === 0x2a)) {
        i = this.skip(i)
        continue
      }
      if (c === 0x7b || c === 0x5b) depth++
      else if (c === 0x7d || c === 0x5d) {
        depth--
        if (depth === 0) return i + 1
      }
      i++
    }
    return text.length
  }
}

function decodeKey(literal: string): string {
  if (literal.indexOf('\\') < 0) return literal.slice(1, -1)
  try {
    return JSON.parse(literal) as string
  } catch {
    return literal.slice(1, -1)
  }
}
