// The page's CSS, built on the `--orca-*` theme variables so it follows Orca's light and dark
// themes; Orca updates the variables in place and toggles `light`/`dark` on <html>. Method and
// status colours have a light and a dark value each, chosen to stay readable on both.

export const css = String.raw`
:root {
  --bg: var(--orca-background, #ffffff);
  --fg: var(--orca-foreground, #0a0a0a);
  --card: var(--orca-card, #ffffff);
  --muted: var(--orca-muted, #f4f4f5);
  --muted-fg: var(--orca-muted-foreground, #6b6b73);
  --accent: var(--orca-accent, #f4f4f5);
  --accent-fg: var(--orca-accent-foreground, #18181b);
  --border: var(--orca-border, #e4e4e7);
  --input: var(--orca-input, #e4e4e7);
  --primary: var(--orca-primary, #18181b);
  --primary-fg: var(--orca-primary-foreground, #fafafa);
  --ring: var(--orca-ring, #a1a1aa);
  --destructive: var(--orca-destructive, #dc2626);
  --popover: var(--orca-popover, #ffffff);
  --popover-fg: var(--orca-popover-foreground, #0a0a0a);
  --radius: var(--orca-radius, 6px);
  --select: color-mix(in srgb, var(--fg) 8%, transparent);
  --hover: color-mix(in srgb, var(--fg) 5%, transparent);
  --code-bg: color-mix(in srgb, var(--fg) 4%, var(--bg));
  --soft-border: color-mix(in srgb, var(--border) 70%, transparent);
  --scroll-thumb: color-mix(in srgb, var(--muted-fg) 45%, transparent);
  --m-get: #1a7f37; --m-post: #0b62c4; --m-put: #9a6200; --m-patch: #7c3fd6; --m-delete: #c9252d;
  --m-query: #0e7490; --m-other: #5c636c;
  --s-1: #5c636c; --s-2: #1a7f37; --s-3: #0b62c4; --s-4: #9a6200; --s-5: #c9252d;
  --error: #c9252d; --warning: #9a6200; --info: #0b62c4;
  --tok-key: #7c3fd6; --tok-str: #1a7f37; --tok-num: #b35900; --tok-lit: #0b62c4; --tok-flag: #0e7490;
  --type: #7c3fd6;
  --ui-font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono-font: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --row: 26px;
  color-scheme: light;
}
:root.dark {
  --bg: var(--orca-background, #0b0b0d);
  --fg: var(--orca-foreground, #f4f4f5);
  --card: var(--orca-card, #111113);
  --muted: var(--orca-muted, #232327);
  --muted-fg: var(--orca-muted-foreground, #9d9da6);
  --accent: var(--orca-accent, #232327);
  --accent-fg: var(--orca-accent-foreground, #f4f4f5);
  --border: var(--orca-border, #2c2c31);
  --input: var(--orca-input, #2c2c31);
  --primary: var(--orca-primary, #f4f4f5);
  --primary-fg: var(--orca-primary-foreground, #18181b);
  --ring: var(--orca-ring, #71717a);
  --destructive: var(--orca-destructive, #f87171);
  --popover: var(--orca-popover, #18181b);
  --popover-fg: var(--orca-popover-foreground, #f4f4f5);
  --code-bg: color-mix(in srgb, var(--fg) 5%, var(--bg));
  --m-get: #4ec46a; --m-post: #5aa8ff; --m-put: #e3a43a; --m-patch: #b893ff; --m-delete: #ff7a73;
  --m-query: #3cc8dc; --m-other: #9aa1aa;
  --s-1: #9aa1aa; --s-2: #4ec46a; --s-3: #5aa8ff; --s-4: #e3a43a; --s-5: #ff7a73;
  --error: #ff7a73; --warning: #e3a43a; --info: #5aa8ff;
  --tok-key: #b893ff; --tok-str: #7fd18f; --tok-num: #f0a35e; --tok-lit: #5aa8ff; --tok-flag: #3cc8dc;
  --type: #b893ff;
  color-scheme: dark;
}
* { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) transparent; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--fg);
  font: 13px/1.5 var(--ui-font);
  overflow: hidden; -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; color: inherit; }
[hidden] { display: none !important; }
code, pre, .mono { font-family: var(--mono-font); }
mark { background: color-mix(in srgb, #f5c400 40%, transparent); color: inherit; border-radius: 2px; }
.icon { width: 15px; height: 15px; display: block; flex: none; }
:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; border-radius: 4px; }

/* Layout */
.app { display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative; }
.bar {
  display: flex; align-items: center; gap: 6px; padding: 0 10px; height: 42px; flex: none;
  border-bottom: 1px solid var(--border); background: var(--bg);
}
.bar .title { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 0 1 auto; overflow: hidden; }
.bar .title b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar .title .ver { color: var(--muted-fg); white-space: nowrap; }
.chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; height: 20px; border-radius: 10px;
  font-size: 11px; font-weight: 500; white-space: nowrap; color: var(--muted-fg);
  background: var(--muted); border: 1px solid var(--soft-border);
}
.spacer { flex: 1 1 auto; }
.tool {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; min-width: 28px; padding: 0 7px;
  border: 1px solid transparent; border-radius: var(--radius); background: transparent; cursor: pointer; color: var(--muted-fg);
  white-space: nowrap;
}
.tool:hover { background: var(--hover); color: var(--fg); }
.tool:disabled { opacity: .4; cursor: default; background: transparent; }
.tool.on { background: var(--select); color: var(--fg); }
.searchbox {
  display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px;
  /* Starts at 96px and takes the free room up to its cap, so the document's title never gives way to it. */
  flex: 100 1 96px; min-width: 96px; max-width: min(340px, 34vw);
  border: 1px solid var(--input); border-radius: var(--radius); background: var(--bg); color: var(--muted-fg); cursor: text;
}
.searchbox > span:not(.kbd) { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.kbd { flex: none; font: 11px var(--mono-font); padding: 0 5px; border: 1px solid var(--border); border-radius: 4px; color: var(--muted-fg); }
.counts { display: inline-flex; gap: 8px; align-items: center; }
.count { display: inline-flex; align-items: center; gap: 3px; }
.count.error { color: var(--error); } .count.warning { color: var(--warning); } .count.info { color: var(--info); }
.body { flex: 1 1 auto; display: flex; min-height: 0; }
.side { width: 288px; flex: none; display: flex; flex-direction: column; border-right: 1px solid var(--border); min-height: 0; background: var(--bg); }
.side.closed { display: none; }
.sidefilter { padding: 8px; border-bottom: 1px solid var(--soft-border); display: flex; gap: 4px; align-items: center; }
.input {
  flex: 1; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid var(--input); border-radius: var(--radius);
  background: var(--bg); outline: none;
}
.input:focus { border-color: var(--ring); }
.mainwrap { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.content { flex: 1 1 auto; overflow: auto; min-height: 0; scroll-padding-top: 12px; }

/* Virtual list */
.vlist { position: relative; overflow: auto; flex: 1 1 auto; min-height: 0; outline: none; }
.vlist .spacer-y { position: absolute; left: 0; top: 0; width: 1px; }
.vlist .rows { position: absolute; left: 0; right: 0; top: 0; }

/* Sidebar rows */
.nrow {
  height: var(--row); display: flex; align-items: center; gap: 6px; padding-right: 10px; cursor: pointer;
  white-space: nowrap; color: var(--fg); user-select: none; border-radius: 0;
}
.nrow:hover { background: var(--hover); }
.nrow.sel { background: var(--select); }
.nrow.focus { box-shadow: inset 2px 0 0 var(--ring); }
.nrow .chev { width: 14px; height: 14px; color: var(--muted-fg); flex: none; transition: transform .12s; }
.nrow .chev.open { transform: rotate(90deg); }
.nrow .chev.none { visibility: hidden; }
.nrow .lbl { overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
/* Label and detail: the detail gets the room left, but never less than 5em; with less it wraps to
   the second line, which the row-high box clips. */
.nrow .txt {
  display: flex; flex-wrap: wrap; align-content: flex-start; column-gap: 6px; flex: 1 1 0; min-width: 0;
  height: var(--row); overflow: hidden;
}
.nrow .txt > span { line-height: var(--row); white-space: nowrap; }
.nrow .det { color: var(--muted-fg); overflow: hidden; text-overflow: ellipsis; flex: 1 1 0; min-width: 5em; font-size: 12px; }
.nrow .cnt { color: var(--muted-fg); font-size: 11px; flex: none; }
.nrow.section { font-weight: 600; font-size: 11.5px; letter-spacing: .02em; text-transform: uppercase; color: var(--muted-fg); }
.nrow.section .lbl { color: var(--muted-fg); }
.nrow.group .lbl { font-weight: 500; }
.nrow.dep .lbl { text-decoration: line-through; color: var(--muted-fg); }
.nrow.mono .lbl { font-family: var(--mono-font); font-size: 12px; }
.empty-note { padding: 14px 12px; color: var(--muted-fg); }

/* Method and status badges */
.m {
  --c: var(--m-other);
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  font: 700 10px/1 var(--mono-font); letter-spacing: .03em; text-transform: uppercase;
  color: var(--c); background: color-mix(in srgb, var(--c) 13%, transparent);
  border-radius: 4px; height: 18px; padding: 0 5px; min-width: 44px;
}
.m.lg { font-size: 12px; height: 24px; min-width: 58px; padding: 0 8px; border-radius: 5px; }
.m-get { --c: var(--m-get); } .m-post { --c: var(--m-post); } .m-put { --c: var(--m-put); }
.m-patch { --c: var(--m-patch); } .m-delete { --c: var(--m-delete); } .m-query { --c: var(--m-query); }
.m-send, .m-subscribe { --c: var(--m-post); } .m-receive, .m-publish { --c: var(--m-get); }
.m-update { --c: var(--m-put); } .m-remove { --c: var(--m-delete); } .m-copy { --c: var(--m-post); }
.st { --c: var(--s-1); font: 600 12px/1 var(--mono-font); color: var(--c); display: inline-flex; align-items: center; gap: 6px; }
.st::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
.st-2 { --c: var(--s-2); } .st-3 { --c: var(--s-3); } .st-4 { --c: var(--s-4); } .st-5 { --c: var(--s-5); }

/* Pages */
.page { max-width: 1320px; margin: 0 auto; padding: 22px 28px 64px; }
.page.wide { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 440px); gap: 28px; align-items: start; }
.page.wide .aside { position: sticky; top: 14px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
@media (max-width: 1100px) { .page.wide { display: block; } .page.wide .aside { position: static; margin-top: 22px; } }
/* Narrow: the Problems button keeps its icon (and counts), so the document's title keeps its room. */
@media (max-width: 720px) {
  .page { padding: 16px 16px 48px; } .side { width: 230px; } .searchbox { max-width: none; }
  .bar .title .ver { display: none; } .bar .tlabel { display: none; }
}
.crumbs { color: var(--muted-fg); font-size: 12px; margin-bottom: 6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.crumbs a { cursor: pointer; } .crumbs a:hover { color: var(--fg); text-decoration: underline; }
h1.h { font-size: 22px; line-height: 1.3; margin: 0 0 8px; font-weight: 650; letter-spacing: -.01em; overflow-wrap: anywhere; }
h2.h { font-size: 15px; margin: 30px 0 10px; font-weight: 650; display: flex; align-items: center; gap: 8px; }
h3.h { font-size: 13px; margin: 18px 0 8px; font-weight: 600; color: var(--fg); display: flex; align-items: center; gap: 8px; }
.sub { color: var(--muted-fg); }
.oprow { display: flex; align-items: center; gap: 10px; margin: 4px 0 10px; flex-wrap: wrap; }
.route { font: 500 14px/1.4 var(--mono-font); overflow-wrap: anywhere; }
.route .param { color: var(--m-post); }
.meta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted-fg); font-size: 12px; align-items: center; margin: 4px 0 12px; }
.meta .mono { color: var(--fg); }
.banner {
  display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radius); margin: 10px 0;
  border: 1px solid color-mix(in srgb, var(--c, var(--warning)) 35%, transparent);
  background: color-mix(in srgb, var(--c, var(--warning)) 9%, transparent);
}
.banner.error { --c: var(--error); } .banner.info { --c: var(--info); } .banner.plain { --c: var(--muted-fg); }
.banner .icon { color: var(--c, var(--warning)); margin-top: 2px; }
.banner > div { min-width: 0; }
.tagchip { cursor: pointer; } .tagchip:hover { color: var(--fg); border-color: var(--ring); }
.dep-chip { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 40%, transparent); background: color-mix(in srgb, var(--warning) 10%, transparent); }
.req { color: var(--error); font-size: 11px; font-weight: 500; }
.flag { font-size: 11px; color: var(--muted-fg); border: 1px solid var(--soft-border); border-radius: 4px; padding: 0 4px; }
.link { color: var(--m-post); cursor: pointer; text-decoration: none; }
.link:hover { text-decoration: underline; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.card { border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); padding: 12px 14px; background: var(--card); min-width: 0; }
.card.click { cursor: pointer; } .card.click:hover { border-color: var(--ring); }
.card .k { color: var(--muted-fg); font-size: 11.5px; margin-bottom: 2px; }
.card .v { overflow-wrap: anywhere; }
.box { border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); background: var(--card); overflow: hidden; }
.box + .box { margin-top: 10px; }
.notices { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.page.wide > .notices { grid-column: 1 / -1; }
.cards > .box { margin: 0; align-self: start; }
.boxhead { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--soft-border); flex-wrap: wrap; min-height: 38px; }
.boxhead .grow { flex: 1 1 auto; }
.boxtabs { display: flex; padding: 6px 10px; border-bottom: 1px solid var(--soft-border); overflow-x: auto; }
.boxtabs:empty { display: none; }
.boxtabs .tabs { flex-wrap: nowrap; }
.boxbody { padding: 10px 12px; }
.boxbody > .md:first-child > :first-child { margin-top: 0; }
.list { display: flex; flex-direction: column; }
.lrow { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-top: 1px solid var(--soft-border); cursor: pointer; min-width: 0; }
.lrow:first-child { border-top: 0; }
.lrow:hover { background: var(--hover); }
.lrow .route { font-size: 12.5px; }
.lrow .grow { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lrow .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tabs { display: flex; gap: 2px; flex-wrap: wrap; }
.tab {
  border: 1px solid transparent; background: transparent; border-radius: 5px; padding: 2px 8px; cursor: pointer;
  color: var(--muted-fg); font-size: 12px; white-space: nowrap;
}
.tab:hover { color: var(--fg); background: var(--hover); }
.tab.on { color: var(--fg); background: var(--select); border-color: var(--soft-border); }
.tab.mono { font-family: var(--mono-font); }

/* Tables of parameters, headers, variables */
.ptable { width: 100%; border-collapse: collapse; }
.ptable td { padding: 9px 12px; border-top: 1px solid var(--soft-border); vertical-align: top; }
.ptable tr:first-child td { border-top: 0; }
.ptable td.name { width: 32%; min-width: 140px; }
.pname { font: 600 12.5px var(--mono-font); overflow-wrap: anywhere; }
.scopes .pname { overflow-wrap: break-word; }
.ptype { font: 12px var(--mono-font); color: var(--type); }
.pflags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 3px; align-items: center; }
.pdesc > .md > :first-child { margin-top: 0; } .pdesc > .md > :last-child { margin-bottom: 0; }
.kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 14px; font-size: 12.5px; }
.kv > .k { color: var(--muted-fg); }
.kv > .v { overflow-wrap: anywhere; min-width: 0; }

/* Schema tree */
.tree { font-size: 12.5px; }
.tnode { position: relative; }
.trow { display: flex; align-items: flex-start; gap: 6px; padding: 5px 12px 5px 0; border-top: 1px solid var(--soft-border); }
.tree > .tnode:first-child > .trow { border-top: 0; }
.trow .tchev { width: 16px; height: 18px; display: flex; align-items: center; justify-content: center; flex: none; cursor: pointer; color: var(--muted-fg); border-radius: 3px; }
.trow .tchev:hover { background: var(--hover); color: var(--fg); }
.trow .tchev .icon { width: 13px; height: 13px; transition: transform .12s; }
.trow .tchev.open .icon { transform: rotate(90deg); }
.trow .tchev.none { visibility: hidden; cursor: default; }
.tmain { flex: 1 1 auto; min-width: 0; }
.thead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.tname { font: 600 12.5px var(--mono-font); overflow-wrap: anywhere; }
.tname.role { font-family: var(--ui-font); font-weight: 600; color: var(--muted-fg); font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; }
.ttype { font: 12px var(--mono-font); color: var(--type); }
.tref { font: 12px var(--mono-font); color: var(--m-post); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.tref .icon { width: 13px; height: 13px; }
.tref:hover { text-decoration: underline; }
.tcons { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.cons { font: 11px var(--mono-font); color: var(--muted-fg); background: var(--muted); border-radius: 4px; padding: 0 5px; }
.tdesc { color: var(--fg); margin-top: 2px; }
.tdesc > .md > :first-child { margin-top: 0; } .tdesc > .md > :last-child { margin-bottom: 0; }
.tvals { margin-top: 3px; font-size: 12px; color: var(--muted-fg); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.tvals code { color: var(--tok-str); background: var(--muted); padding: 0 4px; border-radius: 3px; font-size: 11.5px; }
.tkids { margin-left: 8px; padding-left: 14px; border-left: 1px solid var(--soft-border); }
.tmore { padding: 6px 0 6px 22px; }
.ttools { display: flex; gap: 4px; }
.textra { margin-top: 4px; }

/* Code */
.code {
  position: relative; margin: 0; padding: 10px 12px; background: var(--code-bg); border-radius: var(--radius);
  font: 12px/1.55 var(--mono-font); overflow: auto; max-height: 520px; white-space: pre; tab-size: 2;
}
.box .code { border-radius: 0; max-height: 460px; }
.code .k { color: var(--tok-key); } .code .s { color: var(--tok-str); } .code .n { color: var(--tok-num); }
.code .l { color: var(--tok-lit); } .code .f { color: var(--tok-flag); } .code .c { color: var(--muted-fg); }
.copybtn { margin-left: auto; }
.note { color: var(--muted-fg); font-size: 12px; padding: 8px 12px; border-top: 1px solid var(--soft-border); display: flex; gap: 8px; align-items: flex-start; }
.note .icon { margin-top: 2px; }

/* Markdown */
.md { overflow-wrap: anywhere; }
.md p { margin: 0 0 8px; } .md > :last-child { margin-bottom: 0; }
.md ul, .md ol { margin: 0 0 8px; padding-left: 22px; }
.md li { margin: 2px 0; }
.md code { font-size: 12px; background: var(--muted); padding: 1px 4px; border-radius: 4px; }
.md .md-pre { background: var(--code-bg); padding: 10px 12px; border-radius: var(--radius); overflow: auto; font-size: 12px; margin: 0 0 8px; }
.md .md-pre code { background: none; padding: 0; }
.md blockquote { margin: 0 0 8px; padding: 2px 12px; border-left: 3px solid var(--border); color: var(--muted-fg); }
.md hr { border: 0; border-top: 1px solid var(--border); margin: 12px 0; }
.md .md-h { font-weight: 650; margin: 14px 0 6px; } .md .md-h1 { font-size: 17px; } .md .md-h2 { font-size: 15px; } .md .md-h3 { font-size: 14px; }
.md .md-table-wrap { overflow: auto; margin: 0 0 8px; }
.md table { border-collapse: collapse; font-size: 12.5px; }
.md th, .md td { border: 1px solid var(--border); padding: 4px 8px; }
.md th { background: var(--muted); font-weight: 600; }
.md .md-link { color: var(--m-post); cursor: pointer; text-decoration: none; }
.md .md-link:hover { text-decoration: underline; }
.md .md-link-text { text-decoration: underline dotted; }
.md .md-image { font-style: italic; }
.lead { font-size: 13.5px; }

/* Problems panel */
.panel { flex: none; height: 36%; min-height: 120px; border-top: 1px solid var(--border); display: flex; flex-direction: column; background: var(--bg); }
.panelhead { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--soft-border); flex-wrap: wrap; }
.panelhead b { font-weight: 600; }
.sevbtn { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 7px; border-radius: 5px; border: 1px solid var(--soft-border); background: transparent; cursor: pointer; color: var(--muted-fg); font-size: 12px; }
.sevbtn.on { background: var(--select); color: var(--fg); }
.sevbtn.error .icon { color: var(--error); } .sevbtn.warning .icon { color: var(--warning); } .sevbtn.info .icon { color: var(--info); }
.prow { height: 28px; display: flex; align-items: center; gap: 8px; padding: 0 12px; cursor: pointer; white-space: nowrap; }
.prow:hover { background: var(--hover); }
.prow.sel { background: var(--select); }
.prow .icon.error { color: var(--error); } .prow .icon.warning { color: var(--warning); } .prow .icon.info { color: var(--info); }
.prow .msg { overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.prow .ptr { color: var(--muted-fg); font: 11.5px var(--mono-font); overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 0; }
.prow .ln { color: var(--muted-fg); font: 11.5px var(--mono-font); flex: none; cursor: pointer; }
.prow .ln:hover { color: var(--fg); text-decoration: underline; }

/* Source view */
.srcwrap { display: flex; flex-direction: column; height: 100%; }
.srchead { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--soft-border); }
.srclist .rows { right: auto; min-width: 100%; font: 12px/20px var(--mono-font); }
.srcline { --tint: transparent; height: 20px; display: flex; font: 12px/20px var(--mono-font); white-space: pre; tab-size: 8; background: var(--tint); }
.srcline .no, .srcline .mk { position: sticky; z-index: 1; background: linear-gradient(var(--tint), var(--tint)), var(--bg); }
.srcline .no { left: 16px; width: 64px; flex: none; text-align: right; padding-right: 12px; color: var(--muted-fg); user-select: none; }
.srcline .tx { flex: none; padding-right: 12px; }
.srcline .tx .cut { color: var(--muted-fg); font-style: italic; user-select: none; }
.srcline .tx .col { outline: 1.5px solid var(--m-post); outline-offset: -1px; border-radius: 2px; background: color-mix(in srgb, var(--m-post) 22%, transparent); }
.srcline.flag-line { --tint: color-mix(in srgb, var(--warning) 14%, transparent); }
.srcline.flag-line.error { --tint: color-mix(in srgb, var(--error) 14%, transparent); }
.srcline.cur { --tint: color-mix(in srgb, var(--m-post) 10%, transparent); }
.srcline.cur .mk { box-shadow: inset 3px 0 0 var(--m-post); }
.srcline .mk { left: 0; width: 16px; flex: none; display: flex; align-items: center; justify-content: center; }
.srcline .mk .icon { width: 12px; height: 12px; }
.srcline .mk .icon.error { color: var(--error); } .srcline .mk .icon.warning { color: var(--warning); } .srcline .mk .icon.info { color: var(--info); }

/* Search overlay */
.overlay { position: absolute; inset: 0; background: color-mix(in srgb, #000 28%, transparent); display: flex; justify-content: center; align-items: flex-start; padding-top: 8vh; z-index: 20; }
.palette {
  width: min(680px, calc(100% - 32px)); max-height: 76vh; display: flex; flex-direction: column; background: var(--popover); color: var(--popover-fg);
  border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.28); overflow: hidden;
}
.palette .qrow { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.palette .qrow input { flex: 1; border: 0; outline: none; background: transparent; font-size: 15px; }
.palette .hits { overflow: auto; flex: 1 1 auto; }
.palette input::-webkit-search-cancel-button { display: none; }
input[type=search]::-webkit-search-cancel-button { filter: grayscale(1); opacity: .6; }
.hits .hit { display: flex; gap: 10px; padding: 8px 12px; cursor: pointer; align-items: flex-start; }
.hits .hit.sel { background: var(--select); }
.hits .hit .hm { flex: none; padding-top: 1px; }
.hits .hit .hm .chip { min-width: 44px; justify-content: center; height: 18px; font-size: 10px; }
.hits .hit .hb { min-width: 0; flex: 1; }
.hits .hit .ht { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hits .hit .hd { color: var(--muted-fg); font: 12px var(--mono-font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hits .hit .hs { color: var(--muted-fg); font-size: 12px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.palette .pfoot { padding: 6px 12px; border-top: 1px solid var(--border); color: var(--muted-fg); font-size: 11.5px; display: flex; justify-content: space-between; gap: 8px; }

/* States */
.center { height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
.state { max-width: 560px; text-align: center; color: var(--muted-fg); }
.state h1 { color: var(--fg); font-size: 18px; margin: 10px 0 6px; font-weight: 600; }
.state .big { width: 40px; height: 40px; margin: 0 auto; color: var(--muted-fg); display: flex; align-items: center; justify-content: center; }
.state .big .icon { width: 36px; height: 36px; stroke-width: 1.5; }
.spinner { width: 22px; height: 22px; border: 2px solid var(--border); border-top-color: var(--fg); border-radius: 50%; animation: spin .8s linear infinite; margin: 0 auto 12px; }
@keyframes spin { to { transform: rotate(360deg); } }
.toast {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%) translateY(10px); opacity: 0; pointer-events: none;
  background: var(--popover); color: var(--popover-fg); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,.18); transition: opacity .15s, transform .15s; z-index: 30;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.dropzone { position: absolute; inset: 8px; border: 2px dashed var(--ring); border-radius: 12px; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--bg) 85%, transparent); z-index: 25; font-size: 15px; }
.flash { animation: flash 1.2s ease-out; }
@keyframes flash { from { background: color-mix(in srgb, var(--m-post) 18%, transparent); } to { background: transparent; } }
`

export function installStyles(): void {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
}
