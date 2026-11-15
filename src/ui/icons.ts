// Static SVG icons (24×24 strokes), drawn for this plugin. Only these strings are parsed as markup.

const icon = (body: string) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
  chevron: icon('<path d="m9 6 6 6-6 6"/>'),
  sidebar: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  back: icon('<path d="m15 18-6-6 6-6"/>'),
  forward: icon('<path d="m9 18 6-6-6-6"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  error: icon('<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>'),
  warning: icon('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>'),
  info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  ok: icon('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  code: icon('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 6l-2 12"/>'),
  copy: icon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  close: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  file: icon('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>'),
  upload: icon('<path d="M12 15V4M7 9l5-5 5 5"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>'),
  link: icon('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
  external: icon('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  lock: icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  server: icon('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
  loop: icon('<path d="M17 2l4 4-4 4"/><path d="M3 12V10a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 12v2a4 4 0 0 1-4 4H3"/>'),
  doc: icon('<path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z"/><path d="M8 13h8M8 17h5M8 9h3"/>'),
  braces: icon('<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>'),
  expand: icon('<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>'),
  collapse: icon('<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>'),
  list: icon('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>')
}
