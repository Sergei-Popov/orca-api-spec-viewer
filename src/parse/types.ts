// What the parsers report about the text itself (syntax), before any API rules run.

export interface ParseIssue {
  code: 'json-syntax' | 'yaml-syntax' | 'yaml-warning' | 'duplicate-key' | 'yaml-alias-cycle' | 'yaml-alias-limit' | 'yaml-documents'
  severity: 'error' | 'warning' | 'info'
  /** The parser's own wording, for syntax problems; the others are worded from `params`. */
  message: string
  params?: Record<string, string | number>
  /** Offset into the text. */
  offset: number
}
