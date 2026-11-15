// From text to everything the views need: the parsed value, what kind of document it is, the
// model of its version, the reference resolver and the problems. DOM-free, so tests run it.

import { lintDocument, type Problem, type Usages } from './lint/index'
import { parseText, type ParsedText } from './parse/index'
import { buildArazzo, buildOverlay, type ArazzoModel, type OverlayModel } from './spec/arazzo'
import { buildAsyncApi, type AsyncApiModel } from './spec/asyncapi'
import { detect, type Detection } from './spec/detect'
import { buildOpenApi, type OpenApiModel } from './spec/openapi'
import { isObject } from './spec/pointer'
import { Refs } from './spec/refs'

export type Model =
  | { kind: 'openapi'; model: OpenApiModel }
  | { kind: 'asyncapi'; model: AsyncApiModel }
  | { kind: 'arazzo'; model: ArazzoModel }
  | { kind: 'overlay'; model: OverlayModel }

export interface Analysis {
  parsed: ParsedText
  detection: Detection
  refs: Refs
  model: Model | null
  problems: Problem[]
  /** Problems found beyond the list's cap. */
  dropped: number
  /** Who refers to each local target (by JSON pointer). */
  usages: Usages
  /** Milliseconds spent, for the console. */
  timings: { parse: number; model: number; lint: number }
}

/** `documents`: other files the person loaded for external references, by file name. */
export function analyze(text: string, documents?: ReadonlyMap<string, unknown>): Analysis {
  const t0 = now()
  const parsed = parseText(text)
  const t1 = now()
  const detection = detect(parsed.value)
  const refs = new Refs(parsed.value)
  if (documents) for (const [name, value] of documents) refs.addDocument(name, value)
  let model: Model | null = null
  if (detection.spec && isObject(parsed.value)) {
    const root = parsed.value
    if (detection.kind === 'openapi') model = { kind: 'openapi', model: buildOpenApi(root, detection.family, refs) }
    else if (detection.kind === 'asyncapi') model = { kind: 'asyncapi', model: buildAsyncApi(root, detection.family, refs) }
    else if (detection.kind === 'arazzo') model = { kind: 'arazzo', model: buildArazzo(root) }
    else model = { kind: 'overlay', model: buildOverlay(root) }
  }
  const t2 = now()
  const problems: Problem[] = parsed.issues.map((issue) => ({
    rule: issue.code === 'duplicate-key' ? 'duplicate-key' : 'syntax',
    severity: issue.severity,
    path: [],
    params: {},
    offset: issue.offset,
    text: issue.message
  }))
  let dropped = 0
  let usages: Usages = new Map()
  if (detection.spec && isObject(parsed.value) && model) {
    const result = lintDocument(parsed.value, detection.family, refs, model.kind === 'overlay' ? { kind: 'overlay' } : model)
    problems.push(...result.problems.items)
    dropped = result.problems.dropped
    usages = result.usages
  }
  const t3 = now()
  return { parsed, detection, refs, model, problems, dropped, usages, timings: { parse: t1 - t0, model: t2 - t1, lint: t3 - t2 } }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
