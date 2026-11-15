import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import { stringsFor } from '../i18n'
import { getAt } from '../spec/pointer'
import type { PageCtx } from './context'
import { itemsOf } from './schema-view'

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
