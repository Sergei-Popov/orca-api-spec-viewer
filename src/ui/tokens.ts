// Tokens of the code the viewer shows: JSON examples and the code samples. No DOM here, so the
// scan can be tested and timed on its own.

export type CodeLanguage = 'json' | 'shell' | 'js' | 'python' | 'text'

/** `k` key, `s` string, `l` literal or keyword, `n` number, `f` flag, `c` comment, `` plain. */
export type TokenKind = 'k' | 's' | 'l' | 'n' | 'f' | 'c' | ''

export interface CodeToken {
  kind: TokenKind
  text: string
}

/** Longer text is shown plain: thousands of spans would cost more than they help. */
export const HIGHLIGHT_LIMIT = 400_000

// Every string pattern ends in an optional quote. An unterminated string (such as the end of an
// example cut short) then runs to the end of its line or of the text instead of failing, so the
// scan never restarts inside it at each escaped quote: one pass, whatever the text.
const JSON_TOKENS = /("(?:\\.|[^"\\\n])*"?)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g
const SHELL_TOKENS = /('[^']*'?)|("(?:\\.|[^"\\])*"?)|(^|\s)(--?[A-Za-z][\w-]*)|(#[^\n]*)/g
const JS_TOKENS =
  /('(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`(?:\\.|[^`\\])*`?)|\b(const|let|await|import|from|async|function|return|new|true|false|null|True|False|None)\b|(-?\b\d+(?:\.\d+)?\b)|((?:\/\/|#)[^\n]*)/g

export function codeTokens(text: string, language: CodeLanguage): CodeToken[] {
  if (language === 'text' || text.length >= HIGHLIGHT_LIMIT) return [{ kind: '', text }]
  const pattern = language === 'json' ? JSON_TOKENS : language === 'shell' ? SHELL_TOKENS : JS_TOKENS
  const out: CodeToken[] = []
  const plain = (part: string) => {
    if (part) out.push({ kind: '', text: part })
  }
  pattern.lastIndex = 0
  let at = 0
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m[0] === '') {
      pattern.lastIndex++
      continue
    }
    plain(text.slice(at, m.index))
    if (language === 'json') {
      if (m[1]) {
        out.push({ kind: m[2] ? 'k' : 's', text: m[1] })
        plain(m[2] ?? '')
      } else if (m[3]) out.push({ kind: 'l', text: m[3] })
      else out.push({ kind: 'n', text: m[4] })
    } else if (language === 'shell') {
      if (m[1] || m[2]) out.push({ kind: 's', text: m[1] ?? m[2] })
      else if (m[4]) {
        plain(m[3])
        out.push({ kind: 'f', text: m[4] })
      } else out.push({ kind: 'c', text: m[5] })
    } else {
      if (m[1]) out.push({ kind: 's', text: m[1] })
      else if (m[2]) out.push({ kind: 'l', text: m[2] })
      else if (m[3]) out.push({ kind: 'n', text: m[3] })
      else out.push({ kind: 'c', text: m[4] })
    }
    at = m.index + m[0].length
  }
  plain(text.slice(at))
  return out
}
