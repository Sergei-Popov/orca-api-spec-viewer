import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import type { AsyncApiModel } from './asyncapi'
import { detect } from './detect'
import { exampleFromSchema } from './example'
import type { OpenApiModel } from './openapi'
import { operationDetails, compareStatus } from './operation'
import { Refs } from './refs'
import { buildRequest, renderSample, shellQuote, toPython } from './samples'
import { constraints, refName, schemaTypes } from './schema'

function openapi(text: string): { model: OpenApiModel; refs: Refs } {
  const a = analyze(text)
  assert.equal(a.model?.kind, 'openapi')
  return { model: (a.model as { model: OpenApiModel }).model, refs: a.refs }
}

test('detects versions and names other documents', () => {
  assert.deepEqual(detect({ openapi: '3.0.3' }), { spec: true, kind: 'openapi', family: 'openapi30', version: '3.0.3' })
  assert.equal(detect({ openapi: '3.1.1' }).spec && (detect({ openapi: '3.1.1' }) as { family: string }).family, 'openapi31')
  assert.equal((detect({ openapi: '3.2.0' }) as { family: string }).family, 'openapi32')
  assert.equal((detect({ openapi: '3.3.0' }) as { newer?: boolean }).newer, true)
  assert.equal((detect({ swagger: '2.0' }) as { family: string }).family, 'swagger2')
  assert.equal((detect({ swagger: 2 }) as { family: string }).family, 'swagger2', 'YAML `swagger: 2.0` reads as a number')
  assert.equal((detect({ asyncapi: '2.6.0' }) as { family: string }).family, 'asyncapi2')
  assert.equal((detect({ asyncapi: '3.0.0' }) as { family: string }).family, 'asyncapi3')
  assert.equal((detect({ arazzo: '1.0.1' }) as { family: string }).family, 'arazzo1')
  assert.equal((detect({ overlay: '1.0.0' }) as { family: string }).family, 'overlay1')
  assert.deepEqual(detect({ swaggerVersion: '1.2' }), { spec: false, other: 'swagger1', field: 'swaggerVersion', version: '1.2' })
  assert.deepEqual(detect({ apiVersion: 'v1', kind: 'Pod' }), { spec: false, other: 'kubernetes' })
  assert.deepEqual(detect({ on: 'push', jobs: {} }), { spec: false, other: 'github-actions' })
  assert.deepEqual(detect({ name: 'x', dependencies: {} }), { spec: false, other: 'package-json' })
  assert.deepEqual(detect(null), { spec: false, other: 'empty' })
  assert.deepEqual(detect([1]), { spec: false, other: 'array' })
})

test('refs resolve pointers, anchors and $id, and report external files', () => {
  const root = {
    components: { schemas: { 'Pet Food': { $anchor: 'food', type: 'object' }, Node: { $id: 'https://example.com/node', type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } } } },
    a: { $ref: '#/b' },
    b: { $ref: '#/a' }
  }
  const refs = new Refs(root)
  const pointer = refs.resolve('#/components/schemas/Pet%20Food')
  assert.equal(pointer.kind, 'local')
  assert.equal(refs.resolve('#food').kind, 'local')
  assert.deepEqual(refs.resolve('https://example.com/node').kind === 'local' && refs.resolve('https://example.com/node'), {
    kind: 'local',
    loc: { doc: '', path: ['components', 'schemas', 'Node'] },
    value: root.components.schemas.Node
  })
  assert.deepEqual(refs.resolve('./pet.yaml#/Pet'), { kind: 'external', ref: './pet.yaml#/Pet', file: './pet.yaml', fragment: '#/Pet' })
  assert.equal(refs.resolve('#/nope').kind, 'missing')
  assert.equal(refs.follow(root.a, { doc: '', path: ['a'] }).cycle, true)
  // A loaded file makes the external reference resolve into it.
  refs.addDocument('pet.yaml', { Pet: { type: 'string' } })
  const loaded = refs.resolve('../schemas/pet.yaml#/Pet')
  assert.equal(loaded.kind, 'local')
  assert.equal(loaded.kind === 'local' && loaded.loc.doc, 'pet.yaml')
  assert.equal(refName('#/components/schemas/Pet%20Food'), 'Pet Food')
  assert.equal(refName('./schemas/pet.yaml#/Pet'), 'pet.yaml#/Pet')
})

const PETS_30 = `
openapi: 3.0.3
info: { title: Pets, version: "1.0" }
servers:
  - url: https://{region}.example.com/v1
    variables:
      region: { default: eu, enum: [eu, us] }
tags:
  - name: pets
    description: Everything about pets
paths:
  /pets/{petId}:
    parameters:
      - $ref: '#/components/parameters/PetId'
    get:
      tags: [pets]
      summary: Get a pet
      operationId: getPet
      parameters:
        - { name: verbose, in: query, schema: { type: boolean } }
      responses:
        '404': { description: Not found }
        '200':
          description: The pet
          headers:
            X-Rate-Limit: { schema: { type: integer } }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
        default: { description: Error }
    put:
      operationId: putPet
      security: [{ key: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Pet' }
      responses:
        '204': { description: Saved }
  /health:
    get:
      responses: { '200': { description: OK } }
components:
  parameters:
    PetId: { name: petId, in: path, required: true, schema: { type: string, format: uuid } }
  securitySchemes:
    key: { type: apiKey, in: header, name: X-Key }
  schemas:
    Pet:
      type: object
      required: [name]
      properties:
        id: { type: string, format: uuid, readOnly: true }
        name: { type: string, minLength: 1, example: Rex }
        tags: { type: array, items: { type: string } }
        parent: { $ref: '#/components/schemas/Pet' }
`

test('OpenAPI 3.0: operations, tags, servers and details', () => {
  const { model, refs } = openapi(PETS_30)
  assert.equal(model.operations.length, 3)
  assert.deepEqual(model.operations.map((op) => `${op.method} ${op.route}`), ['get /pets/{petId}', 'put /pets/{petId}', 'get /health'])
  assert.deepEqual(model.tags.map((t) => [t.name, t.operations.length]), [['pets', 1], ['', 2]])
  assert.equal(model.servers[0].resolved, 'https://eu.example.com/v1')
  const details = operationDetails(model, refs, model.operations[0])
  assert.deepEqual(details.params.map((p) => `${p.in}:${p.name}:${p.level}`), ['path:petId:path', 'query:verbose:operation'])
  assert.equal(details.params[0].ref, '#/components/parameters/PetId')
  assert.equal(details.params[1].style, 'form')
  assert.equal(details.params[1].explode, true)
  assert.deepEqual(details.responses.map((r) => r.status), ['200', '404', 'default'])
  assert.equal(details.responses[0].headers[0].name, 'X-Rate-Limit')
  assert.equal(details.responses[0].media[0].schema?.ref, '#/components/schemas/Pet')
  assert.deepEqual(model.components.get('schemas')?.map((c) => c.name), ['Pet'])
})

test('examples from schemas skip readOnly in requests and stop at recursion', () => {
  const { model, refs } = openapi(PETS_30)
  const schema = { $ref: '#/components/schemas/Pet' }
  const request = exampleFromSchema(refs, schema, { doc: '', path: [] }, { mode: 'request' })
  assert.deepEqual(request, { name: 'Rex', tags: ['string'] })
  const response = exampleFromSchema(refs, schema, { doc: '', path: [] }, { mode: 'response' }) as Record<string, unknown>
  assert.equal(response.id, '3fa85f64-5717-4562-b3fc-2c963f66afa6')
  assert.equal(response.parent, undefined, 'the recursive parent stops')
  void model
})

test('code samples for curl, fetch, Python and HTTPie', () => {
  const { model, refs } = openapi(PETS_30)
  const put = model.operations[1]
  const request = buildRequest(model, refs, put, operationDetails(model, refs, put))
  assert.equal(request.url, 'https://eu.example.com/v1/pets/3fa85f64-5717-4562-b3fc-2c963f66afa6')
  assert.deepEqual(request.headers, [['X-Key', '<API_KEY>'], ['Content-Type', 'application/json']])
  assert.deepEqual(request.body?.json, { name: 'Rex', tags: ['string'] })
  const curl = renderSample('curl', request)
  assert.match(curl, /^curl -X PUT https:\/\/eu\.example\.com\/v1\/pets\/3fa85f64/)
  assert.match(curl, /-H 'X-Key: <API_KEY>'/)
  assert.match(curl, /-d '\{\n {2}"name": "Rex"/)
  assert.match(renderSample('fetch', request), /method: 'PUT'[\s\S]*body: JSON\.stringify\(\{/)
  const python = renderSample('python', request)
  assert.match(python, /requests\.put\(/)
  assert.match(python, /json=\{\n {8}"name": "Rex"/)
  assert.ok(!python.includes('Content-Type'), 'json= sets the content type')
  assert.match(renderSample('httpie', request), /^http PUT https:[^\n]* \\\n {2}'X-Key:<API_KEY>' \\\n {2}--raw='\{"name":"Rex","tags":\["string"\]\}'$/)
  assert.equal(shellQuote("it's"), `'it'\\''s'`)
  assert.equal(toPython({ a: [true, null, 1.5] }), '{\n    "a": [\n        True,\n        None,\n        1.5,\n    ],\n}')
})

test('Swagger 2.0: body and formData parameters become a request body', () => {
  const { model, refs } = openapi(`{
    "swagger": "2.0",
    "info": {"title": "T", "version": "1"},
    "host": "api.example.com", "basePath": "/v2", "schemes": ["https", "http"],
    "consumes": ["application/json"], "produces": ["application/json"],
    "paths": {
      "/pets": {"post": {"parameters": [{"in": "body", "name": "body", "required": true, "schema": {"$ref": "#/definitions/Pet"}}],
                         "responses": {"200": {"description": "ok", "schema": {"$ref": "#/definitions/Pet"}, "examples": {"application/json": {"name": "a"}}}}}},
      "/upload": {"post": {"consumes": ["multipart/form-data"], "parameters": [{"in": "formData", "name": "file", "type": "file", "required": true}, {"in": "formData", "name": "note", "type": "string"}],
                           "responses": {"200": {"description": "ok"}}}}
    },
    "definitions": {"Pet": {"type": "object", "properties": {"name": {"type": "string"}}}}
  }`)
  assert.deepEqual(model.servers.map((s) => s.url), ['https://api.example.com/v2', 'http://api.example.com/v2'])
  const post = operationDetails(model, refs, model.operations[0])
  assert.equal(post.params.length, 0)
  assert.equal(post.body?.media[0].type, 'application/json')
  assert.equal(post.body?.media[0].schema?.ref, '#/definitions/Pet')
  assert.deepEqual(post.responses[0].media[0].examples[0].value, { name: 'a' })
  const upload = operationDetails(model, refs, model.operations[1])
  assert.equal(upload.body?.media[0].type, 'multipart/form-data')
  assert.deepEqual(upload.body?.formFields.map((f) => f.name), ['file', 'note'])
  const curl = renderSample('curl', buildRequest(model, refs, model.operations[1], upload))
  assert.match(curl, /-F file=@file\.bin/)
  assert.deepEqual(model.components.get('schemas')?.map((c) => c.key), ['c:/definitions/Pet'])
})

test('OpenAPI 3.1 webhooks and 3.2 query, additional operations and tag parents', () => {
  const m31 = openapi(`openapi: 3.1.0
info: { title: T, version: "1" }
webhooks:
  newPet:
    post:
      requestBody: { content: { application/json: { schema: { type: object } } } }
      responses: { '200': { description: ok } }
`).model
  assert.equal(m31.webhooks.length, 1)
  assert.equal(m31.webhooks[0].route, 'newPet')
  const m32 = openapi(`openapi: 3.2.0
info: { title: T, version: "1" }
tags:
  - { name: animals, summary: Animals }
  - { name: cats, parent: animals }
  - { name: beta, kind: badge }
paths:
  /search:
    query:
      tags: [cats, beta]
      responses: { '200': { description: ok } }
    additionalOperations:
      LINK:
        responses: { '200': { description: ok } }
`).model
  assert.deepEqual(m32.operations.map((op) => op.method), ['query', 'LINK'])
  assert.equal(m32.tags[0].title, 'Animals')
  assert.equal(m32.tags[0].children[0].name, 'cats')
  assert.equal(m32.tags[0].children[0].operations.length, 1)
  assert.ok(m32.badgeTags.has('beta'))
})

test('AsyncAPI 2 and 3: channels, operations and messages', () => {
  const v2 = analyze(`asyncapi: 2.6.0
info: { title: Lights, version: "1" }
servers:
  prod: { url: mqtt.example.com, protocol: mqtt }
channels:
  light/{id}:
    parameters:
      id: { schema: { type: string } }
    subscribe:
      operationId: onLight
      message:
        oneOf:
          - $ref: '#/components/messages/On'
          - { name: Off, payload: { type: object } }
components:
  messages:
    On: { name: On, payload: { type: object } }
`)
  const m2 = (v2.model as { model: AsyncApiModel }).model
  assert.equal(m2.channels[0].address, 'light/{id}')
  assert.equal(m2.operations[0].action, 'subscribe')
  assert.deepEqual(m2.operations[0].messages.map((m) => m.name), ['On', 'Off'])
  assert.deepEqual(v2.problems, [])
  const v3 = analyze(`asyncapi: 3.0.0
info: { title: Lights, version: "1" }
channels:
  lights:
    address: light/{id}
    parameters: { id: {} }
    messages:
      on: { payload: { type: object } }
operations:
  turnOn:
    action: send
    channel: { $ref: '#/channels/lights' }
    messages: [{ $ref: '#/channels/lights/messages/on' }]
`)
  const m3 = (v3.model as { model: AsyncApiModel }).model
  assert.equal(m3.operations[0].channel?.id, 'lights')
  assert.equal(m3.channels[0].operations[0].id, 'turnOn')
  assert.equal(m3.operations[0].messages[0].name, 'on')
  assert.deepEqual(v3.problems, [])
})

test('schema helpers', () => {
  assert.deepEqual(schemaTypes({ type: 'string', nullable: true }), ['string', 'null'])
  assert.deepEqual(schemaTypes({ properties: {} }), ['object'])
  assert.deepEqual(constraints({ minimum: 1, exclusiveMaximum: 10, pattern: '^a' }), [
    { kind: 'minimum', value: '1' },
    { kind: 'exclusiveMaximum', value: '10' },
    { kind: 'pattern', value: '^a' }
  ])
  assert.deepEqual(constraints({ maximum: 5, exclusiveMaximum: true }), [{ kind: 'exclusiveMaximum', value: '5' }])
  assert.deepEqual(['default', '2XX', '201', '200', '4XX', '404'].sort(compareStatus), ['200', '201', '2XX', '404', '4XX', 'default'])
})
