import { assert, test } from 'orca/testing'
import { format, stringsFor } from '../i18n'
import { editsText, isHistoryArrow, searchKey, type KeyLike } from './keys'
import { css } from './styles'

const key = (k: string, target: unknown, extra: Partial<KeyLike> = {}): KeyLike => ({ key: k, altKey: true, shiftKey: false, target, ...extra })
const input = (type = 'text') => ({ tagName: 'INPUT', type })

test('Alt+Left and Alt+Right go back and forward, except in a text field', () => {
  // Before: Option+← in the search box or the sidebar filter left the page instead of moving the caret.
  assert.equal(isHistoryArrow(key('ArrowLeft', { tagName: 'DIV' }), false), true)
  assert.equal(isHistoryArrow(key('ArrowRight', { tagName: 'BODY' }), false), true)
  assert.equal(isHistoryArrow(key('ArrowLeft', input('search')), false), false)
  assert.equal(isHistoryArrow(key('ArrowLeft', input()), false), false)
  assert.equal(isHistoryArrow(key('ArrowRight', { tagName: 'TEXTAREA' }), false), false)
  assert.equal(isHistoryArrow(key('ArrowLeft', { tagName: 'DIV', isContentEditable: true }), false), false)
  // A checkbox or a button does not edit text.
  assert.equal(isHistoryArrow(key('ArrowLeft', input('checkbox')), false), true)
  // Shift+Alt selects by word; with ⌘ or Ctrl it is another shortcut.
  assert.equal(isHistoryArrow(key('ArrowLeft', { tagName: 'DIV' }, { shiftKey: true }), false), false)
  assert.equal(isHistoryArrow(key('ArrowLeft', { tagName: 'DIV' }), true), false)
  assert.equal(isHistoryArrow(key('ArrowUp', { tagName: 'DIV' }), false), false)
  assert.equal(isHistoryArrow(key('ArrowLeft', { tagName: 'DIV' }, { altKey: false }), false), false)
  assert.equal(editsText(null), false)
  assert.equal(editsText(input('email')), true)
})

test('the search hints name the shortcut of the platform', () => {
  // Before: the hints said ⌘F on Windows and Linux too, where the shortcut is Ctrl+F.
  assert.equal(searchKey(true), '⌘F')
  assert.equal(searchKey(false), 'Ctrl+F')
  const en = stringsFor('en')
  const ru = stringsFor('ru')
  assert.equal(format(en.searchHint, { key: searchKey(false) }), 'Search (Ctrl+F)')
  assert.equal(format(en.filterHint, { key: searchKey(false) }), 'Filter the list (Ctrl+F searches everything)')
  assert.equal(format(ru.searchHint, { key: searchKey(true) }), 'Поиск (⌘F)')
  assert.equal(format(ru.filterHint, { key: searchKey(false) }), 'Отфильтровать список (Ctrl+F — поиск по всему)')
  for (const t of [en, ru]) for (const hint of [t.searchHint, t.filterHint]) assert.ok(!hint.includes('⌘'), hint)
})

test('the note on problems left out uses plural forms and the locale’s digits', () => {
  // Before: "1 more problems are not listed." and "Ещё 4354 проблем не показаны."
  const en = stringsFor('en')
  const ru = stringsFor('ru')
  assert.equal(en.moreProblems(1), '1 more problem is not listed.')
  assert.equal(en.moreProblems(4354), '4,354 more problems are not listed.')
  assert.equal(ru.moreProblems(1), 'Ещё 1 проблема не показана.')
  assert.equal(ru.moreProblems(21), 'Ещё 21 проблема не показана.')
  assert.equal(ru.moreProblems(4354), `Ещё ${(4354).toLocaleString('ru')} проблемы не показаны.`)
  assert.equal(ru.moreProblems(5), 'Ещё 5 проблем не показаны.')
  assert.equal(ru.moreProblems(12), 'Ещё 12 проблем не показаны.')
  assert.equal(ru.errors(22), '22 ошибки')
  assert.equal(ru.errors(111), '111 ошибок')
  assert.equal(en.errors(1), '1 error')
})

test('the recursive link keeps its icon on the line with its name', () => {
  // Before: `.icon` is display: block, so inside the inline `.tref` the loop icon took a line of its own.
  const rule = (selector: string) => css.match(new RegExp(`^${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? ''
  assert.match(rule('.tref'), /display: inline-flex/)
  assert.match(rule('.tref'), /align-items: center/)
  assert.match(rule('.tref .icon'), /width: 13px; height: 13px/)
})

test('a sidebar detail with no room for a few letters is hidden, not cut to one', () => {
  // Before: `.det` had min-width 0, so "Receive sensor readings" left room for "g." of its channel.
  // Now label and detail share a wrapping, row-high box; a detail under 5em wraps out of sight.
  const rule = (selector: string) => css.match(new RegExp(`^${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? ''
  const box = rule('.nrow .txt')
  assert.match(box, /flex-wrap: wrap/)
  assert.match(box, /height: var\(--row\)/)
  assert.match(box, /overflow: hidden/)
  assert.match(rule('.nrow .txt > span'), /line-height: var\(--row\)/)
  assert.match(rule('.nrow .det'), /min-width: 5em/)
})

test('in the narrow layout the Problems button drops its word, so the title keeps its room', () => {
  // Before: at 550 px the search box and "Problems" squeezed "Bookshelf API" to "Bookshe…".
  const narrow = css.match(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(narrow, /\.bar \.tlabel \{ display: none; \}/)
  assert.match(narrow, /\.bar \.title \.ver \{ display: none; \}/)
  // The search box starts at its minimum and only grows into free room, so it never squeezes the title.
  const rule = (selector: string) => css.match(new RegExp(`^${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? ''
  assert.match(rule('.searchbox'), /flex: 100 1 96px; min-width: 96px; max-width: min\(340px, 34vw\)/)
  assert.ok(!/(^|[^-])width:/.test(rule('.searchbox')), 'no fixed width')
})
