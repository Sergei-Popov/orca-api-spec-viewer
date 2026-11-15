import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import type { OpenApiModel } from './openapi'
import { operationDetails } from './operation'
import { buildRequest, renderSample, sampleLanguages, wellFormed, type SampleRequest } from './samples'

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

/**
 * Example values that curl and HTTPie would read as "the contents of this file", values with
 * HTTPie's separators in them, and one real file field.
 */
const FILE_LIKE = `openapi: 3.2.0
info: { title: Notes, version: '1' }
servers: [{ url: 'http://127.0.0.1:9' }]
paths:
  /raw:
    post:
      requestBody: { content: { text/plain: { example: '@notes.txt' } } }
      responses: { '200': { description: ok } }
  /notes:
    post:
      requestBody: { content: { application/json: { example: { note: '@notes.txt', handle: '@alice', lt: '<notes.txt', eq: '=x', n: 1 } } } }
      responses: { '200': { description: ok } }
  /nested:
    post:
      requestBody: { content: { application/json: { example: { 'a:b': '@notes.txt', list: ['@notes.txt', '<notes.txt'] } } } }
      responses: { '200': { description: ok } }
  /upload:
    post:
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                comment: { type: string, example: '<notes.txt' }
                tag: { type: string, example: '@notes.txt' }
                photo: { type: string, format: binary }
      responses: { '200': { description: ok } }
  /form:
    post:
      requestBody: { content: { application/x-www-form-urlencoded: { example: { a: '@notes.txt', b: '=x', '@b': x, 'c;d': ':v' } } } }
      responses: { '200': { description: ok } }
  /search:
    get:
      parameters:
        - { name: q, in: query, required: true, example: '@notes.txt' }
        - { name: 'k=v', in: query, required: true, example: '<notes.txt' }
        - { name: X-Token, in: header, required: true, example: '@notes.txt' }
        - { name: X-Empty, in: header, required: true, example: '' }
        - { name: X-Pair, in: header, required: true, example: 'a:b;c=d' }
        - { name: '@notes.txt', in: header, required: true, example: x }
      responses: { '200': { description: ok } }
  /items:
    additionalOperations:
      PURGE:
        requestBody: { content: { text/plain: { example: '<notes.txt' } } }
        responses: { '200': { description: ok } }
`

/**
 * The words of a POSIX shell command, quoting undone. The samples must be one plain command: an
 * unquoted character the shell would expand or treat as an operator (`$`, a backtick, `;`, `|`,
 * `&`, `<`, `>`, `*`, a bare newline, …) fails the test.
 */
function shellWords(command: string): string[] {
  const words: string[] = []
  let word: string | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === "'") {
      const end = command.indexOf("'", i + 1)
      assert.ok(end > i, `an unterminated quote in ${command}`)
      word = (word ?? '') + command.slice(i + 1, end)
      i = end
    } else if (c === '\\') {
      assert.ok(i + 1 < command.length, `a trailing backslash in ${command}`)
      const next = command[++i]
      if (next !== '\n') word = (word ?? '') + next
    } else if (c === ' ') {
      if (word !== null) words.push(word)
      word = null
    } else {
      assert.match(c, /[A-Za-z0-9_./:=@%+,-]/, `unquoted ${JSON.stringify(c)} in ${command}`)
      word = (word ?? '') + c
    }
  }
  if (word !== null) words.push(word)
  return words
}

/** What a sample sends, read from its argv the way the tool reads it. */
interface Sent {
  method: string
  url: string
  headers: [string, string][]
  query: [string, string][]
  fields: [string, unknown][]
  files: string[]
  json?: unknown
  text?: string
}

/** The file placeholder the samples use for a binary form field. */
const FILE_PLACEHOLDER = 'file.bin'

function queryOf(url: string): [string, string][] {
  const at = url.indexOf('?')
  const query: [string, string][] = []
  if (at >= 0) new URLSearchParams(url.slice(at + 1)).forEach((value, key) => query.push([key, value]))
  return query
}

/**
 * curl's argv. curl reads a file for `-d @name`, `-F name=@file` / `name=<file`, `-H @file` and
 * `--data-urlencode name@file` (only when there is no `=`); `--data-raw` and `--form-string` are
 * always text. Any other option fails the test, so a new one has to be added here on purpose.
 */
function curlSends(sample: string): Sent {
  const argv = shellWords(sample)
  assert.equal(argv[0], 'curl')
  const sent: Sent = { method: 'GET', url: '', headers: [], query: [], fields: [], files: [] }
  const urls: string[] = []
  let globoff = false
  for (let i = 1; i < argv.length; i++) {
    const word = argv[i]
    if (!word.startsWith('-')) {
      urls.push(word)
      continue
    }
    if (word === '-g') {
      globoff = true
      continue
    }
    const arg = argv[++i]
    assert.ok(arg !== undefined, `${word} without its argument`)
    const eq = arg.indexOf('=')
    switch (word) {
      case '-X':
        sent.method = arg
        break
      case '-u':
        assert.equal(arg, '<USERNAME>:<PASSWORD>')
        break
      case '-H': {
        assert.ok(!arg.startsWith('@'), `-H ${arg} reads headers from a file`)
        const colon = arg.indexOf(':')
        if (colon < 0 && arg.endsWith(';')) sent.headers.push([arg.slice(0, -1), ''])
        else sent.headers.push([arg.slice(0, colon), arg.slice(colon + 1).replace(/^ /, '')])
        break
      }
      case '-d':
        assert.ok(!/^[@<]/.test(arg), `-d ${arg} reads a file`)
        sent.json = JSON.parse(arg)
        break
      case '--data-raw':
        sent.text = arg
        break
      case '--data-urlencode':
        // curl splits at the first `=`; only without one would `name@file` read a file.
        assert.ok(eq >= 0, `--data-urlencode ${arg} reads a file`)
        sent.fields.push([arg.slice(0, eq), arg.slice(eq + 1)])
        break
      case '--form-string':
        assert.ok(eq > 0, arg)
        sent.fields.push([arg.slice(0, eq), arg.slice(eq + 1)])
        break
      case '-F':
        assert.equal(arg.slice(eq + 1), '@' + FILE_PLACEHOLDER, `-F ${arg}: only a file field reads a file`)
        sent.files.push(arg.slice(0, eq))
        break
      default:
        assert.fail(`an unexpected curl option ${word}`)
    }
  }
  assert.equal(urls.length, 1, `one URL in ${sample}`)
  sent.url = urls[0]
  // curl would expand {a,b} and [1-3] into several requests without -g.
  assert.equal(globoff, /[{}[\]]/.test(sent.url), `-g exactly when the URL has braces or brackets: ${sample}`)
  sent.query = queryOf(sent.url)
  return sent
}

/** Separators of HTTPie 3 request items; the ones that read a file are marked. */
const HTTPIE_SEPARATORS = [':', ';', '=', ':=', '==', '@', '=@', ':=@', ':@', '==@']
const HTTPIE_READS_FILE = new Set(['@', '=@', ':=@', ':@', '==@'])
const HTTPIE_SPECIAL = ':;=@'

/**
 * One HTTPie request item, split as HTTPie 3 does (httpie/cli/argtypes.py): a backslash before
 * `: ; = @` makes that character literal, and the earliest separator in the rest wins, the
 * longest one where several start at the same place.
 */
function httpieItem(item: string): { key: string; sep: string; value: string } {
  const tokens: { text: string; escaped: boolean }[] = [{ text: '', escaped: false }]
  for (let i = 0; i < item.length; i++) {
    const c = item[i]
    if (c === '\\' && i + 1 < item.length && HTTPIE_SPECIAL.includes(item[i + 1])) tokens.push({ text: item[++i], escaped: true }, { text: '', escaped: false })
    else tokens[tokens.length - 1].text += c
  }
  const join = (list: typeof tokens) => list.map((t) => t.text).join('')
  for (const [t, token] of tokens.entries()) {
    if (token.escaped) continue
    let at = -1
    let sep = ''
    for (const s of HTTPIE_SEPARATORS) {
      const i = token.text.indexOf(s)
      if (i >= 0 && (at < 0 || i < at || (i === at && s.length > sep.length))) {
        at = i
        sep = s
      }
    }
    if (at >= 0) return { key: join(tokens.slice(0, t)) + token.text.slice(0, at), sep, value: token.text.slice(at + sep.length) + join(tokens.slice(t + 1)) }
  }
  assert.fail(`no separator in the HTTPie item ${item}`)
}

function httpieSends(sample: string): Sent {
  const argv = shellWords(sample)
  assert.equal(argv[0], 'http')
  let i = 1
  while (argv[i]?.startsWith('-')) {
    if (argv[i] === '-a') {
      assert.equal(argv[i + 1], '<USERNAME>:<PASSWORD>')
      i += 2
    } else {
      assert.ok(argv[i] === '--form' || argv[i] === '--multipart', `an unexpected HTTPie option ${argv[i]}`)
      i++
    }
  }
  const sent: Sent = { method: argv[i++], url: argv[i++], headers: [], query: [], fields: [], files: [] }
  assert.match(sent.method, /^[A-Za-z]+$/)
  sent.query = queryOf(sent.url)
  let fields = false
  for (; i < argv.length; i++) {
    const word = argv[i]
    if (word.startsWith('--raw=')) {
      // --raw never reads a file.
      sent.text = word.slice('--raw='.length)
      continue
    }
    assert.ok(!word.startsWith('-'), `the item ${word} would be read as an option`)
    const { key, sep, value } = httpieItem(word)
    assert.ok(!HTTPIE_READS_FILE.has(sep) || (sep === '@' && value === FILE_PLACEHOLDER), `the item ${word} reads a file`)
    if (sep === ':') sent.headers.push([key, value])
    else if (sep === ';') sent.headers.push([key, ''])
    else if (sep === '==') sent.query.push([key, value])
    else if (sep === '=') sent.fields.push([key, value])
    else if (sep === ':=') sent.fields.push([key, JSON.parse(value)])
    else sent.files.push(key)
    if (sep === '=' || sep === ':=') fields = true
  }
  if (fields) assert.equal(sent.text, undefined, 'items or --raw, not both')
  return sent
}

const byName = (a: [string, unknown], b: [string, unknown]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)

/** The sample sends the request's method, URL, headers, query and body, all as text. */
function assertSends(language: 'curl' | 'httpie', request: SampleRequest): void {
  const sample = renderSample(language, request)
  const sent = language === 'curl' ? curlSends(sample) : httpieSends(sample)
  const body = request.body
  assert.equal(sent.method, request.method, sample)
  assert.equal(sent.url.split('?')[0], request.url, sample)
  assert.deepEqual([...sent.query].sort(byName), [...request.query].sort(byName), sample)
  let headers = request.headers
  // HTTPie sets these itself: the form types, and application/json for JSON.
  if (language === 'httpie') headers = headers.filter(([name, value]) => !(name === 'Content-Type' && (body?.form || (body?.json !== undefined && /^application\/json$/i.test(value)))))
  assert.deepEqual(sent.headers, headers, sample)
  if (body?.form) {
    assert.deepEqual(sent.fields, body.form.filter((f) => !f.file).map((f) => [f.name, f.value]), sample)
    assert.deepEqual(sent.files, body.form.filter((f) => f.file).map((f) => f.name), sample)
  } else if (body?.json !== undefined) {
    const json = sent.json ?? (sent.text !== undefined ? JSON.parse(sent.text) : Object.fromEntries(sent.fields))
    assert.deepEqual(json, body.json, sample)
  } else if (body?.text !== undefined) assert.equal(sent.text, body.text, sample)
  else assert.ok(sent.fields.length === 0 && sent.text === undefined && sent.json === undefined, sample)
}

test('the word splitter undoes quoting and refuses what the shell would expand', () => {
  assert.deepEqual(shellWords("curl -X 'X'\\''Y' a=@b \\\n  --data-raw '$(x) `y` ;|&'"), ['curl', '-X', "X'Y", 'a=@b', '--data-raw', '$(x) `y` ;|&'])
  for (const command of ['curl $(x)', 'curl `x`', 'curl a;b', 'curl a\nb', 'curl a|b', 'curl <x', 'curl "a"', "curl 'a"]) {
    let failed = false
    try {
      shellWords(command)
    } catch {
      failed = true
    }
    assert.ok(failed, command)
  }
  assert.deepEqual(httpieItem('note=\\@notes.txt'), { key: 'note', sep: '=', value: '@notes.txt' })
  assert.deepEqual(httpieItem('note=@notes.txt'), { key: 'note', sep: '=@', value: 'notes.txt' })
  assert.deepEqual(httpieItem('X-Token:@notes.txt'), { key: 'X-Token', sep: ':@', value: 'notes.txt' })
  assert.deepEqual(httpieItem('q==@notes.txt'), { key: 'q', sep: '==@', value: 'notes.txt' })
  assert.deepEqual(httpieItem('c\\;d=\\:v'), { key: 'c;d', sep: '=', value: ':v' })
  assert.deepEqual(httpieItem('n:=1'), { key: 'n', sep: ':=', value: '1' })
})

test('curl and HTTPie samples are plain words that read no file and send the example as text', () => {
  let checked = 0
  for (const { request } of requests(FILE_LIKE)) {
    for (const language of sampleLanguages(request)) {
      if (language !== 'curl' && language !== 'httpie') continue
      assertSends(language, request)
      checked++
    }
  }
  // 7 operations in curl and in HTTPie (PURGE is letters, so HTTPie takes it).
  assert.equal(checked, 14)
})

test('curl samples use the options that never read files', () => {
  const raw = renderSample('curl', one(FILE_LIKE, '/raw'))
  assert.ok(!raw.includes('--data-binary'), raw)
  assert.match(raw, /--data-raw @notes\.txt$/)
  const upload = renderSample('curl', one(FILE_LIKE, '/upload'))
  assert.match(upload, /--form-string 'comment=<notes\.txt'/)
  assert.match(upload, /--form-string tag=@notes\.txt/)
  assert.match(upload, /-F photo=@file\.bin/)
  const form = renderSample('curl', one(FILE_LIKE, '/form'))
  assert.match(form, /--data-urlencode a=@notes\.txt/)
  assert.match(form, /--data-urlencode @b=x/, 'curl splits at the first "=", so the name is literal too')
  const json = renderSample('curl', one(FILE_LIKE, '/notes'))
  assert.match(json, /-d '\{\n {2}"note": "@notes\.txt"/)
  const search = renderSample('curl', one(FILE_LIKE, '/search'))
  assert.match(search, /-H 'X-Token: @notes\.txt'/)
  assert.match(search, /-H 'X-Empty;'/, 'an empty header is written so curl sends it')
  assert.ok(!search.includes("-H '@"), 'a header name that is not a token is left out')
})

test('HTTPie escapes separators so values stay text', () => {
  const notes = renderSample('httpie', one(FILE_LIKE, '/notes'))
  assert.match(notes, /'note=\\@notes\.txt'/)
  assert.match(notes, /'handle=\\@alice'/)
  assert.match(notes, /'lt=<notes\.txt'/)
  const search = renderSample('httpie', one(FILE_LIKE, '/search'))
  assert.match(search, /'q==\\@notes\.txt'/)
  assert.match(search, /'X-Token:\\@notes\.txt'/)
  assert.match(search, /'X-Empty;'/)
  const upload = renderSample('httpie', one(FILE_LIKE, '/upload'))
  assert.match(upload, /^http --multipart POST /)
  assert.match(upload, /'tag=\\@notes\.txt'/)
  assert.match(upload, /photo@file\.bin/)
  const form = renderSample('httpie', one(FILE_LIKE, '/form'))
  assert.match(form, /'a=\\@notes\.txt'/)
  assert.match(form, /'\\@b=x'/)
  const raw = renderSample('httpie', one(FILE_LIKE, '/raw'))
  assert.match(raw, /--raw=@notes\.txt$/)
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
  for (const { request } of requests(spec)) for (const language of ['curl', 'httpie'] as const) assertSends(language, request)
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
  for (const { request } of requests(spec)) for (const language of ['curl', 'httpie'] as const) assertSends(language, request)
})

test('a method that is not an HTTP token gets no samples and a problem', () => {
  const spec = `openapi: 3.2.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /items:
    additionalOperations:
      'PURGE$(date)': { responses: { '200': { description: ok } } }
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
  assert.deepEqual(problems.map((p) => p.params.key), ['PURGE$(date)'])
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

test('an unpaired surrogate in a value becomes U+FFFD with a note, never an error', () => {
  // Before: encodeURIComponent threw "URI malformed" and the whole operation page was lost.
  const half = String.fromCharCode(0xd83d)
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    servers: [{ url: 'https://api.test' }],
    paths: {
      '/items/{id}': {
        get: {
          parameters: [
            { name: 'id', in: 'path', required: true, example: half },
            { name: 'q' + String.fromCharCode(0xd800), in: 'query', required: true, example: 'x' + String.fromCharCode(0xde00) },
            { name: 'X-Note', in: 'header', required: true, example: 'a' + half }
          ],
          responses: { 200: { description: 'ok' } }
        }
      },
      '/ok/{id}': { get: { parameters: [{ name: 'id', in: 'path', required: true, example: '\u{1F600}' }], responses: { 200: { description: 'ok' } } } }
    }
  })
  const broken = one(spec, '/items/{id}')
  assert.equal(broken.replaced, true)
  assert.equal(broken.url, 'https://api.test/items/%EF%BF%BD')
  for (const language of sampleLanguages(broken)) {
    const sample = renderSample(language, broken)
    assert.equal(wellFormed(sample), sample, language)
  }
  assert.match(renderSample('curl', broken), /q%EF%BF%BD=x%EF%BF%BD/)
  const fine = one(spec, '/ok/{id}')
  assert.equal(fine.replaced, undefined)
  assert.equal(fine.url, 'https://api.test/ok/%F0%9F%98%80')
  assert.equal(wellFormed('a\u{1F600}b'), 'a\u{1F600}b')
  assert.equal(wellFormed(String.fromCharCode(0xdc00, 0xd800)), '\ufffd\ufffd')
})

test('fetch and Python literals escape CR and the Unicode line separators', () => {
  // Before: a CR inside a single-quoted JS string made the fetch sample a syntax error.
  const spec = `openapi: 3.0.3
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /csv:
    post:
      parameters: [{ name: X-Note, in: header, required: true, example: "a\\rb\\u2028c\\u2029d" }]
      requestBody: { content: { text/csv: { example: "id,name\\r\\n1,Rex\\r\\n" } } }
      responses: { '200': { description: ok } }
  /form:
    post:
      requestBody: { content: { application/x-www-form-urlencoded: { example: { note: "line1\\r\\nline2" } } } }
      responses: { '200': { description: ok } }
  /multi:
    post:
      requestBody: { content: { multipart/form-data: { schema: { type: object, properties: { note: { type: string, example: "line1\\r\\nline2" } } } } } }
      responses: { '200': { description: ok } }
`
  for (const route of ['/csv', '/form', '/multi']) {
    const request = one(spec, route)
    for (const language of ['fetch', 'python'] as const) {
      const sample = renderSample(language, request)
      assert.ok(!/[\r\u2028\u2029]/.test(sample), `${language} ${route}: a raw line terminator`)
      if (language === 'fetch') {
        // No single-quoted literal runs over a line break.
        for (const line of sample.split('\n')) assert.equal((line.replace(/\\./g, '').match(/'/g) ?? []).length % 2, 0, line)
      }
    }
  }
  const csv = one(spec, '/csv')
  assert.match(renderSample('fetch', csv), /body: 'id,name\\r\\n1,Rex\\r\\n',/)
  assert.match(renderSample('fetch', csv), /'X-Note': 'a\\rb\\u2028c\\u2029d',/)
  assert.match(renderSample('python', csv), /data="id,name\\r\\n1,Rex\\r\\n"/)
  assert.match(renderSample('python', csv), /"X-Note": "a\\rb\\u2028c\\u2029d"/)
})

test('curl sends braces and brackets as they are, and unfilled templates are placeholders', () => {
  // Before: curl expanded [1-3] into three requests and {petId} into "petId".
  const spec = `openapi: 3.0.3
info: { title: T, version: '1' }
servers:
  - url: 'http://127.0.0.1:9/{region}/v1/[1-3]'
    variables: { region: { enum: [eu] } }
paths:
  /pets/{petId}:
    get: { responses: { '200': { description: ok } } }
  /items[0]/{id}:
    get:
      parameters: [{ name: id, in: path, required: true, content: { application/json: { schema: { type: string } } } }]
      responses: { '200': { description: ok } }
`
  const pets = one(spec, '/pets/{petId}')
  assert.equal(pets.url, 'http://127.0.0.1:9/<region>/v1/[1-3]/pets/<petId>')
  assert.deepEqual(pets.placeholders, ['<region>', '<petId>'])
  assert.match(renderSample('curl', pets), /^curl -g 'http:\/\/127\.0\.0\.1:9\/<region>\/v1\/\[1-3\]\/pets\/<petId>'$/)
  const items = one(spec, '/items[0]/{id}')
  assert.equal(items.url, 'http://127.0.0.1:9/<region>/v1/[1-3]/items[0]/<id>')
  for (const { request } of requests(spec)) for (const language of ['curl', 'httpie'] as const) assertSends(language, request)
  const plain = one(FILE_LIKE, '/raw')
  assert.equal(plain.placeholders, undefined)
  assert.ok(!renderSample('curl', plain).includes(' -g'), 'no -g when the URL has nothing to expand')
})

test('samples write arrays and objects as each parameter style says', () => {
  // Before: every array was joined with commas and every object sent as JSON, whatever the style.
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /pets/{ids}:
    get:
      parameters:
        - { name: ids, in: path, required: true, style: matrix, explode: true, example: [1, 2] }
        - { name: tag, in: query, required: true, example: [cat, dog] }
        - { name: size, in: query, required: true, explode: false, example: [S, M] }
        - { name: near, in: query, required: true, style: spaceDelimited, example: [1.5, 2.5] }
        - { name: by, in: query, required: true, style: pipeDelimited, example: [name, age] }
        - { name: filter, in: query, required: true, style: deepObject, example: { status: sold, color: red } }
        - { name: page, in: query, required: true, schema: { type: object, example: { from: 1, to: 9 } } }
        - { name: X-Range, in: header, required: true, explode: true, example: { from: 1, to: 9 } }
        - { name: seen, in: cookie, required: true, example: [a, b] }
      responses: { '200': { description: ok } }
`
  const request = one(spec, '/pets/{ids}')
  assert.equal(request.url, 'https://api.test/pets/;ids=1;ids=2')
  assert.deepEqual(request.query, [
    ['tag', 'cat'], ['tag', 'dog'], ['size', 'S,M'], ['near', '1.5 2.5'], ['by', 'name|age'],
    ['filter[status]', 'sold'], ['filter[color]', 'red'], ['from', '1'], ['to', '9']
  ])
  assert.deepEqual(request.headers, [['X-Range', 'from=1,to=9'], ['Cookie', 'seen=a; seen=b']])
  assert.equal(
    renderSample('curl', request).split('\n')[0],
    "curl -g 'https://api.test/pets/;ids=1;ids=2?tag=cat&tag=dog&size=S,M&near=1.5%202.5&by=name%7Cage&filter[status]=sold&filter[color]=red&from=1&to=9' \\"
  )
  for (const language of ['curl', 'httpie'] as const) assertSends(language, request)
  assert.match(renderSample('python', request), /params=\{"tag": \["cat", "dog"\], "size": "S,M", "near": "1\.5 2\.5", "by": "name\|age", "filter\[status\]": "sold", "filter\[color\]": "red", "from": "1", "to": "9"\}/)
})

test('Swagger 2.0 samples follow collectionFormat, in the query and in forms', () => {
  const spec = `swagger: '2.0'
info: { title: T, version: '1' }
host: api.test
schemes: [https]
paths:
  /find/{ids}:
    post:
      consumes: [application/x-www-form-urlencoded]
      parameters:
        - { name: ids, in: path, required: true, type: array, items: { type: integer }, collectionFormat: pipes, x-example: [1, 2] }
        - { name: tag, in: query, required: true, type: array, items: { type: string }, collectionFormat: multi, x-example: [cat, dog] }
        - { name: size, in: query, required: true, type: array, items: { type: string }, collectionFormat: ssv, x-example: [S, M] }
        - { name: kind, in: formData, required: true, type: array, items: { type: string }, collectionFormat: multi, x-example: [a, b] }
        - { name: note, in: formData, required: true, type: string, x-example: hi }
      responses: { '200': { description: ok } }
`
  const request = one(spec, '/find/{ids}')
  assert.equal(request.url, 'https://api.test/find/1%7C2')
  assert.deepEqual(request.query, [['tag', 'cat'], ['tag', 'dog'], ['size', 'S M']])
  assert.deepEqual(request.body!.form!.map((f) => [f.name, f.value]), [['kind', 'a'], ['kind', 'b'], ['note', 'hi']])
  for (const language of ['curl', 'httpie'] as const) assertSends(language, request)
  const python = renderSample('python', request)
  assert.match(python, /params=\{"tag": \["cat", "dog"\], "size": "S M"\}/)
  assert.match(python, /data=\{"kind": \["a", "b"\], "note": "hi"\}/)
  // An object literal would keep one of the repeated fields; fetch gets the list of pairs.
  assert.match(renderSample('fetch', request), /body: new URLSearchParams\(\[\n {4}\['kind', 'a'\],\n {4}\['kind', 'b'\],\n {4}\['note', 'hi'\],\n {2}\]\),/)
})
