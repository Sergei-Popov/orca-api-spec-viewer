// Pages of OpenAPI 3.x and Swagger 2.0 documents: the overview, a tag, an operation (with code
// samples and examples in a sticky side column on wide tabs), and each kind of component.

import { format } from '../i18n'
import { familyLabel } from '../spec/detect'
import { exampleFromSchema } from '../spec/example'
import { operationServers, operationSecurity, requirementScheme, securitySchemes, shortSummary, type OpenApiModel, type Operation, type ServerInfo, type TagNode } from '../spec/openapi'
import { compareStatus, examplesOf, mediaList, operationDetails, paramView, type BodyView, type ExampleView, type HeaderView, type LinkView, type Located, type MediaView, type OperationDetails, type ParamView, type ResponseView } from '../spec/operation'
import { getAt, isObject, own, str, toPointer } from '../spec/pointer'
import type { Loc } from '../spec/refs'
import { buildRequest, commonNotes, renderSample, sampleLanguages, sampleNotes, shellSafe, type SampleLanguage, type SampleNote } from '../spec/samples'
import {
  banner,
  chip,
  codeBlock,
  cutNote,
  copyButton,
  describe,
  externalDocsEl,
  externalLink,
  jsonBlock,
  kvList,
  markdown,
  methodBadge,
  methodBadgeFull,
  pageLink,
  routeEl,
  sectionTitle,
  statusBadge,
  stopNote,
  tabs,
  valueText,
  valueToText,
  type PageCtx
} from './context'
import { append, clickable, h, svg, type Child } from './dom'
import { icons } from './icons'
import { schemaInline, schemaTree, treeTools } from './schema-view'

// Overview ------------------------------------------------------------------------------------

export function infoHeader(ctx: PageCtx, info: Record<string, unknown>, label: string, version: string): HTMLElement[] {
  const out: HTMLElement[] = []
  out.push(h('div', { className: 'crumbs' }, chip(`${label} · ${version}`)))
  out.push(h('h1', { className: 'h' }, str(own(info, 'title')) ?? ctx.t.appName))
  const meta: Child[] = []
  const apiVersion = own(info, 'version')
  if (apiVersion !== undefined) meta.push(h('span', null, ctx.t.version + ' ', h('span', { className: 'mono' }, String(apiVersion))))
  if (meta.length) out.push(h('div', { className: 'meta' }, ...meta))
  const summary = str(own(info, 'summary'))
  if (summary) out.push(h('p', { className: 'lead' }, summary))
  const description = markdown(ctx, own(info, 'description'), 'md lead')
  if (description) out.push(description)
  const cards = infoCards(ctx, info)
  if (cards) out.push(cards)
  return out
}

function infoCards(ctx: PageCtx, info: Record<string, unknown>): HTMLElement | null {
  const cards: HTMLElement[] = []
  const contact = own(info, 'contact')
  if (isObject(contact)) {
    const lines: Child[] = []
    const name = str(own(contact, 'name'))
    const email = str(own(contact, 'email'))
    const url = str(own(contact, 'url'))
    if (name) lines.push(h('div', null, name))
    if (email) lines.push(h('div', null, externalLink(ctx, 'mailto:' + email, email)))
    if (url) lines.push(h('div', null, externalLink(ctx, url)))
    if (lines.length) cards.push(h('div', { className: 'card' }, h('div', { className: 'k' }, ctx.t.contact), h('div', { className: 'v' }, ...lines)))
  }
  const license = own(info, 'license')
  if (isObject(license)) {
    const name = str(own(license, 'name')) ?? str(own(license, 'identifier')) ?? ''
    const url = str(own(license, 'url'))
    const id = str(own(license, 'identifier'))
    cards.push(h('div', { className: 'card' }, h('div', { className: 'k' }, ctx.t.license), h('div', { className: 'v' }, url ? externalLink(ctx, url, name || url) : name, id && id !== name ? h('span', { className: 'sub mono' }, ' ' + id) : null)))
  }
  const terms = str(own(info, 'termsOfService'))
  if (terms) cards.push(h('div', { className: 'card' }, h('div', { className: 'k' }, ctx.t.terms), h('div', { className: 'v' }, externalLink(ctx, terms))))
  return cards.length ? h('div', { className: 'cards', style: 'margin-top:14px' }, ...cards) : null
}

export function serversBox(ctx: PageCtx, servers: ServerInfo[]): HTMLElement {
  const box = h('div', { className: 'box' })
  servers.forEach((server, index) => {
    const head = h('div', { className: 'boxhead' }, svg(icons.server), routeEl(server.url, 'route'), h('span', { className: 'grow' }), copyButton(ctx, server.resolved, ctx.t.copy))
    if (index > 0) head.style.borderTop = '1px solid var(--soft-border)'
    box.append(head)
    const body: Child[] = []
    if (server.name) body.push(h('div', { className: 'sub' }, server.name))
    const desc = markdown(ctx, server.description)
    if (desc) body.push(desc)
    const names = Object.keys(server.variables)
    if (names.length > 0) body.push(variablesTable(ctx, server.variables))
    if (body.length) box.append(h('div', { className: 'boxbody' }, ...body))
  })
  return box
}

export function variablesTable(ctx: PageCtx, variables: Record<string, Record<string, unknown>>): HTMLElement {
  const table = h('table', { className: 'ptable' })
  for (const name of Object.keys(variables)) {
    const v = variables[name]
    const values = Array.isArray(own(v, 'enum')) ? (own(v, 'enum') as unknown[]) : []
    const cell = h('td', { className: 'pdesc' })
    const desc = markdown(ctx, own(v, 'description'))
    if (desc) cell.append(desc)
    const vals: Child[] = []
    if (own(v, 'default') !== undefined) vals.push(ctx.t.defaultValue + ':', h('code', null, String(own(v, 'default'))))
    if (values.length) vals.push(ctx.t.allowed + ':', ...values.slice(0, 30).map((x) => h('code', null, String(x))))
    if (vals.length) cell.append(h('div', { className: 'tvals' }, ...vals))
    table.append(h('tr', null, h('td', { className: 'name' }, h('span', { className: 'pname' }, `{${name}}`)), cell))
  }
  return table
}

/** Where an API key goes: `header · X-Key`. AsyncAPI's httpApiKey is OpenAPI's apiKey; its own
 * apiKey is sent as the user or password, with no name. */
export function schemeLocation(scheme: Record<string, unknown>): string | null {
  const type = str(own(scheme, 'type'))
  if (type !== 'apiKey' && type !== 'httpApiKey') return null
  return [str(own(scheme, 'in')), str(own(scheme, 'name'))].filter(Boolean).join(' · ') || null
}

/** An OAuth flow's scopes: `scopes` in OpenAPI and AsyncAPI 2, `availableScopes` in AsyncAPI 3. */
export function flowScopes(flow: Record<string, unknown>): unknown {
  return own(flow, 'scopes') ?? own(flow, 'availableScopes')
}

/** AsyncAPI 3: the scopes a server or operation needs, listed on its scheme. */
export function neededScopes(scheme: Record<string, unknown>): string[] {
  const scopes = own(scheme, 'scopes')
  return Array.isArray(scopes) ? scopes.map(String) : []
}

export function securitySchemeCard(ctx: PageCtx, name: string, raw: unknown, loc: Loc): HTMLElement {
  const followed = ctx.refs.follow(raw, loc)
  const scheme = isObject(followed.value) ? followed.value : {}
  const type = str(own(scheme, 'type')) ?? ''
  const pairs: [Child, Child][] = [[ctx.t.type, h('span', { className: 'mono' }, type)]]
  const where = schemeLocation(scheme)
  if (where) pairs.push(['in', h('span', { className: 'mono' }, where)])
  if (type === 'http') {
    pairs.push(['scheme', h('span', { className: 'mono' }, str(own(scheme, 'scheme')) ?? '')])
    if (str(own(scheme, 'bearerFormat'))) pairs.push(['bearerFormat', h('span', { className: 'mono' }, str(own(scheme, 'bearerFormat'))!)])
  }
  if (type === 'openIdConnect') pairs.push(['openIdConnectUrl', externalLink(ctx, str(own(scheme, 'openIdConnectUrl')) ?? '')])
  if (type === 'oauth2' && str(own(scheme, 'flow'))) {
    // Swagger 2.0
    pairs.push(['flow', h('span', { className: 'mono' }, str(own(scheme, 'flow'))!)])
    for (const key of ['authorizationUrl', 'tokenUrl']) if (str(own(scheme, key))) pairs.push([key, externalLink(ctx, str(own(scheme, key))!)])
  }
  const body: Child[] = []
  const desc = markdown(ctx, own(scheme, 'description'))
  if (desc) body.push(desc)
  const kv = kvList(pairs)
  if (kv) body.push(kv)
  const flows = own(scheme, 'flows')
  const scopesOf = (value: unknown): HTMLElement | null => {
    if (!isObject(value) || Object.keys(value).length === 0) return null
    const table = h('table', { className: 'ptable scopes' })
    // Scope names break after ':', '/' or '.', not inside a word.
    const breakable = (scope: string) => scope.split(/(?<=[:/.])/).flatMap((part, i) => (i === 0 ? [part] : [h('wbr'), part]))
    for (const scope of Object.keys(value).slice(0, 200)) table.append(h('tr', null, h('td', { className: 'name' }, h('span', { className: 'pname' }, ...breakable(scope))), h('td', null, String(value[scope] ?? ''))))
    return table
  }
  if (isObject(flows)) {
    for (const flowName of Object.keys(flows)) {
      const flow = flows[flowName]
      if (!isObject(flow)) continue
      const flowPairs: [Child, Child][] = []
      for (const key of ['authorizationUrl', 'deviceAuthorizationUrl', 'tokenUrl', 'refreshUrl']) if (str(own(flow, key))) flowPairs.push([key, externalLink(ctx, str(own(flow, key))!)])
      body.push(h('h3', { className: 'h' }, h('span', { className: 'mono' }, flowName)))
      const fkv = kvList(flowPairs)
      if (fkv) body.push(fkv)
      const scopes = scopesOf(flowScopes(flow))
      if (scopes) body.push(h('div', { className: 'sub', style: 'margin-top:6px' }, ctx.t.scopes), h('div', { className: 'box', style: 'margin-top:4px' }, scopes))
    }
  } else {
    const scopes = Array.isArray(own(scheme, 'scopes')) ? null : scopesOf(own(scheme, 'scopes'))
    if (scopes) body.push(h('div', { className: 'sub', style: 'margin-top:6px' }, ctx.t.scopes), h('div', { className: 'box', style: 'margin-top:4px' }, scopes))
  }
  const needed = neededScopes(scheme)
  if (needed.length > 0) body.push(kvList([[ctx.t.requiredScopes, h('span', { className: 'mono' }, needed.join(', '))]]))
  return h('div', { className: 'box' }, h('div', { className: 'boxhead' }, svg(icons.lock), h('b', null, name)), h('div', { className: 'boxbody' }, ...body))
}

export function openApiOverview(ctx: PageCtx, model: OpenApiModel, version: string): HTMLElement {
  const page = h('div', { className: 'page' })
  append(page, ...infoHeader(ctx, model.info, familyLabel(model.family), version))
  const stats: Child[] = [
    h('span', null, ctx.t.operationCount(model.operations.length)),
    h('span', null, ctx.t.pathCount(model.paths.length)),
    h('span', null, ctx.t.schemaCount(model.components.get('schemas')?.length ?? 0))
  ]
  if (model.webhooks.length > 0) stats.push(h('span', null, `${ctx.t.webhooks}: ${model.webhooks.length}`))
  page.append(h('div', { className: 'meta' }, ...stats))
  const docs = own(model.root, 'externalDocs')
  if (isObject(docs)) page.append(externalDocsEl(ctx, docs))
  const extra: [Child, Child][] = []
  if (str(own(model.root, 'jsonSchemaDialect'))) extra.push([ctx.t.jsonSchemaDialect, h('span', { className: 'mono' }, str(own(model.root, 'jsonSchemaDialect'))!)])
  if (str(own(model.root, '$self'))) extra.push([ctx.t.selfUri, h('span', { className: 'mono' }, str(own(model.root, '$self'))!)])
  const kv = kvList(extra)
  if (kv) page.append(kv)
  if (model.operations.length + model.webhooks.length === 0) page.append(banner('info', model.components.size > 0 ? ctx.t.library : ctx.t.noOperations))

  if (model.servers.length > 0) page.append(sectionTitle(2, ctx.t.servers), serversBox(ctx, model.servers))
  const schemes = securitySchemes(model)
  const schemeNames = Object.keys(schemes)
  if (schemeNames.length > 0) {
    page.append(sectionTitle(2, ctx.t.securitySchemes))
    const base = model.family === 'swagger2' ? ['securityDefinitions'] : ['components', 'securitySchemes']
    const grid = h('div', { className: 'cards', style: 'grid-template-columns:repeat(auto-fill,minmax(320px,1fr))' })
    for (const name of schemeNames) grid.append(securitySchemeCard(ctx, name, schemes[name], { doc: '', path: [...base, name] }))
    page.append(grid)
    const root = operationSecurity(model, { op: {} } as Operation)
    if (root) page.append(h('div', { style: 'margin-top:10px' }, securityLine(ctx, model, root.requirements)))
  }
  const tags = model.tags.filter((t) => t.name !== '' || t.operations.length > 0)
  if (tags.length > 0 && !(tags.length === 1 && tags[0].name === '')) {
    page.append(sectionTitle(2, ctx.t.tags))
    const box = h('div', { className: 'box list' })
    const add = (tag: TagNode, depth: number) => {
      const desc = tag.tag ? str(own(tag.tag, 'description')) : undefined
      const total = countOps(tag)
      box.append(
        clickable(
          h(
            'div',
            { className: 'lrow', style: depth ? `padding-left:${12 + depth * 18}px` : null },
            h('b', null, tag.name === '' ? ctx.t.untagged : tag.title),
            h('span', { className: 'grow sub' }, desc ? firstLineOf(desc) : ''),
            h('span', { className: 'sub' }, ctx.t.operationCount(total))
          ),
          () => ctx.go(tag.key)
        )
      )
      for (const c of tag.children) add(c, depth + 1)
    }
    for (const tag of tags) add(tag, 0)
    page.append(box)
  }
  return page
}

function countOps(tag: TagNode): number {
  return tag.operations.length + tag.children.reduce((n, c) => n + countOps(c), 0)
}

function firstLineOf(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? ''
  const plain = line.replace(/[*_`#>[\]]/g, '').trim()
  return plain.length > 140 ? plain.slice(0, 139) + '…' : plain
}

// Tag page ------------------------------------------------------------------------------------

export function operationList(ctx: PageCtx, ops: Operation[]): HTMLElement {
  const box = h('div', { className: 'box list' })
  for (const op of ops) {
    box.append(
      clickable(
        h(
          'div',
          { className: 'lrow' },
          methodBadge(op.method),
          routeEl(op.route, 'route'),
          h('span', { className: 'grow sub', style: op.deprecated ? 'text-decoration:line-through' : null }, shortSummary(op.summary)),
          op.deprecated ? h('span', { className: 'flag dep-chip' }, ctx.t.deprecated) : null
        ),
        () => ctx.go(op.key)
      )
    )
  }
  return box
}

export function tagPage(ctx: PageCtx, model: OpenApiModel, tag: TagNode): HTMLElement {
  const page = h('div', { className: 'page' })
  page.append(h('div', { className: 'crumbs' }, chip(ctx.t.tags)))
  page.append(h('h1', { className: 'h' }, tag.name === '' ? ctx.t.untagged : tag.title))
  if (tag.title !== tag.name && tag.name) page.append(h('div', { className: 'meta' }, h('span', { className: 'mono' }, tag.name)))
  append(page, ...describe(ctx, tag.tag))
  for (const child of tag.children) {
    append(page, sectionTitle(2, pageLink(ctx, child.key, child.title)), child.operations.length ? operationList(ctx, child.operations) : null)
  }
  if (tag.operations.length > 0) page.append(sectionTitle(2, ctx.t.operations, h('span', { className: 'sub' }, String(tag.operations.length))), operationList(ctx, tag.operations))
  void model
  return page
}

// Operation page ------------------------------------------------------------------------------

function securityLine(ctx: PageCtx, model: OpenApiModel, requirements: Record<string, unknown>[], inherited = false): HTMLElement {
  if (requirements.length === 0) return h('div', { className: 'meta' }, svg(icons.lock), ctx.t.noSecurity)
  const alternatives = requirements.map((req) => {
    const names = Object.keys(req)
    if (names.length === 0) return h('span', { className: 'sub' }, ctx.t.noSecurity)
    const parts: Child[] = []
    names.forEach((name, index) => {
      if (index > 0) parts.push(' + ')
      const scheme = requirementScheme(model, ctx.refs, name)
      const key = scheme.kind === 'local' ? 'c:' + toPointer(scheme.loc.path) : ''
      const scopes = Array.isArray(req[name]) ? (req[name] as unknown[]).filter((s): s is string => typeof s === 'string') : []
      parts.push(key && ctx.titleOf(key) ? pageLink(ctx, key, name, 'link mono') : h('span', { className: 'mono' }, name))
      if (scopes.length) parts.push(h('span', { className: 'sub mono' }, ` (${scopes.join(', ')})`))
    })
    return h('span', null, ...parts)
  })
  const row = h('div', { className: 'meta' }, svg(icons.lock))
  if (alternatives.length > 1) row.append(ctx.t.securityAny)
  alternatives.forEach((alt, index) => {
    if (index > 0) row.append(h('span', { className: 'sub' }, '|'))
    row.append(alt)
  })
  if (inherited) row.append(h('span', { className: 'sub' }, ctx.t.securityInherited))
  return row
}

function paramTable(ctx: PageCtx, params: ParamView[], idBase: string): HTMLElement {
  const table = h('table', { className: 'ptable' })
  for (const p of params) {
    const nameCell = h('td', { className: 'name' }, h('div', { className: 'pname', style: p.deprecated ? 'text-decoration:line-through' : null }, p.name))
    const flags: Child[] = []
    if (p.required) flags.push(h('span', { className: 'req' }, ctx.t.required))
    if (p.deprecated) flags.push(h('span', { className: 'flag dep-chip' }, ctx.t.deprecated))
    if (p.raw.style !== undefined && p.style) flags.push(h('span', { className: 'flag mono' }, `${ctx.t.style}: ${p.style}`))
    if (p.raw.explode !== undefined && p.explode !== undefined) flags.push(h('span', { className: 'flag mono' }, `${ctx.t.explode}: ${p.explode}`))
    if (p.allowReserved) flags.push(h('span', { className: 'flag mono' }, ctx.t.allowReserved))
    if (p.allowEmptyValue) flags.push(h('span', { className: 'flag' }, ctx.t.allowEmpty))
    if (p.collectionFormat) flags.push(h('span', { className: 'flag mono' }, `collectionFormat: ${p.collectionFormat}`))
    if (p.level === 'path') flags.push(h('span', { className: 'flag', title: ctx.t.pathLevelHint }, ctx.t.pathLevel))
    if (flags.length) nameCell.append(h('div', { className: 'pflags' }, ...flags))
    const cell = h('td', { className: 'pdesc' })
    if (p.stop) cell.append(stopNote(ctx, p.stop))
    if (p.schema) {
      const inline = schemaInline(ctx, p.schema.value, p.schema.loc, `${idBase}/${p.in}:${p.name}`)
      if (inline.type) cell.append(inline.type)
      const desc = markdown(ctx, p.description)
      if (desc) cell.append(desc)
      append(cell, ...inline.details)
    } else {
      const desc = markdown(ctx, p.description)
      if (desc) cell.append(desc)
    }
    for (const media of p.content) {
      append(cell, h('div', { className: 'sub mono' }, media.type), media.schema ? schemaTree(ctx, media.schema.value, media.schema.loc, `${idBase}/${p.name}/${media.type}`) : null)
      if (!p.hasExample && p.examples.length === 0) append(cell, exampleLine(ctx, media.examples))
    }
    if (p.hasExample) cell.append(h('div', { className: 'tvals' }, ctx.t.example + ':', h('code', null, valueToText(p.example).slice(0, 300))))
    else append(cell, exampleLine(ctx, p.examples))
    table.append(h('tr', null, nameCell, cell))
  }
  return table
}

/** The first example with something to show: 3.2's serialized form as written, or the value. */
function exampleLine(ctx: PageCtx, examples: ExampleView[]): HTMLElement | null {
  const ex = examples.find((e) => e.serializedValue !== undefined || e.hasValue)
  if (!ex) return null
  const text = ex.serializedValue ?? valueToText(ex.value)
  return h('div', { className: 'tvals' }, ctx.t.example + ':', h('code', null, text.slice(0, 300)))
}

function headerTable(ctx: PageCtx, headers: HeaderView[], idBase: string): HTMLElement {
  const table = h('table', { className: 'ptable' })
  for (const header of headers) {
    const nameCell = h('td', { className: 'name' }, h('div', { className: 'pname' }, header.name))
    const flags: Child[] = []
    if (header.required) flags.push(h('span', { className: 'req' }, ctx.t.required))
    if (header.deprecated) flags.push(h('span', { className: 'flag dep-chip' }, ctx.t.deprecated))
    if (flags.length) nameCell.append(h('div', { className: 'pflags' }, ...flags))
    const cell = h('td', { className: 'pdesc' })
    if (header.stop) cell.append(stopNote(ctx, header.stop))
    if (header.schema) {
      const inline = schemaInline(ctx, header.schema.value, header.schema.loc, `${idBase}/h:${header.name}`)
      if (inline.type) cell.append(inline.type)
      const desc = markdown(ctx, header.description)
      if (desc) cell.append(desc)
      append(cell, ...inline.details)
    } else {
      const desc = markdown(ctx, header.description)
      if (desc) cell.append(desc)
    }
    if (header.hasExample) cell.append(h('div', { className: 'tvals' }, ctx.t.example + ':', h('code', null, valueToText(header.example).slice(0, 300))))
    table.append(h('tr', null, nameCell, cell))
  }
  return table
}

/** One media type's schema with the tree tools, or nothing when it has no schema. */
function mediaSchema(ctx: PageCtx, media: MediaView, id: string): HTMLElement[] {
  const out: HTMLElement[] = []
  const desc = markdown(ctx, media.description)
  if (desc) out.push(h('div', { className: 'boxbody' }, desc))
  // OpenAPI 3.2: itemSchema describes each item of a sequential media type (JSON Lines, server-sent
  // events, …); when the whole content has a schema too, both are shown.
  const parts: [Located | undefined, string | null, string][] = [
    [media.schema, media.itemSchema ? ctx.t.wholeContent : null, id],
    [media.itemSchema, ctx.t.eachItem, `${id}/itemSchema`]
  ]
  for (const [schema, label, key] of parts) {
    if (!schema) continue
    if (label) out.push(h('div', { className: 'boxbody sub' }, label))
    if (schema.stop) out.push(h('div', { className: 'boxbody' }, stopNote(ctx, schema.stop)))
    else out.push(schemaTree(ctx, schema.value, schema.loc, key))
  }
  if (media.encoding && Object.keys(media.encoding).length > 0) {
    const pairs: [Child, Child][] = Object.keys(media.encoding).map((name) => {
      const enc = media.encoding![name]
      const ct = isObject(enc) ? str(own(enc, 'contentType')) : undefined
      return [h('span', { className: 'mono' }, name), h('span', { className: 'mono sub' }, ct ?? '')]
    })
    out.push(h('div', { className: 'boxbody' }, h('div', { className: 'sub' }, ctx.t.encoding), kvList(pairs)))
  }
  return out
}

/** A box whose body switches between media types with tabs in its head. */
function mediaBox(ctx: PageCtx, id: string, head: Child[], media: MediaView[], before: Child[] = []): HTMLElement {
  const box = h('div', { className: 'box' })
  const body = h('div')
  const current = () => media.find((m) => m.type === ctx.tab(id + '#media', media[0]?.type ?? '')) ?? media[0]
  const tools = h('span', { className: 'ttools' })
  const draw = () => {
    body.replaceChildren()
    tools.replaceChildren()
    const m = current()
    if (!m) return
    const parts = mediaSchema(ctx, m, `${id}/${m.type}`)
    const tree = parts.find((p) => p.classList.contains('tree-wrap'))
    if (tree) tools.append(treeTools(ctx, `${id}/${m.type}`, tree))
    append(body, ...parts)
  }
  const headEl = h('div', { className: 'boxhead' }, ...head, h('span', { className: 'grow' }))
  if (media.length === 1) headEl.append(h('span', { className: 'sub mono' }, media[0].type))
  headEl.append(tools)
  box.append(headEl)
  if (media.length > 1) box.append(h('div', { className: 'boxtabs' }, tabs(ctx, id + '#media', media.map((m) => ({ value: m.type, label: m.type, mono: true })), media[0].type, draw)))
  const beforeEls = before.filter(Boolean)
  if (beforeEls.length) box.append(h('div', { className: 'boxbody' }, ...beforeEls))
  box.append(body)
  draw()
  return box
}

function bodySection(ctx: PageCtx, body: BodyView, id: string): HTMLElement[] {
  const out: HTMLElement[] = [sectionTitle(2, ctx.t.requestBody, body.required ? h('span', { className: 'req' }, ctx.t.required) : null)]
  if (body.stop) {
    out.push(stopNote(ctx, body.stop))
    return out
  }
  const before: Child[] = [markdown(ctx, body.description)]
  if (body.formFields.length > 0) {
    const box = h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.locations.formData), h('span', { className: 'grow' }), h('span', { className: 'sub mono' }, body.media.map((m) => m.type).join(', '))), paramTable(ctx, body.formFields, id + '/form'))
    out.push(box)
    return out
  }
  if (body.media.length === 0) {
    out.push(h('div', { className: 'sub' }, ctx.t.noContent))
    return out
  }
  out.push(mediaBox(ctx, id, [], body.media, before))
  return out
}

function responseBox(ctx: PageCtx, r: ResponseView, id: string): HTMLElement {
  const head: Child[] = [statusBadge(r.status)]
  const summary = r.summary ?? firstLineOf(r.description ?? '')
  if (summary) head.push(h('span', { className: 'sub', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:50%' }, summary))
  const before: Child[] = []
  if (r.stop) before.push(stopNote(ctx, r.stop))
  const desc = markdown(ctx, r.description)
  if (desc && (r.summary || (r.description ?? '').trim() !== summary)) before.push(desc)
  if (r.headers.length > 0) before.push(h('div', { className: 'sub', style: 'margin:4px 0' }, ctx.t.headers), h('div', { className: 'box' }, headerTable(ctx, r.headers, id)))
  if (r.links.length > 0) before.push(h('div', { className: 'sub', style: 'margin:8px 0 4px' }, ctx.t.links), linksTable(ctx, r.links))
  if (r.media.length === 0) {
    const box = h('div', { className: 'box' }, h('div', { className: 'boxhead' }, ...head))
    if (before.length) box.append(h('div', { className: 'boxbody' }, ...before))
    return box
  }
  return mediaBox(ctx, id, head, r.media, before)
}

function linksTable(ctx: PageCtx, links: LinkView[]): HTMLElement {
  const box = h('div', { className: 'box' })
  const table = h('table', { className: 'ptable' })
  for (const link of links) {
    const target: Child[] = []
    if (link.operationId) {
      const key = ctx.titleOf('opid:' + link.operationId) ? 'opid:' + link.operationId : null
      target.push(key ? pageLink(ctx, key, link.operationId, 'link mono') : h('span', { className: 'mono' }, link.operationId))
    } else if (link.operationRef) target.push(h('span', { className: 'mono' }, link.operationRef))
    const cell = h('td', { className: 'pdesc' }, h('div', null, ...target))
    const desc = markdown(ctx, link.description)
    if (desc) cell.append(desc)
    if (link.parameters) cell.append(h('div', { className: 'tvals' }, ctx.t.parameters + ':', ...Object.keys(link.parameters).map((k) => h('code', null, `${k}: ${valueToText(link.parameters![k])}`))))
    if (link.stop) cell.append(stopNote(ctx, link.stop))
    table.append(h('tr', null, h('td', { className: 'name' }, h('span', { className: 'pname' }, link.name)), cell))
  }
  box.append(table)
  return box
}

/** The examples to show for a media type: the given ones, else one generated from its schema. */
export interface MediaExample {
  label: string
  text: string
  generated: boolean
  /** The text was cut short: it is shown plain, with a note. */
  cut?: boolean
  external?: string
}

export function mediaExamples(ctx: PageCtx, media: MediaView, mode: 'request' | 'response'): MediaExample[] {
  const out: MediaExample[] = []
  for (const ex of media.examples.slice(0, 20)) {
    if (ex.hasValue) out.push({ label: ex.summary ?? ex.name, ...valueText(ex.value), generated: false })
    else if (ex.serializedValue !== undefined) out.push({ label: ex.summary ?? ex.name, text: ex.serializedValue, generated: false })
    else if (ex.externalValue) out.push({ label: ex.summary ?? ex.name, text: '', generated: false, external: ex.externalValue })
  }
  if (out.length === 0 && isJsonMedia(media.type)) {
    const schema = media.itemSchema ?? media.schema
    if (schema && !schema.stop) {
      const value = exampleFromSchema(ctx.refs, schema.value, schema.loc, { mode })
      if (value !== undefined) out.push({ label: media.itemSchema ? ctx.t.generatedItemExample : ctx.t.generatedExample, ...valueText(value), generated: true })
    }
  }
  return out
}

/** Media types a generated JSON example fits: JSON, `+json`, any, or none given. */
export function isJsonMedia(type: string): boolean {
  return type === '' || /json|^\*\/\*$|^application\/\*$/i.test(type)
}

function exampleBox(ctx: PageCtx, id: string, title: Child, choices: { value: string; label: string; media: MediaView; mode: 'request' | 'response' }[]): HTMLElement | null {
  if (choices.length === 0) return null
  const box = h('div', { className: 'box' })
  const body = h('div')
  const sub = h('div', { className: 'tabs' })
  const copy = copyButton(ctx, () => current?.text ?? '', ctx.t.copyCode)
  let current: { text: string } | null = null
  const drawExample = (choice: (typeof choices)[number]) => {
    const list = mediaExamples(ctx, choice.media, choice.mode)
    sub.replaceChildren()
    const show = (index: number) => {
      const ex = list[index]
      body.replaceChildren()
      current = ex ?? null
      if (!ex) {
        body.append(h('div', { className: 'boxbody sub' }, ctx.t.noContent))
        return
      }
      if (ex.external) body.append(h('div', { className: 'boxbody' }, format(ctx.t.externalExample, { url: '' }), externalLink(ctx, ex.external)))
      else body.append(codeBlock(ex.text, /json|\*\/\*|^$/i.test(choice.media.type) || ex.generated ? 'json' : 'text', ex.cut))
      if (ex.cut) body.append(cutNote(ctx))
      if (ex.generated) body.append(h('div', { className: 'note' }, svg(icons.info), ex.label))
    }
    if (list.length > 1) {
      sub.append(tabs(ctx, id + '#ex:' + choice.value, list.map((ex, index) => ({ value: String(index), label: ex.label })), '0', (v) => show(Number(v))))
      show(Number(ctx.tab(id + '#ex:' + choice.value, '0')) || 0)
    } else show(0)
  }
  const head = h('div', { className: 'boxhead' }, h('b', null, title), h('span', { className: 'grow' }))
  if (choices.length === 1) head.append(h('span', { className: 'sub mono' }, choices[0].label))
  head.append(copy)
  box.append(head)
  if (choices.length > 1) {
    box.append(h('div', { className: 'boxtabs' }, tabs(ctx, id, choices.map((c) => ({ value: c.value, label: c.label, mono: true })), choices[0].value, (v) => drawExample(choices.find((c) => c.value === v) ?? choices[0]))))
  }
  sub.className = 'boxtabs sub-tabs'
  box.append(sub, body)
  const chosen = choices.find((c) => c.value === ctx.tab(id, choices[0].value)) ?? choices[0]
  drawExample(chosen)
  return box
}

function samplesBox(ctx: PageCtx, model: OpenApiModel, op: Operation, details: OperationDetails): HTMLElement {
  const request = buildRequest(model, ctx.refs, op, details)
  const box = h('div', { className: 'box' })
  const available = sampleLanguages(request)
  if (available.length === 0) {
    // A method that is not an HTTP token cannot be sent, and would not be safe to paste.
    box.append(h('div', { className: 'boxhead' }, h('b', null, ctx.t.codeSamples)), h('div', { className: 'note' }, svg(icons.info), h('span', null, format(ctx.t.samplesBadMethod, { method: request.method }))))
    return box
  }
  const code = h('div')
  const languageNotes = h('div')
  const note = (n: SampleNote) => h('div', { className: 'note' }, svg(icons.info), h('span', null, format(ctx.t.sampleNotes[n.key], { method: request.method, ...n.values })))
  let text = ''
  const draw = (lang: string) => {
    const language = (available.includes(lang as SampleLanguage) ? lang : available[0]) as SampleLanguage
    text = renderSample(language, request)
    code.replaceChildren(codeBlock(text, language === 'curl' || language === 'httpie' ? 'shell' : 'js'))
    languageNotes.replaceChildren(...sampleNotes(language, request).map(note))
  }
  const langs = available.map((l) => ({ value: l, label: ctx.t.samples[l] ?? l }))
  const saved = ctx.tab('samples#lang', 'curl')
  const initial = available.includes(saved as SampleLanguage) ? saved : available[0]
  box.append(
    h('div', { className: 'boxhead' }, h('b', null, ctx.t.codeSamples), h('span', { className: 'grow' }), tabs(ctx, 'samples#lang', langs, initial, draw), copyButton(ctx, () => text, ctx.t.copyCode)),
    code,
    languageNotes,
    h('div', { className: 'note' }, svg(icons.info), h('span', null, ctx.t.noNetwork, request.placeholderHost ? ' ' + ctx.t.placeholderHost : ''))
  )
  if (request.placeholders) box.append(h('div', { className: 'note' }, svg(icons.info), h('span', null, format(ctx.t.samplesFillIn, { names: request.placeholders.join(', ') }))))
  if (request.replaced) box.append(h('div', { className: 'note' }, svg(icons.info), h('span', null, ctx.t.samplesReplaced)))
  if (!shellSafe(request)) box.append(h('div', { className: 'note' }, svg(icons.info), h('span', null, ctx.t.samplesNoShell)))
  for (const n of commonNotes(request)) box.append(note(n))
  draw(initial)
  return box
}

export function operationPage(ctx: PageCtx, model: OpenApiModel, op: Operation): HTMLElement {
  const details = operationDetails(model, ctx.refs, op)
  const page = h('div', { className: 'page wide' })
  const main = h('div', { className: 'mainc' })
  const aside = h('div', { className: 'aside' })
  page.append(main, aside)
  const id = op.key

  const crumbs = h('div', { className: 'crumbs' })
  if (op.scope === 'webhook') crumbs.append(chip(ctx.t.webhooks))
  else if (op.scope === 'callback') crumbs.append(chip(ctx.t.callbacks))
  for (const tag of op.tags) crumbs.append(clickable(chip(tag, model.badgeTags.has(tag) ? '' : 'tagchip'), () => ctx.go('tag:' + tag)))
  main.append(crumbs)
  const title = shortSummary(op.summary)
  main.append(h('h1', { className: 'h' }, title || op.operationId || op.route))
  main.append(h('div', { className: 'oprow' }, methodBadgeFull(op.method.toUpperCase()), routeEl(op.route), copyButton(ctx, op.route, ctx.t.copyPath)))
  const meta: Child[] = []
  if (op.operationId) meta.push(h('span', null, ctx.t.operationId + ' ', h('span', { className: 'mono' }, op.operationId)))
  if (op.deprecated) meta.push(h('span', { className: 'chip dep-chip' }, ctx.t.deprecated))
  const line = ctx.lineOf(op.loc)
  if (line) meta.push(clickable(h('a', { className: 'link' }, format(ctx.t.line, { n: line })), () => ctx.showLine(line)))
  if (meta.length) main.append(h('div', { className: 'meta' }, ...meta))
  if (op.deprecated) main.append(banner('warning', ctx.t.deprecated))
  // A summary too long for the title is shown whole, as text.
  if (title && title !== op.summary.trim()) append(main, markdown(ctx, op.summary))
  append(main, ...describe(ctx, op.op))

  const servers = operationServers(model, op)
  if (servers.level !== 'root' && servers.servers.length > 0) main.append(sectionTitle(3, ctx.t.serversOverride), serversBox(ctx, servers.servers))
  const security = operationSecurity(model, op)
  if (security) main.append(securityLine(ctx, model, security.requirements, security.inherited))

  if (details.params.length > 0) {
    main.append(sectionTitle(2, ctx.t.parameters))
    const order = ['path', 'querystring', 'query', 'header', 'cookie']
    const groups = [...new Set(details.params.map((p) => p.in))].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99)
    for (const where of groups) {
      const list = details.params.filter((p) => p.in === where)
      main.append(h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.locations[where] ?? where)), paramTable(ctx, list, `${id}/params`)))
    }
  }
  if (details.body) append(main, ...bodySection(ctx, details.body, `${id}/body`))

  if (details.responses.length > 0) {
    main.append(sectionTitle(2, ctx.t.responses))
    for (const r of details.responses) main.append(responseBox(ctx, r, `${id}/r:${r.status}`))
  } else if (op.scope !== 'webhook') main.append(sectionTitle(2, ctx.t.responses), h('div', { className: 'sub' }, ctx.t.noContent))

  if (details.callbacks.length > 0) {
    main.append(sectionTitle(2, ctx.t.callbacks))
    for (const cb of details.callbacks) {
      const box = h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, cb.name), h('span', { className: 'sub mono', style: 'overflow-wrap:anywhere' }, cb.expression)))
      if (cb.stop) box.append(h('div', { className: 'boxbody' }, stopNote(ctx, cb.stop)))
      if (cb.operations.length) box.append(operationList(ctx, cb.operations))
      main.append(box)
    }
  }

  // The side column: samples, then the request and response examples.
  if (op.scope === 'path') aside.append(samplesBox(ctx, model, op, details))
  const bodyMedia = details.body?.media ?? []
  const req = exampleBox(ctx, `${id}#reqex`, ctx.t.requestBody, bodyMedia.filter((m) => m.examples.length > 0 || isJsonMedia(m.type)).map((m) => ({ value: m.type, label: m.type, media: m, mode: 'request' as const })))
  if (req) aside.append(req)
  const responseChoices: { value: string; label: string; media: MediaView; mode: 'response' }[] = []
  for (const r of details.responses) {
    const m = r.media.find((x) => /json/i.test(x.type)) ?? r.media[0]
    if (m && (m.examples.length > 0 || (isJsonMedia(m.type) && (m.schema || m.itemSchema)))) responseChoices.push({ value: r.status, label: r.status, media: m, mode: 'response' })
  }
  const res = exampleBox(ctx, `${id}#resex`, ctx.t.responses, responseChoices.slice(0, 12))
  if (res) aside.append(res)
  if (aside.children.length === 0) page.className = 'page'
  return page
}

// Components ----------------------------------------------------------------------------------

/** Pages of the components that link here, for "Used by". */
export function usedBy(ctx: PageCtx, loc: Loc): HTMLElement | null {
  if (loc.doc !== '') return null
  const sources = ctx.analysis.usages.get(toPointer(loc.path)) ?? []
  const keys = new Set<string>()
  for (const path of sources) {
    const key = ctx.pageOf({ doc: '', path })
    if (key && key !== ctx.pageKey) keys.add(key)
  }
  const out = h('div')
  out.append(sectionTitle(2, ctx.t.usedBy, keys.size ? h('span', { className: 'sub' }, String(keys.size)) : null))
  if (keys.size === 0) {
    out.append(h('div', { className: 'sub' }, ctx.t.usedNowhere))
    return out
  }
  const box = h('div', { className: 'box list' })
  for (const key of [...keys].slice(0, 300)) {
    const info = ctx.titleOf(key)
    if (!info) continue
    box.append(
      clickable(
        h('div', { className: 'lrow' }, info.method ? methodBadge(info.method) : svg(icons.braces), h('span', { className: 'grow' }, info.title), info.detail ? h('span', { className: 'sub mono' }, info.detail) : null),
        () => ctx.go(key)
      )
    )
  }
  out.append(box)
  return out
}

export function componentPage(ctx: PageCtx, model: OpenApiModel, section: string, name: string, loc: Loc, raw: unknown): HTMLElement {
  const isSchema = section === 'schemas'
  const page = h('div', { className: isSchema ? 'page wide' : 'page' })
  const main = h('div', { className: 'mainc' })
  page.append(main)
  main.append(h('div', { className: 'crumbs' }, chip(ctx.t.sections[section] ?? section)))
  main.append(h('h1', { className: 'h mono', style: 'font-size:20px' }, name))
  const line = ctx.lineOf(loc)
  if (line) main.append(h('div', { className: 'meta' }, clickable(h('a', { className: 'link' }, format(ctx.t.line, { n: line })), () => ctx.showLine(line)), copyButton(ctx, '#' + toPointer(loc.path), ctx.t.copyPointer)))
  const followed = ctx.refs.follow(raw, loc)
  if (followed.stop) main.append(stopNote(ctx, followed.stop))
  const value = followed.value
  const at = followed.loc
  const family = model.family
  const id = 'c:' + toPointer(loc.path)
  switch (section) {
    case 'schemas': {
      if (isObject(value) && own(value, 'deprecated') === true) main.append(banner('warning', ctx.t.deprecated))
      const tree = schemaTree(ctx, raw, loc, id)
      main.append(h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.schema), h('span', { className: 'grow' }), treeTools(ctx, id, tree)), tree))
      const aside = h('div', { className: 'aside' })
      const example = exampleFromSchema(ctx.refs, raw, loc, { mode: 'response' })
      if (example !== undefined) {
        const text = valueToText(example)
        aside.append(h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.example), h('span', { className: 'grow' }), copyButton(ctx, text, ctx.t.copyCode)), codeBlock(text, 'json'), h('div', { className: 'note' }, svg(icons.info), ctx.t.generatedExample)))
      }
      page.append(aside)
      break
    }
    case 'parameters': {
      const p = paramView(ctx.refs, raw, loc, 'operation', family)
      main.append(h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.locations[p.in] ?? p.in)), paramTable(ctx, [p], id)))
      break
    }
    case 'responses': {
      const view = responseFromComponent(ctx, family, raw, loc, name)
      main.append(responseBox(ctx, view, id))
      break
    }
    case 'requestBodies': {
      const v = isObject(value) ? value : {}
      const body: BodyView = { description: str(own(v, 'description')), required: own(v, 'required') === true, media: mediaList(ctx.refs, own(v, 'content'), { doc: at.doc, path: [...at.path, 'content'] }, family), loc: at, formFields: [] }
      append(main, ...bodySection(ctx, body, id))
      break
    }
    case 'headers': {
      const v = isObject(value) ? value : {}
      const schemaRaw = own(v, 'schema')
      const header: HeaderView = {
        name,
        description: str(own(v, 'description')),
        required: own(v, 'required') === true,
        deprecated: own(v, 'deprecated') === true,
        schema: schemaRaw !== undefined ? { value: schemaRaw, loc: { doc: at.doc, path: [...at.path, 'schema'] } } : family === 'swagger2' ? { value: v, loc: at } : undefined,
        content: mediaList(ctx.refs, own(v, 'content'), { doc: at.doc, path: [...at.path, 'content'] }, family),
        example: own(v, 'example'),
        hasExample: Object.prototype.hasOwnProperty.call(v, 'example'),
        loc: at
      }
      main.append(h('div', { className: 'box' }, headerTable(ctx, [header], id)))
      break
    }
    case 'examples': {
      const [ex] = examplesOf(ctx.refs, { [name]: raw }, { doc: loc.doc, path: loc.path.slice(0, -1) })
      if (ex) main.append(exampleView(ctx, ex))
      break
    }
    case 'securitySchemes':
      main.append(securitySchemeCard(ctx, name, raw, loc))
      break
    default: {
      append(main, ...describe(ctx, value))
      main.append(h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.description), h('span', { className: 'grow' }), copyButton(ctx, () => valueToText(value), ctx.t.copyCode)), jsonBlock(ctx, value)))
    }
  }
  const used = usedBy(ctx, loc)
  if (used) main.append(used)
  return page
}

function exampleView(ctx: PageCtx, ex: ExampleView): HTMLElement {
  const box = h('div', { className: 'box' })
  box.append(h('div', { className: 'boxhead' }, h('b', null, ex.summary ?? ex.name), h('span', { className: 'grow' }), ex.hasValue ? copyButton(ctx, () => valueToText(ex.value), ctx.t.copyCode) : null))
  const desc = markdown(ctx, ex.description)
  if (desc) box.append(h('div', { className: 'boxbody' }, desc))
  if (ex.stop) box.append(h('div', { className: 'boxbody' }, stopNote(ctx, ex.stop)))
  if (ex.hasValue) box.append(jsonBlock(ctx, ex.value))
  else if (ex.serializedValue !== undefined) box.append(codeBlock(ex.serializedValue, 'text'))
  if (ex.externalValue) box.append(h('div', { className: 'boxbody' }, externalLink(ctx, ex.externalValue)))
  return box
}

/** A response component as the view an operation shows. */
function responseFromComponent(ctx: PageCtx, family: OpenApiModel['family'], raw: unknown, loc: Loc, name: string): ResponseView {
  // Reuse the operation reader through a tiny stand-in operation with only this response.
  const op = { responses: { [name]: raw } }
  const fake = {
    key: 'tmp',
    scope: 'path' as const,
    route: '',
    method: 'get',
    declared: loc,
    loc: { doc: loc.doc, path: loc.path.slice(0, -2) },
    pathItemLoc: loc,
    op,
    pathItem: {},
    tags: [],
    summary: '',
    deprecated: false
  }
  const model = { family, root: ctx.analysis.parsed.value as Record<string, unknown> } as OpenApiModel
  const details = operationDetails(model, ctx.refs, fake)
  const view = details.responses[0]
  // Point the view at the component itself, not the stand-in's location.
  return { ...view, status: name, loc }
}

export function sortStatuses(list: string[]): string[] {
  return [...list].sort(compareStatus)
}

export function rootValue(ctx: PageCtx, path: string[]): unknown {
  return getAt(ctx.analysis.parsed.value, path)
}
