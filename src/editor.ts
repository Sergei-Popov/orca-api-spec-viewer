// The custom editor: Orca opens an API description here (by default for `openapi.yaml`,
// `*.openapi.json` and the like, and on request for any YAML or JSON file) and sends its text.
// The viewer never edits the file, so Orca never saves the tab. An outside change of the file
// redraws in place and keeps the page, scroll position and open parts.

import { stringsFor } from './i18n'
import { App } from './ui/app'
import { installStyles } from './ui/styles'

const locale = globalThis.orca?.locale || navigator.language || 'en'
const strings = stringsFor(locale)
document.documentElement.lang = locale.toLowerCase().startsWith('ru') ? 'ru' : 'en'
installStyles()
const shell = globalThis.orca?.shell
const app = new App({ locale, openExternal: shell ? (url) => shell.openExternal(url) : undefined }, strings)
document.body.append(app.root)
app.showLoading()

const api = globalThis.orca?.document
if (!api) {
  app.showMessage(strings.appName, strings.noHost)
} else {
  let generation = 0
  let loaded = false
  api.onDidChange(async (doc) => {
    const current = ++generation
    if (doc.content.kind !== 'text') {
      app.showMessage(strings.appName, strings.bytesContent)
      return
    }
    const text = doc.content.text
    if (!loaded) {
      if (text.length > 1024 * 1024) {
        app.showLoading(text.length)
        // Let the spinner paint before a large file is parsed on this thread.
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      }
    } else {
      // Typing in another tab sends a document per change: wait for a pause.
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    if (current !== generation) return
    try {
      app.load(text)
      loaded = true
    } catch (error) {
      console.error('[api-spec-viewer] cannot show the file', error)
      app.showMessage(strings.unreadableTitle, error instanceof Error ? error.message : String(error))
    }
  })
}
