// Offsets to line and column numbers, for problems that point at a place in the file.

export interface LinePosition {
  /** 1-based line. */
  line: number
  /** 1-based column, in UTF-16 code units. */
  column: number
}

export class LineIndex {
  private starts: number[] | null = null

  constructor(private readonly text: string) {}

  /** Line and column of an offset; offsets past the end land on the last line. */
  position(offset: number): LinePosition {
    const starts = this.lineStarts()
    const at = Math.max(0, Math.min(offset, this.text.length))
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (starts[mid] <= at) low = mid
      else high = mid - 1
    }
    return { line: low + 1, column: at - starts[low] + 1 }
  }

  get lineCount(): number {
    return this.lineStarts().length
  }

  /** The text of a 1-based line, without its line break. */
  line(n: number): string {
    const starts = this.lineStarts()
    if (n < 1 || n > starts.length) return ''
    const start = starts[n - 1]
    const end = n < starts.length ? starts[n] - 1 : this.text.length
    const text = this.text.slice(start, Math.min(end, start + 4000))
    return text.endsWith('\r') ? text.slice(0, -1) : text
  }

  private lineStarts(): number[] {
    if (this.starts) return this.starts
    const starts = [0]
    const text = this.text
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
    this.starts = starts
    return starts
  }
}
