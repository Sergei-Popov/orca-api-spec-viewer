import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import { lintDocument } from '../lint/index'
import { prettyJson } from '../spec/example'
import { buildOpenApi } from '../spec/openapi'
import { Refs } from '../spec/refs'
import { parseText } from './index'

function timed<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now()
  const result = fn()
  return { result, ms: performance.now() - start }
}

/** An OpenAPI YAML file with `count` operations that all alias one response. */
function aliasedSpec(count: number, alias: boolean): string {
  const lines = ['openapi: 3.0.3', 'info: { title: T, version: "1" }', 'components:', '  responses:', '    Err: &err', '      description: failed', '      content: { application/json: { schema: { type: object } } }', 'paths:']
  for (let i = 0; i < count; i++) {
    lines.push(`  /r${i}:`, '    get:', '      responses:', "        '200': { description: ok }")
    lines.push(alias ? "        '500': *err" : "        '500': { description: failed, content: { application/json: { schema: { type: object } } } }")
  }
  return lines.join('\n') + '\n'
}

/** `levels` levels of ten aliases each, the shape of a "billion laughs" file. */
function laughs(levels: number): string[] {
  const lines = ['x-l0: &l0 [lol, lol, lol, lol, lol, lol, lol, lol, lol, lol]']
  for (let n = 1; n <= levels; n++) lines.push(`x-l${n}: &l${n} [${Array(10).fill(`*l${n - 1}`).join(', ')}]`)
  return lines
}

test('YAML aliases resolve in one pass, not one document scan per alias', () => {
  parseText(aliasedSpec(200, true))
  const withAliases = timed(() => parseText(aliasedSpec(4000, true)))
  const inlined = timed(() => parseText(aliasedSpec(4000, false)))
  const value = withAliases.result.value as { paths: Record<string, { get: { responses: Record<string, unknown> } }> }
  assert.equal(value.paths['/r3999'].get.responses['500'], value.paths['/r0'].get.responses['500'], 'aliases share their anchor')
  // Before the fix: about 30 s against 0.2 s inlined.
  assert.ok(withAliases.ms < Math.max(1500, inlined.ms * 4), `${withAliases.ms.toFixed(0)} ms with aliases, ${inlined.ms.toFixed(0)} ms inlined`)
  assert.deepEqual(withAliases.result.position(['paths', '/r10', 'get', 'responses', '500', 'description']), { line: 6, column: 7 }, 'locate follows the alias')
})

test('a "billion laughs" file stops at the alias budget, quickly and with a problem', () => {
  const text = ['openapi: 3.0.3', 'info: { title: T, version: "1" }', 'paths: {}', ...laughs(9), 'components:', '  schemas:', '    S: { type: string, example: *l9 }'].join('\n')
  const { result, ms } = timed(() => analyze(text))
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`)
  const limit = result.problems.filter((p) => p.rule === 'yaml-alias-limit')
  assert.equal(limit.length, 1)
  assert.equal(limit[0].severity, 'error')
  assert.match(String(limit[0].params.alias), /^l\d$/)
  const example = (result.parsed.value as { components: { schemas: { S: { example: unknown } } } }).components.schemas.S.example
  const shown = timed(() => prettyJson(example))
  assert.ok(shown.ms < 1000, `${shown.ms.toFixed(0)} ms to show`)
  assert.ok(!shown.result.text.includes('[object Object]'))
  const warning = result.problems.find((p) => p.rule === 'invalid-example')
  assert.ok(warning, 'the example still gets its type check')
  assert.ok(String(warning.params.value ?? '').length < 400)
})

test('ordinary aliases stay well inside the budget', () => {
  const text = ['openapi: 3.0.3', 'info: { title: T, version: "1" }', 'paths: {}', ...laughs(4), 'components:', '  schemas:', '    S: { type: array, example: *l4 }'].join('\n')
  const result = analyze(text)
  assert.ok(!result.problems.some((p) => p.rule === 'yaml-alias-limit'))
  const example = (result.parsed.value as { components: { schemas: { S: { example: unknown } } } }).components.schemas.S.example
  assert.equal([9, 9, 9, 9, 9].reduce((v: unknown, i) => (v as unknown[])[i], example), 'lol')
})

test('an alias to its own ancestor becomes a reference with a warning, not a cycle', () => {
  const callback = `openapi: 3.0.3
info: { title: T, version: "1" }
paths:
  /a:
    post: &op
      responses: { '200': { description: ok } }
      callbacks:
        cb:
          '{$request.body#/url}':
            post: *op
`
  const result = analyze(callback)
  const cycle = result.problems.filter((p) => p.rule === 'yaml-alias-cycle')
  assert.equal(cycle.length, 1)
  assert.equal(cycle[0].params.alias, 'op')
  assert.equal(result.parsed.lines.position(cycle[0].offset!).line, 10)
  const post = (result.parsed.value as { paths: Record<string, { post: { callbacks: { cb: Record<string, { post: unknown }> } } }> }).paths['/a'].post
  assert.deepEqual(post.callbacks.cb['{$request.body#/url}'].post, { $ref: '#/paths/~1a/post' })

  const pathItem = analyze(`openapi: 3.1.0
info: { title: T, version: "1" }
paths:
  /a: &item
    get:
      responses: { '200': { description: ok } }
      callbacks: { cb: { '{$url}': *item } }
`)
  assert.equal(pathItem.problems.filter((p) => p.rule === 'yaml-alias-cycle').length, 1)

  const schema = analyze(`openapi: 3.1.0
info: { title: T, version: "1" }
paths: {}
components:
  schemas:
    Node: &node
      type: object
      properties: { next: *node }
`)
  const node = (schema.parsed.value as { components: { schemas: { Node: { properties: { next: unknown } } } } }).components.schemas.Node
  assert.deepEqual(node.properties.next, { $ref: '#/components/schemas/Node' }, 'a recursive schema written with an alias')
  assert.deepEqual(schema.problems.filter((p) => p.severity === 'error'), [])

  const merge = parseText('a: &a\n  x: 1\n  <<: *a\n')
  assert.deepEqual(merge.value, { a: { x: 1 } })
  assert.equal(merge.issues.filter((i) => i.code === 'yaml-alias-cycle').length, 1)
  assert.equal(JSON.stringify(parseText('l: &l [1, *l]\n').value), '{"l":[1,{"$ref":"#/l"}]}', 'no JavaScript cycles')
})

test('a cycle in the value never breaks the checks: they report it and the document still shows', () => {
  const value: Record<string, unknown> = { openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: {} }
  const op: Record<string, unknown> = { responses: { 200: { description: 'ok' } } }
  op.callbacks = { cb: { '{$url}': { post: op } } }
  ;(value.paths as Record<string, unknown>)['/a'] = { post: op }
  // A cyclic value cannot come from the parsers; the lint walker is guarded anyway.
  const refs = new Refs(value)
  const model = buildOpenApi(value, 'openapi30', refs)
  const result = lintDocument(value, 'openapi30', refs, { kind: 'openapi', model })
  assert.ok(Array.isArray(result.problems.items))
})

test('multi-document YAML shows the first document and says so', () => {
  const manifest = analyze('apiVersion: v1\nkind: Service\nmetadata:\n  name: a\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: b\n')
  assert.deepEqual(manifest.detection, { spec: false, other: 'kubernetes' })
  assert.deepEqual(
    manifest.problems.map((p) => [p.rule, p.severity]),
    [['yaml-documents', 'info']]
  )
  assert.equal(manifest.parsed.lines.position(manifest.problems[0].offset!).line, 5)
  const leading = analyze('---\napiVersion: v1\nkind: ConfigMap\n---\napiVersion: v1\nkind: Service\n')
  assert.deepEqual(leading.problems.map((p) => p.rule), ['yaml-documents'])
  for (const text of ['apiVersion: v1\nkind: Service\n---\n', 'openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths: {}\n---\n# end\n', 'a: 1\n...\n---\n']) {
    const result = analyze(text)
    assert.deepEqual(result.problems.filter((p) => p.rule !== 'unused-component'), [], text)
  }
  assert.ok(!manifest.problems.some((p) => /parseAllDocuments/.test(p.text ?? '')))
})
