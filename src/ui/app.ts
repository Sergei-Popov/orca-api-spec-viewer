// The viewer: toolbar, sidebar, page, problems panel, source view and search. It keeps its state
// (page, history, open groups and tree nodes, tabs, scroll positions) across live updates of the
// file, so an outside edit redraws in place.

import { analyze, type Analysis } from '../analyze'
import { format, problemMessage, type Strings } from '../i18n'
import { compareSeverity, type Problem, type Severity } from '../lint/index'
import type { MarkdownHost } from '../markdown/render'
import { parseText } from '../parse/index'
import { familyLabel } from '../spec/detect'
import { operationDetails } from '../spec/operation'
import type { Operation } from '../spec/openapi'
import { fragmentToPath, isObject, own, parsePointer, str, toPointer } from '../spec/pointer'
import type { Loc } from '../spec/refs'
import { ancestorsOf, defaultExpanded, flattenNav, navTree, pageFor, pageIndex, type NavLabels, type NavNode, type NavRow } from '../view/nav'
import { buildSearchIndex, search, type SearchEntry, type SearchHit } from '../view/search'
import { banner, chip, methodBadge, type PageCtx } from './context'
import { append, button, clickable, copyText, h, highlight, svg } from './dom'
import { icons } from './icons'
import { componentPage, openApiOverview, operationPage, tagPage } from './openapi-pages'
import { arazzoOverview, asyncComponentPage, asyncOperationPage, asyncOverview, channelPage, notSpecPage, overlayOverview, serverPage, workflowPage } from './other-pages'
import { VirtualList } from './virtual'

export interface AppHost {
  locale: string
  openExternal?: (url: string) => Promise<{ opened: boolean; reason?: string }>
}

interface Route {
  key: string
  anchor?: string
  line?: number
  scroll?: number
}

interface ProblemRow {
  problem: Problem
  line: number
  column: number
  message: string
  pointer: string
}

const LARGE = 4 * 1024 * 1024

export class App {
  readonly root: HTMLElement
  private readonly t: Strings
  // Layout
  private readonly bar: HTMLElement
  private readonly titleEl: HTMLElement
  private readonly backBtn: HTMLButtonElement
  private readonly fwdBtn: HTMLButtonElement
  private readonly sideBtn: HTMLButtonElement
  private readonly searchBtn: HTMLElement
  private readonly problemsBtn: HTMLButtonElement
  private readonly sourceBtn: HTMLButtonElement
  private readonly side: HTMLElement
  private readonly filterInput: HTMLInputElement
  private readonly pathsBtn: HTMLButtonElement
  private readonly nav: VirtualList<NavRow>
  private readonly navEmpty: HTMLElement
  private readonly main: HTMLElement
  private readonly content: HTMLElement
  private readonly panel: HTMLElement
  private readonly problemList: VirtualList<ProblemRow>
  private readonly panelHead: HTMLElement
  private readonly toastEl: HTMLElement
  private readonly fileInput: HTMLInputElement
  private overlay: HTMLElement | null = null
  private dropzone: HTMLElement | null = null
  private toastTimer = 0
  // Document
  private text: string | null = null
  private analysis: Analysis | null = null
  private tree: NavNode[] = []
  private rows: NavRow[] = []
  private expanded = new Set<string>()
  private expandedSet = false
  private index = new Map<string, string>()
  private ancestors = new Map<string, string[]>()
  private titles = new Map<string, { title: string; method?: string; detail?: string }>()
  private operations = new Map<string, Operation>()
  private operationIds = new Map<string, string>()
  private searchEntries: SearchEntry[] | null = null
  private documents = new Map<string, unknown>()
  private problemRows: ProblemRow[] = []
  private visibleProblems: ProblemRow[] = []
  // View state
  private route: Route = { key: 'overview' }
  private history: Route[] = []
  private future: Route[] = []
  private filter = ''
  private showPaths = false
  private sidebarOpen = true
  private panelOpen = false
  private panelTouched = false
  private severities = new Set<Severity>(['error', 'warning', 'info'])
  private problemFilter = ''
  private selectedProblem = -1
  private focusRow = -1
  private readonly openState = new Map<string, boolean>()
  private readonly tabState = new Map<string, string>()
  private lastQuery = ''

  constructor(private readonly host: AppHost, strings: Strings) {
    this.t = strings
    const t = strings
    this.backBtn = button('tool', svg(icons.back), t.back, () => this.back())
    this.fwdBtn = button('tool', svg(icons.forward), t.forward, () => this.forward())
    this.sideBtn = button('tool on', svg(icons.sidebar), t.toggleSidebar, () => this.toggleSidebar())
    this.titleEl = h('div', { className: 'title' })
    this.searchBtn = clickable(h('div', { className: 'searchbox' }, svg(icons.search), h('span', null, t.search), h('span', { className: 'kbd' }, isMac() ? '⌘F' : 'Ctrl+F')), () => this.openSearch(), t.searchHint)
    this.problemsBtn = button('tool', [svg(icons.ok)], t.problemsHint, () => this.togglePanel())
    this.sourceBtn = button('tool', [svg(icons.code)], t.sourceHint, () => (this.route.key === 'source' ? this.back() : this.go('source')))
    this.bar = h('div', { className: 'bar' }, this.sideBtn, this.backBtn, this.fwdBtn, this.titleEl, h('span', { className: 'spacer' }), this.searchBtn, this.problemsBtn, this.sourceBtn)

    this.filterInput = h('input', { className: 'input', type: 'search', placeholder: t.filter, 'aria-label': t.filterHint, title: t.filterHint, spellcheck: 'false' })
    this.filterInput.addEventListener('input', () => {
      this.filter = this.filterInput.value
      this.focusRow = -1
      this.refreshNav()
    })
    this.filterInput.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        this.focusRow = 0
        this.nav.el.focus()
        this.nav.refresh()
      } else if (event.key === 'Enter') {
        const first = this.rows.find((r) => r.node.kind === 'item' && r.node.key)
        if (first?.node.key) this.go(first.node.key)
      } else if (event.key === 'Escape' && this.filterInput.value) {
        event.stopPropagation()
        this.filterInput.value = ''
        this.filter = ''
        this.refreshNav()
      }
    })
    this.pathsBtn = button('tool', svg(icons.list), t.showPaths, () => {
      this.showPaths = !this.showPaths
      this.pathsBtn.classList.toggle('on', this.showPaths)
      this.pathsBtn.title = this.showPaths ? t.showSummaries : t.showPaths
      this.nav.refresh()
    })
    this.nav = new VirtualList<NavRow>({ rowHeight: 26, render: (row, index) => this.navRow(row, index) })
    this.nav.el.tabIndex = 0
    this.nav.el.setAttribute('role', 'tree')
    this.nav.el.addEventListener('keydown', (event) => this.navKey(event))
    this.navEmpty = h('div', { className: 'empty-note', hidden: true })
    this.side = h('div', { className: 'side' }, h('div', { className: 'sidefilter' }, this.filterInput, this.pathsBtn), this.navEmpty, this.nav.el)

    this.content = h('div', { className: 'content', tabindex: '-1' })
    this.problemList = new VirtualList<ProblemRow>({ rowHeight: 28, render: (row, index) => this.problemRow(row, index) })
    this.panelHead = h('div', { className: 'panelhead' })
    this.panel = h('div', { className: 'panel', hidden: true }, this.panelHead, this.problemList.el)
    this.main = h('div', { className: 'mainwrap' }, this.content, this.panel)
    this.toastEl = h('div', { className: 'toast', role: 'status' })
    this.fileInput = h('input', { type: 'file', multiple: true, accept: '.yaml,.yml,.json,.jsonc,application/json,application/yaml,text/yaml', hidden: true })
    this.fileInput.addEventListener('change', () => {
      const files = Array.from(this.fileInput.files ?? [])
      this.fileInput.value = ''
      void this.addFiles(files)
    })
    this.root = h('div', { className: 'app' }, this.bar, h('div', { className: 'body' }, this.side, this.main), this.toastEl, this.fileInput)

    document.addEventListener('keydown', (event) => this.globalKey(event))
    document.addEventListener('mouseup', (event) => {
      if (event.button === 3) this.back()
      else if (event.button === 4) this.forward()
    })
    this.root.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      if (!this.dropzone) {
        this.dropzone = h('div', { className: 'dropzone' }, svg(icons.upload), '\u00a0', this.t.dropHint)
        this.root.append(this.dropzone)
      }
    })
    this.root.addEventListener('dragleave', (event) => {
      if (event.target === this.dropzone || !this.root.contains(event.relatedTarget as Node)) this.hideDrop()
    })
    this.root.addEventListener('drop', (event) => {
      event.preventDefault()
      this.hideDrop()
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length) void this.addFiles(files)
    })
    this.updateBar()
  }

  // Loading -----------------------------------------------------------------------------------

  showLoading(size = 0): void {
    this.content.replaceChildren(h('div', { className: 'center' }, h('div', { className: 'state' }, h('div', { className: 'spinner' }), size > LARGE ? format(this.t.loadingLarge, { size: formatSize(size, this.host.locale) }) : this.t.loading)))
  }

  showMessage(title: string, body: string): void {
    this.content.replaceChildren(h('div', { className: 'center' }, h('div', { className: 'state' }, h('div', { className: 'big' }, svg(icons.warning)), h('h1', null, title), h('p', null, body))))
  }

  /** A new text of the file: analyse it and redraw, keeping the page, scroll and open parts. */
  load(text: string): void {
    if (text === this.text) return
    const first = this.text === null
    const scroll = this.content.scrollTop
    const navScroll = this.nav.scrollTop
    this.text = text
    const started = performance.now()
    this.analysis = analyze(text, this.documents)
    const a = this.analysis
    console.info(`[api-spec-viewer] ${a.parsed.format}, ${(text.length / 1048576).toFixed(1)} MiB: parse ${Math.round(a.timings.parse)} ms, model ${Math.round(a.timings.model)} ms, lint ${Math.round(a.timings.lint)} ms, ${a.problems.length} problems; total ${Math.round(performance.now() - started)} ms`)
    this.rebuild()
    if (!this.panelTouched) this.panelOpen = this.shouldOpenPanel()
    if (!this.pageExists(this.route.key)) this.route = { key: 'overview' }
    this.updateBar()
    this.renderPanel()
    this.render(first ? undefined : scroll)
    if (!first) this.nav.scrollTop = navScroll
  }

  private shouldOpenPanel(): boolean {
    const a = this.analysis
    if (!a) return false
    return a.problems.some((p) => p.rule === 'syntax' && p.severity === 'error') || (a.detection.spec && !isObject(a.parsed.value))
  }

  private rebuild(): void {
    const a = this.analysis!
    const t = this.t
    const labels: NavLabels = {
      overview: t.overview,
      operations: t.operations,
      webhooks: t.webhooks,
      untagged: t.untagged,
      servers: t.servers,
      channels: t.channels,
      messages: t.messages,
      workflows: t.workflows,
      actions: t.actions,
      section: (name) => t.sections[name] ?? name
    }
    this.tree = navTree(a.model, labels)
    if (!this.expandedSet) {
      this.expanded = defaultExpanded(this.tree)
      this.expandedSet = true
    }
    this.index = pageIndex(a.model)
    this.ancestors = ancestorsOf(this.tree)
    this.titles.clear()
    this.operations.clear()
    this.operationIds.clear()
    const walk = (nodes: NavNode[]) => {
      for (const node of nodes) {
        if (node.key && !this.titles.has(node.key)) this.titles.set(node.key, { title: node.label, method: node.method, detail: node.detail })
        if (node.children) walk(node.children)
      }
    }
    walk(this.tree)
    if (a.model?.kind === 'openapi') {
      for (const op of [...a.model.model.operations, ...a.model.model.webhooks]) {
        this.operations.set(op.key, op)
        if (op.operationId && !this.operationIds.has(op.operationId)) this.operationIds.set(op.operationId, op.key)
        this.titles.set(op.key, { title: op.summary || op.route, method: op.method, detail: op.summary ? op.route : op.operationId })
      }
      for (const tag of flatTags(a.model.model.tags)) if (!this.titles.has(tag.key)) this.titles.set(tag.key, { title: tag.title })
    }
    this.searchEntries = null
    this.problemRows = a.problems.map((problem) => {
      const position = problem.offset !== undefined ? a.parsed.lines.position(problem.offset) : a.parsed.position(problem.path)
      return { problem, line: position?.line ?? 0, column: position?.column ?? 0, message: problemMessage(this.t, problem), pointer: problem.path.length ? '#' + toPointer(problem.path) : '' }
    })
    this.problemRows.sort((x, y) => x.line - y.line || compareSeverity(x.problem.severity, y.problem.severity))
    this.refreshNav()
  }

  // Routing -----------------------------------------------------------------------------------

  /** A key that stands for another page: an operationId, a step, an Overlay action. */
  private resolveKey(key: string): { key: string; anchor?: string } {
    if (key.startsWith('opid:')) return { key: this.operationIds.get(key.slice(5)) ?? 'overview' }
    if (key.startsWith('step:')) {
      const model = this.analysis?.model
      if (model?.kind === 'arazzo') {
        const wf = model.model.workflows.find((w) => w.steps.some((s) => s.key === key))
        if (wf) return { key: wf.key, anchor: key }
      }
    }
    if (key.startsWith('act:')) return { key: 'overview', anchor: key }
    return { key }
  }

  private pageExists(key: string): boolean {
    if (key === 'overview' || key === 'source') return true
    return this.titles.has(key) || !!this.findOperation(key)
  }

  go(key: string, anchor?: string, line?: number): void {
    const target = this.resolveKey(key)
    this.history.push({ ...this.route, scroll: this.content.scrollTop })
    if (this.history.length > 200) this.history.shift()
    this.future = []
    this.route = { key: target.key, anchor: anchor ?? target.anchor, line }
    this.render()
    this.reveal(target.key, true)
    this.updateBar()
  }

  private back(): void {
    const previous = this.history.pop()
    if (!previous) return
    this.future.push({ ...this.route, scroll: this.content.scrollTop })
    this.route = previous
    this.render(previous.scroll)
    this.reveal(previous.key, false)
    this.updateBar()
  }

  private forward(): void {
    const next = this.future.pop()
    if (!next) return
    this.history.push({ ...this.route, scroll: this.content.scrollTop })
    this.route = next
    this.render(next.scroll)
    this.reveal(next.key, false)
    this.updateBar()
  }

  /** Opens the groups above a page and scrolls its row into view. */
  private reveal(key: string, scroll: boolean): void {
    const chain = this.ancestors.get(key)
    let changed = false
    if (chain) {
      for (const id of chain) {
        if (!this.expanded.has(id)) {
          this.expanded.add(id)
          changed = true
        }
      }
    }
    if (changed) this.refreshNav()
    else this.nav.refresh()
    if (scroll) {
      const index = this.rows.findIndex((r) => r.node.key === key)
      if (index >= 0) this.nav.scrollToIndex(index, 'nearest')
    }
  }

  private findOperation(key: string): Operation | null {
    const known = this.operations.get(key)
    if (known) return known
    const a = this.analysis
    if (!key.startsWith('op:') || a?.model?.kind !== 'openapi') return null
    // A callback's operation: find it through the operation that declares the callback.
    const pointer = key.slice(3)
    const path = parsePointer(pointer)
    if (!path) return null
    const parentKey = pageFor(this.index, path)
    const parent = this.operations.get(parentKey)
    if (!parent) return null
    for (const cb of operationDetails(a.model.model, a.refs, parent).callbacks) {
      const op = cb.operations.find((o) => o.key === key)
      if (op) {
        this.operations.set(op.key, op)
        this.titles.set(op.key, { title: op.summary || op.route, method: op.method, detail: op.route })
        return op
      }
    }
    return null
  }

  // Rendering ---------------------------------------------------------------------------------

  private ctx(pageKey: string): PageCtx {
    const a = this.analysis!
    const md: MarkdownHost = {
      openExternal: (url) => this.openExternal(url),
      openFragment: (fragment) => this.openFragment(fragment),
      imageLabel: this.t.image
    }
    return {
      t: this.t,
      locale: this.host.locale,
      analysis: a,
      refs: a.refs,
      pageKey,
      md,
      go: (key, anchor) => this.go(key, anchor),
      goLoc: (loc) => this.go(this.pageOfLoc(loc) ?? 'overview'),
      pageOf: (loc) => this.pageOfLoc(loc),
      showLine: (line) => this.go('source', undefined, line),
      lineOf: (loc) => (loc.doc === '' ? (a.parsed.position(loc.path)?.line ?? null) : null),
      copy: (text) => void this.copy(text),
      isOpen: (id, byDefault) => this.openState.get(id) ?? byDefault,
      setOpen: (id, open) => this.openState.set(id, open),
      clearOpen: (prefix) => {
        for (const id of [...this.openState.keys()]) if (id.startsWith(prefix)) this.openState.delete(id)
      },
      tab: (id, fallback) => this.tabState.get(id) ?? fallback,
      setTab: (id, value) => this.tabState.set(id, value),
      loadFile: () => this.fileInput.click(),
      redraw: () => this.render(this.content.scrollTop),
      titleOf: (key) => {
        if (key.startsWith('opid:')) {
          const opKey = this.operationIds.get(key.slice(5))
          return opKey ? (this.titles.get(opKey) ?? null) : null
        }
        return this.titles.get(key) ?? null
      }
    }
  }

  private pageOfLoc(loc: Loc): string | null {
    if (loc.doc !== '') return null
    const key = pageFor(this.index, loc.path)
    return key
  }

  private render(scroll?: number): void {
    const a = this.analysis
    if (!a) return
    const key = this.route.key
    let page: HTMLElement
    try {
      page = key === 'source' ? this.sourcePage() : this.page(key)
    } catch (error) {
      console.error('[api-spec-viewer] cannot draw the page', key, error)
      page = h('div', { className: 'page' }, banner('error', String(error instanceof Error ? error.message : error)))
    }
    const notices = this.notices()
    if (notices && key !== 'source') page.prepend(notices)
    this.content.replaceChildren(page)
    this.content.classList.toggle('srcmode', key === 'source')
    this.content.style.overflow = key === 'source' ? 'hidden' : ''
    if (scroll !== undefined) this.content.scrollTop = scroll
    else if (this.route.anchor) {
      const el = this.content.querySelector<HTMLElement>(`[id="anchor-${cssEscape(this.route.anchor)}"]`)
      if (el) {
        el.scrollIntoView({ block: 'start' })
        el.classList.add('flash')
      }
    } else this.content.scrollTop = 0
    this.sourceBtn.classList.toggle('on', key === 'source')
  }

  /** Banners above every page: syntax errors, a newer version than known. */
  private notices(): HTMLElement | null {
    const a = this.analysis!
    const wrap = h('div', { className: 'notices' })
    const syntax = this.problemRows.find((r) => r.problem.rule === 'syntax' && r.problem.severity === 'error')
    if (syntax && isObject(a.parsed.value)) {
      wrap.append(
        banner(
          'error',
          h('b', null, this.t.damagedTitle),
          ' ',
          format(this.t.damagedBody, { line: syntax.line }),
          ' ',
          clickable(h('a', { className: 'link' }, format(this.t.line, { n: syntax.line })), () => this.go('source', undefined, syntax.line))
        )
      )
    }
    if (a.detection.spec && a.detection.newer) {
      wrap.append(banner('info', format(this.t.newerVersion, { name: kindName(a.detection.kind), version: a.detection.version, shown: familyLabel(a.detection.family) })))
    }
    return wrap.children.length ? wrap : null
  }

  private page(key: string): HTMLElement {
    const a = this.analysis!
    const ctx = this.ctx(key)
    const d = a.detection
    if (!isObject(a.parsed.value) && a.problems.some((p) => p.rule === 'syntax')) {
      const first = this.problemRows.find((r) => r.problem.rule === 'syntax')
      return h(
        'div',
        { className: 'center' },
        h(
          'div',
          { className: 'state' },
          h('div', { className: 'big' }, svg(icons.error)),
          h('h1', null, this.t.unreadableTitle),
          h('p', null, first ? `${first.message} (${format(this.t.line, { n: first.line })})` : ''),
          first ? button('tool on', [svg(icons.code), this.t.source], undefined, () => this.go('source', undefined, first.line)) : null
        )
      )
    }
    if (!d.spec) return notSpecPage(ctx, d)
    const model = a.model
    if (!model) return h('div')
    const version = d.version
    if (model.kind === 'openapi') {
      const m = model.model
      if (key === 'overview') return openApiOverview(ctx, m, version)
      if (key.startsWith('tag:')) {
        const tag = flatTags(m.tags).find((t) => t.key === key)
        if (tag) return tagPage(ctx, m, tag)
      }
      const op = this.findOperation(key)
      if (op) return operationPage(ctx, m, op)
      for (const [section, entries] of m.components) {
        const entry = entries.find((e) => e.key === key)
        if (entry) return componentPage(ctx, m, section, entry.name, entry.loc, entry.value)
      }
      return openApiOverview(ctx, m, version)
    }
    if (model.kind === 'asyncapi') {
      const m = model.model
      const op = m.operations.find((o) => o.key === key)
      if (op) return asyncOperationPage(ctx, m, op)
      const ch = m.channels.find((c) => c.key === key)
      if (ch) return channelPage(ctx, m, ch)
      const srv = m.servers.find((s) => s.key === key)
      if (srv) return serverPage(ctx, m, srv)
      for (const [section, entries] of m.components) {
        const entry = entries.find((e) => e.key === key)
        if (entry) return asyncComponentPage(ctx, m, section, entry.name, entry.loc, entry.value)
      }
      return asyncOverview(ctx, m, version)
    }
    if (model.kind === 'arazzo') {
      const wf = model.model.workflows.find((w) => w.key === key)
      if (wf) return workflowPage(ctx, model.model, wf)
      return arazzoOverview(ctx, model.model, version)
    }
    return overlayOverview(ctx, model.model, version)
  }

  // Toolbar -----------------------------------------------------------------------------------

  private updateBar(): void {
    const a = this.analysis
    this.backBtn.disabled = this.history.length === 0
    this.fwdBtn.disabled = this.future.length === 0
    this.titleEl.replaceChildren()
    if (a) {
      const d = a.detection
      const info = a.model && 'info' in a.model.model ? (a.model.model.info as Record<string, unknown>) : {}
      const title = str(own(info, 'title'))
      if (d.spec) {
        this.titleEl.append(h('b', null, title ?? this.t.appName))
        const v = own(info, 'version')
        if (v !== undefined) this.titleEl.append(h('span', { className: 'ver mono' }, String(v)))
        this.titleEl.append(chip(`${kindName(d.kind)} ${d.version}`))
      } else this.titleEl.append(h('b', null, this.t.appName))
    }
    const spec = !!a?.detection.spec && isObject(a?.parsed.value)
    this.side.classList.toggle('closed', !this.sidebarOpen || !spec)
    this.sideBtn.hidden = !spec
    this.searchBtn.hidden = !spec
    this.backBtn.hidden = this.fwdBtn.hidden = !spec
    this.sideBtn.classList.toggle('on', this.sidebarOpen)
    // Problem counts.
    const counts = { error: 0, warning: 0, info: 0 }
    for (const r of this.problemRows) counts[r.problem.severity]++
    this.problemsBtn.replaceChildren()
    this.problemsBtn.hidden = !a || (!a.detection.spec && this.problemRows.length === 0)
    if (counts.error + counts.warning + counts.info === 0) this.problemsBtn.append(svg(icons.ok), h('span', null, this.t.problems))
    else {
      const wrap = h('span', { className: 'counts' })
      if (counts.error) wrap.append(h('span', { className: 'count error' }, svg(icons.error), String(counts.error)))
      if (counts.warning) wrap.append(h('span', { className: 'count warning' }, svg(icons.warning), String(counts.warning)))
      if (counts.info) wrap.append(h('span', { className: 'count info' }, svg(icons.info), String(counts.info)))
      this.problemsBtn.append(wrap)
    }
    this.problemsBtn.classList.toggle('on', this.panelOpen)
    this.problemsBtn.title = `${this.t.problems}: ${this.t.errors(counts.error)}, ${this.t.warnings(counts.warning)}, ${this.t.infos(counts.info)}`
  }

  private toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen
    this.updateBar()
  }

  private togglePanel(open = !this.panelOpen): void {
    this.panelOpen = open
    this.panelTouched = true
    this.renderPanel()
    this.updateBar()
  }

  // Sidebar -----------------------------------------------------------------------------------

  private refreshNav(): void {
    this.rows = flattenNav(this.tree, this.expanded, this.filter)
    this.nav.setItems(this.rows)
    const empty = this.filter.trim() !== '' && this.rows.length === 0
    this.navEmpty.hidden = !empty
    this.navEmpty.textContent = empty ? format(this.t.noMatches, { q: this.filter.trim() }) : ''
  }

  private currentPageKey(): string {
    return this.route.key
  }

  private navRow(row: NavRow, index: number): HTMLElement {
    const node = row.node
    const selected = !!node.key && node.key === this.currentPageKey()
    const el = h('div', {
      className: `nrow ${node.kind}${selected ? ' sel' : ''}${index === this.focusRow ? ' focus' : ''}${node.deprecated ? ' dep' : ''}`,
      role: 'treeitem',
      'aria-level': String(row.depth + 1),
      'aria-selected': String(selected),
      'aria-expanded': row.hasChildren ? String(row.expanded) : undefined
    })
    el.style.paddingLeft = 6 + row.depth * 14 + 'px'
    const chev = h('span', { className: `chev${row.hasChildren ? (row.expanded ? ' open' : '') : ' none'}` }, svg(icons.chevron))
    el.append(chev)
    if (node.method) el.append(methodBadge(node.method))
    let label = node.label
    let detail = node.detail
    const isOperation = node.key?.startsWith('op:') && node.method
    if (isOperation && this.showPaths && node.detail && node.detail.startsWith('/')) {
      label = node.detail
      detail = node.label !== node.detail ? node.label : undefined
      el.classList.add('mono')
    } else if (isOperation && !this.showPaths) {
      if (label.startsWith('/')) el.classList.add('mono')
      detail = undefined
    }
    el.append(h('span', { className: 'lbl' }, this.filter ? highlight(label, this.filter) : label))
    if (detail && node.kind === 'item' && !isOperation) el.append(h('span', { className: 'det' }, detail))
    if (node.kind !== 'item' && node.count !== undefined) el.append(h('span', { className: 'cnt' }, String(node.count)))
    el.title = [node.label, node.detail].filter(Boolean).join('\n')
    chev.addEventListener('click', (event) => {
      event.stopPropagation()
      if (row.hasChildren) this.toggleNode(node.id)
    })
    el.addEventListener('click', () => {
      this.focusRow = index
      if (node.key) {
        if (row.hasChildren && !row.expanded) this.expanded.add(node.id)
        else if (row.hasChildren && selected) this.expanded.delete(node.id)
        this.go(node.key)
      } else if (row.hasChildren) this.toggleNode(node.id)
    })
    return el
  }

  private toggleNode(id: string): void {
    if (this.filter.trim()) return
    if (this.expanded.has(id)) this.expanded.delete(id)
    else this.expanded.add(id)
    const top = this.nav.scrollTop
    this.refreshNav()
    this.nav.scrollTop = top
  }

  private navKey(event: KeyboardEvent): void {
    const rows = this.rows
    if (rows.length === 0) return
    let i = this.focusRow < 0 ? Math.max(0, rows.findIndex((r) => r.node.key === this.route.key)) : this.focusRow
    const row = rows[i]
    switch (event.key) {
      case 'ArrowDown':
        i = Math.min(rows.length - 1, i + 1)
        break
      case 'ArrowUp':
        i = Math.max(0, i - 1)
        if (i === 0 && this.focusRow === 0) {
          this.filterInput.focus()
          this.focusRow = -1
          this.nav.refresh()
          event.preventDefault()
          return
        }
        break
      case 'Home':
        i = 0
        break
      case 'End':
        i = rows.length - 1
        break
      case 'ArrowRight':
        if (row?.hasChildren && !row.expanded) this.toggleNode(row.node.id)
        else if (row?.hasChildren) i = Math.min(rows.length - 1, i + 1)
        break
      case 'ArrowLeft':
        if (row?.hasChildren && row.expanded) this.toggleNode(row.node.id)
        else {
          for (let j = i - 1; j >= 0; j--) {
            if (rows[j].depth < (row?.depth ?? 0)) {
              i = j
              break
            }
          }
        }
        break
      case 'Enter':
      case ' ':
        if (row?.node.key) this.go(row.node.key)
        else if (row?.hasChildren) this.toggleNode(row.node.id)
        break
      default:
        return
    }
    event.preventDefault()
    this.focusRow = i
    this.nav.scrollToIndex(i, 'nearest')
    this.nav.refresh()
  }

  // Problems ----------------------------------------------------------------------------------

  private renderPanel(): void {
    this.panel.hidden = !this.panelOpen
    if (!this.panelOpen) return
    const t = this.t
    const counts = { error: 0, warning: 0, info: 0 }
    for (const r of this.problemRows) counts[r.problem.severity]++
    const sevButton = (sev: Severity, label: string) =>
      button(`sevbtn ${sev}${this.severities.has(sev) ? ' on' : ''}`, [svg(icons[sev === 'info' ? 'info' : sev]), label], undefined, () => {
        if (this.severities.has(sev)) this.severities.delete(sev)
        else this.severities.add(sev)
        this.renderPanel()
      })
    const filter = h('input', { className: 'input', type: 'search', placeholder: t.filterProblems, value: this.problemFilter, style: 'max-width:240px;height:24px' })
    filter.addEventListener('input', () => {
      this.problemFilter = filter.value
      this.fillProblems()
    })
    this.panelHead.replaceChildren()
    append(
      this.panelHead,
      h('b', null, t.problems),
      sevButton('error', t.errors(counts.error)),
      sevButton('warning', t.warnings(counts.warning)),
      sevButton('info', t.infos(counts.info)),
      filter,
      h('span', { className: 'spacer' }),
      this.analysis && this.analysis.dropped > 0 ? h('span', { className: 'sub' }, format(t.moreProblems, { n: this.analysis.dropped })) : null,
      button('tool', svg(icons.close), t.closePanel, () => this.togglePanel(false))
    )
    this.fillProblems()
  }

  private fillProblems(): void {
    const words = this.problemFilter.toLowerCase().split(/\s+/).filter(Boolean)
    this.visibleProblems = this.problemRows.filter((r) => this.severities.has(r.problem.severity) && words.every((w) => r.message.toLowerCase().includes(w) || r.pointer.toLowerCase().includes(w)))
    this.problemList.setItems(this.visibleProblems)
    if (this.problemRows.length === 0) {
      this.problemList.el.replaceChildren(h('div', { className: 'empty-note' }, this.t.noProblems))
    }
  }

  private problemRow(row: ProblemRow, index: number): HTMLElement {
    const sev = row.problem.severity
    const el = h(
      'div',
      { className: `prow${index === this.selectedProblem ? ' sel' : ''}`, title: `${this.t.severity[sev]}: ${row.message}\n${row.pointer || this.t.rootPointer}` },
      svg(icons[sev === 'info' ? 'info' : sev]),
      h('span', { className: 'msg' }, row.message),
      h('span', { className: 'ptr' }, row.pointer)
    )
    el.firstElementChild?.classList.add(sev)
    if (row.line > 0) {
      const ln = h('span', { className: 'ln', title: format(this.t.goToLine, { n: row.line }) }, format(this.t.lineCol, { line: row.line, col: row.column }))
      ln.addEventListener('click', (event) => {
        event.stopPropagation()
        this.selectedProblem = index
        this.go('source', undefined, row.line)
        this.problemList.refresh()
      })
      el.append(ln)
    }
    el.addEventListener('click', () => {
      this.selectedProblem = index
      this.problemList.refresh()
      const a = this.analysis
      if (!a?.detection.spec || !isObject(a.parsed.value) || row.problem.path.length === 0) {
        if (row.line > 0) this.go('source', undefined, row.line)
        return
      }
      const key = pageFor(this.index, row.problem.path)
      this.go(key)
    })
    return el
  }

  // Source view -------------------------------------------------------------------------------

  private sourcePage(): HTMLElement {
    const a = this.analysis!
    const lines = a.parsed.lines
    const marks = new Map<number, Severity>()
    for (const r of this.problemRows) {
      if (r.line <= 0) continue
      const prev = marks.get(r.line)
      if (!prev || compareSeverity(r.problem.severity, prev) < 0) marks.set(r.line, r.problem.severity)
    }
    const current = this.route.line ?? 0
    const list = new VirtualList<number>({
      rowHeight: 20,
      overscan: 20,
      render: (n) => {
        const sev = marks.get(n)
        const row = h('div', { className: `srcline${sev ? ' flag-line ' + sev : ''}${n === current ? ' cur' : ''}` })
        const mk = h('span', { className: 'mk' })
        if (sev) {
          const icon = svg(icons[sev === 'info' ? 'info' : sev])
          icon.classList.add(sev)
          mk.append(icon)
          const messages = this.problemRows.filter((r) => r.line === n).map((r) => r.message)
          row.title = messages.join('\n')
        }
        row.append(mk, h('span', { className: 'no' }, String(n)), h('span', { className: 'tx' }, lines.line(n)))
        return row
      }
    })
    const count = lines.lineCount
    const numbers = new Array<number>(count)
    for (let i = 0; i < count; i++) numbers[i] = i + 1
    const head = h('div', { className: 'srchead' }, h('b', null, this.t.source), chip(a.parsed.format.toUpperCase()), h('span', { className: 'sub' }, `${count.toLocaleString(this.host.locale)} lines`), h('span', { className: 'spacer' }), button('tool', svg(icons.close), this.t.closePanel, () => this.back()))
    const wrap = h('div', { className: 'srcwrap' }, head, list.el)
    requestAnimationFrame(() => {
      list.setItems(numbers)
      if (current > 0) list.scrollToIndex(current - 1, 'center')
    })
    list.setItems(numbers)
    return wrap
  }

  // Search ------------------------------------------------------------------------------------

  private openSearch(): void {
    const a = this.analysis
    if (!a?.detection.spec || this.overlay) return
    if (!this.searchEntries) this.searchEntries = buildSearchIndex(a.model)
    const entries = this.searchEntries
    const input = h('input', { type: 'search', placeholder: this.t.searchPlaceholder, spellcheck: 'false', 'aria-label': this.t.search })
    input.value = this.lastQuery
    const list = h('div', { className: 'hits', role: 'listbox' })
    const foot = h('div', { className: 'pfoot' }, h('span', null, this.t.searchKeys), h('span'))
    let hits: SearchHit[] = []
    let selected = 0
    const draw = () => {
      list.replaceChildren()
      const q = input.value.trim()
      if (!q) {
        list.append(h('div', { className: 'empty-note' }, this.t.searchEmpty))
        foot.lastElementChild!.textContent = ''
        return
      }
      if (hits.length === 0) list.append(h('div', { className: 'empty-note' }, format(this.t.noMatches, { q })))
      hits.forEach((hit, index) => {
        const e = hit.entry
        const badge = e.method ? methodBadge(e.method) : chip(this.t.kinds[e.kind] ?? e.kind)
        const row = h(
          'div',
          { className: `hit${index === selected ? ' sel' : ''}`, role: 'option' },
          h('div', { className: 'hm' }, badge),
          h(
            'div',
            { className: 'hb' },
            h('div', { className: 'ht' }, highlight(e.title, q)),
            e.detail && e.detail !== e.title ? h('div', { className: 'hd' }, highlight(e.detail, q)) : e.section ? h('div', { className: 'hd' }, this.t.sections[e.section] ?? e.section) : null,
            hit.snippet ? h('div', { className: 'hs' }, highlight(hit.snippet, q)) : null
          )
        )
        row.addEventListener('click', () => choose(index))
        row.addEventListener('mousemove', () => {
          if (selected === index) return
          selected = index
          for (const [i, child] of Array.from(list.children).entries()) child.classList.toggle('sel', i === index)
        })
        list.append(row)
      })
      foot.lastElementChild!.textContent = this.t.results(hits.length)
    }
    const run = () => {
      hits = search(entries, input.value)
      selected = 0
      draw()
    }
    const close = () => {
      this.lastQuery = input.value
      this.overlay?.remove()
      this.overlay = null
    }
    const choose = (index: number) => {
      const hit = hits[index]
      if (!hit) return
      close()
      this.go(hit.entry.key)
      this.content.focus({ preventScroll: true })
    }
    input.addEventListener('input', run)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        selected = Math.max(0, Math.min(hits.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)))
        for (const [i, child] of Array.from(list.children).entries()) child.classList.toggle('sel', i === selected)
        list.children[selected]?.scrollIntoView({ block: 'nearest' })
      } else if (event.key === 'Enter') {
        event.preventDefault()
        choose(selected)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    })
    const palette = h('div', { className: 'palette', role: 'dialog', 'aria-label': this.t.search }, h('div', { className: 'qrow' }, svg(icons.search), input), list, foot)
    this.overlay = h('div', { className: 'overlay' }, palette)
    this.overlay.addEventListener('mousedown', (event) => {
      if (event.target === this.overlay) close()
    })
    this.root.append(this.overlay)
    input.focus()
    input.select()
    run()
  }

  private globalKey(event: KeyboardEvent): void {
    const mod = isMac() ? event.metaKey : event.ctrlKey
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      if (this.overlay) this.overlay.querySelector('input')?.select()
      else this.openSearch()
      return
    }
    if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      this.openSearch()
      return
    }
    if (event.altKey && !mod && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      if (event.key === 'ArrowLeft') this.back()
      else this.forward()
      return
    }
    if (mod && (event.key === '[' || event.key === ']')) {
      event.preventDefault()
      if (event.key === '[') this.back()
      else this.forward()
      return
    }
    if (event.key === 'Escape') {
      if (this.overlay) {
        this.overlay.remove()
        this.overlay = null
      } else if (this.route.key === 'source') this.back()
    }
  }

  // Links, files, clipboard ---------------------------------------------------------------------

  private openExternal(url: string): void {
    const open = this.host.openExternal
    if (!open) {
      void this.copy(url)
      return
    }
    open(url).then(
      (result) => {
        if (!result.opened && result.reason === 'consent-unavailable') this.toast(url)
      },
      () => this.toast(url)
    )
  }

  /** `#/components/schemas/Pet`, `#tag/pets`, `#operation/getPet`, `#pets` (Redoc-style links). */
  private openFragment(fragment: string): boolean {
    const a = this.analysis
    if (!a) return false
    const path = fragmentToPath(fragment)
    if (path && path.length > 0) {
      this.go(pageFor(this.index, path))
      return true
    }
    const name = decodeSafe(fragment.slice(1))
    const tagMatch = /^tag\/(.+?)(?:\/operation\/(.+))?$/.exec(name)
    if (tagMatch) {
      if (tagMatch[2] && this.operationIds.has(tagMatch[2])) this.go(this.operationIds.get(tagMatch[2])!)
      else if (this.titles.has('tag:' + tagMatch[1])) this.go('tag:' + tagMatch[1])
      return true
    }
    const opMatch = /^operation\/(.+)$/.exec(name)
    if (opMatch && this.operationIds.has(opMatch[1])) {
      this.go(this.operationIds.get(opMatch[1])!)
      return true
    }
    if (this.operationIds.has(name)) {
      this.go(this.operationIds.get(name)!)
      return true
    }
    if (this.titles.has('tag:' + name)) {
      this.go('tag:' + name)
      return true
    }
    return false
  }

  private async addFiles(files: File[]): Promise<void> {
    const loaded: string[] = []
    for (const file of files.slice(0, 20)) {
      try {
        if (file.size > 50 * 1024 * 1024) throw new Error(formatSize(file.size, this.host.locale))
        const text = await file.text()
        const parsed = parseText(text)
        if (parsed.value === undefined || parsed.value === null) throw new Error(parsed.issues[0]?.message ?? 'empty')
        this.documents.set(file.name, parsed.value)
        loaded.push(file.name)
      } catch (error) {
        this.toast(format(this.t.loadFailed, { file: file.name, message: error instanceof Error ? error.message : String(error) }))
      }
    }
    if (loaded.length === 0 || this.text === null) return
    const text = this.text
    this.text = null
    const route = this.route
    this.load(text)
    this.route = route
    this.render(this.content.scrollTop)
    this.toast(format(this.t.loadedFile, { file: loaded.join(', ') }))
  }

  private hideDrop(): void {
    this.dropzone?.remove()
    this.dropzone = null
  }

  private async copy(text: string): Promise<void> {
    const ok = await copyText(text)
    this.toast(ok ? this.t.copied : this.t.copyFailed)
  }

  private toast(text: string): void {
    this.toastEl.textContent = text
    this.toastEl.classList.add('show')
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200)
  }
}

function flatTags<T extends { children: T[] }>(tags: T[]): T[] {
  const out: T[] = []
  const walk = (list: T[]) => {
    for (const t of list) {
      out.push(t)
      walk(t.children)
    }
  }
  walk(tags)
  return out
}

function kindName(kind: string): string {
  return kind === 'openapi' ? 'OpenAPI' : kind === 'asyncapi' ? 'AsyncAPI' : kind === 'arazzo' ? 'Arazzo' : 'Overlay'
}

function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
}

function formatSize(bytes: number, locale: string): string {
  return `${(bytes / 1048576).toLocaleString(locale, { maximumFractionDigits: 1 })} MiB`
}

function decodeSafe(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function cssEscape(text: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(text) : text.replace(/["\\]/g, '\\$&')
}
