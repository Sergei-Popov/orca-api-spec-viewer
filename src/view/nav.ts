// The sidebar as data: a tree of sections, groups and items built from the model, flattened into
// rows for the virtual list by what is expanded and what the filter matches. Also the map from a
// JSON pointer to the page that shows it, for problems and `#/…` links. No DOM here.

import type { Model } from '../analyze'
import type { AsyncApiModel } from '../spec/asyncapi'
import { flatTags, type OpenApiModel, type Operation, type TagNode } from '../spec/openapi'
import { toPointer } from '../spec/pointer'

export interface NavLabels {
  overview: string
  operations: string
  webhooks: string
  untagged: string
  servers: string
  channels: string
  messages: string
  workflows: string
  actions: string
  section: (name: string) => string
}

export interface NavNode {
  id: string
  label: string
  /** A second, quieter text: a path, an address, an operationId. */
  detail?: string
  /** An HTTP method or an AsyncAPI action, shown as a badge. */
  method?: string
  deprecated?: boolean
  /** The page it opens; a section without one only groups. */
  key?: string
  kind: 'section' | 'group' | 'item'
  children?: NavNode[]
  /** Items below, for the count beside a group. */
  count?: number
  /** Lowercase text the filter looks in. */
  match: string
}

export interface NavRow {
  node: NavNode
  depth: number
  expanded: boolean
  hasChildren: boolean
}

function lower(...parts: (string | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p)
    .join(' ')
    .toLowerCase()
}

function opNode(op: Operation): NavNode {
  const label = op.summary || op.route
  return {
    id: op.key,
    key: op.key,
    kind: 'item',
    label,
    detail: op.summary ? op.route : op.operationId,
    method: op.method,
    deprecated: op.deprecated,
    match: lower(label, op.route, op.operationId, op.method)
  }
}

function count(nodes: NavNode[]): number {
  let n = 0
  for (const node of nodes) n += node.kind === 'item' ? 1 : (node.count ?? 0)
  return n
}

function section(id: string, label: string, children: NavNode[], key?: string): NavNode {
  return { id, label, kind: 'section', children, count: count(children), key, match: lower(label) }
}

function tagNode(tag: TagNode, labels: NavLabels): NavNode {
  const children = [...tag.children.map((child) => tagNode(child, labels)), ...tag.operations.map(opNode)]
  const label = tag.name === '' ? labels.untagged : tag.title
  return { id: tag.key, key: tag.key, kind: 'group', label, children, count: count(children), match: lower(label, tag.name) }
}

function openApiTree(model: OpenApiModel, labels: NavLabels): NavNode[] {
  const out: NavNode[] = []
  const tagged = model.tags.filter((t) => t.operations.length > 0 || t.children.length > 0)
  if (model.tagGroups.length > 0) {
    const used = new Set<string>()
    for (const group of model.tagGroups) {
      const tags = group.tags.map((name) => tagged.find((t) => t.name === name)).filter((t): t is TagNode => !!t)
      tags.forEach((t) => used.add(t.name))
      if (tags.length > 0) out.push(section('group:' + group.name, group.name, tags.map((t) => tagNode(t, labels))))
    }
    const rest = tagged.filter((t) => !used.has(t.name))
    if (rest.length > 0) out.push(section('section:operations', labels.operations, rest.map((t) => tagNode(t, labels))))
  } else if (tagged.length === 1 && tagged[0].name === '' && tagged[0].children.length === 0) {
    out.push(section('section:operations', labels.operations, tagged[0].operations.map(opNode)))
  } else if (tagged.length > 0) {
    out.push(section('section:operations', labels.operations, tagged.map((t) => tagNode(t, labels))))
  }
  if (model.webhooks.length > 0) out.push(section('section:webhooks', labels.webhooks, model.webhooks.map(opNode)))
  for (const [name, entries] of model.components) {
    if (entries.length === 0) continue
    out.push(
      section(
        'section:c:' + name,
        labels.section(name),
        entries.map((entry) => ({ id: entry.key, key: entry.key, kind: 'item', label: entry.name, match: lower(entry.name) }))
      )
    )
  }
  return out
}

function asyncTree(model: AsyncApiModel, labels: NavLabels): NavNode[] {
  const out: NavNode[] = []
  const asyncOp = (op: AsyncApiModel['operations'][number]): NavNode => ({
    id: op.key,
    key: op.key,
    kind: 'item',
    label: op.title,
    detail: op.channel?.address ?? op.channel?.id ?? op.channelRef,
    method: op.action,
    deprecated: op.deprecated,
    match: lower(op.title, op.id, op.summary, op.channel?.address ?? undefined, op.channel?.id, op.action)
  })
  if (model.operations.length > 0) {
    const tagged = model.tagGroups.length > 1 || (model.tagGroups.length === 1 && model.tagGroups[0].name !== '')
    const children = tagged
      ? model.tagGroups.map((group): NavNode => {
          const ops = group.operations.map(asyncOp)
          const label = group.name || labels.untagged
          return { id: 'atag:' + group.name, kind: 'group', label, children: ops, count: ops.length, match: lower(label) }
        })
      : model.operations.map(asyncOp)
    out.push(section('section:operations', labels.operations, children))
  }
  if (model.channels.length > 0) {
    out.push(
      section(
        'section:channels',
        labels.channels,
        model.channels.map((ch) => ({
          id: ch.key,
          key: ch.key,
          kind: 'item' as const,
          label: ch.id,
          detail: ch.address && ch.address !== ch.id ? ch.address : undefined,
          match: lower(ch.id, ch.address ?? undefined)
        }))
      )
    )
  }
  if (model.servers.length > 0) {
    out.push(
      section(
        'section:servers',
        labels.servers,
        model.servers.map((s) => ({ id: s.key, key: s.key, kind: 'item' as const, label: s.name, detail: s.url, method: s.protocol, match: lower(s.name, s.url, s.protocol) }))
      )
    )
  }
  for (const [name, entries] of model.components) {
    if (entries.length === 0) continue
    out.push(
      section(
        'section:c:' + name,
        labels.section(name),
        entries.map((entry) => ({ id: entry.key, key: entry.key, kind: 'item', label: entry.name, match: lower(entry.name) }))
      )
    )
  }
  return out
}

export function navTree(model: Model | null, labels: NavLabels): NavNode[] {
  const overview: NavNode = { id: 'overview', key: 'overview', kind: 'item', label: labels.overview, match: lower(labels.overview) }
  if (!model) return [overview]
  const rest =
    model.kind === 'openapi'
      ? openApiTree(model.model, labels)
      : model.kind === 'asyncapi'
        ? asyncTree(model.model, labels)
        : model.kind === 'arazzo'
          ? model.model.workflows.length > 0
            ? [
                section(
                  'section:workflows',
                  labels.workflows,
                  model.model.workflows.map((wf): NavNode => {
                    const steps = wf.steps.map((step): NavNode => ({
                      id: step.key,
                      key: step.key,
                      kind: 'item',
                      label: step.stepId,
                      detail: step.target?.value,
                      match: lower(step.stepId, step.target?.value, step.description)
                    }))
                    return { id: wf.key, key: wf.key, kind: 'group', label: wf.workflowId, detail: wf.summary, children: steps, count: steps.length, match: lower(wf.workflowId, wf.summary) }
                  })
                )
              ]
            : []
          : model.model.actions.length > 0
            ? [
                section(
                  'section:actions',
                  labels.actions,
                  model.model.actions.map((action) => ({
                    id: action.key,
                    key: action.key,
                    kind: 'item' as const,
                    label: action.target || '—',
                    detail: action.description,
                    method: action.kind === 'none' ? undefined : action.kind,
                    match: lower(action.target, action.description, action.kind)
                  }))
                )
              ]
            : []
  return [overview, ...rest]
}

/** Which groups start open: small ones, and the operations of small documents. */
export function defaultExpanded(nodes: NavNode[]): Set<string> {
  const open = new Set<string>()
  const walk = (list: NavNode[]) => {
    for (const node of list) {
      if (!node.children) continue
      if (node.kind === 'section' && ((node.count ?? 0) <= 60 || node.id === 'section:operations' || node.id.startsWith('group:'))) open.add(node.id)
      if (node.kind === 'group' && (node.count ?? 0) <= 12) open.add(node.id)
      walk(node.children)
    }
  }
  walk(nodes)
  return open
}

/**
 * Rows to show. With a filter, every item whose text holds all of its words shows, with the
 * groups above it open; a group whose own name matches shows all it holds.
 */
export function flattenNav(nodes: NavNode[], expanded: Set<string>, filter: string): NavRow[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const rows: NavRow[] = []
  const matches = (node: NavNode) => words.every((w) => node.match.includes(w))
  if (words.length === 0) {
    const walk = (list: NavNode[], depth: number) => {
      for (const node of list) {
        const open = expanded.has(node.id)
        const hasChildren = !!node.children && node.children.length > 0
        rows.push({ node, depth, expanded: open, hasChildren })
        if (hasChildren && open) walk(node.children!, depth + 1)
      }
    }
    walk(nodes, 0)
    return rows
  }
  const visit = (node: NavNode, depth: number, out: NavRow[], parentMatched: boolean): boolean => {
    const self = node.kind !== 'section' && matches(node)
    const children = node.children ?? []
    const inner: NavRow[] = []
    let any = false
    for (const child of children) if (visit(child, depth + 1, inner, parentMatched || self)) any = true
    if (self || any || (parentMatched && node.kind === 'item')) {
      out.push({ node, depth, expanded: children.length > 0, hasChildren: children.length > 0 }, ...inner)
      return true
    }
    return false
  }
  for (const node of nodes) visit(node, 0, rows, false)
  return rows
}

/** Pointer prefixes of every page, so any location finds the page that shows it. */
export function pageIndex(model: Model | null): Map<string, string> {
  const index = new Map<string, string>()
  const put = (path: readonly string[], key: string, doc = '') => {
    if (doc !== '') return
    const pointer = toPointer(path)
    if (!index.has(pointer)) index.set(pointer, key)
  }
  if (!model) return index
  if (model.kind === 'openapi') {
    const m = model.model
    for (const op of [...m.operations, ...m.webhooks]) {
      put(op.declared.path, op.key, op.declared.doc)
      put(op.loc.path, op.key, op.loc.doc)
    }
    for (const tag of flatTags(m.tags)) if (tag.loc) put(tag.loc.path, tag.key, tag.loc.doc)
    for (const entries of m.components.values()) for (const entry of entries) put(entry.loc.path, entry.key, entry.loc.doc)
  } else if (model.kind === 'asyncapi') {
    const m = model.model
    for (const op of m.operations) put(op.loc.path, op.key, op.loc.doc)
    for (const ch of m.channels) put(ch.loc.path, ch.key, ch.loc.doc)
    for (const s of m.servers) put(s.loc.path, s.key, s.loc.doc)
    for (const entries of m.components.values()) for (const entry of entries) put(entry.loc.path, entry.key, entry.loc.doc)
  } else if (model.kind === 'arazzo') {
    for (const wf of model.model.workflows) {
      put(wf.loc.path, wf.key, wf.loc.doc)
      for (const step of wf.steps) put(step.loc.path, step.key, step.loc.doc)
    }
  } else {
    for (const action of model.model.actions) put(action.loc.path, action.key, action.loc.doc)
  }
  return index
}

/** The page of the deepest known location at or above `path`, else the overview. */
export function pageFor(index: Map<string, string>, path: readonly string[]): string {
  for (let n = path.length; n > 0; n--) {
    const key = index.get(toPointer(path.slice(0, n)))
    if (key) return key
  }
  return 'overview'
}

/** Each page's parents in the tree, to open them when the page is shown. */
export function ancestorsOf(nodes: NavNode[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const walk = (list: NavNode[], chain: string[]) => {
    for (const node of list) {
      if (node.key && !out.has(node.key)) out.set(node.key, chain)
      if (node.children) walk(node.children, [...chain, node.id])
    }
  }
  walk(nodes, [])
  return out
}
