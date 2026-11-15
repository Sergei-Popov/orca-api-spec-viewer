// Parameter values written the way the document says they are sent: `style` and `explode` in
// OpenAPI 3 (the style table of the specification), `collectionFormat` in Swagger 2.0. Arrays and
// objects differ by style; a plain value is written as it is.

import { jsonText } from './json-text'
import { isObject } from './pointer'

export interface ParamStyle {
  name: string
  /** OpenAPI 3 style (with the defaults filled in); absent in Swagger 2.0. */
  style?: string
  explode?: boolean
  /** Swagger 2.0: csv (the default), ssv, tsv, pipes or multi. */
  collectionFormat?: string
  /** A parameter with `content` is written as one JSON value, whatever it holds. */
  json?: boolean
}

type Shape = { kind: 'value'; text: string } | { kind: 'array'; items: string[] } | { kind: 'object'; entries: [string, string][] }

const MAX_ITEMS = 100

const SEPARATORS: Record<string, string> = { csv: ',', ssv: ' ', tsv: '\t', pipes: '|' }

/** One member of an array or object: nested values stay compact JSON. */
function memberText(value: unknown): string {
  return value !== null && typeof value === 'object' ? jsonText(value, { maxLength: 4000 }).text : String(value)
}

function shapeOf(p: ParamStyle, value: unknown): Shape {
  if (p.json || (p.style === undefined && isObject(value))) return { kind: 'value', text: memberText(value) }
  if (Array.isArray(value)) return { kind: 'array', items: value.slice(0, MAX_ITEMS).map(memberText) }
  if (isObject(value)) return { kind: 'object', entries: Object.keys(value).slice(0, MAX_ITEMS).map((key) => [key, memberText(value[key])]) }
  return { kind: 'value', text: String(value) }
}

const flat = (entries: [string, string][]) => entries.flatMap(([key, value]) => [key, value])

function explodes(p: ParamStyle): boolean {
  return p.explode ?? (p.style === 'form' || p.style === 'cookie')
}

/**
 * Name–value pairs of a query, cookie or form parameter, not yet encoded (each tool encodes them):
 * repeated names for exploded arrays and for Swagger's `multi`, `name[key]` for deepObject.
 */
export function styledPairs(p: ParamStyle, value: unknown): [string, string][] {
  const shape = shapeOf(p, value)
  const name = p.name
  if (shape.kind === 'value') return [[name, shape.text]]
  if (p.style === undefined) {
    // Swagger 2.0 has arrays only.
    const items = shape.kind === 'array' ? shape.items : flat(shape.entries)
    if (p.collectionFormat === 'multi') return items.map((item) => [name, item])
    return [[name, items.join(SEPARATORS[p.collectionFormat ?? 'csv'] ?? ',')]]
  }
  if (p.style === 'deepObject' && shape.kind === 'object') return shape.entries.map(([key, v]) => [`${name}[${key}]`, v])
  if (explodes(p)) return shape.kind === 'array' ? shape.items.map((item) => [name, item]) : shape.entries
  const separator = p.style === 'spaceDelimited' ? ' ' : p.style === 'pipeDelimited' ? '|' : ','
  return [[name, (shape.kind === 'array' ? shape.items : flat(shape.entries)).join(separator)]]
}

/** A path parameter's text in the URL (simple, label or matrix style), each part encoded. */
export function styledPath(p: ParamStyle, value: unknown, encode: (text: string) => string): string {
  const shape = shapeOf(p, value)
  const style = p.style
  const name = encode(p.name)
  if (style === undefined) {
    const items = shape.kind === 'array' ? shape.items : shape.kind === 'object' ? flat(shape.entries) : [shape.text]
    const separator = SEPARATORS[p.collectionFormat ?? 'csv'] ?? ','
    return separator === ',' ? items.map(encode).join(',') : encode(items.join(separator))
  }
  if (shape.kind === 'value') return style === 'label' ? '.' + encode(shape.text) : style === 'matrix' ? `;${name}=${encode(shape.text)}` : encode(shape.text)
  const explode = explodes(p)
  if (shape.kind === 'array') {
    const items = shape.items.map(encode)
    if (style === 'label') return '.' + items.join(explode ? '.' : ',')
    if (style === 'matrix') return explode ? items.map((item) => `;${name}=${item}`).join('') : `;${name}=${items.join(',')}`
    return items.join(',')
  }
  const pairs = shape.entries.map(([key, v]) => `${encode(key)}=${encode(v)}`)
  const all = flat(shape.entries).map(encode)
  if (style === 'label') return '.' + (explode ? pairs.join('.') : all.join(','))
  if (style === 'matrix') return explode ? pairs.map((pair) => ';' + pair).join('') : `;${name}=${all.join(',')}`
  return explode ? pairs.join(',') : all.join(',')
}

/** A header parameter's value (simple style, or Swagger's collectionFormat). */
export function styledHeader(p: ParamStyle, value: unknown): string {
  const shape = shapeOf(p, value)
  if (shape.kind === 'value') return shape.text
  if (p.style === undefined) return (shape.kind === 'array' ? shape.items : flat(shape.entries)).join(SEPARATORS[p.collectionFormat ?? 'csv'] ?? ',')
  if (shape.kind === 'array') return shape.items.join(',')
  return explodes(p) ? shape.entries.map(([key, v]) => `${key}=${v}`).join(',') : flat(shape.entries).join(',')
}
