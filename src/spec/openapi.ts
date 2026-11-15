// The OpenAPI and Swagger 2.0 model the views read: operations (paths and webhooks), tags and
// their hierarchy, components, servers and security schemes. Raw objects stay as they are; the
// model only adds where each thing lives and how they group.

import type { Family } from './detect'
import { getAt, isObject, own, str, toPointer } from './pointer'
import { refOf, type Loc, type Refs } from './refs'

export const STANDARD_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'] as const

export function methodsFor(family: Family): readonly string[] {
  if (family === 'swagger2') return ['get', 'put', 'post', 'delete', 'options', 'head', 'patch']
  if (family === 'openapi32') return STANDARD_METHODS
  return STANDARD_METHODS.slice(0, 8)
}

export interface Operation {
  /** Unique route key of the operation's page. */
  key: string
  scope: 'path' | 'webhook' | 'callback'
  /** The URL path template, the webhook name or the callback expression. */
  route: string
  /** Lowercase for the standard methods; an `additionalOperations` method as written. */
  method: string
  /** Where the operation is declared (`paths./pets.get`). */
  declared: Loc
  /** Where its object lives, after following a path item `$ref`. */
  loc: Loc
  pathItemLoc: Loc
  op: Record<string, unknown>
  pathItem: Record<string, unknown>
  tags: string[]
  summary: string
  operationId?: string
  deprecated: boolean
}

export interface TagNode {
  key: string
  name: string
  /** `x-displayName`, a 3.2 `summary`, or the name. */
  title: string
  tag?: Record<string, unknown>
  loc?: Loc
  operations: Operation[]
  children: TagNode[]
}

export interface ComponentEntry {
  key: string
  section: string
  name: string
  loc: Loc
  value: unknown
}

export interface ServerInfo {
  url: string
  /** The URL with every `{variable}` replaced by its default. */
  resolved: string
  description?: string
  name?: string
  variables: Record<string, Record<string, unknown>>
  loc: Loc
}

export interface PathEntry {
  route: string
  loc: Loc
  /** Set when the path item is a `$ref` that does not resolve here. */
  external?: string
  operations: Operation[]
}

export interface OpenApiModel {
  family: Family
  root: Record<string, unknown>
  info: Record<string, unknown>
  servers: ServerInfo[]
  paths: PathEntry[]
  operations: Operation[]
  webhooks: Operation[]
  tags: TagNode[]
  /** Badge tags of OpenAPI 3.2 (`kind` other than `nav`), by name. */
  badgeTags: Set<string>
  /** Redoc's `x-tagGroups`: top-level groups of tag names. */
  tagGroups: { name: string; tags: string[] }[]
  components: Map<string, ComponentEntry[]>
}

const COMPONENT_SECTIONS_3 = [
  'schemas',
  'responses',
  'parameters',
  'requestBodies',
  'headers',
  'examples',
  'securitySchemes',
  'links',
  'callbacks',
  'pathItems',
  'mediaTypes'
]

const COMPONENT_SECTIONS_2: [string, string][] = [
  ['definitions', 'schemas'],
  ['parameters', 'parameters'],
  ['responses', 'responses'],
  ['securityDefinitions', 'securitySchemes']
]

export function componentsPath(family: Family, section: string): string[] {
  if (family !== 'swagger2') return ['components', section]
  const found = COMPONENT_SECTIONS_2.find(([, s]) => s === section)
  return [found ? found[0] : section]
}

export function buildOpenApi(root: Record<string, unknown>, family: Family, refs: Refs): OpenApiModel {
  const info = isObject(own(root, 'info')) ? (own(root, 'info') as Record<string, unknown>) : {}
  const model: OpenApiModel = {
    family,
    root,
    info,
    servers: serversOf(root, family),
    paths: [],
    operations: [],
    webhooks: [],
    tags: [],
    badgeTags: new Set(),
    tagGroups: [],
    components: new Map()
  }
  const methods = methodsFor(family)

  const paths = own(root, 'paths')
  if (isObject(paths)) {
    for (const route of Object.keys(paths)) {
      if (route.startsWith('x-')) continue
      const entry = pathEntry(refs, paths[route], { doc: '', path: ['paths', route] }, route, 'path', methods, family)
      model.paths.push(entry)
      model.operations.push(...entry.operations)
    }
  }
  const webhooks = own(root, 'webhooks')
  if (family !== 'swagger2' && family !== 'openapi30' && isObject(webhooks)) {
    for (const name of Object.keys(webhooks)) {
      if (name.startsWith('x-')) continue
      const entry = pathEntry(refs, webhooks[name], { doc: '', path: ['webhooks', name] }, name, 'webhook', methods, family)
      model.webhooks.push(...entry.operations)
    }
  }

  buildTags(model)

  if (family === 'swagger2') {
    for (const [field, section] of COMPONENT_SECTIONS_2) addComponents(model, own(root, field), section, [field])
  } else {
    const components = own(root, 'components')
    if (isObject(components)) {
      for (const section of COMPONENT_SECTIONS_3) addComponents(model, own(components, section), section, ['components', section])
    }
  }
  return model
}

function addComponents(model: OpenApiModel, map: unknown, section: string, base: string[]): void {
  if (!isObject(map)) return
  const entries: ComponentEntry[] = []
  for (const name of Object.keys(map)) {
    if (name.startsWith('x-') && section !== 'schemas') continue
    const loc = { doc: '', path: [...base, name] }
    entries.push({ key: 'c:' + toPointer(loc.path), section, name, loc, value: map[name] })
  }
  if (entries.length > 0) model.components.set(section, entries)
}

/** The operations of one path item (also a webhook or a callback expression). */
export function pathEntry(
  refs: Refs,
  raw: unknown,
  declared: Loc,
  route: string,
  scope: Operation['scope'],
  methods: readonly string[],
  family: Family
): PathEntry {
  const followed = refs.follow(raw, declared)
  const entry: PathEntry = { route, loc: declared, operations: [] }
  if (followed.stop) entry.external = refOf(followed.value)?.ref
  let pathItem = isObject(followed.value) ? followed.value : {}
  // A path item `$ref` may have sibling fields (summary, parameters); they apply on top.
  if (followed.via.length > 0 && isObject(raw)) {
    const siblings = { ...raw }
    delete siblings.$ref
    if (Object.keys(siblings).length > 0) pathItem = { ...pathItem, ...siblings }
  }
  const pathItemLoc = followed.stop ? declared : followed.loc
  const add = (method: string, op: unknown, at: string[]) => {
    if (!isObject(op)) return
    const loc = { doc: pathItemLoc.doc, path: [...pathItemLoc.path, ...at] }
    entry.operations.push(makeOperation(scope, route, method, { doc: declared.doc, path: [...declared.path, ...at] }, loc, op, pathItem, pathItemLoc))
  }
  for (const method of methods) add(method, own(pathItem, method), [method])
  if (family === 'openapi32') {
    const extra = own(pathItem, 'additionalOperations')
    if (isObject(extra)) for (const method of Object.keys(extra)) add(method, extra[method], ['additionalOperations', method])
  }
  return entry
}

function makeOperation(
  scope: Operation['scope'],
  route: string,
  method: string,
  declared: Loc,
  loc: Loc,
  op: Record<string, unknown>,
  pathItem: Record<string, unknown>,
  pathItemLoc: Loc
): Operation {
  const tags = Array.isArray(own(op, 'tags')) ? (own(op, 'tags') as unknown[]).filter((t): t is string => typeof t === 'string') : []
  return {
    key: 'op:' + declared.doc + toPointer(declared.path),
    scope,
    route,
    method,
    declared,
    loc,
    pathItemLoc,
    op,
    pathItem,
    tags,
    summary: str(own(op, 'summary')) ?? str(own(pathItem, 'summary')) ?? '',
    operationId: str(own(op, 'operationId')),
    deprecated: own(op, 'deprecated') === true
  }
}

function buildTags(model: OpenApiModel): void {
  const declared = Array.isArray(own(model.root, 'tags')) ? (own(model.root, 'tags') as unknown[]) : []
  const nodes = new Map<string, TagNode>()
  const order: string[] = []
  declared.forEach((tag, index) => {
    if (!isObject(tag) || typeof tag.name !== 'string' || nodes.has(tag.name)) return
    const kind = str(own(tag, 'kind'))
    if (model.family === 'openapi32' && kind && kind !== 'nav') {
      model.badgeTags.add(tag.name)
      return
    }
    nodes.set(tag.name, {
      key: 'tag:' + tag.name,
      name: tag.name,
      title: str(own(tag, 'x-displayName')) ?? str(own(tag, 'summary')) ?? tag.name,
      tag,
      loc: { doc: '', path: ['tags', String(index)] },
      operations: [],
      children: []
    })
    order.push(tag.name)
  })
  const untagged: Operation[] = []
  for (const op of [...model.operations]) {
    const groups = op.tags.filter((name) => !model.badgeTags.has(name))
    if (groups.length === 0) {
      untagged.push(op)
      continue
    }
    for (const name of groups) {
      let node = nodes.get(name)
      if (!node) {
        node = { key: 'tag:' + name, name, title: name, operations: [], children: [] }
        nodes.set(name, node)
        order.push(name)
      }
      node.operations.push(op)
    }
  }
  // OpenAPI 3.2 `parent`: nest tags, refusing cycles.
  const roots: TagNode[] = []
  for (const name of order) {
    const node = nodes.get(name)!
    const parent = node.tag ? str(own(node.tag, 'parent')) : undefined
    if (parent && nodes.has(parent) && parent !== name && !isAncestor(nodes, name, parent)) {
      nodes.get(parent)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  if (untagged.length > 0) roots.push({ key: 'tag:', name: '', title: '', operations: untagged, children: [] })
  model.tags = roots

  const groups = own(model.root, 'x-tagGroups')
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (isObject(group) && typeof group.name === 'string' && Array.isArray(group.tags)) {
        model.tagGroups.push({ name: group.name, tags: group.tags.filter((t): t is string => typeof t === 'string') })
      }
    }
  }
}

/** Whether `name` is an ancestor of `of` through `parent` fields. */
function isAncestor(nodes: Map<string, TagNode>, name: string, of: string): boolean {
  let current: string | undefined = of
  for (let i = 0; current && i < 64; i++) {
    if (current === name) return true
    const tag: Record<string, unknown> | undefined = nodes.get(current)?.tag
    current = tag ? str(own(tag, 'parent')) : undefined
  }
  return false
}

export function serversOf(root: Record<string, unknown>, family: Family): ServerInfo[] {
  if (family === 'swagger2') {
    const host = str(own(root, 'host'))
    const basePath = str(own(root, 'basePath')) ?? ''
    const schemes = Array.isArray(own(root, 'schemes')) ? (own(root, 'schemes') as unknown[]).filter((s): s is string => typeof s === 'string') : []
    if (!host) return basePath ? [{ url: basePath, resolved: basePath, variables: {}, loc: { doc: '', path: ['basePath'] } }] : []
    const list = schemes.length > 0 ? schemes : ['https']
    return list.map((scheme) => {
      const url = `${scheme}://${host}${basePath}`
      return { url, resolved: url, variables: {}, loc: { doc: '', path: ['host'] } }
    })
  }
  return serverList(own(root, 'servers'), ['servers'])
}

export function serverList(value: unknown, base: string[], doc = ''): ServerInfo[] {
  if (!Array.isArray(value)) return []
  const out: ServerInfo[] = []
  value.forEach((server, index) => {
    if (!isObject(server) || typeof server.url !== 'string') return
    const variables: Record<string, Record<string, unknown>> = {}
    const vars = own(server, 'variables')
    if (isObject(vars)) for (const name of Object.keys(vars)) if (isObject(vars[name])) variables[name] = vars[name] as Record<string, unknown>
    out.push({
      url: server.url,
      resolved: expandServerUrl(server.url, variables),
      description: str(own(server, 'description')),
      name: str(own(server, 'name')),
      variables,
      loc: { doc, path: [...base, String(index)] }
    })
  })
  return out
}

export function expandServerUrl(url: string, variables: Record<string, Record<string, unknown>>): string {
  return url.replace(/\{([^{}]+)\}/g, (match, name: string) => {
    const variable = variables[name]
    const value = variable ? own(variable, 'default') : undefined
    return typeof value === 'string' || typeof value === 'number' ? String(value) : match
  })
}

/** The servers that apply to an operation: its own, else its path item's, else the document's. */
export function operationServers(model: OpenApiModel, op: Operation): { servers: ServerInfo[]; level: 'operation' | 'path' | 'root' } {
  if (model.family !== 'swagger2') {
    const own1 = serverList(own(op.op, 'servers'), [...op.loc.path, 'servers'], op.loc.doc)
    if (own1.length > 0) return { servers: own1, level: 'operation' }
    const own2 = serverList(own(op.pathItem, 'servers'), [...op.pathItemLoc.path, 'servers'], op.pathItemLoc.doc)
    if (own2.length > 0) return { servers: own2, level: 'path' }
  } else {
    const schemes = own(op.op, 'schemes')
    if (Array.isArray(schemes) && schemes.length > 0) {
      const root = { ...model.root, schemes }
      return { servers: serversOf(root, 'swagger2'), level: 'operation' }
    }
  }
  return { servers: model.servers, level: 'root' }
}

/** Security requirements: the operation's own (an empty list turns security off) or the root's. */
export function operationSecurity(model: OpenApiModel, op: Operation): { requirements: Record<string, unknown>[]; inherited: boolean } | null {
  const ownSecurity = own(op.op, 'security')
  if (Array.isArray(ownSecurity)) return { requirements: ownSecurity.filter(isObject), inherited: false }
  const rootSecurity = own(model.root, 'security')
  if (Array.isArray(rootSecurity)) return { requirements: rootSecurity.filter(isObject), inherited: true }
  return null
}

export function securitySchemes(model: OpenApiModel): Record<string, unknown> {
  const map = model.family === 'swagger2' ? own(model.root, 'securityDefinitions') : getAt(model.root, ['components', 'securitySchemes'])
  return isObject(map) ? map : {}
}

/** `/pets/{petId}/photos/{id}` → `['petId', 'id']`. */
export function pathTemplateNames(route: string): string[] {
  const names: string[] = []
  for (const match of route.matchAll(/\{([^{}]+)\}/g)) names.push(match[1])
  return names
}

export function operationTitle(op: Operation): string {
  return op.summary || op.operationId || `${op.method.toUpperCase()} ${op.route}`
}
