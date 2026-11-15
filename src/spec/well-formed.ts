// Text that UTF-8 can carry. An unpaired UTF-16 surrogate (half of a character, such as from a
// `\uD83D` escape in JSON or YAML) cannot be encoded: encodeURIComponent throws on it, JSON text
// keeps it as an escape that sends it on, and a copied sample would lose it anyway.

const REPLACEMENT = String.fromCharCode(0xfffd)

/** Text with each unpaired surrogate replaced by U+FFFD. */
export function wellFormed(text: string): string {
  let out = ''
  let from = 0
  for (let i = loneSurrogate(text, 0); i >= 0; i = loneSurrogate(text, from)) {
    out += text.slice(from, i) + REPLACEMENT
    from = i + 1
  }
  return from === 0 ? text : out + text.slice(from)
}

/** The index of the first unpaired surrogate at or after `from`, or -1. */
export function loneSurrogate(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0xd800 || c > 0xdfff) continue
    if (c <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++
        continue
      }
    }
    return i
  }
  return -1
}
