// Full search (⌘F / Ctrl+F) over paths, operationIds, summaries, descriptions, tags, schema
// names and property names. The index is built once per document, lazily, from the model; a
// query matches when every word appears somewhere in an entry, and ranks title hits first.

import type { Model } from '../analyze'
import { isObject, own, str } from '../spec/pointer'

export type EntryKind = 'operation' | 'webhook' | 'tag' | 'component' | 'channel' | 'message' | 'server' | 'workflow' | 'step' | 'action'

interface Field {
  /** 4 title, 3 path or id, 2 summary or names, 1 description. */
  weight: number
  text: string
  lower: string
}

export interface SearchEntry {
  key: string
  kind: EntryKind
  title: string
  detail?: string
  method?: string
  /** The component section, for components. */
  section?: string
  deprecated?: boolean
  fields: Field[]
}

export interface SearchHit {
  entry: SearchEntry
  score: number
  /** A piece of the best matching text that is not the title, to show under it. */
  snippet?: string
}

const MAX_FIELD = 4000

function field(weight: number, text: string | undefined): Field | null {
  if (!text) return null
  const cut = text.length > MAX_FIELD ? text.slice(0, MAX_FIELD) : text
  return { weight, text: cut, lower: cut.toLowerCase() }
}

function entry(key: string, kind: EntryKind, title: string, fields: (Field | null)[], extra: Partial<SearchEntry> = {}): SearchEntry {
  return { key, kind, title, fields: [field(4, title)!, ...fields].filter((f): f is Field => !!f), ...extra }
}

/** Names of a schema's own properties, one level deep, for "which schema has `customer_id`". */
function propertyNames(value: unknown): string | undefined {
  if (!isObject(value)) return undefined
  const props = own(value, 'properties')
  if (!isObject(props)) return undefined
  const names = Object.keys(props)
  return names.length > 0 ? names.slice(0, 300).join(' ') : undefined
}

export function buildSearchIndex(model: Model | null): SearchEntry[] {
  const out: SearchEntry[] = []
  if (!model) return out
  if (model.kind === 'openapi') {
    const m = model.model
    for (const op of [...m.operations, ...m.webhooks]) {
      out.push(
        entry(
          op.key,
          op.scope === 'webhook' ? 'webhook' : 'operation',
          op.summary || op.route,
          [field(3, op.route), field(3, op.operationId), field(2, op.tags.join(' ')), field(1, str(own(op.op, 'description')))],
          { detail: op.route, method: op.method, deprecated: op.deprecated }
        )
      )
    }
    const walkTags = (tags: typeof m.tags) => {
      for (const tag of tags) {
        if (tag.name) out.push(entry(tag.key, 'tag', tag.title, [field(3, tag.name), field(1, tag.tag ? str(own(tag.tag, 'description')) : undefined)]))
        walkTags(tag.children)
      }
    }
    walkTags(m.tags)
    for (const [section, entries] of m.components) {
      for (const c of entries) {
        const description = isObject(c.value) ? (str(own(c.value, 'description')) ?? str(own(c.value, 'title'))) : undefined
        out.push(entry(c.key, 'component', c.name, [field(2, propertyNames(c.value)), field(1, description)], { section }))
      }
    }
  } else if (model.kind === 'asyncapi') {
    const m = model.model
    for (const op of m.operations) {
      out.push(
        entry(op.key, 'operation', op.title, [field(3, op.id), field(3, op.channel?.address ?? undefined), field(2, op.summary), field(1, str(own(op.op, 'description')))], {
          detail: op.channel?.address ?? op.channel?.id,
          method: op.action,
          deprecated: op.deprecated
        })
      )
    }
    for (const ch of m.channels) {
      out.push(entry(ch.key, 'channel', ch.id, [field(3, ch.address ?? undefined), field(2, ch.messages.map((msg) => msg.name).join(' ')), field(1, str(own(ch.value, 'description')))], { detail: ch.address ?? undefined }))
    }
    for (const s of m.servers) out.push(entry(s.key, 'server', s.name, [field(3, s.url), field(1, s.description)], { detail: s.url }))
    for (const [section, entries] of m.components) {
      for (const c of entries) {
        const description = isObject(c.value) ? (str(own(c.value, 'description')) ?? str(own(c.value, 'summary'))) : undefined
        out.push(entry(c.key, section === 'messages' ? 'message' : 'component', c.name, [field(2, propertyNames(c.value)), field(1, description)], { section }))
      }
    }
  } else if (model.kind === 'arazzo') {
    for (const wf of model.model.workflows) {
      out.push(entry(wf.key, 'workflow', wf.workflowId, [field(2, wf.summary), field(1, wf.description)], { detail: wf.summary }))
      for (const step of wf.steps) out.push(entry(step.key, 'step', step.stepId, [field(3, step.target?.value), field(1, step.description)], { detail: wf.workflowId }))
    }
  } else {
    for (const action of model.model.actions) {
      out.push(entry(action.key, 'action', action.target || '—', [field(1, action.description)], { method: action.kind === 'none' ? undefined : action.kind }))
    }
  }
  return out
}

function scoreField(f: Field, word: string): number {
  const at = f.lower.indexOf(word)
  if (at < 0) return 0
  let s = f.weight
  if (f.lower.length === word.length) s *= 4
  else if (at === 0) s *= 2.5
  else if (!/[a-z0-9]/.test(f.lower[at - 1])) s *= 1.8
  return s
}

function snippetOf(text: string, word: string): string {
  const flat = text.replace(/\s+/g, ' ')
  const at = flat.toLowerCase().indexOf(word)
  if (at < 0) return flat.slice(0, 120)
  const start = Math.max(0, at - 50)
  const end = Math.min(flat.length, at + word.length + 70)
  return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '')
}

export function search(entries: SearchEntry[], query: string, limit = 200): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const hits: SearchHit[] = []
  for (const e of entries) {
    let total = 0
    let best: Field | null = null
    let bestScore = 0
    let ok = true
    for (const word of words) {
      let wordBest = 0
      for (const f of e.fields) {
        const s = scoreField(f, word)
        if (s > wordBest) wordBest = s
        if (s > 0 && f.weight < 4 && s > bestScore) {
          bestScore = s
          best = f
        }
      }
      if (wordBest === 0) {
        ok = false
        break
      }
      total += wordBest
    }
    if (!ok) continue
    if (e.deprecated) total *= 0.9
    const titleHit = words.some((w) => e.fields[0].lower.includes(w))
    hits.push({ entry: e, score: total, snippet: best && (!titleHit || best.weight === 1) ? snippetOf(best.text, words[0]) : undefined })
  }
  hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
  return hits.slice(0, limit)
}
