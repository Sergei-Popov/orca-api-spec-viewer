// `$ref` and `$dynamicRef` resolution, lazily and safely. A reference into the open file resolves
// to a location in it: a JSON Pointer fragment, a plain-name fragment (`$anchor`,
// `$dynamicAnchor`) or a schema `$id`. Anything else names another file, which the editor never
// receives: it is "external" unless the person loaded that file into the viewer by hand.
// Chains are followed with a hop limit and cycle detection, so recursive schemas stay links.
// Inside a schema resource (an object with `$id`), references resolve against that resource
// first, as JSON Schema 2020-12 says, and then against the document root, which many documents
// expect.

import { fragmentToPath, getAt, isObject, toPointer } from './pointer'

/** A place in one of the documents: '' is the open file, others are files loaded by hand. */
export interface Loc {
  doc: string
  path: readonly string[]
}

export type Resolution =
  | { kind: 'local'; loc: Loc; value: unknown }
  | { kind: 'external'; ref: string; file: string; fragment: string }
  | { kind: 'missing'; ref: string; reason: 'not-found' | 'anchor-not-found' | 'bad-ref' | 'too-long' }

export interface Followed {
  value: unknown
  loc: Loc
  /** The references followed to get here, outermost first. */
  via: string[]
  /** Set when the chain ends at a reference that does not resolve into a loaded document, or
   * that is more than MAX_HOPS references from the start (`reason: 'too-long'`). */
  stop?: Exclude<Resolution, { kind: 'local' }>
  /** Set when the chain comes back to a reference it already followed. */
  cycle?: boolean
}

/** References followed in a row at most; a longer chain stops with `reason: 'too-long'`. */
export const MAX_HOPS = 128
/** The reference index does not look deeper than this into a document. */
const MAX_INDEX_DEPTH = 512

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
  /** Schema resources by the pointer of their object: its path and absolute base URI. */
  resources: Map<string, { path: string[]; base: string | null }>
}

export class Refs {
  private readonly docs = new Map<string, unknown>()
  private readonly names = new Map<string, string>()
  private readonly indexes = new Map<string, DocIndex>()

  /** Merged views of a reference's target with its siblings, one per referring object. */
  private readonly merged = new WeakMap<object, { target: unknown; value: unknown }>()

  /**
   * `siblings`: a reference's sibling fields apply, as in OpenAPI 3.1+ (JSON Schema 2020-12, and
   * Reference Objects' summary and description). In Swagger 2.0, OpenAPI 3.0 and AsyncAPI
   * (draft-07) they are ignored.
   */
  constructor(main: unknown, private readonly options: { siblings?: boolean } = {}) {
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

  /** `at`: where the reference is (the object that holds it), for the enclosing `$id`. */
  resolve(ref: string, from = '', dynamic = false, at?: readonly string[]): Resolution {
    if (typeof ref !== 'string') return { kind: 'missing', ref: String(ref), reason: 'bad-ref' }
    const { file, fragment } = splitRef(ref.trim())
    const resource = at && this.docs.has(from) ? this.resourceOf(from, at) : null
    let doc: string | null = from
    let base: readonly string[] = resource?.path ?? []
    // A fragment-only reference inside a resource is tried there first, then from the root.
    let fallback = resource !== null && resource.path.length > 0
    if (file !== '') {
      fallback = false
      base = []
      const byId = this.findId(from, file) ?? (resource?.base ? this.findId(from, resolveUri(file, resource.base) ?? '') : null)
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
      if (value !== undefined) return { kind: 'local', loc: { doc, path: full }, value }
      if (fallback) {
        const fromRoot = getAt(this.docs.get(doc), path)
        if (fromRoot !== undefined) return { kind: 'local', loc: { doc, path }, value: fromRoot }
      }
      return { kind: 'missing', ref, reason: 'not-found' }
    }
    const name = fragment.slice(1)
    const index = this.index(doc)
    const found = (dynamic ? index.dynamicAnchors.get(name) ?? index.anchors.get(name) : index.anchors.get(name) ?? index.dynamicAnchors.get(name))
    if (!found) return { kind: 'missing', ref, reason: 'anchor-not-found' }
    const loc = { doc, path: found }
    return { kind: 'local', loc, value: this.get(loc) }
  }

  /** The innermost schema resource (`$id`) that contains `path`, if any. */
  private resourceOf(doc: string, path: readonly string[]): { path: string[]; base: string | null } | null {
    const index = this.index(doc)
    if (index.resources.size === 0) return null
    let found = index.resources.get('') ?? null
    let pointer = ''
    for (const segment of path) {
      pointer += '/' + segment.replace(/~/g, '~0').replace(/\//g, '~1')
      found = index.resources.get(pointer) ?? found
    }
    return found
  }

  /** Follows `$ref` (and `$dynamicRef`) from `value` at `loc` until a value without one. */
  follow(value: unknown, loc: Loc): Followed {
    const via: string[] = []
    const seen = new Set<string>([locKey(loc)])
    const referring: Record<string, unknown>[] = []
    let current = value
    let at = loc
    for (let hop = 0; ; hop++) {
      const ref = refOf(current)
      if (!ref) return { value: this.options.siblings ? this.withSiblings(current, referring, isSchemaPlace(at.path)) : current, loc: at, via }
      referring.push(current as Record<string, unknown>)
      // A long chain is not a cycle: it stops with its own reason.
      if (hop >= MAX_HOPS) return { value: current, loc: at, via, stop: { kind: 'missing', ref: ref.ref, reason: 'too-long' } }
      via.push(ref.ref)
      const resolution = this.resolve(ref.ref, at.doc, ref.dynamic, at.path)
      if (resolution.kind !== 'local') return { value: current, loc: at, via, stop: resolution }
      const key = locKey(resolution.loc)
      if (seen.has(key)) return { value: current, loc: at, via, cycle: true }
      seen.add(key)
      current = resolution.value
      at = resolution.loc
    }
  }

  /**
   * The target as its references' siblings make it, innermost reference first. The view is cached
   * per referring object, so the same reference gives the same object (and recursion stays
   * recognisable); without siblings the target itself is returned.
   */
  private withSiblings(target: unknown, referring: Record<string, unknown>[], schema: boolean): unknown {
    let value = target
    for (let i = referring.length - 1; i >= 0; i--) {
      const outer = referring[i]
      if (!Object.keys(outer).some(isSibling)) continue
      const cached = this.merged.get(outer)
      if (cached && cached.target === value) {
        value = cached.value
        continue
      }
      const next = mergeSiblings(value, outer, schema)
      this.merged.set(outer, { target: value, value: next })
      value = next
    }
    return value
  }

  private findId(doc: string, uri: string): readonly string[] | null {
    const index = this.index(doc)
    const found = index.ids.get(uri) ?? index.ids.get(uri.replace(/#$/, ''))
    return found ? found : null
  }

  private index(doc: string): DocIndex {
    let index = this.indexes.get(doc)
    if (index) return index
    index = { ids: new Map(), anchors: new Map(), dynamicAnchors: new Map(), resources: new Map() }
    this.indexes.set(doc, index)
    buildIndex(this.docs.get(doc), index)
    return index
  }
}

/** Keywords that only describe: a sibling's value replaces the target's. */
const ANNOTATIONS = new Set(['title', 'summary', 'description', 'default', 'examples', 'example', 'readOnly', 'writeOnly', 'deprecated', '$comment', 'externalDocs', 'xml'])
/** Bounds: where both give one, the stricter applies. */
const LOWER_BOUNDS = new Set(['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties', 'minContains'])
const UPPER_BOUNDS = new Set(['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties', 'maxContains'])

/** Component sections and roots whose objects are not schemas (a schema inside them still is). */
const NOT_SCHEMAS = new Set(['parameters', 'responses', 'requestBodies', 'headers', 'examples', 'links', 'callbacks', 'securitySchemes', 'pathItems', 'mediaTypes'])

/** Whether a reference's target is a schema, judged by where it is. */
function isSchemaPlace(path: readonly string[]): boolean {
  const inside = (from: number) => path.slice(from).some((segment) => segment === 'schema' || segment === 'itemSchema')
  if (path[0] === 'components' && NOT_SCHEMAS.has(path[1])) return inside(2)
  if (path[0] === 'paths' || path[0] === 'webhooks') return inside(1)
  return true
}

/** A field beside `$ref` that says something about the target (not `$id`, `$defs`, …). */
function isSibling(key: string): boolean {
  return !key.startsWith('$') || key === '$comment'
}

/**
 * A reference's target with the reference's siblings applied: annotations replace the target's,
 * bounds take the stricter value, `required` lists are joined and `properties` added to; any
 * other keyword the target lacks is added (where both have one, both apply, and the target's is
 * shown).
 */
function mergeSiblings(target: unknown, referring: Record<string, unknown>, schema: boolean): unknown {
  if (!isObject(target)) return target
  const out: Record<string, unknown> = { ...target }
  for (const key of Object.keys(referring)) {
    if (!isSibling(key)) continue
    // A Reference Object to a parameter, response, … may override only these two.
    if (!schema && key !== 'summary' && key !== 'description') continue
    const mine = referring[key]
    const theirs = target[key]
    if (ANNOTATIONS.has(key) || !Object.prototype.hasOwnProperty.call(target, key)) out[key] = mine
    else if (typeof mine === 'number' && typeof theirs === 'number' && LOWER_BOUNDS.has(key)) out[key] = Math.max(mine, theirs)
    else if (typeof mine === 'number' && typeof theirs === 'number' && UPPER_BOUNDS.has(key)) out[key] = Math.min(mine, theirs)
    else if (key === 'required' && Array.isArray(mine) && Array.isArray(theirs)) out[key] = [...new Set([...theirs, ...mine])]
    else if (key === 'properties' && isObject(mine) && isObject(theirs)) out[key] = { ...theirs, ...mine }
  }
  return out
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

interface IndexEntry {
  node: unknown
  parent: IndexEntry | null
  key: string
  depth: number
  base: string | null
}

/** The path of an index entry, built only for the few nodes that need one. */
function entryPath(entry: IndexEntry): string[] {
  const path: string[] = []
  for (let e: IndexEntry | null = entry; e && e.parent; e = e.parent) path.push(e.key)
  return path.reverse()
}

/**
 * Walks a document once for `$id`, `$anchor` and `$dynamicAnchor`, skipping example data. Entries
 * link to their parent instead of carrying a path, so deep documents stay linear.
 */
function buildIndex(root: unknown, index: DocIndex): void {
  const seen = new WeakSet<object>()
  const stack: IndexEntry[] = [{ node: root, parent: null, key: '', depth: 0, base: null }]
  let steps = 0
  while (stack.length > 0 && steps++ < 2_000_000) {
    const entry = stack.pop()!
    const { node, base, depth } = entry
    if (!node || typeof node !== 'object' || seen.has(node) || depth > MAX_INDEX_DEPTH) continue
    seen.add(node)
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], parent: entry, key: String(i), depth: depth + 1, base })
      continue
    }
    const obj = node as Record<string, unknown>
    let nextBase = base
    let path: string[] | null = null
    const pathHere = () => (path ??= entryPath(entry))
    const id = own(obj, '$id')
    if (typeof id === 'string' && id !== '') {
      const clean = id.replace(/#$/, '')
      if (!index.ids.has(clean)) index.ids.set(clean, pathHere())
      const absolute = resolveUri(clean, base)
      if (absolute && !index.ids.has(absolute)) index.ids.set(absolute, pathHere())
      nextBase = absolute ?? base
      index.resources.set(toPointer(pathHere()), { path: pathHere(), base: nextBase })
    }
    const anchor = own(obj, '$anchor')
    if (typeof anchor === 'string' && !index.anchors.has(anchor)) index.anchors.set(anchor, pathHere())
    const dynamicAnchor = own(obj, '$dynamicAnchor')
    if (typeof dynamicAnchor === 'string' && !index.dynamicAnchors.has(dynamicAnchor)) {
      index.dynamicAnchors.set(dynamicAnchor, pathHere())
    }
    const keys = Object.keys(obj)
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i]
      if (key === 'example' || key === 'examples' || key === 'default' || key === 'enum' || key === 'const') continue
      stack.push({ node: obj[key], parent: entry, key, depth: depth + 1, base: nextBase })
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
