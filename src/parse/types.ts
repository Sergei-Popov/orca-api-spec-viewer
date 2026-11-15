// What the parsers report about the text itself (syntax), before any API rules run.

export interface ParseIssue {
  code: 'json-syntax' | 'yaml-syntax' | 'yaml-warning' | 'duplicate-key'
  severity: 'error' | 'warning'
  message: string
  /** Offset into the text. */
  offset: number
}
