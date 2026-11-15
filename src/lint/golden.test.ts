// Golden problem counts for excerpts of real specs: the official Petstore 3.0 and 3.1, GitHub's
// REST description (3.0 and 3.1), Stripe's, and the AsyncAPI streetlights examples (2.6 and 3.0).
// The downloaded documents are not kept in the repository; each fixture is built here from the
// structures that once gave false problems, plus the true problems the whole spec has, so a
// count that moves is either a new false problem or a lost true one.

import { assert, test } from 'orca/testing'
import { analyze } from '../analyze'
import type { AsyncApiModel } from '../spec/asyncapi'
import type { OpenApiModel } from '../spec/openapi'

type Spec = Record<string, unknown>

const ok = { description: 'Successful operation' }
const json = (schema: unknown) => ({ 'application/json': { schema } })
const ref = (to: string) => ({ $ref: to })

/** Problems by `severity:rule`, the form the counts below are written in. */
function counts(spec: Spec): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of analyze(JSON.stringify(spec)).problems) {
    const key = `${p.severity[0]}:${p.rule}`
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

function petstore30(): Spec {
  const pet = {
    required: ['name', 'photoUrls'],
    type: 'object',
    properties: {
      id: { type: 'integer', format: 'int64', example: 10 },
      name: { type: 'string', example: 'doggie' },
      category: ref('#/components/schemas/Category'),
      photoUrls: { type: 'array', xml: { wrapped: true }, items: { type: 'string', xml: { name: 'photoUrl' } } },
      status: { type: 'string', description: 'pet status in the store', enum: ['available', 'pending', 'sold'] }
    },
    xml: { name: 'pet' }
  }
  return {
    openapi: '3.0.2',
    info: { title: 'Swagger Petstore - OpenAPI 3.0', version: '1.0.17' },
    servers: [{ url: '/api/v3' }],
    paths: {
      '/pet': {
        put: {
          tags: ['pet'],
          operationId: 'updatePet',
          requestBody: { content: { ...json(ref('#/components/schemas/Pet')), 'application/x-www-form-urlencoded': { schema: ref('#/components/schemas/Pet') } }, required: true },
          responses: { 200: { ...ok, content: json(ref('#/components/schemas/Pet')) }, 400: { description: 'Invalid ID supplied' } },
          security: [{ petstore_auth: ['write:pets', 'read:pets'] }]
        }
      },
      '/user/createWithList': {
        post: {
          tags: ['user'],
          operationId: 'createUsersWithListInput',
          requestBody: { content: json({ type: 'array', items: ref('#/components/schemas/User') }) },
          responses: { 200: { ...ok, content: json(ref('#/components/schemas/User')) }, default: { description: 'successful operation' } }
        }
      }
    },
    components: {
      schemas: {
        Category: { type: 'object', properties: { id: { type: 'integer', format: 'int64', example: 1 }, name: { type: 'string', example: 'Dogs' } }, xml: { name: 'category' } },
        User: { type: 'object', properties: { id: { type: 'integer', format: 'int64', example: 10 }, username: { type: 'string', example: 'theUser' }, userStatus: { type: 'integer', format: 'int32', example: 1 } } },
        Pet: pet
      },
      // True: the official document declares these two and never uses them.
      requestBodies: {
        Pet: { description: 'Pet object that needs to be added to the store', content: json(ref('#/components/schemas/Pet')) },
        UserArray: { description: 'List of user object', content: json({ type: 'array', items: ref('#/components/schemas/User') }) }
      },
      securitySchemes: {
        petstore_auth: { type: 'oauth2', flows: { implicit: { authorizationUrl: 'https://petstore3.swagger.io/oauth/authorize', scopes: { 'write:pets': 'modify pets in your account', 'read:pets': 'read your pets' } } } },
        api_key: { type: 'apiKey', name: 'api_key', in: 'header' }
      }
    }
  }
}

function petstore31(): Spec {
  return {
    openapi: '3.1.0',
    info: { title: 'Swagger Petstore - OpenAPI 3.1', version: '1.0.6' },
    servers: [{ url: '/api/v31' }],
    paths: {
      '/pet': {
        put: {
          requestBody: { content: json({ $ref: '#/components/schemas/Pet', description: 'A Pet in JSON Format', required: ['id'], writeOnly: true }), required: true },
          responses: { 200: { ...ok, content: json({ $ref: '#/components/schemas/Pet', description: 'A Pet in XML Format', readOnly: true }) } }
        }
      }
    },
    webhooks: {
      newPet: { post: { requestBody: { content: json({ $ref: '#/components/schemas/Pet', description: 'Webhook Pet' }) }, responses: { 200: { description: 'Return a 200 status' } } } }
    },
    components: {
      schemas: {
        // Resources with relative $ids, found by URI and by an anchor of their own.
        Category: { $id: '/api/v31/components/schemas/category', description: 'Category', properties: { id: { type: 'integer', format: 'int64' }, name: { type: 'string' } } },
        Tag: { $id: '/api/v31/components/schemas/tag', properties: { id: { type: 'integer', format: 'int64' }, name: { type: 'string' } } },
        PetDetails: {
          $id: '/api/v31/components/schemas/petdetails',
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          properties: {
            // True: examples of an integer must be integers.
            id: { type: 'integer', format: 'int64', $anchor: 'pet_details_id', examples: ['10'] },
            category: { $ref: '/api/v31/components/schemas/category', description: 'PetDetails Category' },
            tag: ref('/api/v31/components/schemas/tag')
          }
        },
        Pet: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          description: 'Pet',
          properties: {
            id: { type: 'integer', format: 'int64' },
            category: { $ref: '#/components/schemas/Category', description: 'Pet Category' },
            name: { type: 'string', examples: ['doggie'] },
            photoUrls: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: ref('#/components/schemas/Tag') },
            // True, as above.
            availableInstances: { type: 'integer', format: 'int32', examples: ['7'], exclusiveMaximum: 10, exclusiveMinimum: 1 },
            petDetailsId: { type: 'integer', format: 'int64', $ref: '/api/v31/components/schemas/petdetails#pet_details_id' },
            petDetails: ref('/api/v31/components/schemas/petdetails')
          },
          required: ['name', 'photoUrls']
        }
      }
    }
  }
}

function github(version: '3.0.3' | '3.1.0'): Spec {
  const v30 = version === '3.0.3'
  const user = { title: 'Simple User', type: 'object', properties: { login: { type: 'string', examples: v30 ? undefined : ['octocat'] }, id: { type: 'integer' } }, required: ['login', 'id'] }
  return {
    openapi: version,
    info: { title: 'GitHub v3 REST API', version: '1.1.4' },
    servers: [{ url: 'https://api.github.com' }],
    paths: {
      '/repos/{owner}/{repo}': {
        get: {
          parameters: [ref('#/components/parameters/owner'), ref('#/components/parameters/repo')],
          responses: {
            200: {
              description: 'Response',
              content: {
                'application/json': {
                  schema: ref('#/components/schemas/full-repository'),
                  // Named examples: `default` is a name here, not the keyword.
                  examples: { default: ref('#/components/examples/full-repository') }
                }
              }
            }
          }
        }
      },
      // True: the same path as above with other parameter names.
      '/repos/{org}/{name}': {
        delete: { parameters: [{ name: 'org', in: 'path', required: true, schema: { type: 'string' } }, { name: 'name', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Response' } } }
      },
      // True (a note): only error responses are described.
      '/orgs/{org}/blocks': {
        put: { parameters: [{ name: 'org', in: 'path', required: true, schema: { type: 'string' } }], responses: { 422: { description: 'Validation failed' } } }
      }
    },
    // OpenAPI 3.0 has no webhooks; GitHub lists them under x-webhooks, and a schema used only
    // there is used.
    ...(v30 ? { 'x-webhooks': { 'branch-protection-rule-created': { post: { requestBody: { content: json(ref('#/components/schemas/webhook-branch-protection-rule-created')) }, responses: { 200: { description: 'Return a 200 status' } } } } } } : {}),
    ...(v30 ? {} : { webhooks: { 'branch-protection-rule-created': { post: { requestBody: { content: json(ref('#/components/schemas/webhook-branch-protection-rule-created')) }, responses: { 200: { description: 'Return a 200 status' } } } } } }),
    components: {
      parameters: {
        owner: { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
        repo: { name: 'repo', in: 'path', required: true, schema: { type: 'string' } }
      },
      schemas: {
        'simple-user': user,
        'full-repository': {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            parent: ref('#/components/schemas/repository-with-url'),
            // OpenAPI 3.0 nullable without a type: the value may be null or a user.
            owner: v30 ? { nullable: true, allOf: [ref('#/components/schemas/simple-user')] } : { anyOf: [{ type: 'null' }, ref('#/components/schemas/simple-user')] },
            template_repository: v30 ? { nullable: true, allOf: [ref('#/components/schemas/simple-user')], example: { login: 'octocat', id: 1 } } : { anyOf: [{ type: 'null' }, ref('#/components/schemas/simple-user')] },
            // GitHub's 3.1 conversion writes examples of an array as its items. True in 3.1.
            topics: v30 ? { type: 'array', items: { type: 'string' }, example: ['octocat'] } : { type: 'array', items: { type: 'string' }, examples: ['octocat', 'atom'] },
            // 3.1 has no nullable keyword. True in 3.1.
            ...(v30 ? {} : { delete_branch_on_merge: { type: 'boolean', nullable: true } })
          },
          // True: names a property that is not defined.
          required: ['id', 'owner', 'clone_url']
        },
        'webhook-branch-protection-rule-created': {
          type: 'object',
          properties: { action: { type: 'string', enum: ['created'] }, sender: ref('#/components/schemas/simple-user') },
          required: ['action'],
          // A $ref inside an extension is a use.
          'x-github': { owner: ref('#/components/schemas/webhook-owner') }
        },
        'webhook-owner': { type: 'object', properties: { login: { type: 'string' } } },
        // An allOf mixin may require what the other parts define.
        'repository-mixin': { type: 'object', required: ['url'], properties: { id: { type: 'integer' } } },
        'repository-with-url': { allOf: [ref('#/components/schemas/repository-mixin'), { type: 'object', properties: { url: { type: 'string' } } }] },
        // True: declared and never used.
        'org-ruleset-conditions': { type: 'object' }
      },
      examples: {
        'full-repository': { value: { id: 1296269, owner: { login: 'octocat', id: 1 }, topics: ['octocat'] } }
      }
    }
  }
}

function stripe(): Spec {
  return {
    openapi: '3.0.0',
    info: { title: 'Stripe API', version: '2024-06-20' },
    servers: [{ url: 'https://api.stripe.com/' }],
    paths: {
      '/v1/charges/{charge}': {
        get: {
          parameters: [{ name: 'charge', in: 'path', required: true, schema: { type: 'string', maxLength: 5000 }, style: 'simple' }, { name: 'expand', in: 'query', schema: { type: 'array', items: { type: 'string', maxLength: 5000 } }, style: 'deepObject', explode: true }],
          responses: { 200: { description: 'Successful response.', content: json(ref('#/components/schemas/charge')) }, default: { description: 'Error response.', content: json(ref('#/components/schemas/error')) } }
        }
      }
    },
    components: {
      schemas: {
        charge: {
          type: 'object',
          properties: {
            id: { type: 'string', maxLength: 5000 },
            // nullable without a type, on an expandable field.
            customer: { nullable: true, anyOf: [{ type: 'string', maxLength: 5000 }, ref('#/components/schemas/customer')], 'x-expansionResources': { oneOf: [ref('#/components/schemas/customer')] } },
            description: { type: 'string', nullable: true, maxLength: 40000 },
            // An enum with null in it, on a nullable string.
            status: { type: 'string', nullable: true, enum: ['failed', 'pending', 'succeeded', null] },
            metadata: { type: 'object', additionalProperties: { type: 'string', maxLength: 500 } }
          },
          required: ['id', 'customer', 'description', 'metadata', 'status'],
          'x-resourceId': 'charge'
        },
        customer: { type: 'object', properties: { id: { type: 'string', maxLength: 5000 } }, required: ['id'] },
        error: { type: 'object', properties: { error: { type: 'object', properties: { message: { type: 'string', maxLength: 40000 } } } }, required: ['error'] }
      },
      securitySchemes: { basicAuth: { type: 'http', scheme: 'basic' }, bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'auth-scheme' } }
    },
    security: [{ basicAuth: [] }, { bearerAuth: [] }]
  }
}

function streetlights30(): Spec {
  const scopes = { 'streetlights:on': 'Ability to switch lights on', 'streetlights:off': 'Ability to switch lights off' }
  return {
    asyncapi: '3.0.0',
    info: { title: 'Streetlights MQTT API', version: '1.0.0' },
    defaultContentType: 'application/json',
    servers: {
      production: {
        host: 'test.mosquitto.org:{port}',
        protocol: 'mqtt',
        variables: { port: { enum: ['1883', '8883'], default: '1883' } },
        // Inline schemes beside referenced ones.
        security: [ref('#/components/securitySchemes/apiKey'), { type: 'oauth2', description: 'Flows to support OAuth 2.0', flows: { implicit: { authorizationUrl: 'https://authserver.example/auth', availableScopes: scopes } }, scopes: ['streetlights:on'] }],
        tags: [{ name: 'env:production' }]
      }
    },
    channels: {
      lightingMeasured: {
        address: 'smartylighting/streetlights/1/0/event/{streetlightId}/lighting/measured',
        messages: { lightMeasured: ref('#/components/messages/lightMeasured') },
        parameters: { streetlightId: ref('#/components/parameters/streetlightId') }
      },
      lightTurnOn: {
        address: 'smartylighting/streetlights/1/0/action/{streetlightId}/turn/on',
        messages: { turnOn: ref('#/components/messages/turnOnOff') },
        parameters: { streetlightId: ref('#/components/parameters/streetlightId') }
      }
    },
    operations: {
      receiveLightMeasurement: {
        action: 'receive',
        channel: ref('#/channels/lightingMeasured'),
        traits: [ref('#/components/operationTraits/mqtt')],
        messages: [ref('#/channels/lightingMeasured/messages/lightMeasured')]
      },
      turnOn: { action: 'send', channel: ref('#/channels/lightTurnOn'), traits: [ref('#/components/operationTraits/mqtt')], messages: [ref('#/channels/lightTurnOn/messages/turnOn')] }
    },
    components: {
      messages: {
        lightMeasured: { name: 'lightMeasured', title: 'Light measured', contentType: 'application/json', traits: [ref('#/components/messageTraits/commonHeaders')], payload: ref('#/components/schemas/lightMeasuredPayload') },
        turnOnOff: { name: 'turnOnOff', title: 'Turn on/off', traits: [ref('#/components/messageTraits/commonHeaders')], payload: ref('#/components/schemas/turnOnOffPayload') }
      },
      schemas: {
        lightMeasuredPayload: { type: 'object', properties: { lumens: { type: 'integer', minimum: 0 }, sentAt: ref('#/components/schemas/sentAt') } },
        turnOnOffPayload: { type: 'object', properties: { command: { type: 'string', enum: ['on', 'off'] }, sentAt: ref('#/components/schemas/sentAt') } },
        sentAt: { type: 'string', format: 'date-time' }
      },
      securitySchemes: { apiKey: { type: 'apiKey', in: 'user', description: 'Provide your API key as the user and leave the password empty.' } },
      parameters: { streetlightId: { description: 'The ID of the streetlight.' } },
      messageTraits: { commonHeaders: { headers: { type: 'object', properties: { 'my-app-header': { type: 'integer', minimum: 0, maximum: 100 } } } } },
      operationTraits: { mqtt: { bindings: { mqtt: { qos: 1 } } } }
    }
  }
}

function streetlights26(): Spec {
  return {
    asyncapi: '2.6.0',
    info: { title: 'Streetlights Kafka API', version: '1.0.0' },
    servers: { 'scram-connections': { url: 'test.mykafkacluster.org:18092', protocol: 'kafka-secure', security: [{ saslScram: [] }] } },
    defaultContentType: 'application/json',
    channels: {
      'smartylighting.streetlights.1.0.event.{streetlightId}.lighting.measured': {
        parameters: { streetlightId: ref('#/components/parameters/streetlightId') },
        subscribe: { operationId: 'receiveLightMeasurement', traits: [ref('#/components/operationTraits/kafka')], message: ref('#/components/messages/lightMeasured') }
      }
    },
    components: {
      messages: { lightMeasured: { name: 'lightMeasured', contentType: 'application/json', traits: [ref('#/components/messageTraits/commonHeaders')], payload: ref('#/components/schemas/lightMeasuredPayload') } },
      schemas: { lightMeasuredPayload: { type: 'object', properties: { lumens: { type: 'integer', minimum: 0 }, sentAt: ref('#/components/schemas/sentAt') } }, sentAt: { type: 'string', format: 'date-time' } },
      securitySchemes: { saslScram: { type: 'scramSha256', description: 'Provide your username and password for SASL/SCRAM authentication' } },
      parameters: { streetlightId: { description: 'The ID of the streetlight.', schema: { type: 'string' } } },
      messageTraits: { commonHeaders: { headers: { type: 'object', properties: { 'my-app-header': { type: 'integer', minimum: 0, maximum: 100 } } } } },
      operationTraits: { kafka: { bindings: { kafka: { clientId: { type: 'string', enum: ['my-app-id'] } } } } }
    }
  }
}

/** Expected problems: only true ones. */
const GOLDEN: [string, () => Spec, Record<string, number>][] = [
  ['Petstore 3.0', petstore30, { 'w:unused-component': 2 }],
  ['Petstore 3.1', petstore31, { 'w:invalid-example': 2 }],
  ['GitHub 3.0', () => github('3.0.3'), { 'i:no-success-response': 1, 'w:required-not-defined': 1, 'w:equivalent-paths': 1, 'w:unused-component': 1 }],
  ['GitHub 3.1', () => github('3.1.0'), { 'i:no-success-response': 1, 'w:invalid-example': 2, 'w:schema-keyword': 1, 'w:required-not-defined': 1, 'w:equivalent-paths': 1, 'w:unused-component': 1 }],
  ['Stripe', stripe, {}],
  ['Streetlights MQTT (AsyncAPI 3.0)', streetlights30, {}],
  ['Streetlights Kafka (AsyncAPI 2.6)', streetlights26, {}]
]

for (const [name, build, expected] of GOLDEN) {
  test(`golden: ${name} has only its true problems`, () => {
    assert.deepEqual(counts(build()), expected)
  })
}

test('golden: what the excerpts show', () => {
  // GitHub 3.0's x-webhooks are webhooks.
  const gh = analyze(JSON.stringify(github('3.0.3')))
  assert.deepEqual((gh.model as { model: OpenApiModel }).model.webhooks.map((w) => w.route), ['branch-protection-rule-created'])
  // Petstore 3.1: a reference's description overrides the target's.
  const pet = analyze(JSON.stringify(petstore31()))
  const category = pet.refs.follow({ $ref: '#/components/schemas/Category', description: 'Pet Category' }, { doc: '', path: ['components', 'schemas', 'Pet', 'properties', 'category'] })
  assert.equal((category.value as { description: string }).description, 'Pet Category')
  // Streetlights: the message trait's headers and the operation trait's bindings are merged.
  for (const spec of [streetlights30(), streetlights26()]) {
    const model = (analyze(JSON.stringify(spec)).model as { model: AsyncApiModel }).model
    assert.ok(model.operations[0].messages[0].value.headers, model.family)
    assert.ok(model.operations[0].op.bindings, model.family)
  }
})
