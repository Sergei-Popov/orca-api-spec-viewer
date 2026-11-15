// Arazzo 1.x workflows and Overlay 1.x actions.

import { isObject, own, str, toPointer } from './pointer'
import type { Loc } from './refs'

export interface ArazzoStep {
  key: string
  stepId: string
  description?: string
  /** What the step calls: an operationId, an operationPath or another workflow. */
  target: { kind: 'operationId' | 'operationPath' | 'workflowId'; value: string } | null
  value: Record<string, unknown>
  loc: Loc
}

export interface ArazzoWorkflow {
  key: string
  workflowId: string
  summary?: string
  description?: string
  value: Record<string, unknown>
  loc: Loc
  steps: ArazzoStep[]
}

export interface ArazzoModel {
  root: Record<string, unknown>
  info: Record<string, unknown>
  sources: { name: string; url: string; type?: string; loc: Loc }[]
  workflows: ArazzoWorkflow[]
}

/** An Arazzo 1.x runtime expression such as `$inputs.author` or `$statusCode`, not a literal string. */
const RUNTIME_EXPRESSION = /^\$(?:url|method|statusCode)$|^\$(?:request|response|inputs|outputs|steps|workflows|sourceDescriptions|components)\.[^\s.]/

export function isRuntimeExpression(value: unknown): value is string {
  return typeof value === 'string' && RUNTIME_EXPRESSION.test(value)
}

export function buildArazzo(root: Record<string, unknown>): ArazzoModel {
  const sources: ArazzoModel['sources'] = []
  const rawSources = own(root, 'sourceDescriptions')
  if (Array.isArray(rawSources)) {
    rawSources.forEach((s, index) => {
      if (isObject(s)) sources.push({ name: str(own(s, 'name')) ?? '', url: str(own(s, 'url')) ?? '', type: str(own(s, 'type')), loc: { doc: '', path: ['sourceDescriptions', String(index)] } })
    })
  }
  const workflows: ArazzoWorkflow[] = []
  const rawWorkflows = own(root, 'workflows')
  if (Array.isArray(rawWorkflows)) {
    rawWorkflows.forEach((w, index) => {
      if (!isObject(w)) return
      const loc = { doc: '', path: ['workflows', String(index)] }
      const steps: ArazzoStep[] = []
      const rawSteps = own(w, 'steps')
      if (Array.isArray(rawSteps)) {
        rawSteps.forEach((s, stepIndex) => {
          if (!isObject(s)) return
          const sloc = { doc: '', path: [...loc.path, 'steps', String(stepIndex)] }
          const target = (['operationId', 'operationPath', 'workflowId'] as const).find((k) => typeof own(s, k) === 'string')
          steps.push({
            key: 'step:' + toPointer(sloc.path),
            stepId: str(own(s, 'stepId')) ?? String(stepIndex + 1),
            description: str(own(s, 'description')),
            target: target ? { kind: target, value: own(s, target) as string } : null,
            value: s,
            loc: sloc
          })
        })
      }
      workflows.push({
        key: 'wf:' + toPointer(loc.path),
        workflowId: str(own(w, 'workflowId')) ?? String(index + 1),
        summary: str(own(w, 'summary')),
        description: str(own(w, 'description')),
        value: w,
        loc,
        steps
      })
    })
  }
  return { root, info: isObject(own(root, 'info')) ? (own(root, 'info') as Record<string, unknown>) : {}, sources, workflows }
}

export interface OverlayAction {
  key: string
  index: number
  target: string
  description?: string
  kind: 'update' | 'remove' | 'copy' | 'none'
  value: Record<string, unknown>
  loc: Loc
}

export interface OverlayModel {
  root: Record<string, unknown>
  info: Record<string, unknown>
  extends?: string
  actions: OverlayAction[]
}

export function buildOverlay(root: Record<string, unknown>): OverlayModel {
  const actions: OverlayAction[] = []
  const raw = own(root, 'actions')
  if (Array.isArray(raw)) {
    raw.forEach((a, index) => {
      if (!isObject(a)) return
      const loc = { doc: '', path: ['actions', String(index)] }
      const kind = own(a, 'remove') === true ? 'remove' : own(a, 'update') !== undefined ? 'update' : own(a, 'copy') !== undefined ? 'copy' : 'none'
      actions.push({ key: 'act:' + toPointer(loc.path), index, target: str(own(a, 'target')) ?? '', description: str(own(a, 'description')), kind, value: a, loc })
    })
  }
  return { root, info: isObject(own(root, 'info')) ? (own(root, 'info') as Record<string, unknown>) : {}, extends: str(own(root, 'extends')), actions }
}
