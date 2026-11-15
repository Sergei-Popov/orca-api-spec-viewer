# Vendored libraries

Plugin frames load no npm packages and have no network, so the one library API Spec Viewer uses
is copied here as a readable, unminified ES module. Its code is not patched.

| File            | Library                                    | Version | Licence |
| --------------- | ------------------------------------------ | ------- | ------- |
| `yaml/yaml.mjs` | [yaml](https://github.com/eemeli/yaml)     | 2.9.1   | ISC     |

## yaml

- **Why:** parsing YAML 1.2 specifications with anchors, aliases and merge keys, with the
  source range of every node, so each problem and each "Show in source" points at its line.
  JSON and JSONC are parsed by the plugin's own code (`src/parse/json.ts`).
- **Source:** the npm package `yaml@2.9.1` (its `browser/dist` ES modules), bundled into one file
  by esbuild 0.25.12 without minification. The file keeps the original code and a
  `// node_modules/yaml/browser/dist/…` comment above each source module. Only the exports below
  are kept: `parseDocument`, `isAlias`, `isMap`, `isScalar` and `isSeq`.
- **One fix-up after bundling:** esbuild prints the three control characters of yaml's
  `parse/cst.js` (`DOCUMENT = '\x02'`, `FLOW_END = '\x18'`, `SCALAR = '\x1f'`) as raw bytes, which
  would make the file count as binary. The last rebuild step writes them back as the `\xNN`
  escapes of the upstream source; the values do not change.
- **SHA-256 of `yaml.mjs`:** `4b296db9f60e45f89def538fe35ba60197855e65d7f184c28934f49224493aac`
- **Licence:** `yaml/LICENSE` (ISC, Copyright Eemeli Aro), from the same package.
- **Types:** `yaml/yaml.d.mts` declares only what API Spec Viewer uses.
- The library has no `eval`, `new Function`, network or storage access.

Rebuild (and check the hash):

```sh
mkdir vendor-build && cd vendor-build
npm init -y
npm install esbuild@0.25.12 yaml@2.9.1
echo "export { parseDocument, isAlias, isMap, isScalar, isSeq } from 'yaml'" > yaml-entry.js
npx esbuild yaml-entry.js --bundle --format=esm --platform=browser --outfile=yaml.mjs
node -e "const fs = require('fs'); fs.writeFileSync('yaml.mjs', fs.readFileSync('yaml.mjs', 'utf8')
  .replace(/[\x01-\x08\x0b\x0e-\x1f\x7f]/g, (c) => '\\\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')))"
shasum -a 256 yaml.mjs
cp yaml.mjs ../vendor/yaml/yaml.mjs
cp node_modules/yaml/LICENSE ../vendor/yaml/LICENSE
```
