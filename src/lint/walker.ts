// A small table-driven structural validator. Each object kind of a specification version is an
// `ObjectDef`: its fields and their types, which are required, and an optional `check` for rules a
// table cannot say. The walker reports missing and unknown fields and wrong types, collects every
// reference it passes, and hands each schema to the schema rules.

import type { Family } from '../spec/detect'
import { isObject } from '../spec/pointer'
import type { ProblemList } from './problem'

export type FieldType =
  | 'string'
  | 'boolean'
  | 'number'
  | 'integer'
  | 'any'
  | 'schema'
  | { obj: string; ref?: boolean | number }
  | { map: FieldType; keys?: 'component' }
  | { list: FieldType; min?: number }
  | { oneOf: readonly string[] }

/** A field type, and from which version level it exists (see `levelOf`). */
export type FieldDef = FieldType | [FieldType, number]

export interface ObjectDef {
  fields: Record<string, FieldDef>
  required?: string[]
  /** Children under keys that are not fixed fields (paths, status codes, callback expressions). */
  patterned?: { type: FieldType; key?: (key: string) => boolean; badKeyRule?: 'path' | 'status' }
  /** Whether `x-` extension fields are allowed (default true). */
  extensions?: boolean
  check?: (value: Record<string, unknown>, path: string[], ctx: WalkContext) => void
}

export interface RefOccurrence {
  ref: string
  path: string[]
  dynamic?: boolean
  /** Discriminator mappings may name a schema instead of referencing it. */
  mappingName?: boolean
}

export interface WalkContext {
  family: Family
  level: number
  problems: ProblemList
  defs: Record<string, ObjectDef>
  refs: RefOccurrence[]
  /** Schemas to check with the schema rules, with where they are. */
  /** `paramLike`: a Swagger 2.0 parameter or header, whose `required` is a boolean. */
  schemas: { value: unknown; path: string[]; paramLike?: boolean; level?: number }[]
  /** While a schema is checked: the level of its rules when it is not the document's (see formatLevel). */
  schemaLevel?: number
  /**
   * `required` names missing from `properties`, reported after the walk unless the schema is an
   * `allOf` part (a mixin that requires what the other parts define).
   */
  required?: { schema: object; path: string[]; name: string }[]
  /** The `allOf` parts seen: the schemas themselves, and the references to others. */
  allOfParts?: { schemas: Set<object>; refs: { ref: string; at: string[] }[] }
  /**
   * Parts no table describes, where a `$ref` still counts as a use of what it names: `x-…`
   * extensions (such as Redoc's `x-webhooks`) and AsyncAPI bindings.
   */
  loose: { value: unknown; path: string[] }[]
  root: Record<string, unknown>
  /** Objects and arrays on the current path: a value that contains itself is walked once. */
  active?: Set<object>
}

/** Numeric version levels so a field can say "since 3.1": Swagger 2.0 is 20, OpenAPI 3.0 is 30… */
export function levelOf(family: Family): number {
  switch (family) {
    case 'swagger2':
      return 20
    case 'openapi30':
      return 30
    case 'openapi31':
      return 31
    case 'openapi32':
      return 32
    case 'asyncapi2':
      return 200
    case 'asyncapi3':
      return 300
    case 'arazzo1':
    case 'overlay1':
      return 10
  }
}

const COMPONENT_KEY = /^[a-zA-Z0-9.\-_]+$/

function typeName(type: FieldType): string {
  if (typeof type === 'string') return type === 'schema' ? 'object' : type
  if ('obj' in type) return 'object'
  if ('map' in type) return 'object'
  if ('list' in type) return 'array'
  return 'string'
}

function actualType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

const BINDINGS = /^(?:bindings|serverBindings|channelBindings|operationBindings|messageBindings)$/

export function visit(value: unknown, type: FieldType, path: string[], ctx: WalkContext): void {
  if (type === 'any') {
    if (value !== null && typeof value === 'object' && (BINDINGS.test(path.at(-1) ?? '') || BINDINGS.test(path.at(-2) ?? ''))) ctx.loose.push({ value, path })
    return
  }
  if (value !== null && typeof value === 'object' && type !== 'schema') {
    const active = (ctx.active ??= new Set())
    if (active.has(value)) return
    active.add(value)
    try {
      visitValue(value, type, path, ctx)
    } finally {
      active.delete(value)
    }
    return
  }
  visitValue(value, type, path, ctx)
}

function visitValue(value: unknown, type: FieldType, path: string[], ctx: WalkContext): void {
  if (type === 'schema') {
    ctx.schemas.push({ value, path })
    return
  }
  if (typeof type === 'string') {
    const ok =
      type === 'string'
        ? typeof value === 'string'
        : type === 'boolean'
          ? typeof value === 'boolean'
          : type === 'integer'
            ? Number.isInteger(value)
            : typeof value === 'number'
    if (!ok) ctx.problems.error('wrong-type', path, { expected: type, actual: actualType(value) })
    return
  }
  if ('oneOf' in type) {
    if (typeof value !== 'string') ctx.problems.error('wrong-type', path, { expected: 'string', actual: actualType(value) })
    else if (!type.oneOf.includes(value)) ctx.problems.error('bad-value', path, { value, allowed: type.oneOf.join(', ') })
    return
  }
  if ('list' in type) {
    if (!Array.isArray(value)) {
      ctx.problems.error('wrong-type', path, { expected: 'array', actual: actualType(value) })
      return
    }
    if (type.min && value.length < type.min) ctx.problems.error('empty-list', path, { min: type.min })
    value.forEach((item, index) => visit(item, type.list, [...path, String(index)], ctx))
    return
  }
  if (!isObject(value)) {
    ctx.problems.error('wrong-type', path, { expected: typeName(type), actual: actualType(value) })
    return
  }
  if ('map' in type) {
    for (const key of Object.keys(value)) {
      if (type.keys === 'component' && !COMPONENT_KEY.test(key)) ctx.problems.warn('bad-key', [...path, key], { key, kind: 'component' })
      visit(value[key], type.map, [...path, key], ctx)
    }
    return
  }
  // `ref` is true, or the level from which a Reference Object may stand here.
  if (type.ref && (type.ref === true || ctx.level >= type.ref) && typeof value.$ref === 'string') {
    ctx.refs.push({ ref: value.$ref, path: [...path, '$ref'] })
    const siblings = Object.keys(value).filter((k) => k !== '$ref' && !k.startsWith('x-'))
    // OpenAPI 3.1+ lets a Reference Object override `summary` and `description`.
    const allowed = ctx.level >= 31 && ctx.level < 100 ? ['summary', 'description'] : []
    const ignored = siblings.filter((k) => !allowed.includes(k))
    if (ignored.length > 0 && ctx.level < 100) ctx.problems.info('ref-siblings', path, { fields: ignored.join(', ') })
    return
  }
  visitFields(value, type.obj, path, ctx)
}

export function visitObject(value: Record<string, unknown>, name: string, path: string[], ctx: WalkContext): void {
  const active = (ctx.active ??= new Set())
  if (active.has(value)) return
  active.add(value)
  try {
    visitFields(value, name, path, ctx)
  } finally {
    active.delete(value)
  }
}

function visitFields(value: Record<string, unknown>, name: string, path: string[], ctx: WalkContext): void {
  const def = ctx.defs[name]
  if (!def) return
  for (const field of def.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) ctx.problems.error('required-field', path, { field, object: name })
  }
  for (const key of Object.keys(value)) {
    const fieldDef = Object.prototype.hasOwnProperty.call(def.fields, key) ? def.fields[key] : undefined
    if (fieldDef !== undefined) {
      const [type, since] = Array.isArray(fieldDef) ? fieldDef : [fieldDef, 0]
      if (since > ctx.level) {
        ctx.problems.warn('not-in-version', [...path, key], { field: key, since: versionName(since) })
        continue
      }
      visit(value[key], type, [...path, key], ctx)
      continue
    }
    if (key.startsWith('x-') && def.extensions !== false) {
      if (value[key] !== null && typeof value[key] === 'object') ctx.loose.push({ value: value[key], path: [...path, key] })
      continue
    }
    if (def.patterned && (!def.patterned.key || def.patterned.key(key))) {
      visit(value[key], def.patterned.type, [...path, key], ctx)
      continue
    }
    if (def.patterned?.badKeyRule) {
      ctx.problems.error('bad-key', [...path, key], { key, kind: def.patterned.badKeyRule })
      continue
    }
    ctx.problems.warn('unknown-field', [...path, key], { field: key, object: name })
  }
  def.check?.(value, path, ctx)
}

export function versionName(level: number): string {
  if (level === 20) return 'Swagger 2.0'
  if (level < 100) return `OpenAPI ${Math.floor(level / 10)}.${level % 10}`
  return `AsyncAPI ${Math.floor(level / 100)}`
}
