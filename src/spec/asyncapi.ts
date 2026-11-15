// The AsyncAPI 2.x and 3.x model: servers, channels, operations (publish/subscribe in 2.x,
// send/receive in 3.x), messages and components.

import type { Family } from './detect'
import type { ComponentEntry } from './openapi'
import { getAt, isObject, own, str, toPointer } from './pointer'
import { refOf, type Loc, type Refs, type Resolution } from './refs'
import { isJsonSchemaFormat } from './schema-format'

export interface AsyncMessage {
  key: string
  name: string
  value: Record<string, unknown>
  loc: Loc
  ref?: string
  stop?: Exclude<Resolution, { kind: 'local' }>
}

export interface AsyncOperation {
  key: string
  /** v3 operation id; v2 `operationId`, else `<channel> <action>`. */
  id: string
  action: 'send' | 'receive' | 'publish' | 'subscribe'
  channel?: AsyncChannel
  /** The channel reference when it does not resolve. */
  channelRef?: string
  loc: Loc
  op: Record<string, unknown>
  title: string
  summary: string
  tags: string[]
  messages: AsyncMessage[]
  deprecated: boolean
}

export interface AsyncChannel {
  key: string
  /** v3 channel id; v2 the channel name, which is also its address. */
  id: string
  address: string | null
  loc: Loc
  value: Record<string, unknown>
  messages: AsyncMessage[]
  operations: AsyncOperation[]
}

export interface AsyncServer {
  key: string
  name: string
  /** v2 `url`; v3 `protocol://host/pathname`. */
  url: string
  protocol?: string
  protocolVersion?: string
  description?: string
  value: Record<string, unknown>
  loc: Loc
}

export interface AsyncApiModel {
  family: Family
  root: Record<string, unknown>
  info: Record<string, unknown>
  servers: AsyncServer[]
  channels: AsyncChannel[]
  operations: AsyncOperation[]
  /** Operations grouped by their first tag, in declaration order. */
  tagGroups: { name: string; operations: AsyncOperation[] }[]
  components: Map<string, ComponentEntry[]>
}

const SECTIONS = [
  'schemas',
  'servers',
  'channels',
  'operations',
  'messages',
  'securitySchemes',
  'serverVariables',
  'parameters',
  'correlationIds',
  'replies',
  'replyAddresses',
  'externalDocs',
  'tags',
  'operationTraits',
  'messageTraits',
  'serverBindings',
  'channelBindings',
  'operationBindings',
  'messageBindings'
]

function child(loc: Loc, ...segments: string[]): Loc {
  return { ...loc, path: [...loc.path, ...segments] }
}

/** JSON Merge Patch (RFC 7386): objects merge, `null` removes, anything else replaces. */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch
  const out: Record<string, unknown> = isObject(target) ? { ...target } : {}
  for (const key of Object.keys(patch)) {
    if (patch[key] === null) delete out[key]
    else out[key] = mergePatch(out[key], patch[key])
  }
  return out
}

/**
 * A message or operation with its traits merged in, as JSON Merge Patches in their order. In 2.x
 * each trait is applied over the object; in 3.x a trait never overrides the object's own fields.
 */
export function withTraits(refs: Refs, value: Record<string, unknown>, loc: Loc, family: Family): Record<string, unknown> {
  const traits = own(value, 'traits')
  if (!Array.isArray(traits) || traits.length === 0) return value
  let merged: unknown = family === 'asyncapi3' ? {} : value
  traits.slice(0, 50).forEach((trait, index) => {
    const followed = refs.follow(trait, child(loc, 'traits', String(index)))
    if (isObject(followed.value)) merged = mergePatch(merged, followed.value)
  })
  if (family === 'asyncapi3') merged = mergePatch(merged, value)
  return isObject(merged) ? merged : value
}

function message(refs: Refs, raw: unknown, at: Loc, name: string, family: Family): AsyncMessage {
  const followed = refs.follow(raw, at)
  const value = isObject(followed.value) ? withTraits(refs, followed.value, followed.loc, family) : {}
  // A referenced message is known by the key it was defined under.
  const fallback = followed.via.length > 0 ? (followed.loc.path.at(-1) ?? name) : name
  const label = str(own(value, 'name')) ?? str(own(value, 'title')) ?? fallback
  return {
    key: 'msg:' + followed.loc.doc + toPointer(followed.loc.path),
    name: label,
    value,
    loc: followed.loc,
    ref: followed.via[0],
    stop: followed.stop
  }
}

function tagNames(op: Record<string, unknown>, refs: Refs, loc: Loc): string[] {
  const tags = own(op, 'tags')
  if (!Array.isArray(tags)) return []
  const names: string[] = []
  tags.forEach((tag, index) => {
    const value = refs.follow(tag, child(loc, 'tags', String(index))).value
    if (isObject(value) && typeof value.name === 'string') names.push(value.name)
  })
  return names
}

export function buildAsyncApi(root: Record<string, unknown>, family: Family, refs: Refs): AsyncApiModel {
  const model: AsyncApiModel = {
    family,
    root,
    info: isObject(own(root, 'info')) ? (own(root, 'info') as Record<string, unknown>) : {},
    servers: [],
    channels: [],
    operations: [],
    tagGroups: [],
    components: new Map()
  }

  const servers = own(root, 'servers')
  if (isObject(servers)) {
    for (const name of Object.keys(servers)) {
      const followed = refs.follow(servers[name], { doc: '', path: ['servers', name] })
      const value = isObject(followed.value) ? followed.value : {}
      const protocol = str(own(value, 'protocol'))
      const url =
        family === 'asyncapi2'
          ? str(own(value, 'url')) ?? ''
          : `${protocol ? protocol + '://' : ''}${str(own(value, 'host')) ?? ''}${str(own(value, 'pathname')) ?? ''}`
      model.servers.push({
        key: 'srv:' + toPointer(['servers', name]),
        name,
        url,
        protocol,
        protocolVersion: str(own(value, 'protocolVersion')),
        description: str(own(value, 'description')),
        value,
        loc: followed.loc
      })
    }
  }

  const channels = own(root, 'channels')
  const byLoc = new Map<string, AsyncChannel>()
  if (isObject(channels)) {
    for (const id of Object.keys(channels)) {
      if (id.startsWith('x-')) continue
      const declared = { doc: '', path: ['channels', id] }
      const followed = refs.follow(channels[id], declared)
      const value = isObject(followed.value) ? followed.value : {}
      const channel: AsyncChannel = {
        key: 'ch:' + toPointer(declared.path),
        id,
        address: family === 'asyncapi2' ? id : typeof own(value, 'address') === 'string' ? (own(value, 'address') as string) : null,
        loc: followed.loc,
        value,
        messages: [],
        operations: []
      }
      if (family === 'asyncapi3') {
        const messages = own(value, 'messages')
        if (isObject(messages)) {
          for (const name of Object.keys(messages)) channel.messages.push(message(refs, messages[name], child(followed.loc, 'messages', name), name, family))
        }
      } else {
        for (const action of ['publish', 'subscribe'] as const) {
          const declaredOp = own(value, action)
          if (!isObject(declaredOp)) continue
          const loc = child(followed.loc, action)
          const op = withTraits(refs, declaredOp, loc, family)
          const messages = v2Messages(refs, own(op, 'message'), child(loc, 'message'), family)
          for (const m of messages) if (!channel.messages.some((x) => x.key === m.key)) channel.messages.push(m)
          const operation: AsyncOperation = {
            key: 'aop:' + toPointer(loc.path),
            id: str(own(op, 'operationId')) ?? `${id} ${action}`,
            action,
            channel,
            loc,
            op,
            title: str(own(op, 'summary')) ?? str(own(op, 'operationId')) ?? '',
            summary: str(own(op, 'summary')) ?? '',
            tags: tagNames(op, refs, loc),
            messages,
            deprecated: own(op, 'deprecated') === true
          }
          channel.operations.push(operation)
          model.operations.push(operation)
        }
      }
      model.channels.push(channel)
      byLoc.set(toPointer(followed.loc.path), channel)
      byLoc.set(toPointer(declared.path), channel)
    }
  }

  if (family === 'asyncapi3') {
    const operations = own(root, 'operations')
    if (isObject(operations)) {
      for (const id of Object.keys(operations)) {
        if (id.startsWith('x-')) continue
        const declared = { doc: '', path: ['operations', id] }
        const followed = refs.follow(operations[id], declared)
        const op = isObject(followed.value) ? withTraits(refs, followed.value, followed.loc, family) : {}
        const channelRef = refOf(own(op, 'channel'))?.ref
        let channel: AsyncChannel | undefined
        if (channelRef) {
          const resolved = refs.resolve(channelRef)
          if (resolved.kind === 'local' && resolved.loc.doc === '') channel = byLoc.get(toPointer(resolved.loc.path))
        }
        let messages: AsyncMessage[] = []
        const listed = own(op, 'messages')
        if (Array.isArray(listed)) {
          messages = listed.map((m, index) => message(refs, m, child(followed.loc, 'messages', String(index)), String(index), family))
        } else if (channel) {
          messages = channel.messages
        }
        const action = own(op, 'action') === 'receive' ? 'receive' : 'send'
        const operation: AsyncOperation = {
          key: 'aop:' + toPointer(declared.path),
          id,
          action,
          channel,
          channelRef: channel ? undefined : channelRef,
          loc: followed.loc,
          op,
          title: str(own(op, 'title')) ?? str(own(op, 'summary')) ?? id,
          summary: str(own(op, 'summary')) ?? '',
          tags: tagNames(op, refs, followed.loc),
          messages,
          deprecated: own(op, 'deprecated') === true
        }
        channel?.operations.push(operation)
        model.operations.push(operation)
      }
    }
  }

  const groups = new Map<string, AsyncOperation[]>()
  for (const op of model.operations) {
    const name = op.tags[0] ?? ''
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(op)
  }
  const untagged = groups.get('')
  groups.delete('')
  for (const [name, operations] of groups) model.tagGroups.push({ name, operations })
  if (untagged) model.tagGroups.push({ name: '', operations: untagged })

  const components = own(root, 'components')
  if (isObject(components)) {
    for (const section of SECTIONS) {
      const map = own(components, section)
      if (!isObject(map)) continue
      const entries = Object.keys(map).map((name) => {
        const loc = { doc: '', path: ['components', section, name] }
        return { key: 'c:' + toPointer(loc.path), section, name, loc, value: map[name] }
      })
      if (entries.length > 0) model.components.set(section, entries)
    }
  }
  return model
}

/** A 2.x operation's `message`: one message, a reference, or `oneOf` a list of them. */
function v2Messages(refs: Refs, raw: unknown, at: Loc, family: Family): AsyncMessage[] {
  if (raw === undefined) return []
  const followed = refs.follow(raw, at)
  const value = followed.value
  if (isObject(value) && Array.isArray(value.oneOf)) {
    return value.oneOf.map((m, index) => message(refs, m, child(followed.loc, 'oneOf', String(index)), String(index), family))
  }
  return [message(refs, raw, at, '', family)]
}

/** One entry of a server's or operation's `security`. */
export type AsyncSecurityItem =
  | { kind: 'ref'; name: string; ref: string }
  | { kind: 'inline'; name: string; value: Record<string, unknown>; index: number }
  | { kind: 'requirement'; name: string; scopes: string[] }

/** 2.x lists requirements (`{ scheme: [scopes] }`); 3.x lists schemes, by reference or inline. */
export function asyncSecurityItems(family: Family, security: unknown): AsyncSecurityItem[] {
  if (!Array.isArray(security)) return []
  const out: AsyncSecurityItem[] = []
  security.forEach((item, index) => {
    if (!isObject(item)) return
    const ref = refOf(item)
    if (ref) out.push({ kind: 'ref', name: ref.ref.split('/').pop() ?? ref.ref, ref: ref.ref })
    else if (family === 'asyncapi3') out.push({ kind: 'inline', name: str(own(item, 'type')) ?? String(index + 1), value: item, index })
    else for (const name of Object.keys(item)) out.push({ kind: 'requirement', name, scopes: Array.isArray(item[name]) ? (item[name] as unknown[]).map(String) : [] })
  })
  return out
}

export interface AsyncReply {
  loc: Loc
  /** The runtime expression of the reply address, if any. */
  address?: string
  channel?: AsyncChannel
  channelRef?: string
  /** The reply's messages; without any, its channel's. */
  messages: AsyncMessage[]
}

/** An AsyncAPI 3 operation's reply, with references followed. */
export function replyOf(refs: Refs, model: AsyncApiModel, op: AsyncOperation): AsyncReply | null {
  const raw = own(op.op, 'reply')
  if (!isObject(raw)) return null
  const followed = refs.follow(raw, child(op.loc, 'reply'))
  const reply = isObject(followed.value) ? followed.value : {}
  const out: AsyncReply = { loc: followed.loc, messages: [] }
  const address = own(reply, 'address')
  if (isObject(address)) {
    const a = refs.follow(address, child(followed.loc, 'address'))
    if (isObject(a.value)) out.address = str(own(a.value, 'location'))
  }
  const channelRef = refOf(own(reply, 'channel'))?.ref
  if (channelRef !== undefined) {
    const resolved = refs.resolve(channelRef, followed.loc.doc, false, child(followed.loc, 'channel').path)
    out.channel = resolved.kind === 'local' && resolved.loc.doc === '' ? model.channels.find((c) => toPointer(c.loc.path) === toPointer(resolved.loc.path)) : undefined
    if (!out.channel) out.channelRef = channelRef
  }
  const listed = own(reply, 'messages')
  if (Array.isArray(listed)) {
    out.messages = listed.map((m, index) => message(refs, m, child(followed.loc, 'messages', String(index)), String(index), model.family))
  } else if (out.channel) {
    out.messages = out.channel.messages
  }
  return out
}

export function asyncServerList(model: AsyncApiModel, value: unknown): AsyncServer[] {
  // A v2 channel names its servers; a v3 one references them.
  if (!Array.isArray(value)) return []
  const out: AsyncServer[] = []
  for (const item of value) {
    const name = typeof item === 'string' ? item : refOf(item)?.ref.split('/').pop()
    const server = model.servers.find((s) => s.name === name)
    if (server) out.push(server)
  }
  return out
}

export function infoOf(root: Record<string, unknown>): Record<string, unknown> {
  const info = getAt(root, ['info'])
  return isObject(info) ? info : {}
}

/**
 * A message's payload as it is drawn: the schema and where it is, its schemaFormat (3.x Multi
 * Format Schema Object, or a 2.x message's own, traits applied), and whether it is shown as
 * source because that format is not a JSON Schema (Avro, Protobuf, RAML…).
 */
export function messagePayload(message: Record<string, unknown>, loc: Loc, family: Family): { value: unknown; loc: Loc; format?: string; source: boolean } | undefined {
  const raw = own(message, 'payload')
  if (raw === undefined) return undefined
  const at: Loc = { doc: loc.doc, path: [...loc.path, 'payload'] }
  const multi = family === 'asyncapi3' ? schemaWithFormat(raw, at) : undefined
  if (multi) return multi
  const format = family === 'asyncapi2' ? str(own(message, 'schemaFormat')) : undefined
  return { value: raw, loc: at, format, source: !isJsonSchemaFormat(format) }
}

/** A Multi Format Schema Object (`{ schemaFormat, schema }`, AsyncAPI 3) as its schema and format. */
export function schemaWithFormat(value: unknown, loc: Loc): { value: unknown; loc: Loc; format: string; source: boolean } | undefined {
  if (!isObject(value) || typeof value.schemaFormat !== 'string' || own(value, 'schema') === undefined) return undefined
  return { value: own(value, 'schema'), loc: { doc: loc.doc, path: [...loc.path, 'schema'] }, format: value.schemaFormat, source: !isJsonSchemaFormat(value.schemaFormat) }
}
