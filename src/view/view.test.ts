import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import { problemMessage, stringsFor } from '../i18n'
import { flatTags, MAX_TAG_DEPTH, shortSummary, type OpenApiModel } from '../spec/openapi'
import { ancestorsOf, defaultExpanded, flattenNav, navTree, pageFor, pageIndex, type NavLabels } from './nav'
import { buildSearchIndex, search, searchCounted } from './search'

const labels: NavLabels = {
  overview: 'Overview',
  operations: 'Operations',
  webhooks: 'Webhooks',
  untagged: 'Other',
  servers: 'Servers',
  channels: 'Channels',
  messages: 'Messages',
  workflows: 'Workflows',
  actions: 'Actions',
  section: (name) => name[0].toUpperCase() + name.slice(1)
}

const SPEC = `openapi: 3.1.0
info: { title: Shop, version: "1" }
tags:
  - { name: orders, description: Orders placed by customers }
  - { name: pets }
paths:
  /pets:
    get: { tags: [pets], summary: List pets, operationId: listPets, responses: { '200': { description: ok } } }
    post: { tags: [pets], operationId: createPet, description: Adds a new pet to the store, responses: { '201': { description: ok } } }
  /orders/{id}:
    get:
      tags: [orders]
      summary: Get an order
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { '200': { description: ok } }
  /health:
    get: { summary: Health, responses: { '200': { description: ok } } }
webhooks:
  orderShipped:
    post: { summary: Order shipped, responses: { '200': { description: ok } } }
components:
  schemas:
    Pet: { type: object, description: A pet in the store, properties: { name: { type: string }, owner_id: { type: string } } }
    Order: { type: object }
`

test('the sidebar tree groups operations by tag and lists components', () => {
  const a = analyze(SPEC)
  const tree = navTree(a.model, labels)
  assert.deepEqual(tree.map((n) => [n.id, n.count ?? null]), [
    ['overview', null],
    ['section:operations', 4],
    ['section:webhooks', 1],
    ['section:c:schemas', 2]
  ])
  const ops = tree[1].children!
  assert.deepEqual(ops.map((g) => g.label), ['orders', 'pets', 'Other'])
  assert.deepEqual(ops[1].children!.map((o) => [o.method, o.label, o.detail]), [
    ['get', 'List pets', '/pets'],
    ['post', '/pets', 'createPet']
  ])
  const rows = flattenNav(tree, defaultExpanded(tree), '')
  assert.equal(rows.length, 1 + 1 + 3 + 4 + 1 + 1 + 1 + 2)
  const collapsed = flattenNav(tree, new Set(), '')
  assert.deepEqual(collapsed.map((r) => r.node.id), ['overview', 'section:operations', 'section:webhooks', 'section:c:schemas'])
})

test('the workflows section counts workflows, and each workflow its steps', () => {
  const a = analyze(`arazzo: 1.0.1
info: { title: Loans, version: 1.0.0 }
sourceDescriptions: [{ name: shelf, url: ./shelf.yaml, type: openapi }]
workflows:
  - workflowId: borrow
    steps:
      - { stepId: find, operationId: listBooks }
      - { stepId: take, operationId: borrowBook }
      - { stepId: check, operationId: getBook }
  - workflowId: giveBack
    steps:
      - { stepId: hand, operationId: returnBook }
`)
  const tree = navTree(a.model, labels)
  assert.deepEqual(tree.map((n) => [n.label, n.count ?? null]), [['Overview', null], ['Workflows', 2]])
  assert.deepEqual(tree[1].children!.map((w) => [w.label, w.count]), [['borrow', 3], ['giveBack', 1]])
})

test('the filter keeps matching items and opens their groups', () => {
  const tree = navTree(analyze(SPEC).model, labels)
  const rows = flattenNav(tree, new Set(), 'pet')
  assert.deepEqual(rows.map((r) => `${r.depth}:${r.node.label}`), ['0:Operations', '1:pets', '2:List pets', '2:/pets', '0:Schemas', '1:Pet'])
  assert.deepEqual(flattenNav(tree, new Set(), 'createpet').map((r) => r.node.label), ['Operations', 'pets', '/pets'])
  assert.deepEqual(flattenNav(tree, new Set(), 'get order').map((r) => r.node.label), ['Operations', 'orders', 'Get an order'])
})

test('pointers find their pages', () => {
  const a = analyze(SPEC)
  const index = pageIndex(a.model)
  const tree = navTree(a.model, labels)
  const getPets = tree[1].children![1].children![0].key!
  assert.equal(pageFor(index, ['paths', '/pets', 'get', 'responses', '200']), getPets)
  assert.equal(pageFor(index, ['components', 'schemas', 'Pet', 'properties', 'name']), 'c:/components/schemas/Pet')
  assert.equal(pageFor(index, ['info', 'title']), 'overview')
  assert.equal(pageFor(index, ['tags', '0', 'description']), 'tag:orders')
  assert.deepEqual(ancestorsOf(tree).get(getPets), ['section:operations', 'tag:pets'])
})

test('search ranks titles first and finds descriptions and property names', () => {
  const entries = buildSearchIndex(analyze(SPEC).model)
  const titles = (q: string) => search(entries, q).map((hit) => hit.entry.title)
  assert.deepEqual(titles('pet').slice(0, 2), ['Pet', 'pets'])
  assert.ok(titles('pet').includes('List pets'))
  assert.deepEqual(titles('listpets'), ['List pets'])
  assert.deepEqual(titles('owner_id'), ['Pet'])
  const hit = search(entries, 'store new')[0]
  assert.equal(hit.entry.title, '/pets')
  assert.equal(hit.snippet, 'Adds a new pet to the store')
  assert.deepEqual(titles('customers'), ['orders'])
  assert.deepEqual(titles('shipped'), ['Order shipped'])
  assert.deepEqual(titles(''), [])
})

test('search shows an operation path once, and counts every match past the first 200', () => {
  const entries = buildSearchIndex(
    analyze(`openapi: 3.1.0
info: { title: Books, version: "1" }
paths:
  /loans:
    post: { summary: Borrow a book, tags: [loans], responses: { '201': { description: ok } } }
  /loans/{loanId}/return:
    post: { summary: Return a book, tags: [loans], responses: { '200': { description: ok } } }
`).model
  )
  for (const hit of search(entries, 'loan')) {
    if (hit.entry.kind !== 'operation') continue
    assert.ok(hit.entry.detail?.startsWith('/loans'))
    assert.equal(hit.snippet, undefined, `${hit.entry.title}: the path is the detail line already`)
  }
  const many = ['openapi: 3.1.0', 'info: { title: T, version: "1" }', 'paths:']
  for (let i = 0; i < 300; i++) many.push(`  /items/${i}:`, `    get: { summary: Item ${i}, responses: { '200': { description: ok } } }`)
  const counted = searchCounted(buildSearchIndex(analyze(many.join('\n')).model), 'item')
  assert.equal(counted.hits.length, 200)
  assert.equal(counted.total, 300)
})

function tagSpec(tags: { name: string; parent?: string }[], opTag: string): string {
  return JSON.stringify({
    openapi: '3.2.0',
    info: { title: 'T', version: '1' },
    tags,
    paths: { '/a': { get: { summary: 'Op A', tags: [opTag], responses: { 200: { description: 'ok' } } } } }
  })
}

function navLabels(nodes: ReturnType<typeof navTree>): string[] {
  const out: string[] = []
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()!
    out.push(node.label)
    stack.push(...(node.children ?? []))
  }
  return out
}

test('a tag parent chain thousands deep loads, nested up to the cap', () => {
  // Before: tagNode recursed once per level (a stack overflow made the file unreadable).
  const tags = Array.from({ length: 4000 }, (_, i) => (i === 0 ? { name: 't0' } : { name: `t${i}`, parent: `t${i - 1}` }))
  const a = analyze(tagSpec(tags, 't3999'))
  assert.deepEqual(a.problems.filter((p) => p.severity !== 'info').map((p) => p.rule), [])
  const m = (a.model as { model: OpenApiModel }).model
  const all = flatTags(m.tags)
  assert.equal(all.length, 4000)
  let deepest = 0
  const depth = new Map(m.tags.map((t) => [t, 0]))
  for (const tag of all) for (const c of tag.children) depth.set(c, depth.get(tag)! + 1)
  for (const d of depth.values()) deepest = Math.max(deepest, d)
  assert.equal(deepest, MAX_TAG_DEPTH - 1)
  const tree = navTree(a.model, labels)
  assert.ok(navLabels(tree).includes('Op A'))
  const rows = flattenNav(tree, defaultExpanded(tree), '')
  assert.ok(rows.length > 0)
  ancestorsOf(tree)
  pageIndex(a.model)
  assert.equal(buildSearchIndex(a.model).filter((e) => e.kind === 'tag').length, 4000)
})

test('a tag parent cycle of any length is reported once, and its tags and operations still show', () => {
  for (const n of [3, 64, 65, 66]) {
    // Before: a cycle longer than 64 tags had no root, so its tags and operations vanished.
    const tags = Array.from({ length: n }, (_, i) => ({ name: `t${i}`, parent: `t${(i + n - 1) % n}` }))
    tags.push({ name: 'leaf', parent: 't1' })
    const a = analyze(tagSpec(tags, 'leaf'))
    const cycles = a.problems.filter((p) => p.rule === 'tag-parent-cycle')
    assert.equal(cycles.length, 1, `n=${n}`)
    assert.equal(cycles[0].params.count, n)
    assert.deepEqual(cycles[0].path, ['tags', '0', 'parent'])
    const m = (a.model as { model: OpenApiModel }).model
    assert.equal(m.tags.length, n, `n=${n}: every tag of the cycle is at the top`)
    assert.deepEqual(m.tags.find((t) => t.name === 't1')!.children.map((t) => t.name), ['leaf'])
    assert.ok(navLabels(navTree(a.model, labels)).includes('Op A'), `n=${n}`)
  }
  const message = problemMessage(stringsFor('en'), analyze(tagSpec([{ name: 'a', parent: 'b' }, { name: 'b', parent: 'a' }], 'a')).problems.find((p) => p.rule === 'tag-parent-cycle')!)
  assert.equal(message, 'Tag parents form a cycle of 2: a → b → a. These tags are shown at the top level.')
})

test('webhook rows show the webhook name, with a short summary as detail', () => {
  // Before: GitHub's 276 webhooks were drawn by their summaries, 75 distinct first lines of up to
  // 1,293 characters, and the name showed only in the tooltip.
  const long = 'This event occurs when there is activity on a pull request. For more information, see "[About pull requests](https://docs.example.com/pulls)." And more text after that, long enough to need a cut.\n\nA second paragraph.'
  const a = analyze(`openapi: 3.1.0
info: { title: Hooks, version: "1" }
webhooks:
  pull-request-opened:
    post: { summary: ${JSON.stringify(long)}, responses: { '200': { description: ok } } }
  pull-request-closed:
    post: { summary: ${JSON.stringify(long)}, responses: { '200': { description: ok } } }
  ping:
    post: { responses: { '200': { description: ok } } }
`)
  const tree = navTree(a.model, labels)
  const hooks = tree.find((n) => n.id === 'section:webhooks')!.children!
  assert.deepEqual(
    hooks.map((n) => [n.label, n.detail ?? '', n.webhook]),
    [
      ['pull-request-opened', 'This event occurs when there is activity on a pull request.', true],
      ['pull-request-closed', 'This event occurs when there is activity on a pull request.', true],
      ['ping', '', true]
    ]
  )
  assert.ok(hooks[0].match.includes('pull-request-opened'))
})

test('a long summary is cut to its first line, sentence or 120 characters', () => {
  assert.equal(shortSummary('List pets'), 'List pets')
  assert.equal(shortSummary('  First line\nsecond line'), 'First line')
  assert.equal(shortSummary('See [the guide](https://example.com/guide) for more'), 'See the guide for more')
  assert.equal(shortSummary('Keeps [brackets] and (parens) as they are'), 'Keeps [brackets] and (parens) as they are')
  const words = 'word '.repeat(40).trim()
  assert.equal(shortSummary(words).length, 120)
  assert.ok(shortSummary(words).endsWith('…'))
  assert.equal(shortSummary(`A sentence that ends here. ${words}`), 'A sentence that ends here.')
  assert.equal(shortSummary(undefined), '')
})
