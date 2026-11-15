// Request samples for an operation, built offline from the document: curl, JavaScript fetch,
// Python requests and HTTPie. Values come from the document's examples, else from the schema.

import { exampleFromSchema } from './example'
import type { OpenApiModel, Operation } from './openapi'
import { operationSecurity, operationServers, securitySchemes } from './openapi'
import type { MediaView, OperationDetails, ParamView } from './operation'
import { isObject, own, str } from './pointer'
import type { Refs } from './refs'

export type SampleLanguage = 'curl' | 'fetch' | 'python' | 'httpie'
export const SAMPLE_LANGUAGES: SampleLanguage[] = ['curl', 'fetch', 'python', 'httpie']

export interface FormField {
  name: string
  value: string
  file?: boolean
}

export interface SampleRequest {
  method: string
  url: string
  /** Set when the document has no absolute server URL and the host is a stand-in. */
  placeholderHost: boolean
  query: [string, string][]
  headers: [string, string][]
  /** `basic` auth as curl's `-u` and requests' `auth=`. */
  basicAuth: boolean
  body?: {
    mediaType: string
    json?: unknown
    text?: string
    form?: FormField[]
  }
}

const PLACEHOLDER_HOST = 'https://api.example.com'

export function buildRequest(model: OpenApiModel, refs: Refs, op: Operation, details: OperationDetails): SampleRequest {
  const servers = operationServers(model, op).servers
  let base = servers[0]?.resolved ?? ''
  let placeholderHost = false
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    placeholderHost = true
    base = PLACEHOLDER_HOST + (base.startsWith('/') ? base : base ? '/' + base : '')
  }
  base = base.replace(/\/+$/, '')

  const request: SampleRequest = {
    method: op.method.toUpperCase(),
    url: '',
    placeholderHost,
    query: [],
    headers: [],
    basicAuth: false
  }
  const cookies: string[] = []
  let path = op.route
  for (const param of details.params) {
    if (param.stop) continue
    const value = paramExample(refs, param)
    if (param.in === 'path') {
      if (value !== undefined) path = path.split(`{${param.name}}`).join(encodeURIComponent(value))
    } else if (!param.required && value === undefined) {
      continue
    } else if (!param.required && !param.hasExample && param.examples.length === 0) {
      continue
    } else if (param.in === 'query') {
      request.query.push([param.name, value ?? ''])
    } else if (param.in === 'header') {
      if (!/^(accept|content-type|authorization)$/i.test(param.name)) request.headers.push([param.name, value ?? ''])
    } else if (param.in === 'cookie') {
      cookies.push(`${param.name}=${value ?? ''}`)
    }
  }

  const security = operationSecurity(model, op)
  const schemes = securitySchemes(model)
  const requirement = security?.requirements[0]
  if (requirement) {
    for (const name of Object.keys(requirement)) {
      const followed = refs.follow(own(schemes, name), { doc: '', path: [] }).value
      if (!isObject(followed)) continue
      const type = str(own(followed, 'type'))
      const scheme = str(own(followed, 'scheme'))?.toLowerCase()
      if (type === 'apiKey') {
        const keyName = str(own(followed, 'name')) ?? 'api_key'
        const where = str(own(followed, 'in'))
        if (where === 'query') request.query.push([keyName, '<API_KEY>'])
        else if (where === 'cookie') cookies.push(`${keyName}=<API_KEY>`)
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
  if (cookies.length > 0) request.headers.push(['Cookie', cookies.join('; ')])

  if (details.body) {
    const media = pickMedia(details.body.media)
    if (media) {
      request.headers.push(['Content-Type', media.type])
      const example = mediaExample(refs, media)
      if (details.body.formFields.length > 0) {
        request.body = {
          mediaType: media.type,
          form: details.body.formFields.map((field) => ({
            name: field.name,
            value: own(field.raw, 'type') === 'file' ? 'file.bin' : paramExample(refs, field) ?? '',
            file: own(field.raw, 'type') === 'file'
          }))
        }
      } else if (/[/+]json\b|^application\/json/i.test(media.type)) {
        request.body = { mediaType: media.type, json: example === undefined ? {} : example }
      } else if (/x-www-form-urlencoded|multipart\/form-data/i.test(media.type)) {
        request.body = { mediaType: media.type, form: formFields(refs, media, example) }
      } else {
        request.body = { mediaType: media.type, text: typeof example === 'string' ? example : example === undefined ? '' : JSON.stringify(example, null, 2) }
      }
    }
  }
  if (request.body?.form && /multipart/i.test(request.body.mediaType)) {
    // curl, requests and HTTPie set the multipart boundary themselves.
    request.headers = request.headers.filter(([name]) => name !== 'Content-Type')
  }
  request.url = base + path
  return request
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
  const given = media.examples.find((e) => e.hasValue)
  if (given) return given.value
  if (media.schema && !media.schema.stop) return exampleFromSchema(refs, media.schema.value, media.schema.loc, { mode: 'request' })
  return undefined
}

function paramExample(refs: Refs, param: ParamView): string | undefined {
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
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(',')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
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
    fields.push({ name, value: typeof value === 'object' ? JSON.stringify(value) : String(value) })
  }
  return fields
}

function urlWithQuery(request: SampleRequest): string {
  if (request.query.length === 0) return request.url
  const query = request.query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeQueryValue(v)}`).join('&')
  return `${request.url}${request.url.includes('?') ? '&' : '?'}${query}`
}

/** Keeps `<API_KEY>`-style placeholders readable in URLs. */
function encodeQueryValue(value: string): string {
  return /^<[A-Z_]+>$/.test(value) ? value : encodeURIComponent(value)
}

/** POSIX shell single quoting, only when needed. */
export function shellQuote(text: string): string {
  if (text !== '' && /^[A-Za-z0-9_./:=@%+,-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

export function renderSample(language: SampleLanguage, request: SampleRequest): string {
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

function renderCurl(request: SampleRequest): string {
  const lines: string[] = []
  const first = request.method === 'GET' ? 'curl' : `curl -X ${request.method}`
  lines.push(`${first} ${shellQuote(urlWithQuery(request))}`)
  if (request.basicAuth) lines.push(`-u ${shellQuote('<USERNAME>:<PASSWORD>')}`)
  for (const [name, value] of request.headers) lines.push(`-H ${shellQuote(`${name}: ${value}`)}`)
  const body = request.body
  if (body?.json !== undefined) lines.push(`-d ${shellQuote(JSON.stringify(body.json, null, 2))}`)
  else if (body?.form && /multipart/i.test(body.mediaType)) {
    for (const field of body.form) lines.push(`-F ${shellQuote(field.file ? `${field.name}=@${field.value}` : `${field.name}=${field.value}`)}`)
  } else if (body?.form) {
    for (const field of body.form) lines.push(`--data-urlencode ${shellQuote(`${field.name}=${field.value}`)}`)
  } else if (body?.text !== undefined) lines.push(`--data-binary ${shellQuote(body.text)}`)
  return lines.join(' \\\n  ')
}

function jsString(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
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
  } else if (body?.form) {
    options.push('  body: new URLSearchParams({')
    for (const field of body.form) options.push(`    ${jsKey(field.name)}: ${jsString(field.value)},`)
    options.push('  }),')
  } else if (body?.json !== undefined) {
    options.push(`  body: JSON.stringify(${indentBlock(JSON.stringify(body.json, null, 2), '  ')}),`)
  } else if (body?.text !== undefined) {
    options.push(`  body: ${jsString(body.text)},`)
  }
  const url = jsString(urlWithQuery(request))
  out.push(options.length > 0 ? `const response = await fetch(${url}, {\n${options.join('\n')}\n})` : `const response = await fetch(${url})`)
  out.push('const data = await response.json()')
  return out.join('\n')
}

function pyString(text: string): string {
  return JSON.stringify(text)
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

function renderPython(request: SampleRequest): string {
  const args: string[] = [`    ${pyString(request.url)}`]
  if (request.query.length > 0) {
    args.push(`    params={${request.query.map(([k, v]) => `${pyString(k)}: ${pyString(v)}`).join(', ')}}`)
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
    if (data.length > 0) args.push(`    data={${data.map((f) => `${pyString(f.name)}: ${pyString(f.value)}`).join(', ')}}`)
    if (files.length > 0) args.push(`    files={${files.map((f) => `${pyString(f.name)}: open(${pyString(f.value)}, "rb")`).join(', ')}}`)
  } else if (body?.text !== undefined) args.push(`    data=${pyString(body.text)}`)
  const method = request.method.toLowerCase()
  const call = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)
    ? `requests.${method}(\n${args.join(',\n')},\n)`
    : `requests.request(\n    ${pyString(request.method)},\n${args.join(',\n')},\n)`
  return `import requests\n\nresponse = ${call}\nprint(response.json())`
}

function renderHttpie(request: SampleRequest): string {
  const parts: string[] = []
  const body = request.body
  const form = body?.form
  const head = ['http']
  if (form) head.push(/multipart/i.test(body!.mediaType) ? '--multipart' : '--form')
  if (request.basicAuth) head.push(`-a ${shellQuote('<USERNAME>:<PASSWORD>')}`)
  head.push(request.method, shellQuote(request.url))
  parts.push(head.join(' '))
  for (const [k, v] of request.query) parts.push(shellQuote(`${k}==${v}`))
  for (const [name, value] of request.headers) {
    if (name === 'Content-Type' && (body?.json !== undefined || form)) continue
    parts.push(shellQuote(`${name}:${value}`))
  }
  if (form) {
    for (const field of form) parts.push(shellQuote(field.file ? `${field.name}@${field.value}` : `${field.name}=${field.value}`))
  } else if (body?.json !== undefined) {
    const json = body.json
    if (isObject(json) && Object.values(json).every((v) => v === null || typeof v !== 'object')) {
      for (const [k, v] of Object.entries(json)) parts.push(shellQuote(typeof v === 'string' ? `${k}=${v}` : `${k}:=${JSON.stringify(v)}`))
    } else {
      parts.push(`--raw ${shellQuote(JSON.stringify(json))}`)
    }
  } else if (body?.text !== undefined) {
    parts.push(`Content-Type:${shellQuote(body.mediaType)}`)
    parts.push(`--raw ${shellQuote(body.text)}`)
  }
  return parts.join(' \\\n  ')
}
