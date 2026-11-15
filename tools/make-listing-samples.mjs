// Writes the demo files for the listing images into .orca/listing/samples/ (git-ignored), as
// patched copies of test-files/: fictional titles, authors and ISBN, example.com hosts, an
// example on every Book, Shelf and Loan property, and borrow-a-book.arazzo.yaml
// (listBooks -> borrowBook -> getBook). Then, from the hub:
//   scripts/listing-image.sh api-spec-viewer --dry-run --check --sheet
// Usage: node tools/make-listing-samples.mjs [plugin dir]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(dir, 'test-files')
const out = path.join(dir, '.orca', 'listing', 'samples')
fs.mkdirSync(out, { recursive: true })

const RENAMES = [
  ['The Hobbit', 'The Lantern Keeper'],
  ['J. R. R. Tolkien', 'Ines Calder'],
  ['example: tolkien', 'example: calder'],
  ['978-0-261-10221-7', '978-1-23456-789-7'],
  ['title: Dune', 'title: Tides of Varen'],
  ['Frank Herbert', 'Oskar Lind'],
  // The draft's description must not read as a staged demo (same line count, so line numbers hold).
  ['This draft has a few mistakes on purpose, to show the problems panel.', 'Draft of the next version, not yet reviewed.']
]

/** Reserved `.example` hosts become subdomains of example.com. */
function exampleCom(text) {
  return text.replace(/\.example(?=[/:'"\s,\]}>]|$)/gm, '.example.com')
}

const BOOK_ID = "'5c1f7a2e-8d4b-4e7a-9f61-2b8c3d4e5f60'"
const SHELF_ID = "'0b9e4d21-6a3c-4f58-8e17-c42d9a7b3e15'"
const EXAMPLES = {
  genres: '[[fantasy, history]]',
  published: "['2019-04-12']",
  isbn: "['978-1-23456-789-7']",
  pages: '[312]',
  format: '[epub]',
  sizeBytes: '[1832000]',
  id: `[${BOOK_ID}]`,
  addedAt: "['2026-11-03T09:30:00Z']",
  location: '[B2-14]',
  tags: "[{floor: '2', room: reference}]",
  bookId: `[${BOOK_ID}]`,
  reader: '[reader@example.com]',
  due: "['2026-12-01']",
  notifyUrl: "['https://hooks.example.com/loans']",
  next: "['/books?cursor=b2']"
}
/** Where a property means something else in another schema: each id is its own. */
const BY_SCHEMA = {
  Shelf: { id: `[${SHELF_ID}]` },
  Loan: { id: '[loan-2026-0042]' }
}
const SCHEMAS = new Set(['BookBase', 'PrintedBook', 'EBook', 'Book', 'BookPage', 'Shelf', 'Loan'])

/** Adds `examples:` to the listed properties of the Book, Shelf and Loan schemas (line-based YAML). */
function addExamples(text) {
  const lines = text.split('\n')
  const result = []
  let schema = null
  let inComponents = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    result.push(line)
    if (/^components:/.test(line)) inComponents = true
    if (!inComponents) continue
    const s = /^ {4}(\w+):\s*$/.exec(line)
    if (s) schema = s[1]
    const prop = /^(\s+)(\w+):\s*$/.exec(line)
    if (!prop || !SCHEMAS.has(schema)) continue
    const example = BY_SCHEMA[schema]?.[prop[2]] ?? EXAMPLES[prop[2]]
    if (example === undefined) continue
    const indent = prop[1].length
    // The property's block: following lines indented deeper.
    let j = i + 1
    while (j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent)) j++
    const block = lines.slice(i + 1, j)
    if (!block.length || block.some((l) => /^\s*(examples?|\$ref|const|allOf|oneOf):/.test(l))) continue
    if (!block.some((l) => /^\s+type:/.test(l))) continue
    result.push(...block, `${' '.repeat(indent + 2)}examples: ${example}`)
    i = j - 1
  }
  return result.join('\n')
}

for (const name of ['bookshelf.openapi.yaml', 'bookshelf-draft.openapi.yaml']) {
  let text = fs.readFileSync(path.join(src, name), 'utf8')
  for (const [a, b] of RENAMES) text = text.replaceAll(a, b)
  text = addExamples(exampleCom(text))
  fs.writeFileSync(path.join(out, name), text)
  console.log(name, (text.match(/examples:/g) ?? []).length, 'examples')
}
fs.writeFileSync(path.join(out, 'greenhouse.asyncapi.yaml'), exampleCom(fs.readFileSync(path.join(src, 'greenhouse.asyncapi.yaml'), 'utf8')))

fs.writeFileSync(
  path.join(out, 'borrow-a-book.arazzo.yaml'),
  `arazzo: 1.0.1
info:
  title: Borrow a book
  version: 1.0.0
  summary: Find a book by its author, borrow it and confirm it is out.
  description: A reader's loan from search to confirmation, against the Bookshelf API.
sourceDescriptions:
  - name: bookshelf
    url: ./bookshelf.openapi.yaml
    type: openapi
workflows:
  - workflowId: borrowBook
    summary: Borrow a book by its author
    description: Looks the book up, borrows it for the reader and reads it back.
    inputs:
      type: object
      required: [author, reader]
      properties:
        author:
          type: string
          description: Part of the author's name.
          examples: [calder]
        reader:
          type: string
          format: email
          examples: [reader@example.com]
    steps:
      - stepId: findBook
        description: Find the newest book by the author.
        operationId: listBooks
        parameters:
          - name: author
            in: query
            value: $inputs.author
          - name: limit
            in: query
            value: 1
        successCriteria:
          - condition: $statusCode == 200
        outputs:
          bookId: $response.body#/items/0/id
      - stepId: borrow
        description: Borrow it for the reader.
        operationId: borrowBook
        requestBody:
          contentType: application/json
          payload:
            bookId: $steps.findBook.outputs.bookId
            reader: $inputs.reader
        successCriteria:
          - condition: $statusCode == 201
        outputs:
          loanId: $response.body#/id
          due: $response.body#/due
      - stepId: confirm
        description: Read the book back to show it is on loan.
        operationId: getBook
        parameters:
          - name: bookId
            in: path
            value: $steps.findBook.outputs.bookId
        successCriteria:
          - condition: $statusCode == 200
    outputs:
      loanId: $steps.borrow.outputs.loanId
      due: $steps.borrow.outputs.due
`
)
console.log('written to', out, fs.readdirSync(out))
