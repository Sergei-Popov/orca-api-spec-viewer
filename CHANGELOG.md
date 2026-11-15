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
  and HTTPie with copy buttons.
- Lazy `$ref` and `$dynamicRef` resolution with cycle detection; external references shown as
  such, and other files can be added by hand for the session.
- A problems panel with structural checks per version and lint rules, each with its line,
  column and JSON pointer, and a source view that marks them.
- Live redraw on changes that keeps the page, scroll position and open parts.
- English and Russian interface, light and dark themes, plugin and tab icons.
