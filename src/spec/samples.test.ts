import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import type { OpenApiModel } from './openapi'
import { operationDetails } from './operation'
import { buildRequest, renderSample, sampleLanguages, type SampleRequest } from './samples'

function requests(text: string): { route: string; method: string; request: SampleRequest }[] {
  const a = analyze(text)
  assert.equal(a.model?.kind, 'openapi')
  const model = (a.model as { model: OpenApiModel }).model
  return model.operations.map((op) => ({ route: op.route, method: op.method, request: buildRequest(model, a.refs, op, operationDetails(model, a.refs, op)) }))
}

function one(text: string, route: string) {
  const found = requests(text).find((r) => r.route === route)
  assert.ok(found, route)
  return found.request
}

/** Example values that curl and HTTPie would read as "the contents of this file". */
const FILE_LIKE = `openapi: 3.0.3
info: { title: Notes, version: '1' }
servers: [{ url: 'http://127.0.0.1:9' }]
paths:
  /raw:
    post:
      requestBody: { content: { text/plain: { example: '@.env' } } }
      responses: { '200': { description: ok } }
  /notes:
    post:
      requestBody: { content: { application/json: { example: { note: '@.env', handle: '@alice', lt: '<.env' } } } }
      responses: { '200': { description: ok } }
  /upload:
    post:
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                comment: { type: string, example: '<.env' }
                tag: { type: string, example: '@.env' }
      responses: { '200': { description: ok } }
  /form:
    post:
      requestBody: { content: { application/x-www-form-urlencoded: { example: { a: '@.env', '@b': x } } } }
      responses: { '200': { description: ok } }
  /search:
    get:
      parameters:
        - { name: q, in: query, required: true, example: '@.env' }
        - { name: X-Token, in: header, required: true, example: '@.env' }
        - { name: X-Empty, in: header, required: true, example: '' }
        - { name: '@.env', in: header, required: true, example: x }
      responses: { '200': { description: ok } }
`

test('curl never reads a file named by an example value', () => {
  const raw = renderSample('curl', one(FILE_LIKE, '/raw'))
  assert.ok(!raw.includes('--data-binary'), raw)
  assert.match(raw, /--data-raw @\.env$/)
  const upload = renderSample('curl', one(FILE_LIKE, '/upload'))
  assert.ok(!/(^|\s)-F /.test(upload), upload)
  assert.match(upload, /--form-string 'comment=<\.env'/)
  assert.match(upload, /--form-string tag=@\.env/)
  const form = renderSample('curl', one(FILE_LIKE, '/form'))
  assert.match(form, /--data-urlencode a=@\.env/)
  assert.match(form, /--data-urlencode @b=x/, 'curl splits at the first "=", so the name is literal too')
  const json = renderSample('curl', one(FILE_LIKE, '/notes'))
  assert.match(json, /-d '\{\n {2}"note": "@\.env"/)
  const search = renderSample('curl', one(FILE_LIKE, '/search'))
  assert.match(search, /-H 'X-Token: @\.env'/)
  assert.match(search, /-H 'X-Empty;'/, 'an empty header is written so curl sends it')
  assert.ok(!search.includes("-H '@"), 'a header name that is not a token is left out')
})

test('HTTPie escapes separators so values stay text', () => {
  const notes = renderSample('httpie', one(FILE_LIKE, '/notes'))
  assert.match(notes, /'note=\\@\.env'/)
  assert.match(notes, /'handle=\\@alice'/)
  assert.match(notes, /'lt=<\.env'/)
  const search = renderSample('httpie', one(FILE_LIKE, '/search'))
  assert.match(search, /'q==\\@\.env'/)
  assert.match(search, /'X-Token:\\@\.env'/)
  assert.match(search, /'X-Empty;'/)
  const upload = renderSample('httpie', one(FILE_LIKE, '/upload'))
  assert.match(upload, /^http --multipart POST /)
  assert.match(upload, /'tag=\\@\.env'/)
  const form = renderSample('httpie', one(FILE_LIKE, '/form'))
  assert.match(form, /'a=\\@\.env'/)
  assert.match(form, /'\\@b=x'/)
  const raw = renderSample('httpie', one(FILE_LIKE, '/raw'))
  assert.match(raw, /--raw=@\.env$/)
})

test('HTTPie: keys and values it cannot write exactly use --raw or the URL', () => {
  const spec = `openapi: 3.0.3
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /a:
    post:
      parameters:
        - { name: q, in: query, required: true, example: 'a\\=b' }
        - { name: '-x', in: query, required: true, example: '1' }
      requestBody: { content: { application/json: { example: { 'a:b': 1, 'items[0]': 2 } } } }
      responses: { '200': { description: ok } }
  /b:
    post:
      requestBody: { content: { application/json: { example: { path: 'C:\\=x' } } } }
      responses: { '200': { description: ok } }
  /c:
    post:
      requestBody: { content: { application/json: { example: { name: '-rf' } } } }
      responses: { '200': { description: ok } }
`
  const a = renderSample('httpie', one(spec, '/a'))
  assert.match(a, /^http POST 'https:\/\/api\.test\/a\?q=a%5C%3Db&-x=1'/)
  assert.match(a, /--raw='\{"a:b":1,"items\[0\]":2\}'$/)
  const b = renderSample('httpie', one(spec, '/b'))
  assert.match(b, /--raw='\{"path":"C:\\\\=x"\}'$/)
  assert.match(renderSample('httpie', one(spec, '/c')), /name=-rf$/)
})

test('HTTPie sends Content-Type once, and only when it would not set it itself', () => {
  const spec = `openapi: 3.0.3
info: { title: T, version: '1' }
paths:
  /text:
    post:
      requestBody: { content: { text/plain: { example: hello } } }
      responses: { '200': { description: ok } }
  /vendor:
    post:
      requestBody: { content: { application/vnd.api+json: { example: { a: 1 } } } }
      responses: { '200': { description: ok } }
  /json:
    post:
      requestBody: { content: { application/json: { example: { a: 1 } } } }
      responses: { '200': { description: ok } }
`
  const count = (text: string) => text.split('Content-Type').length - 1
  const text = renderSample('httpie', one(spec, '/text'))
  assert.equal(count(text), 1, text)
  assert.match(text, /Content-Type:text\/plain \\\n {2}--raw=hello$/)
  assert.equal(count(renderSample('httpie', one(spec, '/vendor'))), 1)
  assert.equal(count(renderSample('httpie', one(spec, '/json'))), 0)
  assert.equal(count(renderSample('curl', one(spec, '/text'))), 1)
})

test('a method that is not an HTTP token gets no samples and a problem', () => {
  const spec = `openapi: 3.2.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /items:
    additionalOperations:
      'PURGE$(touch PWNED)': { responses: { '200': { description: ok } } }
      "X'Y": { responses: { '200': { description: ok } } }
      M-SEARCH: { responses: { '200': { description: ok } } }
      purge: { responses: { '200': { description: ok } } }
`
  const all = requests(spec)
  const bad = all.find((r) => r.method.startsWith('PURGE$'))!.request
  assert.equal(bad.methodValid, false)
  assert.deepEqual(sampleLanguages(bad), [])
  const quoteMethod = all.find((r) => r.method === "X'Y")!.request
  assert.match(renderSample('curl', quoteMethod), /^curl -X 'X'\\''Y' https:/)
  assert.ok(!sampleLanguages(quoteMethod).includes('httpie'), 'HTTPie reads a method only when it is letters')
  assert.deepEqual(sampleLanguages(all.find((r) => r.method === 'M-SEARCH')!.request), ['curl', 'fetch', 'python'])
  const lower = all.find((r) => r.method === 'purge')!.request
  assert.equal(lower.method, 'purge', 'an additional operation keeps the method as written')
  assert.match(renderSample('httpie', lower), /^http purge https:/)
  const problems = analyze(spec).problems.filter((p) => p.rule === 'bad-key')
  assert.deepEqual(problems.map((p) => p.params.key), ['PURGE$(touch PWNED)'])
  assert.equal(problems[0].params.kind, 'method-token')
})

test('a huge example is replaced by one made from the schema', () => {
  const big = 'x'.repeat(150_000)
  const spec = JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'T', version: '1' },
    paths: { '/a': { post: { requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { n: { type: 'integer' } } }, example: { blob: big } } } }, responses: { 200: { description: 'ok' } } } } }
  })
  const request = one(spec, '/a')
  assert.deepEqual(request.body?.json, { n: 0 })
  for (const language of sampleLanguages(request)) assert.ok(renderSample(language, request).length < 1000, language)
})
