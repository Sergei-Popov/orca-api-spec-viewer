// The curl and HTTPie samples, run for real against a local echo server from a folder that holds
// a `.env` and a file named like an example value. Whatever the samples send must be the example
// text itself, never the contents of those files. Skipped when curl or HTTPie is not installed.

import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import type { OpenApiModel } from './openapi'
import { operationDetails } from './operation'
import { buildRequest, renderSample, sampleLanguages } from './samples'

const SECRET = 'SECRET=demo-value'

interface Received {
  method: string
  url: string
  headers: Record<string, string | string[]>
  body: string
}

function run(command: string, cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', command], { cwd, timeout: 30_000 }, (error: { code?: number } | null, stdout: unknown, stderr: unknown) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: `${stdout}${stderr}` })
    })
  })
}

function spec(port: number): string {
  return `openapi: 3.2.0
info: { title: Echo, version: '1' }
servers: [{ url: 'http://127.0.0.1:${port}' }]
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
      requestBody: { content: { application/x-www-form-urlencoded: { example: { a: '@.env', b: '=x' } } } }
      responses: { '200': { description: ok } }
  /search:
    get:
      parameters:
        - { name: q, in: query, required: true, example: '@.env' }
        - { name: X-Token, in: header, required: true, example: '@.env' }
      responses: { '200': { description: ok } }
  /items:
    additionalOperations:
      PURGE:
        requestBody: { content: { text/plain: { example: '<.env' } } }
        responses: { '200': { description: ok } }
`
}

/** What each operation must deliver, checked on the request the server got. */
const EXPECT: Record<string, (r: Received) => void> = {
  '/raw': (r) => assert.equal(r.body, '@.env'),
  '/notes': (r) => assert.deepEqual(JSON.parse(r.body), { note: '@.env', handle: '@alice', lt: '<.env' }),
  '/upload': (r) => {
    assert.match(r.body, /name="comment"\r\n(?:[^\r\n]+\r\n)*\r\n<\.env\r\n/)
    assert.match(r.body, /name="tag"\r\n(?:[^\r\n]+\r\n)*\r\n@\.env\r\n/)
    assert.ok(!/filename=/.test(r.body), 'no part is sent as a file')
  },
  '/form': (r) => {
    const form = new URLSearchParams(r.body)
    assert.equal(form.get('a'), '@.env')
    assert.equal(form.get('b'), '=x')
  },
  '/search': (r) => {
    assert.equal(new URL(r.url, 'http://x').searchParams.get('q'), '@.env')
    assert.equal(r.headers['x-token'], '@.env')
  },
  '/items': (r) => {
    assert.equal(r.method, 'PURGE')
    assert.equal(r.body, '<.env')
  }
}

test('curl and HTTPie samples send example values as text, never local files', async () => {
  const tools = { curl: (await run('command -v curl', tmpdir())).code === 0, httpie: (await run('command -v http', tmpdir())).code === 0 }
  if (!tools.curl && !tools.httpie) {
    console.log('skipped: neither curl nor HTTPie is installed')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'api-spec-viewer-samples-'))
  writeFileSync(join(dir, '.env'), SECRET + '\n')
  writeFileSync(join(dir, 'alice'), SECRET + '\n')
  const received: Received[] = []
  const server = createServer((req: { method: string; url: string; headers: Received['headers']; on(event: string, fn: (chunk?: unknown) => void): void }, res: { setHeader(name: string, value: string): void; end(body: string): void }) => {
    let body = ''
    req.on('data', (chunk) => (body += String(chunk)))
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body })
      res.setHeader('content-type', 'application/json')
      res.end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  try {
    const port = (server.address() as { port: number }).port
    const a = analyze(spec(port))
    const model = (a.model as { model: OpenApiModel }).model
    let ran = 0
    for (const op of model.operations) {
      const request = buildRequest(model, a.refs, op, operationDetails(model, a.refs, op))
      for (const language of sampleLanguages(request)) {
        if ((language !== 'curl' || !tools.curl) && (language !== 'httpie' || !tools.httpie)) continue
        const sample = renderSample(language, request)
        // Only the program changes: quiet curl, and HTTPie not reading the test's stdin.
        const command = language === 'curl' ? sample.replace(/^curl /, 'curl -sS --max-time 20 ') : sample.replace(/^http /, 'http --ignore-stdin --timeout=20 ')
        received.length = 0
        const result = await run(command, dir)
        const label = `${language} ${op.method.toUpperCase()} ${op.route}\n${sample}\n${result.out}`
        assert.equal(result.code, 0, label)
        assert.equal(received.length, 1, label)
        assert.ok(!JSON.stringify(received).includes('SECRET'), `a local file was sent: ${label}`)
        EXPECT[op.route](received[0])
        ran++
      }
    }
    assert.equal(ran, (tools.curl ? 6 : 0) + (tools.httpie ? 6 : 0))
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
