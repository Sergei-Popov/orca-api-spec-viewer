// The object tables of Swagger 2.0 and OpenAPI 3.0, 3.1 and 3.2. A field's number is the level it
// first exists at (30 = 3.0, 31 = 3.1, 32 = 3.2); a later field in an earlier document is
// reported as not part of that version.

import { isObject, own } from '../spec/pointer'
import { isHttpToken } from '../spec/token'
import type { FieldType, ObjectDef, WalkContext } from './walker'

const ref = (obj: string): FieldType => ({ obj, ref: true })
const obj = (name: string): FieldType => ({ obj: name })
const map = (type: FieldType, keys?: 'component'): FieldType => ({ map: type, keys })
const list = (type: FieldType, min?: number): FieldType => ({ list: type, min })
const oneOf = (...values: string[]): FieldType => ({ oneOf: values })

const STATUS = /^([1-5](\d\d|XX))$/

function exclusive(value: Record<string, unknown>, path: string[], ctx: WalkContext, a: string, b: string): void {
  if (Object.prototype.hasOwnProperty.call(value, a) && Object.prototype.hasOwnProperty.call(value, b)) {
    ctx.problems.error('mutually-exclusive', path, { a, b })
  }
}

const PARAM_STYLES: Record<string, string[]> = {
  path: ['matrix', 'label', 'simple'],
  query: ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject'],
  header: ['simple'],
  cookie: ['form', 'cookie'],
  querystring: []
}

function checkParameter(value: Record<string, unknown>, path: string[], ctx: WalkContext): void {
  const where = own(value, 'in')
  const allowed = ctx.level >= 32 ? ['query', 'querystring', 'header', 'path', 'cookie'] : ['query', 'header', 'path', 'cookie']
  if (typeof where === 'string' && !allowed.includes(where)) ctx.problems.error('bad-value', [...path, 'in'], { value: where, allowed: allowed.join(', ') })
  if (where === 'path' && own(value, 'required') !== true) ctx.problems.error('path-param-not-required', path, { name: String(own(value, 'name') ?? '') })
  const hasSchema = Object.prototype.hasOwnProperty.call(value, 'schema')
  const hasContent = Object.prototype.hasOwnProperty.call(value, 'content')
  if (hasSchema && hasContent) ctx.problems.error('mutually-exclusive', path, { a: 'schema', b: 'content' })
  else if (!hasSchema && !hasContent) ctx.problems.error('one-of-fields', path, { fields: 'schema, content' })
  if (where === 'querystring' && hasSchema) ctx.problems.error('bad-value', [...path, 'schema'], { value: 'schema', allowed: 'content' })
  const content = own(value, 'content')
  if (isObject(content) && Object.keys(content).length !== 1) ctx.problems.error('bad-value', [...path, 'content'], { value: `${Object.keys(content).length}`, allowed: '1' })
  exclusive(value, path, ctx, 'example', 'examples')
  const style = own(value, 'style')
  if (typeof style === 'string' && typeof where === 'string' && PARAM_STYLES[where] && !PARAM_STYLES[where].includes(style)) {
    ctx.problems.error('bad-value', [...path, 'style'], { value: style, allowed: PARAM_STYLES[where].join(', ') })
  }
}

function checkHeader(value: Record<string, unknown>, path: string[], ctx: WalkContext): void {
  for (const field of ['name', 'in']) {
    if (Object.prototype.hasOwnProperty.call(value, field)) ctx.problems.warn('unknown-field', [...path, field], { field, object: 'Header' })
  }
  const hasSchema = Object.prototype.hasOwnProperty.call(value, 'schema')
  const hasContent = Object.prototype.hasOwnProperty.call(value, 'content')
  if (hasSchema && hasContent) ctx.problems.error('mutually-exclusive', path, { a: 'schema', b: 'content' })
  else if (!hasSchema && !hasContent) ctx.problems.error('one-of-fields', path, { fields: 'schema, content' })
  exclusive(value, path, ctx, 'example', 'examples')
}

function checkSecurityScheme(value: Record<string, unknown>, path: string[], ctx: WalkContext): void {
  const type = own(value, 'type')
  const types = ctx.level >= 31 ? ['apiKey', 'http', 'mutualTLS', 'oauth2', 'openIdConnect'] : ['apiKey', 'http', 'oauth2', 'openIdConnect']
  if (typeof type !== 'string') return
  if (!types.includes(type)) {
    ctx.problems.error('bad-value', [...path, 'type'], { value: type, allowed: types.join(', ') })
    return
  }
  const need = (field: string) => {
    if (!Object.prototype.hasOwnProperty.call(value, field)) ctx.problems.error('required-field', path, { field, object: `Security Scheme (${type})` })
  }
  if (type === 'apiKey') {
    need('name')
    need('in')
    const where = own(value, 'in')
    if (typeof where === 'string' && !['query', 'header', 'cookie'].includes(where)) ctx.problems.error('bad-value', [...path, 'in'], { value: where, allowed: 'query, header, cookie' })
  } else if (type === 'http') need('scheme')
  else if (type === 'oauth2') need('flows')
  else if (type === 'openIdConnect') need('openIdConnectUrl')
}

function checkFlow(required: string[]) {
  return (value: Record<string, unknown>, path: string[], ctx: WalkContext) => {
    for (const field of required) {
      if (!Object.prototype.hasOwnProperty.call(value, field)) ctx.problems.error('required-field', path, { field, object: 'OAuth Flow' })
    }
  }
}

function checkServerVariable(value: Record<string, unknown>, path: string[], ctx: WalkContext): void {
  const values = own(value, 'enum')
  const fallback = own(value, 'default')
  if (Array.isArray(values)) {
    if (values.length === 0 && ctx.level >= 31) ctx.problems.error('empty-list', [...path, 'enum'], { min: 1 })
    if (typeof fallback === 'string' && values.length > 0 && !values.includes(fallback)) {
      ctx.problems.error('enum-default', [...path, 'default'], { value: fallback })
    }
  }
}

function checkInfo(value: Record<string, unknown>, path: string[], ctx: WalkContext): void {
  const license = own(value, 'license')
  if (isObject(license)) exclusive(license, [...path, 'license'], ctx, 'identifier', 'url')
}

function checkRoot3(value: Record<string, unknown>, path: string[], ctx: WalkContext): void {
  if (ctx.level >= 31 && !['paths', 'components', 'webhooks'].some((f) => Object.prototype.hasOwnProperty.call(value, f))) {
    ctx.problems.error('one-of-fields', path, { fields: 'paths, components, webhooks' })
  }
}

const parameterFields = {
  name: 'string',
  in: 'string',
  description: 'string',
  required: 'boolean',
  deprecated: 'boolean',
  allowEmptyValue: 'boolean',
  style: 'string',
  explode: 'boolean',
  allowReserved: 'boolean',
  schema: 'schema',
  example: 'any',
  examples: map(ref('Example')),
  content: map(obj('MediaType'))
} as const

/** OpenAPI 3.0, 3.1 and 3.2 objects. */
export function openApi3Defs(): Record<string, ObjectDef> {
  const operationFields = {
    tags: list('string'),
    summary: 'string',
    description: 'string',
    externalDocs: obj('ExternalDocs'),
    operationId: 'string',
    parameters: list(ref('Parameter')),
    requestBody: ref('RequestBody'),
    responses: obj('Responses'),
    callbacks: map(ref('Callback')),
    deprecated: 'boolean',
    security: list(obj('SecurityRequirement')),
    servers: list(obj('Server'))
  } as const
  return {
    Root: {
      fields: {
        openapi: 'string',
        $self: ['string', 32],
        info: obj('Info'),
        jsonSchemaDialect: ['string', 31],
        servers: list(obj('Server')),
        paths: obj('Paths'),
        webhooks: [map(ref('PathItem')), 31],
        components: obj('Components'),
        security: list(obj('SecurityRequirement')),
        tags: list(obj('Tag')),
        externalDocs: obj('ExternalDocs')
      },
      required: ['openapi', 'info'],
      check: (value, path, ctx) => {
        if (ctx.level === 30 && !Object.prototype.hasOwnProperty.call(value, 'paths')) ctx.problems.error('required-field', path, { field: 'paths', object: 'OpenAPI' })
        checkRoot3(value, path, ctx)
      }
    },
    Info: {
      fields: {
        title: 'string',
        summary: ['string', 31],
        description: 'string',
        termsOfService: 'string',
        contact: obj('Contact'),
        license: obj('License'),
        version: 'string'
      },
      required: ['title', 'version'],
      check: checkInfo
    },
    Contact: { fields: { name: 'string', url: 'string', email: 'string' } },
    License: { fields: { name: 'string', identifier: ['string', 31], url: 'string' }, required: ['name'] },
    Server: { fields: { url: 'string', description: 'string', name: ['string', 32], variables: map(obj('ServerVariable')) }, required: ['url'] },
    ServerVariable: { fields: { enum: list('string'), default: 'string', description: 'string' }, required: ['default'], check: checkServerVariable },
    Components: {
      fields: {
        schemas: map('schema', 'component'),
        responses: map(ref('Response'), 'component'),
        parameters: map(ref('Parameter'), 'component'),
        examples: map(ref('Example'), 'component'),
        requestBodies: map(ref('RequestBody'), 'component'),
        headers: map(ref('Header'), 'component'),
        securitySchemes: map(ref('SecurityScheme'), 'component'),
        links: map(ref('Link'), 'component'),
        callbacks: map(ref('Callback'), 'component'),
        pathItems: [map(ref('PathItem'), 'component'), 31],
        mediaTypes: [map(ref('MediaType'), 'component'), 32]
      }
    },
    Paths: { fields: {}, patterned: { type: obj('PathItem'), key: (k) => k.startsWith('/'), badKeyRule: 'path' } },
    PathItem: {
      fields: {
        $ref: 'string',
        summary: 'string',
        description: 'string',
        get: obj('Operation'),
        put: obj('Operation'),
        post: obj('Operation'),
        delete: obj('Operation'),
        options: obj('Operation'),
        head: obj('Operation'),
        patch: obj('Operation'),
        trace: obj('Operation'),
        query: [obj('Operation'), 32],
        additionalOperations: [map(obj('Operation')), 32],
        servers: list(obj('Server')),
        parameters: list(ref('Parameter'))
      },
      check: (value, path, ctx) => {
        if (typeof own(value, '$ref') === 'string') ctx.refs.push({ ref: own(value, '$ref') as string, path: [...path, '$ref'] })
        const extra = own(value, 'additionalOperations')
        if (isObject(extra)) {
          for (const method of Object.keys(extra)) {
            if (['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE', 'QUERY'].includes(method.toUpperCase())) {
              ctx.problems.error('bad-key', [...path, 'additionalOperations', method], { key: method, kind: 'method' })
            } else if (!isHttpToken(method)) {
              // RFC 9110: a method is a token. Anything else cannot be sent (or pasted into a shell).
              ctx.problems.error('bad-key', [...path, 'additionalOperations', method], { key: method, kind: 'method-token' })
            }
          }
        }
      }
    },
    Operation: {
      fields: operationFields,
      check: (value, path, ctx) => {
        if (!Object.prototype.hasOwnProperty.call(value, 'responses')) {
          if (ctx.level === 30) ctx.problems.error('missing-responses', path)
          else ctx.problems.warn('missing-responses', path)
        }
      }
    },
    ExternalDocs: { fields: { description: 'string', url: 'string' }, required: ['url'] },
    Parameter: { fields: { ...parameterFields }, required: ['name', 'in'], check: checkParameter },
    RequestBody: { fields: { description: 'string', content: map(obj('MediaType')), required: 'boolean' }, required: ['content'] },
    MediaType: {
      fields: {
        schema: 'schema',
        example: 'any',
        examples: map(ref('Example')),
        encoding: map(obj('Encoding')),
        description: ['string', 32],
        itemSchema: ['schema', 32],
        prefixEncoding: [list(obj('Encoding')), 32],
        itemEncoding: [obj('Encoding'), 32]
      },
      check: (value, path, ctx) => exclusive(value, path, ctx, 'example', 'examples')
    },
    Encoding: {
      fields: {
        contentType: 'string',
        headers: map(ref('Header')),
        style: 'string',
        explode: 'boolean',
        allowReserved: 'boolean',
        encoding: [map(obj('Encoding')), 32],
        prefixEncoding: [list(obj('Encoding')), 32],
        itemEncoding: [obj('Encoding'), 32]
      }
    },
    Responses: {
      fields: { default: ref('Response') },
      patterned: { type: ref('Response'), key: (k) => STATUS.test(k), badKeyRule: 'status' },
      check: (value, path, ctx) => {
        const codes = Object.keys(value).filter((k) => !k.startsWith('x-'))
        if (codes.length === 0) ctx.problems.warn('missing-responses', path)
        else if (!codes.some((k) => /^[23]/.test(k) || k === 'default')) ctx.problems.info('no-success-response', path)
      }
    },
    Response: {
      fields: {
        summary: ['string', 32],
        description: 'string',
        headers: map(ref('Header')),
        content: map(obj('MediaType')),
        links: map(ref('Link'))
      },
      check: (value, path, ctx) => {
        if (ctx.level < 32 && !Object.prototype.hasOwnProperty.call(value, 'description')) ctx.problems.error('required-field', path, { field: 'description', object: 'Response' })
      }
    },
    Callback: { fields: {}, patterned: { type: obj('PathItem') } },
    Example: {
      fields: {
        summary: 'string',
        description: 'string',
        value: 'any',
        externalValue: 'string',
        dataValue: ['any', 32],
        serializedValue: ['string', 32]
      },
      check: (value, path, ctx) => {
        exclusive(value, path, ctx, 'value', 'externalValue')
        exclusive(value, path, ctx, 'dataValue', 'value')
        exclusive(value, path, ctx, 'serializedValue', 'value')
      }
    },
    Link: {
      fields: { operationRef: 'string', operationId: 'string', parameters: map('any'), requestBody: 'any', description: 'string', server: obj('Server') },
      check: (value, path, ctx) => exclusive(value, path, ctx, 'operationRef', 'operationId')
    },
    Header: {
      fields: {
        description: 'string',
        required: 'boolean',
        deprecated: 'boolean',
        allowEmptyValue: 'boolean',
        style: 'string',
        explode: 'boolean',
        allowReserved: 'boolean',
        schema: 'schema',
        example: 'any',
        examples: map(ref('Example')),
        content: map(obj('MediaType')),
        name: 'any',
        in: 'any'
      },
      check: checkHeader
    },
    Tag: {
      fields: { name: 'string', summary: ['string', 32], description: 'string', externalDocs: obj('ExternalDocs'), parent: ['string', 32], kind: ['string', 32] },
      required: ['name']
    },
    SecurityScheme: {
      fields: {
        type: 'string',
        description: 'string',
        name: 'string',
        in: 'string',
        scheme: 'string',
        bearerFormat: 'string',
        flows: obj('OAuthFlows'),
        openIdConnectUrl: 'string',
        oauth2MetadataUrl: ['string', 32],
        deprecated: ['boolean', 32]
      },
      required: ['type'],
      check: checkSecurityScheme
    },
    OAuthFlows: {
      fields: {
        implicit: obj('OAuthImplicit'),
        password: obj('OAuthPassword'),
        clientCredentials: obj('OAuthPassword'),
        authorizationCode: obj('OAuthCode'),
        deviceAuthorization: [obj('OAuthDevice'), 32]
      }
    },
    OAuthImplicit: { fields: oauthFields(), check: checkFlow(['authorizationUrl', 'scopes']) },
    OAuthPassword: { fields: oauthFields(), check: checkFlow(['tokenUrl', 'scopes']) },
    OAuthCode: { fields: oauthFields(), check: checkFlow(['authorizationUrl', 'tokenUrl', 'scopes']) },
    OAuthDevice: { fields: oauthFields(), check: checkFlow(['deviceAuthorizationUrl', 'tokenUrl', 'scopes']) },
    SecurityRequirement: { fields: {}, patterned: { type: list('string') }, extensions: false }
  }
}

function oauthFields(): Record<string, FieldType | [FieldType, number]> {
  return {
    authorizationUrl: 'string',
    tokenUrl: 'string',
    refreshUrl: 'string',
    scopes: map('string'),
    deviceAuthorizationUrl: ['string', 32]
  }
}

const SCHEMA_LIKE_2 = {
  type: 'string',
  format: 'string',
  items: { obj: 'Items' },
  collectionFormat: oneOf('csv', 'ssv', 'tsv', 'pipes', 'multi'),
  default: 'any',
  maximum: 'number',
  exclusiveMaximum: 'boolean',
  minimum: 'number',
  exclusiveMinimum: 'boolean',
  maxLength: 'integer',
  minLength: 'integer',
  pattern: 'string',
  maxItems: 'integer',
  minItems: 'integer',
  uniqueItems: 'boolean',
  enum: list('any'),
  multipleOf: 'number'
} as const

/** Swagger 2.0 objects. */
export function swagger2Defs(): Record<string, ObjectDef> {
  return {
    Root: {
      fields: {
        swagger: 'string',
        info: obj('Info'),
        host: 'string',
        basePath: 'string',
        schemes: list(oneOf('http', 'https', 'ws', 'wss')),
        consumes: list('string'),
        produces: list('string'),
        paths: obj('Paths'),
        definitions: map('schema'),
        parameters: map(obj('Parameter')),
        responses: map(obj('Response')),
        securityDefinitions: map(obj('SecurityScheme')),
        security: list(obj('SecurityRequirement')),
        tags: list(obj('Tag')),
        externalDocs: obj('ExternalDocs')
      },
      required: ['swagger', 'info', 'paths'],
      check: (value, path, ctx) => {
        if (own(value, 'swagger') !== '2.0') ctx.problems.error('bad-value', [...path, 'swagger'], { value: String(own(value, 'swagger')), allowed: '"2.0"' })
        const host = own(value, 'host')
        if (typeof host === 'string' && /^[a-z]+:\/\/|\//i.test(host)) ctx.problems.error('bad-value', [...path, 'host'], { value: host, allowed: 'host[:port]' })
        const basePath = own(value, 'basePath')
        if (typeof basePath === 'string' && !basePath.startsWith('/')) ctx.problems.error('bad-value', [...path, 'basePath'], { value: basePath, allowed: '/…' })
      }
    },
    Info: {
      fields: { title: 'string', description: 'string', termsOfService: 'string', contact: obj('Contact'), license: obj('License'), version: 'string' },
      required: ['title', 'version']
    },
    Contact: { fields: { name: 'string', url: 'string', email: 'string' } },
    License: { fields: { name: 'string', url: 'string' }, required: ['name'] },
    Paths: { fields: {}, patterned: { type: obj('PathItem'), key: (k) => k.startsWith('/'), badKeyRule: 'path' } },
    PathItem: {
      fields: {
        $ref: 'string',
        get: obj('Operation'),
        put: obj('Operation'),
        post: obj('Operation'),
        delete: obj('Operation'),
        options: obj('Operation'),
        head: obj('Operation'),
        patch: obj('Operation'),
        parameters: list(ref('Parameter'))
      },
      check: (value, path, ctx) => {
        if (typeof own(value, '$ref') === 'string') ctx.refs.push({ ref: own(value, '$ref') as string, path: [...path, '$ref'] })
      }
    },
    Operation: {
      fields: {
        tags: list('string'),
        summary: 'string',
        description: 'string',
        externalDocs: obj('ExternalDocs'),
        operationId: 'string',
        consumes: list('string'),
        produces: list('string'),
        parameters: list(ref('Parameter')),
        responses: obj('Responses'),
        schemes: list(oneOf('http', 'https', 'ws', 'wss')),
        deprecated: 'boolean',
        security: list(obj('SecurityRequirement'))
      },
      check: (value, path, ctx) => {
        if (!Object.prototype.hasOwnProperty.call(value, 'responses')) ctx.problems.error('missing-responses', path)
      }
    },
    ExternalDocs: { fields: { description: 'string', url: 'string' }, required: ['url'] },
    Parameter: {
      fields: { name: 'string', in: 'string', description: 'string', required: 'boolean', schema: 'schema', allowEmptyValue: 'boolean', ...SCHEMA_LIKE_2 },
      required: ['name', 'in'],
      check: (value, path, ctx) => {
        const where = own(value, 'in')
        const allowed = ['query', 'header', 'path', 'formData', 'body']
        if (typeof where === 'string' && !allowed.includes(where)) ctx.problems.error('bad-value', [...path, 'in'], { value: where, allowed: allowed.join(', ') })
        if (where === 'path' && own(value, 'required') !== true) ctx.problems.error('path-param-not-required', path, { name: String(own(value, 'name') ?? '') })
        if (where === 'body') {
          if (!Object.prototype.hasOwnProperty.call(value, 'schema')) ctx.problems.error('required-field', path, { field: 'schema', object: 'Parameter (body)' })
        } else if (typeof where === 'string') {
          if (!Object.prototype.hasOwnProperty.call(value, 'type')) ctx.problems.error('required-field', path, { field: 'type', object: `Parameter (${where})` })
          else ctx.schemas.push({ value, path, paramLike: true })
          if (Object.prototype.hasOwnProperty.call(value, 'schema')) ctx.problems.warn('unknown-field', [...path, 'schema'], { field: 'schema', object: `Parameter (${where})` })
          const type = own(value, 'type')
          if (type === 'file' && where !== 'formData') ctx.problems.error('bad-value', [...path, 'type'], { value: 'file', allowed: 'formData parameters' })
          if (own(value, 'collectionFormat') === 'multi' && where !== 'query' && where !== 'formData') {
            ctx.problems.error('bad-value', [...path, 'collectionFormat'], { value: 'multi', allowed: 'query, formData' })
          }
        }
      }
    },
    Items: {
      fields: { ...SCHEMA_LIKE_2 },
      required: ['type']
    },
    Responses: {
      fields: { default: ref('Response') },
      patterned: { type: ref('Response'), key: (k) => /^[1-5]\d\d$/.test(k), badKeyRule: 'status' },
      check: (value, path, ctx) => {
        const codes = Object.keys(value).filter((k) => !k.startsWith('x-'))
        if (codes.length === 0) ctx.problems.error('missing-responses', path)
        else if (!codes.some((k) => /^[23]/.test(k) || k === 'default')) ctx.problems.info('no-success-response', path)
      }
    },
    Response: {
      fields: { description: 'string', schema: 'schema', headers: map(obj('Header')), examples: map('any') },
      required: ['description']
    },
    Header: {
      fields: { description: 'string', ...SCHEMA_LIKE_2 },
      required: ['type'],
      check: (value, path, ctx) => ctx.schemas.push({ value, path, paramLike: true })
    },
    Tag: { fields: { name: 'string', description: 'string', externalDocs: obj('ExternalDocs') }, required: ['name'] },
    SecurityScheme: {
      fields: {
        type: oneOf('basic', 'apiKey', 'oauth2'),
        description: 'string',
        name: 'string',
        in: oneOf('query', 'header'),
        flow: oneOf('implicit', 'password', 'application', 'accessCode'),
        authorizationUrl: 'string',
        tokenUrl: 'string',
        scopes: map('string')
      },
      required: ['type'],
      check: (value, path, ctx) => {
        const need = (field: string, kind: string) => {
          if (!Object.prototype.hasOwnProperty.call(value, field)) ctx.problems.error('required-field', path, { field, object: `Security Scheme (${kind})` })
        }
        const type = own(value, 'type')
        if (type === 'apiKey') {
          need('name', 'apiKey')
          need('in', 'apiKey')
        } else if (type === 'oauth2') {
          need('flow', 'oauth2')
          need('scopes', 'oauth2')
          const flow = own(value, 'flow')
          if (flow === 'implicit' || flow === 'accessCode') need('authorizationUrl', `oauth2 ${flow}`)
          if (flow === 'password' || flow === 'application' || flow === 'accessCode') need('tokenUrl', `oauth2 ${flow}`)
        }
      }
    },
    SecurityRequirement: { fields: {}, patterned: { type: list('string') }, extensions: false }
  }
}
