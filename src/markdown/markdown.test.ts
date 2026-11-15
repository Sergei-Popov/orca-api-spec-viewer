import { assert, test } from 'orca/testing'
import { firstLine, parseMarkdown, plainText, type Block } from './parse'

const p = (source: string) => parseMarkdown(source)
const inl = (source: string) => {
  const blocks = p(source)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].t, 'p')
  return (blocks[0] as Extract<Block, { t: 'p' }>).c
}

test('paragraphs, headings, rules, code and quotes', () => {
  assert.deepEqual(p('# Title\n\nOne\ntwo\n\n---\n\n    code\n\n```js\nlet a = 1\n```\n\n> quoted\nlazy'), [
    { t: 'h', level: 1, c: [{ t: 'text', v: 'Title' }] },
    { t: 'p', c: [{ t: 'text', v: 'One two' }] },
    { t: 'hr' },
    { t: 'code', lang: '', v: 'code' },
    { t: 'code', lang: 'js', v: 'let a = 1' },
    { t: 'quote', c: [{ t: 'p', c: [{ t: 'text', v: 'quoted lazy' }] }] }
  ])
  assert.deepEqual(p('Setext\n===\nTwo\n---'), [
    { t: 'h', level: 1, c: [{ t: 'text', v: 'Setext' }] },
    { t: 'h', level: 2, c: [{ t: 'text', v: 'Two' }] }
  ])
})

test('lists: tight, loose, nested and ordered', () => {
  assert.deepEqual(p('- a\n- b\n  - c\n\n3. x\n4. y'), [
    {
      t: 'list',
      ordered: false,
      start: 1,
      tight: true,
      items: [[{ t: 'p', c: [{ t: 'text', v: 'a' }] }], [{ t: 'p', c: [{ t: 'text', v: 'b' }] }, { t: 'list', ordered: false, start: 1, tight: true, items: [[{ t: 'p', c: [{ t: 'text', v: 'c' }] }]] }]]
    },
    { t: 'list', ordered: true, start: 3, tight: true, items: [[{ t: 'p', c: [{ t: 'text', v: 'x' }] }], [{ t: 'p', c: [{ t: 'text', v: 'y' }] }]] }
  ])
  const loose = p('* a\n\n* b')[0] as Extract<Block, { t: 'list' }>
  assert.equal(loose.tight, false)
  assert.equal(loose.items.length, 2)
})

test('emphasis, strong, strikethrough and code spans', () => {
  assert.deepEqual(inl('*a* **b** _c_ __d__ ~~e~~ `f*g`'), [
    { t: 'em', c: [{ t: 'text', v: 'a' }] },
    { t: 'text', v: ' ' },
    { t: 'strong', c: [{ t: 'text', v: 'b' }] },
    { t: 'text', v: ' ' },
    { t: 'em', c: [{ t: 'text', v: 'c' }] },
    { t: 'text', v: ' ' },
    { t: 'strong', c: [{ t: 'text', v: 'd' }] },
    { t: 'text', v: ' ' },
    { t: 'del', c: [{ t: 'text', v: 'e' }] },
    { t: 'text', v: ' ' },
    { t: 'code', v: 'f*g' }
  ])
  assert.deepEqual(inl('snake_case_name and 2 * 3 * 4'), [{ t: 'text', v: 'snake_case_name and 2 * 3 * 4' }])
  assert.deepEqual(inl('***both***'), [{ t: 'em', c: [{ t: 'strong', c: [{ t: 'text', v: 'both' }] }] }])
  assert.deepEqual(inl('\\*not\\*'), [{ t: 'text', v: '*not*' }])
})

test('links: inline, reference, autolinks, bare links and images', () => {
  assert.deepEqual(inl('[docs](https://example.com/a_(b) "Title")'), [{ t: 'link', href: 'https://example.com/a_(b)', title: 'Title', c: [{ t: 'text', v: 'docs' }] }])
  assert.deepEqual(p('See [the guide][g].\n\n[g]: https://example.com/guide')[0], {
    t: 'p',
    c: [{ t: 'text', v: 'See ' }, { t: 'link', href: 'https://example.com/guide', title: undefined, c: [{ t: 'text', v: 'the guide' }] }, { t: 'text', v: '.' }]
  })
  assert.deepEqual(inl('<https://a.example> <me@example.com>'), [
    { t: 'link', href: 'https://a.example', c: [{ t: 'text', v: 'https://a.example' }] },
    { t: 'text', v: ' ' },
    { t: 'link', href: 'mailto:me@example.com', c: [{ t: 'text', v: 'me@example.com' }] }
  ])
  assert.deepEqual(inl('Visit https://example.com/x. Or (www.example.org).'), [
    { t: 'text', v: 'Visit ' },
    { t: 'link', href: 'https://example.com/x', c: [{ t: 'text', v: 'https://example.com/x' }] },
    { t: 'text', v: '. Or (' },
    { t: 'link', href: 'https://www.example.org', c: [{ t: 'text', v: 'www.example.org' }] },
    { t: 'text', v: ').' }
  ])
  assert.deepEqual(inl('![a *cat*](https://example.com/cat.png)'), [{ t: 'image', src: 'https://example.com/cat.png', alt: 'a cat' }])
  assert.deepEqual(inl('[not a link] [x]()'), [{ t: 'text', v: '[not a link] ' }, { t: 'link', href: '', title: undefined, c: [{ t: 'text', v: 'x' }] }])
})

test('HTML is dropped to its text; br breaks lines; entities decode', () => {
  assert.deepEqual(inl('a<br>b <b>bold</b> <img src=x onerror=y> &amp; &copy; &#169; &#x41; &bogus;'), [
    { t: 'text', v: 'a' },
    { t: 'br' },
    { t: 'text', v: 'b bold  & © © A &bogus;' }
  ])
  assert.deepEqual(p('<div class="x">\n<p>Hello <script>run()</script>world</p>\n</div>'), [{ t: 'p', c: [{ t: 'text', v: 'Hello world' }] }])
  assert.deepEqual(p('<details><summary>More</summary>\nHidden **text**\n</details>'), [
    { t: 'p', c: [{ t: 'text', v: 'More' }] },
    { t: 'p', c: [{ t: 'text', v: 'Hidden ' }, { t: 'strong', c: [{ t: 'text', v: 'text' }] }] }
  ])
})

test('GFM tables with alignment, escaped pipes and code', () => {
  const [table] = p('| Name | Value |\n| :--- | ---: |\n| a \\| b | `x|y` |\n| c |')
  assert.deepEqual(table, {
    t: 'table',
    align: ['left', 'right'],
    head: [[{ t: 'text', v: 'Name' }], [{ t: 'text', v: 'Value' }]],
    rows: [
      [[{ t: 'text', v: 'a | b' }], [{ t: 'code', v: 'x|y' }]],
      [[{ t: 'text', v: 'c' }], []]
    ]
  })
})

test('hard breaks, deep nesting and first lines', () => {
  assert.deepEqual(inl('one  \ntwo\\\nthree'), [{ t: 'text', v: 'one' }, { t: 'br' }, { t: 'text', v: 'two' }, { t: 'br' }, { t: 'text', v: 'three' }])
  const deep = '>'.repeat(200) + ' x'
  assert.ok(p(deep).length === 1)
  assert.equal(firstLine('# Pets API\n\nMore *text*'), 'Pets API')
  assert.equal(firstLine('A '.repeat(200)).length, 160)
  assert.equal(plainText(inl('**a** `b` [c](#d)')), 'a b c')
})

test('a long malformed input stays fast', () => {
  const start = Date.now()
  p('['.repeat(20000) + '*'.repeat(20000) + '`'.repeat(5000) + '<'.repeat(5000))
  assert.ok(Date.now() - start < 2000)
})

/** Inline nodes as HTML, to compare with the CommonMark spec's examples. */
function html(nodes: ReturnType<typeof inl>): string {
  return nodes
    .map((n) => {
      if (n.t === 'text') return n.v
      if (n.t === 'code') return `<code>${n.v}</code>`
      if (n.t === 'br') return '<br>'
      if (n.t === 'image') return `<img alt="${n.alt}">`
      if (n.t === 'link') return `<a>${html(n.c)}</a>`
      return `<${n.t}>${html(n.c)}</${n.t}>`
    })
    .join('')
}

test('emphasis follows CommonMark, including the rule of three', () => {
  const cases: [string, string][] = [
    ['*foo bar*', '<em>foo bar</em>'],
    ['*foo**bar**baz*', '<em>foo<strong>bar</strong>baz</em>'],
    ['*foo**bar*', '<em>foo**bar</em>'],
    ['**foo*bar*baz**', '<strong>foo<em>bar</em>baz</strong>'],
    ['*(*foo*)*', '<em>(<em>foo</em>)</em>'],
    ['_foo_bar_', '<em>foo_bar</em>'],
    ['foo*bar*', 'foo<em>bar</em>'],
    ['*foo _bar* baz_', '<em>foo _bar</em> baz_'],
    ['**foo "*bar*" foo**', '<strong>foo "<em>bar</em>" foo</strong>'],
    ['****foo****', '<strong><strong>foo</strong></strong>'],
    ['*foo**', '<em>foo</em>*'],
    ['**foo*', '*<em>foo</em>'],
    ['*a **b** c*', '<em>a <strong>b</strong> c</em>'],
    ['foo***bar***baz', 'foo<em><strong>bar</strong></em>baz'],
    ['*foo [*bar*](#x)*', '<em>foo <a><em>bar</em></a></em>'],
    ['~~a *b* c~~', '<del>a <em>b</em> c</del>'],
    ['**a *b** c*', '<em><em>a <em>b</em></em> c</em>']
  ]
  for (const [source, expected] of cases) assert.equal(html(inl(source)), expected, source)
})

test('ATX headings, table delimiters and HTML blocks without patterns that backtrack', () => {
  assert.deepEqual(p('#   Title   ###   '), [{ t: 'h', level: 1, c: [{ t: 'text', v: 'Title' }] }])
  assert.deepEqual(p('## foo#'), [{ t: 'h', level: 2, c: [{ t: 'text', v: 'foo#' }] }])
  assert.deepEqual(p('### ###'), [{ t: 'h', level: 3, c: [] }])
  assert.deepEqual(p('#5 bolt'), [{ t: 'p', c: [{ t: 'text', v: '#5 bolt' }] }])
  assert.deepEqual(p('#'), [{ t: 'h', level: 1, c: [] }])
  assert.equal(p('a | b\n:-- | --:\n1 | 2')[0].t, 'table')
  assert.equal(p('a | b\n- | x')[0].t, 'p')
  assert.equal(p('|' + 'a|'.repeat(70) + '\n|' + '-|'.repeat(70))[0].t, 'p', 'more than 64 columns is not a table')
  assert.deepEqual(p('<div>\nkeep <script>drop()</script> this <!-- not this --> <p class="x">and</p>\n</div>'), [
    { t: 'p', c: [{ t: 'text', v: 'keep  this' }, { t: 'br' }, { t: 'text', v: 'and' }] }
  ])
  assert.deepEqual(inl('a <span title="x > y">b</span> <!-- c --> d'), [{ t: 'text', v: 'a b  d' }])
  assert.deepEqual(inl('see https://example.com/a_(b)). and www.example.com/x&amp;'), [
    { t: 'text', v: 'see ' },
    { t: 'link', href: 'https://example.com/a_(b)', c: [{ t: 'text', v: 'https://example.com/a_(b)' }] },
    { t: 'text', v: '). and ' },
    { t: 'link', href: 'https://www.example.com/x', c: [{ t: 'text', v: 'www.example.com/x' }] },
    { t: 'text', v: '&' }
  ])
})

test('100 KB of adversarial Markdown parses in under 200 ms each, and renders without overflow', () => {
  const N = 100_000
  const cases: Record<string, string> = {
    'spaces in a paragraph': 'a' + ' '.repeat(N - 4) + 'b\nc',
    'tabs in a paragraph': 'a' + '\t'.repeat(N - 2) + 'b',
    'spaces in a heading': '# a' + ' '.repeat(N - 4) + 'b',
    'hard-break spaces on many lines': 'a  \n'.repeat(N / 4),
    'short lines': 'a\n'.repeat(N / 2),
    'spaces then lines': 'a' + ' '.repeat(N / 2) + 'b' + '\nc'.repeat(N / 4),
    'alternating delimiters': '*_'.repeat(N / 2),
    'unclosed emphasis': 'a* '.repeat(N / 3),
    'nested emphasis': '*a '.repeat(N / 6) + 'b*'.repeat(N / 6),
    'nested strong': '**a '.repeat(N / 8) + 'b**'.repeat(N / 8),
    'long runs': '*'.repeat(N / 2) + 'a' + '*'.repeat(N / 2),
    'table delimiter': 'a|b\n-' + ' '.repeat(N - 8) + 'x',
    'table with short rows': '|' + 'a|'.repeat(60) + '\n|' + '-|'.repeat(60) + '\n' + 'x\n'.repeat((N - 250) / 2),
    'definition-like': '[a]: x' + ' '.repeat(N / 2) + 'y' + ' '.repeat(N / 2 - 10) + 'z',
    'backtick runs': Array.from({ length: 440 }, (_, i) => '`'.repeat(i + 1) + 'x').join(''),
    'unclosed code': '`a``'.repeat(N / 4),
    'comments': '<!--'.repeat(N / 4),
    'tags without end': '<p'.repeat(N / 2),
    'tag with spaces': ('<p' + ' '.repeat(2000)).repeat(N / 2002),
    'unclosed attribute': '<a x="'.repeat(N / 6),
    'script without end': '<div>\n' + '<script>'.repeat(N / 8),
    'block tags without end': '<div>\n' + '<p '.repeat(N / 3),
    'url with parentheses': ('https://(' + ')'.repeat(2000) + ' ').repeat(N / 2010),
    'url with entities': ('https://x' + '&a;'.repeat(500) + ' ').repeat(N / 2010),
    'brackets': '['.repeat(N),
    'nested brackets': '['.repeat(N / 2) + ']'.repeat(N / 2),
    'links without end': '[a](b ('.repeat(N / 7),
    'angle destination': '[a](<'.repeat(N / 5) + '>',
    'nested images': '![x'.repeat(N / 8) + '](#a)'.repeat(N / 8),
    'entities': '&amp'.repeat(N / 4),
    'bare urls': '(http://'.repeat(N / 8),
    'quotes': '> '.repeat(N / 2) + 'x',
    'lists': '- '.repeat(N / 2) + 'x'
  }
  for (const [name, source] of Object.entries(cases)) {
    assert.ok(source.length <= N + 100, `${name}: ${source.length}`)
    const start = performance.now()
    const blocks = p(source)
    const ms = performance.now() - start
    assert.ok(ms < 200, `${name}: ${ms.toFixed(0)} ms`)
    // Deep trees would overflow the renderer, which recurses like this.
    const depth = (nodes: unknown): number => {
      let d = 0
      for (const n of nodes as { c?: unknown; items?: unknown[] }[]) {
        if (Array.isArray(n.c)) d = Math.max(d, 1 + depth(n.c))
        if (Array.isArray(n.items)) for (const item of n.items) d = Math.max(d, 1 + depth(item))
      }
      return d
    }
    assert.ok(depth(blocks) < 200, `${name}: depth ${depth(blocks)}`)
  }
})
