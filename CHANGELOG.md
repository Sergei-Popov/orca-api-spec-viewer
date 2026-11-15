# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). `scripts/release-plugin.sh` in the hub turns
`[Unreleased]` into the released version.

## [Unreleased]

### Added

- An API reference view for OpenAPI 3.0, 3.1 and 3.2, Swagger 2.0, AsyncAPI 2.x and 3.x,
  Arazzo 1.0 and Overlay 1.0 documents in YAML, JSON and JSON with comments.
- Opens `openapi`, `swagger`, `asyncapi` and `arazzo` `.yaml`/`.yml`/`.json` files and the
  `.openapi.*`, `.swagger.*`, `.oas.*`, `.oas3.*`, `.asyncapi.*`, `.arazzo.*` and `.overlay.*`
  suffixes by default, and is offered in the view toggle of every other YAML and JSON file.
- A page for files that are not API descriptions, saying what they look like instead.
- Overview, sidebar by tag with method badges, filter, back and forward, and full search
  (⌘F / Ctrl+F).
- Operation pages with parameters, request bodies, responses, headers, links, callbacks,
  security and server overrides.
- A schema tree with constraints, `allOf` merging, `oneOf`/`anyOf` tabs with the discriminator
  mapping, and recursion shown as links.
- Given and generated examples, and offline code samples for curl, `fetch`, Python `requests`
  and HTTPie with copy buttons. Parameters are written as their `style`, `explode` or
  `collectionFormat` says, OpenAPI 3.2 `querystring` parameters as their media type says, and
  urlencoded and multipart bodies as their Encoding Object says. Values are quoted for the shell
  and never read local files; a method that is not a valid HTTP method name gets no samples, and
  values a shell command cannot carry safely (NUL, carriage return) leave out the curl and HTTPie
  samples. GET and HEAD keep their method with a body. Whatever a client cannot send as written
  is left out of that sample with a note saying so.
- Component pages list where each component is used.
- Lazy `$ref` and `$dynamicRef` resolution as JSON Schema 2020-12 says (`$id` and `$anchor` by
  URI against OpenAPI 3.2's `$self`, `$dynamicRef` in its dynamic scope, and from OpenAPI 3.1 on
  a reference's siblings applied), with cycle detection and a report for chains longer than 128
  references; external references shown as such, and other files can be added by hand for the
  session. References inside `x-` extensions and AsyncAPI bindings count as uses.
- AsyncAPI traits merged into messages and operations, security schemes written inline shown as
  cards, and replies without messages showing their channel's; payloads in a `schemaFormat` that
  is not JSON Schema (Avro, Protobuf, RAML…) shown as source; webhooks listed by name with their
  summary beside it, and OpenAPI 3.0 `x-webhooks` shown as webhooks; OpenAPI 3.2 `itemSchema`
  labelled per item.
- A problems panel with structural checks per version and lint rules, each with its line,
  column and JSON pointer, and a source view that marks them, scrolls sideways and says how much
  of a long line it leaves out.
- Files with YAML or JSON errors still show what could be read, with a banner that points at
  the first error.
- YAML anchors and aliases resolved once, with a warning for an alias inside its own node and an
  error past a million values; the first document of a multi-document YAML file, with a note.
- Search that lists the best 200 matches and counts all of them.
- Live redraw on changes that keeps the page, scroll position and open parts.
- English and Russian interface, light and dark themes, plugin and tab icons.
