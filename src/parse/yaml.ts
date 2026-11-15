// YAML 1.2 through the vendored `yaml` library. Its document tree keeps every node's range, so
// the JavaScript value is built here by walking that tree (anchors and aliases become shared
// objects instead of copies, `<<` merge keys are applied) and the tree stays for `locate`.

import { isAlias, isMap, isScalar, isSeq, parseDocument } from '../../vendor/yaml/yaml.mjs'
import type { Alias, Document, Pair, YAMLMap } from '../../vendor/yaml/yaml.mjs'
import { toPointer } from '../spec/pointer'
import { setKey } from './json'
import type { ParseIssue } from './types'

export interface YamlParse {
  value: unknown
  issues: ParseIssue[]
  locate(path: readonly string[]): number | null
}

/**
 * Values the aliases may add to the tree, counted as if every alias were a copy of its anchor. The
 * value itself shares an anchor's object between its aliases, but whatever shows or checks the
 * value walks it as a tree; past this budget further aliases become null (a "billion laughs" file
 * is a few hundred bytes that stand for a billion values).
 */
export const ALIAS_BUDGET = 1_000_000

export function parseYaml(text: string): YamlParse {
  const doc = parseDocument(text, { merge: true, prettyErrors: false, keepSourceTokens: false })
  const issues: ParseIssue[] = []
  for (const error of doc.errors) {
    const offset = error.pos?.[0] ?? 0
    if (error.code === 'MULTIPLE_DOCS') {
      // Several documents (a Kubernetes manifest, a trailing `---`) are valid YAML: the first is
      // shown, and the others are named only when they hold something.
      if (!onlyMarkers(text.slice(offset))) issues.push({ code: 'yaml-documents', severity: 'info', message: '', offset })
      continue
    }
    const duplicate = error.code === 'DUPLICATE_KEY'
    issues.push({
      code: duplicate ? 'duplicate-key' : 'yaml-syntax',
      severity: duplicate ? 'warning' : 'error',
      message: firstLine(error.message),
      offset
    })
  }
  for (const warning of doc.warnings) {
    issues.push({ code: 'yaml-warning', severity: 'warning', message: firstLine(warning.message), offset: warning.pos?.[0] ?? 0 })
  }
  const walker = new Walker(doc, issues)
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

/** Whether the text after a document holds only `---`, `...`, comments and blank lines. */
function onlyMarkers(rest: string): boolean {
  for (const line of rest.split(/\r?\n/)) {
    const t = line.trim()
    if (t === '' || t.startsWith('#') || /^(---|\.\.\.)(\s+#.*)?$/.test(t)) continue
    return false
  }
  return true
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

interface PairLike {
  key: unknown
  value: unknown
}

function isPairLike(item: unknown): item is PairLike {
  return !!item && typeof item === 'object' && 'key' in item && 'value' in item && !isScalar(item) && !isMap(item) && !isSeq(item) && !isAlias(item)
}

/**
 * Where every alias points: the last node with its anchor before it, in document order (YAML's
 * rule). One pass over the tree; the library's own `Alias.resolve(doc)` walks the whole document
 * for every alias, which made files with many aliases quadratic.
 */
function aliasTargets(doc: Document): Map<Alias, unknown> {
  const targets = new Map<Alias, unknown>()
  const anchors = new Map<string, unknown>()
  const stack: unknown[] = [doc.contents]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (isAlias(node)) {
      targets.set(node, anchors.get(node.source))
      continue
    }
    if (isPairLike(node)) {
      stack.push(node.value, node.key)
      continue
    }
    const anchor = (node as { anchor?: unknown }).anchor
    if (typeof anchor === 'string' && anchor !== '') anchors.set(anchor, node)
    if (isMap(node) || isSeq(node)) {
      const items = node.items as unknown[]
      for (let i = items.length - 1; i >= 0; i--) stack.push(items[i])
    }
  }
  return targets
}

class Walker {
  private readonly values = new Map<unknown, unknown>()
  /** How many values a built node stands for as a tree, its aliases expanded. */
  private readonly sizes = new Map<unknown, number>()
  /** Collections being built (the ancestors of the current node), with their depth in `path`. */
  private readonly building = new Map<unknown, number>()
  private readonly path: string[] = []
  private readonly targets: Map<Alias, unknown>
  private readonly keyIndex = new WeakMap<YAMLMap, Map<string, Pair>>()
  /** Values added by aliases so far; see ALIAS_BUDGET. */
  private expanded = 0
  private overBudget = false
  /** The size of the value the last `value()` call returned. */
  private last = 1

  constructor(
    private readonly doc: Document,
    private readonly issues: ParseIssue[]
  ) {
    this.targets = aliasTargets(doc)
  }

  value(node: unknown): unknown {
    this.last = 1
    if (node === null || node === undefined) return null
    if (isScalar(node)) {
      const value = node.value
      return typeof value === 'bigint' ? Number(value) : value
    }
    if (isAlias(node)) return this.alias(node)
    const known = this.values.get(node)
    if (known !== undefined) {
      this.last = this.sizes.get(node) ?? 1
      return known
    }
    if (isMap(node)) {
      const obj: Record<string, unknown> = {}
      this.values.set(node, obj)
      this.building.set(node, this.path.length)
      let size = 1
      const merges: unknown[] = []
      for (const pair of node.items) {
        if (isMergeKey(pair.key)) {
          merges.push(pair.value)
          continue
        }
        const key = keyString(pair.key)
        this.path.push(key)
        setKey(obj, key, this.value(pair.value))
        this.path.pop()
        size += this.last
      }
      for (const source of merges) {
        const sources = isSeq(source) ? source.items : [source]
        for (const item of sources) {
          // `<<: *self` inside the anchored map itself: nothing to merge.
          if (isAlias(item) && this.building.has(this.targets.get(item))) {
            this.cycle(item)
            continue
          }
          const merged = this.value(item)
          if (!merged || typeof merged !== 'object' || Array.isArray(merged)) continue
          for (const key of Object.keys(merged)) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) setKey(obj, key, (merged as Record<string, unknown>)[key])
          }
          size += this.last
        }
      }
      this.building.delete(node)
      this.sizes.set(node, size)
      this.last = size
      return obj
    }
    if (isSeq(node)) {
      const arr: unknown[] = []
      this.values.set(node, arr)
      this.building.set(node, this.path.length)
      let size = 1
      node.items.forEach((item, index) => {
        this.path.push(String(index))
        arr.push(this.value(item))
        this.path.pop()
        size += this.last
      })
      this.building.delete(node)
      this.sizes.set(node, size)
      this.last = size
      return arr
    }
    return null
  }

  private alias(node: Alias): unknown {
    const target = this.targets.get(node)
    if (target === undefined) return null
    // An alias to one of its own ancestors would make a cycle, which JSON (and so an API document)
    // cannot hold: it becomes a reference to the anchor, the way a recursive schema is written.
    const depth = this.building.get(target)
    if (depth !== undefined) {
      this.cycle(node)
      return { $ref: '#' + toPointer(this.path.slice(0, depth)) }
    }
    if (isScalar(target)) return this.value(target)
    const size = this.values.has(target) ? this.sizes.get(target) ?? 1 : 0
    if (this.overBudget || this.expanded + size > ALIAS_BUDGET) {
      if (!this.overBudget) {
        this.overBudget = true
        this.issues.push({ code: 'yaml-alias-limit', severity: 'error', message: '', offset: rangeStart(node) ?? 0, params: { alias: node.source } })
      }
      return null
    }
    this.expanded += size
    return this.value(target)
  }

  private cycle(node: Alias): void {
    this.issues.push({ code: 'yaml-alias-cycle', severity: 'warning', message: '', offset: rangeStart(node) ?? 0, params: { alias: node.source } })
  }

  /** Drops the node → value table once the value is built; `locate` needs only the tree. */
  done(): void {
    this.values.clear()
    this.sizes.clear()
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
    for (let hops = 0; isAlias(node) && hops < 64; hops++) node = this.targets.get(node)
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
