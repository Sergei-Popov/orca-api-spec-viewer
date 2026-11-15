// RFC 9110 tokens: what an HTTP method or a header field name may be made of.

export function isHttpToken(text: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(text)
}
