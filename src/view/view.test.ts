import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
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
