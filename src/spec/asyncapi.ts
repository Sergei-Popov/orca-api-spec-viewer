// The AsyncAPI 2.x and 3.x model: servers, channels, operations (publish/subscribe in 2.x,
// send/receive in 3.x), messages and components.

import type { Family } from './detect'
import type { ComponentEntry } from './openapi'
import { getAt, isObject, own, str, toPointer } from './pointer'
import { refOf, type Loc, type Refs, type Resolution } from './refs'

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

function message(refs: Refs, raw: unknown, at: Loc, name: string): AsyncMessage {
  const followed = refs.follow(raw, at)
  const value = isObject(followed.value) ? followed.value : {}
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
          for (const name of Object.keys(messages)) channel.messages.push(message(refs, messages[name], child(followed.loc, 'messages', name), name))
        }
      } else {
        for (const action of ['publish', 'subscribe'] as const) {
          const op = own(value, action)
          if (!isObject(op)) continue
          const loc = child(followed.loc, action)
          const messages = v2Messages(refs, own(op, 'message'), child(loc, 'message'))
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
        const op = isObject(followed.value) ? followed.value : {}
        const channelRef = refOf(own(op, 'channel'))?.ref
        let channel: AsyncChannel | undefined
        if (channelRef) {
          const resolved = refs.resolve(channelRef)
          if (resolved.kind === 'local' && resolved.loc.doc === '') channel = byLoc.get(toPointer(resolved.loc.path))
        }
        let messages: AsyncMessage[] = []
        const listed = own(op, 'messages')
        if (Array.isArray(listed)) {
          messages = listed.map((m, index) => message(refs, m, child(followed.loc, 'messages', String(index)), String(index)))
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
function v2Messages(refs: Refs, raw: unknown, at: Loc): AsyncMessage[] {
  if (raw === undefined) return []
  const followed = refs.follow(raw, at)
  const value = followed.value
  if (isObject(value) && Array.isArray(value.oneOf)) {
    return value.oneOf.map((m, index) => message(refs, m, child(followed.loc, 'oneOf', String(index)), String(index)))
  }
  return [message(refs, raw, at, '')]
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
