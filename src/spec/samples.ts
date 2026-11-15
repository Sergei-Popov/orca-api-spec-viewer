// Request samples for an operation, built offline from the document: curl, JavaScript fetch,
// Python requests and HTTPie. Values come from the document's examples, else from the schema.

import { exampleFromSchema } from './example'
import { jsonText } from './json-text'
import type { OpenApiModel, Operation } from './openapi'
import { operationSecurity, operationServers, requirementScheme } from './openapi'
import { styledHeader, styledPairs, styledPath, type ParamStyle } from './param-style'
import type { MediaView, OperationDetails, ParamView } from './operation'
import { isObject, own, str } from './pointer'
import type { Refs } from './refs'
import { isHttpToken } from './token'

export type SampleLanguage = 'curl' | 'fetch' | 'python' | 'httpie'
export { isHttpToken }
export const SAMPLE_LANGUAGES: SampleLanguage[] = ['curl', 'fetch', 'python', 'httpie']

export interface FormField {
  name: string
  value: string
  file?: boolean
}

export interface SampleRequest {
  method: string
  /** Whether the method is an HTTP token (RFC 9110); samples are only offered when it is. */
  methodValid: boolean
  url: string
  /** Set when the document has no absolute server URL and the host is a stand-in. */
  placeholderHost: boolean
  query: [string, string][]
  headers: [string, string][]
  /** `basic` auth as curl's `-u` and requests' `auth=`. */
  basicAuth: boolean
  /** A value had an unpaired UTF-16 surrogate, which the samples show as U+FFFD. */
  replaced?: boolean
  /** `<name>` placeholders in the URL for templates the document leaves unfilled. */
  placeholders?: string[]
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

export function buildRequest(model: OpenApiModel, refs: Refs, op: Operation, details: OperationDetails): SampleRequest {
  const servers = operationServers(model, op).servers
  let base = servers[0]?.resolved ?? ''
  let placeholderHost = false
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    placeholderHost = true
    base = PLACEHOLDER_HOST + (base.startsWith('/') ? base : base ? '/' + base : '')
  }
  base = base.replace(/\/+$/, '')

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
    basicAuth: false
  }
  const cookies: string[] = []
  let path = op.route
  let queryString: string | undefined
  for (const param of details.params) {
    if (param.stop) continue
    if (param.in === 'querystring') {
      // OpenAPI 3.2: one parameter that is the whole query string, written as its media type says.
      const written = querystringOf(refs, param)
      if (Array.isArray(written)) request.query.push(...written)
      else if (written !== undefined) queryString = written
      continue
    }
    // Arrays and objects are written as the parameter's style (or collectionFormat) says.
    const value = paramValue(refs, param)
    const style = styleOf(param)
    if (param.in === 'path') {
      if (value !== undefined) path = path.split(`{${param.name}}`).join(styledPath(style, value, encodeComponent))
      if (value !== undefined && illFormed(value)) request.replaced = true
    } else if (!param.required && value === undefined) {
      continue
    } else if (!param.required && !param.hasExample && param.examples.length === 0) {
      continue
    } else if (param.in === 'query') {
      request.query.push(...(value === undefined ? [[param.name, ''] as [string, string]] : styledPairs(style, value)))
    } else if (param.in === 'header') {
      // A name that is not a token cannot be sent; curl would read `@name…` as a file.
      if (isHttpToken(param.name) && !/^(accept|content-type|authorization)$/i.test(param.name)) request.headers.push([param.name, value === undefined ? '' : styledHeader(style, value)])
    } else if (param.in === 'cookie') {
      for (const [name, text] of value === undefined ? [[param.name, '']] : styledPairs(style, value)) cookies.push(`${name}=${text}`)
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
        if (where === 'query') request.query.push([keyName, '<API_KEY>'])
        else if (where === 'cookie') cookies.push(`${keyName}=<API_KEY>`)
        else if (isHttpToken(keyName)) request.headers.push([keyName, '<API_KEY>'])
      } else if (type === 'basic' || (type === 'http' && scheme === 'basic')) {
        request.basicAuth = true
      } else if (type === 'http') {
        request.headers.push(['Authorization', `${scheme === 'bearer' || !scheme ? 'Bearer' : capitalize(scheme)} <TOKEN>`])
      } else if (type === 'oauth2' || type === 'openIdConnect') {
        request.headers.push(['Authorization', 'Bearer <ACCESS_TOKEN>'])
      }
    }
  }
  if (cookies.length > 0) request.headers.push(['Cookie', cookies.join('; ')])

  if (details.body) {
    const media = pickMedia(details.body.media)
    if (media) {
      request.headers.push(['Content-Type', media.type])
      const example = mediaExample(refs, media)
      if (details.body.formFields.length > 0) {
        request.body = {
          mediaType: media.type,
          form: details.body.formFields.flatMap((field): FormField[] => {
            if (own(field.raw, 'type') === 'file') return [{ name: field.name, value: 'file.bin', file: true }]
            const value = paramValue(refs, field)
            const pairs = value === undefined ? [[field.name, ''] as [string, string]] : styledPairs(styleOf(field), value)
            return pairs.map(([name, text]) => ({ name, value: text, file: false }))
          })
        }
      } else if (/[/+]json\b|^application\/json/i.test(media.type)) {
        request.body = { mediaType: media.type, json: example === undefined ? {} : example }
      } else if (/x-www-form-urlencoded|multipart\/form-data/i.test(media.type)) {
        request.body = { mediaType: media.type, form: formFields(refs, media, example) }
      } else {
        request.body = { mediaType: media.type, text: typeof example === 'string' ? example : example === undefined ? '' : jsonText(example, { maxLength: MAX_BODY, indent: 2 }).text }
      }
    }
  }
  if (request.body?.form && /multipart/i.test(request.body.mediaType)) {
    // curl, requests and HTTPie set the multipart boundary themselves.
    request.headers = request.headers.filter(([name]) => name !== 'Content-Type')
  }
  // A template the document leaves unfilled (an undeclared path parameter, one with no example,
  // a server variable with no default) becomes a <name> placeholder to fill in before running.
  const placeholders: string[] = []
  request.url = (base + path).replace(/\{([^{}]*)\}/g, (_, name: string) => {
    const placeholder = `<${name}>`
    if (!placeholders.includes(placeholder)) placeholders.push(placeholder)
    return placeholder
  })
  if (placeholders.length > 0) request.placeholders = placeholders
  if (queryString) request.url += (request.url.includes('?') ? '&' : '?') + queryString
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
  return request
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

/**
 * Text with each unpaired UTF-16 surrogate (half of a character, such as from a `\uD83D` escape)
 * replaced by U+FFFD. Such text cannot be encoded as UTF-8: encodeURIComponent throws on it, and a
 * copied sample would lose it anyway.
 */
export function wellFormed(text: string): string {
  let out = ''
  let from = 0
  for (let i = loneSurrogate(text, 0); i >= 0; i = loneSurrogate(text, from)) {
    out += text.slice(from, i) + REPLACEMENT
    from = i + 1
  }
  return from === 0 ? text : out + text.slice(from)
}

const REPLACEMENT = String.fromCharCode(0xfffd)

/** The index of the first unpaired surrogate at or after `from`, or -1. */
function loneSurrogate(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0xd800 || c > 0xdfff) continue
    if (c <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++
        continue
      }
    }
    return i
  }
  return -1
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
function querystringOf(refs: Refs, param: ParamView): [string, string][] | string | undefined {
  const media = param.content[0]
  const serialized = [...param.examples, ...(media?.examples ?? [])].find((e) => e.serializedValue !== undefined)?.serializedValue
  if (serialized !== undefined) return serialized.replace(/^\?/, '')
  const value = paramValue(refs, param) ?? (media ? mediaExample(refs, media) : undefined)
  if (value === undefined || value === null) return undefined
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

/** The parameter's example value as the document gives it (or one made from its schema). */
function paramValue(refs: Refs, param: ParamView): unknown {
  let value: unknown
  if (param.hasExample) value = param.example
  else if (param.examples.find((e) => e.hasValue)) value = param.examples.find((e) => e.hasValue)!.value
  else if (param.schema && !param.schema.stop) {
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
  return jsonText(value, { maxLength: 4000 }).text
}

function formFields(refs: Refs, media: MediaView, example: unknown): FormField[] {
  const fields: FormField[] = []
  const schema = media.schema && !media.schema.stop ? refs.follow(media.schema.value, media.schema.loc).value : undefined
  const props = isObject(schema) && isObject(schema.properties) ? schema.properties : {}
  const values = isObject(example) ? example : {}
  const names = new Set([...Object.keys(values), ...Object.keys(props)])
  for (const name of names) {
    const prop = refs.follow(props[name], { doc: '', path: [] }).value
    const binary = isObject(prop) && (prop.format === 'binary' || prop.contentMediaType !== undefined)
    if (binary) {
      fields.push({ name, value: 'file.bin', file: true })
      continue
    }
    const value = values[name]
    if (value === undefined) continue
    fields.push({ name, value: typeof value === 'object' && value !== null ? compact(value) : String(value) })
  }
  return fields
}

function urlWithQuery(request: SampleRequest): string {
  if (request.query.length === 0) return request.url
  // Brackets in names (deepObject's `filter[status]`) and commas between items stay readable.
  const query = request.query.map(([k, v]) => `${encodeComponent(k).replace(/%5B/g, '[').replace(/%5D/g, ']')}=${encodeQueryValue(v).replace(/%2C/g, ',')}`).join('&')
  return `${request.url}${request.url.includes('?') ? '&' : '?'}${query}`
}

/** Keeps `<API_KEY>`-style placeholders readable in URLs. */
function encodeQueryValue(value: string): string {
  return /^<[A-Z_]+>$/.test(value) ? value : encodeComponent(value)
}

/** POSIX shell single quoting, only when needed. */
export function shellQuote(text: string): string {
  if (text !== '' && /^[A-Za-z0-9_./:=@%+,-]+$/.test(text)) return text
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
 * The languages a request can be written in: shell commands only when shellSafe, and HTTPie only
 * for methods made of letters and URLs it cannot read as an option.
 */
export function sampleLanguages(request: SampleRequest): SampleLanguage[] {
  if (!request.methodValid) return []
  const shell = shellSafe(request)
  return SAMPLE_LANGUAGES.filter((language) => {
    if (language === 'curl') return shell
    if (language === 'httpie') return shell && /^[A-Za-z]+$/.test(request.method) && !request.url.startsWith('-')
    return true
  })
}

export function renderSample(language: SampleLanguage, request: SampleRequest): string {
  return wellFormed(render(language, request))
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
  const first = request.method === 'GET' ? curl : `${curl} -X ${shellQuote(request.method)}`
  // A URL that does not start with its scheme could be read as an option; --url never is.
  lines.push(`${first} ${/^[a-z][a-z0-9+.-]*:/i.test(url) ? '' : '--url '}${shellQuote(url)}`)
  if (request.basicAuth) lines.push(`-u ${shellQuote('<USERNAME>:<PASSWORD>')}`)
  // `Name;` sends an empty header; `Name: ` with nothing after it would remove the header.
  for (const [name, value] of request.headers) lines.push(`-H ${shellQuote(value === '' ? `${name};` : `${name}: ${value}`)}`)
  const body = request.body
  if (body?.json !== undefined) lines.push(`-d ${shellQuote(jsonText(body.json, { maxLength: MAX_BODY, indent: 2 }).text)}`)
  else if (body?.form && /multipart/i.test(body.mediaType)) {
    for (const field of body.form) {
      if (!field.file) lines.push(`--form-string ${shellQuote(`${field.name}=${field.value}`)}`)
      // curl splits -F at the first `=`: a name with one cannot be written.
      else if (!field.name.includes('=')) lines.push(`-F ${shellQuote(`${field.name}=@${field.value}`)}`)
    }
  } else if (body?.form) {
    // `name=value` is never read from a file: curl splits at the first `=` (only an argument
    // without one can be `name@file`) and encodes the rest. It sends the name as it is, so the
    // name is encoded here: `a&b` or `a=b` would otherwise arrive as other fields.
    for (const field of body.form) lines.push(`--data-urlencode ${shellQuote(`${encodeComponent(field.name)}=${field.value}`)}`)
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
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : jsString(key)
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
  } else if (body?.json !== undefined) {
    options.push(`  body: JSON.stringify(${indentBlock(jsonText(body.json, { maxLength: MAX_BODY, indent: 2 }).text, '  ')}),`)
  } else if (body?.text !== undefined) {
    options.push(`  body: ${jsString(body.text)},`)
  }
  const url = jsString(urlWithQuery(request))
  out.push(options.length > 0 ? `const response = await fetch(${url}, {\n${options.join('\n')}\n})` : `const response = await fetch(${url})`)
  out.push('const data = await response.json()')
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
  // `json=` sets Content-Type: application/json itself.
  const headers = request.headers.filter(([name, value]) => !(request.body?.json !== undefined && name === 'Content-Type' && /^application\/json$/i.test(value)))
  if (headers.length > 0) args.push(`    headers={${headers.map(([k, v]) => `${pyString(k)}: ${pyString(v)}`).join(', ')}}`)
  if (request.basicAuth) args.push('    auth=("<USERNAME>", "<PASSWORD>")')
  const body = request.body
  if (body?.json !== undefined) args.push(`    json=${toPython(body.json, 1)}`)
  else if (body?.form) {
    const files = body.form.filter((f) => f.file)
    const data = body.form.filter((f) => !f.file)
    if (data.length > 0) args.push(`    data=${pyDict(data.map((f) => [f.name, f.value]))}`)
    if (files.length > 0) args.push(`    files={${files.map((f) => `${pyString(f.name)}: open(${pyString(f.value)}, "rb")`).join(', ')}}`)
  } else if (body?.text !== undefined) args.push(`    data=${pyString(body.text)}`)
  const method = request.method.toLowerCase()
  const call = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)
    ? `requests.${method}(\n${args.join(',\n')},\n)`
    : `requests.request(\n    ${pyString(request.method)},\n${args.join(',\n')},\n)`
  return `import requests\n\nresponse = ${call}\nprint(response.json())`
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
  const body = request.body
  const form = body?.form
  const head = ['http']
  if (form) head.push(/multipart/i.test(body!.mediaType) ? '--multipart' : '--form')
  if (request.basicAuth) head.push(`-a ${shellQuote('<USERNAME>:<PASSWORD>')}`)
  const items: string[] = []
  const inUrl: [string, string][] = []
  for (const [k, v] of request.query) {
    const key = httpieKey(k)
    const value = httpieValue(v)
    if (key === null || value === null) inUrl.push([k, v])
    else items.push(shellQuote(`${key}==${value}`))
  }
  head.push(shellQuote(request.method), shellQuote(urlWithQuery({ ...request, query: inUrl })))
  parts.push(head.join(' '), ...items)
  for (const [name, value] of request.headers) {
    // HTTPie sets these itself: application/json for JSON, and the form types.
    if (name === 'Content-Type' && (form || (body?.json !== undefined && /^application\/json$/i.test(value)))) continue
    if (name.startsWith('-')) continue
    parts.push(shellQuote(value === '' ? `${name};` : `${name}:${httpieLooseValue(value)}`))
  }
  if (form) {
    for (const field of form) {
      const key = httpieKey(field.name)
      if (key === null) continue
      parts.push(shellQuote(field.file ? `${key}@${field.value}` : `${key}=${httpieLooseValue(field.value)}`))
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
