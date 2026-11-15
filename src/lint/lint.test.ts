import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import { problemMessage, stringsFor } from '../i18n'
import { constraints } from '../spec/schema'
import { constraintText } from '../ui/schema-view'

/** `rule@line` for each problem, to compare readably. */
function rules(text: string): string[] {
  const a = analyze(text)
  return a.problems.map((p) => {
    const position = p.offset !== undefined ? a.parsed.lines.position(p.offset) : a.parsed.position(p.path)
    return `${p.rule}@${position?.line ?? '?'}`
  })
}

function problemsOf(text: string) {
  return analyze(text).problems
}

test('a valid 3.1 document has no problems', () => {
  assert.deepEqual(
    rules(`openapi: 3.1.0
info: { title: T, version: "1" }
paths:
  /a/{id}:
    get:
      parameters: [{ name: id, in: path, required: true, schema: { type: [string, 'null'] } }]
      responses: { '200': { description: ok } }
`),
    []
  )
})

test('structure: required fields, unknown fields, wrong types, version-only fields', () => {
  const found = rules(`openapi: 3.0.3
info: { title: T }
webhooks: {}
paths:
  /a:
    get:
      sumary: typo
      deprecated: "yes"
      responses: { '200': {} }
`)
  assert.deepEqual(found, ['required-field@2', 'not-in-version@3', 'unknown-field@7', 'wrong-type@8', 'required-field@9'])
  const p = problemsOf(`openapi: 3.0.3
info: { title: T }
paths: {}
`)[0]
  assert.deepEqual(p.params, { field: 'version', object: 'Info' })
})

test('3.1 needs paths, components or webhooks; 3.2 makes response descriptions optional', () => {
  assert.deepEqual(rules('openapi: 3.1.0\ninfo: { title: T, version: "1" }\n'), ['one-of-fields@1'])
  assert.deepEqual(rules(`openapi: 3.2.0
info: { title: T, version: "1" }
paths:
  /a:
    query:
      responses: { '200': { summary: OK } }
`), [])
})

test('references: unresolved, circular, and one note per external file', () => {
  const found = problemsOf(`openapi: 3.0.3
info: { title: T, version: "1" }
paths:
  /a:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Missing' }
        '201': { $ref: './common.yaml#/responses/Created' }
        '202': { $ref: './common.yaml#/responses/Accepted' }
        '203': { $ref: '#/components/responses/Loop' }
components:
  responses:
    Loop: { $ref: '#/components/responses/Loop2' }
    Loop2: { $ref: '#/components/responses/Loop' }
`)
  const summary = found.map((p) => `${p.severity}:${p.rule}`)
  assert.ok(summary.includes('error:unresolved-ref'))
  assert.ok(summary.includes('error:circular-ref'))
  const external = found.filter((p) => p.rule === 'external-ref')
  assert.equal(external.length, 1)
  assert.deepEqual(external[0].params, { file: './common.yaml', count: 2 })
})

test('operations: duplicate ids, path parameters, missing responses, equivalent paths', () => {
  const found = rules(`openapi: 3.0.3
info: { title: T, version: "1" }
paths:
  /a/{id}:
    get:
      operationId: same
      responses: { '200': { description: ok } }
    post:
      operationId: same
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
        - { name: extra, in: path, required: true, schema: { type: string } }
        - { name: q, in: query, schema: { type: string } }
        - { name: q, in: query, schema: { type: string } }
  /a/{other}:
    get:
      parameters: [{ name: other, in: path, schema: { type: string } }]
      responses: { '200': { description: ok } }
`)
  assert.deepEqual(found, [
    'missing-responses@8',
    'path-param-not-required@17',
    'duplicate-operation-id@9',
    'path-param-undeclared@5',
    'duplicate-param@14',
    'path-param-unused@12',
    'equivalent-paths@15'
  ])
})

test('schemas: enum, default and example against types; bounds; patterns; keywords per version', () => {
  const found = rules(`openapi: 3.0.3
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    S:
      type: object
      properties:
        a: { type: integer, enum: [1, "2"], default: 3 }
        b: { type: string, default: 5, example: 6 }
        c: { type: string, minLength: 5, maxLength: 2, pattern: "([a-z" }
        d: { type: [string, 'null'] }
        e: { type: array }
        f: { const: 1 }
        g: { type: string, nullable: true, default: null }
`)
  assert.deepEqual(found, [
    'invalid-enum@9',
    'enum-default@9',
    'invalid-default@10',
    'invalid-example@10',
    'min-max@11',
    'invalid-pattern@11',
    'wrong-type@12',
    'required-field@13',
    'schema-keyword@14'
  ])
  assert.deepEqual(
    rules(`openapi: 3.1.0
info: { title: T, version: "1" }
components:
  schemas:
    S: { type: string, nullable: true, exclusiveMinimum: true }
`),
    ['schema-keyword@5', 'wrong-type@5']
  )
})

test('unused components, unknown security schemes and undefined server variables', () => {
  const found = rules(`openapi: 3.0.3
info: { title: T, version: "1" }
servers: [{ url: 'https://{host}/v1' }]
security: [{ nope: [] }]
paths:
  /a:
    get:
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Used' } } } }
components:
  schemas:
    Used: { type: object, properties: { child: { $ref: '#/components/schemas/Child' } } }
    Child: { type: string }
    Lonely: { type: string }
`)
  assert.deepEqual(found, ['unknown-security-scheme@4', 'server-variable-undefined@3', 'unused-component@14'])
})

test('Swagger 2.0 rules', () => {
  const found = rules(`swagger: "2.0"
info: { title: T, version: "1" }
host: https://api.example.com
paths:
  /a/{id}:
    post:
      parameters:
        - { name: id, in: path, required: true, type: string }
        - { name: b1, in: body, schema: { type: object } }
        - { name: f, in: formData, type: string }
        - { name: q, in: query }
      responses: { '200': { description: ok, schema: { type: array } } }
`)
  assert.deepEqual(found, ['required-field@11', 'bad-value@3', 'required-field@12', 'multiple-body@9'])
})

test('AsyncAPI channel parameters and Arazzo ids', () => {
  assert.deepEqual(
    rules(`asyncapi: 3.0.0
info: { title: T, version: "1" }
channels:
  c:
    address: room/{room}
operations:
  o: { action: publish, channel: { $ref: '#/channels/c' } }
`),
    ['bad-value@7', 'channel-param-undeclared@4']
  )
  assert.deepEqual(
    rules(`arazzo: 1.0.1
info: { title: T, version: "1" }
sourceDescriptions: [{ name: api, url: ./openapi.yaml, type: openapi }]
workflows:
  - workflowId: w
    steps:
      - { stepId: s1, operationId: $sourceDescriptions.nope.getPet }
      - { stepId: s1, workflowId: missing }
      - { stepId: s3 }
`),
    ['one-of-fields@9', 'duplicate-id@8', 'unknown-target@7', 'unknown-target@8']
  )
})

test('syntax problems keep their parser wording and line', () => {
  const a = analyze('openapi: 3.0.3\ninfo:\n  title: [unclosed\n')
  const syntax = a.problems.filter((p) => p.rule === 'syntax')
  assert.ok(syntax.length > 0)
  assert.ok(syntax[0].text && syntax[0].text.length > 0)
})

test('Arazzo inputs are JSON Schema 2020-12: boolean schemas, type arrays, const and prefixItems', () => {
  assert.deepEqual(
    rules(`arazzo: 1.0.1
info: { title: T, version: "1" }
sourceDescriptions: [{ name: api, url: ./openapi.yaml, type: openapi }]
workflows:
  - workflowId: w
    inputs:
      type: object
      properties:
        a: true
        b: false
        c: { type: array, prefixItems: [{ type: string }], items: false }
        d: { type: [string, 'null'], const: x }
        customer:
          oneOf:
            - { type: object, properties: { name: { type: string } }, additionalProperties: false }
    steps:
      - { stepId: s1, operationId: getPet }
`),
    []
  )
  // OpenAPI 3.0 keeps its own rules.
  assert.deepEqual(
    rules(`openapi: 3.0.3
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    S: { type: object, properties: { a: true } }
`),
    ['wrong-type@6']
  )
})

test('Russian messages and chips have no English phrases in them', () => {
  const ru = stringsFor('ru-RU')
  const en = stringsFor('en')
  const a = analyze(`openapi: 3.1.0
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    S:
      type: object
      required: x
      minLength: -1
      multipleOf: 0
      additionalProperties: 3
`)
  const messages = a.problems.filter((p) => p.rule === 'wrong-type').map((p) => problemMessage(ru, p))
  assert.deepEqual(messages.sort(), [
    'Ожидается boolean или object, а здесь number.',
    'Ожидается массив строк, а здесь string.',
    'Ожидается неотрицательное целое число, а здесь -1.',
    'Ожидается число больше 0, а здесь 0.'
  ])
  assert.ok(a.problems.filter((p) => p.rule === 'wrong-type').some((p) => problemMessage(en, p) === 'Expected array of strings, found string.'))
  const chips = constraints({ minLength: 1, maxItems: 3, minProperties: 2, minContains: 1, uniqueItems: true }).map((c) => constraintText(c, ru.constraintWords))
  assert.deepEqual(chips, ['длина ≥ 1', 'элементов ≤ 3', 'свойств ≥ 2', 'совпадений ≥ 1', 'без повторов'])
  assert.equal(ru.lineCount(5), '5 строк')
  assert.equal(ru.resultsOf(200, 1379), `200 из ${(1379).toLocaleString('ru')} результатов`)
  assert.equal(en.resultsOf(200, 1379), '200 of 1,379 results')
  // Every key of the English table has a Russian one of the same kind.
  for (const key of Object.keys(en) as (keyof typeof en)[]) assert.equal(typeof ru[key], typeof en[key], key)
  for (const rule of Object.keys(en.messagesByRule)) assert.ok(rule in ru.messagesByRule, rule)
})

test('an enum of 50,000 values is checked for repeats in one pass', () => {
  const values = Array.from({ length: 50_000 }, (_, i) => `value_${i}`)
  const spec = (enumValues: unknown[]) =>
    JSON.stringify({ openapi: '3.1.0', info: { title: 'T', version: '1' }, components: { schemas: { Big: { type: 'string', enum: enumValues } } } })
  analyze(spec(values.slice(0, 100)))
  const started = performance.now()
  const a = analyze(spec([...values, 'value_49999']))
  const ms = performance.now() - started
  // Before: about 10 s, quadratic in the values.
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`)
  const repeats = a.problems.filter((p) => p.rule === 'invalid-enum')
  assert.deepEqual(repeats.map((p) => [p.path.at(-1), p.params.type]), [['50000', 'unique']])
})
