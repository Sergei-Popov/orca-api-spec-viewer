import { assert, test } from 'orca/testing'
import { parseText } from './index'
import { parseJson } from './json'
import { LineIndex, MAX_LINE } from './lines'

test('clean JSON parses with JSON.parse and locates keys by line', () => {
  const text = '{\n  "openapi": "3.1.0",\n  "paths": {\n    "/a~b/c": {\n      "get": {}\n    }\n  },\n  "list": [1, {"x": 2}]\n}\n'
  const parsed = parseText(text)
  assert.equal(parsed.format, 'json')
  assert.deepEqual(parsed.issues, [])
  assert.deepEqual(parsed.position(['paths', '/a~b/c', 'get']), { line: 5, column: 7 })
  assert.deepEqual(parsed.position(['list', '1', 'x']), { line: 8, column: 16 })
  // A path past the text lands on its deepest existing ancestor.
  assert.deepEqual(parsed.position(['paths', '/a~b/c', 'post']), { line: 4, column: 5 })
  assert.deepEqual(parsed.position([]), { line: 1, column: 1 })
})

test('JSON with comments and trailing commas is JSONC', () => {
  const parsed = parseText('// spec\n{\n  /* info */ "a": [1, 2,],\n  "b": {"c": true,},\n}\n')
  assert.equal(parsed.format, 'jsonc')
  assert.deepEqual(parsed.value, { a: [1, 2], b: { c: true } })
  assert.deepEqual(parsed.issues, [])
  assert.deepEqual(parsed.position(['b', 'c']), { line: 4, column: 9 })
})

test('a cut-off JSON file keeps what was read and reports where it broke', () => {
  const text = '{\n  "openapi": "3.0.3",\n  "info": {"title": "T", "version": "1"},\n  "paths": {\n    "/a": {'
  const parsed = parseText(text)
  assert.deepEqual(parsed.value, { openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: { '/a': {} } })
  assert.equal(parsed.issues.length, 1)
  assert.equal(parsed.issues[0].severity, 'error')
  assert.match(parsed.issues[0].message, /ends inside an object/)
  assert.equal(parsed.lines.position(parsed.issues[0].offset).line, 5)
})

test('JSON escapes, numbers and an own __proto__ key', () => {
  const result = parseJson('{"a\\"b": "x\\u0041\\n", "n": -1.5e2, "__proto__": {"polluted": true}, }')
  const value = result.value as Record<string, unknown>
  assert.equal(value['a"b'], 'xA\n')
  assert.equal(value.n, -150)
  assert.equal(Object.getPrototypeOf(value), Object.prototype)
  assert.deepEqual(Object.keys(value), ['a"b', 'n', '__proto__'])
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('bad JSON reports an unexpected character', () => {
  const parsed = parseText('{"a": tru}')
  assert.equal(parsed.issues[0].code, 'json-syntax')
  assert.equal(parsed.issues[0].offset, 6)
})

test('YAML anchors, aliases and merge keys', () => {
  const text = [
    'openapi: 3.1.0',
    'components:',
    '  schemas:',
    '    Base: &base',
    '      type: object',
    '      description: base',
    '    Child:',
    '      <<: *base',
    '      description: child',
    '    Same: *base',
    ''
  ].join('\n')
  const parsed = parseText(text)
  assert.equal(parsed.format, 'yaml')
  assert.deepEqual(parsed.issues, [])
  const schemas = (parsed.value as any).components.schemas
  assert.deepEqual(schemas.Child, { description: 'child', type: 'object' })
  assert.equal(schemas.Same, schemas.Base, 'an alias is the same object')
  assert.deepEqual(parsed.position(['components', 'schemas', 'Child', 'description']), { line: 9, column: 7 })
  // A merged key is found where it is written.
  assert.deepEqual(parsed.position(['components', 'schemas', 'Child', 'type']), { line: 5, column: 7 })
  // Through an alias, positions point into the anchored node.
  assert.deepEqual(parsed.position(['components', 'schemas', 'Same', 'description']), { line: 6, column: 7 })
})

test('YAML 1.2 keeps yes, no and dates as strings and reports syntax errors with offsets', () => {
  const ok = parseText('a: yes\nb: 2024-01-01\nc: 010\nd: 0o10\ne: ~\n')
  assert.deepEqual(ok.value, { a: 'yes', b: '2024-01-01', c: 10, d: 8, e: null })
  const bad = parseText('a: 1\n  b: [1, 2\nc: 3\n')
  assert.ok(bad.issues.some((issue) => issue.severity === 'error'))
})

test('YAML duplicate keys are a warning and the last one wins', () => {
  const parsed = parseText('a: 1\na: 2\n')
  assert.equal(parsed.issues[0].code, 'duplicate-key')
  assert.equal(parsed.issues[0].severity, 'warning')
  assert.equal(parsed.lines.position(parsed.issues[0].offset).line, 2)
  assert.deepEqual(parsed.value, { a: 2 })
})

test('an empty file and a lone scalar', () => {
  assert.equal(parseText('').value, null)
  assert.equal(parseText('   \n').value, null)
  assert.equal(parseText('hello').value, 'hello')
})

test('source lines: lengths, slices and the widest line as drawn', () => {
  const long = 'x'.repeat(MAX_LINE + 500)
  const lines = new LineIndex(`a\tb\r\n${long}\nlast`)
  assert.equal(lines.lineCount, 3)
  assert.equal(lines.line(1), 'a\tb', 'no CR')
  assert.equal(lines.lineLength(2), MAX_LINE + 500)
  assert.equal(lines.line(2).length, MAX_LINE, 'the view shows a part of a long line and says how much is left')
  assert.equal(lines.slice(2, MAX_LINE + 490, MAX_LINE + 600), 'x'.repeat(10))
  assert.equal(lines.slice(3, 1, 3), 'as')
  assert.equal(lines.widest(MAX_LINE), MAX_LINE)
  assert.equal(new LineIndex('a\tb\nab').widest(MAX_LINE), 3 + 7, 'a tab counts as eight columns')
})
