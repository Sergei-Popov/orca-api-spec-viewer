// Rules for schemas, by the schema dialect of the version: Swagger 2.0 and OpenAPI 3.0 use an
// extended subset of JSON Schema draft 4–5; OpenAPI 3.1+ and AsyncAPI use full JSON Schema. Each
// schema is visited once (shared YAML aliases too), and references are collected, not followed.

import { isObject, own } from '../spec/pointer'
import { schemaTypes } from '../spec/schema'
import type { WalkContext } from './walker'
import { duplicateIndexes, jsonText, sameJson } from '../spec/json-text'

const TYPES_OLD = ['string', 'number', 'integer', 'boolean', 'array', 'object']
const TYPES_NEW = [...TYPES_OLD, 'null']

/** JSON Schema keywords that OpenAPI 3.0 and Swagger 2.0 schemas do not have. */
const MODERN_ONLY = [
  'const',
  'prefixItems',
  '$defs',
  'if',
  'then',
  'else',
  'dependentSchemas',
  'dependentRequired',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'minContains',
  'maxContains',
  'propertyNames',
  '$anchor',
  '$dynamicRef',
  '$dynamicAnchor',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'examples',
  '$id',
  '$schema',
  'patternProperties'
]
const NOT_IN_SWAGGER2 = ['oneOf', 'anyOf', 'not', 'nullable', 'deprecated', 'writeOnly']

/**
 * The version level whose schema rules apply: Arazzo and Overlay use JSON Schema 2020-12, the
 * dialect of OpenAPI 3.1, so their schemas are checked as 3.1 schemas (boolean schemas, type
 * arrays, `const`, `prefixItems`).
 */
function schemaLevel(ctx: WalkContext): number {
  return ctx.schemaLevel ?? (ctx.family === 'arazzo1' || ctx.family === 'overlay1' ? 31 : ctx.level)
}

/**
 * The rules for an AsyncAPI schema in the given `schemaFormat`: the document's for AsyncAPI and
 * JSON Schema, OpenAPI 3.0's for OpenAPI schemas, and none (null) for Avro, RAML, Protobuf and
 * anything else, which are not JSON Schema at all.
 */
export function formatLevel(format: string, documentLevel: number): number | null {
  const type = format.trim().toLowerCase()
  if (/^application\/vnd\.aai\.asyncapi(?:\+json|\+yaml)?(?:;|$)/.test(type)) return documentLevel
  if (/^application\/schema\+(?:json|yaml)(?:;|$)/.test(type)) return documentLevel
  if (/^application\/vnd\.oai\.openapi(?:\+json|\+yaml)?(?:;|$)/.test(type)) return 30
  return null
}

/** AsyncAPI 3's Multi Format Schema Object: `{ schemaFormat, schema }`. */
function multiFormat(value: Record<string, unknown>, ctx: WalkContext): boolean {
  return ctx.level === 300 && typeof value.schemaFormat === 'string' && Object.prototype.hasOwnProperty.call(value, 'schema')
}

export function checkSchemas(ctx: WalkContext): void {
  const seen = new WeakSet<object>()
  const stack = ctx.schemas.map((s) => ({ value: s.value, path: s.path, depth: 0, paramLike: s.paramLike === true, level: s.level }))
  stack.reverse()
  let steps = 0
  while (stack.length > 0 && steps++ < 1_000_000) {
    const { value, path, depth, paramLike, level } = stack.pop()!
    if (value === undefined) continue
    ctx.schemaLevel = level
    if (isObject(value) && multiFormat(value, ctx)) {
      const inner = formatLevel(value.schemaFormat as string, ctx.level)
      if (inner !== null) stack.push({ value: value.schema, path: [...path, 'schema'], depth: depth + 1, paramLike: false, level: inner })
      else if (isObject(value.schema) && typeof value.schema.$ref === 'string') ctx.refs.push({ ref: value.schema.$ref, path: [...path, 'schema', '$ref'] })
      continue
    }
    if (typeof value === 'boolean') {
      if (schemaLevel(ctx) < 31) ctx.problems.error('wrong-type', path, { expected: 'object', actual: 'boolean' })
      continue
    }
    if (!isObject(value)) {
      ctx.problems.error('wrong-type', path, { expected: 'object', actual: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value })
      continue
    }
    if (seen.has(value) || depth > 256) continue
    seen.add(value)
    const children = checkOne(value, path, ctx, paramLike)
    for (let i = children.length - 1; i >= 0; i--) stack.push({ value: children[i].value, path: children[i].path, depth: depth + 1, paramLike: false, level })
  }
  ctx.schemaLevel = undefined
}

interface Child {
  value: unknown
  path: string[]
}

/** Checks one schema object and returns its child schemas. */
function checkOne(schema: Record<string, unknown>, path: string[], ctx: WalkContext, paramLike: boolean): Child[] {
  const modern = schemaLevel(ctx) >= 31
  const old = schemaLevel(ctx) < 31
  const ref = own(schema, '$ref')
  if (typeof ref === 'string') {
    ctx.refs.push({ ref, path: [...path, '$ref'] })
    // In Swagger 2.0 and OpenAPI 3.0, a $ref replaces its object: siblings are ignored.
    if (old) {
      const siblings = Object.keys(schema).filter((k) => k !== '$ref' && !k.startsWith('x-') && k !== 'description')
      if (siblings.length > 0) ctx.problems.info('ref-siblings', path, { fields: siblings.join(', ') })
      return []
    }
  }
  const dynamicRef = own(schema, '$dynamicRef')
  if (typeof dynamicRef === 'string' && modern) ctx.refs.push({ ref: dynamicRef, path: [...path, '$dynamicRef'], dynamic: true })
  // A $ref inside an extension (GitHub's x-github, Stripe's x-expansionResources) is a use too.
  for (const key in schema) {
    if (key.startsWith('x-') && schema[key] !== null && typeof schema[key] === 'object') ctx.loose.push({ value: schema[key], path: [...path, key] })
  }

  if (old) {
    for (const keyword of MODERN_ONLY) {
      if (Object.prototype.hasOwnProperty.call(schema, keyword)) ctx.problems.warn('schema-keyword', [...path, keyword], { keyword, version: schemaLevel(ctx) === 20 ? 'Swagger 2.0' : 'OpenAPI 3.0' })
    }
  }
  if (schemaLevel(ctx) === 20) {
    for (const keyword of NOT_IN_SWAGGER2) {
      if (Object.prototype.hasOwnProperty.call(schema, keyword)) ctx.problems.warn('schema-keyword', [...path, keyword], { keyword, version: 'Swagger 2.0' })
    }
  }
  // `nullable` is OpenAPI 3.0's; Arazzo and Overlay never had it, so it is only an unknown keyword there.
  if (modern && ctx.level >= 31 && ctx.level < 100 && Object.prototype.hasOwnProperty.call(schema, 'nullable')) {
    ctx.problems.warn('schema-keyword', [...path, 'nullable'], { keyword: 'nullable', version: ctx.level === 31 ? 'OpenAPI 3.1' : 'OpenAPI 3.2' })
  }

  // type
  const type = own(schema, 'type')
  const validTypes = schemaLevel(ctx) === 20 ? [...TYPES_OLD, 'file'] : old ? TYPES_OLD : TYPES_NEW
  if (Array.isArray(type)) {
    if (old) ctx.problems.error('wrong-type', [...path, 'type'], { expected: 'string', actual: 'array' })
    for (const t of type) if (typeof t !== 'string' || !TYPES_NEW.includes(t)) ctx.problems.error('bad-value', [...path, 'type'], { value: String(t), allowed: TYPES_NEW.join(', ') })
  } else if (type !== undefined) {
    if (typeof type !== 'string') ctx.problems.error('wrong-type', [...path, 'type'], { expected: 'string', actual: typeof type })
    else if (!validTypes.includes(type)) ctx.problems.error('bad-value', [...path, 'type'], { value: type, allowed: validTypes.join(', ') })
  }

  // Exclusive bounds: booleans before 3.1, numbers from 3.1.
  for (const key of ['exclusiveMinimum', 'exclusiveMaximum']) {
    const v = own(schema, key)
    if (v === undefined) continue
    if (old && typeof v !== 'boolean') ctx.problems.error('wrong-type', [...path, key], { expected: 'boolean', actual: typeof v })
    if (modern && typeof v !== 'number') ctx.problems.error('wrong-type', [...path, key], { expected: 'number', actual: typeof v })
  }

  const required = paramLike ? undefined : own(schema, 'required')
  if (required !== undefined) {
    if (!Array.isArray(required) || required.some((r) => typeof r !== 'string')) {
      ctx.problems.error('wrong-type', [...path, 'required'], { expected: 'array of strings', actual: Array.isArray(required) ? 'array' : typeof required })
    } else {
      const props = own(schema, 'properties')
      const open = own(schema, 'additionalProperties') !== undefined && own(schema, 'additionalProperties') !== false
      const composed = ['allOf', 'oneOf', 'anyOf', '$ref', 'patternProperties', 'if', 'dependentSchemas'].some((k) => own(schema, k) !== undefined)
      if (isObject(props) && !open && !composed) {
        for (const name of required as string[]) {
          if (!Object.prototype.hasOwnProperty.call(props, name)) (ctx.required ??= []).push({ schema, path: [...path, 'required'], name })
        }
      }
    }
  }

  const allOf = own(schema, 'allOf')
  if (Array.isArray(allOf)) {
    const parts = (ctx.allOfParts ??= { schemas: new Set(), refs: [] })
    for (const part of allOf) {
      if (!isObject(part)) continue
      parts.schemas.add(part)
      if (typeof part.$ref === 'string') parts.refs.push({ ref: part.$ref, at: path })
    }
  }

  const types = schemaTypes(schema)
  if (types.includes('array') && old && own(schema, 'items') === undefined && typeof type === 'string') {
    ctx.problems.error('required-field', path, { field: 'items', object: 'Schema (array)' })
  }

  checkBounds(schema, path, ctx)

  const pattern = own(schema, 'pattern')
  if (typeof pattern === 'string' && !validRegExp(pattern)) ctx.problems.warn('invalid-pattern', [...path, 'pattern'], { pattern })

  checkValues(schema, path, ctx, types)

  const discriminator = own(schema, 'discriminator')
  if (discriminator !== undefined) checkDiscriminator(schema, discriminator, path, ctx)

  return childrenOf(schema, path, ctx)
}

function checkBounds(schema: Record<string, unknown>, path: string[], ctx: WalkContext): void {
  const pairs: [string, string][] = [
    ['minimum', 'maximum'],
    ['minLength', 'maxLength'],
    ['minItems', 'maxItems'],
    ['minProperties', 'maxProperties'],
    ['minContains', 'maxContains']
  ]
  for (const [min, max] of pairs) {
    const a = own(schema, min)
    const b = own(schema, max)
    if (typeof a === 'number' && typeof b === 'number' && a > b) ctx.problems.error('min-max', [...path, min], { min, max, a, b })
  }
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']) {
    const v = own(schema, key)
    if (v !== undefined && !(Number.isInteger(v) && (v as number) >= 0)) ctx.problems.error('wrong-type', [...path, key], { expected: 'non-negative integer', actual: String(v) })
  }
  const multipleOf = own(schema, 'multipleOf')
  if (multipleOf !== undefined && !(typeof multipleOf === 'number' && multipleOf > 0)) {
    ctx.problems.error('wrong-type', [...path, 'multipleOf'], { expected: 'number > 0', actual: String(multipleOf) })
  }
}

export function validRegExp(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u')
    return true
  } catch {
    try {
      // ECMA-262 without the u flag accepts more of what other engines write.
      new RegExp(pattern)
      return true
    } catch {
      return false
    }
  }
}

/** Whether a value fits the schema's types (ignores formats and nested rules). */
export function fitsTypes(value: unknown, types: string[]): boolean {
  if (types.length === 0) return true
  return types.some((type) => {
    switch (type) {
      case 'null':
        return value === null
      case 'string':
        return typeof value === 'string'
      case 'integer':
        return Number.isInteger(value)
      case 'number':
        return typeof value === 'number'
      case 'boolean':
        return typeof value === 'boolean'
      case 'array':
        return Array.isArray(value)
      case 'object':
        return isObject(value)
      case 'file':
        return true
      default:
        return true
    }
  })
}

function sameValue(a: unknown, b: unknown): boolean {
  return sameJson(a, b)
}

function show(value: unknown): string {
  if (value === undefined) return 'undefined'
  const { text, cut } = jsonText(value, { maxLength: 60 })
  return cut ? text.slice(0, 59) + '…' : text
}

/** enum, default and example against the schema's own types and enum. */
function checkValues(schema: Record<string, unknown>, path: string[], ctx: WalkContext, types: string[]): void {
  const enumValues = own(schema, 'enum')
  let allowed: unknown[] | undefined
  if (enumValues !== undefined) {
    if (!Array.isArray(enumValues)) {
      ctx.problems.error('wrong-type', [...path, 'enum'], { expected: 'array', actual: typeof enumValues })
    } else if (enumValues.length === 0) {
      ctx.problems.warn('empty-list', [...path, 'enum'], { min: 1 })
    } else {
      allowed = enumValues
      // Repeats are found in one pass, so an enum of tens of thousands of values stays fast.
      const repeats = new Set(duplicateIndexes(enumValues))
      enumValues.forEach((value, index) => {
        if (!fitsTypes(value, types)) ctx.problems.error('invalid-enum', [...path, 'enum', String(index)], { value: show(value), type: types.join(' | ') })
        else if (repeats.has(index)) ctx.problems.warn('invalid-enum', [...path, 'enum', String(index)], { value: show(value), type: 'unique' })
      })
    }
  }
  // A null value fits a nullable schema even without a `type` (nothing constrains it then).
  const nullable = types.includes('null') || own(schema, 'nullable') === true
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
    const value = own(schema, 'default')
    if (!fitsTypes(value, types) && !(value === null && nullable)) {
      ctx.problems.error('invalid-default', [...path, 'default'], { value: show(value), type: types.join(' | ') })
    } else if (allowed && !allowed.some((a) => sameValue(a, value)) && !(value === null && nullable)) {
      ctx.problems.error('enum-default', [...path, 'default'], { value: show(value) })
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'example')) {
    const value = own(schema, 'example')
    if (!fitsTypes(value, types) && !(value === null && nullable)) ctx.problems.warn('invalid-example', [...path, 'example'], { value: show(value), type: types.join(' | ') })
  }
  const examples = own(schema, 'examples')
  if (Array.isArray(examples) && schemaLevel(ctx) >= 31) {
    examples.forEach((value, index) => {
      if (!fitsTypes(value, types)) ctx.problems.warn('invalid-example', [...path, 'examples', String(index)], { value: show(value), type: types.join(' | ') })
    })
  }
}

function checkDiscriminator(schema: Record<string, unknown>, discriminator: unknown, path: string[], ctx: WalkContext): void {
  const at = [...path, 'discriminator']
  // Swagger 2.0 and AsyncAPI name the property with a string; OpenAPI 3 has a Discriminator Object.
  if (schemaLevel(ctx) === 20 || schemaLevel(ctx) >= 100) {
    if (typeof discriminator !== 'string') ctx.problems.error('wrong-type', at, { expected: 'string', actual: typeof discriminator })
    return
  }
  if (!isObject(discriminator)) {
    ctx.problems.error('wrong-type', at, { expected: 'object', actual: typeof discriminator })
    return
  }
  if (typeof discriminator.propertyName !== 'string') ctx.problems.error('required-field', at, { field: 'propertyName', object: 'Discriminator' })
  const hasComposition = ['oneOf', 'anyOf', 'allOf'].some((k) => Array.isArray(own(schema, k)))
  if (!hasComposition && !isObject(own(schema, 'properties'))) ctx.problems.warn('discriminator', at, {})
  const mapping = own(discriminator, 'mapping')
  if (isObject(mapping)) {
    for (const key of Object.keys(mapping)) {
      const target = mapping[key]
      if (typeof target !== 'string') {
        ctx.problems.error('wrong-type', [...at, 'mapping', key], { expected: 'string', actual: typeof target })
        continue
      }
      ctx.refs.push({ ref: target, path: [...at, 'mapping', key], mappingName: !/[#/]/.test(target) })
    }
  }
  const fallback = own(discriminator, 'defaultMapping')
  if (typeof fallback === 'string') ctx.refs.push({ ref: fallback, path: [...at, 'defaultMapping'], mappingName: !/[#/]/.test(fallback) })
}

function childrenOf(schema: Record<string, unknown>, path: string[], ctx: WalkContext): Child[] {
  const out: Child[] = []
  const add = (value: unknown, ...segments: string[]) => out.push({ value, path: [...path, ...segments] })
  const mapOf = (key: string) => {
    const v = own(schema, key)
    if (v === undefined) return
    if (!isObject(v)) {
      ctx.problems.error('wrong-type', [...path, key], { expected: 'object', actual: Array.isArray(v) ? 'array' : typeof v })
      return
    }
    for (const name of Object.keys(v)) add(v[name], key, name)
  }
  const listOf = (key: string) => {
    const v = own(schema, key)
    if (v === undefined) return
    if (!Array.isArray(v)) {
      ctx.problems.error('wrong-type', [...path, key], { expected: 'array', actual: typeof v })
      return
    }
    if (v.length === 0) ctx.problems.error('empty-list', [...path, key], { min: 1 })
    v.forEach((item, index) => add(item, key, String(index)))
  }
  mapOf('properties')
  mapOf('patternProperties')
  mapOf('dependentSchemas')
  mapOf('$defs')
  mapOf('definitions')
  for (const key of ['allOf', 'oneOf', 'anyOf']) listOf(key)
  const prefixItems = own(schema, 'prefixItems')
  if (Array.isArray(prefixItems)) prefixItems.forEach((item, index) => add(item, 'prefixItems', String(index)))
  const items = own(schema, 'items')
  if (Array.isArray(items)) {
    if (schemaLevel(ctx) < 100) ctx.problems.error('wrong-type', [...path, 'items'], { expected: 'object', actual: 'array' })
    items.forEach((item, index) => add(item, 'items', String(index)))
  } else if (items !== undefined) add(items, 'items')
  for (const key of ['additionalProperties', 'additionalItems', 'unevaluatedProperties', 'unevaluatedItems']) {
    const v = own(schema, key)
    if (isObject(v)) add(v, key)
    else if (v !== undefined && typeof v !== 'boolean') ctx.problems.error('wrong-type', [...path, key], { expected: 'boolean or object', actual: typeof v })
  }
  for (const key of ['not', 'if', 'then', 'else', 'contains', 'propertyNames', 'contentSchema']) {
    const v = own(schema, key)
    if (v !== undefined) add(v, key)
  }
  return out
}

/** Reports the `required` names no property defines, except in schemas used as `allOf` parts. */
export function reportRequired(ctx: WalkContext, resolve: (ref: string, at: string[]) => unknown): void {
  const parts = ctx.allOfParts?.schemas ?? new Set<object>()
  for (const { ref, at } of ctx.allOfParts?.refs ?? []) {
    const target = resolve(ref, at)
    if (isObject(target)) parts.add(target)
  }
  for (const { schema, path, name } of ctx.required ?? []) {
    if (!parts.has(schema)) ctx.problems.warn('required-not-defined', path, { name })
  }
}
