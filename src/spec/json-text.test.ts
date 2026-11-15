import { assert, test } from 'orca/testing'
import { prettyJson } from './example'
import { duplicateIndexes, jsonText, sameJson } from './json-text'
import { formatValue } from './schema'

test('bounded JSON text matches JSON.stringify until it is cut', () => {
  const value = { a: [1, 'two', true, null, { b: 1.5 }], c: {}, d: [], e: 'quote " and \\ and \n', f: undefined, g: Number.NaN }
  assert.equal(jsonText(value, { maxLength: 10_000 }).text, JSON.stringify(value))
  assert.equal(jsonText(value, { maxLength: 10_000, indent: 2 }).text, JSON.stringify(value, null, 2))
  assert.deepEqual(jsonText([undefined, 1], { maxLength: 100 }), { text: '[null,1]', cut: false })
  assert.deepEqual(jsonText('x'.repeat(50), { maxLength: 10 }), { text: '"xxxxxxxxx', cut: true })
})

test('shared subtrees cost only what is written, and cycles are cut', () => {
  // Ten levels of ten references to the level below: 10^10 leaves as a tree.
  let level: unknown = 'lol'
  for (let i = 0; i < 10; i++) level = Array(10).fill(level)
  const start = performance.now()
  const shown = prettyJson(level)
  assert.ok(performance.now() - start < 500)
  assert.equal(shown.cut, true)
  assert.equal(shown.text.length, 200_000)
  assert.ok(formatValue(level).endsWith('…'))
  const cyclic: Record<string, unknown> = { id: 1 }
  cyclic.self = cyclic
  assert.deepEqual(prettyJson(cyclic), { text: '{\n  "id": 1,\n  "self": "…"\n}', cut: true })
  let deep: unknown = 0
  for (let i = 0; i < 10_000; i++) deep = [deep]
  assert.equal(jsonText(deep, { maxLength: 100_000 }).cut, true, 'too deep is cut, not a stack overflow')
})

test('JSON equality is structural and gives up past its budget', () => {
  assert.ok(sameJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }))
  assert.ok(!sameJson({ a: 1 }, { a: 1, b: 2 }))
  assert.ok(!sameJson([1, 2], { 0: 1, 1: 2 }))
  let level: unknown = 'lol'
  for (let i = 0; i < 10; i++) level = Array(10).fill(level)
  let copy: unknown = 'lol'
  for (let i = 0; i < 10; i++) copy = Array(10).fill(copy)
  const start = performance.now()
  assert.equal(sameJson(level, copy), false)
  assert.ok(performance.now() - start < 500)
})

test('duplicates are found in one pass, with the equality of sameJson', () => {
  assert.deepEqual(duplicateIndexes(['a', 'b', 'a', 1, '1', 1, null, null, true, 'true']), [2, 5, 7])
  assert.deepEqual(duplicateIndexes([{ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }, { a: 1, b: [2, 1] }]), [1], 'key order does not matter, item order does')
  assert.deepEqual(duplicateIndexes([0, -0, Number.NaN, Number.NaN]), [1, 3])
  const long = 'x'.repeat(5000)
  assert.deepEqual(duplicateIndexes([long + 'a', long + 'b', long + 'a']), [2], 'long values share a key and are told apart by sameJson')
  const same = Array.from({ length: 20_000 }, (_, i) => ({ code: `c${i}`, label: 'same' }))
  const started = performance.now()
  assert.deepEqual(duplicateIndexes([...same, { label: 'same', code: 'c7' }]), [20_000])
  assert.ok(performance.now() - started < 1000, `${(performance.now() - started).toFixed(0)} ms for 20,000 objects`)
})
