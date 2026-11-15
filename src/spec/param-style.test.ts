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
    [p('deepObject', true), 'color=blue&color=black&color=brown', 'color[R]=100&color[G]=200&color[B]=150']
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
