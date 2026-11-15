import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import { exampleFromSchema } from './example'
import { MAX_HOPS, Refs } from './refs'

function spec31(schemas: Record<string, unknown>, responseRef = '#/components/schemas/Pet'): string {
  return JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    paths: { '/a': { get: { responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: responseRef } } } } } } } },
    components: { schemas }
  })
}

test('inside a $id resource, references resolve against that resource first', () => {
  const pet = { $id: 'https://example.com/pet', $defs: { name: { type: 'string', example: 'Rex' } }, type: 'object', properties: { name: { $ref: '#/$defs/name' }, self: { $ref: '#' } } }
  const owner = { $id: 'https://example.com/owner', type: 'object', properties: { pet: { $ref: 'pet' } } }
  const a = analyze(spec31({ Pet: pet, Owner: owner }, '#/components/schemas/Owner'))
  assert.deepEqual(
    a.problems.map((p) => p.rule),
    [],
    JSON.stringify(a.problems)
  )
  const refs = a.refs
  const name = refs.follow({ $ref: '#/$defs/name' }, { doc: '', path: ['components', 'schemas', 'Pet', 'properties', 'name'] })
  assert.deepEqual(name.loc.path, ['components', 'schemas', 'Pet', '$defs', 'name'])
  const self = refs.follow({ $ref: '#' }, { doc: '', path: ['components', 'schemas', 'Pet', 'properties', 'self'] })
  assert.deepEqual(self.loc.path, ['components', 'schemas', 'Pet'])
  const relative = refs.resolve('pet', '', false, ['components', 'schemas', 'Owner', 'properties', 'pet'])
  assert.equal(relative.kind, 'local')
  assert.deepEqual(relative.kind === 'local' && relative.loc.path, ['components', 'schemas', 'Pet'])
  const example = exampleFromSchema(refs, { $ref: '#/components/schemas/Pet' }, { doc: '', path: [] }, { mode: 'response' })
  assert.deepEqual((example as Record<string, unknown>).name, 'Rex')
  // Outside the resource the same pointer means the document root.
  assert.equal(refs.resolve('#/$defs/name').kind, 'missing')
})

test('a long $ref chain is not a cycle; only a repeat is', () => {
  const chain = (n: number) => {
    const schemas: Record<string, unknown> = {}
    for (let i = 0; i < n; i++) schemas[`S${i}`] = { $ref: `#/components/schemas/S${i + 1}` }
    schemas[`S${n}`] = { type: 'string' }
    return schemas
  }
  const forty = analyze(spec31(chain(40), '#/components/schemas/S0'))
  assert.deepEqual(forty.problems.map((p) => p.rule), [])
  const followed = forty.refs.follow({ $ref: '#/components/schemas/S0' }, { doc: '', path: [] })
  assert.deepEqual(followed.value, { type: 'string' })
  assert.equal(followed.cycle, undefined)
  // Exactly MAX_HOPS references reach the end; one more stops as too long.
  const exact = new Refs({ components: { schemas: chain(MAX_HOPS - 1) } }).follow({ $ref: '#/components/schemas/S0' }, { doc: '', path: [] })
  assert.deepEqual([exact.value, exact.stop, exact.cycle], [{ type: 'string' }, undefined, undefined])
  const long = analyze(spec31(chain(MAX_HOPS + 10), '#/components/schemas/S0'))
  assert.ok(!long.problems.some((p) => p.rule === 'circular-ref'))
  assert.ok(long.problems.some((p) => p.rule === 'long-ref-chain' && p.severity === 'warning'))
  const cycle = analyze(spec31({ A: { $ref: '#/components/schemas/B' }, B: { $ref: '#/components/schemas/A' } }, '#/components/schemas/A'))
  assert.ok(cycle.problems.some((p) => p.rule === 'circular-ref'))
})

test('the reference index stays linear on deep documents', () => {
  for (const depth of [20_000, 60_000]) {
    const text = `{"openapi":"3.1.0","info":{"title":"T","version":"1"},"x-deep":${'['.repeat(depth)}${']'.repeat(depth)},"paths":{"/a":{"$ref":"common.yaml#/paths/a"}},"components":{"schemas":{"S":{"$ref":"#foo"}}}}`
    const start = performance.now()
    const a = analyze(text)
    const ms = performance.now() - start
    assert.ok(ms < 1000, `depth ${depth}: ${ms.toFixed(0)} ms`)
    assert.ok(a.problems.some((p) => p.rule === 'external-ref'))
  }
  // Many anchors deep down: only the nodes that need a path get one.
  let node: Record<string, unknown> = { type: 'string' }
  for (let i = 0; i < 200; i++) node = { $anchor: `a${i}`, type: 'object', properties: { next: node } }
  const refs = new Refs({ components: { schemas: { Deep: node } } })
  const start = performance.now()
  const found = refs.resolve('#a0')
  assert.ok(performance.now() - start < 200)
  assert.equal(found.kind, 'local')
  assert.equal(found.kind === 'local' && found.loc.path.length, 3 + 2 * 199)
})
