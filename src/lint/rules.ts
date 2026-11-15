// Rules across the document that a table cannot express: references, unique ids, path
// parameters, unused components, security, tags, links, channels and workflows.

import type { ArazzoModel } from '../spec/arazzo'
import type { AsyncApiModel } from '../spec/asyncapi'
import { componentsPath, pathTemplateNames, requirementScheme, serverList, tagParentCycles, type OpenApiModel, type Operation } from '../spec/openapi'
import { getAt, isObject, own, str, toPointer } from '../spec/pointer'
import { locKey, MAX_HOPS, refOf, type Refs } from '../spec/refs'
import type { WalkContext } from './walker'

type Path = string[]

/** Where each local target is referred to from: target pointer → the referring paths. */
export type Usages = Map<string, Path[]>

/** References: unresolved ones are errors; another file's are one note per file. */
export function checkRefs(ctx: WalkContext, refs: Refs): Usages {
  const used: Usages = new Map()
  const use = (pointer: string, from: Path) => {
    const list = used.get(pointer)
    if (list) list.push(from)
    else used.set(pointer, [from])
  }
  const external = new Map<string, { count: number; path: Path }>()
  const cache = new Map<string, 'ok' | 'cycle' | 'long'>()
  const schemaBase = ctx.family === 'swagger2' ? ['definitions'] : ['components', 'schemas']
  const check = (occurrence: { ref: string; path: Path; dynamic?: boolean; mappingName?: boolean }) => {
    if (occurrence.mappingName) {
      // A discriminator mapping that names a schema rather than referencing it.
      const target = getAt(ctx.root, [...schemaBase, occurrence.ref])
      if (target === undefined) ctx.problems.error('unresolved-ref', occurrence.path, { ref: occurrence.ref })
      else use(toPointer([...schemaBase, occurrence.ref]), occurrence.path)
      return
    }
    // The object that holds the reference: inside a `$id` resource, it resolves against that.
    const resolution = refs.resolve(occurrence.ref, '', occurrence.dynamic, occurrence.path.slice(0, -1))
    if (resolution.kind === 'external') {
      const entry = external.get(resolution.file)
      if (entry) entry.count++
      else external.set(resolution.file, { count: 1, path: occurrence.path })
      return
    }
    if (resolution.kind === 'missing') {
      ctx.problems.error('unresolved-ref', occurrence.path, { ref: occurrence.ref })
      return
    }
    if (resolution.loc.doc === '') use(toPointer(resolution.loc.path), occurrence.path)
    const key = locKey(resolution.loc)
    let state = cache.get(key)
    if (!state) {
      const followed = refs.follow(resolution.value, resolution.loc)
      state = followed.cycle ? 'cycle' : followed.stop?.kind === 'missing' && followed.stop.reason === 'too-long' ? 'long' : 'ok'
      cache.set(key, state)
    }
    if (state === 'cycle') ctx.problems.error('circular-ref', occurrence.path, { ref: occurrence.ref })
    else if (state === 'long') ctx.problems.warn('long-ref-chain', occurrence.path, { ref: occurrence.ref, max: MAX_HOPS })
  }
  for (const occurrence of ctx.refs) check(occurrence)
  // A binding's references are checked like any other; an extension's only count as uses.
  for (const { from, ref, checked } of looseRefs(ctx.loose)) {
    if (checked) {
      check({ ref, path: from })
      continue
    }
    const resolution = refs.resolve(ref, '', false, from.slice(0, -1))
    if (resolution.kind === 'local' && resolution.loc.doc === '') use(toPointer(resolution.loc.path), from)
  }
  for (const [file, { count, path }] of external) ctx.problems.info('external-ref', path, { file, count })
  return used
}

/**
 * Security requirements name their schemes instead of referring to them (OpenAPI, AsyncAPI 2.x):
 * each name is a use of its scheme, for "Used by". AsyncAPI 3.x lists `$ref`s, counted above.
 */
export function addSecurityUses(used: Usages, refs: Refs, model: { kind: 'openapi'; model: OpenApiModel } | { kind: 'asyncapi'; model: AsyncApiModel }): void {
  const use = (pointer: string, from: Path) => {
    const list = used.get(pointer)
    if (list) list.push(from)
    else used.set(pointer, [from])
  }
  const requirements = (list: unknown, base: Path, scheme: (name: string) => Path | null) => {
    if (!Array.isArray(list)) return
    list.forEach((req, index) => {
      if (!isObject(req) || refOf(req)) return
      for (const name of Object.keys(req)) {
        const path = scheme(name)
        if (path) use(toPointer(path), [...base, String(index), name])
      }
    })
  }
  if (model.kind === 'openapi') {
    const m = model.model
    const scheme = (name: string) => {
      const found = requirementScheme(m, refs, name)
      return found.kind === 'local' && found.loc.doc === '' ? found.loc.path.slice() : null
    }
    requirements(own(m.root, 'security'), ['security'], scheme)
    for (const op of [...m.operations, ...m.webhooks]) requirements(own(op.op, 'security'), [...op.loc.path, 'security'], scheme)
    return
  }
  const m = model.model
  if (m.family !== 'asyncapi2') return
  const schemes = getAt(m.root, ['components', 'securitySchemes'])
  const scheme = (name: string) => (isObject(schemes) && Object.prototype.hasOwnProperty.call(schemes, name) ? ['components', 'securitySchemes', name] : null)
  for (const server of m.servers) if (server.loc.doc === '') requirements(own(server.value, 'security'), [...server.loc.path, 'security'], scheme)
  for (const op of m.operations) if (op.loc.doc === '') requirements(own(op.op, 'security'), [...op.loc.path, 'security'], scheme)
}

/** Keys whose values are data, never references. */
const DATA_KEYS = new Set(['example', 'default', 'enum', 'const'])

/**
 * Data inside a loose part: the keys above, a schema's `examples` list, and an Example Object's
 * `value`. A media type's `examples` is a map of Example Objects, which may be references.
 */
function isData(key: string, value: unknown, objectKey: string, parentKey: string): boolean {
  // In a map of Example Objects every key is a name (`default` included).
  if (objectKey === 'examples') return false
  if (DATA_KEYS.has(key)) return true
  if (key === 'examples') return Array.isArray(value)
  return key === 'value' && parentKey === 'examples'
}

/**
 * The `$ref`s in parts no table describes. An extension's only count as uses: it is free-form, so
 * one that does not resolve is not reported. A binding's are `checked`.
 */
function looseRefs(parts: WalkContext['loose']): { ref: string; from: Path; checked: boolean }[] {
  // Each entry links to its parent, so a deep part costs no path copies: a path is built only
  // for a reference that is found.
  type Entry = { value: unknown; key: string; parentKey: string; parent: Entry | null; base?: Path; checked: boolean }
  const pathOf = (entry: Entry): Path => {
    const keys: string[] = []
    let at: Entry = entry
    while (at.parent !== null) {
      keys.push(at.key)
      at = at.parent
    }
    return [...at.base!, ...keys.reverse()]
  }
  const out: { ref: string; from: Path; checked: boolean }[] = []
  const seen = new Set<object>()
  const stack: Entry[] = parts.map((part) => ({ value: part.value, key: part.path.at(-1) ?? '', parentKey: part.path.at(-2) ?? '', parent: null, base: part.path, checked: part.checked === true }))
  let budget = 1_000_000
  while (stack.length > 0 && budget-- > 0) {
    const entry = stack.pop()!
    const value = entry.value
    if (value === null || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach((item, index) => stack.push({ value: item, key: String(index), parentKey: entry.key, parent: entry, checked: entry.checked }))
      continue
    }
    const object = value as Record<string, unknown>
    if (typeof object.$ref === 'string') out.push({ ref: object.$ref, from: [...pathOf(entry), '$ref'], checked: entry.checked })
    for (const key of Object.keys(object)) {
      if (!isData(key, object[key], entry.key, entry.parentKey)) stack.push({ value: object[key], key, parentKey: entry.key, parent: entry, checked: entry.checked })
    }
  }
  return out
}

/** Components no reference reaches. Skipped for libraries (documents without operations). */
export function checkUnused(ctx: WalkContext, used: Usages, sections: { base: Path; skip?: string[] }[]): void {
  const usedPrefixes = new Set<string>()
  for (const pointer of used.keys()) {
    const parts = pointer.split('/')
    for (let i = 2; i <= parts.length; i++) usedPrefixes.add(parts.slice(0, i).join('/'))
  }
  for (const { base } of sections) {
    const map = getAt(ctx.root, base)
    if (!isObject(map)) continue
    for (const name of Object.keys(map)) {
      const path = [...base, name]
      if (!usedPrefixes.has(toPointer(path))) ctx.problems.warn('unused-component', path, { name, section: base.at(-1) ?? '' })
    }
  }
}

function resolved(refs: Refs, value: unknown, path: Path): { value: Record<string, unknown>; path: Path } | null {
  const followed = refs.follow(value, { doc: '', path })
  if (followed.stop || followed.cycle || followed.loc.doc !== '' || !isObject(followed.value)) return null
  return { value: followed.value, path: followed.loc.path.slice() }
}

function paramList(refs: Refs, list: unknown, base: Path): { name: string; in: string; path: Path }[] {
  if (!Array.isArray(list)) return []
  const out: { name: string; in: string; path: Path }[] = []
  list.forEach((raw, index) => {
    const p = resolved(refs, raw, [...base, 'parameters', String(index)])
    if (p && typeof p.value.name === 'string' && typeof p.value.in === 'string') out.push({ name: p.value.name, in: p.value.in, path: [...base, 'parameters', String(index)] })
  })
  return out
}

export function checkOpenApi(ctx: WalkContext, refs: Refs, model: OpenApiModel): void {
  const all: Operation[] = [...model.operations, ...model.webhooks]

  // Unique operationIds.
  const byId = new Map<string, Operation>()
  for (const op of all) {
    if (!op.operationId) continue
    const first = byId.get(op.operationId)
    if (first) ctx.problems.error('duplicate-operation-id', [...op.declared.path, 'operationId'], { id: op.operationId, other: `${first.method.toUpperCase()} ${first.route}` })
    else byId.set(op.operationId, op)
  }

  // Path templates against path parameters.
  const reportedPathLevel = new Set<string>()
  const shapes = new Map<string, string>()
  for (const entry of model.paths) {
    const route = entry.route
    if (route.includes('?')) ctx.problems.error('bad-key', ['paths', route], { key: route, kind: 'path-query' })
    const names = pathTemplateNames(route)
    const dupes = names.filter((n, i) => names.indexOf(n) !== i)
    for (const name of new Set(dupes)) ctx.problems.error('duplicate-param', ['paths', route], { name, in: 'path' })
    const shape = route.replace(/\{[^{}]+\}/g, '{}')
    const other = shapes.get(shape)
    if (other !== undefined && other !== route) {
      // The specification forbids such paths; a request is only ambiguous when a method is on both.
      const methods = new Set(model.paths.find((p) => p.route === other)?.operations.map((o) => o.method))
      const shared = entry.operations.some((o) => methods.has(o.method))
      ctx.problems.add('equivalent-paths', shared ? 'error' : 'warning', ['paths', route], { other })
    } else shapes.set(shape, route)

    for (const op of entry.operations) {
      const pathLevel = paramList(refs, own(op.pathItem, 'parameters'), op.pathItemLoc.path.slice())
      const opLevel = paramList(refs, own(op.op, 'parameters'), op.loc.path.slice())
      for (const list of [pathLevel, opLevel]) {
        const seen = new Set<string>()
        for (const p of list) {
          const key = `${p.in}:${p.name}`
          if (seen.has(key)) ctx.problems.error('duplicate-param', p.path, { name: p.name, in: p.in })
          seen.add(key)
        }
      }
      // OpenAPI 3.2: one querystring parameter at most, and never with query parameters.
      const merged = new Map<string, (typeof opLevel)[number]>()
      for (const p of [...pathLevel, ...opLevel]) merged.set(`${p.in}:${p.name}`, p)
      const strings = [...merged.values()].filter((p) => p.in === 'querystring')
      for (const p of strings.slice(1)) ctx.problems.error('querystring-conflict', p.path, { name: p.name, other: strings[0].name, kind: 'twice' })
      if (strings.length > 0 && [...merged.values()].some((p) => p.in === 'query')) ctx.problems.error('querystring-conflict', strings[0].path, { name: strings[0].name, kind: 'query' })
      const declared = new Map<string, Path>()
      for (const p of [...pathLevel, ...opLevel]) if (p.in === 'path') declared.set(p.name, p.path)
      for (const name of new Set(names)) {
        if (!declared.has(name)) ctx.problems.error('path-param-undeclared', op.declared.path, { name, path: route })
      }
      for (const [name, at] of declared) {
        if (names.includes(name)) continue
        const key = toPointer(at)
        if (reportedPathLevel.has(key)) continue
        reportedPathLevel.add(key)
        ctx.problems.error('path-param-unused', at, { name, path: route })
      }
      if (model.family === 'swagger2') {
        const bodies = opLevel.filter((p) => p.in === 'body')
        const merged = new Map<string, string>()
        for (const p of [...pathLevel, ...opLevel]) merged.set(`${p.in}:${p.name}`, p.in)
        const kinds = [...merged.values()]
        const bodyCount = kinds.filter((k) => k === 'body').length
        if (bodyCount > 1) ctx.problems.error('multiple-body', op.declared.path, { what: 'body' })
        else if (bodyCount === 1 && kinds.includes('formData')) ctx.problems.error('multiple-body', (bodies[0]?.path ?? op.declared.path), { what: 'formData' })
      }
    }
  }

  // Security requirements name defined schemes (in 3.2, by name or by URI).
  const checkRequirements = (list: unknown, base: Path) => {
    if (!Array.isArray(list)) return
    list.forEach((req, index) => {
      if (!isObject(req)) return
      for (const name of Object.keys(req)) {
        const scheme = requirementScheme(model, refs, name)
        if (scheme.kind === 'missing') ctx.problems.error('unknown-security-scheme', [...base, String(index), name], { name })
        else if (scheme.kind === 'external') ctx.problems.info('external-ref', [...base, String(index), name], { file: scheme.file, count: 1 })
      }
    })
  }
  checkRequirements(own(model.root, 'security'), ['security'])
  for (const op of all) checkRequirements(own(op.op, 'security'), [...op.loc.path, 'security'])

  // Server URL variables.
  if (model.family !== 'swagger2') {
    const servers = [...serverList(own(model.root, 'servers'), ['servers'])]
    for (const op of all) {
      servers.push(...serverList(own(op.op, 'servers'), [...op.loc.path, 'servers']))
    }
    for (const entry of model.paths) {
      const op = entry.operations[0]
      if (op) servers.push(...serverList(own(op.pathItem, 'servers'), [...op.pathItemLoc.path, 'servers']))
    }
    const done = new Set<string>()
    for (const server of servers) {
      const key = toPointer(server.loc.path)
      if (done.has(key)) continue
      done.add(key)
      for (const name of pathTemplateNames(server.url)) {
        if (!Object.prototype.hasOwnProperty.call(server.variables, name)) ctx.problems.error('server-variable-undefined', [...server.loc.path, 'url'], { name })
      }
    }
  }

  // Tags.
  const tags = own(model.root, 'tags')
  const declared = new Set<string>()
  if (Array.isArray(tags)) {
    tags.forEach((tag, index) => {
      if (!isObject(tag) || typeof tag.name !== 'string') return
      if (declared.has(tag.name)) ctx.problems.warn('duplicate-tag', ['tags', String(index)], { name: tag.name })
      declared.add(tag.name)
    })
    const parentOf = new Map<string, string>()
    const indexOf = new Map<string, number>()
    tags.forEach((tag, index) => {
      const parent = isObject(tag) ? str(own(tag, 'parent')) : undefined
      if (parent !== undefined && !declared.has(parent)) ctx.problems.error('unknown-parent-tag', ['tags', String(index), 'parent'], { name: parent })
      if (!isObject(tag) || typeof tag.name !== 'string' || indexOf.has(tag.name)) return
      indexOf.set(tag.name, index)
      if (parent !== undefined && declared.has(parent)) parentOf.set(tag.name, parent)
    })
    // One warning per cycle, at the parent of its first tag in the document.
    for (const cycle of tagParentCycles(parentOf)) {
      const first = cycle.reduce((a, b) => (indexOf.get(a)! <= indexOf.get(b)! ? a : b))
      const from = cycle.indexOf(first)
      const ordered = [...cycle.slice(from), ...cycle.slice(0, from), first]
      const shown = ordered.length > 6 ? [...ordered.slice(0, 5), '…', first] : ordered
      ctx.problems.warn('tag-parent-cycle', ['tags', String(indexOf.get(first)), 'parent'], { tags: shown.join(' → '), count: cycle.length })
    }
  }
  if (declared.size > 0) {
    const reported = new Set<string>()
    for (const op of all) {
      op.tags.forEach((name, index) => {
        if (declared.has(name) || reported.has(name)) return
        reported.add(name)
        ctx.problems.info('undeclared-tag', [...op.loc.path, 'tags', String(index)], { name })
      })
    }
  }

  // Links name operations that exist.
  if (model.family !== 'swagger2') {
    const checkLink = (raw: unknown, path: Path) => {
      const link = resolved(refs, raw, path)
      const id = link ? str(own(link.value, 'operationId')) : undefined
      if (id && !byId.has(id)) ctx.problems.error('link-operation', [...(link?.path ?? path), 'operationId'], { id })
    }
    const links = getAt(model.root, ['components', 'links'])
    if (isObject(links)) for (const name of Object.keys(links)) if (!refOf(links[name])) checkLink(links[name], ['components', 'links', name])
    for (const op of all) {
      const responses = own(op.op, 'responses')
      if (!isObject(responses)) continue
      for (const status of Object.keys(responses)) {
        const response = refOf(responses[status]) ? null : responses[status]
        const responseLinks = isObject(response) ? own(response, 'links') : undefined
        if (!isObject(responseLinks)) continue
        for (const name of Object.keys(responseLinks)) checkLink(responseLinks[name], [...op.loc.path, 'responses', status, 'links', name])
      }
    }
  }
}

export function openApiComponentSections(model: OpenApiModel): { base: Path }[] {
  const sections = model.family === 'swagger2' ? ['schemas', 'parameters', 'responses'] : ['schemas', 'responses', 'parameters', 'examples', 'requestBodies', 'headers', 'links', 'callbacks', 'pathItems', 'mediaTypes']
  return sections.map((section) => ({ base: componentsPath(model.family, section) }))
}

export function checkAsyncApi(ctx: WalkContext, refs: Refs, model: AsyncApiModel): void {
  if (model.family === 'asyncapi2') {
    const byId = new Map<string, string>()
    for (const op of model.operations) {
      const id = str(own(op.op, 'operationId'))
      if (!id) continue
      if (byId.has(id)) ctx.problems.error('duplicate-operation-id', [...op.loc.path, 'operationId'], { id, other: byId.get(id)! })
      else byId.set(id, `${op.channel?.id ?? ''} ${op.action}`)
    }
  }
  const serverNames = new Set(model.servers.map((s) => s.name))
  for (const channel of model.channels) {
    const address = channel.address ?? ''
    const names = pathTemplateNames(address)
    const params = own(channel.value, 'parameters')
    const declared = isObject(params) ? Object.keys(params) : []
    for (const name of names) if (!declared.includes(name)) ctx.problems.error('channel-param-undeclared', channel.loc.path.slice(), { name, address })
    for (const name of declared) if (!names.includes(name)) ctx.problems.warn('path-param-unused', [...channel.loc.path, 'parameters', name], { name, path: address })
    if (model.family === 'asyncapi2') {
      const servers = own(channel.value, 'servers')
      if (Array.isArray(servers)) {
        servers.forEach((name, index) => {
          if (typeof name === 'string' && !serverNames.has(name)) ctx.problems.error('unknown-target', [...channel.loc.path, 'servers', String(index)], { target: name })
        })
      }
    }
  }
  if (model.family === 'asyncapi3') {
    for (const op of model.operations) {
      if (!op.channel) continue
      const allowed = new Set(op.channel.messages.map((m) => m.key))
      const listed = own(op.op, 'messages')
      if (!Array.isArray(listed)) continue
      op.messages.forEach((message, index) => {
        if (!message.stop && !allowed.has(message.key)) ctx.problems.warn('unknown-target', [...op.loc.path, 'messages', String(index)], { target: message.ref ?? message.name })
      })
    }
  }
}

export function asyncComponentSections(model: AsyncApiModel): { base: Path }[] {
  const sections = ['schemas', 'messages', 'parameters', 'correlationIds', 'channels', 'operations', 'servers', 'serverVariables', 'replies', 'replyAddresses', 'messageTraits', 'operationTraits']
  void model
  return sections.map((section) => ({ base: ['components', section] }))
}

export function checkArazzo(ctx: WalkContext, model: ArazzoModel): void {
  const sources = new Set<string>()
  for (const source of model.sources) {
    if (sources.has(source.name)) ctx.problems.error('duplicate-id', [...source.loc.path, 'name'], { id: source.name })
    sources.add(source.name)
  }
  const workflowIds = new Set<string>()
  for (const workflow of model.workflows) {
    if (workflowIds.has(workflow.workflowId)) ctx.problems.error('duplicate-id', [...workflow.loc.path, 'workflowId'], { id: workflow.workflowId })
    workflowIds.add(workflow.workflowId)
  }
  const checkSourcePrefix = (value: string, path: Path) => {
    const match = /^\$sourceDescriptions\.([^.]+)\./.exec(value)
    if (match && !sources.has(match[1])) ctx.problems.error('unknown-target', path, { target: match[1] })
  }
  for (const workflow of model.workflows) {
    const stepIds = new Set<string>()
    for (const step of workflow.steps) {
      if (stepIds.has(step.stepId)) ctx.problems.error('duplicate-id', [...step.loc.path, 'stepId'], { id: step.stepId })
      stepIds.add(step.stepId)
    }
    const dependsOn = own(workflow.value, 'dependsOn')
    if (Array.isArray(dependsOn)) {
      dependsOn.forEach((id, index) => {
        if (typeof id !== 'string') return
        if (id.startsWith('$sourceDescriptions.')) checkSourcePrefix(id, [...workflow.loc.path, 'dependsOn', String(index)])
        else if (!workflowIds.has(id)) ctx.problems.error('unknown-target', [...workflow.loc.path, 'dependsOn', String(index)], { target: id })
      })
    }
    for (const step of workflow.steps) {
      if (step.target?.kind === 'workflowId') {
        if (step.target.value.startsWith('$sourceDescriptions.')) checkSourcePrefix(step.target.value, [...step.loc.path, 'workflowId'])
        else if (!workflowIds.has(step.target.value)) ctx.problems.error('unknown-target', [...step.loc.path, 'workflowId'], { target: step.target.value })
      } else if (step.target?.kind === 'operationId') {
        checkSourcePrefix(step.target.value, [...step.loc.path, 'operationId'])
      }
      for (const key of ['onSuccess', 'onFailure']) {
        const actions = own(step.value, key)
        if (!Array.isArray(actions)) continue
        actions.forEach((action, index) => {
          if (!isObject(action) || own(action, 'type') !== 'goto') return
          const stepId = str(own(action, 'stepId'))
          const workflowId = str(own(action, 'workflowId'))
          if (stepId && !stepIds.has(stepId)) ctx.problems.error('unknown-target', [...step.loc.path, key, String(index), 'stepId'], { target: stepId })
          if (workflowId && !workflowId.startsWith('$') && !workflowIds.has(workflowId)) ctx.problems.error('unknown-target', [...step.loc.path, key, String(index), 'workflowId'], { target: workflowId })
        })
      }
    }
  }
}
