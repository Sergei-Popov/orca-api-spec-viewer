import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import { exampleFromSchema } from './example'
import { getAt } from './pointer'
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

test('OpenAPI 3.2 $self is the base URI for references and $id', () => {
  // Before: both references were "Defined in another file", and Pet was reported unused.
  const spec = `openapi: 3.2.0
$self: https://example.com/api/openapi.yaml
info: { title: T, version: '1' }
paths:
  /pets:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  bySelf: { $ref: 'https://example.com/api/openapi.yaml#/components/schemas/Pet' }
                  byFile: { $ref: 'openapi.yaml#/components/schemas/Pet' }
                  byId: { $ref: 'https://example.com/api/schemas/owner' }
                  byRelativeId: { $ref: 'schemas/owner' }
                  elsewhere: { $ref: 'https://example.com/other.yaml#/Pet' }
components:
  schemas:
    Pet: { type: object, properties: { name: { type: string } } }
    Owner: { $id: schemas/owner, type: object, properties: { name: { type: string } } }
`
  const a = analyze(spec)
  assert.deepEqual(a.problems.map((p) => `${p.rule} ${p.path.at(-2)}`), ['external-ref elsewhere'])
  const at = ['paths', '/pets', 'get', 'responses', '200', 'content', 'application/json', 'schema', 'properties']
  const target = (name: string, ref: string) => {
    const r = a.refs.resolve(ref, '', false, [...at, name])
    return r.kind === 'local' ? r.loc.path.join('/') : r.kind
  }
  assert.equal(target('bySelf', 'https://example.com/api/openapi.yaml#/components/schemas/Pet'), 'components/schemas/Pet')
  assert.equal(target('byFile', 'openapi.yaml#/components/schemas/Pet'), 'components/schemas/Pet')
  assert.equal(target('byId', 'https://example.com/api/schemas/owner'), 'components/schemas/Owner')
  assert.equal(target('byRelativeId', 'schemas/owner'), 'components/schemas/Owner')
  // Without $self the document's URI is unknown, so a file name is another file.
  assert.equal(new Refs({ components: {} }).resolve('openapi.yaml#/components').kind, 'external')
})

test('$id and $anchor are scoped by resource URI', () => {
  // Before: anchors were global by name, a nested relative $id matched by its text first, and
  // relative $id chains without an absolute base were not composed.
  const schemas = {
    A: { $id: 'https://a.example/schema', type: 'object', properties: { n: { $ref: '#node' }, item: { $ref: 'item' } }, $defs: { N: { $anchor: 'node', type: 'string' }, I: { $id: 'item', type: 'string' } } },
    B: { $id: 'https://b.example/schema', type: 'object', properties: { n: { $ref: '#node' }, item: { $ref: 'item' } }, $defs: { N: { $anchor: 'node', type: 'integer' }, I: { $id: 'item', type: 'integer' } } },
    Pet: { $id: 'schemas/pet.json', type: 'object', properties: { owner: { $ref: 'owner.json' } }, $defs: { O: { $id: 'owner.json', type: 'object' } } },
    Owner: { type: 'object', properties: { owner: { $ref: 'schemas/owner.json' } } },
    C: { type: 'object', properties: { b: { $ref: 'https://b.example/schema#node' } } }
  }
  const a = analyze(spec31(schemas, '#/components/schemas/A'))
  const follow = (schema: string, prop: string) => {
    const at = ['components', 'schemas', schema, 'properties', prop]
    const followed = a.refs.follow(getAt(a.refs.root(), at), { doc: '', path: at })
    return followed.stop ? followed.stop.kind : followed.loc.path.join('/')
  }
  assert.equal(follow('A', 'n'), 'components/schemas/A/$defs/N')
  assert.equal(follow('B', 'n'), 'components/schemas/B/$defs/N')
  assert.equal(follow('C', 'b'), 'components/schemas/B/$defs/N')
  assert.equal(follow('A', 'item'), 'components/schemas/A/$defs/I')
  assert.equal(follow('B', 'item'), 'components/schemas/B/$defs/I')
  assert.equal(follow('Pet', 'owner'), 'components/schemas/Pet/$defs/O')
  assert.equal(follow('Owner', 'owner'), 'components/schemas/Pet/$defs/O')
  assert.ok(!a.problems.some((p) => p.rule === 'unresolved-ref' || p.rule === 'external-ref'), JSON.stringify(a.problems))
})

test('a resource without the anchor or $id never borrows another resource’s', () => {
  // Before: D's `#node` and `https://d.example/schema#node` showed A's node, and Three's `item`
  // showed One's item, with no problem: the by-name and by-text last resorts looked everywhere.
  const schemas = {
    A: { $id: 'https://a.example/schema', $defs: { N: { $anchor: 'node', type: 'string' } } },
    D: { $id: 'https://d.example/schema', type: 'object', properties: { n: { $ref: '#node' }, byUri: { $ref: 'https://d.example/schema#node' } } },
    One: { $id: 'https://one.example/root', $defs: { I: { $id: 'item', type: 'string' } } },
    Three: { $id: 'https://three.example/root', type: 'object', properties: { item: { $ref: 'item' } } },
    // In the root resource of a document without $self, the last resorts still help.
    Root: { type: 'object', properties: { n: { $ref: '#node' }, item: { $ref: 'item' } } }
  }
  const a = analyze(spec31(schemas, '#/components/schemas/Root'))
  const stop = (schema: string, prop: string) => {
    const at = ['components', 'schemas', schema, 'properties', prop]
    const followed = a.refs.follow(getAt(a.refs.root(), at), { doc: '', path: at })
    return followed.stop ? followed.stop.kind : followed.loc.path.join('/')
  }
  assert.equal(stop('D', 'n'), 'missing')
  assert.equal(stop('D', 'byUri'), 'missing')
  assert.equal(stop('Three', 'item'), 'external')
  assert.equal(stop('Root', 'n'), 'components/schemas/A/$defs/N')
  assert.equal(stop('Root', 'item'), 'components/schemas/One/$defs/I')
  const reported = a.problems.map((p) => `${p.rule} ${p.path.slice(2, 5).join('/')}`)
  assert.ok(reported.includes('unresolved-ref D/properties/n'), reported.join('\n'))
  assert.ok(reported.includes('unresolved-ref D/properties/byUri'), reported.join('\n'))
  assert.ok(a.problems.some((p) => p.rule === 'external-ref' && p.params.file === 'https://three.example/item'), JSON.stringify(a.problems))
  // With $self the document has a base of its own: no last resort there either.
  const selfDoc = new Refs({ $self: 'https://api.example/openapi', components: { schemas: { A: schemas.A, R: { $ref: '#node' } } } })
  assert.equal(selfDoc.resolve('#node', '', false, ['components', 'schemas', 'R']).kind, 'missing')
})

test('$dynamicRef takes the outermost resource of the dynamic scope', () => {
  // The generic array from the OpenAPI 3.1.1 and 3.2 Schema Object examples. Before: both arrays
  // had items of the "allow all" default, and the example was [].
  const schemas = {
    genericArrayComponent: { $id: 'fully_generic_array', type: 'array', items: { $dynamicRef: '#generic-array' }, $defs: { allowAll: { $dynamicAnchor: 'generic-array' } } },
    numberArray: { $id: 'array_of_numbers', $ref: 'fully_generic_array', $defs: { numbersOnly: { $dynamicAnchor: 'generic-array', type: 'number' } } },
    stringArray: { $id: 'array_of_strings', $ref: 'fully_generic_array', $defs: { stringsOnly: { $dynamicAnchor: 'generic-array', type: 'string' } } },
    typed: { type: 'object', properties: { strings: { $ref: 'array_of_strings' }, numbers: { $ref: 'array_of_numbers' } } }
  }
  const a = analyze(spec31(schemas, '#/components/schemas/typed'))
  assert.deepEqual(a.problems.map((p) => p.rule), [])
  const example = (name: string) => exampleFromSchema(a.refs, { $ref: `#/components/schemas/${name}` }, { doc: '', path: [] }, { mode: 'response' })
  assert.deepEqual(example('stringArray'), ['string'])
  assert.deepEqual(example('numberArray'), [0])
  assert.deepEqual(example('typed'), { strings: ['string'], numbers: [0] })
  // Drawn on its own, the generic array keeps its default.
  const generic = a.refs.follow({ $ref: '#/components/schemas/genericArrayComponent' }, { doc: '', path: [] })
  const items = a.refs.follow((generic.value as { items: unknown }).items, { ...generic.loc, path: [...generic.loc.path, 'items'] })
  assert.deepEqual(items.loc.path, ['components', 'schemas', 'genericArrayComponent', '$defs', 'allowAll'])
})

test('the reference index looks inside names like default and enum', () => {
  // Before: the index skipped everything under keys named default, example(s), enum or const, so
  // the `default` response's $id and $anchor and a component named `default` were not found.
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /a:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  err: { $ref: 'https://example.com/schemas/error' }
                  code: { $ref: '#error-code' }
                  setting: { $ref: 'https://example.com/schemas/setting-default' }
                  other: { $ref: 'https://example.com/schemas/default-component' }
        default:
          description: Any error
          content:
            application/json:
              schema:
                $id: https://example.com/schemas/error
                type: object
                properties:
                  code: { $anchor: error-code, type: integer }
                  detail: { $ref: '#/$defs/detail' }
                $defs:
                  detail: { type: string }
components:
  schemas:
    Settings:
      type: object
      properties:
        default: { $id: https://example.com/schemas/setting-default, type: string }
    enum:
      type: object
      default: { $id: https://example.com/schemas/not-a-schema }
    default: { $id: https://example.com/schemas/default-component, type: object }
`
  const a = analyze(spec)
  assert.deepEqual(a.problems.map((p) => `${p.rule} ${p.path.join('/')}`), ['unused-component components/schemas/enum'])
  // A default value is data: a $id in it names nothing.
  assert.equal(a.refs.resolve('https://example.com/schemas/not-a-schema').kind, 'external')
})
