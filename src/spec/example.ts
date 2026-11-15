// A JSON example built from a schema when the document gives none: given examples, `const`,
// `default` and `enum` first, then a placeholder by type and format. Bounded in depth and size;
// a recursive schema stops at the second visit.

import { isObject, own } from './pointer'
import type { Loc, Refs } from './refs'
import { schemaTypes } from './schema'

export interface ExampleOptions {
  /** Requests leave out `readOnly` properties, responses `writeOnly` ones. */
  mode: 'request' | 'response'
  maxDepth?: number
  maxNodes?: number
}

const FORMATS: Record<string, unknown> = {
  'date-time': '2024-05-01T12:00:00Z',
  date: '2024-05-01',
  time: '12:00:00',
  duration: 'P1D',
  email: 'user@example.com',
  'idn-email': 'user@example.com',
  hostname: 'example.com',
  'idn-hostname': 'example.com',
  ipv4: '192.0.2.1',
  ipv6: '2001:db8::1',
  uri: 'https://example.com',
  'uri-reference': '/path',
  iri: 'https://example.com',
  url: 'https://example.com',
  uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  byte: 'U3dhZ2dlciByb2Nrcw==',
  binary: '<binary>',
  password: '********',
  regex: '^[a-z]+$',
  'json-pointer': '/a/b',
  'relative-json-pointer': '0/a',
  'uri-template': 'https://example.com/{id}'
}

export function exampleFromSchema(refs: Refs, schema: unknown, loc: Loc, options: ExampleOptions): unknown {
  const state = { nodes: 0, maxNodes: options.maxNodes ?? 2000, maxDepth: options.maxDepth ?? 10, mode: options.mode }
  return build(refs, schema, loc, state, 0, new Set())
}

interface State {
  nodes: number
  maxNodes: number
  maxDepth: number
  mode: 'request' | 'response'
}

function build(refs: Refs, raw: unknown, loc: Loc, state: State, depth: number, seen: Set<string>): unknown {
  if (++state.nodes > state.maxNodes) return undefined
  const followed = refs.follow(raw, loc)
  if (followed.stop || followed.cycle) return undefined
  const schema = followed.value
  if (schema === true || schema === undefined) return undefined
  if (!isObject(schema)) return undefined
  const key = `${followed.loc.doc}#${followed.loc.path.join('/')}`
  // The starting schema counts too, so a component that contains itself stops at the first repeat.
  if (followed.via.length > 0 || depth === 0) {
    if (seen.has(key)) return undefined
    seen = new Set(seen).add(key)
  }
  if (depth > state.maxDepth) return undefined
  const at = followed.loc
  const sub = (value: unknown, ...segments: string[]) => build(refs, value, { doc: at.doc, path: [...at.path, ...segments] }, state, depth + 1, seen)

  if (Object.prototype.hasOwnProperty.call(schema, 'example')) return own(schema, 'example')
  const examples = own(schema, 'examples')
  if (Array.isArray(examples) && examples.length > 0) return examples[0]
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return own(schema, 'const')
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) return own(schema, 'default')
  const enumValues = own(schema, 'enum')
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues.find((v) => v !== null) ?? enumValues[0]

  const allOf = own(schema, 'allOf')
  if (Array.isArray(allOf)) {
    let merged: unknown = undefined
    allOf.forEach((part, index) => {
      const value = sub(part, 'allOf', String(index))
      merged = mergeExample(merged, value)
    })
    const rest = { ...schema }
    delete rest.allOf
    const own1 = Object.keys(rest).some((k) => k === 'properties' || k === 'type' || k === 'items') ? build(refs, rest, at, state, depth, seen) : undefined
    const result = mergeExample(merged, own1)
    if (result !== undefined) return result
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const list = own(schema, key)
    if (Array.isArray(list) && list.length > 0) {
      let value = sub(list[0], key, '0')
      const discriminator = own(schema, 'discriminator')
      if (isObject(value) && isObject(discriminator) && typeof discriminator.propertyName === 'string') {
        const mapping = isObject(discriminator.mapping) ? discriminator.mapping : {}
        const ref = isObject(list[0]) && typeof list[0].$ref === 'string' ? list[0].$ref : undefined
        const name = Object.keys(mapping).find((k) => mapping[k] === ref) ?? (ref ? ref.split('/').pop() : undefined)
        // A copy: the value may be the document's own example object.
        if (name && !Object.prototype.hasOwnProperty.call(value, discriminator.propertyName)) value = { ...value, [discriminator.propertyName]: name }
      }
      const props = own(schema, 'properties')
      if (isObject(props) && isObject(value)) {
        const base = build(refs, { ...schema, oneOf: undefined, anyOf: undefined, type: 'object' }, at, state, depth, seen)
        return mergeExample(base, value)
      }
      return value
    }
  }

  const types = schemaTypes(schema)
  const type = types.find((t) => t !== 'null') ?? (types.includes('null') ? 'null' : undefined)
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      const props = own(schema, 'properties')
      if (isObject(props)) {
        for (const name of Object.keys(props)) {
          const prop = refs.follow(props[name], { doc: at.doc, path: [...at.path, 'properties', name] }).value
          if (isObject(prop)) {
            if (state.mode === 'request' && prop.readOnly === true) continue
            if (state.mode === 'response' && prop.writeOnly === true) continue
          }
          const value = sub(props[name], 'properties', name)
          if (value !== undefined) out[name] = value
        }
      }
      const additional = own(schema, 'additionalProperties')
      if (Object.keys(out).length === 0 && isObject(additional)) {
        const value = sub(additional, 'additionalProperties')
        out.key = value === undefined ? 'value' : value
      }
      return out
    }
    case 'array': {
      const prefix = own(schema, 'prefixItems')
      if (Array.isArray(prefix)) return prefix.map((item, index) => sub(item, 'prefixItems', String(index))).filter((v) => v !== undefined)
      const items = own(schema, 'items')
      if (items === undefined) return []
      const value = sub(items, 'items')
      if (value === undefined) return []
      const min = typeof own(schema, 'minItems') === 'number' ? Math.min(own(schema, 'minItems') as number, 3) : 1
      return Array.from({ length: Math.max(1, min) }, () => value)
    }
    case 'string':
      return stringExample(schema)
    case 'integer':
    case 'number':
      return numberExample(schema, type === 'integer')
    case 'boolean':
      return true
    case 'null':
      return null
    case 'file':
      return '<file>'
  }
  if (isObject(own(schema, 'properties'))) return build(refs, { ...schema, type: 'object' }, at, state, depth, seen)
  return undefined
}

function stringExample(schema: Record<string, unknown>): string {
  const format = own(schema, 'format')
  if (typeof format === 'string' && Object.prototype.hasOwnProperty.call(FORMATS, format)) return FORMATS[format] as string
  const min = typeof own(schema, 'minLength') === 'number' ? (own(schema, 'minLength') as number) : 0
  const max = typeof own(schema, 'maxLength') === 'number' ? (own(schema, 'maxLength') as number) : Infinity
  let text = 'string'
  if (text.length < min) text = text.padEnd(Math.min(min, 256), 'x')
  if (text.length > max) text = text.slice(0, Math.max(0, max))
  return text
}

function numberExample(schema: Record<string, unknown>, integer: boolean): number {
  const num = (key: string) => (typeof own(schema, key) === 'number' ? (own(schema, key) as number) : undefined)
  const step = integer ? 1 : 0.5
  let value: number | undefined
  const exMin = own(schema, 'exclusiveMinimum')
  const minimum = num('minimum')
  if (typeof exMin === 'number') value = exMin + step
  else if (minimum !== undefined) value = exMin === true ? minimum + step : minimum
  if (value === undefined) {
    const maximum = num('maximum')
    const exMax = own(schema, 'exclusiveMaximum')
    if (typeof exMax === 'number') value = Math.min(0, exMax - step)
    else if (maximum !== undefined) value = Math.min(0, exMax === true ? maximum - step : maximum)
  }
  value ??= 0
  const multipleOf = num('multipleOf')
  if (multipleOf && multipleOf > 0) value = Math.ceil(value / multipleOf) * multipleOf
  return integer ? Math.round(value) : value
}

function mergeExample(a: unknown, b: unknown): unknown {
  if (a === undefined) return b
  if (b === undefined) return a
  if (isObject(a) && isObject(b)) return { ...a, ...b }
  return b
}

/** Pretty JSON for display, with a size cap so a huge example does not stall the page. */
export function prettyJson(value: unknown, maxLength = 200_000): { text: string; cut: boolean } {
  let text: string
  try {
    text = JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v), 2) ?? String(value)
  } catch {
    text = String(value)
  }
  if (text.length > maxLength) return { text: text.slice(0, maxLength), cut: true }
  return { text, cut: false }
}
