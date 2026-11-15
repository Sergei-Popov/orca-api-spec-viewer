// `$ref` and `$dynamicRef` resolution, lazily and safely. A reference into the open file resolves
// to a location in it: a JSON Pointer fragment, a plain-name fragment (`$anchor`,
// `$dynamicAnchor`) or a schema `$id`. Anything else names another file, which the editor never
// receives: it is "external" unless the person loaded that file into the viewer by hand.
// Chains are followed with a hop limit and cycle detection, so recursive schemas stay links.

import { fragmentToPath, getAt, isObject, toPointer } from './pointer'

/** A place in one of the documents: '' is the open file, others are files loaded by hand. */
export interface Loc {
  doc: string
  path: readonly string[]
}

export type Resolution =
  | { kind: 'local'; loc: Loc; value: unknown }
  | { kind: 'external'; ref: string; file: string; fragment: string }
  | { kind: 'missing'; ref: string; reason: 'not-found' | 'anchor-not-found' | 'bad-ref' }

export interface Followed {
  value: unknown
  loc: Loc
  /** The references followed to get here, outermost first. */
  via: string[]
  /** Set when the chain ends at a reference that does not resolve into a loaded document. */
  stop?: Exclude<Resolution, { kind: 'local' }>
  /** Set when the chain comes back to a reference it already followed. */
  cycle?: boolean
}

const MAX_HOPS = 32

export function locKey(loc: Loc): string {
  return `${loc.doc}#${toPointer(loc.path)}`
}

/** The file part of a reference: `./schemas/pet.yaml#/Pet` → `./schemas/pet.yaml`. */
export function splitRef(ref: string): { file: string; fragment: string } {
  const hash = ref.indexOf('#')
  return hash < 0 ? { file: ref, fragment: '' } : { file: ref.slice(0, hash), fragment: ref.slice(hash) }
}

/** `../common/pet.yaml?x=1` → `pet.yaml`; how a loaded file is matched to the references. */
export function fileBaseName(file: string): string {
  const clean = file.split(/[?#]/)[0]
  const name = clean.split(/[\\/]/).filter(Boolean).at(-1) ?? clean
  try {
    return decodeURIComponent(name).toLowerCase()
  } catch {
    return name.toLowerCase()
  }
}

interface DocIndex {
  ids: Map<string, string[]>
  anchors: Map<string, string[]>
  dynamicAnchors: Map<string, string[]>
}

export class Refs {
  private readonly docs = new Map<string, unknown>()
  private readonly names = new Map<string, string>()
  private readonly indexes = new Map<string, DocIndex>()

  constructor(main: unknown) {
    this.docs.set('', main)
  }

  /** Adds a file the person loaded; references whose file name matches resolve into it. */
  addDocument(fileName: string, value: unknown): string {
    const key = fileBaseName(fileName)
    this.docs.set(key, value)
    this.names.set(key, fileName)
    this.indexes.delete(key)
    return key
  }

  hasDocument(key: string): boolean {
    return this.docs.has(key)
  }

  documentName(key: string): string {
    return key === '' ? '' : this.names.get(key) ?? key
  }

  loadedDocuments(): string[] {
    return [...this.docs.keys()].filter((key) => key !== '')
  }

  root(doc = ''): unknown {
    return this.docs.get(doc)
  }

  get(loc: Loc): unknown {
    return getAt(this.docs.get(loc.doc), loc.path)
  }

  resolve(ref: string, from = '', dynamic = false): Resolution {
    if (typeof ref !== 'string') return { kind: 'missing', ref: String(ref), reason: 'bad-ref' }
    const { file, fragment } = splitRef(ref.trim())
    let doc: string | null = from
    let base: readonly string[] = []
    if (file !== '') {
      const byId = this.findId(from, file)
      if (byId) {
        doc = from
        base = byId
      } else {
        const key = fileBaseName(file)
        doc = key && this.docs.has(key) ? key : null
      }
    }
    if (doc === null) return { kind: 'external', ref, file, fragment }
    if (fragment === '' || fragment === '#') {
      return { kind: 'local', loc: { doc, path: base }, value: getAt(this.docs.get(doc), base) }
    }
    const path = fragmentToPath(fragment)
    if (path) {
      const full = [...base, ...path]
      const value = getAt(this.docs.get(doc), full)
      return value === undefined ? { kind: 'missing', ref, reason: 'not-found' } : { kind: 'local', loc: { doc, path: full }, value }
    }
    const name = fragment.slice(1)
    const index = this.index(doc)
    const found = (dynamic ? index.dynamicAnchors.get(name) ?? index.anchors.get(name) : index.anchors.get(name) ?? index.dynamicAnchors.get(name))
    if (!found) return { kind: 'missing', ref, reason: 'anchor-not-found' }
    const loc = { doc, path: found }
    return { kind: 'local', loc, value: this.get(loc) }
  }

  /** Follows `$ref` (and `$dynamicRef`) from `value` at `loc` until a value without one. */
  follow(value: unknown, loc: Loc): Followed {
    const via: string[] = []
    const seen = new Set<string>([locKey(loc)])
    let current = value
    let at = loc
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const ref = refOf(current)
      if (!ref) return { value: current, loc: at, via }
      via.push(ref.ref)
      const resolution = this.resolve(ref.ref, at.doc, ref.dynamic)
      if (resolution.kind !== 'local') return { value: current, loc: at, via, stop: resolution }
      const key = locKey(resolution.loc)
      if (seen.has(key)) return { value: current, loc: at, via, cycle: true }
      seen.add(key)
      current = resolution.value
      at = resolution.loc
    }
    return { value: current, loc: at, via, cycle: true }
  }

  private findId(doc: string, uri: string): readonly string[] | null {
    const index = this.index(doc)
    const found = index.ids.get(uri) ?? index.ids.get(uri.replace(/#$/, ''))
    return found ? found : null
  }

  private index(doc: string): DocIndex {
    let index = this.indexes.get(doc)
    if (index) return index
    index = { ids: new Map(), anchors: new Map(), dynamicAnchors: new Map() }
    this.indexes.set(doc, index)
    buildIndex(this.docs.get(doc), index)
    return index
  }
}

/** The reference an object carries: `$ref`, or a schema's `$dynamicRef`. */
export function refOf(value: unknown): { ref: string; dynamic: boolean } | null {
  if (!isObject(value)) return null
  const ref = Object.prototype.hasOwnProperty.call(value, '$ref') ? value.$ref : undefined
  if (typeof ref === 'string') return { ref, dynamic: false }
  const dynamic = Object.prototype.hasOwnProperty.call(value, '$dynamicRef') ? value.$dynamicRef : undefined
  if (typeof dynamic === 'string') return { ref: dynamic, dynamic: true }
  return null
}

/** Walks a document once for `$id`, `$anchor` and `$dynamicAnchor`, skipping example data. */
function buildIndex(root: unknown, index: DocIndex): void {
  const seen = new WeakSet<object>()
  const stack: { node: unknown; path: string[]; base: string | null }[] = [{ node: root, path: [], base: null }]
  let steps = 0
  while (stack.length > 0 && steps++ < 2_000_000) {
    const { node, path, base } = stack.pop()!
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], path: [...path, String(i)], base })
      continue
    }
    const obj = node as Record<string, unknown>
    let nextBase = base
    const id = own(obj, '$id')
    if (typeof id === 'string' && id !== '') {
      const clean = id.replace(/#$/, '')
      if (!index.ids.has(clean)) index.ids.set(clean, path)
      const absolute = resolveUri(clean, base)
      if (absolute && !index.ids.has(absolute)) index.ids.set(absolute, path)
      nextBase = absolute ?? base
    }
    const anchor = own(obj, '$anchor')
    if (typeof anchor === 'string' && !index.anchors.has(anchor)) index.anchors.set(anchor, path)
    const dynamicAnchor = own(obj, '$dynamicAnchor')
    if (typeof dynamicAnchor === 'string' && !index.dynamicAnchors.has(dynamicAnchor)) {
      index.dynamicAnchors.set(dynamicAnchor, path)
    }
    const keys = Object.keys(obj)
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i]
      if (key === 'example' || key === 'examples' || key === 'default' || key === 'enum' || key === 'const') continue
      stack.push({ node: obj[key], path: [...path, key], base: nextBase })
    }
  }
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined
}

function resolveUri(uri: string, base: string | null): string | null {
  try {
    return base ? new URL(uri, base).href.replace(/#$/, '') : new URL(uri).href.replace(/#$/, '')
  } catch {
    return null
  }
}
