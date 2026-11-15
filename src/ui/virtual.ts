// A list that keeps only the visible rows in the DOM, so a sidebar of thousands of operations or
// a source file of a million lines scrolls smoothly. Rows have one fixed height. Past the
// browser's height limit the scrollbar maps proportionally onto the rows.

const MAX_HEIGHT = 8_000_000

export interface VirtualOptions<T> {
  rowHeight: number
  render: (item: T, index: number) => HTMLElement
  className?: string
  overscan?: number
}

export class VirtualList<T> {
  readonly el: HTMLElement
  private readonly spacer: HTMLElement
  private readonly rows: HTMLElement
  private items: T[] = []
  private frame = 0
  private first = -1
  private last = -1
  private height = 0

  constructor(private readonly options: VirtualOptions<T>) {
    this.el = document.createElement('div')
    this.el.className = 'vlist' + (options.className ? ' ' + options.className : '')
    this.spacer = document.createElement('div')
    this.spacer.className = 'spacer-y'
    this.rows = document.createElement('div')
    this.rows.className = 'rows'
    this.el.append(this.spacer, this.rows)
    this.el.addEventListener('scroll', () => this.schedule(), { passive: true })
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.schedule()).observe(this.el)
  }

  get length(): number {
    return this.items.length
  }

  setItems(items: T[]): void {
    this.items = items
    this.height = items.length * this.options.rowHeight
    this.spacer.style.height = Math.min(this.height, MAX_HEIGHT) + 'px'
    this.first = this.last = -1
    this.draw()
  }

  /** Draws the visible rows again, for a change in what they show. */
  refresh(): void {
    this.first = this.last = -1
    this.draw()
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.draw()
    })
  }

  /** Scroll position to content offset, and back: 1:1 below the height limit. */
  private ratio(): number {
    const view = this.el.clientHeight
    const scaled = Math.min(this.height, MAX_HEIGHT)
    if (this.height <= MAX_HEIGHT || scaled <= view) return 1
    return (this.height - view) / (scaled - view)
  }

  private draw(): void {
    const { rowHeight } = this.options
    const overscan = this.options.overscan ?? 8
    const view = this.el.clientHeight || 600
    const ratio = this.ratio()
    const offset = this.el.scrollTop * ratio
    const first = Math.max(0, Math.floor(offset / rowHeight) - overscan)
    const last = Math.min(this.items.length, Math.ceil((offset + view) / rowHeight) + overscan)
    if (first === this.first && last === this.last && ratio === 1) return
    this.first = first
    this.last = last
    const top = ratio === 1 ? first * rowHeight : this.el.scrollTop - (offset - first * rowHeight)
    this.rows.style.transform = `translateY(${top}px)`
    const fragment = document.createDocumentFragment()
    for (let i = first; i < last; i++) {
      const row = this.options.render(this.items[i], i)
      row.style.height = rowHeight + 'px'
      fragment.append(row)
    }
    this.rows.replaceChildren(fragment)
  }

  /** Brings a row into view: only if needed (`nearest`), or centred. */
  scrollToIndex(index: number, align: 'nearest' | 'center' | 'start' = 'nearest'): void {
    if (index < 0 || index >= this.items.length) return
    const { rowHeight } = this.options
    const view = this.el.clientHeight || 600
    const ratio = this.ratio()
    const top = index * rowHeight
    const current = this.el.scrollTop * ratio
    let target = current
    if (align === 'center') target = top - view / 2 + rowHeight / 2
    else if (align === 'start') target = top
    else if (top < current) target = top
    else if (top + rowHeight > current + view) target = top + rowHeight - view
    if (target !== current) this.el.scrollTop = Math.max(0, target / ratio)
    this.draw()
  }

  get scrollTop(): number {
    return this.el.scrollTop
  }

  set scrollTop(value: number) {
    this.el.scrollTop = value
    this.draw()
  }
}
