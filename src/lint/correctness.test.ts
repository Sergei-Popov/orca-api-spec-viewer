// Problems that the specifications say are not problems, from the spec-correctness check of the
// viewer: each fixture is the smallest document that showed one.
import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import { asyncSecurityItems, followedSchemaWithFormat, messagePayload, replyOf, schemaWithFormat, type AsyncApiModel } from '../spec/asyncapi'
import { exampleFromSchema } from '../spec/example'
import type { OpenApiModel } from '../spec/openapi'
import { operationDetails } from '../spec/operation'
import { isObject } from '../spec/pointer'
import { buildRequest } from '../spec/samples'
import { flowScopes, neededScopes, schemeLocation } from '../ui/openapi-pages'

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

test('responses are optional from 3.1 on, so leaving them out is a note', () => {
  // Before: a warning on the OAI's own v3.1 non-oauth-scopes example.
  const spec = (version: string) => `openapi: ${version}
info: { title: T, version: '1' }
paths:
  /a: { get: { summary: no responses } }
`
  const severities = (version: string) => analyze(spec(version)).problems.filter((p) => p.rule === 'missing-responses').map((p) => p.severity)
  assert.deepEqual(severities('3.0.3'), ['error'])
  assert.deepEqual(severities('3.1.1'), ['info'])
  assert.deepEqual(severities('3.2.0'), ['info'])
})

test('a schema used as an allOf part may require what the other parts define', () => {
  // Before: required-not-defined on the mixin (the official websocket-gemini examples).
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /a: { get: { responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Event' } } } } } } }
components:
  schemas:
    Typed: { type: object, required: [type], properties: { id: { type: string } } }
    Event:
      allOf:
        - $ref: '#/components/schemas/Typed'
        - { type: object, required: [kind], properties: { type: { type: string } } }
        - { type: object, properties: { kind: { type: string } } }
    Lonely: { type: object, required: [missing], properties: { id: { type: string } } }
`
  // The inline part that requires `kind` is a mixin too; a schema that is no part still warns.
  assert.deepEqual(found(spec), ['required-not-defined components/schemas/Lonely/required', 'unused-component components/schemas/Lonely'])
})

test('OpenAPI 3.2 querystring parameters: checked, and written into the samples', () => {
  // Before: "“form” is not allowed here; expected ." for a style, no check for a second
  // querystring or one beside query parameters, and no querystring in the samples.
  const spec = `openapi: 3.2.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /form:
    get:
      parameters:
        - { name: q, in: querystring, required: true, content: { application/x-www-form-urlencoded: { example: { term: cat, tag: [a, b] } } } }
      responses: { '200': { description: ok } }
  /json:
    get:
      parameters:
        - { name: q, in: querystring, required: true, content: { application/json: { example: { a: 1 } } } }
      responses: { '200': { description: ok } }
  /serialized:
    get:
      parameters:
        - name: q
          in: querystring
          required: true
          content: { text/plain: { examples: { one: { serializedValue: '?x=1&y=two' } } } }
      responses: { '200': { description: ok } }
  /styled:
    get:
      parameters:
        - { name: q, in: querystring, style: form, explode: true, content: { application/x-www-form-urlencoded: { schema: { type: object } } } }
      responses: { '200': { description: ok } }
  /twice:
    get:
      parameters:
        - { name: q1, in: querystring, content: { application/x-www-form-urlencoded: { schema: { type: object } } } }
        - { name: q2, in: querystring, content: { application/json: { schema: { type: object } } } }
      responses: { '200': { description: ok } }
  /mixed:
    parameters: [{ name: limit, in: query, schema: { type: integer } }]
    get:
      parameters:
        - { name: q, in: querystring, content: { application/json: { schema: { type: object } } } }
      responses: { '200': { description: ok } }
  /example:
    get:
      responses:
        '200':
          description: ok
          content: { text/plain: { examples: { both: { serializedValue: 'a', externalValue: 'https://example.com/a.txt' } } } }
`
  assert.deepEqual(found(spec), [
    'querystring-field paths//styled/get/parameters/0/style',
    'querystring-field paths//styled/get/parameters/0/explode',
    'mutually-exclusive paths//example/get/responses/200/content/text~1plain/examples/both',
    'querystring-conflict paths//twice/get/parameters/1',
    'querystring-conflict paths//mixed/get/parameters/0'
  ].map((p) => p.replace('text~1plain', 'text/plain')))
  const a = analyze(spec)
  const model = (a.model as { model: OpenApiModel }).model
  const request = (route: string) => {
    const op = model.operations.find((o) => o.route === route)!
    return buildRequest(model, a.refs, op, operationDetails(model, a.refs, op))
  }
  assert.deepEqual(request('/form').query, [['term', 'cat'], ['tag', 'a'], ['tag', 'b']])
  assert.equal(request('/json').url, 'https://api.test/json?%7B%22a%22%3A1%7D')
  assert.equal(request('/serialized').url, 'https://api.test/serialized?x=1&y=two')
})

test('additionalOperations: a standard method in other case is a warning', () => {
  // Before: "get" and "Query" were errors, though the 3.2 schema forbids only GET, QUERY, ….
  const spec = `openapi: 3.2.0
info: { title: T, version: '1' }
paths:
  /extra:
    additionalOperations:
      GET: { responses: { '200': { description: ok } } }
      get: { responses: { '200': { description: ok } } }
      Query: { responses: { '200': { description: ok } } }
      PURGE: { responses: { '200': { description: ok } } }
`
  assert.deepEqual(analyze(spec).problems.map((p) => `${p.severity} ${p.rule} ${p.path.at(-1)}`), ['error bad-key GET', 'warning bad-key get', 'warning bad-key Query'])
})

test('OpenAPI 3.1+: a reference’s siblings apply to what it points at', () => {
  // Before: `{ $ref: Id, readOnly: true }` lost readOnly (so the request example sent id), and
  // maxLength, examples, minItems, default and overriding descriptions were all dropped.
  const spec = (version: string) => `openapi: ${version}
info: { title: T, version: '1' }
paths:
  /pets:
    post:
      parameters:
        - { $ref: '#/components/parameters/Limit', description: Overridden, required: true }
      requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/Pet' } } } }
      responses:
        '200': { $ref: '#/components/responses/Ok', description: Overridden response }
components:
  parameters:
    Limit: { name: limit, in: query, description: Original, schema: { type: integer } }
  responses:
    Ok: { description: Original response }
  schemas:
    Pet:
      type: object
      properties:
        id: { $ref: '#/components/schemas/Id', readOnly: true }
        nick: { $ref: '#/components/schemas/Name', maxLength: 10, examples: [Rex] }
        size: { $ref: '#/components/schemas/Size', maximum: 50, minimum: 1 }
        tags: { $ref: '#/components/schemas/Tags', minItems: 1 }
        next: { $ref: '#/components/schemas/Pet', description: The next pet }
    Id: { type: integer }
    Name: { type: string, maxLength: 40 }
    Size: { type: integer, minimum: 0, maximum: 100 }
    Tags: { type: array, items: { type: string } }
`
  const view = (version: string) => {
    const a = analyze(spec(version))
    const model = (a.model as { model: OpenApiModel }).model
    const details = operationDetails(model, a.refs, model.operations[0])
    const media = details.body!.media[0]
    const props = (a.refs.follow(media.schema!.value, media.schema!.loc).value as { properties: Record<string, unknown> }).properties
    const prop = (name: string) => a.refs.follow(props[name], { doc: '', path: ['components', 'schemas', 'Pet', 'properties', name] }).value
    return {
      param: [details.params[0].description, details.params[0].required],
      response: details.responses[0].description,
      example: exampleFromSchema(a.refs, media.schema!.value, media.schema!.loc, { mode: 'request' }) as Record<string, unknown>,
      prop
    }
  }
  const v31 = view('3.1.1')
  // A Reference Object overrides summary and description only.
  assert.deepEqual(v31.param, ['Overridden', false])
  assert.equal(v31.response, 'Overridden response')
  assert.equal('id' in v31.example, false, 'readOnly from the sibling')
  assert.equal(v31.example.nick, 'Rex')
  assert.deepEqual(v31.prop('nick'), { type: 'string', maxLength: 10, examples: ['Rex'] })
  // Where both give a bound, the stricter applies.
  assert.deepEqual(v31.prop('size'), { type: 'integer', minimum: 1, maximum: 50 })
  assert.deepEqual(v31.prop('tags'), { type: 'array', items: { type: 'string' }, minItems: 1 })
  // The same reference gives the same view, so recursion is still seen as recursion.
  assert.equal(v31.prop('next'), v31.prop('next'))
  assert.equal((v31.prop('next') as { description: string }).description, 'The next pet')
  // In 3.0 siblings are ignored.
  const v30 = view('3.0.3')
  assert.deepEqual(v30.param, ['Original', false])
  assert.equal(v30.response, 'Original response')
  assert.ok('id' in v30.example)
  assert.deepEqual(v30.prop('nick'), { type: 'string', maxLength: 40 })
})

test('OpenAPI 3.1+: a callback reference’s summary and description add no callbacks', () => {
  // Before (a regression of the sibling fix): the operation listed `onEvent description` and
  // `onEvent summary` as callback expressions, since a Callback Object is a map of expressions.
  const a = analyze(`openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /subscribe:
    post:
      callbacks:
        onEvent: { $ref: '#/components/callbacks/Event', description: Sent when something happens, summary: Event callback }
      responses: { '200': { description: ok } }
components:
  callbacks:
    Event:
      '{$request.body#/url}':
        post: { responses: { '200': { description: ok } } }
`)
  const model = (a.model as { model: OpenApiModel }).model
  const details = operationDetails(model, a.refs, model.operations[0])
  assert.deepEqual(details.callbacks.map((c) => `${c.name} ${c.expression}`), ['onEvent {$request.body#/url}'])
  assert.deepEqual(a.problems.map((p) => p.rule), [])
})

test('security requirements count as uses of their schemes', () => {
  // Before: every scheme page said "Nothing in this document refers to it", though servers and
  // operations named it (by name in OpenAPI and AsyncAPI 2, by $ref in AsyncAPI 3).
  const uses = (text: string) => {
    const a = analyze(text)
    return Object.fromEntries([...a.usages].filter(([k]) => k.includes('securitySchemes')).map(([k, v]) => [k.split('/').pop(), v.map((p) => p.join('/'))]))
  }
  assert.deepEqual(
    uses(`openapi: 3.1.0
info: { title: T, version: '1' }
security: [{ bearer: [] }]
paths:
  /a: { get: { security: [{ key: [] }], responses: { '200': { description: ok } } } }
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
    key: { type: apiKey, in: header, name: X-Key }
`),
    { bearer: ['security/0/bearer'], key: ['paths//a/get/security/0/key'] }
  )
  assert.deepEqual(
    uses(`asyncapi: 2.6.0
info: { title: T, version: '1' }
servers: { prod: { url: example.com, protocol: mqtt, security: [{ apiKey: [] }] } }
channels:
  a: { publish: { operationId: pub, security: [{ oauth: [write] }], message: { payload: { type: string } } } }
components:
  securitySchemes:
    apiKey: { type: apiKey, in: user }
    oauth: { type: oauth2, flows: { clientCredentials: { tokenUrl: 'https://example.com/t', availableScopes: { write: w } } } }
`),
    { apiKey: ['servers/prod/security/0/apiKey'], oauth: ['channels/a/publish/security/0/oauth'] }
  )
  const v3 = `asyncapi: 3.0.0
info: { title: T, version: '1' }
servers: { prod: { host: example.com, protocol: mqtt, security: [{ $ref: '#/components/securitySchemes/apiKey' }] } }
channels: { a: { address: a, messages: { m: { payload: { type: string } } } } }
operations:
  send: { action: send, channel: { $ref: '#/channels/a' }, security: [{ $ref: '#/components/securitySchemes/oidc' }, { $ref: '#/components/securitySchemes/gone' }] }
components:
  securitySchemes:
    apiKey: { type: apiKey, in: user }
    oidc: { type: openIdConnect, openIdConnectUrl: 'https://example.com/.well-known' }
`
  assert.deepEqual(uses(v3), { apiKey: ['servers/prod/security/0/$ref'], oidc: ['operations/send/security/0/$ref'] })
  // And a reference to a scheme that is not there is now reported.
  assert.deepEqual(found(v3), ['unresolved-ref operations/send/security/1/$ref'])
})

test('AsyncAPI traits are merged into messages and operations', () => {
  // Before: every streetlights message lacked the commonHeaders trait's headers, and operation
  // trait bindings were not shown.
  const v3 = `asyncapi: 3.0.0
info: { title: T, version: '1' }
channels:
  lights:
    address: lights
    messages:
      measured: { $ref: '#/components/messages/measured' }
operations:
  receiveLight:
    action: receive
    channel: { $ref: '#/channels/lights' }
    traits: [{ $ref: '#/components/operationTraits/mqtt' }]
    bindings: { mqtt: { retain: true } }
components:
  messages:
    measured:
      name: measured
      contentType: application/json
      traits: [{ $ref: '#/components/messageTraits/commonHeaders' }, { contentType: text/plain, summary: From a trait }]
      payload: { type: object }
  messageTraits:
    commonHeaders:
      headers: { type: object, properties: { my-app-header: { type: integer } } }
  operationTraits:
    mqtt:
      bindings: { mqtt: { qos: 1, retain: false } }
`
  const model3 = (analyze(v3).model as { model: AsyncApiModel }).model
  const msg3 = model3.channels[0].messages[0].value
  assert.deepEqual(msg3.headers, { type: 'object', properties: { 'my-app-header': { type: 'integer' } } })
  // In 3.x the message's own fields win over its traits'.
  assert.equal(msg3.contentType, 'application/json')
  assert.equal(msg3.summary, 'From a trait')
  assert.deepEqual(model3.operations[0].op.bindings, { mqtt: { qos: 1, retain: true } })
  assert.deepEqual(model3.operations[0].messages[0].value.headers, msg3.headers)

  const v2 = `asyncapi: 2.6.0
info: { title: T, version: '1' }
channels:
  lights:
    subscribe:
      traits: [{ $ref: '#/components/operationTraits/kafka' }]
      message:
        contentType: application/json
        traits: [{ $ref: '#/components/messageTraits/commonHeaders' }]
        payload: { type: object }
components:
  messageTraits:
    commonHeaders:
      contentType: text/plain
      headers: { type: object, properties: { my-app-header: { type: integer } } }
  operationTraits:
    kafka:
      bindings: { kafka: { clientId: { type: string } } }
`
  const model2 = (analyze(v2).model as { model: AsyncApiModel }).model
  const msg2 = model2.operations[0].messages[0].value
  assert.ok(isObject(msg2.headers))
  // In 2.x a trait is applied over the message.
  assert.equal(msg2.contentType, 'text/plain')
  assert.deepEqual(model2.operations[0].op.bindings, { kafka: { clientId: { type: 'string' } } })
})

test('AsyncAPI 3 security: inline schemes, availableScopes, scopes needed, and replies', () => {
  // Before: an inline scheme was shown as its keys ("type + description + flows + scopes"), a flow's
  // availableScopes and an httpApiKey's name and place were not shown, and a reply without
  // messages showed no messages.
  const spec = `asyncapi: 3.0.0
info: { title: T, version: '1' }
servers:
  production:
    host: broker.example.com
    protocol: mqtt
    security:
      - $ref: '#/components/securitySchemes/key'
      - type: oauth2
        flows: { implicit: { authorizationUrl: 'https://auth.example.com', availableScopes: { 'lights:on': Switch on } } }
        scopes: ['lights:on']
channels:
  ping: { address: ping, messages: { ping: { payload: { type: string } } } }
  pong:
    address: pong
    messages:
      pong: { payload: { type: string } }
      error: { payload: { type: object } }
operations:
  ping:
    action: send
    channel: { $ref: '#/channels/ping' }
    reply: { channel: { $ref: '#/channels/pong' } }
  pingOne:
    action: send
    channel: { $ref: '#/channels/ping' }
    reply: { channel: { $ref: '#/channels/pong' }, messages: [{ $ref: '#/channels/pong/messages/pong' }] }
components:
  securitySchemes:
    key: { type: httpApiKey, in: header, name: X-Key }
    user: { type: apiKey, in: user }
`
  const a = analyze(spec)
  assert.deepEqual(a.problems.map((p) => p.rule), [])
  const model = (a.model as { model: AsyncApiModel }).model
  const items = asyncSecurityItems(model.family, model.servers[0].value.security)
  assert.deepEqual(items.map((i) => `${i.kind} ${i.name}`), ['ref key', 'inline oauth2'])
  const inline = items[1] as { value: Record<string, unknown> }
  const flows = inline.value.flows as Record<string, Record<string, unknown>>
  assert.deepEqual(flowScopes(flows.implicit), { 'lights:on': 'Switch on' })
  assert.deepEqual(neededScopes(inline.value), ['lights:on'])
  const schemes = (model.root.components as Record<string, Record<string, Record<string, unknown>>>).securitySchemes
  assert.equal(schemeLocation(schemes.key), 'header · X-Key')
  assert.equal(schemeLocation(schemes.user), 'user')
  // 2.x lists requirements by name, with scopes.
  assert.deepEqual(asyncSecurityItems('asyncapi2', [{ oauth: ['write'] }]), [{ kind: 'requirement', name: 'oauth', scopes: ['write'] }])
  const reply = (id: string) => replyOf(a.refs, model, model.operations.find((o) => o.id === id)!)!
  assert.equal(reply('ping').channel?.id, 'pong')
  assert.deepEqual(reply('ping').messages.map((m) => m.name), ['pong', 'error'])
  assert.deepEqual(reply('pingOne').messages.map((m) => m.name), ['pong'])
})

test('a component Link with a bad operationId is reported once, not once per use', () => {
  // Before: the same problem at the same path, once for the definition and once per response.
  const problems = found(`openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /a:
    get:
      operationId: getA
      responses:
        '200': { description: ok, links: { next: { $ref: '#/components/links/Next' } } }
        '201': { description: ok, links: { next: { $ref: '#/components/links/Next' } } }
components:
  links:
    Next: { operationId: missingOp }
`)
  assert.deepEqual(problems.filter((p) => p.startsWith('link-operation')), ['link-operation components/links/Next/operationId'])
})

test('a $ref that is not a string is reported, with the YAML quoting hint', () => {
  // Before: `$ref: #/components/schemas/Pet` unquoted is `$ref: null` in YAML, and nothing was said.
  for (const version of ['3.0.3', '3.1.0']) {
    const result = analyze(`openapi: ${version}
info: { title: T, version: '1' }
paths:
  /a:
    get:
      parameters:
        - $ref: 42
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  details:
                    $ref: #/components/schemas/Pet
components:
  schemas:
    Pet: { type: object }
`)
    const wrong = result.problems.filter((p) => p.rule === 'wrong-type' && p.path.at(-1) === '$ref')
    assert.deepEqual(wrong.map((p) => [p.path.join('/'), p.params.actual]), [
      ['paths//a/get/parameters/0/$ref', 'integer'],
      ['paths//a/get/responses/200/content/application/json/schema/properties/details/$ref', 'null']
    ], version)
    assert.equal(wrong[0].params.expected, 'reference string')
    // No knock-on noise from the parameter's missing fields.
    assert.ok(!result.problems.some((p) => p.rule === 'required-field' && p.path.join('/') === 'paths//a/get/parameters/0'), version)
  }
})

test('AsyncAPI 2.x: a schemaFormat from a message trait picks the payload rules', () => {
  // Before: an Avro payload whose schemaFormat came from a trait was checked as a JSON Schema.
  const problems = found(`asyncapi: 2.6.0
info: { title: T, version: '1' }
channels:
  users:
    subscribe:
      message:
        traits: [{ $ref: '#/components/messageTraits/Avro' }]
        payload: { type: record, name: User, fields: [{ name: id, type: long }] }
components:
  messageTraits:
    Avro: { schemaFormat: 'application/vnd.apache.avro;version=1.9.0' }
`)
  assert.deepEqual(problems, [])
})

test('AsyncAPI: references inside bindings are checked, not only counted', () => {
  // Before: a binding $ref to a missing schema gave no error, and an external one no note.
  const result = analyze(`asyncapi: 2.6.0
info: { title: T, version: '1' }
channels:
  users:
    subscribe:
      message:
        payload: { type: string }
        bindings:
          kafka:
            key: { $ref: '#/components/schemas/Missing' }
  costs:
    subscribe:
      message:
        payload: { type: string }
        bindings:
          kafka:
            key: { $ref: 'https://example.com/key.avsc' }
  ok:
    subscribe:
      message:
        payload: { type: string }
        bindings:
          kafka:
            key: { $ref: '#/components/schemas/Key' }
components:
  schemas:
    Key: { type: string }
`)
  assert.deepEqual(result.problems.map((p) => `${p.rule} ${p.path.join('/')}`), [
    'unresolved-ref channels/users/subscribe/message/bindings/kafka/key/$ref',
    'external-ref channels/costs/subscribe/message/bindings/kafka/key/$ref'
  ])
  // An extension's references still only count as uses.
  assert.deepEqual(found(`asyncapi: 2.6.0
info: { title: T, version: '1' }
channels:
  a: { subscribe: { message: { payload: { type: string } } } }
x-tooling: { schema: { $ref: '#/components/schemas/Missing' } }
`), [])
})

test('AsyncAPI: a payload that is not a JSON Schema is shown as its source, with its format', () => {
  // Before: an Avro record was drawn as a schema tree (just `record`, no fields), and a 2.x
  // message's schemaFormat was never shown.
  const v2 = analyze(`asyncapi: 2.6.0
info: { title: T, version: '1' }
channels:
  users:
    subscribe:
      message:
        traits: [{ $ref: '#/components/messageTraits/Avro' }]
        payload: { type: record, name: User, fields: [{ name: id, type: long }] }
  plain:
    subscribe:
      message:
        schemaFormat: 'application/schema+json;version=draft-07'
        payload: { type: string }
components:
  messageTraits:
    Avro: { schemaFormat: 'application/vnd.apache.avro;version=1.9.0' }
`)
  const m2 = (v2.model as { model: AsyncApiModel }).model
  const shown2 = m2.operations.map((op) => op.messages.map((msg) => messagePayload(msg.value, msg.loc, m2.family)))
  assert.deepEqual(shown2.map(([p]) => [p?.format, p?.source]), [['application/vnd.apache.avro;version=1.9.0', true], ['application/schema+json;version=draft-07', false]])
  const v3 = analyze(`asyncapi: 3.0.0
info: { title: T, version: '1' }
channels:
  users: { address: users, messages: { User: { payload: { schemaFormat: 'application/vnd.apache.avro+json;version=1.9.0', schema: { type: record, name: User, fields: [] } } } } }
operations:
  get: { action: receive, channel: { $ref: '#/channels/users' } }
components:
  schemas:
    Json: { schemaFormat: 'application/schema+yaml;version=draft-07', schema: { type: string } }
    Plain: { type: string }
`)
  const m3 = (v3.model as { model: AsyncApiModel }).model
  const user = m3.operations[0].messages[0]
  const p3 = messagePayload(user.value, user.loc, m3.family)!
  assert.equal(p3.source, true)
  assert.deepEqual(p3.loc.path, ['channels', 'users', 'messages', 'User', 'payload', 'schema'])
  const at = (name: string) => ({ doc: '', path: ['components', 'schemas', name] })
  const json = schemaWithFormat((v3.parsed.value as any).components.schemas.Json, at('Json'))!
  assert.deepEqual([json.source, json.loc.path.at(-1)], [false, 'schema'])
  assert.equal(schemaWithFormat((v3.parsed.value as any).components.schemas.Plain, at('Plain')), undefined)
})

test('a security requirement on a callback operation counts as a use of its scheme', () => {
  // Before: a scheme used only by a callback operation said "Nothing in this document refers to it".
  const a = analyze(`openapi: 3.0.3
info: { title: T, version: '1' }
paths:
  /a:
    post:
      callbacks:
        cb:
          '{$request.body#/url}':
            post: { security: [{ cbOnly: [] }], responses: { '200': { description: ok } } }
        shared: { $ref: '#/components/callbacks/Shared' }
      responses: { '200': { description: ok } }
  /b:
    post:
      callbacks: { shared: { $ref: '#/components/callbacks/Shared' } }
      responses: { '200': { description: ok } }
components:
  callbacks:
    Shared:
      '{$request.body#/hook}':
        post: { security: [{ sharedKey: [] }], responses: { '200': { description: ok } } }
  securitySchemes:
    cbOnly: { type: http, scheme: bearer }
    sharedKey: { type: apiKey, in: header, name: X-Key }
`)
  const uses = (name: string) => a.usages.get(`/components/securitySchemes/${name}`)?.map((p) => p.join('/'))
  assert.deepEqual(uses('cbOnly'), ['paths//a/post/callbacks/cb/{$request.body#/url}/post/security/0/cbOnly'])
  assert.deepEqual(uses('sharedKey'), ['components/callbacks/Shared/{$request.body#/hook}/post/security/0/sharedKey'])
  assert.ok(!a.problems.some((p) => p.rule === 'unused-component'), JSON.stringify(a.problems))
})

test('AsyncAPI 3: a payload or headers $ref to a Multi Format Schema Object shows its schema and format', () => {
  // Before: the body showed only the component's name, with no format, source, fields or example.
  const a = analyze(`asyncapi: 3.0.0
info: { title: T, version: '1' }
channels:
  c:
    address: c
    messages:
      J: { payload: { $ref: '#/components/schemas/JsonMulti' }, headers: { $ref: '#/components/schemas/HdrMulti' } }
      A: { payload: { $ref: '#/components/schemas/AvroMulti' } }
      P: { payload: { $ref: '#/components/schemas/Plain' } }
operations:
  send: { action: send, channel: { $ref: '#/channels/c' } }
components:
  schemas:
    JsonMulti: { schemaFormat: 'application/schema+json;version=draft-07', schema: { type: object, properties: { a: { type: string }, b: { type: integer } } } }
    AvroMulti: { schemaFormat: 'application/vnd.apache.avro;version=1.9.0', schema: { type: record, name: R, fields: [] } }
    HdrMulti: { schemaFormat: 'application/vnd.aai.asyncapi+json;version=3.0.0', schema: { type: object, properties: { h: { type: string } } } }
    Plain: { type: object, properties: { a: { type: string } } }
`)
  const m = (a.model as { model: AsyncApiModel }).model
  const shown = Object.fromEntries(m.operations[0].messages.map((msg) => [msg.name, messagePayload(msg.value, msg.loc, m.family, a.refs)]))
  assert.deepEqual([shown.J?.format, shown.J?.source, shown.J?.loc.path], ['application/schema+json;version=draft-07', false, ['components', 'schemas', 'JsonMulti', 'schema']])
  assert.deepEqual(exampleFromSchema(a.refs, shown.J?.value, shown.J!.loc, { mode: 'response' }), { a: 'string', b: 0 })
  assert.deepEqual([shown.A?.format, shown.A?.source], ['application/vnd.apache.avro;version=1.9.0', true])
  // A reference to a plain schema stays the reference, drawn with its name as before.
  assert.deepEqual([shown.P?.format, shown.P?.loc.path.at(-1)], [undefined, 'payload'])
  const j = m.operations[0].messages.find((msg) => msg.name === 'J')!
  const headers = followedSchemaWithFormat(a.refs, j.value.headers, { doc: j.loc.doc, path: [...j.loc.path, 'headers'] })
  assert.deepEqual([headers?.format, headers?.loc.path], ['application/vnd.aai.asyncapi+json;version=3.0.0', ['components', 'schemas', 'HdrMulti', 'schema']])
})
