// Problems that the specifications say are not problems, from the spec-correctness check of the
// viewer: each fixture is the smallest document that showed one.
import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import type { OpenApiModel } from '../spec/openapi'
import { operationDetails } from '../spec/operation'
import { buildRequest } from '../spec/samples'

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

test('AsyncAPI payloads are checked by their schemaFormat; Avro and others are left alone', () => {
  // Before: an Avro payload's `type: record` was "not allowed", in 2.6 always and in 3.0 for
  // avro+json and avro+yaml; an OpenAPI-format payload got JSON Schema rules.
  const v2 = `asyncapi: 2.6.0
info: { title: T, version: '1.0.0' }
channels:
  users:
    subscribe:
      message:
        schemaFormat: 'application/vnd.apache.avro;version=1.9.0'
        payload: { type: record, name: User, fields: [{ name: id, type: long }] }
  prices:
    subscribe:
      message:
        schemaFormat: 'application/vnd.oai.openapi;version=3.0.0'
        payload: { type: object, properties: { price: { type: number, minimum: 0, exclusiveMinimum: true }, note: { type: string, nullable: true } } }
  plain:
    subscribe:
      message:
        payload: { type: record }
`
  assert.deepEqual(found(v2), ['bad-value channels/plain/subscribe/message/payload/type'])
  const v3 = (format: string, schema: string) => `asyncapi: 3.0.0
info: { title: T, version: '1.0.0' }
channels:
  c: { address: c, messages: { M: { payload: { schemaFormat: '${format}', schema: ${schema} } } } }
operations:
  o: { action: receive, channel: { $ref: '#/channels/c' } }
`
  const record = '{ type: record, name: User, fields: [{ name: id, type: long }] }'
  for (const format of ['application/vnd.apache.avro+json;version=1.9.0', 'application/vnd.apache.avro+yaml;version=1.9.0', 'application/vnd.apache.avro;version=1.9.0', 'application/raml+yaml;version=1.0', 'application/vnd.google.protobuf']) {
    assert.deepEqual(found(v3(format, record)), [], format)
  }
  const openapi = '{ type: object, properties: { price: { type: number, minimum: 0, exclusiveMinimum: true } } }'
  assert.deepEqual(found(v3('application/vnd.oai.openapi+json;version=3.0.0', openapi)), [])
  // The same schema under JSON Schema rules does have a problem, and is still reported.
  assert.deepEqual(found(v3('application/vnd.aai.asyncapi+json;version=3.0.0', openapi)), ['wrong-type channels/c/messages/M/payload/schema/properties/price/exclusiveMinimum'])
  assert.deepEqual(found(v3('application/schema+yaml;version=draft-07', record)), ['bad-value channels/c/messages/M/payload/schema/type'])
  // A skipped format's reference still counts: to a component, or as another file.
  const external = analyze(v3('application/vnd.apache.avro+json;version=1.9.0', "{ $ref: 'https://example.com/user.avsc' }")).problems
  assert.deepEqual(external.map((p) => p.rule), ['external-ref'])
})

test('an AsyncAPI discriminator is a property name', () => {
  // Before: "Expected object, found string", as for OpenAPI's Discriminator Object.
  const spec = (discriminator: string) => `asyncapi: 3.0.0
info: { title: T, version: '1.0.0' }
channels:
  pets: { address: pets, messages: { Pet: { payload: { $ref: '#/components/schemas/Pet' } } } }
operations:
  onPet: { action: receive, channel: { $ref: '#/channels/pets' } }
components:
  schemas:
    Pet: { type: object, discriminator: ${discriminator}, properties: { petType: { type: string } } }
`
  assert.deepEqual(found(spec('petType')), [])
  assert.deepEqual(found(spec('{ propertyName: petType }')), ['wrong-type components/schemas/Pet/discriminator'])
  assert.deepEqual(found(spec('petType').replace('asyncapi: 3.0.0', 'asyncapi: 2.6.0').replace(/channels:[\s\S]*?components:/, 'channels: {}\ncomponents:')), [])
})

test('OpenAPI 3.2: a media type may be a reference', () => {
  // Before: "Unknown field $ref in MediaType" and "Nothing refers to PetJson".
  const spec = (version: string) => `openapi: ${version}
info: { title: T, version: '1' }
paths:
  /pets:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json: { $ref: '#/components/mediaTypes/PetJson' }
components:
  mediaTypes:
    PetJson: { schema: { type: object } }
`
  assert.deepEqual(found(spec('3.2.0')), [])
  // Before 3.2 a content entry is a Media Type Object only.
  assert.deepEqual(analyze(spec('3.1.1')).problems.map((p) => p.rule), ['unknown-field', 'not-in-version', 'unused-component'])
})

test('OpenAPI 3.2: a security requirement may name a scheme by its URI', () => {
  // Before: both requirements were "not defined".
  const spec = (version: string, names: string[]) => `openapi: ${version}
info: { title: T, version: '1' }
security:
${names.map((n) => `  - '${n}': []`).join('\n')}
paths:
  /a: { get: { responses: { '200': { description: ok } } } }
components:
  securitySchemes:
    apiKey: { type: apiKey, in: header, name: X-Key }
`
  const local = '#/components/securitySchemes/apiKey'
  const other = 'https://example.com/shared.yaml#/components/securitySchemes/oauth'
  assert.deepEqual(found(spec('3.2.0', [local, 'apiKey'])), [])
  assert.deepEqual(analyze(spec('3.2.0', [other])).problems.map((p) => p.rule), ['external-ref'])
  assert.deepEqual(found(spec('3.2.0', ['#/components/securitySchemes/nope'])), ['unknown-security-scheme security/0/#/components/securitySchemes/nope'])
  // Before 3.2 a requirement names a component only.
  assert.deepEqual(found(spec('3.1.1', [local])), [`unknown-security-scheme security/0/${local}`])
  // The samples send the scheme the URI names.
  const a = analyze(spec('3.2.0', [local]))
  const model = (a.model as { model: OpenApiModel }).model
  const request = buildRequest(model, a.refs, model.operations[0], operationDetails(model, a.refs, model.operations[0]))
  assert.deepEqual(request.headers, [['X-Key', '<API_KEY>']])
})
