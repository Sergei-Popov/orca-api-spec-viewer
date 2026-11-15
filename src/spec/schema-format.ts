// AsyncAPI's schemaFormat: which rules a payload schema follows, if it is a JSON Schema at all.

/**
 * The rules for an AsyncAPI schema in the given `schemaFormat`: the document's for AsyncAPI and
 * JSON Schema, OpenAPI 3.0's for OpenAPI schemas, and none (null) for Avro, RAML, Protobuf and
 * anything else, which are not JSON Schema at all.
 */
export function formatLevel(format: string, documentLevel: number): number | null {
  const type = format.trim().toLowerCase()
  if (/^application\/vnd\.aai\.asyncapi(?:\+json|\+yaml)?(?:;|$)/.test(type)) return documentLevel
  if (/^application\/schema\+(?:json|yaml)(?:;|$)/.test(type)) return documentLevel
  if (/^application\/vnd\.oai\.openapi(?:\+json|\+yaml)?(?:;|$)/.test(type)) return 30
  return null
}

/** Whether schemas in this format are drawn as a schema tree; Avro, Protobuf, RAML… show as source. */
export function isJsonSchemaFormat(format: string | undefined): boolean {
  return format === undefined || formatLevel(format, 0) !== null
}
