// Problems that the specifications say are not problems, from the spec-correctness check of the
// viewer: each fixture is the smallest document that showed one.
import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import type { OpenApiModel } from '../spec/openapi'

const found = (text: string) => analyze(text).problems.map((p) => `${p.rule} ${p.path.join('/')}`)

test('references inside x- extensions and AsyncAPI bindings count as uses', () => {
  // Before: 294 of GitHub 3.0's 331 problems were false "Nothing refers to …" warnings for
  // schemas used only from x-webhooks, and schemas used from bindings were "unused" too.
  const openapi = `openapi: 3.0.3
info: { title: T, version: '1' }
paths:
  /a: { get: { responses: { '200': { description: ok } } } }
x-webhooks:
  pinged:
    post:
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Ping' }
            examples:
              default: { $ref: '#/components/examples/ping' }
              literal: { value: { $ref: '#/components/schemas/OnlyInData' } }
      responses: { '200': { description: ok } }
x-extra: { deep: [{ items: { $ref: '#/components/schemas/Listed' } }], example: { $ref: '#/components/schemas/OnlyInData' } }
components:
  schemas:
    Ping: { type: object }
    Listed: { type: string }
    OnlyInData: { type: string }
  examples:
    ping: { value: { zen: hi } }
`
  // An example's value is data: a $ref there is text, not a use.
  assert.deepEqual(found(openapi), ['unused-component components/schemas/OnlyInData'])
  const a = analyze(openapi)
  assert.deepEqual(a.usages.get('/components/schemas/Ping'), [['x-webhooks', 'pinged', 'post', 'requestBody', 'content', 'application/json', 'schema', '$ref']])
  // 3.0's x-webhooks are shown as webhooks.
  const model = (a.model as { model: OpenApiModel }).model
  assert.deepEqual(model.webhooks.map((op) => `${op.method} ${op.route} ${op.loc.path.join('/')}`), ['post pinged x-webhooks/pinged/post'])

  const asyncapi = `asyncapi: 3.0.0
info: { title: T, version: '1.0.0' }
channels:
  orders:
    address: orders
    messages:
      OrderPlaced: { $ref: '#/components/messages/OrderPlaced' }
    bindings:
      ws:
        query: { $ref: '#/components/schemas/WsQuery' }
operations:
  onOrder:
    action: receive
    channel: { $ref: '#/channels/orders' }
    bindings:
      kafka:
        groupId: { $ref: '#/components/schemas/GroupId' }
components:
  messages:
    OrderPlaced:
      payload: { type: object, properties: { id: { type: string } } }
      bindings:
        kafka:
          key: { $ref: '#/components/schemas/OrderKey' }
  messageBindings:
    shared: { kafka: { key: { $ref: '#/components/schemas/SharedKey' } } }
  schemas:
    OrderKey: { type: string, format: uuid }
    GroupId: { type: string, enum: [orders-service] }
    WsQuery: { type: object, properties: { token: { type: string } } }
    SharedKey: { type: string }
`
  // Including a schema used only from a binding in components.
  assert.deepEqual(found(asyncapi), [])
})
