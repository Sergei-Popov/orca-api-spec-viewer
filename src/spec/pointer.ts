// JSON Pointers (RFC 6901) as arrays of segments, and safe reads by them.

export type Path = readonly string[]

export function escapeSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

export function unescapeSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** `['paths', '/pets', 'get']` → `/paths/~1pets/get`. The root is the empty string. */
export function toPointer(path: Path): string {
  let out = ''
  for (const segment of path) out += '/' + escapeSegment(segment)
  return out
}

/** `/paths/~1pets/get` → `['paths', '/pets', 'get']`; null when it is not a pointer. */
export function parsePointer(pointer: string): string[] | null {
  if (pointer === '') return []
  if (pointer[0] !== '/') return null
  return pointer.slice(1).split('/').map(unescapeSegment)
}

/** The fragment of a reference (`#/components/schemas/Pet%20Food`) as a path; null for a plain-name
 *  fragment such as `#pet` (an `$anchor`). */
export function fragmentToPath(fragment: string): string[] | null {
  let decoded = fragment.startsWith('#') ? fragment.slice(1) : fragment
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // A stray % stays as written.
  }
  return parsePointer(decoded)
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined
}

/** The value at `path`, reading own properties only; undefined when it is missing. */
export function getAt(root: unknown, path: Path): unknown {
  let node = root
  for (const segment of path) {
    if (Array.isArray(node)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= node.length || String(index) !== segment) return undefined
      node = node[index]
    } else if (isObject(node)) {
      if (!Object.prototype.hasOwnProperty.call(node, segment)) return undefined
      node = node[segment]
    } else {
      return undefined
    }
  }
  return node
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function startsWith(path: Path, prefix: Path): boolean {
  if (prefix.length > path.length) return false
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false
  return true
}
