// Pages of AsyncAPI 2/3 (overview, operation, channel, server, message), Arazzo workflows and
// Overlay actions, and the page for a file that is not an API description.

import { format } from '../i18n'
import { isRuntimeExpression, type ArazzoModel, type ArazzoWorkflow, type OverlayModel } from '../spec/arazzo'
import { asyncSecurityItems, asyncServerList, messagePayload, replyOf, schemaWithFormat, withTraits, type AsyncApiModel, type AsyncChannel, type AsyncMessage, type AsyncOperation, type AsyncServer } from '../spec/asyncapi'
import { familyLabel, type Detection } from '../spec/detect'
import { exampleFromSchema } from '../spec/example'
import { isObject, own, str, toPointer } from '../spec/pointer'
import type { Loc } from '../spec/refs'
import {
  banner,
  chip,
  codeBlock,
  copyButton,
  describe,
  externalDocsEl,
  jsonBlock,
  kvList,
  markdown,
  methodBadge,
  methodBadgeFull,
  pageLink,
  routeEl,
  sectionTitle,
  stopNote,
  tabs,
  valueToText,
  type PageCtx
} from './context'
import { append, clickable, h, svg, type Child } from './dom'
import { icons } from './icons'
import { infoHeader, securitySchemeCard, usedBy, variablesTable } from './openapi-pages'
import { schemaTree, treeTools } from './schema-view'

function child(loc: Loc, ...segments: string[]): Loc {
  return { ...loc, path: [...loc.path, ...segments] }
}

function bindingsBox(ctx: PageCtx, value: unknown): HTMLElement | null {
  if (!isObject(value) || Object.keys(value).length === 0) return null
  const followed = ctx.refs.follow(value, { doc: '', path: [] })
  const box = h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.bindings), h('span', { className: 'grow' }), h('span', { className: 'sub mono' }, Object.keys(isObject(followed.value) ? followed.value : value).join(', '))))
  box.append(jsonBlock(ctx, followed.value))
  return box
}

// AsyncAPI ------------------------------------------------------------------------------------

function serverVars(value: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  const vars = own(value, 'variables')
  if (isObject(vars)) for (const name of Object.keys(vars)) if (isObject(vars[name])) out[name] = vars[name] as Record<string, unknown>
  return out
}

/**
 * A server's or operation's security: referenced schemes by name (linked), 2.x requirements by
 * name with their scopes, and AsyncAPI 3 schemes written inline as cards.
 */
function asyncSecurity(ctx: PageCtx, model: AsyncApiModel, security: unknown, loc: Loc): HTMLElement[] {
  const items = asyncSecurityItems(model.family, security)
  if (items.length === 0) return []
  const names: Child[] = []
  const cards: HTMLElement[] = []
  for (const item of items) {
    if (item.kind === 'ref') {
      const key = item.ref.startsWith('#/') ? 'c:' + item.ref.slice(1) : null
      names.push(key && ctx.titleOf(key) ? pageLink(ctx, key, item.name, 'link mono') : h('span', { className: 'mono' }, item.name))
    } else if (item.kind === 'inline') {
      names.push(h('span', { className: 'mono' }, item.name))
      cards.push(securitySchemeCard(ctx, item.name, item.value, child(loc, String(item.index))))
    } else {
      names.push(h('span', { className: 'mono' }, item.scopes.length ? `${item.name} (${item.scopes.join(', ')})` : item.name))
    }
  }
  const out = [h('div', { className: 'meta' }, svg(icons.lock), ...names)]
  if (cards.length) out.push(h('div', { className: 'cards', style: 'grid-template-columns:repeat(auto-fit,minmax(320px,1fr))' }, ...cards))
  return out
}

function asyncServerBox(ctx: PageCtx, server: AsyncServer): HTMLElement {
  const box = h('div', { className: 'box' })
  box.append(
    h(
      'div',
      { className: 'boxhead' },
      svg(icons.server),
      pageLink(ctx, server.key, h('b', null, server.name)),
      routeEl(server.url, 'route'),
      h('span', { className: 'grow' }),
      server.protocol ? chip(server.protocol + (server.protocolVersion ? ' ' + server.protocolVersion : '')) : null
    )
  )
  const body: Child[] = []
  const desc = markdown(ctx, server.description)
  if (desc) body.push(desc)
  const vars = serverVars(server.value)
  if (Object.keys(vars).length > 0) body.push(variablesTable(ctx, vars))
  if (body.length) box.append(h('div', { className: 'boxbody' }, ...body))
  return box
}

export function asyncOverview(ctx: PageCtx, model: AsyncApiModel, version: string): HTMLElement {
  const page = h('div', { className: 'page' })
  append(page, ...infoHeader(ctx, model.info, familyLabel(model.family), version))
  const stats: Child[] = [h('span', null, ctx.t.operationCount(model.operations.length)), h('span', null, ctx.t.channelCount(model.channels.length))]
  const messages = model.components.get('messages')?.length ?? 0
  if (messages) stats.push(h('span', null, ctx.t.messageCount(messages)))
  page.append(h('div', { className: 'meta' }, ...stats))
  const pairs: [Child, Child][] = []
  if (str(own(model.root, 'defaultContentType'))) pairs.push([ctx.t.defaultContentType, h('span', { className: 'mono' }, str(own(model.root, 'defaultContentType'))!)])
  if (str(own(model.root, 'id'))) pairs.push(['id', h('span', { className: 'mono' }, str(own(model.root, 'id'))!)])
  const kv = kvList(pairs)
  if (kv) page.append(kv)
  const docs = own(model.root, 'externalDocs') ?? own(model.info, 'externalDocs')
  if (isObject(docs)) page.append(externalDocsEl(ctx, docs))
  if (model.servers.length > 0) {
    page.append(sectionTitle(2, ctx.t.servers))
    for (const server of model.servers) page.append(asyncServerBox(ctx, server))
  }
  const schemes = model.components.get('securitySchemes') ?? []
  if (schemes.length > 0) {
    page.append(sectionTitle(2, ctx.t.securitySchemes))
    const grid = h('div', { className: 'cards', style: 'grid-template-columns:repeat(auto-fill,minmax(320px,1fr))' })
    for (const s of schemes) grid.append(securitySchemeCard(ctx, s.name, s.value, s.loc))
    page.append(grid)
  }
  if (model.operations.length > 0) page.append(sectionTitle(2, ctx.t.operations), asyncOperationList(ctx, model.operations))
  return page
}

function asyncOperationList(ctx: PageCtx, ops: AsyncOperation[]): HTMLElement {
  const box = h('div', { className: 'box list' })
  for (const op of ops) {
    box.append(
      clickable(
        h('div', { className: 'lrow' }, methodBadge(op.action), h('span', { className: 'route' }, op.channel?.address ?? op.channel?.id ?? op.channelRef ?? ''), h('span', { className: 'grow sub' }, op.title)),
        () => ctx.go(op.key)
      )
    )
  }
  return box
}

function messageBox(ctx: PageCtx, model: AsyncApiModel, msg: AsyncMessage, id: string): HTMLElement {
  const box = h('div', { className: 'box' })
  const value = msg.value
  const contentType = str(own(value, 'contentType')) ?? str(own(model.root, 'defaultContentType'))
  const title = str(own(value, 'title')) ?? msg.name
  const msgKey = msg.loc.doc === '' && ctx.titleOf('c:' + toPointer(msg.loc.path)) ? 'c:' + toPointer(msg.loc.path) : null
  const tools = h('span', { className: 'ttools' })
  const head = h('div', { className: 'boxhead' }, svg(icons.doc), msgKey ? pageLink(ctx, msgKey, h('b', null, title)) : h('b', null, title), title !== msg.name && msg.name ? h('span', { className: 'sub mono' }, msg.name) : null, h('span', { className: 'grow' }))
  if (contentType) head.append(chip(contentType))
  box.append(head)
  if (msg.stop) {
    box.append(h('div', { className: 'boxbody' }, stopNote(ctx, msg.stop)))
    return box
  }
  const intro: Child[] = []
  const summary = str(own(value, 'summary'))
  if (summary) intro.push(h('div', { className: 'lead' }, summary))
  intro.push(...describe(ctx, value))
  const corr = own(value, 'correlationId')
  if (isObject(corr)) {
    const followed = ctx.refs.follow(corr, child(msg.loc, 'correlationId'))
    if (isObject(followed.value)) intro.push(kvList([[ctx.t.correlationId, h('span', { className: 'mono' }, str(own(followed.value, 'location')) ?? '')]]))
  }
  if (own(value, 'deprecated') === true) intro.push(banner('warning', ctx.t.deprecated))
  if (intro.filter(Boolean).length) box.append(h('div', { className: 'boxbody' }, ...intro))

  // Payload, headers and examples as tabs.
  const shown = messagePayload(value, msg.loc, model.family)
  const payload = shown?.value
  const payloadLoc = shown?.loc ?? child(msg.loc, 'payload')
  const headers = own(value, 'headers')
  const examples = Array.isArray(own(value, 'examples')) ? (own(value, 'examples') as unknown[]).filter(isObject) : []
  const options: { value: string; label: string }[] = []
  if (payload !== undefined) options.push({ value: 'payload', label: ctx.t.payload })
  if (headers !== undefined) options.push({ value: 'headers', label: ctx.t.headers })
  options.push({ value: 'example', label: examples.length ? ctx.t.examples : ctx.t.example })
  const body = h('div')
  const draw = (which: string) => {
    body.replaceChildren()
    tools.replaceChildren()
    if (which === 'payload' || which === 'headers') {
      // AsyncAPI 3 headers may be a Multi Format Schema Object as well.
      const part = which === 'payload' ? shown : model.family === 'asyncapi3' ? schemaWithFormat(headers, child(msg.loc, 'headers')) : undefined
      const raw = which === 'payload' ? payload : (part?.value ?? headers)
      const loc = which === 'payload' ? payloadLoc : (part?.loc ?? child(msg.loc, 'headers'))
      if (part?.format !== undefined) body.append(formatNote(part.format))
      if (part?.source) {
        body.append(...sourceView(ctx, raw, loc, tools))
        return
      }
      const treeId = `${id}/${which}`
      const tree = schemaTree(ctx, raw, loc, treeId)
      tools.append(treeTools(ctx, treeId, tree))
      body.append(tree)
    } else {
      if (examples.length > 0) {
        for (const ex of examples.slice(0, 10)) {
          const name = str(own(ex, 'name')) ?? str(own(ex, 'summary'))
          if (name) body.append(h('div', { className: 'boxbody sub' }, name))
          const shown: Record<string, unknown> = {}
          if (own(ex, 'headers') !== undefined) shown.headers = own(ex, 'headers')
          if (own(ex, 'payload') !== undefined) shown.payload = own(ex, 'payload')
          body.append(jsonBlock(ctx, Object.keys(shown).length === 1 && shown.payload !== undefined ? shown.payload : shown))
        }
      } else if (payload !== undefined && !shown?.source) {
        const generated = exampleFromSchema(ctx.refs, payload, payloadLoc, { mode: 'response' })
        if (generated !== undefined) {
          const text = valueToText(generated)
          tools.append(copyButton(ctx, text, ctx.t.copyCode))
          body.append(codeBlock(text, 'json'), h('div', { className: 'note' }, svg(icons.info), ctx.t.generatedExample))
        } else body.append(h('div', { className: 'boxbody sub' }, ctx.t.noContent))
      } else body.append(h('div', { className: 'boxbody sub' }, ctx.t.noContent))
    }
  }
  const tabBar = h('div', { className: 'boxhead' }, tabs(ctx, id + '#tab', options, options[0].value, draw), h('span', { className: 'grow' }), tools)
  box.append(tabBar, body)
  draw(ctx.tab(id + '#tab', options[0].value))
  const bindings = bindingsBox(ctx, own(value, 'bindings'))
  if (bindings) box.append(h('div', { className: 'boxbody' }, bindings))
  return box
}

export function asyncOperationPage(ctx: PageCtx, model: AsyncApiModel, op: AsyncOperation): HTMLElement {
  const page = h('div', { className: 'page' })
  const crumbs = h('div', { className: 'crumbs' })
  for (const tag of op.tags) crumbs.append(chip(tag))
  page.append(crumbs)
  page.append(h('h1', { className: 'h' }, op.title || op.id))
  const channelLabel = op.channel?.address ?? op.channel?.id ?? op.channelRef ?? ''
  page.append(
    h(
      'div',
      { className: 'oprow' },
      methodBadgeFull((ctx.t.actionNames[op.action] ?? op.action).toUpperCase()),
      op.channel ? clickable(routeEl(channelLabel), () => ctx.go(op.channel!.key)) : routeEl(channelLabel),
      channelLabel ? copyButton(ctx, channelLabel, ctx.t.copyPath) : null
    )
  )
  const meta: Child[] = [h('span', null, 'id ', h('span', { className: 'mono' }, op.id))]
  if (op.deprecated) meta.push(h('span', { className: 'chip dep-chip' }, ctx.t.deprecated))
  const line = ctx.lineOf(op.loc)
  if (line) meta.push(clickable(h('a', { className: 'link' }, format(ctx.t.line, { n: line })), () => ctx.showLine(line)))
  page.append(h('div', { className: 'meta' }, ...meta))
  page.append(banner('info', ctx.t.actionHints[op.action] ?? ''))
  if (op.channelRef && !op.channel) {
    const res = ctx.refs.resolve(op.channelRef)
    if (res.kind !== 'local') page.append(stopNote(ctx, res))
  }
  append(page, ...describe(ctx, op.op))
  append(page, ...asyncSecurity(ctx, model, own(op.op, 'security'), child(op.loc, 'security')))
  if (op.messages.length > 0) {
    page.append(sectionTitle(2, ctx.t.messages, h('span', { className: 'sub' }, String(op.messages.length))))
    op.messages.forEach((m, index) => page.append(messageBox(ctx, model, m, `${op.key}/m${index}`)))
  }
  const reply = replyOf(ctx.refs, model, op)
  if (reply) {
    page.append(sectionTitle(2, ctx.t.reply))
    const pairs: [Child, Child][] = []
    if (reply.address !== undefined) pairs.push([ctx.t.address, h('span', { className: 'mono' }, reply.address)])
    if (reply.channel) pairs.push([ctx.t.channel, pageLink(ctx, reply.channel.key, reply.channel.address ?? reply.channel.id, 'link mono')])
    else if (reply.channelRef) pairs.push([ctx.t.channel, h('span', { className: 'mono' }, reply.channelRef)])
    const kv = kvList(pairs)
    if (kv) page.append(kv)
    // Without messages of its own a reply may be any message of its channel.
    reply.messages.forEach((m, index) => page.append(messageBox(ctx, model, m, `${op.key}/reply${index}`)))
  }
  const bindings = bindingsBox(ctx, own(op.op, 'bindings'))
  if (bindings) page.append(sectionTitle(2, ctx.t.bindings), bindings)
  const traits = own(op.op, 'traits')
  if (Array.isArray(traits) && traits.length > 0) {
    const links = traits.map((trait, index) => {
      const ref = isObject(trait) ? str(own(trait, '$ref')) : undefined
      const name = ref?.split('/').pop() ?? String(index + 1)
      const key = ref?.startsWith('#/') ? 'c:' + ref.slice(1) : null
      return key && ctx.titleOf(key) ? pageLink(ctx, key, name, 'link mono') : h('span', { className: 'mono' }, name)
    })
    page.append(h('div', { className: 'meta' }, ctx.t.traits + ':', ...links))
  }
  return page
}

export function channelPage(ctx: PageCtx, model: AsyncApiModel, channel: AsyncChannel): HTMLElement {
  const page = h('div', { className: 'page' })
  page.append(h('div', { className: 'crumbs' }, chip(ctx.t.channel)))
  page.append(h('h1', { className: 'h' }, str(own(channel.value, 'title')) ?? channel.id))
  if (channel.address !== null) page.append(h('div', { className: 'oprow' }, routeEl(channel.address), copyButton(ctx, channel.address, ctx.t.copyPath)))
  const line = ctx.lineOf(channel.loc)
  if (line) page.append(h('div', { className: 'meta' }, clickable(h('a', { className: 'link' }, format(ctx.t.line, { n: line })), () => ctx.showLine(line))))
  const summary = str(own(channel.value, 'summary'))
  if (summary) page.append(h('p', { className: 'lead' }, summary))
  append(page, ...describe(ctx, channel.value))
  const params = own(channel.value, 'parameters')
  if (isObject(params) && Object.keys(params).length > 0) {
    page.append(sectionTitle(2, ctx.t.parameters))
    const table = h('table', { className: 'ptable' })
    for (const name of Object.keys(params)) {
      const f = ctx.refs.follow(params[name], child(channel.loc, 'parameters', name))
      const p = isObject(f.value) ? f.value : {}
      const cell = h('td', { className: 'pdesc' })
      const desc = markdown(ctx, own(p, 'description'))
      if (desc) cell.append(desc)
      const vals: Child[] = []
      if (Array.isArray(own(p, 'enum'))) vals.push(ctx.t.allowed + ':', ...(own(p, 'enum') as unknown[]).slice(0, 30).map((v) => h('code', null, String(v))))
      if (own(p, 'default') !== undefined) vals.push(ctx.t.defaultValue + ':', h('code', null, String(own(p, 'default'))))
      if (str(own(p, 'location'))) vals.push(ctx.t.location + ':', h('code', null, str(own(p, 'location'))!))
      if (vals.length) cell.append(h('div', { className: 'tvals' }, ...vals))
      if (own(p, 'schema') !== undefined) cell.append(schemaTree(ctx, own(p, 'schema'), child(f.loc, 'schema'), `${channel.key}/p:${name}`))
      if (f.stop) cell.append(stopNote(ctx, f.stop))
      table.append(h('tr', null, h('td', { className: 'name' }, h('span', { className: 'pname' }, `{${name}}`)), cell))
    }
    page.append(h('div', { className: 'box' }, table))
  }
  const servers = asyncServerList(model, own(channel.value, 'servers'))
  if (servers.length > 0) {
    page.append(sectionTitle(2, ctx.t.servers))
    for (const s of servers) page.append(asyncServerBox(ctx, s))
  }
  if (channel.operations.length > 0) page.append(sectionTitle(2, ctx.t.operationsHere), asyncOperationList(ctx, channel.operations))
  if (channel.messages.length > 0) {
    page.append(sectionTitle(2, ctx.t.messages, h('span', { className: 'sub' }, String(channel.messages.length))))
    channel.messages.forEach((m, index) => page.append(messageBox(ctx, model, m, `${channel.key}/m${index}`)))
  }
  const bindings = bindingsBox(ctx, own(channel.value, 'bindings'))
  if (bindings) page.append(sectionTitle(2, ctx.t.bindings), bindings)
  return page
}

export function serverPage(ctx: PageCtx, model: AsyncApiModel, server: AsyncServer): HTMLElement {
  const page = h('div', { className: 'page' })
  page.append(h('div', { className: 'crumbs' }, chip(ctx.t.servers)), h('h1', { className: 'h' }, server.name))
  page.append(asyncServerBox(ctx, server))
  const pairs: [Child, Child][] = []
  if (server.protocol) pairs.push([ctx.t.protocol, h('span', { className: 'mono' }, server.protocol + (server.protocolVersion ? ' ' + server.protocolVersion : ''))])
  if (str(own(server.value, 'host'))) pairs.push([ctx.t.host, h('span', { className: 'mono' }, str(own(server.value, 'host'))!)])
  const kv = kvList(pairs)
  if (kv) page.append(h('div', { style: 'margin-top:12px' }, kv))
  append(page, ...asyncSecurity(ctx, model, own(server.value, 'security'), child(server.loc, 'security')))
  const bindings = bindingsBox(ctx, own(server.value, 'bindings'))
  if (bindings) page.append(sectionTitle(2, ctx.t.bindings), bindings)
  const ops = model.channels.filter((ch) => asyncServerList(model, own(ch.value, 'servers')).includes(server))
  if (ops.length > 0) {
    page.append(sectionTitle(2, ctx.t.channels))
    const box = h('div', { className: 'box list' })
    for (const ch of ops) box.append(clickable(h('div', { className: 'lrow' }, h('span', { className: 'route' }, ch.address ?? ch.id)), () => ctx.go(ch.key)))
    page.append(box)
  }
  return page
}

/** The schemaFormat a payload is written in. */
function formatNote(format: string): HTMLElement {
  return h('div', { className: 'note' }, svg(icons.info), h('span', { className: 'mono' }, format))
}

/**
 * A schema that is not a JSON Schema (Avro, Protobuf, RAML…) as its source: text as it is, an
 * object as JSON, a reference followed; a copy button goes into `tools`.
 */
function sourceView(ctx: PageCtx, raw: unknown, loc: Loc, tools: HTMLElement): HTMLElement[] {
  const followed = ctx.refs.follow(raw, loc)
  if (followed.stop) return [stopNote(ctx, followed.stop)]
  const text = typeof followed.value === 'string' ? followed.value : valueToText(followed.value)
  tools.append(copyButton(ctx, text, ctx.t.copyCode))
  return [typeof followed.value === 'string' ? codeBlock(text, 'text') : jsonBlock(ctx, followed.value)]
}

export function asyncComponentPage(ctx: PageCtx, model: AsyncApiModel, section: string, name: string, loc: Loc, raw: unknown): HTMLElement {
  const page = h('div', { className: 'page' })
  page.append(h('div', { className: 'crumbs' }, chip(ctx.t.sections[section] ?? section)), h('h1', { className: 'h mono', style: 'font-size:20px' }, name))
  const line = ctx.lineOf(loc)
  if (line) page.append(h('div', { className: 'meta' }, clickable(h('a', { className: 'link' }, format(ctx.t.line, { n: line })), () => ctx.showLine(line)), copyButton(ctx, '#' + toPointer(loc.path), ctx.t.copyPointer)))
  const id = 'c:' + toPointer(loc.path)
  const followed = ctx.refs.follow(raw, loc)
  const multi = section === 'schemas' && model.family === 'asyncapi3' ? schemaWithFormat(followed.value, followed.loc) : undefined
  if (multi) {
    // A Multi Format Schema Object: the schema in its format, as a tree or (Avro, …) as source.
    const tools = h('span')
    const body = h('div', null, formatNote(multi.format))
    if (multi.source) append(body, ...sourceView(ctx, multi.value, multi.loc, tools))
    else {
      const tree = schemaTree(ctx, multi.value, multi.loc, id)
      tools.append(treeTools(ctx, id, tree))
      body.append(tree)
    }
    page.append(h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.schema), h('span', { className: 'grow' }), tools), body))
  } else if (section === 'schemas') {
    const tree = schemaTree(ctx, raw, loc, id)
    page.append(h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.schema), h('span', { className: 'grow' }), treeTools(ctx, id, tree)), tree))
  } else if (section === 'messages' || section === 'messageTraits') {
    const value = isObject(followed.value) ? (section === 'messages' ? withTraits(ctx.refs, followed.value, followed.loc, model.family) : followed.value) : {}
    page.append(messageBox(ctx, model, { key: id, name, value, loc: followed.loc, ref: followed.via[0], stop: followed.stop }, id))
  } else if (section === 'securitySchemes') {
    page.append(securitySchemeCard(ctx, name, raw, loc))
  } else {
    if (followed.stop) page.append(stopNote(ctx, followed.stop))
    append(page, ...describe(ctx, followed.value))
    page.append(h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.description), h('span', { className: 'grow' }), copyButton(ctx, () => valueToText(followed.value), ctx.t.copyCode)), jsonBlock(ctx, followed.value)))
  }
  const used = usedBy(ctx, loc)
  if (used) page.append(used)
  return page
}

// Arazzo --------------------------------------------------------------------------------------

export function arazzoOverview(ctx: PageCtx, model: ArazzoModel, version: string): HTMLElement {
  const page = h('div', { className: 'page' })
  append(page, ...infoHeader(ctx, model.info, 'Arazzo', version))
  if (model.sources.length > 0) {
    page.append(sectionTitle(2, ctx.t.sourceDescriptions))
    const table = h('table', { className: 'ptable' })
    for (const s of model.sources) table.append(h('tr', null, h('td', { className: 'name' }, h('span', { className: 'pname' }, s.name), s.type ? h('div', { className: 'pflags' }, chip(s.type)) : null), h('td', null, h('span', { className: 'mono' }, s.url))))
    page.append(h('div', { className: 'box' }, table))
  }
  if (model.workflows.length > 0) {
    page.append(sectionTitle(2, ctx.t.workflows))
    const box = h('div', { className: 'box list' })
    for (const wf of model.workflows) box.append(clickable(h('div', { className: 'lrow' }, h('b', { className: 'mono' }, wf.workflowId), h('span', { className: 'grow sub' }, wf.summary ?? ''), h('span', { className: 'sub' }, ctx.t.stepCount(wf.steps.length))), () => ctx.go(wf.key)))
    page.append(box)
  }
  return page
}

function actionList(ctx: PageCtx, value: unknown): HTMLElement | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const list = h('div', { className: 'tvals' })
  for (const action of value) {
    if (!isObject(action)) continue
    const type = str(own(action, 'type')) ?? ''
    const target = str(own(action, 'stepId')) ?? str(own(action, 'workflowId')) ?? str(own(action, 'reference')) ?? ''
    list.append(h('code', null, [str(own(action, 'name')), type, target].filter(Boolean).join(' · ')))
  }
  return list
}

export function workflowPage(ctx: PageCtx, model: ArazzoModel, wf: ArazzoWorkflow): HTMLElement {
  const page = h('div', { className: 'page' })
  page.append(h('div', { className: 'crumbs' }, chip(ctx.t.workflow)), h('h1', { className: 'h mono' }, wf.workflowId))
  if (wf.summary) page.append(h('p', { className: 'lead' }, wf.summary))
  const desc = markdown(ctx, wf.description)
  if (desc) page.append(desc)
  const depends = own(wf.value, 'dependsOn')
  if (Array.isArray(depends) && depends.length > 0) {
    page.append(
      h(
        'div',
        { className: 'meta' },
        ctx.t.dependsOn + ':',
        ...depends.map((d) => {
          const target = model.workflows.find((w) => w.workflowId === d)
          return target ? pageLink(ctx, target.key, String(d), 'link mono') : h('span', { className: 'mono' }, String(d))
        })
      )
    )
  }
  if (own(wf.value, 'inputs') !== undefined) {
    const id = wf.key + '/inputs'
    const tree = schemaTree(ctx, own(wf.value, 'inputs'), child(wf.loc, 'inputs'), id)
    page.append(sectionTitle(2, ctx.t.inputs), h('div', { className: 'box' }, h('div', { className: 'boxhead' }, h('b', null, ctx.t.schema), h('span', { className: 'grow' }), treeTools(ctx, id, tree)), tree))
  }
  page.append(sectionTitle(2, ctx.t.steps, h('span', { className: 'sub' }, String(wf.steps.length))))
  wf.steps.forEach((step, index) => {
    const box = h('div', { className: 'box', id: 'anchor-' + step.key })
    const target: Child[] = []
    if (step.target) {
      target.push(h('span', { className: 'sub' }, step.target.kind))
      const other = step.target.kind === 'workflowId' ? model.workflows.find((w) => w.workflowId === step.target!.value) : undefined
      target.push(other ? pageLink(ctx, other.key, step.target.value, 'link mono') : h('span', { className: 'mono' }, step.target.value))
    }
    box.append(h('div', { className: 'boxhead' }, h('span', { className: 'chip' }, String(index + 1)), h('b', { className: 'mono' }, step.stepId), h('span', { className: 'grow' }), ...target))
    const body: Child[] = []
    const d = markdown(ctx, step.description)
    if (d) body.push(d)
    const params = own(step.value, 'parameters')
    if (Array.isArray(params) && params.length > 0) {
      const table = h('table', { className: 'ptable' })
      for (const p of params) {
        if (!isObject(p)) continue
        table.append(h('tr', null, h('td', { className: 'name' }, h('span', { className: 'pname' }, str(own(p, 'name')) ?? str(own(p, 'reference')) ?? ''), str(own(p, 'in')) ? h('div', { className: 'pflags' }, h('span', { className: 'flag' }, str(own(p, 'in'))!)) : null), h('td', null, h('code', { className: 'mono' }, paramValue(own(p, 'value'))))))
      }
      body.push(h('div', { className: 'sub' }, ctx.t.parameters), h('div', { className: 'box' }, table))
    }
    if (own(step.value, 'requestBody') !== undefined) body.push(h('div', { className: 'sub', style: 'margin-top:8px' }, ctx.t.requestBody), jsonBlock(ctx, own(step.value, 'requestBody')))
    const criteria = own(step.value, 'successCriteria')
    if (Array.isArray(criteria) && criteria.length > 0) {
      body.push(h('div', { className: 'sub', style: 'margin-top:8px' }, ctx.t.successCriteria), h('div', { className: 'tvals' }, ...criteria.filter(isObject).map((c) => h('code', null, [str(own(c, 'context')), str(own(c, 'condition'))].filter(Boolean).join(' ')))))
    }
    const onSuccess = actionList(ctx, own(step.value, 'onSuccess'))
    if (onSuccess) body.push(h('div', { className: 'sub', style: 'margin-top:8px' }, ctx.t.onSuccess), onSuccess)
    const onFailure = actionList(ctx, own(step.value, 'onFailure'))
    if (onFailure) body.push(h('div', { className: 'sub', style: 'margin-top:8px' }, ctx.t.onFailure), onFailure)
    const outputs = own(step.value, 'outputs')
    if (isObject(outputs)) body.push(h('div', { className: 'sub', style: 'margin-top:8px' }, ctx.t.outputs), kvList(Object.keys(outputs).map((k) => [h('span', { className: 'mono' }, k), h('span', { className: 'mono sub' }, String(outputs[k]))])))
    if (body.length) box.append(h('div', { className: 'boxbody' }, ...body))
    page.append(box)
  })
  const outputs = own(wf.value, 'outputs')
  if (isObject(outputs)) append(page, sectionTitle(2, ctx.t.outputs), kvList(Object.keys(outputs).map((k) => [h('span', { className: 'mono' }, k), h('span', { className: 'mono sub' }, String(outputs[k]))])))
  return page
}

// Overlay -------------------------------------------------------------------------------------

export function overlayOverview(ctx: PageCtx, model: OverlayModel, version: string): HTMLElement {
  const page = h('div', { className: 'page' })
  append(page, ...infoHeader(ctx, model.info, 'Overlay', version))
  if (model.extends) page.append(kvList([[ctx.t.extends, h('span', { className: 'mono' }, model.extends)]])!)
  page.append(sectionTitle(2, ctx.t.actions, h('span', { className: 'sub' }, String(model.actions.length))))
  for (const action of model.actions) {
    const box = h('div', { className: 'box', id: 'anchor-' + action.key })
    box.append(h('div', { className: 'boxhead' }, methodBadge(ctx.t.overlayKinds[action.kind] ?? action.kind), h('span', { className: 'route', style: 'font-size:12.5px' }, action.target), h('span', { className: 'grow' }), copyButton(ctx, action.target, ctx.t.copy)))
    const body: Child[] = []
    const d = markdown(ctx, action.description)
    if (d) body.push(d)
    if (own(action.value, 'copy') !== undefined) body.push(kvList([[ctx.t.copyFrom, h('span', { className: 'mono' }, String(own(action.value, 'copy')))]]))
    if (body.length) box.append(h('div', { className: 'boxbody' }, ...body))
    if (own(action.value, 'update') !== undefined) box.append(jsonBlock(ctx, own(action.value, 'update')))
    page.append(box)
  }
  return page
}

// Not an API description ----------------------------------------------------------------------

export function notSpecPage(ctx: PageCtx, detection: Extract<Detection, { spec: false }>): HTMLElement {
  if (detection.other === 'empty') {
    return h('div', { className: 'center' }, h('div', { className: 'state' }, h('div', { className: 'big' }, svg(icons.doc)), h('h1', null, ctx.t.emptyTitle), h('p', null, ctx.t.emptyBody)))
  }
  const kind = format(ctx.t.otherKinds[detection.other] ?? ctx.t.otherKinds.object, { field: detection.field ?? '', version: detection.version ?? '' })
  return h(
    'div',
    { className: 'center' },
    h(
      'div',
      { className: 'state' },
      h('div', { className: 'big' }, svg(icons.file)),
      h('h1', null, ctx.t.notSpecTitle),
      h('p', null, format(ctx.t.notSpecBody, { kind })),
      h('p', null, ctx.t.notSpecHint)
    )
  )
}

/** A step parameter's value: a runtime expression as written, anything else as JSON (`"text"`, `1`). */
function paramValue(value: unknown): string {
  return (isRuntimeExpression(value) ? value : valueToText(value)).slice(0, 300)
}
