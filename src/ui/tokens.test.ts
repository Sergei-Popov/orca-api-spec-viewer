import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import { stringsFor } from '../i18n'
import type { OpenApiModel } from '../spec/openapi'
import { operationDetails } from '../spec/operation'
import type { PageCtx } from './context'
import { mediaExamples } from './openapi-pages'
import { codeTokens, HIGHLIGHT_LIMIT, type CodeLanguage } from './tokens'

const kinds = (text: string, language: CodeLanguage) => codeTokens(text, language).filter((t) => t.kind).map((t) => `${t.kind}:${t.text}`)

test('code tokens: JSON keys and strings, shell flags and strings, JS keywords and comments', () => {
  assert.deepEqual(kinds('{"a": "b\\"c", "n": -1.5e3, "t": true}', 'json'), ['k:"a"', 's:"b\\"c"', 'k:"n"', 'n:-1.5e3', 'k:"t"', 'l:true'])
  assert.deepEqual(kinds("curl -X POST 'https://x' \\\n  -d \"a\"", 'shell'), ['f:-X', "s:'https://x'", 'f:-d', 's:"a"'])
  assert.deepEqual(kinds("const r = await fetch('u') // go", 'js'), ['l:const', 'l:await', "s:'u'", 'c:// go'])
  // The tokens put back together are the text.
  const text = '{\n  "a": [1, "two", null]\n}'
  assert.equal(codeTokens(text, 'json').map((t) => t.text).join(''), text)
})

test('an unterminated string full of escaped quotes is scanned once', () => {
  // The end of an example cut in the middle of a string: before, each escaped quote restarted
  // the string pattern, which then ran to the end again (about 40 s for 400,000 characters).
  const quotes = '\\"'.repeat(100_000)
  const cases: [string, CodeLanguage][] = [
    ['{\n  "note": "' + quotes, 'json'],
    ['curl -d "' + quotes, 'shell'],
    ["fetch('" + "\\'".repeat(100_000), 'js'],
    ['x = "' + quotes, 'python']
  ]
  for (const [text, language] of cases) {
    const started = performance.now()
    const tokens = codeTokens(text, language)
    const ms = performance.now() - started
    assert.ok(ms < 200, `${language}: ${ms.toFixed(0)} ms`)
    assert.equal(tokens.map((t) => t.text).join(''), text)
    assert.equal(tokens.at(-1)!.kind, 's', `${language}: the open string is one token`)
  }
  assert.deepEqual(codeTokens('x'.repeat(HIGHLIGHT_LIMIT), 'json'), [{ kind: '', text: 'x'.repeat(HIGHLIGHT_LIMIT) }], 'text at the limit is plain')
})

test('an example cut short says so', () => {
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    paths: {
      '/a': {
        get: {
          responses: {
            200: {
              description: 'ok',
              content: {
                'application/json': { examples: { big: { value: { note: '"'.repeat(210_000) } }, small: { value: { note: 'hi' } } } }
              }
            }
          }
        }
      }
    }
  })
  const a = analyze(spec)
  const model = (a.model as { model: OpenApiModel }).model
  const details = operationDetails(model, a.refs, model.operations[0])
  const ctx = { t: stringsFor('en'), refs: a.refs } as unknown as PageCtx
  const [big, small] = mediaExamples(ctx, details.responses[0].media[0], 'response')
  assert.equal(big.cut, true)
  assert.equal(big.text.length, HIGHLIGHT_LIMIT)
  assert.equal(small.cut, false)
  assert.equal(small.text, '{\n  "note": "hi"\n}')
})
