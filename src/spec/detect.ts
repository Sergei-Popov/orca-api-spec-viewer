// What kind of document the file is, from its top-level fields: an API description this viewer
// reads, or something else that it names so that the explanation can say what it found.

import { isObject, own } from './pointer'

export type Family =
  | 'swagger2'
  | 'openapi30'
  | 'openapi31'
  | 'openapi32'
  | 'asyncapi2'
  | 'asyncapi3'
  | 'arazzo1'
  | 'overlay1'

export type SpecKind = 'openapi' | 'asyncapi' | 'arazzo' | 'overlay'

export type OtherKind =
  | 'empty'
  | 'scalar'
  | 'array'
  | 'json-schema'
  | 'kubernetes'
  | 'github-actions'
  | 'docker-compose'
  | 'package-json'
  | 'tsconfig'
  | 'swagger1'
  | 'asyncapi1'
  | 'unknown-version'
  | 'object'

export type Detection =
  | {
      spec: true
      kind: SpecKind
      family: Family
      /** The version string as written (`3.1.0`, `2.0`). */
      version: string
      /** Set when the version is newer than the rules this viewer knows; it reads it as `family`. */
      newer?: boolean
    }
  | { spec: false; other: OtherKind; field?: string; version?: string }

export function detect(value: unknown): Detection {
  if (value === null || value === undefined || value === '') return { spec: false, other: 'empty' }
  if (Array.isArray(value)) return { spec: false, other: 'array' }
  if (!isObject(value)) return { spec: false, other: 'scalar' }

  const openapi = versionOf(own(value, 'openapi'))
  if (openapi !== null) {
    const [major, minor] = numbers(openapi)
    if (major === 3) {
      if (minor === 0) return { spec: true, kind: 'openapi', family: 'openapi30', version: openapi }
      if (minor === 1) return { spec: true, kind: 'openapi', family: 'openapi31', version: openapi }
      if (minor === 2) return { spec: true, kind: 'openapi', family: 'openapi32', version: openapi }
      if (minor > 2) return { spec: true, kind: 'openapi', family: 'openapi32', version: openapi, newer: true }
    }
    if (major === 2) return { spec: true, kind: 'openapi', family: 'swagger2', version: openapi }
    return { spec: false, other: 'unknown-version', field: 'openapi', version: openapi }
  }
  const swagger = versionOf(own(value, 'swagger'))
  if (swagger !== null) {
    const [major] = numbers(swagger)
    if (major === 2) return { spec: true, kind: 'openapi', family: 'swagger2', version: swagger }
    if (major === 1) return { spec: false, other: 'swagger1', field: 'swagger', version: swagger }
    return { spec: false, other: 'unknown-version', field: 'swagger', version: swagger }
  }
  if (versionOf(own(value, 'swaggerVersion')) !== null) {
    return { spec: false, other: 'swagger1', field: 'swaggerVersion', version: versionOf(own(value, 'swaggerVersion')) ?? '' }
  }
  const asyncapi = versionOf(own(value, 'asyncapi'))
  if (asyncapi !== null) {
    const [major] = numbers(asyncapi)
    if (major === 2) return { spec: true, kind: 'asyncapi', family: 'asyncapi2', version: asyncapi }
    if (major === 3) return { spec: true, kind: 'asyncapi', family: 'asyncapi3', version: asyncapi }
    if (major > 3) return { spec: true, kind: 'asyncapi', family: 'asyncapi3', version: asyncapi, newer: true }
    if (major === 1) return { spec: false, other: 'asyncapi1', field: 'asyncapi', version: asyncapi }
    return { spec: false, other: 'unknown-version', field: 'asyncapi', version: asyncapi }
  }
  const arazzo = versionOf(own(value, 'arazzo'))
  if (arazzo !== null) {
    const [major, minor] = numbers(arazzo)
    if (major === 1) return { spec: true, kind: 'arazzo', family: 'arazzo1', version: arazzo, newer: minor > 1 || undefined }
    return { spec: false, other: 'unknown-version', field: 'arazzo', version: arazzo }
  }
  const overlay = versionOf(own(value, 'overlay'))
  if (overlay !== null) {
    const [major, minor] = numbers(overlay)
    if (major === 1) return { spec: true, kind: 'overlay', family: 'overlay1', version: overlay, newer: minor > 1 || undefined }
    return { spec: false, other: 'unknown-version', field: 'overlay', version: overlay }
  }

  if (typeof own(value, '$schema') === 'string' && /json-schema/.test(String(own(value, '$schema')))) {
    return { spec: false, other: 'json-schema' }
  }
  if (typeof own(value, 'apiVersion') === 'string' && typeof own(value, 'kind') === 'string') {
    return { spec: false, other: 'kubernetes' }
  }
  if (isObject(own(value, 'jobs')) && own(value, 'on') !== undefined) return { spec: false, other: 'github-actions' }
  if (isObject(own(value, 'services')) && (own(value, 'version') !== undefined || Object.keys(value).length <= 6)) {
    return { spec: false, other: 'docker-compose' }
  }
  if (typeof own(value, 'name') === 'string' && (isObject(own(value, 'dependencies')) || isObject(own(value, 'scripts')) || isObject(own(value, 'devDependencies')))) {
    return { spec: false, other: 'package-json' }
  }
  if (isObject(own(value, 'compilerOptions'))) return { spec: false, other: 'tsconfig' }
  return { spec: false, other: 'object' }
}

/** A version written as a string, or as a YAML number such as `2.0` (read back as 2). */
function versionOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? `${value}.0` : String(value)
  return null
}

function numbers(version: string): number[] {
  return version.split('.').map((part) => {
    const n = parseInt(part, 10)
    return Number.isNaN(n) ? -1 : n
  })
}

export function familyLabel(family: Family): string {
  switch (family) {
    case 'swagger2':
      return 'Swagger 2.0'
    case 'openapi30':
      return 'OpenAPI 3.0'
    case 'openapi31':
      return 'OpenAPI 3.1'
    case 'openapi32':
      return 'OpenAPI 3.2'
    case 'asyncapi2':
      return 'AsyncAPI 2'
    case 'asyncapi3':
      return 'AsyncAPI 3'
    case 'arazzo1':
      return 'Arazzo 1'
    case 'overlay1':
      return 'Overlay 1'
  }
}

export const isOpenApi3 = (family: Family): boolean => family === 'openapi30' || family === 'openapi31' || family === 'openapi32'
/** JSON Schema 2020-12 schemas (type arrays, prefixItems, $defs…). */
export const isModernSchema = (family: Family): boolean => family === 'openapi31' || family === 'openapi32'
