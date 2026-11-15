// JSON text of a document value with a budget. Values from YAML can share subtrees through
// aliases, so a small file can stand for a huge tree: every place that shows or compares a value
// goes through here instead of `JSON.stringify`, and stops once it has written enough. The text is
// what `JSON.stringify` would give, up to the cut.

export interface JsonTextOptions {
  /** Characters to write at most; the text is cut there. */
  maxLength: number
  /** Spaces per level; 0 writes compact JSON. */
  indent?: number
  /** Levels to descend at most; deeper values are cut. */
  maxDepth?: number
}

export interface JsonText {
  text: string
  /** Set when the text stops before the end of the value (length, depth or a cycle). */
  cut: boolean
}

class Stop extends Error {}

/** JSON text of `value`, cut at `maxLength` characters. A cycle or a too-deep value is cut too. */
export function jsonText(value: unknown, options: JsonTextOptions): JsonText {
  const max = Math.max(0, options.maxLength)
  const indent = options.indent ?? 0
  const maxDepth = options.maxDepth ?? 256
  const parts: string[] = []
  let length = 0
  let cut = false
  const active = new Set<object>()

  const write = (s: string) => {
    if (length + s.length > max) {
      parts.push(s.slice(0, max - length))
      length = max
      cut = true
      throw new Stop()
    }
    parts.push(s)
    length += s.length
  }

  const scalar = (v: unknown): string | undefined => {
    if (v === null) return 'null'
    switch (typeof v) {
      case 'string':
        // A long string costs only what is written of it.
        return JSON.stringify(v.length > max - length + 2 ? v.slice(0, max - length + 2) : v)
      case 'number':
        return Number.isFinite(v) ? String(v) : 'null'
      case 'boolean':
        return v ? 'true' : 'false'
      case 'bigint':
        return JSON.stringify(v.toString())
      default:
        return undefined
    }
  }

  const visit = (v: unknown, depth: number): void => {
    const s = scalar(v)
    if (s !== undefined) {
      write(s)
      return
    }
    if (typeof v !== 'object' || v === null) {
      write('null')
      return
    }
    if (active.has(v) || depth >= maxDepth) {
      cut = true
      write('"…"')
      return
    }
    active.add(v)
    const pad = indent ? '\n' + ' '.repeat(indent * (depth + 1)) : ''
    const end = indent ? '\n' + ' '.repeat(indent * depth) : ''
    if (Array.isArray(v)) {
      if (v.length === 0) write('[]')
      else {
        write('[')
        for (let i = 0; i < v.length; i++) {
          if (i > 0) write(',')
          write(pad)
          const item = v[i]
          if (item === undefined || typeof item === 'function' || typeof item === 'symbol') write('null')
          else visit(item, depth + 1)
        }
        write(end + ']')
      }
    } else {
      const obj = v as Record<string, unknown>
      let first = true
      write('{')
      for (const key of Object.keys(obj)) {
        const item = obj[key]
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue
        write((first ? '' : ',') + pad + JSON.stringify(key) + (indent ? ': ' : ':'))
        first = false
        visit(item, depth + 1)
      }
      write(first ? '}' : end + '}')
    }
    active.delete(v)
  }

  try {
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return { text: '', cut: false }
    visit(value, 0)
  } catch (error) {
    if (!(error instanceof Stop)) throw error
  }
  return { text: parts.join(''), cut }
}

/** Whether two values are equal as JSON, giving up (false) past `budget` nodes. */
export function sameJson(a: unknown, b: unknown, budget = 100_000): boolean {
  const stack: [unknown, unknown][] = [[a, b]]
  let steps = 0
  while (stack.length > 0) {
    if (++steps > budget) return false
    const [x, y] = stack.pop()!
    if (x === y) continue
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) {
      if (typeof x === 'number' && typeof y === 'number' && Number.isNaN(x) && Number.isNaN(y)) continue
      return false
    }
    if (Array.isArray(x) !== Array.isArray(y)) return false
    if (Array.isArray(x)) {
      const ya = y as unknown[]
      if (x.length !== ya.length) return false
      for (let i = 0; i < x.length; i++) stack.push([x[i], ya[i]])
      continue
    }
    const xo = x as Record<string, unknown>
    const yo = y as Record<string, unknown>
    const xk = Object.keys(xo)
    const yk = Object.keys(yo)
    if (xk.length !== yk.length) return false
    for (const k of xk) {
      if (!Object.prototype.hasOwnProperty.call(yo, k)) return false
      stack.push([xo[k], yo[k]])
    }
  }
  return true
}

/**
 * A short key that equal JSON values share (object keys sorted, as sameJson ignores their order;
 * -0 as 0 and NaN as NaN, as sameJson compares them). Different values may share one too, so it
 * only narrows the values sameJson has to compare: duplicates are found in one pass.
 */
export function jsonKey(value: unknown, max = 200): string {
  let out = ''
  const stack: unknown[] = [value]
  while (stack.length > 0 && out.length < max) {
    const v = stack.pop()
    if (typeof v === 'string') out += JSON.stringify(v.length > max ? v.slice(0, max) : v)
    else if (typeof v === 'number') out += 'n' + String(v)
    else if (v === null || typeof v !== 'object') out += String(v)
    else if (Array.isArray(v)) {
      out += '[' + v.length
      for (let i = Math.min(v.length, 8) - 1; i >= 0; i--) stack.push(v[i])
    } else {
      const keys = Object.keys(v).sort()
      out += '{' + keys.length + JSON.stringify(keys.slice(0, 8)).slice(0, max)
      for (let i = Math.min(keys.length, 8) - 1; i >= 0; i--) stack.push((v as Record<string, unknown>)[keys[i]])
    }
    out += ','
  }
  return out.slice(0, max)
}

/** The indexes of values equal (as JSON) to an earlier one, found in one pass. */
export function duplicateIndexes(values: unknown[]): number[] {
  const buckets = new Map<string, unknown[]>()
  const out: number[] = []
  values.forEach((value, index) => {
    const key = jsonKey(value)
    const bucket = buckets.get(key)
    if (!bucket) buckets.set(key, [value])
    else if (bucket.some((other) => sameJson(other, value))) out.push(index)
    else bucket.push(value)
  })
  return out
}
