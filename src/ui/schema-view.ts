// The schema tree: nested, collapsible, built lazily (a collapsed node's children are not built
// until it opens). `allOf` parts are merged into one property list; `oneOf`/`anyOf` show their
// variants as tabs with the discriminator's mapping; a reference back to an ancestor shows as a
// "Recursive" link instead of opening forever.

import { format, type Strings } from '../i18n'
import { isObject, own, str } from '../spec/pointer'
import { locKey, refOf, type Loc } from '../spec/refs'
import { constraints, enumValues, formatValue, refName, schemaTypes, type Constraint } from '../spec/schema'
import { append, button, clickable, h, svg, type Child } from './dom'
import { icons } from './icons'
import { markdown, refLink, refTarget, stopNote, type PageCtx } from './context'

const PAGE = 150
const EXPAND_ALL_DEPTH = 6
const EXPAND_ALL_BUDGET = 1500

interface Resolved {
  schema: unknown
  loc: Loc
  ref?: string
  stop?: Parameters<typeof stopNote>[1]
  cycle?: boolean
}

interface Build {
  ctx: PageCtx
  treeId: string
  all: boolean
  budget: { left: number }
}

function resolve(ctx: PageCtx, raw: unknown, loc: Loc): Resolved {
  const followed = ctx.refs.follow(raw, loc)
  return { schema: followed.value, loc: followed.loc, ref: followed.via[0], stop: followed.stop, cycle: followed.cycle }
}

function child(loc: Loc, ...segments: string[]): Loc {
  return { doc: loc.doc, path: [...loc.path, ...segments] }
}

/** A property, pattern, item or variant to draw as one row. */
interface Item {
  label: string
  role: 'property' | 'pattern' | 'additional' | 'role'
  raw: unknown
  loc: Loc
  required?: boolean
  segment: string
}

/** Short type text: `string`, `array<Pet>`, `integer | null`. */
export function typeText(ctx: PageCtx, schema: unknown, loc: Loc, depth = 0): string {
  if (schema === true) return ctx.t.any
  if (!isObject(schema)) return ''
  const types = schemaTypes(schema)
  if (types.includes('array') && depth < 3) {
    const items = own(schema, 'items')
    if (items !== undefined && !Array.isArray(items)) {
      const r = refOf(items)
      const inner = r ? refName(r.ref) : typeText(ctx, items, child(loc, 'items'), depth + 1) || ctx.t.any
      return types.map((t) => (t === 'array' ? `array<${inner}>` : t)).join(' | ')
    }
  }
  if (types.length > 0) return types.join(' | ')
  if (own(schema, 'const') !== undefined) return typeof own(schema, 'const')
  if (Array.isArray(own(schema, 'enum'))) {
    const kinds = new Set((own(schema, 'enum') as unknown[]).map((v) => (v === null ? 'null' : typeof v)))
    return [...kinds].join(' | ')
  }
  return ''
}

export function constraintText(c: Constraint, words: Strings['constraintWords']): string {
  switch (c.kind) {
    case 'minimum':
      return `≥ ${c.value}`
    case 'maximum':
      return `≤ ${c.value}`
    case 'exclusiveMinimum':
      return `> ${c.value}`
    case 'exclusiveMaximum':
      return `< ${c.value}`
    case 'multipleOf':
      return `× ${c.value}`
    case 'minLength':
      return `${words.length} ≥ ${c.value}`
    case 'maxLength':
      return `${words.length} ≤ ${c.value}`
    case 'minItems':
      return `${words.items} ≥ ${c.value}`
    case 'maxItems':
      return `${words.items} ≤ ${c.value}`
    case 'minProperties':
      return `${words.properties} ≥ ${c.value}`
    case 'maxProperties':
      return `${words.properties} ≤ ${c.value}`
    case 'minContains':
      return `${words.contains} ≥ ${c.value}`
    case 'maxContains':
      return `${words.contains} ≤ ${c.value}`
    case 'uniqueItems':
      return words.unique
    case 'pattern':
      return `/${c.value}/`
    default:
      return `${c.kind}: ${c.value}`
  }
}

/** Properties of the schema and of every `allOf` part (followed through references). */
function mergedProperties(ctx: PageCtx, schema: Record<string, unknown>, loc: Loc, seen: Set<string>, depth: number): { items: Item[]; required: Set<string>; parts: { ref?: string; loc: Loc }[]; variants: { key: 'oneOf' | 'anyOf'; schema: Record<string, unknown>; loc: Loc }[] } {
  const items: Item[] = []
  const required = new Set<string>()
  const parts: { ref?: string; loc: Loc }[] = []
  const variants: { key: 'oneOf' | 'anyOf'; schema: Record<string, unknown>; loc: Loc }[] = []
  const add = (s: Record<string, unknown>, at: Loc) => {
    const req = own(s, 'required')
    if (Array.isArray(req)) for (const r of req) if (typeof r === 'string') required.add(r)
    const props = own(s, 'properties')
    if (isObject(props)) {
      for (const name of Object.keys(props)) {
        const existing = items.findIndex((i) => i.role === 'property' && i.label === name)
        const item: Item = { label: name, role: 'property', raw: props[name], loc: child(at, 'properties', name), segment: 'p:' + name }
        if (existing >= 0) items[existing] = item
        else items.push(item)
      }
    }
    for (const key of ['oneOf', 'anyOf'] as const) if (Array.isArray(own(s, key))) variants.push({ key, schema: s, loc: at })
  }
  add(schema, loc)
  const allOf = own(schema, 'allOf')
  if (Array.isArray(allOf) && depth < 8) {
    allOf.forEach((part, index) => {
      const r = resolve(ctx, part, child(loc, 'allOf', String(index)))
      parts.push({ ref: r.ref, loc: r.loc })
      const key = locKey(r.loc)
      if (!isObject(r.schema) || seen.has(key)) return
      seen.add(key)
      const inner = mergedProperties(ctx, r.schema, r.loc, seen, depth + 1)
      for (const item of inner.items) {
        const existing = items.findIndex((i) => i.role === 'property' && i.label === item.label)
        if (existing >= 0) items[existing] = item
        else items.push(item)
      }
      inner.required.forEach((name) => required.add(name))
      variants.push(...inner.variants)
    })
  }
  for (const item of items) if (required.has(item.label)) item.required = true
  return { items, required, parts, variants }
}

/** Draws the schema at `loc` as a tree with its own header row (type, description). */
export function schemaTree(ctx: PageCtx, raw: unknown, loc: Loc, treeId: string, options: { header?: boolean } = {}): HTMLElement {
  const wrap = h('div', { className: 'tree-wrap' })
  const draw = () => {
    const all = ctx.tab(treeId + '#mode', '') === 'all'
    const build: Build = { ctx, treeId, all, budget: { left: EXPAND_ALL_BUDGET } }
    const tree = h('div', { className: 'tree' })
    const r = resolve(ctx, raw, loc)
    const ancestors = new Set<string>([locKey(r.loc)])
    if (options.header !== false) {
      const head = headerRow(build, r)
      if (head) tree.append(head)
    }
    if (r.stop) {
      tree.append(h('div', { className: 'boxbody' }, stopNote(ctx, r.stop)))
    } else if (isObject(r.schema)) {
      appendChildren(build, tree, r.schema, r.loc, treeId, 0, ancestors)
    } else if (r.schema === false) {
      tree.append(h('div', { className: 'empty-note' }, ctx.t.falseSchema))
    } else if (r.schema === true || r.schema === undefined) {
      tree.append(h('div', { className: 'empty-note' }, ctx.t.anyValue))
    }
    if (all && build.budget.left <= 0) tree.append(h('div', { className: 'note' }, svg(icons.info), format(ctx.t.expandLimit, { n: EXPAND_ALL_DEPTH })))
    wrap.replaceChildren(tree)
  }
  draw()
  ;(wrap as HTMLElement & { redraw?: () => void }).redraw = draw
  return wrap
}

/** The "Expand all / Collapse all" buttons of a tree. */
export function treeTools(ctx: PageCtx, treeId: string, tree: HTMLElement): HTMLElement {
  const redraw = () => (tree as HTMLElement & { redraw?: () => void }).redraw?.()
  return h(
    'div',
    { className: 'ttools' },
    button('tool', [svg(icons.expand)], ctx.t.expandAll, () => {
      ctx.setTab(treeId + '#mode', 'all')
      clearOpen(ctx, treeId)
      redraw()
    }),
    button('tool', [svg(icons.collapse)], ctx.t.collapseAll, () => {
      ctx.setTab(treeId + '#mode', 'none')
      clearOpen(ctx, treeId)
      redraw()
    })
  )
}

function clearOpen(ctx: PageCtx, treeId: string): void {
  ctx.clearOpen(treeId + '/')
}

function headerRow(build: Build, r: Resolved): HTMLElement | null {
  const { ctx } = build
  const schema = r.schema
  const parts: Child[] = []
  if (r.ref) parts.push(refLink(ctx, r.ref, r.loc))
  const type = typeText(ctx, schema, r.loc)
  if (type) parts.push(h('span', { className: 'ttype' }, type))
  if (isObject(schema) && typeof schema.format === 'string') parts.push(h('span', { className: 'sub mono' }, schema.format))
  const info = isObject(schema) ? detailsOf(build, schema, r.loc, { header: true }) : []
  if (parts.length === 0 && info.length === 0) return null
  return h('div', { className: 'trow troot' }, h('span', { className: 'tchev none' }), h('div', { className: 'tmain' }, h('div', { className: 'thead' }, ...parts), ...info))
}

/** Flags, constraints, description, values and discriminator of one schema. */
function detailsOf(build: Build, schema: Record<string, unknown>, loc: Loc, options: { header?: boolean; skipDescription?: boolean } = {}): HTMLElement[] {
  const { ctx } = build
  const out: HTMLElement[] = []
  const cons = constraints(schema)
  if (cons.length > 0) out.push(h('div', { className: 'tcons' }, ...cons.map((c) => h('span', { className: 'cons' }, constraintText(c, ctx.t.constraintWords)))))
  if (!options.skipDescription) {
    const title = str(own(schema, 'title'))
    const desc = markdown(ctx, own(schema, 'description'))
    if (desc) out.push(h('div', { className: 'tdesc' }, desc))
    else if (title && !options.header) out.push(h('div', { className: 'tdesc sub' }, title))
  }
  const values: Child[] = []
  const list = enumValues(schema)
  if (list) {
    values.push(ctx.t.enum + ':')
    for (const v of list.slice(0, 40)) values.push(h('code', null, formatValue(v)))
    if (list.length > 40) values.push(`+${list.length - 40}`)
  }
  if (own(schema, 'const') !== undefined) values.push(ctx.t.const + ':', h('code', null, formatValue(own(schema, 'const'))))
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) values.push(ctx.t.defaultValue + ':', h('code', null, formatValue(own(schema, 'default'))))
  if (values.length > 0) out.push(h('div', { className: 'tvals' }, ...values))
  const examples: unknown[] = []
  if (Object.prototype.hasOwnProperty.call(schema, 'example')) examples.push(own(schema, 'example'))
  const ex = own(schema, 'examples')
  if (Array.isArray(ex)) examples.push(...ex.slice(0, 3))
  if (examples.length > 0) out.push(h('div', { className: 'tvals' }, ctx.t.example + ':', ...examples.map((v) => h('code', null, formatValue(v)))))
  const discriminator = own(schema, 'discriminator')
  if (isObject(discriminator) && typeof discriminator.propertyName === 'string') {
    const row: Child[] = [ctx.t.discriminator + ':', h('code', null, discriminator.propertyName)]
    const mapping = own(discriminator, 'mapping')
    if (isObject(mapping)) {
      for (const value of Object.keys(mapping).slice(0, 30)) {
        const target = mapping[value]
        if (typeof target !== 'string') continue
        const ref = /[#/]/.test(target) ? target : `#/components/schemas/${target}`
        const res = ctx.refs.resolve(ref, loc.doc, false, loc.path)
        row.push(h('span', null, h('code', null, value), ' → ', res.kind === 'local' ? refLink(ctx, ref, res.loc) : h('span', { className: 'mono' }, target)))
      }
    }
    out.push(h('div', { className: 'tvals' }, ...row))
  } else if (typeof discriminator === 'string') {
    out.push(h('div', { className: 'tvals' }, ctx.t.discriminator + ':', h('code', null, discriminator)))
  }
  return out
}

/**
 * Children of a schema: properties (with `allOf` merged), patterns, items, variants… `chain` holds
 * the schemas being flattened into this list, so an array whose items lead back to one of them is
 * shown as an `items` row (a recursive link) instead of being flattened forever.
 */
export function itemsOf(
  build: Pick<Build, 'ctx'>,
  schema: Record<string, unknown>,
  loc: Loc,
  chain: Set<object> = new Set()
): { items: Item[]; variants: { key: 'oneOf' | 'anyOf'; schema: Record<string, unknown>; loc: Loc }[] } {
  const { ctx } = build
  chain.add(schema)
  const t = ctx.t
  const merged = mergedProperties(ctx, schema, loc, new Set(), 0)
  const items = merged.items
  const patterns = own(schema, 'patternProperties')
  if (isObject(patterns)) for (const name of Object.keys(patterns)) items.push({ label: name, role: 'pattern', raw: patterns[name], loc: child(loc, 'patternProperties', name), segment: 'pp:' + name })
  const additional = own(schema, 'additionalProperties')
  if (isObject(additional) || additional === true) items.push({ label: t.additionalProperties, role: 'additional', raw: additional, loc: child(loc, 'additionalProperties'), segment: 'ap' })
  // An array of objects shows the item's properties right under it.
  const array = schemaTypes(schema).includes('array')
  const rawItems = own(schema, 'items')
  if (array && rawItems !== undefined && !Array.isArray(rawItems)) {
    const r = resolve(ctx, rawItems, child(loc, 'items'))
    const inner = isObject(r.schema) ? r.schema : null
    const flat = inner && !r.stop && !r.cycle && !chain.has(inner) && isObject(own(inner, 'properties')) && !Array.isArray(own(inner, 'oneOf')) && !Array.isArray(own(inner, 'anyOf'))
    if (flat && inner) {
      const sub = itemsOf(build, inner, r.loc, chain)
      items.push(...sub.items)
      merged.variants.push(...sub.variants)
    } else items.push({ label: t.items, role: 'role', raw: rawItems, loc: child(loc, 'items'), segment: 'items' })
  } else if (Array.isArray(rawItems)) {
    rawItems.forEach((item, index) => items.push({ label: `${t.prefixItems} ${index}`, role: 'role', raw: item, loc: child(loc, 'items', String(index)), segment: 'pi:' + index }))
  }
  const prefix = own(schema, 'prefixItems')
  if (Array.isArray(prefix)) prefix.forEach((item, index) => items.push({ label: `${t.prefixItems} ${index}`, role: 'role', raw: item, loc: child(loc, 'prefixItems', String(index)), segment: 'pi:' + index }))
  const singles: [string, string][] = [
    ['contains', t.contains],
    ['additionalItems', t.additionalItems],
    ['unevaluatedProperties', t.unevaluatedProperties],
    ['unevaluatedItems', t.unevaluatedItems],
    ['propertyNames', t.propertyNames],
    ['not', t.not],
    ['if', t.if],
    ['then', t.then],
    ['else', t.else]
  ]
  for (const [key, label] of singles) {
    const v = own(schema, key)
    if (v === undefined || v === true) continue
    items.push({ label, role: 'role', raw: v, loc: child(loc, key), segment: key })
  }
  const dependent = own(schema, 'dependentSchemas')
  if (isObject(dependent)) for (const name of Object.keys(dependent)) items.push({ label: format(t.dependentSchemas, { name }), role: 'role', raw: dependent[name], loc: child(loc, 'dependentSchemas', name), segment: 'ds:' + name })
  return { items, variants: merged.variants }
}

function appendChildren(build: Build, parent: HTMLElement, schema: Record<string, unknown>, loc: Loc, id: string, depth: number, ancestors: Set<string>): void {
  const { items, variants } = itemsOf(build, schema, loc)
  const drawItems = (from: number) => {
    const end = Math.min(items.length, from + PAGE)
    for (let i = from; i < end; i++) parent.append(itemNode(build, items[i], id + '/' + items[i].segment, depth, ancestors))
    if (end < items.length) {
      const more = h('div', { className: 'tmore' })
      more.append(
        button('tool on', format(build.ctx.t.showMore, { n: items.length - end }), undefined, () => {
          more.remove()
          drawItems(end)
          for (const v of variants) parent.append(variantBlock(build, v, id, depth, ancestors))
        })
      )
      parent.append(more)
      return true
    }
    return false
  }
  const paged = drawItems(0)
  if (!paged) for (const v of variants) parent.append(variantBlock(build, v, id, depth, ancestors))
  if (items.length === 0 && variants.length === 0 && depth === 0 && schemaTypes(schema).includes('object')) {
    parent.append(h('div', { className: 'empty-note' }, build.ctx.t.noProperties))
  }
}

function hasChildren(build: Build, schema: unknown, loc: Loc): boolean {
  if (!isObject(schema)) return false
  const { items, variants } = itemsOf(build, schema, loc)
  return items.length > 0 || variants.length > 0
}

function itemNode(build: Build, item: Item, id: string, depth: number, ancestors: Set<string>): HTMLElement {
  const { ctx } = build
  const r = resolve(ctx, item.raw, item.loc)
  const node = h('div', { className: 'tnode' })
  const key = locKey(r.loc)
  const recursive = ancestors.has(key) || r.cycle === true
  const schema = isObject(r.schema) ? r.schema : null
  const expandable = !recursive && !r.stop && schema !== null && hasChildren(build, schema, r.loc)
  let open = false
  if (expandable) {
    const byDefault = build.all ? depth < EXPAND_ALL_DEPTH && build.budget.left > 0 : false
    open = ctx.isOpen(id, byDefault)
  }
  if (open && build.all) build.budget.left--
  const chev = h('span', { className: `tchev${expandable ? (open ? ' open' : '') : ' none'}` }, svg(icons.chevron))

  const head: Child[] = []
  if (item.role === 'role' || item.role === 'additional') head.push(h('span', { className: 'tname role' }, item.label))
  else head.push(h('span', { className: 'tname' }, item.label))
  if (r.ref && !recursive) head.push(refLink(ctx, r.ref, r.loc))
  const type = schema ? typeText(ctx, schema, r.loc) : r.schema === true ? ctx.t.any : ''
  if (type && !(r.ref && schemaTypes(schema ?? {}).join() === 'object')) head.push(h('span', { className: 'ttype' }, type))
  if (schema && typeof schema.format === 'string') head.push(h('span', { className: 'sub mono' }, schema.format))
  if (item.required) head.push(h('span', { className: 'req' }, ctx.t.required))
  if (schema?.deprecated === true) head.push(h('span', { className: 'flag dep-chip' }, ctx.t.deprecated))
  if (schema?.readOnly === true) head.push(h('span', { className: 'flag' }, ctx.t.readOnly))
  if (schema?.writeOnly === true) head.push(h('span', { className: 'flag' }, ctx.t.writeOnly))
  if (schema && schemaTypes(schema).includes('null') && own(schema, 'nullable') === true) head.push(h('span', { className: 'flag' }, ctx.t.nullable))
  if (recursive) {
    const target = refTarget(ctx, r.loc)
    const label = format(ctx.t.recursive, { name: r.ref ? refName(r.ref) : item.label })
    head.push(
      target
        ? clickable(h('span', { className: 'tref', title: ctx.t.recursiveHint }, svg(icons.loop), ' ', label), () => ctx.go(target))
        : h('span', { className: 'sub', title: ctx.t.recursiveHint }, label)
    )
  }
  const main = h('div', { className: 'tmain' }, h('div', { className: 'thead' }, ...head))
  if (schema) append(main, ...detailsOf(build, schema, r.loc))
  if (r.stop) main.append(h('div', { className: 'textra' }, stopNote(ctx, r.stop)))
  const row = h('div', { className: 'trow' }, chev, main)
  node.append(row)

  if (expandable && schema) {
    const kids = h('div', { className: 'tkids' })
    let built = false
    const build2 = () => {
      if (built) return
      built = true
      appendChildren(build, kids, schema, r.loc, id, depth + 1, new Set([...ancestors, key]))
    }
    if (open) build2()
    else kids.hidden = true
    node.append(kids)
    const toggle = () => {
      open = !open
      ctx.setOpen(id, open)
      chev.classList.toggle('open', open)
      if (open) build2()
      kids.hidden = !open
    }
    clickable(chev, (event) => {
      event.stopPropagation()
      toggle()
    })
    row.addEventListener('dblclick', toggle)
  }
  return node
}

/** `oneOf` / `anyOf`: variant tabs, and the chosen variant's properties. */
function variantBlock(build: Build, v: { key: 'oneOf' | 'anyOf'; schema: Record<string, unknown>; loc: Loc }, id: string, depth: number, ancestors: Set<string>): HTMLElement {
  const { ctx } = build
  const list = own(v.schema, v.key) as unknown[]
  const discriminator = own(v.schema, 'discriminator')
  const mapping = isObject(discriminator) && isObject(own(discriminator, 'mapping')) ? (own(discriminator, 'mapping') as Record<string, unknown>) : {}
  const labelOf = (raw: unknown, index: number): string => {
    const r = refOf(raw)
    if (r) {
      const byMapping = Object.keys(mapping).find((k) => typeof mapping[k] === 'string' && (mapping[k] === r.ref || (mapping[k] as string).endsWith('/' + refName(r.ref)) || mapping[k] === refName(r.ref)))
      return byMapping ?? refName(r.ref)
    }
    if (isObject(raw)) {
      const title = str(own(raw, 'title'))
      if (title) return title
      const types = schemaTypes(raw)
      if (types.length > 0 && !types.includes('object')) return types.join(' | ')
    }
    return format(ctx.t.option, { n: index + 1 })
  }
  const blockId = `${id}/${v.key}@${v.loc.path.join('/')}`
  const block = h('div', { className: 'tnode' })
  const body = h('div', { className: 'tkids' })
  const show = (value: string) => {
    body.replaceChildren()
    const index = Math.max(0, Math.min(list.length - 1, Number(value) || 0))
    const raw = list[index]
    const at = child(v.loc, v.key, String(index))
    const r = resolve(ctx, raw, at)
    const key = locKey(r.loc)
    if (r.stop) body.append(h('div', { className: 'textra' }, stopNote(ctx, r.stop)))
    else if (ancestors.has(key) || r.cycle) body.append(h('div', { className: 'empty-note' }, format(ctx.t.recursive, { name: labelOf(raw, index) })))
    else if (isObject(r.schema)) {
      const info = detailsOf(build, r.schema, r.loc)
      const type = typeText(ctx, r.schema, r.loc)
      if (r.ref || type || info.length > 0) {
        body.append(
          h(
            'div',
            { className: 'trow' },
            h('span', { className: 'tchev none' }),
            h('div', { className: 'tmain' }, h('div', { className: 'thead' }, r.ref ? refLink(ctx, r.ref, r.loc) : null, type ? h('span', { className: 'ttype' }, type) : null), ...info)
          )
        )
      }
      appendChildren(build, body, r.schema, r.loc, `${blockId}/${index}`, depth + 1, new Set([...ancestors, key]))
    }
  }
  const tabRow = h(
    'div',
    { className: 'thead' },
    h('span', { className: 'tname role' }, v.key === 'oneOf' ? ctx.t.oneOf : ctx.t.anyOf),
    tabsFor(ctx, blockId, list.map((raw, index) => ({ value: String(index), label: labelOf(raw, index) })), show)
  )
  block.append(h('div', { className: 'trow' }, h('span', { className: 'tchev none' }), h('div', { className: 'tmain' }, tabRow)), body)
  show(ctx.tab(blockId, '0'))
  return block
}

function tabsFor(ctx: PageCtx, id: string, options: { value: string; label: string }[], onChange: (value: string) => void): HTMLElement {
  const el = h('div', { className: 'tabs' })
  const current = ctx.tab(id, '0')
  for (const option of options.slice(0, 60)) {
    const tab = button(`tab mono${option.value === current ? ' on' : ''}`, option.label, undefined, () => {
      ctx.setTab(id, option.value)
      for (const other of Array.from(el.children)) other.classList.toggle('on', other === tab)
      onChange(option.value)
    })
    el.append(tab)
  }
  return el
}

/**
 * A schema in one table cell (a parameter, a header): the type line, its details, and the tree
 * below when the schema has properties of its own.
 */
export function schemaInline(ctx: PageCtx, raw: unknown, loc: Loc, id: string): { type: HTMLElement | null; details: HTMLElement[] } {
  const build: Build = { ctx, treeId: id, all: false, budget: { left: EXPAND_ALL_BUDGET } }
  const r = resolve(ctx, raw, loc)
  if (r.stop) return { type: null, details: [stopNote(ctx, r.stop)] }
  const schema = isObject(r.schema) ? r.schema : null
  const parts: Child[] = []
  if (r.ref) parts.push(refLink(ctx, r.ref, r.loc))
  const type = schema ? typeText(ctx, schema, r.loc) : ''
  if (type) parts.push(h('span', { className: 'ptype' }, type))
  if (schema && typeof schema.format === 'string') parts.push(h('span', { className: 'sub mono' }, schema.format))
  const details = schema ? detailsOf(build, schema, r.loc, { skipDescription: true }) : []
  if (schema && !r.cycle && hasChildren(build, schema, r.loc)) details.push(schemaTree(ctx, raw, loc, id, { header: false }))
  return { type: parts.length > 0 ? h('span', { className: 'pflags' }, ...parts) : null, details }
}
