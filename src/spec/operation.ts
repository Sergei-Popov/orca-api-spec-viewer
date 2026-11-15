// One operation's parameters, request body, responses and callbacks in a single shape for
// Swagger 2.0 and OpenAPI 3.x. Swagger 2.0's `body` and `formData` parameters become a request
// body, and `schema` plus `produces` become response media types.

import type { Family } from './detect'
import { methodsFor, pathEntry, type OpenApiModel, type Operation } from './openapi'
import { isObject, own, str } from './pointer'
import type { Loc, Refs, Resolution } from './refs'

export interface Located {
  value: unknown
  loc: Loc
  /** The reference that led here, when the value came through one. */
  ref?: string
  /** Set when a reference does not resolve here (external or missing). */
  stop?: Exclude<Resolution, { kind: 'local' }>
  cycle?: boolean
}

export interface ExampleView {
  name: string
  summary?: string
  description?: string
  hasValue: boolean
  value?: unknown
  externalValue?: string
  serializedValue?: string
  loc: Loc
  ref?: string
  stop?: Located['stop']
}

export interface MediaView {
  type: string
  description?: string
  schema?: Located
  /** OpenAPI 3.2 sequential media types: the schema of each item. */
  itemSchema?: Located
  examples: ExampleView[]
  encoding?: Record<string, unknown>
  loc: Loc
}

export interface ParamView {
  name: string
  in: string
  required: boolean
  deprecated: boolean
  description?: string
  schema?: Located
  content: MediaView[]
  style?: string
  explode?: boolean
  allowReserved?: boolean
  allowEmptyValue?: boolean
  collectionFormat?: string
  example?: unknown
  hasExample: boolean
  examples: ExampleView[]
  loc: Loc
  ref?: string
  stop?: Located['stop']
  level: 'path' | 'operation'
  raw: Record<string, unknown>
}

export interface BodyView {
  description?: string
  required: boolean
  media: MediaView[]
  loc: Loc
  ref?: string
  stop?: Located['stop']
  /** Swagger 2.0 `formData` parameters. */
  formFields: ParamView[]
}

export interface HeaderView {
  name: string
  description?: string
  required: boolean
  deprecated: boolean
  schema?: Located
  content: MediaView[]
  example?: unknown
  hasExample: boolean
  loc: Loc
  ref?: string
  stop?: Located['stop']
}

export interface LinkView {
  name: string
  operationId?: string
  operationRef?: string
  parameters?: Record<string, unknown>
  requestBody?: unknown
  description?: string
  loc: Loc
  ref?: string
  stop?: Located['stop']
}

export interface ResponseView {
  status: string
  summary?: string
  description?: string
  headers: HeaderView[]
  media: MediaView[]
  links: LinkView[]
  loc: Loc
  ref?: string
  stop?: Located['stop']
}

export interface CallbackView {
  name: string
  expression: string
  operations: Operation[]
  loc: Loc
  stop?: Located['stop']
}

export interface OperationDetails {
  params: ParamView[]
  body?: BodyView
  responses: ResponseView[]
  callbacks: CallbackView[]
  consumes: string[]
  produces: string[]
}

function located(refs: Refs, value: unknown, loc: Loc): Located {
  const followed = refs.follow(value, loc)
  return {
    value: followed.value,
    loc: followed.loc,
    ref: followed.via[0],
    stop: followed.stop,
    cycle: followed.cycle
  }
}

function child(loc: Loc, ...segments: string[]): Loc {
  return { ...loc, path: [...loc.path, ...segments] }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function operationDetails(model: OpenApiModel, refs: Refs, op: Operation): OperationDetails {
  const family = model.family
  const consumes = family === 'swagger2' ? (own(op.op, 'consumes') !== undefined ? stringList(own(op.op, 'consumes')) : stringList(own(model.root, 'consumes'))) : []
  const produces = family === 'swagger2' ? (own(op.op, 'produces') !== undefined ? stringList(own(op.op, 'produces')) : stringList(own(model.root, 'produces'))) : []

  const params = mergedParams(refs, op, family)
  let body: BodyView | undefined
  if (family === 'swagger2') {
    body = swaggerBody(params, consumes)
  } else if (own(op.op, 'requestBody') !== undefined) {
    const at = child(op.loc, 'requestBody')
    const rb = located(refs, own(op.op, 'requestBody'), at)
    const value = isObject(rb.value) ? rb.value : {}
    body = {
      description: str(own(value, 'description')),
      required: own(value, 'required') === true,
      media: rb.stop ? [] : mediaList(refs, own(value, 'content'), child(rb.loc, 'content'), family),
      loc: rb.loc,
      ref: rb.ref,
      stop: rb.stop,
      formFields: []
    }
  }
  const visible = family === 'swagger2' ? params.filter((p) => p.in !== 'body' && p.in !== 'formData') : params
  return {
    params: visible,
    body,
    responses: responsesOf(refs, op, family, produces),
    callbacks: callbacksOf(refs, op, family),
    consumes,
    produces
  }
}

function mergedParams(refs: Refs, op: Operation, family: Family): ParamView[] {
  const byKey = new Map<string, ParamView>()
  const order: string[] = []
  const add = (list: unknown, base: Loc, level: ParamView['level']) => {
    if (!Array.isArray(list)) return
    list.forEach((raw, index) => {
      const view = paramView(refs, raw, child(base, 'parameters', String(index)), level, family)
      const key = `${view.in}\u0000${view.name}`
      if (!byKey.has(key)) order.push(key)
      byKey.set(key, view)
    })
  }
  add(own(op.pathItem, 'parameters'), op.pathItemLoc, 'path')
  add(own(op.op, 'parameters'), op.loc, 'operation')
  return order.map((key) => byKey.get(key)!)
}

export function paramView(refs: Refs, raw: unknown, at: Loc, level: ParamView['level'], family: Family): ParamView {
  const p = located(refs, raw, at)
  const value = isObject(p.value) ? p.value : {}
  const where = str(own(value, 'in')) ?? ''
  const view: ParamView = {
    name: str(own(value, 'name')) ?? (p.stop ? p.stop.ref : ''),
    in: where,
    required: own(value, 'required') === true,
    deprecated: own(value, 'deprecated') === true,
    description: str(own(value, 'description')),
    content: [],
    style: str(own(value, 'style')),
    explode: typeof own(value, 'explode') === 'boolean' ? (own(value, 'explode') as boolean) : undefined,
    allowReserved: own(value, 'allowReserved') === true || undefined,
    allowEmptyValue: own(value, 'allowEmptyValue') === true || undefined,
    collectionFormat: str(own(value, 'collectionFormat')),
    example: own(value, 'example'),
    hasExample: Object.prototype.hasOwnProperty.call(value, 'example'),
    examples: [],
    loc: p.loc,
    ref: p.ref,
    stop: p.stop,
    level,
    raw: value
  }
  if (family === 'swagger2') {
    if (where === 'body') view.schema = located(refs, own(value, 'schema'), child(p.loc, 'schema'))
    else view.schema = { value, loc: p.loc }
    const xExample = own(value, 'x-example')
    if (!view.hasExample && xExample !== undefined) {
      view.example = xExample
      view.hasExample = true
    }
  } else {
    if (own(value, 'schema') !== undefined) view.schema = located(refs, own(value, 'schema'), child(p.loc, 'schema'))
    view.content = mediaList(refs, own(value, 'content'), child(p.loc, 'content'), family)
    view.examples = examplesOf(refs, own(value, 'examples'), child(p.loc, 'examples'))
    if (!view.style) view.style = where === 'path' || where === 'header' ? 'simple' : where === 'query' || where === 'cookie' ? 'form' : undefined
    // explode is true by default for form, and for OpenAPI 3.2's cookie style.
    if (view.explode === undefined && view.style) view.explode = view.style === 'form' || view.style === 'cookie'
  }
  return view
}

function swaggerBody(params: ParamView[], consumes: string[]): BodyView | undefined {
  const bodyParam = params.find((p) => p.in === 'body')
  const form = params.filter((p) => p.in === 'formData')
  if (bodyParam) {
    const types = consumes.length > 0 ? consumes : ['application/json']
    return {
      description: bodyParam.description,
      required: bodyParam.required,
      media: types.map((type) => ({ type, schema: bodyParam.schema, examples: [], loc: bodyParam.loc })),
      loc: bodyParam.loc,
      ref: bodyParam.ref,
      stop: bodyParam.stop,
      formFields: []
    }
  }
  if (form.length > 0) {
    const hasFile = form.some((p) => own(p.raw, 'type') === 'file')
    const type = hasFile || consumes.includes('multipart/form-data') ? 'multipart/form-data' : consumes.find((c) => c.includes('form')) ?? 'application/x-www-form-urlencoded'
    return { required: form.some((p) => p.required), media: [{ type, examples: [], loc: form[0].loc }], loc: form[0].loc, formFields: form }
  }
  return undefined
}

export function mediaList(refs: Refs, content: unknown, at: Loc, family: Family): MediaView[] {
  if (!isObject(content)) return []
  return Object.keys(content).map((type) => {
    const mloc = child(at, type)
    const raw = family === 'openapi32' ? located(refs, content[type], mloc) : { value: content[type], loc: mloc }
    const m = isObject(raw.value) ? raw.value : {}
    const examples = examplesOf(refs, own(m, 'examples'), child(raw.loc, 'examples'))
    if (Object.prototype.hasOwnProperty.call(m, 'example')) {
      examples.unshift({ name: '', hasValue: true, value: own(m, 'example'), loc: child(raw.loc, 'example') })
    }
    return {
      type,
      description: str(own(m, 'description')),
      schema: own(m, 'schema') !== undefined ? located(refs, own(m, 'schema'), child(raw.loc, 'schema')) : undefined,
      itemSchema: own(m, 'itemSchema') !== undefined ? located(refs, own(m, 'itemSchema'), child(raw.loc, 'itemSchema')) : undefined,
      examples,
      encoding: isObject(own(m, 'encoding')) ? (own(m, 'encoding') as Record<string, unknown>) : undefined,
      loc: raw.loc
    }
  })
}

export function examplesOf(refs: Refs, examples: unknown, at: Loc): ExampleView[] {
  if (!isObject(examples)) return []
  return Object.keys(examples).map((name) => {
    const e = located(refs, examples[name], child(at, name))
    const value = isObject(e.value) ? e.value : {}
    const hasData = Object.prototype.hasOwnProperty.call(value, 'dataValue')
    const hasValue = hasData || Object.prototype.hasOwnProperty.call(value, 'value')
    return {
      name,
      summary: str(own(value, 'summary')),
      description: str(own(value, 'description')),
      hasValue,
      value: hasData ? own(value, 'dataValue') : own(value, 'value'),
      externalValue: str(own(value, 'externalValue')),
      serializedValue: str(own(value, 'serializedValue')),
      loc: e.loc,
      ref: e.ref,
      stop: e.stop
    }
  })
}

function responsesOf(refs: Refs, op: Operation, family: Family, produces: string[]): ResponseView[] {
  const responses = own(op.op, 'responses')
  if (!isObject(responses)) return []
  const codes = Object.keys(responses).filter((code) => !code.startsWith('x-'))
  codes.sort(compareStatus)
  return codes.map((status) => {
    const r = located(refs, responses[status], child(op.loc, 'responses', status))
    const value = isObject(r.value) ? r.value : {}
    const view: ResponseView = {
      status,
      summary: str(own(value, 'summary')),
      description: str(own(value, 'description')),
      headers: headersOf(refs, own(value, 'headers'), child(r.loc, 'headers'), family),
      media: [],
      links: linksOf(refs, own(value, 'links'), child(r.loc, 'links')),
      loc: r.loc,
      ref: r.ref,
      stop: r.stop
    }
    if (family === 'swagger2') {
      const examples = isObject(own(value, 'examples')) ? (own(value, 'examples') as Record<string, unknown>) : {}
      const types = produces.length > 0 ? [...produces] : own(value, 'schema') !== undefined ? ['application/json'] : []
      for (const type of Object.keys(examples)) if (!types.includes(type)) types.push(type)
      if (own(value, 'schema') !== undefined || Object.keys(examples).length > 0) {
        const schema = own(value, 'schema') !== undefined ? located(refs, own(value, 'schema'), child(r.loc, 'schema')) : undefined
        view.media = types.map((type) => ({
          type,
          schema,
          examples: Object.prototype.hasOwnProperty.call(examples, type)
            ? [{ name: '', hasValue: true, value: examples[type], loc: child(r.loc, 'examples', type) }]
            : [],
          loc: r.loc
        }))
      }
    } else {
      view.media = mediaList(refs, own(value, 'content'), child(r.loc, 'content'), family)
    }
    return view
  })
}

/** 1XX…5XX in order, wildcards after their exact codes, `default` last. */
export function compareStatus(a: string, b: string): number {
  const rank = (code: string) => {
    if (code === 'default') return 1000
    const upper = code.toUpperCase()
    if (/^[1-5]XX$/.test(upper)) return Number(upper[0]) * 100 + 99.5
    const n = Number(code)
    return Number.isFinite(n) ? n : 999
  }
  return rank(a) - rank(b) || a.localeCompare(b)
}

function headersOf(refs: Refs, headers: unknown, at: Loc, family: Family): HeaderView[] {
  if (!isObject(headers)) return []
  return Object.keys(headers).map((name) => {
    const h = located(refs, headers[name], child(at, name))
    const value = isObject(h.value) ? h.value : {}
    return {
      name,
      description: str(own(value, 'description')),
      required: own(value, 'required') === true,
      deprecated: own(value, 'deprecated') === true,
      schema: family === 'swagger2' ? { value, loc: h.loc } : own(value, 'schema') !== undefined ? located(refs, own(value, 'schema'), child(h.loc, 'schema')) : undefined,
      content: family === 'swagger2' ? [] : mediaList(refs, own(value, 'content'), child(h.loc, 'content'), family),
      example: own(value, 'example'),
      hasExample: Object.prototype.hasOwnProperty.call(value, 'example'),
      loc: h.loc,
      ref: h.ref,
      stop: h.stop
    }
  })
}

function linksOf(refs: Refs, links: unknown, at: Loc): LinkView[] {
  if (!isObject(links)) return []
  return Object.keys(links).map((name) => {
    const l = located(refs, links[name], child(at, name))
    const value = isObject(l.value) ? l.value : {}
    return {
      name,
      operationId: str(own(value, 'operationId')),
      operationRef: str(own(value, 'operationRef')),
      parameters: isObject(own(value, 'parameters')) ? (own(value, 'parameters') as Record<string, unknown>) : undefined,
      requestBody: own(value, 'requestBody'),
      description: str(own(value, 'description')),
      loc: l.loc,
      ref: l.ref,
      stop: l.stop
    }
  })
}

export function callbacksOf(refs: Refs, op: Operation, family: Family): CallbackView[] {
  const callbacks = own(op.op, 'callbacks')
  if (family === 'swagger2' || !isObject(callbacks)) return []
  const out: CallbackView[] = []
  for (const name of Object.keys(callbacks)) {
    const c = located(refs, callbacks[name], child(op.loc, 'callbacks', name))
    const value = isObject(c.value) ? c.value : {}
    if (c.stop) {
      out.push({ name, expression: '', operations: [], loc: c.loc, stop: c.stop })
      continue
    }
    for (const expression of Object.keys(value)) {
      if (expression.startsWith('x-')) continue
      const entry = pathEntry(refs, value[expression], child(c.loc, expression), expression, 'callback', methodsFor(family), family)
      out.push({ name, expression, operations: entry.operations, loc: child(c.loc, expression) })
    }
  }
  return out
}
