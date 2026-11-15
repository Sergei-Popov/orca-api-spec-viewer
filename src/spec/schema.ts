// Reading schemas for display: types, formats, constraints and the child schemas a tree shows.
// Covers the Swagger 2.0 and OpenAPI 3.0 schema subsets and JSON Schema 2020-12 (OpenAPI 3.1+,
// AsyncAPI).

import { isObject, own } from './pointer'
import { jsonText } from './json-text'

export type Schema = Record<string, unknown>

/** `#/components/schemas/Pet` → `Pet`; `./pet.yaml#/Pet` → `pet.yaml#/Pet`; `#node` → `node`. */
export function refName(ref: string): string {
  const hash = ref.indexOf('#')
  const file = hash < 0 ? ref : ref.slice(0, hash)
  const fragment = hash < 0 ? '' : ref.slice(hash + 1)
  const last = fragment.split('/').filter(Boolean).at(-1)
  let name = last ? last.replace(/~1/g, '/').replace(/~0/g, '~') : fragment
  try {
    name = decodeURIComponent(name)
  } catch {
    // keep as written
  }
  if (!file) return name || ref
  const base = file.split(/[\\/]/).filter(Boolean).at(-1) ?? file
  // A pointer keeps its slash; a plain-name fragment (an anchor) is written as it is.
  return name ? `${base}#${fragment.startsWith('/') ? '/' : ''}${name}` : base
}

/**
 * The types a schema allows, `null` included when it is nullable. OpenAPI 3.0's `nullable` adds
 * `null` only to a `type` given in the same schema; without one the types are not constrained.
 */
export function schemaTypes(schema: Schema): string[] {
  const type = own(schema, 'type')
  let types: string[] = []
  if (typeof type === 'string') types = [type]
  else if (Array.isArray(type)) types = type.filter((t): t is string => typeof t === 'string')
  const given = types.length > 0
  if (!given) {
    if (isObject(own(schema, 'properties')) || own(schema, 'additionalProperties') !== undefined || isObject(own(schema, 'patternProperties'))) types = ['object']
    else if (own(schema, 'items') !== undefined || Array.isArray(own(schema, 'prefixItems'))) types = ['array']
  }
  if (given && own(schema, 'nullable') === true && !types.includes('null')) types = [...types, 'null']
  return types
}

export function hasComposition(schema: Schema): boolean {
  return Array.isArray(own(schema, 'oneOf')) || Array.isArray(own(schema, 'anyOf')) || Array.isArray(own(schema, 'allOf'))
}

export type ConstraintKind =
  | 'minimum'
  | 'maximum'
  | 'exclusiveMinimum'
  | 'exclusiveMaximum'
  | 'multipleOf'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'minItems'
  | 'maxItems'
  | 'uniqueItems'
  | 'minProperties'
  | 'maxProperties'
  | 'minContains'
  | 'maxContains'
  | 'contentEncoding'
  | 'contentMediaType'

export interface Constraint {
  kind: ConstraintKind
  value: string
}

/** Constraints as compact tokens; exclusive bounds of OpenAPI 3.0 (booleans) are folded in. */
export function constraints(schema: Schema): Constraint[] {
  const out: Constraint[] = []
  const num = (key: string) => {
    const v = own(schema, key)
    return typeof v === 'number' ? v : undefined
  }
  const minimum = num('minimum')
  const maximum = num('maximum')
  const exMin = own(schema, 'exclusiveMinimum')
  const exMax = own(schema, 'exclusiveMaximum')
  if (minimum !== undefined) out.push({ kind: exMin === true ? 'exclusiveMinimum' : 'minimum', value: String(minimum) })
  if (typeof exMin === 'number') out.push({ kind: 'exclusiveMinimum', value: String(exMin) })
  if (maximum !== undefined) out.push({ kind: exMax === true ? 'exclusiveMaximum' : 'maximum', value: String(maximum) })
  if (typeof exMax === 'number') out.push({ kind: 'exclusiveMaximum', value: String(exMax) })
  const simple: ConstraintKind[] = ['multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'minContains', 'maxContains']
  for (const key of simple) {
    const v = num(key)
    if (v !== undefined) out.push({ kind: key, value: String(v) })
  }
  const pattern = own(schema, 'pattern')
  if (typeof pattern === 'string') out.push({ kind: 'pattern', value: pattern })
  if (own(schema, 'uniqueItems') === true) out.push({ kind: 'uniqueItems', value: '' })
  for (const key of ['contentEncoding', 'contentMediaType'] as const) {
    const v = own(schema, key)
    if (typeof v === 'string') out.push({ kind: key, value: v })
  }
  return out
}

export interface SchemaChild {
  /** How the child relates to its parent; the tree labels rows with it. */
  role:
    | 'property'
    | 'additionalProperties'
    | 'patternProperty'
    | 'items'
    | 'prefixItem'
    | 'contains'
    | 'allOf'
    | 'oneOf'
    | 'anyOf'
    | 'not'
    | 'if'
    | 'then'
    | 'else'
    | 'dependentSchema'
    | 'propertyNames'
    | 'unevaluatedProperties'
    | 'unevaluatedItems'
    | 'additionalItems'
  /** Property name, pattern, index or variant number. */
  name: string
  value: unknown
  /** Path segments from the parent schema to the child. */
  segments: string[]
  required?: boolean
}

const COMPOSITION = ['allOf', 'oneOf', 'anyOf'] as const

export function schemaChildren(schema: Schema): SchemaChild[] {
  const out: SchemaChild[] = []
  const required = new Set(Array.isArray(own(schema, 'required')) ? (own(schema, 'required') as unknown[]).filter((r): r is string => typeof r === 'string') : [])
  const properties = own(schema, 'properties')
  if (isObject(properties)) {
    for (const name of Object.keys(properties)) {
      out.push({ role: 'property', name, value: properties[name], segments: ['properties', name], required: required.has(name) })
    }
  }
  const patterns = own(schema, 'patternProperties')
  if (isObject(patterns)) {
    for (const name of Object.keys(patterns)) out.push({ role: 'patternProperty', name, value: patterns[name], segments: ['patternProperties', name] })
  }
  const additional = own(schema, 'additionalProperties')
  if (isObject(additional) || additional === false || additional === true) {
    out.push({ role: 'additionalProperties', name: '', value: additional, segments: ['additionalProperties'] })
  }
  const prefixItems = own(schema, 'prefixItems')
  if (Array.isArray(prefixItems)) {
    prefixItems.forEach((item, index) => out.push({ role: 'prefixItem', name: String(index), value: item, segments: ['prefixItems', String(index)] }))
  }
  const items = own(schema, 'items')
  if (Array.isArray(items)) {
    // Draft 4–7 tuple form, which AsyncAPI schemas may still use.
    items.forEach((item, index) => out.push({ role: 'prefixItem', name: String(index), value: item, segments: ['items', String(index)] }))
  } else if (items !== undefined) {
    out.push({ role: 'items', name: '', value: items, segments: ['items'] })
  }
  const additionalItems = own(schema, 'additionalItems')
  if (additionalItems !== undefined && additionalItems !== true) out.push({ role: 'additionalItems', name: '', value: additionalItems, segments: ['additionalItems'] })
  for (const single of ['contains', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'not', 'if', 'then', 'else'] as const) {
    const v = own(schema, single)
    if (v === undefined) continue
    if ((single === 'unevaluatedProperties' || single === 'unevaluatedItems') && v === true) continue
    out.push({ role: single, name: '', value: v, segments: [single] })
  }
  const dependent = own(schema, 'dependentSchemas')
  if (isObject(dependent)) {
    for (const name of Object.keys(dependent)) out.push({ role: 'dependentSchema', name, value: dependent[name], segments: ['dependentSchemas', name] })
  }
  for (const key of COMPOSITION) {
    const list = own(schema, key)
    if (Array.isArray(list)) list.forEach((item, index) => out.push({ role: key, name: String(index + 1), value: item, segments: [key, String(index)] }))
  }
  return out
}

/** Enum values, also a single `const`. */
export function enumValues(schema: Schema): unknown[] | undefined {
  const values = own(schema, 'enum')
  if (Array.isArray(values)) return values
  return undefined
}

export function formatValue(value: unknown): string {
  if (value === undefined) return ''
  const { text, cut } = jsonText(value, { maxLength: 200 })
  return cut ? text.slice(0, 199) + '…' : text
}
