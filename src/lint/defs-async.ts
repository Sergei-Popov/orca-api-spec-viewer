// The object tables of AsyncAPI 2.x and 3.x, Arazzo 1.x and Overlay 1.x.

import { isObject, own, str } from '../spec/pointer'
import { formatLevel } from './schema-rules'
import { visit, type FieldType, type ObjectDef, type WalkContext } from './walker'

const ref = (obj: string): FieldType => ({ obj, ref: true })
const obj = (name: string): FieldType => ({ obj: name })
const map = (type: FieldType, keys?: 'component'): FieldType => ({ map: type, keys })
const list = (type: FieldType, min?: number): FieldType => ({ list: type, min })
const oneOf = (...values: string[]): FieldType => ({ oneOf: values })

function checkMessages(value: unknown, path: string[], ctx: WalkContext): void {
  // A 2.x operation's message is a Message, a reference, or `oneOf` a list of them.
  if (!isObject(value)) {
    ctx.problems.error('wrong-type', path, { expected: 'object', actual: Array.isArray(value) ? 'array' : typeof value })
    return
  }
  if (Array.isArray(value.oneOf)) {
    value.oneOf.forEach((m, index) => visitRefOr(m, 'Message', [...path, 'oneOf', String(index)], ctx))
    return
  }
  visitRefOr(value, 'Message', path, ctx)
}

function visitRefOr(value: unknown, name: string, path: string[], ctx: WalkContext): void {
  visit(value, { obj: name, ref: true }, path, ctx)
}

const commonInfo = {
  title: 'string',
  version: 'string',
  description: 'string',
  termsOfService: 'string',
  contact: obj('Contact'),
  license: obj('License')
} as const

/** AsyncAPI 2.x. */
export function asyncApi2Defs(): Record<string, ObjectDef> {
  return {
    Root: {
      fields: {
        asyncapi: 'string',
        id: 'string',
        info: obj('Info'),
        servers: map(ref('Server')),
        defaultContentType: 'string',
        channels: map(obj('Channel')),
        components: obj('Components'),
        tags: list(obj('Tag')),
        externalDocs: obj('ExternalDocs')
      },
      required: ['asyncapi', 'info', 'channels']
    },
    Info: { fields: { ...commonInfo }, required: ['title', 'version'] },
    Contact: { fields: { name: 'string', url: 'string', email: 'string' } },
    License: { fields: { name: 'string', url: 'string' }, required: ['name'] },
    Server: {
      fields: {
        url: 'string',
        protocol: 'string',
        protocolVersion: 'string',
        description: 'string',
        variables: map(ref('ServerVariable')),
        security: list(map(list('string'))),
        bindings: 'any',
        tags: list(obj('Tag'))
      },
      required: ['url', 'protocol']
    },
    ServerVariable: { fields: { enum: list('string'), default: 'string', description: 'string', examples: list('string') } },
    Channel: {
      fields: {
        $ref: 'string',
        description: 'string',
        servers: list('string'),
        subscribe: obj('Operation'),
        publish: obj('Operation'),
        parameters: map(ref('Parameter')),
        bindings: 'any'
      },
      check: (value, path, ctx) => {
        if (typeof own(value, '$ref') === 'string') ctx.refs.push({ ref: own(value, '$ref') as string, path: [...path, '$ref'] })
      }
    },
    Operation: {
      fields: {
        operationId: 'string',
        summary: 'string',
        description: 'string',
        security: list(map(list('string'))),
        tags: list(obj('Tag')),
        externalDocs: obj('ExternalDocs'),
        bindings: 'any',
        traits: list(ref('OperationTrait')),
        message: 'any'
      },
      check: (value, path, ctx) => {
        if (own(value, 'message') !== undefined) checkMessages(own(value, 'message'), [...path, 'message'], ctx)
      }
    },
    OperationTrait: {
      fields: { operationId: 'string', summary: 'string', description: 'string', security: 'any', tags: list(obj('Tag')), externalDocs: obj('ExternalDocs'), bindings: 'any' }
    },
    Message: {
      fields: {
        messageId: 'string',
        headers: 'schema',
        payload: 'any',
        correlationId: ref('CorrelationId'),
        schemaFormat: 'string',
        contentType: 'string',
        name: 'string',
        title: 'string',
        summary: 'string',
        description: 'string',
        tags: list(obj('Tag')),
        externalDocs: obj('ExternalDocs'),
        bindings: 'any',
        examples: list(obj('MessageExample')),
        traits: list(ref('MessageTrait'))
      },
      check: (value, path, ctx) => {
        // The payload is in the message's schemaFormat (AsyncAPI's own by default).
        const payload = own(value, 'payload')
        if (payload === undefined) return
        const format = str(own(value, 'schemaFormat'))
        const level = format === undefined ? ctx.level : formatLevel(format, ctx.level)
        if (level !== null) ctx.schemas.push({ value: payload, path: [...path, 'payload'], level })
        else if (isObject(payload) && typeof payload.$ref === 'string') ctx.refs.push({ ref: payload.$ref, path: [...path, 'payload', '$ref'] })
      }
    },
    MessageTrait: {
      fields: {
        messageId: 'string',
        headers: 'schema',
        correlationId: ref('CorrelationId'),
        schemaFormat: 'string',
        contentType: 'string',
        name: 'string',
        title: 'string',
        summary: 'string',
        description: 'string',
        tags: list(obj('Tag')),
        externalDocs: obj('ExternalDocs'),
        bindings: 'any',
        examples: list(obj('MessageExample'))
      }
    },
    MessageExample: { fields: { headers: 'any', payload: 'any', name: 'string', summary: 'string' } },
    CorrelationId: { fields: { description: 'string', location: 'string' }, required: ['location'] },
    Parameter: { fields: { description: 'string', schema: 'schema', location: 'string' } },
    Tag: { fields: { name: 'string', description: 'string', externalDocs: obj('ExternalDocs') }, required: ['name'] },
    ExternalDocs: { fields: { description: 'string', url: 'string' }, required: ['url'] },
    Components: {
      fields: {
        schemas: map('schema', 'component'),
        servers: map(ref('Server'), 'component'),
        serverVariables: map(ref('ServerVariable'), 'component'),
        channels: map(obj('Channel'), 'component'),
        messages: map(ref('Message'), 'component'),
        securitySchemes: map('any', 'component'),
        parameters: map(ref('Parameter'), 'component'),
        correlationIds: map(ref('CorrelationId'), 'component'),
        operationTraits: map(ref('OperationTrait'), 'component'),
        messageTraits: map(ref('MessageTrait'), 'component'),
        serverBindings: map('any', 'component'),
        channelBindings: map('any', 'component'),
        operationBindings: map('any', 'component'),
        messageBindings: map('any', 'component')
      }
    }
  }
}

/** AsyncAPI 3.x. */
export function asyncApi3Defs(): Record<string, ObjectDef> {
  const tagged = { tags: list(ref('Tag')), externalDocs: ref('ExternalDocs') } as const
  return {
    Root: {
      fields: {
        asyncapi: 'string',
        id: 'string',
        info: obj('Info'),
        servers: map(ref('Server')),
        defaultContentType: 'string',
        channels: map(ref('Channel')),
        operations: map(ref('Operation')),
        components: obj('Components')
      },
      required: ['asyncapi', 'info']
    },
    Info: { fields: { ...commonInfo, ...tagged }, required: ['title', 'version'] },
    Contact: { fields: { name: 'string', url: 'string', email: 'string' } },
    License: { fields: { name: 'string', url: 'string' }, required: ['name'] },
    Server: {
      fields: {
        host: 'string',
        protocol: 'string',
        protocolVersion: 'string',
        pathname: 'string',
        description: 'string',
        title: 'string',
        summary: 'string',
        variables: map(ref('ServerVariable')),
        security: list(ref('SecurityScheme')),
        bindings: 'any',
        ...tagged
      },
      required: ['host', 'protocol'],
      check: (value, path, ctx) => {
        const host = own(value, 'host')
        if (typeof host === 'string' && /^[a-z]+:\/\//i.test(host)) ctx.problems.error('bad-value', [...path, 'host'], { value: host, allowed: 'host[:port]' })
      }
    },
    ServerVariable: { fields: { enum: list('string'), default: 'string', description: 'string', examples: list('string') } },
    Channel: {
      fields: {
        address: 'any',
        messages: map(ref('Message')),
        title: 'string',
        summary: 'string',
        description: 'string',
        servers: list(ref('Server')),
        parameters: map(ref('Parameter')),
        bindings: 'any',
        ...tagged
      },
      check: (value, path, ctx) => {
        const address = own(value, 'address')
        if (address !== undefined && address !== null && typeof address !== 'string') {
          ctx.problems.error('wrong-type', [...path, 'address'], { expected: 'string', actual: typeof address })
        }
      }
    },
    Operation: {
      fields: {
        action: oneOf('send', 'receive'),
        channel: ref('Channel'),
        title: 'string',
        summary: 'string',
        description: 'string',
        security: list(ref('SecurityScheme')),
        bindings: 'any',
        traits: list(ref('OperationTrait')),
        messages: list(ref('Message')),
        reply: ref('Reply'),
        ...tagged
      },
      required: ['action', 'channel']
    },
    OperationTrait: { fields: { title: 'string', summary: 'string', description: 'string', security: list(ref('SecurityScheme')), bindings: 'any', ...tagged } },
    // An inline scheme is not checked here; a reference to one is, and counts as its use.
    SecurityScheme: { fields: {}, patterned: { type: 'any' } },
    Reply: { fields: { address: ref('ReplyAddress'), channel: ref('Channel'), messages: list(ref('Message')) } },
    ReplyAddress: { fields: { description: 'string', location: 'string' }, required: ['location'] },
    Message: {
      fields: {
        headers: 'schema',
        payload: 'any',
        correlationId: ref('CorrelationId'),
        contentType: 'string',
        name: 'string',
        title: 'string',
        summary: 'string',
        description: 'string',
        bindings: 'any',
        examples: list(obj('MessageExample')),
        traits: list(ref('MessageTrait')),
        ...tagged
      },
      check: (value, path, ctx) => {
        // A payload is a schema, or a multi-format object { schemaFormat, schema }.
        // checkSchemas picks the rules by its schemaFormat.
        const payload = own(value, 'payload')
        if (payload !== undefined) ctx.schemas.push({ value: payload, path: [...path, 'payload'] })
      }
    },
    MessageTrait: {
      fields: {
        headers: 'schema',
        correlationId: ref('CorrelationId'),
        contentType: 'string',
        name: 'string',
        title: 'string',
        summary: 'string',
        description: 'string',
        bindings: 'any',
        examples: list(obj('MessageExample')),
        ...tagged
      }
    },
    MessageExample: { fields: { headers: 'any', payload: 'any', name: 'string', summary: 'string' } },
    CorrelationId: { fields: { description: 'string', location: 'string' }, required: ['location'] },
    Parameter: { fields: { enum: list('string'), default: 'string', description: 'string', examples: list('string'), location: 'string' } },
    Tag: { fields: { name: 'string', description: 'string', externalDocs: ref('ExternalDocs') }, required: ['name'] },
    ExternalDocs: { fields: { description: 'string', url: 'string' }, required: ['url'] },
    Components: {
      fields: {
        schemas: map('schema', 'component'),
        servers: map(ref('Server'), 'component'),
        channels: map(ref('Channel'), 'component'),
        operations: map(ref('Operation'), 'component'),
        messages: map(ref('Message'), 'component'),
        securitySchemes: map('any', 'component'),
        serverVariables: map(ref('ServerVariable'), 'component'),
        parameters: map(ref('Parameter'), 'component'),
        correlationIds: map(ref('CorrelationId'), 'component'),
        replies: map(ref('Reply'), 'component'),
        replyAddresses: map(ref('ReplyAddress'), 'component'),
        externalDocs: map(ref('ExternalDocs'), 'component'),
        tags: map(ref('Tag'), 'component'),
        operationTraits: map(ref('OperationTrait'), 'component'),
        messageTraits: map(ref('MessageTrait'), 'component'),
        serverBindings: map('any', 'component'),
        channelBindings: map('any', 'component'),
        operationBindings: map('any', 'component'),
        messageBindings: map('any', 'component')
      }
    }
  }
}

/** Arazzo 1.x. */
export function arazzoDefs(): Record<string, ObjectDef> {
  return {
    Root: {
      fields: { arazzo: 'string', info: obj('Info'), sourceDescriptions: list(obj('Source'), 1), workflows: list(obj('Workflow'), 1), components: obj('Components') },
      required: ['arazzo', 'info', 'sourceDescriptions', 'workflows']
    },
    Info: { fields: { title: 'string', summary: 'string', description: 'string', version: 'string' }, required: ['title', 'version'] },
    Source: { fields: { name: 'string', url: 'string', type: oneOf('openapi', 'arazzo') }, required: ['name', 'url'] },
    Workflow: {
      fields: {
        workflowId: 'string',
        summary: 'string',
        description: 'string',
        inputs: 'schema',
        dependsOn: list('string'),
        steps: list(obj('Step'), 1),
        successActions: list('any'),
        failureActions: list('any'),
        outputs: map('string'),
        parameters: list('any')
      },
      required: ['workflowId', 'steps']
    },
    Step: {
      fields: {
        description: 'string',
        stepId: 'string',
        operationId: 'string',
        operationPath: 'string',
        workflowId: 'string',
        parameters: list('any'),
        requestBody: 'any',
        successCriteria: list(obj('Criterion')),
        onSuccess: list('any'),
        onFailure: list('any'),
        outputs: map('string')
      },
      required: ['stepId'],
      check: (value, path, ctx) => {
        const targets = ['operationId', 'operationPath', 'workflowId'].filter((k) => Object.prototype.hasOwnProperty.call(value, k))
        if (targets.length === 0) ctx.problems.error('one-of-fields', path, { fields: 'operationId, operationPath, workflowId' })
        else if (targets.length > 1) ctx.problems.error('mutually-exclusive', path, { a: targets[0], b: targets[1] })
      }
    },
    Criterion: { fields: { context: 'string', condition: 'string', type: 'any' }, required: ['condition'] },
    Components: { fields: { inputs: map('schema'), parameters: map('any'), successActions: map('any'), failureActions: map('any') } }
  }
}

/** Overlay 1.x. */
export function overlayDefs(): Record<string, ObjectDef> {
  return {
    Root: {
      fields: { overlay: 'string', info: obj('Info'), extends: 'string', actions: list(obj('Action'), 1) },
      required: ['overlay', 'info', 'actions']
    },
    Info: { fields: { title: 'string', version: 'string' }, required: ['title', 'version'] },
    Action: {
      fields: { target: 'string', description: 'string', update: 'any', remove: 'boolean', copy: 'string' },
      required: ['target'],
      check: (value, path, ctx) => {
        if (own(value, 'remove') === true && own(value, 'update') !== undefined) ctx.problems.warn('mutually-exclusive', path, { a: 'update', b: 'remove' })
        const target = own(value, 'target')
        if (typeof target === 'string' && !target.trim().startsWith('$')) ctx.problems.warn('overlay-target', [...path, 'target'], { target })
      }
    }
  }
}
