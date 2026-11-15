// YAML 1.2 through the vendored `yaml` library. Its document tree keeps every node's range, so
// the JavaScript value is built here by walking that tree (anchors and aliases become shared
// objects instead of copies, `<<` merge keys are applied) and the tree stays for `locate`.

import { isAlias, isMap, isScalar, isSeq, parseDocument } from '../../vendor/yaml/yaml.mjs'
import type { Document, Pair, YAMLMap } from '../../vendor/yaml/yaml.mjs'
import { setKey } from './json'
import type { ParseIssue } from './types'

export interface YamlParse {
  value: unknown
  issues: ParseIssue[]
  locate(path: readonly string[]): number | null
}

export function parseYaml(text: string): YamlParse {
  const doc = parseDocument(text, { merge: true, prettyErrors: false, keepSourceTokens: false })
  const issues: ParseIssue[] = []
  for (const error of doc.errors) {
    const duplicate = error.code === 'DUPLICATE_KEY'
    issues.push({
      code: duplicate ? 'duplicate-key' : 'yaml-syntax',
      severity: duplicate ? 'warning' : 'error',
      message: firstLine(error.message),
      offset: error.pos?.[0] ?? 0
    })
  }
  for (const warning of doc.warnings) {
    issues.push({ code: 'yaml-warning', severity: 'warning', message: firstLine(warning.message), offset: warning.pos?.[0] ?? 0 })
  }
  const walker = new Walker(doc)
  let value: unknown = null
  try {
    value = walker.value(doc.contents)
    walker.done()
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    issues.push({ code: 'yaml-syntax', severity: 'error', message: 'The YAML is nested too deeply.', offset: 0 })
  }
  return { value, issues, locate: (path) => walker.locate(path) }
}

function firstLine(message: string): string {
  const line = message.split('\n')[0]
  // The library appends " at line N, column M"; the problems list shows the line itself.
  return line.replace(/ at line \d+, column \d+:?$/, '').trim()
}

function isMergeKey(key: unknown): boolean {
  if (!isScalar(key)) return false
  const value = key.value
  return (typeof value === 'symbol' && value.description === '<<') || (value === '<<' && (!key.type || key.type === 'PLAIN'))
}

function keyString(key: unknown): string {
  if (key === null || key === undefined) return ''
  if (isScalar(key)) {
    const value = key.value
    if (value === null || value === undefined) return ''
    return typeof value === 'string' ? value : String(value)
  }
  // A collection used as a key (rare): its source-like text.
  return String(key)
}

class Walker {
  private readonly values = new Map<unknown, unknown>()
  private readonly keyIndex = new WeakMap<YAMLMap, Map<string, Pair>>()

  constructor(private readonly doc: Document) {}

  value(node: unknown): unknown {
    if (node === null || node === undefined) return null
    if (isScalar(node)) {
      const value = node.value
      return typeof value === 'bigint' ? Number(value) : value
    }
    if (isAlias(node)) {
      const target = node.resolve(this.doc)
      return target === undefined ? null : this.value(target)
    }
    const known = this.values.get(node)
    if (known !== undefined) return known
    if (isMap(node)) {
      const obj: Record<string, unknown> = {}
      this.values.set(node, obj)
      const merges: unknown[] = []
      for (const pair of node.items) {
        if (isMergeKey(pair.key)) {
          merges.push(pair.value)
          continue
        }
        setKey(obj, keyString(pair.key), this.value(pair.value))
      }
      for (const source of merges) {
        const sources = isSeq(source) ? source.items : [source]
        for (const item of sources) {
          const merged = this.value(item)
          if (!merged || typeof merged !== 'object' || Array.isArray(merged)) continue
          for (const key of Object.keys(merged)) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) setKey(obj, key, (merged as Record<string, unknown>)[key])
          }
        }
      }
      return obj
    }
    if (isSeq(node)) {
      const arr: unknown[] = []
      this.values.set(node, arr)
      for (const item of node.items) arr.push(this.value(item))
      return arr
    }
    return null
  }

  /** Drops the node → value table once the value is built; `locate` needs only the tree. */
  done(): void {
    this.values.clear()
  }

  locate(path: readonly string[]): number | null {
    let node: unknown = this.deref(this.doc.contents)
    let found = rangeStart(node)
    if (found === null) return null
    for (const segment of path) {
      if (isMap(node)) {
        const pair = this.pair(node, segment)
        if (!pair) return found
        found = rangeStart(pair.key) ?? found
        node = this.deref(pair.value)
      } else if (isSeq(node)) {
        const index = Number(segment)
        const item = Number.isInteger(index) ? node.items[index] : undefined
        if (item === undefined) return found
        found = rangeStart(item) ?? found
        node = this.deref(item)
      } else {
        return found
      }
    }
    return found
  }

  private deref(node: unknown): unknown {
    for (let hops = 0; isAlias(node) && hops < 64; hops++) node = node.resolve(this.doc)
    return node
  }

  private pair(map: YAMLMap, key: string, depth = 0): Pair | undefined {
    let index = this.keyIndex.get(map)
    if (!index) {
      index = new Map()
      for (const pair of map.items) {
        if (!isMergeKey(pair.key)) index.set(keyString(pair.key), pair)
      }
      this.keyIndex.set(map, index)
    }
    const own = index.get(key)
    if (own || depth > 16) return own
    for (const pair of map.items) {
      if (!isMergeKey(pair.key)) continue
      const sources = isSeq(pair.value) ? pair.value.items : [pair.value]
      for (const source of sources) {
        const target = this.deref(source)
        if (isMap(target)) {
          const found = this.pair(target, key, depth + 1)
          if (found) return found
        }
      }
    }
    return undefined
  }
}

function rangeStart(node: unknown): number | null {
  if (node && typeof node === 'object' && 'range' in node) {
    const range = (node as { range?: [number, number, number] | null }).range
    if (range) return range[0]
  }
  return null
}
