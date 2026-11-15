// Runs the rules of the document's version: structure (walker + tables), schemas, references,
// and the semantic rules. Returns problems in document order of their paths' discovery.

import type { ArazzoModel } from '../spec/arazzo'
import type { AsyncApiModel } from '../spec/asyncapi'
import type { Family } from '../spec/detect'
import type { OpenApiModel } from '../spec/openapi'
import type { Refs } from '../spec/refs'
import { arazzoDefs, asyncApi2Defs, asyncApi3Defs, overlayDefs } from './defs-async'
import { openApi3Defs, swagger2Defs } from './defs-openapi'
import { ProblemList } from './problem'
import { asyncComponentSections, checkArazzo, checkAsyncApi, checkOpenApi, checkRefs, checkUnused, openApiComponentSections, type Usages } from './rules'
import { checkSchemas } from './schema-rules'
import { levelOf, visitObject, type ObjectDef, type WalkContext } from './walker'

export type LintModel =
  | { kind: 'openapi'; model: OpenApiModel }
  | { kind: 'asyncapi'; model: AsyncApiModel }
  | { kind: 'arazzo'; model: ArazzoModel }
  | { kind: 'overlay' }

function defsFor(family: Family): Record<string, ObjectDef> {
  switch (family) {
    case 'swagger2':
      return swagger2Defs()
    case 'openapi30':
    case 'openapi31':
    case 'openapi32':
      return openApi3Defs()
    case 'asyncapi2':
      return asyncApi2Defs()
    case 'asyncapi3':
      return asyncApi3Defs()
    case 'arazzo1':
      return arazzoDefs()
    case 'overlay1':
      return overlayDefs()
  }
}

export function lintDocument(root: Record<string, unknown>, family: Family, refs: Refs, lintModel: LintModel): { problems: ProblemList; usages: Usages } {
  const problems = new ProblemList()
  const ctx: WalkContext = {
    family,
    level: levelOf(family),
    problems,
    defs: defsFor(family),
    refs: [],
    schemas: [],
    loose: [],
    root
  }
  visitObject(root, 'Root', [], ctx)
  checkSchemas(ctx)
  const used = checkRefs(ctx, refs)
  if (lintModel.kind === 'openapi') {
    checkOpenApi(ctx, refs, lintModel.model)
    if (lintModel.model.operations.length + lintModel.model.webhooks.length > 0) checkUnused(ctx, used, openApiComponentSections(lintModel.model))
  } else if (lintModel.kind === 'asyncapi') {
    checkAsyncApi(ctx, refs, lintModel.model)
    if (lintModel.model.channels.length + lintModel.model.operations.length > 0) checkUnused(ctx, used, asyncComponentSections(lintModel.model))
  } else if (lintModel.kind === 'arazzo') {
    checkArazzo(ctx, lintModel.model)
  }
  return { problems, usages: used }
}

export { compareSeverity, type Problem, type RuleCode, type Severity } from './problem'
export type { Usages } from './rules'
