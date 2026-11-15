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
  assert.deepEqual(p('<div class="x">\n<p>Hello <script>evil()</script>world</p>\n</div>'), [{ t: 'p', c: [{ t: 'text', v: 'Hello world' }] }])
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
