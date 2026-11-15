// A problem found in the document: a rule, a severity, where it is (a path from the root), and the
// values its message names. Messages are worded in i18n.ts, one template per rule.

export type Severity = 'error' | 'warning' | 'info'

export type RuleCode =
  // The text itself
  | 'syntax'
  | 'duplicate-key'
  | 'yaml-alias-cycle'
  | 'yaml-alias-limit'
  | 'yaml-documents'
  /** The checks themselves failed; the document is still shown. */
  | 'lint-failed'
  // Structure, per version
  | 'required-field'
  | 'unknown-field'
  | 'wrong-type'
  | 'bad-value'
  | 'not-in-version'
  | 'mutually-exclusive'
  | 'one-of-fields'
  | 'empty-list'
  | 'bad-key'
  // References
  | 'unresolved-ref'
  | 'external-ref'
  | 'circular-ref'
  | 'long-ref-chain'
  | 'ref-siblings'
  // OpenAPI semantics
  | 'duplicate-operation-id'
  | 'path-param-undeclared'
  | 'path-param-unused'
  | 'path-param-not-required'
  | 'duplicate-param'
  | 'equivalent-paths'
  | 'unused-component'
  | 'missing-responses'
  | 'no-success-response'
  | 'unknown-security-scheme'
  | 'server-variable-undefined'
  | 'enum-default'
  | 'invalid-enum'
  | 'invalid-default'
  | 'invalid-example'
  | 'invalid-pattern'
  | 'min-max'
  | 'required-not-defined'
  | 'discriminator'
  | 'duplicate-tag'
  | 'undeclared-tag'
  | 'unknown-parent-tag'
  | 'tag-parent-cycle'
  | 'querystring-field'
  | 'querystring-conflict'
  | 'link-operation'
  | 'multiple-body'
  | 'schema-keyword'
  // AsyncAPI, Arazzo, Overlay
  | 'channel-param-undeclared'
  | 'duplicate-id'
  | 'unknown-target'
  | 'overlay-target'

export interface Problem {
  rule: RuleCode
  severity: Severity
  /** Where the problem is, from the document root. */
  path: readonly string[]
  /** Values the message names, e.g. `{ field: 'responses' }`. */
  params: Record<string, string | number>
  /** Syntax problems come with an offset instead of a path. */
  offset?: number
  /** Parser wording for syntax problems, shown as it is. */
  text?: string
}

export const MAX_PROBLEMS = 5000

export class ProblemList {
  readonly items: Problem[] = []
  /** Problems beyond MAX_PROBLEMS, counted but not kept. */
  dropped = 0

  add(rule: RuleCode, severity: Severity, path: readonly string[], params: Problem['params'] = {}): void {
    if (this.items.length >= MAX_PROBLEMS) {
      this.dropped++
      return
    }
    this.items.push({ rule, severity, path: path.slice(), params })
  }

  error(rule: RuleCode, path: readonly string[], params?: Problem['params']): void {
    this.add(rule, 'error', path, params)
  }

  warn(rule: RuleCode, path: readonly string[], params?: Problem['params']): void {
    this.add(rule, 'warning', path, params)
  }

  info(rule: RuleCode, path: readonly string[], params?: Problem['params']): void {
    this.add(rule, 'info', path, params)
  }
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

export function compareSeverity(a: Severity, b: Severity): number {
  return RANK[a] - RANK[b]
}
