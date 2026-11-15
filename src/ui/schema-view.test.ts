import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import { stringsFor } from '../i18n'
import { getAt } from '../spec/pointer'
import type { PageCtx } from './context'
import { operationDetails } from '../spec/operation'
import type { OpenApiModel } from '../spec/openapi'
import { refName, schemaTypes } from '../spec/schema'
import { mediaExamples } from './openapi-pages'
import { itemsOf, typeText } from './schema-view'

function children(spec: string, name: string) {
  const a = analyze(spec)
  const ctx = { t: stringsFor('en'), refs: a.refs } as unknown as PageCtx
  const path = ['components', 'schemas', name]
  const schema = getAt(a.parsed.value, path) as Record<string, unknown>
  return itemsOf({ ctx }, schema, { doc: '', path }).items.map((item) => `${item.role}:${item.label}`)
}

test('an array whose items lead back to itself is an items row, not an endless list', () => {
  // Before: itemsOf flattened Node's items into Node forever (Maximum call stack size exceeded).
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
paths: {}
components:
  schemas:
    Node:
      type: [array, object]
      properties: { id: { type: string } }
      items: { $ref: '#/components/schemas/Node' }
    Old:
      type: array
      properties: { id: { type: string } }
      items: { $ref: '#/components/schemas/Old' }
    A:
      type: array
      properties: { a: { type: string } }
      items: { $ref: '#/components/schemas/B' }
    B:
      type: array
      properties: { b: { type: string } }
      items: { $ref: '#/components/schemas/A' }
    List:
      type: array
      items: { type: object, properties: { name: { type: string } } }
`
  assert.deepEqual(children(spec, 'Node'), ['property:id', 'role:Items'])
  assert.deepEqual(children(spec, 'Old'), ['property:id', 'role:Items'])
  assert.deepEqual(children(spec, 'A'), ['property:a', 'property:b', 'role:Items'], 'B is flattened into A once, then A stops')
  assert.deepEqual(children(spec, 'List'), ['property:name'], 'ordinary arrays of objects still show their item properties')
})

test('OpenAPI 3.0 nullable adds null only to a type given beside it', () => {
  // Before: nullable without a type read as the type null (633 properties in Stripe), with false
  // invalid-enum, invalid-default and invalid-example problems.
  const spec = `openapi: 3.0.3
info: { title: T, version: '1' }
paths: {}
components:
  schemas:
    User: { type: object, properties: { id: { type: integer } } }
    Pet:
      type: object
      properties:
        owner: { nullable: true, allOf: [{ $ref: '#/components/schemas/User' }], example: { id: 1 } }
        status: { nullable: true, enum: [available, sold, null], default: available }
        anything: { nullable: true, example: 42 }
        name: { type: string, nullable: true, example: null, default: null }
        count: { type: integer, nullable: true, enum: [1, 2, null] }
`
  const a = analyze(spec)
  assert.deepEqual(a.problems.map((p) => `${p.rule} ${p.path.join('/')}`), [])
  const ctx = { t: stringsFor('en'), refs: a.refs } as unknown as PageCtx
  const type = (name: string) => {
    const path = ['components', 'schemas', 'Pet', 'properties', name]
    return typeText(ctx, getAt(a.parsed.value, path), { doc: '', path })
  }
  for (const name of ['owner', 'anything']) assert.ok(!type(name).includes('null'), `${name}: ${type(name)}`)
  // Read from the enum's values, which do include null.
  assert.equal(type('status'), 'string | null')
  assert.equal(type('name'), 'string | null')
  assert.equal(type('count'), 'integer | null')
  assert.deepEqual(schemaTypes({ nullable: true }), [])
  assert.deepEqual(schemaTypes({ nullable: true, properties: {} }), ['object'])
  assert.deepEqual(schemaTypes({ type: 'string', nullable: true }), ['string', 'null'])
  // A wrong value is still reported when a type is given.
  const wrong = analyze(spec.replace('enum: [1, 2, null]', 'enum: [1, two, null]'))
  assert.deepEqual(wrong.problems.map((p) => p.rule), ['invalid-enum'])
})

test('itemSchema is labelled as one item, and an anchor name has no slash', () => {
  // Before: a JSON Lines response showed itemSchema's example as if it were the whole content,
  // and `petdetails#pet_details_id` read `petdetails#/pet_details_id`, like a JSON Pointer.
  const spec = `openapi: 3.2.0
info: { title: T, version: '1' }
paths:
  /events:
    get:
      responses:
        '200':
          description: ok
          content:
            application/jsonl: { itemSchema: { type: object, properties: { id: { type: integer } } } }
            application/json: { schema: { type: array, items: { type: integer } } }
`
  const a = analyze(spec)
  const ctx = { t: stringsFor('en'), refs: a.refs } as unknown as PageCtx
  const model = (a.model as { model: OpenApiModel }).model
  const [jsonl, json] = operationDetails(model, a.refs, model.operations[0]).responses[0].media
  assert.deepEqual(mediaExamples(ctx, jsonl, 'response').map((e) => [e.label, e.text]), [['One item, generated from the schema', '{\n  "id": 0\n}']])
  assert.deepEqual(mediaExamples(ctx, json, 'response').map((e) => e.label), ['Generated from the schema'])
  assert.equal(refName('petdetails#pet_details_id'), 'petdetails#pet_details_id')
  assert.equal(refName('./schemas/pet.yaml#/Pet'), 'pet.yaml#/Pet')
})
