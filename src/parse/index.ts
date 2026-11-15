// One entry for both syntaxes: JSON (with comments) when the text starts like JSON, YAML otherwise.

import { JsonLocator, parseJson } from './json'
import { LineIndex, type LinePosition } from './lines'
import type { ParseIssue } from './types'
import { parseYaml } from './yaml'

export type { ParseIssue } from './types'
export type { LinePosition } from './lines'

export interface ParsedText {
  format: 'json' | 'jsonc' | 'yaml'
  value: unknown
  issues: ParseIssue[]
  lines: LineIndex
  /** Line and column of the node a path names, or of its deepest existing ancestor. */
  position(path: readonly string[]): LinePosition | null
}

export function looksLikeJson(text: string): boolean {
  for (let i = 0; i < text.length && i < 4096; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0xfeff) continue
    if (c === 0x7b || c === 0x5b) return true
    // A leading // or /* comment: YAML has neither.
    if (c === 0x2f && (text.charCodeAt(i + 1) === 0x2f || text.charCodeAt(i + 1) === 0x2a)) return true
    return false
  }
  return false
}

export function parseText(text: string): ParsedText {
  const lines = new LineIndex(text)
  if (looksLikeJson(text)) {
    const parsed = parseJson(text)
    const locator = new JsonLocator(text)
    return {
      format: parsed.relaxed ? 'jsonc' : 'json',
      value: parsed.value,
      issues: parsed.issues,
      lines,
      position: (path) => {
        const offset = locator.locate(path)
        return offset === null ? null : lines.position(offset)
      }
    }
  }
  const parsed = parseYaml(text)
  return {
    format: 'yaml',
    value: parsed.value,
    issues: parsed.issues,
    lines,
    position: (path) => {
      const offset = parsed.locate(path)
      return offset === null ? null : lines.position(offset)
    }
  }
}
