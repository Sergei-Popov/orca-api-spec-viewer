// Request samples for an operation, built offline from the document: curl, JavaScript fetch,
// Python requests and HTTPie. Values come from the document's examples, else from the schema.

import { exampleFromSchema } from './example'
import { jsonText } from './json-text'
import type { OpenApiModel, Operation } from './openapi'
import { operationSecurity, operationServers, requirementScheme } from './openapi'
import { styledHeader, styledPairs, styledPath, type ParamStyle, type StyleReport } from './param-style'
import type { MediaView, OperationDetails, ParamView } from './operation'
import { isObject, own, str } from './pointer'
import type { Refs } from './refs'
import { isHttpToken } from './token'
import { loneSurrogate, wellFormed } from './well-formed'

export type SampleLanguage = 'curl' | 'fetch' | 'python' | 'httpie'
export { isHttpToken, wellFormed }
export const SAMPLE_LANGUAGES: SampleLanguage[] = ['curl', 'fetch', 'python', 'httpie']

export interface FormField {
  name: string
  value: string
  file?: boolean
  /** A multipart part's own Content-Type (JSON for objects, or the Encoding Object's). */
  contentType?: string
}

/** A note under the samples; with `langs`, only under those languages' samples. */
export interface SampleNote {
  key: SampleNoteKey
  values?: Record<string, string>
  langs?: SampleLanguage[]
}

export type SampleNoteKey =
  | 'bodyIgnored30'
  | 'bodyNoFetch'
  | 'bodyNoHead'
  | 'cookieFetch'
  | 'headerName'
  | 'headerValue'
  | 'headerAscii'
  | 'dotSegment'
  | 'deepObject'
  | 'partType'
  | 'partHeaders'
  | 'partLineBreaks'
  | 'sequence'
  | 'noCurlField'
  | 'noHttpieMethod'
  | 'noHttpieItems'
  | 'noFetchMethod'
  | 'clientHeaders'
  | 'browserHeaders'
  | 'methodCase'
  | 'pipeItems'
  | 'formPlaceholder'
  | 'formNoFields'
  | 'fileType'
  | 'fileParts'

export interface SampleRequest {
  method: string
  /** Whether the method is an HTTP token (RFC 9110); samples are only offered when it is. */
  methodValid: boolean
  /** The URL, encoded; a query that has to be written exactly is in it too. */
  url: string
  /** Set when the document has no absolute server URL and the host is a stand-in. */
  placeholderHost: boolean
  /** Query pairs, not yet encoded (each tool encodes them). */
  query: [string, string][]
  headers: [string, string][]
  /** `basic` auth as curl's `-u` and requests' `auth=`. */
  basicAuth: boolean
  /** A value had an unpaired UTF-16 surrogate, which the samples show as U+FFFD. */
  replaced?: boolean
  /** `<name>` placeholders in the URL for templates the document leaves unfilled. */
  placeholders?: string[]
  /** What the success response holds, for the sample's last line. */
  response: 'json' | 'text' | 'none'
  /** Headers whose values have characters outside ASCII, which fetch and requests cannot send. */
  wideHeaders?: string[]
  notes: SampleNote[]
  body?: {
    mediaType: string
    json?: unknown
    text?: string
    form?: FormField[]
  }
}

const PLACEHOLDER_HOST = 'https://api.example.com'
/** Bodies longer than this as JSON text are replaced by an example made from the schema. */
const MAX_BODY = 100_000
const STANDARD_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query']
/** Header parameters OpenAPI says are ignored: the samples set these from the document's other parts. */
const IGNORED_HEADERS = /^(accept|content-type|authorization)$/i
/** A header value HTTP cannot carry: a line break or NUL, or spaces at its ends (RFC 9110 §5.5). */
const UNSENDABLE_VALUE = /[\0\r\n]|^[ \t]|[ \t]$/
/**
 * Headers the HTTP client sets itself, for the connection and the length of the message. Copied
 * into a sample they break the request (a Content-Length that does not match the body) or make
 * fetch throw (Node.js rejects Transfer-Encoding, Keep-Alive, Upgrade, Expect and Connection).
 */
const CLIENT_HEADERS = /^(content-length|transfer-encoding|host|connection|keep-alive|te|trailer|upgrade|expect)$/i
/** Other headers browsers do not let fetch set (the Fetch standard's forbidden request headers). */
const BROWSER_HEADERS = /^(accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|cookie2|date|dnt|origin|referer|set-cookie|via|proxy-.*|sec-.*)$/i
/** Method override headers, which browsers drop when they name a method fetch forbids. */
const METHOD_OVERRIDE = /^x-(http-)?method(-override)?$/i
/** Methods the Fetch standard forbids: fetch throws on them, in browsers and in Node.js. */
const FETCH_FORBIDDEN_METHOD = /^(connect|trace|track)$/i

export function buildRequest(model: OpenApiModel, refs: Refs, op: Operation, details: OperationDetails): SampleRequest {
  const servers = operationServers(model, op).servers
  let base = servers[0]?.resolved ?? ''
  let placeholderHost = false
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    placeholderHost = true
    base = PLACEHOLDER_HOST + (base.startsWith('/') ? base : base ? '/' + base : '')
  }
  base = base.replace(/\/+$/, '')
  // Encoding replaces half of a UTF-16 pair in the URL text (see encodeUrlText); said here.
  const replaced = illFormed(base) || illFormed(op.route)

  // Standard methods are lower-case field names; an OpenAPI 3.2 additional operation is keyed by
  // the method exactly as it is sent.
  const method = STANDARD_METHODS.includes(op.method) ? op.method.toUpperCase() : op.method
  const request: SampleRequest = {
    method,
    methodValid: isHttpToken(method),
    url: '',
    placeholderHost,
    query: [],
    headers: [],
    basicAuth: false,
    response: responseKind(details, method),
    notes: []
  }
  if (replaced) request.replaced = true
  const notes = request.notes
  const skippedNames: string[] = []
  const skippedValues: string[] = []
  const deep: string[] = []
  const cookies: string[] = []
  const clientHeaders: string[] = []
  const pipes: string[] = []
  // The query as each pair is written exactly; used when a pair joins items (see below).
  const exactQuery: string[] = []
  let joined = false
  let dotSegment = false
  let path = op.route
  let queryString: string | undefined
  for (const param of details.params) {
    if (param.stop) continue
    if (param.in === 'querystring') {
      // OpenAPI 3.2: one parameter that is the whole query string, written as its media type says.
      const written = querystringOf(refs, param, request)
      if (Array.isArray(written)) {
        request.query.push(...written)
        exactQuery.push(...written.map(([name, value]) => `${encodeQueryName(name)}=${encodeComponent(value)}`))
      } else if (written !== undefined) queryString = written
      continue
    }
    // Arrays and objects are written as the parameter's style (or collectionFormat) says; a
    // parameter with `content` as its media type says (JSON: `"text"`, not `text`).
    const given = paramValue(refs, param)
    // Encoding and JSON text replace the half of a pair themselves, so it is noticed here.
    if (illFormed(given) || illFormed(param.name)) request.replaced = true
    const value = contentText(param, given)
    const style = styleOf(param)
    if (param.in === 'path') {
      if (value === undefined) continue
      let text = styledPath(style, value, encodeComponent)
      // Clients remove a `.` or `..` segment; encoded, it stays a value.
      if (text === '.' || text === '..') {
        text = text.replace(/\./g, '%2E')
        dotSegment = true
      }
      path = path.split(`{${param.name}}`).join(text)
      if (illFormed(value)) request.replaced = true
    } else if (!param.required && (value === undefined || !hasGivenValue(param))) {
      continue
    } else if (param.in === 'query') {
      const report: StyleReport = {}
      request.query.push(...(value === undefined ? [[param.name, ''] as [string, string]] : styledPairs(style, value, undefined, report)))
      const exact = value === undefined ? [[param.name, ''] as [string, string]] : styledPairs(style, value, encodeQueryValue)
      exactQuery.push(...exact.map(([name, text]) => `${encodeQueryName(name)}=${text}`))
      if (report.joined) joined = true
      if (report.deep) deep.push(param.name)
      if (report.pipeInItem) pipes.push(param.name)
    } else if (param.in === 'header') {
      const text = value === undefined ? '' : styledHeader(style, value)
      // A name that is not a token cannot be sent; curl would read `@name…` as a file.
      if (!isHttpToken(param.name)) skippedNames.push(param.name)
      else if (IGNORED_HEADERS.test(param.name)) continue
      else if (CLIENT_HEADERS.test(param.name)) clientHeaders.push(param.name)
      else if (UNSENDABLE_VALUE.test(text)) skippedValues.push(param.name)
      else request.headers.push([param.name, text])
    } else if (param.in === 'cookie') {
      // Form style (the default) percent-encodes as RFC 6570 does; OpenAPI 3.2's `cookie` style
      // takes values as the document writes them, already escaped.
      const asIs = param.style === 'cookie'
      const encode = asIs ? undefined : encodeComponent
      for (const [name, text] of value === undefined ? [[param.name, '']] : styledPairs(style, value, encode)) cookies.push(`${asIs ? name : encodeComponent(name)}=${text}`)
    }
  }

  const security = operationSecurity(model, op)
  const requirement = security?.requirements[0]
  if (requirement) {
    for (const name of Object.keys(requirement)) {
      const found = requirementScheme(model, refs, name)
      if (found.kind !== 'local') continue
      const followed = refs.follow(found.value, found.loc).value
      if (!isObject(followed)) continue
      const type = str(own(followed, 'type'))
      const scheme = str(own(followed, 'scheme'))?.toLowerCase()
      if (type === 'apiKey') {
        const keyName = str(own(followed, 'name')) ?? 'api_key'
        const where = str(own(followed, 'in'))
        if (where === 'query') {
          request.query.push([keyName, '<API_KEY>'])
          exactQuery.push(`${encodeQueryName(keyName)}=<API_KEY>`)
        } else if (where === 'cookie') cookies.push(`${encodeComponent(keyName)}=<API_KEY>`)
        else if (!isHttpToken(keyName)) skippedNames.push(keyName)
        else if (CLIENT_HEADERS.test(keyName)) clientHeaders.push(keyName)
        else request.headers.push([keyName, '<API_KEY>'])
      } else if (type === 'basic' || (type === 'http' && scheme === 'basic')) {
        request.basicAuth = true
      } else if (type === 'http') {
        request.headers.push(['Authorization', `${scheme === 'bearer' || !scheme ? 'Bearer' : capitalize(scheme)} <TOKEN>`])
      } else if (type === 'oauth2' || type === 'openIdConnect') {
        request.headers.push(['Authorization', 'Bearer <ACCESS_TOKEN>'])
      }
    }
  }
  if (cookies.length > 0) {
    const text = cookies.join('; ')
    if (UNSENDABLE_VALUE.test(text)) skippedValues.push('Cookie')
    else request.headers.push(['Cookie', text])
  }

  if (details.body) addBody(request, model, refs, details.body, deep)

  // A template the document leaves unfilled (an undeclared path parameter, one with no example,
  // a server variable with no default) becomes a <name> placeholder to fill in before running.
  // The rest of the text is percent-encoded where a URL cannot hold it as it is (a space, `"`).
  const placeholders: string[] = []
  let url = ''
  const template = /\{([^{}]*)\}/g
  const whole = base + path
  let from = 0
  for (let match = template.exec(whole); match; match = template.exec(whole)) {
    const placeholder = `<${match[1]}>`
    if (!placeholders.includes(placeholder)) placeholders.push(placeholder)
    url += encodeUrlText(whole.slice(from, match.index)) + placeholder
    from = match.index + match[0].length
  }
  request.url = url + encodeUrlText(whole.slice(from))
  if (placeholders.length > 0) request.placeholders = placeholders
  if (queryString) request.url += (request.url.includes('?') ? '&' : '?') + queryString
  // Items joined with a literal separator (`a,b%2Cc`) are exact only in the URL: requests and
  // HTTPie would encode the separators too. The whole query goes there, so its order is kept.
  if (joined && exactQuery.length > 0) {
    if (illFormed(request.query)) request.replaced = true
    request.url += (request.url.includes('?') ? '&' : '?') + exactQuery.join('&')
    request.query = []
  }
  if ([request.url, request.query, request.headers, request.body].some((v) => illFormed(v))) {
    // Replaced in the request itself, so no language writes the half as an escape (`\ud83d` in
    // JSON or Python), which would send it on.
    request.replaced = true
    request.url = wellFormed(request.url)
    request.query = request.query.map(([name, value]) => [wellFormed(name), wellFormed(value)])
    request.headers = request.headers.map(([name, value]) => [wellFormed(name), wellFormed(value)])
    if (request.placeholders) request.placeholders = request.placeholders.map(wellFormed)
    const body = request.body
    if (body?.text !== undefined) body.text = wellFormed(body.text)
    if (body?.form) body.form = body.form.map((field) => ({ ...field, name: wellFormed(field.name), value: wellFormed(field.value) }))
    if (body && body.json !== undefined) body.json = wellFormedValue(body.json)
  }

  const wide = request.headers.filter(([, value]) => /[^\x00-\x7f]/.test(value)).map(([name]) => name)
  if (wide.length > 0) request.wideHeaders = wide
  const list = (names: string[]) => ({ names: [...new Set(names)].join(', ') })
  if (skippedNames.length > 0) notes.push({ key: 'headerName', values: list(skippedNames) })
  if (skippedValues.length > 0) notes.push({ key: 'headerValue', values: list(skippedValues) })
  if (clientHeaders.length > 0) notes.push({ key: 'clientHeaders', values: list(clientHeaders) })
  if (wide.length > 0) notes.push({ key: 'headerAscii', values: list(wide), langs: ['fetch', 'python'] })
  if (request.headers.some(([name]) => name === 'Cookie')) notes.push({ key: 'cookieFetch', langs: ['fetch'] })
  const browserDrops = request.headers
    .filter(([name, value]) => BROWSER_HEADERS.test(name) || (METHOD_OVERRIDE.test(name) && value.split(',').some((m) => FETCH_FORBIDDEN_METHOD.test(m.trim()))))
    .map(([name]) => name)
  if (browserDrops.length > 0) notes.push({ key: 'browserHeaders', values: list(browserDrops), langs: ['fetch'] })
  // requests and HTTPie send every method in capitals.
  if (method !== method.toUpperCase()) notes.push({ key: 'methodCase', values: { upper: method.toUpperCase() }, langs: ['python', 'httpie'] })
  if (pipes.length > 0) notes.push({ key: 'pipeItems', values: list(pipes), langs: ['python', 'httpie'] })
  if (request.body?.form?.some((f) => f.file)) notes.push({ key: 'fileParts' })
  if (dotSegment) notes.push({ key: 'dotSegment', langs: ['fetch', 'python', 'httpie'] })
  // FormData sends every line break in a text part as CRLF (the HTML form encoding).
  const parts = request.body?.form && /multipart/i.test(request.body.mediaType) ? request.body.form : []
  if (parts.some((f) => !f.file && /\r(?!\n)|(?<!\r)\n/.test(f.value))) notes.push({ key: 'partLineBreaks', langs: ['fetch'] })
  if (deep.length > 0) notes.push({ key: 'deepObject', values: list(deep) })
  if (request.body && (method === 'GET' || method === 'HEAD')) notes.push({ key: 'bodyNoFetch', values: { method }, langs: ['fetch'] })
  if (request.body && method === 'HEAD') notes.push({ key: 'bodyNoHead', langs: ['curl'] })
  return request
}

/**
 * The request body: the media type the samples can write best, its example (or one made from the
 * schema), written as JSON, a form, a sequence or text. An optional body is sent only with
 * something in it, and on GET or HEAD only when the document gives an example.
 */
function addBody(request: SampleRequest, model: OpenApiModel, refs: Refs, view: OperationDetails['body'] & object, deep: string[]): void {
  const method = request.method
  const notes = request.notes
  // OpenAPI 3.0: "In other cases where the HTTP spec is vague (such as GET, HEAD and DELETE),
  // requestBody SHALL be ignored by consumers."
  const media = pickMedia(view.media)
  if (!media) return
  const given = media.examples.some((e) => e.hasValue) || view.formFields.some((f) => hasGivenValue(f))
  if (model.family === 'openapi30' && (method === 'GET' || method === 'HEAD' || method === 'DELETE')) {
    // Said only where there was something to send.
    if (view.required || given) notes.push({ key: 'bodyIgnored30', values: { method } })
    return
  }
  if (!view.required && !given && (method === 'GET' || method === 'HEAD')) return
  const example = mediaExample(refs, media)
  // Form fields and JSON text replace the half of a pair themselves, so it is noticed here.
  if (illFormed(example)) request.replaced = true
  let body: NonNullable<SampleRequest['body']>
  if (view.formFields.length > 0) {
    // Swagger 2.0 formData parameters, each written as its collectionFormat says.
    const fields: Field[] = view.formFields.flatMap((field): Field[] => {
      if (own(field.raw, 'type') === 'file') return [{ name: field.name, value: FILE_PLACEHOLDER, file: true, exact: FILE_PLACEHOLDER }]
      const value = paramValue(refs, field)
      if (illFormed(value)) request.replaced = true
      if (value === undefined) return [{ name: field.name, value: '', exact: '' }]
      return styledFields(styleOf(field), value, false)
    })
    body = formBodyOf(media.type, fields)
  } else if (media.itemSchema || SEQUENCES.test(media.type)) {
    body = sequenceBody(refs, media, request)
  } else if (isJsonMedia(media.type)) {
    body = { mediaType: media.type, json: example === undefined ? {} : example }
  } else if (/x-www-form-urlencoded|multipart\/form-data/i.test(media.type)) {
    const form = formFields(refs, media, example, model.family, deep, notes)
    if (form.length === 0 && view.required) {
      // The schema is not an object with properties (an array of files, say): the parts have no
      // names to take. A multipart body gets one file part in their place; a urlencoded one none.
      if (!/multipart/i.test(media.type)) {
        notes.push({ key: 'formNoFields' })
        return
      }
      form.push({ name: 'file', value: FILE_PLACEHOLDER, file: true, exact: FILE_PLACEHOLDER })
      notes.push({ key: 'formPlaceholder' })
    }
    body = formBodyOf(media.type, form)
  } else {
    body = { mediaType: media.type, text: typeof example === 'string' ? example : example === undefined ? '' : jsonText(example, { maxLength: MAX_BODY, indent: 2, wellFormed: true }).text }
  }
  if (!view.required && isEmptyBody(body)) return
  request.body = body
  // curl, requests and HTTPie set the multipart boundary themselves.
  if (!(body.form && /multipart/i.test(body.mediaType))) request.headers.push(['Content-Type', media.type])
}

function isEmptyBody(body: NonNullable<SampleRequest['body']>): boolean {
  if (body.form) return body.form.length === 0
  if (body.json !== undefined) return isObject(body.json) && Object.keys(body.json).length === 0
  return (body.text ?? '') === ''
}

/** A form field, with its value as written exactly (items encoded, separators literal). */
interface Field extends FormField {
  exact: string
  /** Items were joined with a separator that has to stay literal. */
  joined?: boolean
}

const FILE_PLACEHOLDER = 'file.bin'

/**
 * Form fields of a style: urlencoded pairs as the parameter style rules say (OpenAPI's Encoding
 * Object, or Swagger's collectionFormat).
 */
function styledFields(style: ParamStyle, value: unknown, multipart: boolean, report: StyleReport = {}): Field[] {
  const raw = styledPairs(style, value, undefined, report)
  const exact = styledPairs(style, value, encodeComponent)
  return raw.map(([name, text], i) => ({ name, value: text, exact: exact[i]?.[1] ?? encodeComponent(text), joined: !multipart && report.joined }))
}

/**
 * A urlencoded body whose fields join items with a literal separator is written as text, each
 * item encoded, since every tool would encode the separators too; other bodies stay fields.
 */
function formBodyOf(mediaType: string, fields: Field[]): NonNullable<SampleRequest['body']> {
  if (!/multipart/i.test(mediaType) && fields.some((f) => f.joined)) {
    return { mediaType, text: fields.map((f) => `${encodeQueryName(f.name)}=${f.exact}`).join('&') }
  }
  return { mediaType, form: fields.map(({ name, value, file, contentType }) => ({ name, value, ...(file ? { file } : {}), ...(contentType ? { contentType } : {}) })) }
}

/** Sequential media types (OpenAPI 3.2), whose body is a stream of items. */
const SEQUENCES = /^(application\/(jsonl|x-jsonlines|x-ndjson|ndjson|json-seq)|text\/event-stream)\s*(;|$)/i

/** One item of a sequence, generated from `itemSchema` (or the example the document gives). */
function sequenceBody(refs: Refs, media: MediaView, request: SampleRequest): NonNullable<SampleRequest['body']> {
  const given = media.examples.find((e) => e.hasValue)
  if (given && typeof given.value === 'string') return { mediaType: media.type, text: given.value }
  const schema = media.itemSchema ?? media.schema
  let items: unknown[]
  if (given && Array.isArray(given.value)) items = given.value
  else if (given) items = [given.value]
  else {
    const made = schema && !schema.stop ? exampleFromSchema(refs, schema.value, schema.loc, { mode: 'request' }) : undefined
    items = made === undefined ? [] : [made]
    if (items.length > 0) request.notes.push({ key: 'sequence' })
  }
  if (illFormed(items)) request.replaced = true
  const line = (item: unknown) => jsonText(item, { maxLength: MAX_BODY, wellFormed: true }).text
  const type = media.type.toLowerCase()
  const text = type.startsWith('text/event-stream')
    ? items.map((item) => `data: ${line(item)}\n\n`).join('')
    : type.startsWith('application/json-seq')
      ? items.map((item) => `\x1e${line(item)}\n`).join('')
      : items.map((item) => `${line(item)}\n`).join('')
  return { mediaType: media.type, text }
}

function isJsonMedia(type: string): boolean {
  return /^[^;]*[/+]json\s*(;|$)/i.test(type)
}

/** What the first success response holds: nothing for HEAD and 204/205, else JSON or text. */
function responseKind(details: OperationDetails, method: string): SampleRequest['response'] {
  if (method === 'HEAD') return 'none'
  const success = details.responses.find((r) => /^2/.test(r.status)) ?? details.responses.find((r) => r.status === 'default')
  if (!success) return 'text'
  if (/^20[45]$/.test(success.status)) return 'none'
  return success.media.length > 0 && isJsonMedia(success.media[0].type) ? 'json' : 'text'
}

/** A JSON value with every string and key well formed (see wellFormed). */
function wellFormedValue(value: unknown, depth = 0, active = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return wellFormed(value)
  if (value === null || typeof value !== 'object' || depth > 500 || active.has(value)) return value
  active.add(value)
  const out = Array.isArray(value)
    ? value.map((item) => wellFormedValue(item, depth + 1, active))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [wellFormed(key), wellFormedValue(item, depth + 1, active)]))
  active.delete(value)
  return out
}

/** Whether a string, or any string or key in a JSON value, has an unpaired surrogate. */
function illFormed(value: unknown, budget = 100_000): boolean {
  const stack: unknown[] = [value]
  while (stack.length > 0 && budget-- > 0) {
    const v = stack.pop()
    if (typeof v === 'string') {
      if (loneSurrogate(v, 0) >= 0) return true
    } else if (Array.isArray(v)) {
      for (const item of v) stack.push(item)
    } else if (isObject(v)) {
      for (const key of Object.keys(v)) stack.push(key, v[key])
    }
  }
  return false
}

/** encodeURIComponent that does not throw on an unpaired surrogate. */
function encodeComponent(text: string): string {
  return encodeURIComponent(wellFormed(text))
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function pickMedia(media: MediaView[]): MediaView | undefined {
  return (
    media.find((m) => /^application\/json\b/i.test(m.type)) ??
    media.find((m) => /[/+]json\b/i.test(m.type)) ??
    media.find((m) => /x-www-form-urlencoded/i.test(m.type)) ??
    media.find((m) => /multipart\/form-data/i.test(m.type)) ??
    media[0]
  )
}

function mediaExample(refs: Refs, media: MediaView): unknown {
  const fromSchema = () => (media.schema && !media.schema.stop ? exampleFromSchema(refs, media.schema.value, media.schema.loc, { mode: 'request' }) : undefined)
  const given = media.examples.find((e) => e.hasValue)
  if (!given) return fromSchema()
  // A huge example (or YAML aliases that stand for one) would make an unreadable sample.
  if (tooLarge(given.value)) {
    const made = fromSchema()
    return made === undefined || tooLarge(made) ? undefined : made
  }
  return given.value
}

function tooLarge(value: unknown): boolean {
  if (typeof value === 'string') return value.length > MAX_BODY
  return jsonText(value, { maxLength: MAX_BODY }).cut
}

/**
 * A querystring parameter's example: name–value pairs for a form-encoded object (each tool encodes
 * them), or the query string itself, from an example's serializedValue or percent-encoded.
 */
function querystringOf(refs: Refs, param: ParamView, request: SampleRequest): [string, string][] | string | undefined {
  const media = param.content[0]
  const serialized = [...param.examples, ...(media?.examples ?? [])].find((e) => e.serializedValue !== undefined)?.serializedValue
  if (serialized !== undefined) return serialized.replace(/^\?/, '')
  const value = paramValue(refs, param) ?? (media ? mediaExample(refs, media) : undefined)
  if (value === undefined || value === null) return undefined
  if (illFormed(value)) request.replaced = true
  if (media && /x-www-form-urlencoded/i.test(media.type) && isObject(value)) {
    // As a form is encoded: an array repeats its name.
    return Object.keys(value).flatMap((name) => {
      const items = Array.isArray(value[name]) ? (value[name] as unknown[]) : [value[name]]
      return items.map((item): [string, string] => [name, item !== null && typeof item === 'object' ? compact(item) : String(item)])
    })
  }
  return encodeComponent(typeof value === 'string' ? value : compact(value))
}

function styleOf(param: ParamView): ParamStyle {
  return { name: param.name, style: param.style, explode: param.explode, collectionFormat: param.collectionFormat, json: param.content.length > 0 }
}

/** A `content` parameter's value as one text of its media type: JSON, or a string as it is. */
function contentText(param: ParamView, value: unknown): unknown {
  const media = param.content[0]
  if (!media || value === undefined) return value
  if (isJsonMedia(media.type)) return compact(value)
  return typeof value === 'string' ? value : compact(value)
}

/** Whether the document gives the parameter a value: an example, in it or in its `content`. */
function hasGivenValue(param: ParamView): boolean {
  return param.hasExample || param.examples.some((e) => e.hasValue) || (param.content[0]?.examples.some((e) => e.hasValue) ?? false)
}

/**
 * The parameter's example value as the document gives it (or one made from its schema). A
 * parameter with `content` has its examples in the media type (OpenAPI 3.1 and later only there).
 */
function paramValue(refs: Refs, param: ParamView): unknown {
  let value: unknown
  const media = param.content[0]
  if (param.hasExample) value = param.example
  else if (param.examples.find((e) => e.hasValue)) value = param.examples.find((e) => e.hasValue)!.value
  else if (media?.examples.find((e) => e.hasValue)) value = media.examples.find((e) => e.hasValue)!.value
  else if (media) {
    if (param.required && media.schema && !media.schema.stop) value = exampleFromSchema(refs, media.schema.value, media.schema.loc, { mode: 'request', maxDepth: 3 })
  } else if (param.schema && !param.schema.stop) {
    const schema = param.schema.value
    if (isObject(schema)) {
      if (Object.prototype.hasOwnProperty.call(schema, 'example')) value = schema.example
      else if (Object.prototype.hasOwnProperty.call(schema, 'default')) value = schema.default
      else if (Array.isArray(schema.enum) && schema.enum.length > 0) value = schema.enum[0]
      else if (param.required) value = exampleFromSchema(refs, schema, param.schema.loc, { mode: 'request', maxDepth: 3 })
    }
  }
  return value === null ? undefined : value
}

/** Compact JSON for a parameter or form value, with a size cap. */
function compact(value: unknown): string {
  return jsonText(value, { maxLength: 4000, wellFormed: true }).text
}

function isBinary(schema: unknown): boolean {
  return isObject(schema) && (schema.format === 'binary' || schema.contentMediaType !== undefined)
}

/**
 * The fields of an OpenAPI 3 urlencoded or multipart body, as its Encoding Object says. urlencoded:
 * each property as a parameter of its `style` and `explode` (form and true by default), so arrays
 * repeat their name and deepObject writes `name[key]`; one with only a `contentType` is written
 * as that type (JSON). multipart: an array is one part per item, an object one JSON part, and a
 * binary property (or an array of them) a file part.
 */
function formFields(refs: Refs, media: MediaView, example: unknown, family: OpenApiModel['family'], deep: string[], notes: SampleNote[]): Field[] {
  const multipart = /multipart/i.test(media.type)
  const fields: Field[] = []
  const typed: string[] = []
  const withHeaders: string[] = []
  const fileTyped: string[] = []
  const schema = media.schema && !media.schema.stop ? refs.follow(media.schema.value, media.schema.loc).value : undefined
  const props = isObject(schema) && isObject(schema.properties) ? schema.properties : {}
  const values = isObject(example) ? example : {}
  const encodings = isObject(media.encoding) ? media.encoding : {}
  const names = new Set([...Object.keys(values), ...Object.keys(props)])
  for (const name of names) {
    const prop = refs.follow(props[name], { doc: '', path: [] }).value
    const items = isObject(prop) && prop.type === 'array' ? refs.follow(prop.items, { doc: '', path: [] }).value : undefined
    const encoding = isObject(encodings[name]) ? encodings[name] : {}
    if (isBinary(prop) || isBinary(items)) {
      // A file goes with its own type; the document's (Encoding or contentMediaType) is not sent.
      const binary = isBinary(items) ? items : prop
      const fileType = str(own(encoding, 'contentType')) ?? (isObject(binary) ? str(own(binary, 'contentMediaType')) : undefined)
      if (fileType && !/\*|^\s*application\/octet-stream\s*$/i.test(fileType)) fileTyped.push(name)
      if (multipart && isObject(own(encoding, 'headers')) && Object.keys(own(encoding, 'headers') as object).length > 0) withHeaders.push(name)
      fields.push({ name, value: FILE_PLACEHOLDER, file: true, exact: FILE_PLACEHOLDER })
      continue
    }
    const value = values[name]
    if (value === undefined) continue
    const contentType = str(own(encoding, 'contentType'))
    // 3.0 applies style only to urlencoded bodies; 3.1 and later to multipart too.
    const styled = ['style', 'explode', 'allowReserved'].some((key) => own(encoding, key) !== undefined) && (!multipart || family !== 'openapi30')
    const style = str(own(encoding, 'style')) ?? 'form'
    const explode = typeof own(encoding, 'explode') === 'boolean' ? (own(encoding, 'explode') as boolean) : style === 'form'
    if (multipart) {
      if (isObject(own(encoding, 'headers')) && Object.keys(own(encoding, 'headers') as object).length > 0) withHeaders.push(name)
      if (styled) {
        fields.push(...styledFields({ name, style, explode }, value, true))
        continue
      }
      for (const item of Array.isArray(value) ? value.slice(0, 100) : [value]) {
        const object = item !== null && typeof item === 'object'
        const type = contentType ?? (object ? 'application/json' : undefined)
        const text = object ? compact(item) : String(item)
        if (type && !/^text\/plain\b/i.test(type)) {
          fields.push({ name, value: text, contentType: type, exact: encodeComponent(text) })
          typed.push(name)
        } else fields.push({ name, value: text, exact: encodeComponent(text) })
      }
    } else if (contentType && !styled) {
      const text = typeof value === 'string' ? value : compact(value)
      fields.push({ name, value: text, exact: encodeComponent(text) })
    } else {
      const report: StyleReport = {}
      fields.push(...styledFields({ name, style, explode }, value, false, report))
      if (report.deep) deep.push(name)
    }
  }
  if (typed.length > 0) notes.push({ key: 'partType', values: { names: [...new Set(typed)].join(', ') }, langs: ['curl', 'fetch', 'httpie'] })
  if (fileTyped.length > 0) notes.push({ key: 'fileType', values: { names: fileTyped.join(', ') } })
  if (withHeaders.length > 0) notes.push({ key: 'partHeaders', values: { names: withHeaders.join(', ') } })
  return fields
}

/** A query name, encoded; brackets (deepObject's `filter[status]`) stay readable. */
function encodeQueryName(name: string): string {
  return encodeComponent(name).replace(/%5B/g, '[').replace(/%5D/g, ']')
}

function urlWithQuery(request: SampleRequest): string {
  if (request.query.length === 0) return request.url
  const query = request.query.map(([k, v]) => `${encodeQueryName(k)}=${encodeQueryValue(v)}`).join('&')
  return `${request.url}${request.url.includes('?') ? '&' : '?'}${query}`
}

/** Keeps `<API_KEY>`-style placeholders readable in URLs. */
function encodeQueryValue(value: string): string {
  return /^<[A-Z_]+>$/.test(value) ? value : encodeComponent(value)
}

/**
 * Server and route text as a URL holds it: characters a URL cannot hold as they are (a space, a
 * quote, a brace, non-ASCII) are percent-encoded; `/`, the other reserved characters and `%XX`
 * escapes stay. Brackets stay too (curl gets -g for them).
 */
function encodeUrlText(text: string): string {
  return text.replace(/%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~!$&'()*+,;=:@/?#[\]%]/gu, (c) => encodeComponent(c))
}

/** POSIX shell single quoting, only when needed. zsh expands a word that starts with `=`. */
export function shellQuote(text: string): string {
  if (text !== '' && !text.startsWith('=') && /^[A-Za-z0-9_./:=@%+,-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** NUL ends a shell argument, and CR can run a pasted line early. */
const UNSAFE_DATA = /[\0\r]/
/** Names, headers and URLs take no line break either: in a header it would start another one. */
const UNSAFE_LINE = /[\0\r\n]/

/**
 * Whether a shell command (curl, HTTPie) can carry the request exactly and safely. Query pairs and
 * JSON bodies always can: curl writes them encoded, and HTTPie falls back to the URL or --raw.
 */
export function shellSafe(request: SampleRequest): boolean {
  if (UNSAFE_LINE.test(request.url)) return false
  if (request.headers.some(([name, value]) => UNSAFE_LINE.test(name) || UNSAFE_LINE.test(value))) return false
  const body = request.body
  if (body?.form?.some((field) => UNSAFE_LINE.test(field.name) || UNSAFE_DATA.test(field.value))) return false
  if (body?.text !== undefined && UNSAFE_DATA.test(body.text)) return false
  return true
}

/**
 * The languages a request can be written in: shell commands only when shellSafe, curl only when
 * it can name every multipart field, and HTTPie only for methods made of letters and items it can
 * write exactly. unavailableNotes says why a language is missing.
 */
export function sampleLanguages(request: SampleRequest): SampleLanguage[] {
  if (!request.methodValid) return []
  const shell = shellSafe(request)
  return SAMPLE_LANGUAGES.filter((language) => {
    if (language === 'curl') return shell && curlFieldNames(request).length === 0
    // A URL that starts with `-` would be an option (buildRequest always gives one a scheme).
    if (language === 'httpie') return shell && /^[A-Za-z]+$/.test(request.method) && !request.url.startsWith('-') && httpieMisses(request).length === 0
    if (language === 'fetch') return !FETCH_FORBIDDEN_METHOD.test(request.method)
    return true
  })
}

/** Why fetch, curl or HTTPie has no sample, when the shell is not the reason (see shellSafe). */
export function unavailableNotes(request: SampleRequest): SampleNote[] {
  if (!request.methodValid) return []
  const notes: SampleNote[] = []
  if (FETCH_FORBIDDEN_METHOD.test(request.method)) notes.push({ key: 'noFetchMethod', values: { method: request.method } })
  if (!shellSafe(request)) return notes
  const fields = curlFieldNames(request)
  if (fields.length > 0) notes.push({ key: 'noCurlField', values: { names: fields.join(', ') } })
  if (!/^[A-Za-z]+$/.test(request.method)) notes.push({ key: 'noHttpieMethod', values: { method: request.method } })
  else {
    const misses = httpieMisses(request)
    if (misses.length > 0) notes.push({ key: 'noHttpieItems', values: { names: misses.join(', ') } })
  }
  return notes
}

/** The notes under one language's sample: the request's own, and that language's. */
export function sampleNotes(language: SampleLanguage, request: SampleRequest): SampleNote[] {
  return request.notes.filter((note) => note.langs?.includes(language) ?? false)
}

/** The notes for every language. */
export function commonNotes(request: SampleRequest): SampleNote[] {
  return [...request.notes.filter((note) => !note.langs), ...unavailableNotes(request)]
}

/** Multipart field names curl cannot write: it splits `-F` and --form-string at the first `=`. */
function curlFieldNames(request: SampleRequest): string[] {
  const body = request.body
  if (!body?.form || !/multipart/i.test(body.mediaType)) return []
  return [...new Set(body.form.filter((field) => field.name === '' || field.name.includes('=')).map((field) => (field.name === '' ? '“”' : field.name)))]
}

/**
 * What HTTPie cannot write exactly: a header named with a leading `-` (read as an option) or with a
 * value that has a backslash before `: ; = @` (HTTPie drops it), and multipart fields with such
 * names or values. Query pairs then go in the URL, and urlencoded and JSON bodies through --raw.
 */
function httpieMisses(request: SampleRequest): string[] {
  const misses: string[] = []
  for (const [name, value] of request.headers) if (name.startsWith('-') || /\\[:;=@]/.test(value)) misses.push(name)
  const body = request.body
  if (body?.form && /multipart/i.test(body.mediaType)) {
    for (const field of body.form) if (httpieKey(field.name) === null || (!field.file && httpieValue(field.value) === null)) misses.push(field.name === '' ? '“”' : field.name)
  }
  return [...new Set(misses)]
}

export function renderSample(language: SampleLanguage, request: SampleRequest): string {
  return wellFormed(render(language, forLanguage(language, request)))
}

/**
 * The request as one language sends it: fetch cannot send a body with GET or HEAD, curl's HEAD
 * (-I) takes no body, and fetch and requests cannot send header values outside Latin-1 (and send
 * the rest of non-ASCII as Latin-1, not UTF-8). Each of these has its note.
 */
function forLanguage(language: SampleLanguage, request: SampleRequest): SampleRequest {
  let out = request
  const noBody = (language === 'fetch' && (request.method === 'GET' || request.method === 'HEAD')) || (language === 'curl' && request.method === 'HEAD')
  if (noBody && out.body) out = { ...out, body: undefined, headers: out.headers.filter(([name]) => name !== 'Content-Type') }
  const wide = out.wideHeaders
  if (wide && (language === 'fetch' || language === 'python')) out = { ...out, headers: out.headers.filter(([name]) => !wide.includes(name)) }
  return out
}

function render(language: SampleLanguage, request: SampleRequest): string {
  switch (language) {
    case 'curl':
      return renderCurl(request)
    case 'fetch':
      return renderFetch(request)
    case 'python':
      return renderPython(request)
    case 'httpie':
      return renderHttpie(request)
  }
}

// curl reads a file for `@name` in --data/-d and for `@name` or `<name` in -F values. Text bodies
// therefore go through --data-raw and form values through --form-string, which never read files;
// `-F` is left only for the file fields the sample means to upload. JSON text from -d always
// starts with `{`, `[`, `"`, a digit or a letter, never with `@`.
function renderCurl(request: SampleRequest): string {
  const lines: string[] = []
  const url = urlWithQuery(request)
  // curl reads {a,b} and [1-3] in a URL as patterns that make several requests; -g sends it as is.
  const curl = /[{}[\]]/.test(url) ? 'curl -g' : 'curl'
  // HEAD is -I: with -X HEAD curl would wait for a body. With a body, curl would send POST unless
  // the method is given, GET included.
  const first = request.method === 'HEAD' ? `${curl} -I` : request.method === 'GET' && !request.body ? curl : `${curl} -X ${shellQuote(request.method)}`
  // A URL that does not start with its scheme could be read as an option; --url never is.
  lines.push(`${first} ${/^[a-z][a-z0-9+.-]*:/i.test(url) ? '' : '--url '}${shellQuote(url)}`)
  if (request.basicAuth) lines.push(`-u ${shellQuote('<USERNAME>:<PASSWORD>')}`)
  // `Name;` sends an empty header; `Name: ` with nothing after it would remove the header.
  for (const [name, value] of request.headers) lines.push(`-H ${shellQuote(value === '' ? `${name};` : `${name}: ${value}`)}`)
  const body = request.body
  if (body?.json !== undefined) lines.push(`-d ${shellQuote(jsonText(body.json, { maxLength: MAX_BODY, indent: 2 }).text)}`)
  else if (body?.form && /multipart/i.test(body.mediaType)) {
    // Names with `=` never get here (curlFieldNames).
    for (const field of body.form) lines.push(field.file ? `-F ${shellQuote(`${field.name}=@${field.value}`)}` : `--form-string ${shellQuote(`${field.name}=${field.value}`)}`)
  } else if (body?.form) {
    // `name=value` is never read from a file: curl splits at the first `=` (only an argument
    // without one can be `name@file`) and encodes the rest. It sends the name as it is, so the
    // name is encoded here: `a&b` or `a=b` would otherwise arrive as other fields. An empty name
    // would be `=value`, which curl reads as a value with no name at all.
    for (const field of body.form) {
      lines.push(field.name === '' ? `--data-raw ${shellQuote(`=${encodeComponent(field.value)}`)}` : `--data-urlencode ${shellQuote(`${encodeQueryName(field.name)}=${field.value}`)}`)
    }
  } else if (body?.text !== undefined) lines.push(`--data-raw ${shellQuote(body.text)}`)
  return lines.join(' \\\n  ')
}

// Characters a single-quoted JS string cannot hold as they are: the quote, the backslash and the
// four line terminators (CR, LF, U+2028, U+2029).
const JS_ESCAPES: Record<string, string> = { '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r', '\u2028': '\\u2028', '\u2029': '\\u2029' }

function jsString(text: string): string {
  // Other control characters (NUL among them) as \xNN, so the source shows them.
  return `'${text.replace(/[\\'\u2028\u2029\x00-\x1f\x7f]/g, (c) => JS_ESCAPES[c] ?? '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'))}'`
}

function jsKey(key: string): string {
  // `__proto__: …` in an object literal sets the prototype instead of adding the key.
  if (key === '__proto__') return `[${jsString(key)}]`
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : jsString(key)
}

/** Whether a JSON value has a `__proto__` key, which a JS object literal would not keep. */
function hasProtoKey(value: unknown, budget = { left: 100_000 }): boolean {
  if (value === null || typeof value !== 'object' || budget.left-- <= 0) return false
  if (Array.isArray(value)) return value.some((item) => hasProtoKey(item, budget))
  return Object.keys(value).some((key) => key === '__proto__' || hasProtoKey((value as Record<string, unknown>)[key], budget))
}

function indentBlock(text: string, pad: string): string {
  return text.split('\n').map((line, i) => (i === 0 ? line : pad + line)).join('\n')
}

function renderFetch(request: SampleRequest): string {
  const out: string[] = []
  const options: string[] = []
  if (request.method !== 'GET') options.push(`  method: ${jsString(request.method)},`)
  const headers = [...request.headers]
  if (request.basicAuth) headers.push(['Authorization', "'Basic ' + btoa('<USERNAME>:<PASSWORD>')"])
  if (headers.length > 0) {
    options.push('  headers: {')
    for (const [name, value] of headers) {
      const literal = request.basicAuth && name === 'Authorization' && value.startsWith("'Basic") ? value : jsString(value)
      options.push(`    ${jsKey(name)}: ${literal},`)
    }
    options.push('  },')
  }
  const body = request.body
  if (body?.form && /multipart/i.test(body.mediaType)) {
    out.push('const form = new FormData()')
    for (const field of body.form) {
      out.push(field.file ? `form.append(${jsString(field.name)}, fileInput.files[0])` : `form.append(${jsString(field.name)}, ${jsString(field.value)})`)
    }
    out.push('')
    options.push('  body: form,')
  } else if (body?.form && new Set(body.form.map((f) => f.name)).size < body.form.length) {
    // An object literal keeps one value per name; repeated names need the list of pairs.
    options.push('  body: new URLSearchParams([')
    for (const field of body.form) options.push(`    [${jsString(field.name)}, ${jsString(field.value)}],`)
    options.push('  ]),')
  } else if (body?.form) {
    options.push('  body: new URLSearchParams({')
    for (const field of body.form) options.push(`    ${jsKey(field.name)}: ${jsString(field.value)},`)
    options.push('  }),')
  } else if (body?.json !== undefined && hasProtoKey(body.json)) {
    // As JSON text: a `"__proto__": …` entry in an object literal would set the prototype.
    options.push(`  body: ${jsString(jsonText(body.json, { maxLength: MAX_BODY }).text)},`)
  } else if (body?.json !== undefined) {
    options.push(`  body: JSON.stringify(${indentBlock(jsonText(body.json, { maxLength: MAX_BODY, indent: 2 }).text, '  ')}),`)
  } else if (body?.text !== undefined) {
    options.push(`  body: ${jsString(body.text)},`)
  }
  const url = jsString(urlWithQuery(request))
  out.push(options.length > 0 ? `const response = await fetch(${url}, {\n${options.join('\n')}\n})` : `const response = await fetch(${url})`)
  // The success response says what to read: JSON, text, or nothing (HEAD, 204).
  out.push(request.response === 'json' ? 'const data = await response.json()' : request.response === 'text' ? 'const text = await response.text()' : 'console.log(response.status)')
  return out.join('\n')
}

/** A Python string literal: JSON's escapes are Python's, and U+2028/U+2029 are escaped too. */
function pyString(text: string): string {
  return JSON.stringify(text).replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'))
}

/** A JSON value as a Python literal. */
export function toPython(value: unknown, indent = 0): string {
  const pad = '    '.repeat(indent)
  const inner = '    '.repeat(indent + 1)
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None'
  if (typeof value === 'string') return pyString(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((v) => inner + toPython(v, indent + 1)).join(',\n')},\n${pad}]`
  }
  if (isObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) return '{}'
    return `{\n${keys.map((k) => `${inner}${pyString(k)}: ${toPython(value[k], indent + 1)}`).join(',\n')},\n${pad}}`
  }
  return pyString(String(value))
}

/** A dict for requests' params= or data=: a repeated name gets a list, which requests sends as repeats. */
function pyDict(pairs: [string, string][]): string {
  const grouped = new Map<string, string[]>()
  for (const [name, value] of pairs) {
    const values = grouped.get(name)
    if (values) values.push(value)
    else grouped.set(name, [value])
  }
  const entries = [...grouped].map(([name, values]) => `${pyString(name)}: ${values.length === 1 ? pyString(values[0]) : `[${values.map(pyString).join(', ')}]`}`)
  return `{${entries.join(', ')}}`
}

function renderPython(request: SampleRequest): string {
  const args: string[] = [`    ${pyString(request.url)}`]
  if (request.query.length > 0) {
    args.push(`    params=${pyDict(request.query)}`)
  }
  // `json=` sets Content-Type: application/json itself. A JSON null goes as text: requests reads
  // `json=None` as no body at all.
  const nullJson = request.body?.json === null
  const headers = request.headers.filter(([name, value]) => !(request.body?.json !== undefined && !nullJson && name === 'Content-Type' && /^application\/json$/i.test(value)))
  if (headers.length > 0) args.push(`    headers={${headers.map(([k, v]) => `${pyString(k)}: ${pyString(v)}`).join(', ')}}`)
  if (request.basicAuth) args.push('    auth=("<USERNAME>", "<PASSWORD>")')
  const body = request.body
  if (nullJson) args.push('    data="null"')
  else if (body?.json !== undefined) args.push(`    json=${toPython(body.json, 1)}`)
  else if (body?.form && /multipart/i.test(body.mediaType)) {
    // Every part goes in files=, so requests sends multipart even with no file: text parts as
    // (None, value), with their Content-Type where they have one. Repeated names need a list.
    const part = (f: FormField) =>
      f.file ? `open(${pyString(f.value)}, "rb")` : f.contentType ? `(None, ${pyString(f.value)}, ${pyString(f.contentType)})` : `(None, ${pyString(f.value)})`
    const repeated = new Set(body.form.map((f) => f.name)).size < body.form.length
    args.push(
      repeated
        ? `    files=[\n${body.form.map((f) => `        (${pyString(f.name)}, ${part(f)}),`).join('\n')}\n    ]`
        : `    files={${body.form.map((f) => `${pyString(f.name)}: ${part(f)}`).join(', ')}}`
    )
  } else if (body?.form) {
    args.push(`    data=${pyDict(body.form.map((f) => [f.name, f.value]))}`)
  } else if (body?.text !== undefined) args.push(`    data=${pyString(body.text)}`)
  const method = request.method.toLowerCase()
  const call = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)
    ? `requests.${method}(\n${args.join(',\n')},\n)`
    : `requests.request(\n    ${pyString(request.method)},\n${args.join(',\n')},\n)`
  const last = request.response === 'json' ? 'print(response.json())' : request.response === 'text' ? 'print(response.text)' : 'print(response.status_code)'
  return `import requests\n\nresponse = ${call}\n${last}`
}

// HTTPie request items: `Header:value`, `Header;` (empty), `name==query`, `field=text`,
// `field:=json`, `field@file`, and with `@` after the separator (`field=@file`, `Header:@file`) the
// value is read from a file. A backslash before `:`, `;`, `=` or `@` makes it literal, so keys are
// escaped wholly and a value that starts with one of them gets a backslash. A value that already has
// a backslash before one of them cannot be written exactly: queries then go in the URL and JSON
// bodies through --raw. An item that starts with `-` would read as an option.
const HTTPIE_SPECIAL = /[:;=@]/g

function httpieKey(key: string): string | null {
  if (key === '' || key.startsWith('-') || /\\([:;=@]|$)/.test(key)) return null
  return key.replace(HTTPIE_SPECIAL, (c) => '\\' + c)
}

function httpieValue(value: string): string | null {
  if (/\\[:;=@]/.test(value) || UNSAFE_DATA.test(value)) return null
  return httpieLooseValue(value)
}

/** Safe but not exact: a backslash the value has before a separator character is lost. */
function httpieLooseValue(value: string): string {
  return /^[:;=@]/.test(value) ? '\\' + value : value
}

/** JSON body keys HTTPie takes as they are: it reads `[` and `]` in keys as nested JSON paths. */
const HTTPIE_PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/

function renderHttpie(request: SampleRequest): string {
  const parts: string[] = []
  let body = request.body
  // A urlencoded field HTTPie cannot write exactly sends the whole form as text through --raw.
  if (body?.form && !/multipart/i.test(body.mediaType) && body.form.some((f) => httpieKey(f.name) === null || httpieValue(f.value) === null)) {
    body = { mediaType: body.mediaType, text: body.form.map((f) => `${encodeQueryName(f.name)}=${encodeComponent(f.value)}`).join('&') }
    request = { ...request, body }
  }
  const form = body?.form
  const head = ['http']
  if (form) head.push(/multipart/i.test(body!.mediaType) ? '--multipart' : '--form')
  if (request.basicAuth) head.push(`-a ${shellQuote('<USERNAME>:<PASSWORD>')}`)
  // A pair HTTPie cannot write as `name==value` puts the whole query in the URL, in its order.
  const queryItems = request.query.map(([k, v]) => {
    const key = httpieKey(k)
    const value = httpieValue(v)
    return key === null || value === null ? null : shellQuote(`${key}==${value}`)
  })
  const items = queryItems.every((item) => item !== null) ? (queryItems as string[]) : []
  head.push(shellQuote(request.method), shellQuote(urlWithQuery({ ...request, query: items.length > 0 ? [] : request.query })))
  parts.push(head.join(' '), ...items)
  for (const [name, value] of request.headers) {
    // HTTPie sets these itself: application/json for JSON, and the form types.
    if (name === 'Content-Type' && (form || (body?.json !== undefined && /^application\/json$/i.test(value)))) continue
    // Names with a leading `-` and values with `\:` and the like never get here (httpieMisses).
    parts.push(shellQuote(value === '' ? `${name};` : `${name}:${httpieLooseValue(value)}`))
  }
  if (form) {
    for (const field of form) {
      const key = httpieKey(field.name)!
      parts.push(shellQuote(field.file ? `${key}@${field.value}` : `${key}=${httpieValue(field.value)}`))
    }
  } else if (body?.json !== undefined) {
    const json = body.json
    const flat: string[] = []
    let simple = isObject(json) && Object.keys(json).length > 0
    if (simple) {
      for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
        if (!HTTPIE_PLAIN_KEY.test(k) || (v !== null && typeof v === 'object')) {
          simple = false
          break
        }
        if (typeof v === 'string') {
          const value = httpieValue(v)
          if (value === null) {
            simple = false
            break
          }
          flat.push(shellQuote(`${k}=${value}`))
        } else flat.push(shellQuote(`${k}:=${jsonText(v, { maxLength: 100 }).text}`))
      }
    }
    if (simple) parts.push(...flat)
    else parts.push(`--raw=${shellQuote(jsonText(json, { maxLength: MAX_BODY }).text)}`)
  } else if (body?.text !== undefined) {
    // --raw=… so a body that starts with `-` is not read as an option; --raw never reads files.
    parts.push(`--raw=${shellQuote(body.text)}`)
  }
  return parts.join(' \\\n  ')
}
