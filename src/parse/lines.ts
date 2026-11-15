// Offsets to line and column numbers, for problems that point at a place in the file.

/** Characters of a line the source view shows at once. */
export const MAX_LINE = 4000

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

  /** The text of a 1-based line, without its line break, up to MAX_LINE characters. */
  line(n: number): string {
    return this.slice(n, 0, MAX_LINE)
  }

  /** The length of a 1-based line, without its line break. */
  lineLength(n: number): number {
    const range = this.range(n)
    return range ? range[1] - range[0] : 0
  }

  /** Characters `from` to `to` of a 1-based line. */
  slice(n: number, from: number, to: number): string {
    const range = this.range(n)
    if (!range) return ''
    const start = range[0] + Math.max(0, from)
    return this.text.slice(start, Math.min(range[1], range[0] + to))
  }

  /**
   * The widest line as the source view draws it: at most `cap` characters, a tab counting as
   * `tab` columns. One pass over the line starts, plus one hop per tab.
   */
  widest(cap: number, tab = 8): number {
    const starts = this.lineStarts()
    const extra = new Map<number, number>()
    for (let i = this.text.indexOf('\t'); i >= 0; i = this.text.indexOf('\t', i + 1)) {
      const line = this.position(i).line
      extra.set(line, (extra.get(line) ?? 0) + tab - 1)
    }
    let widest = 0
    for (let n = 1; n <= starts.length; n++) widest = Math.max(widest, Math.min(this.lineLength(n), cap) + (extra.get(n) ?? 0))
    return widest
  }

  /** Start and end offsets of a 1-based line, without its line break (and a CR before it). */
  private range(n: number): [number, number] | null {
    const starts = this.lineStarts()
    if (n < 1 || n > starts.length) return null
    const start = starts[n - 1]
    let end = n < starts.length ? starts[n] - 1 : this.text.length
    if (end > start && this.text[end - 1] === '\r') end--
    return [start, end]
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
