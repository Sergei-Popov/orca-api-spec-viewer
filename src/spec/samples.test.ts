import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import type { OpenApiModel } from './openapi'
import { operationDetails } from './operation'
import { buildRequest, commonNotes, renderSample, sampleLanguages, sampleNotes, shellSafe, unavailableNotes, wellFormed, type SampleRequest } from './samples'

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
    if (word === '-I') {
      sent.method = 'HEAD'
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
        // curl splits at the first `=`; only without one would `name@file` read a file. The name
        // goes out as written, so the server decodes it.
        assert.ok(eq >= 0, `--data-urlencode ${arg} reads a file`)
        sent.fields.push([decodeURIComponent(arg.slice(0, eq)), arg.slice(eq + 1)])
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
  assert.equal(sent.url.split('?')[0], request.url.split('?')[0], sample)
  assert.deepEqual([...sent.query].sort(byName), [...queryOf(request.url), ...request.query].sort(byName), sample)
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
  assert.match(form, /--data-urlencode %40b=x/, 'curl sends the name as written, so it is encoded')
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
      '/ok/{id}': { get: { parameters: [{ name: 'id', in: 'path', required: true, example: '\u{1F600}' }], responses: { 200: { description: 'ok' } } } },
      '/items': {
        post: {
          requestBody: { content: { 'application/json': { example: { ['k' + half]: 'v' + String.fromCharCode(0xde00), list: [half] } } } },
          responses: { 200: { description: 'ok' } }
        }
      }
    }
  })
  const broken = one(spec, '/items/{id}')
  assert.equal(broken.replaced, true)
  assert.equal(broken.url, 'https://api.test/items/%EF%BF%BD')
  // Neither the half itself nor an escape of it (`\ud83d`, which JSON and Python would send on).
  const escaped = /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/
  for (const request of [broken, one(spec, '/items')]) {
    for (const language of sampleLanguages(request)) {
      const sample = renderSample(language, request)
      assert.equal(wellFormed(sample), sample, language)
      assert.ok(!escaped.test(sample), `${language}: ${sample}`)
    }
  }
  assert.match(renderSample('curl', broken), /q%EF%BF%BD=x%EF%BF%BD/)
  assert.match(renderSample('python', broken), /params=\{"q\ufffd": "x\ufffd"\}/)
  // U+FFFD is outside ASCII: in a header, fetch and Python cannot send it, so they leave it out.
  assert.match(renderSample('curl', broken), /-H 'X-Note: a\ufffd'/)
  assert.ok(!renderSample('python', broken).includes('X-Note'))
  assert.deepEqual(sampleNotes('python', broken).map((n) => n.key), ['headerAscii'])
  const body = one(spec, '/items')
  assert.equal(body.replaced, true)
  assert.deepEqual(body.body?.json, { ['k' + '\ufffd']: 'v\ufffd', list: ['\ufffd'] })
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
      parameters: [{ name: X-Note, in: header, required: true, example: "a\\u2028c\\u2029d" }]
      requestBody: { content: { text/csv: { example: "id,name\\r\\n1,Rex\\u2028\\r\\n" } } }
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
  assert.match(renderSample('fetch', csv), /body: 'id,name\\r\\n1,Rex\\u2028\\r\\n',/)
  assert.match(renderSample('python', csv), /data="id,name\\r\\n1,Rex\\u2028\\r\\n"/)
  // A header value outside ASCII is left out of fetch and Python (which would throw), with a note.
  assert.ok(!renderSample('fetch', csv).includes('X-Note'))
  assert.ok(!renderSample('python', csv).includes('X-Note'))
  assert.match(renderSample('curl', csv), /-H 'X-Note: a\u2028c\u2029d'/)
  assert.deepEqual(sampleNotes('fetch', csv).map((n) => n.key), ['headerAscii'])
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
  // A content parameter's value is its media type's text: a JSON string keeps its quotes.
  assert.equal(items.url, 'http://127.0.0.1:9/<region>/v1/[1-3]/items[0]/%22string%22')
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
  // Items joined with a literal separator (size, by) are exact only in the URL, so the whole query
  // is there, in its order, for every language: requests and HTTPie would encode the separators.
  const query = '?tag=cat&tag=dog&size=S,M&near=1.5%202.5&by=name|age&filter[status]=sold&filter[color]=red&from=1&to=9'
  assert.equal(request.url, 'https://api.test/pets/;ids=1;ids=2' + query)
  assert.deepEqual(request.query, [])
  assert.deepEqual(request.headers, [['X-Range', 'from=1,to=9'], ['Cookie', 'seen=a; seen=b']])
  assert.equal(renderSample('curl', request).split('\n')[0], `curl -g 'https://api.test/pets/;ids=1;ids=2${query}' \\`)
  for (const language of ['curl', 'httpie'] as const) assertSends(language, request)
  assert.ok(renderSample('python', request).includes(`"https://api.test/pets/;ids=1;ids=2${query}"`))
  assert.ok(!renderSample('python', request).includes('params='))
  // Without a join, the pairs stay pairs: requests and HTTPie encode them.
  const plain = one(spec.replace('explode: false, ', '').replace('style: spaceDelimited, ', '').replace('style: pipeDelimited, ', ''), '/pets/{ids}')
  assert.deepEqual(plain.query.slice(0, 4), [['tag', 'cat'], ['tag', 'dog'], ['size', 'S'], ['size', 'M']])
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

test('shell samples: no NUL, CR or stray line break, and every URL starts with its scheme', () => {
  // Coordinator check (same class as a HAR Viewer blocker). A NUL ends a shell argument, a CR can
  // run a pasted line early, and a line break in a header value would start another header.
  const spec = `openapi: 3.0.3
info: { title: Shell, version: '1' }
servers:
  - url: '{base}'
    variables: { base: { default: '-o/tmp/x' } }
paths:
  /header:
    get:
      parameters:
        - { name: X-Note, in: header, required: true, schema: { type: string }, example: "one\\ntwo" }
      responses: { '200': { description: ok } }
  /text:
    post:
      requestBody: { content: { text/plain: { example: "before\\u0000after" } } }
      responses: { '200': { description: ok } }
  /form:
    post:
      requestBody: { content: { application/x-www-form-urlencoded: { example: { note: "a\\rb" } } } }
      responses: { '200': { description: ok } }
  /lines:
    post:
      parameters:
        - { name: q, in: query, required: true, schema: { type: string }, example: "a\\u0000b" }
      requestBody: { content: { application/json: { example: { note: "x\\u0000y", text: "one\\ntwo" } } } }
      responses: { '200': { description: ok } }
  /cookie:
    get:
      parameters:
        - { name: sid, in: cookie, required: true, schema: { type: string }, example: notes.txt }
        - { name: '@notes.txt', in: header, required: true, schema: { type: string }, example: v }
      responses: { '200': { description: ok } }
`
  const all = requests(spec)
  const get = (route: string) => all.find((r) => r.route === route)!.request
  for (const route of ['/text', '/form']) {
    assert.deepEqual(sampleLanguages(get(route)), ['fetch', 'python'], route)
    assert.equal(shellSafe(get(route)), false, route)
  }
  // A header value with a line break cannot be sent by any client: it is left out, with a note.
  assert.deepEqual(sampleLanguages(get('/header')), ['curl', 'fetch', 'python', 'httpie'])
  assert.deepEqual(get('/header').headers, [])
  assert.deepEqual(commonNotes(get('/header')), [{ key: 'headerValue', values: { names: 'X-Note' } }])
  // Encoded query values and JSON escapes carry anything: HTTPie moves such values to the URL or --raw.
  assert.deepEqual(sampleLanguages(get('/lines')), ['curl', 'fetch', 'python', 'httpie'])
  const httpie = renderSample('httpie', get('/lines'))
  assert.ok(!/[\0\r]/.test(httpie), httpie)
  assert.match(httpie, /q=a%00b/)
  assert.match(httpie, /--raw=/)
  assertSends('curl', get('/lines'))
  assertSends('httpie', get('/lines'))
  // fetch shows control characters as escapes.
  assert.match(renderSample('fetch', get('/text')), /body: 'before\\x00after'/)
  for (const { request } of all) {
    // A server URL without a scheme gets the stand-in host, so the URL is never an option.
    assert.match(request.url, /^https:\/\/api\.example\.com\//)
    for (const language of sampleLanguages(request)) assert.ok(!/[\0\r]/.test(renderSample(language, request)), `${language} ${request.url}`)
  }
  // Cookies go in a Cookie header: curl reads a -b value without `=` as a file.
  const cookie = renderSample('curl', get('/cookie'))
  assert.match(cookie, /-H 'Cookie: sid=notes\.txt'/)
  assert.ok(!/ -b |--cookie/.test(cookie), cookie)
  assert.ok(!cookie.includes("-H '@"), cookie)
  // A URL that does not start with its scheme would go behind --url.
  const bare = renderSample('curl', { ...get('/cookie'), url: '-o/tmp/x', headers: [] })
  assert.match(bare, /^curl --url -o\/tmp\/x$/)
  assert.ok(!sampleLanguages({ ...get('/cookie'), url: '-o/tmp/x' }).includes('httpie'))
})

test('form field names are encoded for curl, so & and = stay in the name', () => {
  const request = one(`openapi: 3.0.3
info: { title: T, version: '1' }
servers: [{ url: 'http://127.0.0.1:9' }]
paths:
  /form:
    post:
      requestBody: { content: { application/x-www-form-urlencoded: { example: { 'a&b': one, 'c=d': two, 'notes@x': three } } } }
      responses: { '200': { description: ok } }
`, '/form')
  const curl = renderSample('curl', request)
  assert.match(curl, /--data-urlencode a%26b=one/)
  assert.match(curl, /--data-urlencode c%3Dd=two/)
  assert.match(curl, /--data-urlencode notes%40x=three/)
  assertSends('curl', request)
  assertSends('httpie', request)
})

const keys = (notes: { key: string }[]) => notes.map((n) => n.key)
const byMethod = (text: string, method: string, route: string) => {
  const found = requests(text).find((r) => r.method === method && r.route === route)
  assert.ok(found, `${method} ${route}`)
  return found.request
}

test('GET and HEAD keep their method with a body, and fetch leaves the body out with a note', () => {
  // Before: curl sent POST (-d without -X GET), the fetch sample threw, and an optional body with
  // no example went out as `{}`.
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /search:
    get:
      requestBody: { required: true, content: { application/json: { example: { q: 1 } } } }
      responses: { '200': { description: ok, content: { application/json: { schema: { type: object } } } } }
    head:
      requestBody: { content: { application/json: { example: { q: 1 } } } }
      responses: { '200': { description: ok } }
  /optional:
    get:
      requestBody: { content: { application/json: { schema: { type: object, properties: { q: { type: integer } } } } } }
      responses: { '204': { description: none } }
    post:
      requestBody: { content: { application/x-www-form-urlencoded: { schema: { type: object, additionalProperties: false } } } }
      responses: { '200': { description: ok, content: { text/csv: { schema: { type: string } } } } }
`
  const get = byMethod(spec, 'get', '/search')
  assert.equal(renderSample('curl', get).split('\n')[0], "curl -X GET https://api.test/search \\")
  assertSends('curl', get)
  assertSends('httpie', get)
  const fetchGet = renderSample('fetch', get)
  assert.ok(!/body:|Content-Type/.test(fetchGet), fetchGet)
  assert.deepEqual(sampleNotes('fetch', get), [{ key: 'bodyNoFetch', values: { method: 'GET' }, langs: ['fetch'] }])
  assert.match(renderSample('python', get), /requests\.get\(\n {4}"https:\/\/api\.test\/search",\n {4}json=\{/)
  assert.match(fetchGet, /const data = await response\.json\(\)$/)
  // HEAD is curl's -I, which takes no body; Python and HTTPie still send it.
  const head = byMethod(spec, 'head', '/search')
  assert.equal(renderSample('curl', head), 'curl -I https://api.test/search')
  assert.deepEqual(keys(sampleNotes('curl', head)), ['bodyNoHead'])
  assert.match(renderSample('python', head), /requests\.head\([\s\S]*json=[\s\S]*print\(response\.status_code\)$/)
  assert.match(renderSample('fetch', head), /method: 'HEAD'[\s\S]*console\.log\(response\.status\)$/)
  // An optional body with no example: none on GET, and none where the example would be empty.
  for (const method of ['get', 'post']) {
    const request = byMethod(spec, method, '/optional')
    assert.equal(request.body, undefined, method)
    assert.ok(!request.headers.some(([name]) => name === 'Content-Type'), method)
  }
  assert.match(renderSample('python', byMethod(spec, 'get', '/optional')), /print\(response\.status_code\)$/)
  assert.match(renderSample('python', byMethod(spec, 'post', '/optional')), /print\(response\.text\)$/)
  // OpenAPI 3.0 has consumers ignore a body on GET, HEAD and DELETE.
  const v30 = byMethod(spec.replace('3.1.0', '3.0.3'), 'get', '/search')
  assert.equal(v30.body, undefined)
  assert.deepEqual(commonNotes(v30), [{ key: 'bodyIgnored30', values: { method: 'GET' } }])
  assert.deepEqual(commonNotes(byMethod(spec.replace('3.1.0', '3.0.3'), 'get', '/optional')), [])
})

test('urlencoded and multipart bodies follow the Encoding Object', () => {
  // Before: arrays and objects went out as JSON text (address={"city":…}), in all of Stripe.
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /form:
    post:
      requestBody:
        content:
          application/x-www-form-urlencoded:
            schema: { type: object }
            example: { address: { city: Oslo, zip: '0150' }, tags: [a, b], obj: { k: v }, raw: { j: [1] } }
            encoding:
              address: { style: deepObject, explode: true }
              raw: { contentType: application/json }
      responses: { '200': { description: ok } }
  /joined:
    post:
      requestBody:
        content:
          application/x-www-form-urlencoded:
            example: { ids: [a, 'b,c'], name: x y, meta: { n: 1 } }
            encoding: { ids: { explode: false }, meta: { style: form, explode: false } }
      responses: { '200': { description: ok } }
  /multi:
    post:
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                photos: { type: array, items: { type: string, format: binary } }
            example: { tags: [a, b], meta: { n: 1 }, note: hi }
            encoding:
              meta: { headers: { X-Part: { schema: { type: string } } } }
      responses: { '200': { description: ok } }
`
  const form = one(spec, '/form')
  assert.deepEqual(form.body?.form?.map((f) => [f.name, f.value]), [
    ['address[city]', 'Oslo'], ['address[zip]', '0150'], ['tags', 'a'], ['tags', 'b'], ['k', 'v'], ['raw', '{"j":[1]}']
  ])
  assertSends('curl', form)
  assertSends('httpie', form)
  assert.match(renderSample('curl', form), /--data-urlencode 'address\[city\]=Oslo'/)
  assert.match(renderSample('python', form), /data=\{"address\[city\]": "Oslo", "address\[zip\]": "0150", "tags": \["a", "b"\], "k": "v", "raw": "\{\\"j\\":\[1\]\}"\}/)
  // Items joined with a literal comma: the whole form is text, each item encoded.
  const joined = one(spec, '/joined')
  assert.deepEqual(joined.body, { mediaType: 'application/x-www-form-urlencoded', text: 'ids=a,b%2Cc&name=x%20y&meta=n,1' })
  assertSends('curl', joined)
  assertSends('httpie', joined)
  assert.ok(joined.headers.some(([name, value]) => name === 'Content-Type' && value === 'application/x-www-form-urlencoded'))
  // multipart: an array is a part per item, an object one JSON part, an array of files a file part.
  const multi = one(spec, '/multi')
  assert.deepEqual(multi.body?.form, [
    { name: 'tags', value: 'a' },
    { name: 'tags', value: 'b' },
    { name: 'meta', value: '{"n":1}', contentType: 'application/json' },
    { name: 'note', value: 'hi' },
    { name: 'photos', value: 'file.bin', file: true }
  ])
  assertSends('curl', multi)
  assertSends('httpie', multi)
  // requests sends multipart only through files=, even with no file; the JSON part keeps its type.
  const python = renderSample('python', multi)
  assert.match(python, /files=\[\n {8}\("tags", \(None, "a"\)\),\n {8}\("tags", \(None, "b"\)\),\n {8}\("meta", \(None, "\{\\"n\\":1\}", "application\/json"\)\),/)
  assert.ok(!python.includes('data='), python)
  assert.deepEqual(keys(commonNotes(multi)), ['partHeaders', 'fileParts'])
  for (const language of ['curl', 'fetch', 'httpie'] as const) assert.deepEqual(keys(sampleNotes(language, multi)), ['partType'], language)
  assert.deepEqual(sampleNotes('python', multi), [])
  const textOnly = one(spec.replace('photos: { type: array, items: { type: string, format: binary } }', 'n: { type: string }'), '/multi')
  assert.match(renderSample('python', textOnly), /files=\[/)
})

test('cookies are percent-encoded unless their style is cookie, and fetch says browsers drop them', () => {
  // Before: `a;b=c` split the cookie in two, and spaces, quotes and non-ASCII went out raw.
  const spec = `openapi: 3.2.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /c:
    get:
      parameters:
        - { name: session, in: cookie, required: true, example: 'a;b=c' }
        - { name: sp, in: cookie, required: true, example: has space }
        - { name: un, in: cookie, required: true, example: ünï }
        - { name: raw, in: cookie, required: true, style: cookie, example: 'x%3By' }
      responses: { '200': { description: ok } }
`
  const request = one(spec, '/c')
  assert.deepEqual(request.headers, [['Cookie', 'session=a%3Bb%3Dc; sp=has%20space; un=%C3%BCn%C3%AF; raw=x%3By']])
  assert.deepEqual(keys(sampleNotes('fetch', request)), ['cookieFetch'])
  assert.deepEqual(sampleNotes('curl', request), [])
})

test('headers no client can send are left out with a note, in every language', () => {
  // Before: names that are not tokens vanished silently, and fetch and Python threw on the rest.
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /h:
    get:
      parameters:
        - { name: 'X Space', in: header, required: true, example: a }
        - { name: X-At@Sign, in: header, required: true, example: b }
        - { name: X-Pad, in: header, required: true, example: ' padded ' }
        - { name: X-Latin, in: header, required: true, example: café }
        - { name: X-Ok, in: header, required: true, example: fine }
      responses: { '200': { description: ok } }
`
  const request = one(spec, '/h')
  assert.deepEqual(request.headers, [['X-Latin', 'café'], ['X-Ok', 'fine']])
  assert.deepEqual(commonNotes(request), [
    { key: 'headerName', values: { names: 'X Space, X-At@Sign' } },
    { key: 'headerValue', values: { names: 'X-Pad' } }
  ])
  assert.ok(renderSample('curl', request).includes("-H 'X-Latin: café'"))
  for (const language of ['fetch', 'python'] as const) {
    assert.ok(!renderSample(language, request).includes('X-Latin'), language)
    assert.deepEqual(sampleNotes(language, request), [{ key: 'headerAscii', values: { names: 'X-Latin' }, langs: ['fetch', 'python'] }])
  }
})

test('route and server text is percent-encoded, and dot segments are values', () => {
  // Before: curl rejected a raw space, and a `..` value was removed by every client.
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test/{region}', variables: { region: { default: 'a b' } } }]
paths:
  /my files/{id}:
    get:
      parameters: [{ name: id, in: path, required: true, example: '..' }]
      responses: { '200': { description: ok } }
  /odd{brace:
    get: { responses: { '200': { description: ok } } }
`
  const files = one(spec, '/my files/{id}')
  assert.equal(files.url, 'https://api.test/a%20b/my%20files/%2E%2E')
  assert.deepEqual(keys(sampleNotes('fetch', files)), ['dotSegment'])
  assert.deepEqual(sampleNotes('curl', files), [])
  assert.equal(one(spec, '/odd{brace').url, 'https://api.test/a%20b/odd%7Bbrace')
})

test('a parameter with content takes the example of its media type, as that type’s text', () => {
  // Before: `f` went out as `f=`, the optional one not at all, and the header empty.
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /q:
    get:
      parameters:
        - { name: f, in: query, required: true, content: { application/json: { example: { a: 1 } } } }
        - { name: g, in: query, content: { application/json: { examples: { one: { value: [1, 2] } } } } }
        - { name: t, in: query, content: { text/plain: { example: plain text } } }
        - { name: X-J, in: header, required: true, content: { application/json: { example: { b: true } } } }
      responses: { '200': { description: ok } }
`
  const request = one(spec, '/q')
  assert.deepEqual(request.query, [['f', '{"a":1}'], ['g', '[1,2]'], ['t', 'plain text']])
  assert.deepEqual(request.headers, [['X-J', '{"b":true}']])
})

test('a sequence body (itemSchema) sends one generated item, with a note', () => {
  // Before: an itemSchema-only JSON Lines body was `-d '{}'`.
  const spec = `openapi: 3.2.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /events:
    post:
      requestBody: { required: true, content: { application/jsonl: { itemSchema: { type: object, properties: { id: { type: integer } } } } } }
      responses: { '200': { description: ok } }
`
  const request = one(spec, '/events')
  assert.deepEqual(request.body, { mediaType: 'application/jsonl', text: '{"id":0}\n' })
  assert.deepEqual(keys(commonNotes(request)), ['sequence'])
  assertSends('curl', request)
})

test('a language left out says why, and HTTPie and curl never drop an item silently', () => {
  // Before: HTTPie skipped empty names, names with a leading `-` and the M-SEARCH method without a
  // word, curl sent `=x` (a value with no name), and a pair moved to the URL changed the order.
  const spec = `openapi: 3.2.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /form:
    post:
      requestBody: { content: { application/x-www-form-urlencoded: { example: { '': x, '-dash': y, ok: z } } } }
      responses: { '200': { description: ok } }
  /multi:
    post:
      requestBody: { content: { multipart/form-data: { example: { 'a=b': v, '-dash': w } } } }
      responses: { '200': { description: ok } }
  /order:
    get:
      parameters:
        - { name: ids, in: query, required: true, example: [first, 'a\\=b', last] }
        - { name: X-Dash, in: header, required: true, example: 'a\\:b' }
      responses: { '200': { description: ok } }
  /ssdp:
    additionalOperations:
      M-SEARCH: { responses: { '200': { description: ok } } }
`
  const form = one(spec, '/form')
  assert.deepEqual(sampleLanguages(form), ['curl', 'fetch', 'python', 'httpie'])
  assert.match(renderSample('curl', form), /--data-raw '=x' \\\n {2}--data-urlencode -dash=y \\\n {2}--data-urlencode ok=z$/)
  assert.match(renderSample('httpie', form), /--raw='=x&-dash=y&ok=z'$/)
  assert.ok(renderSample('httpie', form).includes("Content-Type:application/x-www-form-urlencoded"))
  const multi = one(spec, '/multi')
  assert.deepEqual(sampleLanguages(multi), ['fetch', 'python'])
  assert.deepEqual(unavailableNotes(multi), [
    { key: 'noCurlField', values: { names: 'a=b' } },
    { key: 'noHttpieItems', values: { names: '-dash' } }
  ])
  const order = one(spec, '/order')
  assert.deepEqual(unavailableNotes(order), [{ key: 'noHttpieItems', values: { names: 'X-Dash' } }])
  // In the URL the pairs keep their order, for every language that writes the URL itself.
  assert.match(renderSample('curl', order), /\?ids=first&ids=a%5C%3Db&ids=last/)
  const ssdp = requests(spec).find((r) => r.method === 'M-SEARCH')!.request
  assert.deepEqual(sampleLanguages(ssdp), ['curl', 'fetch', 'python'])
  assert.deepEqual(unavailableNotes(ssdp), [{ key: 'noHttpieMethod', values: { method: 'M-SEARCH' } }])
})

test('a fetch multipart part with a bare line break says FormData sends CRLF', () => {
  const request = one(`openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /m:
    post:
      requestBody: { content: { multipart/form-data: { example: { note: "l1\\nl2" } } } }
      responses: { '200': { description: ok } }
`, '/m')
  assert.deepEqual(keys(sampleNotes('fetch', request)), ['partLineBreaks'])
  assert.deepEqual(sampleNotes('python', request), [])
})

test('fetch is left out for TRACE, TRACK and CONNECT, with a note; other clients keep them', () => {
  // Before: the JavaScript sample was offered and threw "'TRACE' HTTP method is unsupported".
  const spec = `openapi: 3.2.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /debug:
    trace: { responses: { '200': { description: ok } } }
    additionalOperations:
      TRACK: { responses: { '200': { description: ok } } }
      CONNECT: { responses: { '200': { description: ok } } }
      purge: { responses: { '204': { description: gone } } }
`
  for (const method of ['TRACE', 'TRACK', 'CONNECT']) {
    const request = byMethod(spec, method === 'TRACE' ? 'trace' : method, '/debug')
    assert.equal(request.method, method)
    assert.deepEqual(sampleLanguages(request), ['curl', 'python', 'httpie'], method)
    assert.deepEqual(commonNotes(request), [{ key: 'noFetchMethod', values: { method } }], method)
  }
  // A method in lower case: requests and HTTPie send it in capitals, and say so.
  const purge = byMethod(spec, 'purge', '/debug')
  assert.deepEqual(sampleLanguages(purge), ['curl', 'fetch', 'python', 'httpie'])
  assert.ok(renderSample('curl', purge).startsWith('curl -X purge '))
  for (const language of ['python', 'httpie'] as const) assert.deepEqual(sampleNotes(language, purge), [{ key: 'methodCase', values: { upper: 'PURGE' }, langs: ['python', 'httpie'] }])
  assert.deepEqual(sampleNotes('curl', purge), [])
  assert.deepEqual(sampleNotes('fetch', purge), [])
})

test('headers the client sets itself are left out of every sample, and fetch names those browsers drop', () => {
  // Before: Content-Length: 0 was made up for tus uploads; curl hung or sent a broken request,
  // and fetch threw on Transfer-Encoding, Keep-Alive, Upgrade and Connection.
  const spec = `openapi: 3.0.3
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /files/{id}:
    patch:
      parameters:
        - { name: id, in: path, required: true, example: f1 }
        - { name: Content-Length, in: header, required: true, schema: { type: integer } }
        - { name: Transfer-Encoding, in: header, required: true, example: chunked }
        - { name: Host, in: header, required: true, example: tus.test }
        - { name: connection, in: header, required: true, example: Upgrade }
        - { name: Keep-Alive, in: header, required: true, example: timeout=5 }
        - { name: TE, in: header, required: true, example: trailers }
        - { name: Trailer, in: header, required: true, example: Expires }
        - { name: Upgrade, in: header, required: true, example: h2c }
        - { name: Expect, in: header, required: true, example: 100-continue }
        - { name: Upload-Offset, in: header, required: true, example: 0 }
        - { name: Origin, in: header, required: true, example: 'https://app.test' }
        - { name: Sec-Purpose, in: header, required: true, example: prefetch }
        - { name: X-HTTP-Method-Override, in: header, required: true, example: TRACE }
      security: [{ hostKey: [] }]
      requestBody: { required: true, content: { application/offset+octet-stream: { schema: { type: string, format: binary } } } }
      responses: { '204': { description: ok } }
components:
  securitySchemes:
    hostKey: { type: apiKey, in: header, name: Host }
`
  const request = one(spec, '/files/{id}')
  assert.deepEqual(request.headers.map(([name]) => name), ['Upload-Offset', 'Origin', 'Sec-Purpose', 'X-HTTP-Method-Override', 'Content-Type'])
  assert.deepEqual(commonNotes(request), [{ key: 'clientHeaders', values: { names: 'Content-Length, Transfer-Encoding, Host, connection, Keep-Alive, TE, Trailer, Upgrade, Expect' } }])
  for (const language of sampleLanguages(request)) {
    const sample = renderSample(language, request).toLowerCase()
    for (const name of ['content-length', 'transfer-encoding', 'host:', 'keep-alive', 'upgrade', 'expect']) assert.ok(!sample.includes(name), `${language}: ${name}`)
  }
  assert.deepEqual(sampleNotes('fetch', request), [{ key: 'browserHeaders', values: { names: 'Origin, Sec-Purpose, X-HTTP-Method-Override' }, langs: ['fetch'] }])
  assert.deepEqual(sampleNotes('curl', request), [])
})

test('a JSON null body is sent as null by every client', () => {
  // Before: Python wrote json=None, which requests sends as no body and no Content-Type.
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /rerun:
    post:
      requestBody: { content: { application/json: { schema: { type: [object, 'null'] }, examples: { default: { value: null } } } } }
      responses: { '201': { description: ok } }
  /required:
    post:
      requestBody: { required: true, content: { application/json: { schema: { type: 'null' } } } }
      responses: { '201': { description: ok } }
`
  for (const route of ['/rerun', '/required']) {
    const request = one(spec, route)
    assert.deepEqual(request.body, { mediaType: 'application/json', json: null }, route)
    const python = renderSample('python', request)
    assert.ok(python.includes('headers={"Content-Type": "application/json"}'), python)
    assert.ok(python.includes('data="null"') && !python.includes('json='), python)
    assert.ok(renderSample('curl', request).includes("-d null"))
    assert.ok(renderSample('fetch', request).includes('body: JSON.stringify(null)'))
    assert.ok(renderSample('httpie', request).includes('--raw=null'))
    assert.deepEqual(commonNotes(request), [])
  }
})

test('a required form body whose schema names no fields: one placeholder file part, or no body, with a note', () => {
  // Before: Jira's addAttachment (an array of files) sent nothing from curl and Python and an
  // empty multipart from fetch and HTTPie, with no note.
  const spec = `openapi: 3.0.1
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /attachments:
    post:
      requestBody:
        required: true
        content: { multipart/form-data: { schema: { type: array, items: { $ref: '#/components/schemas/MultipartFile' } } } }
      responses: { '200': { description: ok } }
  /list:
    post:
      requestBody: { required: true, content: { application/x-www-form-urlencoded: { schema: { type: array, items: { type: string } } } } }
      responses: { '200': { description: ok } }
components:
  schemas:
    MultipartFile: { type: object, properties: { name: { type: string } } }
`
  const files = one(spec, '/attachments')
  assert.deepEqual(files.body, { mediaType: 'multipart/form-data', form: [{ name: 'file', value: 'file.bin', file: true }] })
  assert.deepEqual(keys(commonNotes(files)), ['formPlaceholder', 'fileParts'])
  assert.deepEqual(sampleLanguages(files), ['curl', 'fetch', 'python', 'httpie'])
  assertSends('curl', files)
  assertSends('httpie', files)
  assert.ok(renderSample('fetch', files).includes("form.append('file', fileInput.files[0])"))
  assert.ok(renderSample('python', files).includes('files={"file": open("file.bin", "rb")}'))
  const list = one(spec, '/list')
  assert.equal(list.body, undefined)
  assert.deepEqual(list.headers, [])
  assert.deepEqual(keys(commonNotes(list)), ['formNoFields'])
  assert.ok(renderSample('curl', list).startsWith('curl -X POST '))
})

test('a file part’s own type and headers from the Encoding Object are noted, not dropped silently', () => {
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /avatar:
    post:
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                avatar: { type: string, format: binary }
                docs: { type: array, items: { type: string, contentMediaType: application/pdf } }
                any: { type: string, format: binary }
                raw: { type: string, format: binary }
            encoding:
              avatar: { contentType: 'image/png, image/jpeg', headers: { X-Rate-Limit: { schema: { type: integer } } } }
              any: { contentType: 'image/*' }
              raw: { contentType: application/octet-stream }
      responses: { '200': { description: ok } }
`
  const request = one(spec, '/avatar')
  assert.deepEqual(commonNotes(request), [
    { key: 'fileType', values: { names: 'avatar, docs' } },
    { key: 'partHeaders', values: { names: 'avatar' } },
    { key: 'fileParts' }
  ])
})

test('fetch keeps a __proto__ key, which an object literal would turn into a prototype', () => {
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /json:
    post:
      parameters: [{ name: __proto__, in: header, required: true, example: h }]
      requestBody: { content: { application/json: { example: { __proto__: { x: 1 }, a: 1 } } } }
      responses: { '200': { description: ok } }
  /form:
    post:
      requestBody: { content: { application/x-www-form-urlencoded: { example: { __proto__: x, a: '1' } } } }
      responses: { '200': { description: ok } }
`
  const json = renderSample('fetch', one(spec, '/json'))
  assert.ok(json.includes(`['__proto__']: 'h',`), json)
  assert.ok(json.includes(`body: '{"__proto__":{"x":1},"a":1}',`), json)
  const form = renderSample('fetch', one(spec, '/form'))
  assert.ok(form.includes(`['__proto__']: 'x',`), form)
  // Run as JavaScript, the literals keep the key.
  const literal = { ['__proto__']: 'x', a: '1' }
  assert.deepEqual(Object.keys(literal), ['__proto__', 'a'])
})

test('pipeDelimited items that hold “|” are noted for Python and HTTPie, which encode every “|”', () => {
  const spec = `openapi: 3.1.0
info: { title: T, version: '1' }
servers: [{ url: 'https://api.test' }]
paths:
  /pp:
    get:
      parameters:
        - { name: pp, in: query, required: true, style: pipeDelimited, explode: false, example: [a, 'b|c'] }
        - { name: ok, in: query, required: true, style: pipeDelimited, explode: false, example: [a, b] }
      responses: { '200': { description: ok } }
`
  const request = one(spec, '/pp')
  assert.ok(request.url.endsWith('?pp=a|b%7Cc&ok=a|b'), request.url)
  for (const language of ['python', 'httpie'] as const) assert.deepEqual(sampleNotes(language, request), [{ key: 'pipeItems', values: { names: 'pp' }, langs: ['python', 'httpie'] }])
  assert.deepEqual(sampleNotes('curl', request), [])
})

test('half of a UTF-16 pair in server, route or joined query text is noted, and JSON text gets U+FFFD too', () => {
  // Before: these were replaced with no note, and JSON text kept the escape \ud83d.
  const half = String.fromCharCode(0xd83d)
  const ok = { 200: { description: 'ok' } }
  const spec = JSON.stringify({
    openapi: '3.2.0',
    info: { title: 'T', version: '1' },
    servers: [{ url: 'https://api.test/{v}', variables: { v: { default: 'v' + half } } }],
    paths: {
      '/srv': { get: { responses: ok } },
      ['/r' + half + '/x']: { get: { servers: [{ url: 'https://api.test' }], responses: ok } },
      '/joined': { get: { servers: [{ url: 'https://api.test' }], parameters: [{ name: 'f', in: 'query', required: true, explode: false, example: ['a' + half, 'b,c'] }], responses: ok } },
      '/qs': { get: { servers: [{ url: 'https://api.test' }], parameters: [{ name: 'q', in: 'querystring', content: { 'application/json': { example: { a: half } } } }], responses: ok } },
      '/content': { get: { servers: [{ url: 'https://api.test' }], parameters: [{ name: 'c', in: 'query', required: true, content: { 'application/json': { example: { a: half } } } }], responses: ok } },
      '/seq': { post: { servers: [{ url: 'https://api.test' }], requestBody: { content: { 'application/jsonl': { itemSchema: { type: 'object' }, example: { a: half } } } }, responses: ok } }
    }
  })
  const escaped = /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/
  for (const route of ['/srv', '/r' + half + '/x', '/joined', '/qs', '/content', '/seq']) {
    const request = one(spec, route)
    assert.equal(request.replaced, true, route)
    for (const language of sampleLanguages(request)) {
      const sample = renderSample(language, request)
      assert.ok(!escaped.test(sample) && !/%5Cud83d/i.test(sample), `${route} ${language}: ${sample}`)
    }
  }
  assert.equal(one(spec, '/srv').url, 'https://api.test/v%EF%BF%BD/srv')
  assert.ok(one(spec, '/joined').url.endsWith('?f=a%EF%BF%BD,b%2Cc'))
  assert.equal(one(spec, '/seq').body?.text, '{"a":"�"}\n')
})
