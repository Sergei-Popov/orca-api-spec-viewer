import { assert, test } from 'orca/testing'
import { styledHeader, styledPairs, styledPath, type ParamStyle } from './param-style'

// The style examples of the OpenAPI specification (3.1.1 and later, which follow RFC 6570 for
// label): the parameter `color` as a string, an array and an object.
const STRING = 'blue'
const ARRAY = ['blue', 'black', 'brown']
const OBJECT = { R: 100, G: 200, B: 150 }
const p = (style: string | undefined, explode?: boolean, collectionFormat?: string): ParamStyle => ({ name: 'color', style, explode, collectionFormat })
const query = (style: ParamStyle, value: unknown) => styledPairs(style, value).map(([k, v]) => `${k}=${v}`).join('&')
const path = (style: ParamStyle, value: unknown) => styledPath(style, value, encodeURIComponent)

test('path parameters: simple, label and matrix, exploded or not', () => {
  const table: [ParamStyle, string, string, string][] = [
    [p('simple', false), 'blue', 'blue,black,brown', 'R,100,G,200,B,150'],
    [p('simple', true), 'blue', 'blue,black,brown', 'R=100,G=200,B=150'],
    [p('label', false), '.blue', '.blue,black,brown', '.R,100,G,200,B,150'],
    [p('label', true), '.blue', '.blue.black.brown', '.R=100.G=200.B=150'],
    [p('matrix', false), ';color=blue', ';color=blue,black,brown', ';color=R,100,G,200,B,150'],
    [p('matrix', true), ';color=blue', ';color=blue;color=black;color=brown', ';R=100;G=200;B=150']
  ]
  for (const [style, string, array, object] of table) {
    const label = `${style.style} explode=${style.explode}`
    assert.equal(path(style, STRING), string, label)
    assert.equal(path(style, ARRAY), array, label)
    assert.equal(path(style, OBJECT), object, label)
  }
  // Each part is encoded; the separators are not.
  assert.equal(path(p('simple', false), ['a/b', 'c d']), 'a%2Fb,c%20d')
  assert.equal(path(p('matrix', true), { 'k;': 'v=' }), ';k%3B=v%3D')
})

test('query parameters: form, spaceDelimited, pipeDelimited and deepObject', () => {
  const table: [ParamStyle, string, string][] = [
    [p('form', true), 'color=blue&color=black&color=brown', 'R=100&G=200&B=150'],
    [p('form', false), 'color=blue,black,brown', 'color=R,100,G,200,B,150'],
    [p('spaceDelimited', false), 'color=blue black brown', 'color=R 100 G 200 B 150'],
    [p('pipeDelimited', false), 'color=blue|black|brown', 'color=R|100|G|200|B|150'],
    // OpenAPI leaves deepObject arrays undefined: the common `name[]` form, reported as deep.
    [p('deepObject', true), 'color[]=blue&color[]=black&color[]=brown', 'color[R]=100&color[G]=200&color[B]=150']
  ]
  for (const [style, array, object] of table) {
    const label = `${style.style} explode=${style.explode}`
    assert.equal(query(style, STRING), 'color=blue', label)
    assert.equal(query(style, ARRAY), array, label)
    assert.equal(query(style, OBJECT), object, label)
  }
  // deepObject is written deep even where the document leaves explode out (false by default).
  assert.equal(query(p('deepObject', false), { status: 'sold' }), 'color[status]=sold')
  // OpenAPI 3.2's cookie style explodes by default, like form.
  assert.equal(query(p('cookie'), ARRAY), 'color=blue&color=black&color=brown')
  // Nested values stay compact JSON; a parameter with `content` is one JSON value.
  assert.equal(query(p('form', true), [{ a: 1 }, 2]), 'color={"a":1}&color=2')
  assert.equal(query({ ...p('form', true), json: true }, OBJECT), 'color={"R":100,"G":200,"B":150}')
})

test('items are encoded before they are joined, so only the separators stay literal', () => {
  // Before: ['a', 'b,c'] went out as a,b,c from curl and fetch, the same as three items.
  const enc = (style: ParamStyle, value: unknown) => {
    const report = {}
    const pairs = styledPairs(style, value, encodeURIComponent, report)
    return [pairs.map(([k, v]) => `${k}=${v}`).join('&'), report]
  }
  assert.deepEqual(enc(p('form', false), ['a', 'b,c']), ['color=a,b%2Cc', { joined: true }])
  assert.deepEqual(enc(p('pipeDelimited', false), ['a|b', 'c']), ['color=a%7Cb|c', { joined: true, pipeInItem: true }])
  assert.deepEqual(enc(p('pipeDelimited', false), ['a', 'b']), ['color=a|b', { joined: true }])
  assert.deepEqual(enc(p('spaceDelimited', false), ['a b', 'c']), ['color=a%20b%20c', {}])
  assert.deepEqual(enc(p('form', true), ['a,b', 'c']), ['color=a%2Cb&color=c', {}])
  assert.deepEqual(enc(p(undefined, undefined, 'csv'), ['a,b', 'c']), ['color=a%2Cb,c', { joined: true }])
  assert.deepEqual(enc(p('form', false), 'x,y'), ['color=x%2Cy', {}])
})

test('deepObject goes deeper in the common form, and says so', () => {
  const deep = (value: unknown) => {
    const report: { deep?: boolean } = {}
    return [styledPairs(p('deepObject', true), value, undefined, report).map(([k, v]) => `${k}=${v}`).join('&'), report.deep ?? false]
  }
  assert.deepEqual(deep({ city: 'Oslo', zip: '0150' }), ['color[city]=Oslo&color[zip]=0150', false])
  assert.deepEqual(deep({ address: { city: 'Oslo' } }), ['color[address][city]=Oslo', true])
  assert.deepEqual(deep({ ids: [1, 2] }), ['color[ids][]=1&color[ids][]=2', true])
  assert.deepEqual(deep([{ type: 'eu_vat', value: 'X' }]), ['color[0][type]=eu_vat&color[0][value]=X', true])
})

test('headers: simple, exploded or not', () => {
  assert.equal(styledHeader(p('simple', false), ARRAY), 'blue,black,brown')
  assert.equal(styledHeader(p('simple', false), OBJECT), 'R,100,G,200,B,150')
  assert.equal(styledHeader(p('simple', true), OBJECT), 'R=100,G=200,B=150')
  assert.equal(styledHeader(p('simple', false), STRING), 'blue')
})

test('Swagger 2.0 collectionFormat: csv, ssv, tsv, pipes and multi', () => {
  assert.equal(query(p(undefined), ARRAY), 'color=blue,black,brown', 'csv is the default')
  assert.equal(query(p(undefined, undefined, 'csv'), ARRAY), 'color=blue,black,brown')
  assert.equal(query(p(undefined, undefined, 'ssv'), ARRAY), 'color=blue black brown')
  assert.equal(query(p(undefined, undefined, 'tsv'), ARRAY), 'color=blue\tblack\tbrown')
  assert.equal(query(p(undefined, undefined, 'pipes'), ARRAY), 'color=blue|black|brown')
  assert.equal(query(p(undefined, undefined, 'multi'), ARRAY), 'color=blue&color=black&color=brown')
  assert.equal(path(p(undefined, undefined, 'pipes'), ARRAY), 'blue%7Cblack%7Cbrown')
  assert.equal(styledHeader(p(undefined, undefined, 'ssv'), ARRAY), 'blue black brown')
  // Swagger has no object parameters outside the body: an object is sent as JSON.
  assert.equal(query(p(undefined), { a: 1 }), 'color={"a":1}')
  assert.equal(query(p(undefined), 7), 'color=7')
})

test('a long array is cut at 100 items', () => {
  const many = Array.from({ length: 150 }, (_, i) => i)
  assert.equal(styledPairs(p('form', true), many).length, 100)
  assert.equal(styledHeader(p('simple', false), many).split(',').length, 100)
})
