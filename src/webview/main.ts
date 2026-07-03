import './styles.css';
import hljs from 'highlight.js/lib/core';

import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

for (const [name, lang] of Object.entries({
  bash, c, cpp, csharp, css, go, ini, java, javascript, json, kotlin, markdown,
  php, powershell, python, ruby, rust, scss, sql, swift, typescript, xml, yaml,
})) {
  hljs.registerLanguage(name, lang);
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
const vscode = acquireVsCodeApi();

// ------------------------------------------------------------------- types

type CharRange = [number, number];
interface DiffRow {
  t: 'ctx' | 'add' | 'del' | 'mod';
  ln?: number;
  rn?: number;
  l?: string;
  r?: string;
  lh?: CharRange[];
  rh?: CharRange[];
  mv?: number;
}
interface SessionFile {
  path: string;
  status: string;
}
interface SessionMsg {
  title: string;
  files: SessionFile[];
  options: { ignoreWhitespace: boolean; swapped: boolean };
  contextLines: number;
}
interface ModelMsg {
  index: number;
  leftName: string;
  rightName: string;
  leftLabel: string;
  rightLabel: string;
  options: { ignoreWhitespace: boolean; swapped: boolean };
  rows?: DiffRow[];
  added?: number;
  removed?: number;
  note?: string;
}
type DisplayItem =
  | { kind: 'row'; row: DiffRow }
  | { kind: 'fold'; key: number; count: number };

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyw: 'python',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  json: 'json', jsonc: 'json',
  yml: 'yaml', yaml: 'yaml',
  xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml',
  css: 'css',
  scss: 'scss', sass: 'scss',
  md: 'markdown', markdown: 'markdown',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  ps1: 'powershell', psm1: 'powershell',
  sql: 'sql',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  ini: 'ini', toml: 'ini', cfg: 'ini', conf: 'ini',
};

// ------------------------------------------------------------------- state

const ROW_H = 20;
const OVERSCAN = 15;
const TAB_SIZE = 4;

const state = {
  session: null as SessionMsg | null,
  current: 0,
  model: null as ModelMsg | null,
  loading: true,
  stats: new Map<number, { added: number; removed: number }>(),
  mode: 'split' as 'split' | 'inline',
  expanded: new Set<number>(),
  allExpanded: false,
  filter: '',
  flash: null as { from: number; to: number } | null,
  aiOpen: false,
  aiKind: '',
  aiText: '',
  aiStreaming: false,
  aiError: '',
};

let displayList: DisplayItem[] = [];
let changeBlocks: number[] = []; // display indices where a change run starts
let currentBlock = -1;
let lang: string | undefined;
let charW = 8;
let gutterW = 56;
let codeW = 400;
let rowHtmlCache = new Map<number, HTMLElement>();

// ------------------------------------------------------------ DOM skeleton

const app = document.getElementById('app')!;
app.innerHTML = '';
const headerEl = el('header', 'header');
const bodyEl = el('div', 'body');
const sidebarEl = el('aside', 'sidebar');
const contentEl = el('div', 'content');
const scrollerEl = el('div', 'scroller');
const spacerEl = el('div', 'spacer');
const rowsLayerEl = el('div', 'rows-layer');
const noteEl = el('div', 'note');
const minimapEl = el('div', 'minimap');
const minimapCanvas = document.createElement('canvas');
const minimapView = el('div', 'minimap-view');
const drawerEl = el('aside', 'ai-drawer');

spacerEl.appendChild(rowsLayerEl);
scrollerEl.appendChild(spacerEl);
scrollerEl.appendChild(noteEl);
minimapEl.appendChild(minimapCanvas);
minimapEl.appendChild(minimapView);
contentEl.appendChild(scrollerEl);
contentEl.appendChild(minimapEl);
bodyEl.appendChild(sidebarEl);
bodyEl.appendChild(contentEl);
bodyEl.appendChild(drawerEl);
app.appendChild(headerEl);
app.appendChild(bodyEl);

let scrollQueued = false;
scrollerEl.addEventListener('scroll', () => {
  if (!scrollQueued) {
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      updateWindow();
      updateMinimapView();
    });
  }
});
new ResizeObserver(() => {
  updateWindow();
  drawMinimap();
}).observe(scrollerEl);

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    return;
  }
  if (e.key === 'n' || e.key === 'j' || (e.altKey && e.key === 'ArrowDown')) {
    e.preventDefault();
    gotoBlock(currentBlock + 1);
  } else if (e.key === 'p' || e.key === 'k' || (e.altKey && e.key === 'ArrowUp')) {
    e.preventDefault();
    gotoBlock(currentBlock - 1);
  }
});

// -------------------------------------------------------------- messaging

window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'session': {
      state.session = msg as SessionMsg;
      state.current = 0;
      state.model = null;
      state.stats.clear();
      state.expanded = new Set();
      state.allExpanded = false;
      state.filter = '';
      state.loading = true;
      renderHeader();
      renderSidebar();
      openFile(0);
      break;
    }
    case 'model': {
      const model = msg as ModelMsg;
      state.model = model;
      state.loading = false;
      if (state.session) {
        state.session.options = model.options;
      }
      if (model.added !== undefined) {
        state.stats.set(model.index, { added: model.added, removed: model.removed ?? 0 });
      }
      state.expanded = new Set();
      state.flash = null;
      currentBlock = -1;
      lang = langFor(model.rightName) ?? langFor(model.leftName);
      renderHeader();
      renderSidebar();
      rebuildDisplay(false);
      break;
    }
    case 'aiStart':
      state.aiOpen = true;
      state.aiKind = msg.kind;
      state.aiText = '';
      state.aiError = '';
      state.aiStreaming = true;
      renderDrawer();
      break;
    case 'aiChunk':
      state.aiText += msg.text;
      queueAiRender();
      break;
    case 'aiEnd':
      state.aiStreaming = false;
      renderDrawer();
      break;
    case 'aiError':
      state.aiStreaming = false;
      state.aiError = msg.message;
      renderDrawer();
      break;
  }
});

function openFile(index: number): void {
  state.current = index;
  state.loading = true;
  renderSidebar();
  renderHeader();
  vscode.postMessage({ type: 'open', index });
}

vscode.postMessage({ type: 'ready' });
renderHeader();
renderDrawer();

// ----------------------------------------------------------------- header

function renderHeader(): void {
  headerEl.textContent = '';
  const model = state.model;
  const session = state.session;

  const titleBox = el('div', 'title-box');
  const title = el('div', 'title');
  if (model) {
    title.appendChild(el('span', 'file-name', model.leftName));
    title.appendChild(el('span', 'arrow', '→'));
    title.appendChild(el('span', 'file-name', model.rightName));
  } else {
    title.textContent = session?.title ?? 'Diffium';
  }
  titleBox.appendChild(title);
  if (model) {
    titleBox.appendChild(el('div', 'subtitle', `${model.leftLabel}  ·  ${model.rightLabel}`));
  }
  headerEl.appendChild(titleBox);

  if (model?.added !== undefined) {
    const stats = el('div', 'stats');
    stats.appendChild(el('span', 'stat-add', `+${model.added}`));
    stats.appendChild(el('span', 'stat-del', `−${model.removed}`));
    stats.appendChild(statBar(model.added ?? 0, model.removed ?? 0));
    headerEl.appendChild(stats);
  }

  const actions = el('div', 'actions');

  const seg = el('div', 'segmented');
  seg.appendChild(segBtn('Split', state.mode === 'split', () => setMode('split')));
  seg.appendChild(segBtn('Inline', state.mode === 'inline', () => setMode('inline')));
  actions.appendChild(seg);

  const ws = session?.options.ignoreWhitespace ?? false;
  actions.appendChild(
    toggleBtn('␣ Ignore WS', ws, ws ? 'Whitespace-only changes hidden — click to show them' : 'Click to ignore whitespace-only changes', () => {
      vscode.postMessage({
        type: 'setOptions',
        index: state.current,
        options: { ignoreWhitespace: !ws },
      });
    })
  );

  actions.appendChild(
    btn('⇄ Swap', 'ghost', 'Swap left and right sides', () => {
      const swapped = session?.options.swapped ?? false;
      vscode.postMessage({
        type: 'setOptions',
        index: state.current,
        options: { swapped: !swapped },
      });
    })
  );

  actions.appendChild(
    btn(state.allExpanded ? 'Fold' : 'Expand', 'ghost', 'Fold or expand unchanged regions', () => {
      state.allExpanded = !state.allExpanded;
      state.expanded = new Set();
      rebuildDisplay(true);
    })
  );

  actions.appendChild(el('div', 'sep'));

  const nav = el('div', 'nav');
  nav.appendChild(btn('▲', 'ghost nav-btn', 'Previous change (p / k)', () => gotoBlock(currentBlock - 1)));
  nav.appendChild(
    el('span', 'nav-count', changeBlocks.length ? `${Math.max(currentBlock + 1, 0) || '–'}/${changeBlocks.length}` : '0/0')
  );
  nav.appendChild(btn('▼', 'ghost nav-btn', 'Next change (n / j)', () => gotoBlock(currentBlock + 1)));
  actions.appendChild(nav);

  actions.appendChild(el('div', 'sep'));
  actions.appendChild(btn('✦ Explain', 'ai', 'Ask Copilot to explain this diff', () => requestAi('explain')));
  actions.appendChild(btn('✦ Review', 'ai', 'Ask Copilot to review this diff', () => requestAi('review')));

  headerEl.appendChild(actions);
}

function statBar(added: number, removed: number): HTMLElement {
  const total = Math.max(added + removed, 1);
  const bar = el('span', 'stat-bar');
  const addBlocks = Math.round((added / total) * 5);
  for (let i = 0; i < 5; i++) {
    bar.appendChild(el('i', i < addBlocks ? 'blk blk-add' : 'blk blk-del'));
  }
  return bar;
}

function setMode(mode: 'split' | 'inline'): void {
  if (state.mode !== mode) {
    state.mode = mode;
    renderHeader();
    rebuildDisplay(true);
  }
}

function requestAi(kind: string): void {
  if (!state.aiStreaming) {
    vscode.postMessage({ type: 'ai', kind, index: state.current });
  }
}

// ---------------------------------------------------------------- sidebar

function renderSidebar(): void {
  const session = state.session;
  if (!session || session.files.length <= 1) {
    sidebarEl.classList.add('hidden');
    return;
  }
  sidebarEl.classList.remove('hidden');
  sidebarEl.textContent = '';

  const head = el('div', 'sidebar-head');
  head.appendChild(el('div', 'sidebar-title', `${session.files.length} changed files`));
  const filter = document.createElement('input');
  filter.className = 'sidebar-filter';
  filter.placeholder = 'Filter files…';
  filter.value = state.filter;
  filter.addEventListener('input', () => {
    state.filter = filter.value;
    renderList();
  });
  head.appendChild(filter);
  sidebarEl.appendChild(head);

  const list = el('div', 'sidebar-list');
  sidebarEl.appendChild(list);

  const renderList = () => {
    list.textContent = '';
    const needle = state.filter.toLowerCase();
    session.files.forEach((file, index) => {
      if (needle && !file.path.toLowerCase().includes(needle)) {
        return;
      }
      const item = el('div', `file-item${index === state.current ? ' active' : ''}`);
      item.appendChild(el('span', `badge badge-${file.status || 'M'}`, file.status || 'M'));
      const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : '';
      const base = file.path.slice(dir.length);
      const name = el('span', 'file-path');
      if (dir) {
        name.appendChild(el('span', 'file-dir', dir));
      }
      name.appendChild(el('span', 'file-base', base));
      item.appendChild(name);
      const stats = state.stats.get(index);
      if (stats) {
        item.appendChild(el('span', 'file-stats', `+${stats.added} −${stats.removed}`));
      }
      item.title = file.path;
      item.addEventListener('click', () => openFile(index));
      list.appendChild(item);
    });
  };
  renderList();
}

// ------------------------------------------------------- display building

/** Push a change row; in inline mode a mod row expands to del + add rows. */
function pushChangeRow(out: DisplayItem[], row: DiffRow): void {
  if (state.mode === 'inline' && row.t === 'mod') {
    out.push({ kind: 'row', row: { t: 'del', ln: row.ln, l: row.l, lh: row.lh, mv: row.mv } });
    out.push({ kind: 'row', row: { t: 'add', rn: row.rn, r: row.r, rh: row.rh, mv: row.mv } });
    return;
  }
  out.push({ kind: 'row', row });
}

function buildDisplay(rows: DiffRow[], ctx: number): DisplayItem[] {
  const out: DisplayItem[] = [];
  const minFold = 4;
  let i = 0;
  while (i < rows.length) {
    if (rows[i].t !== 'ctx') {
      pushChangeRow(out, rows[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].t === 'ctx') {
      j++;
    }
    const head = i === 0 ? 0 : ctx;
    const tail = j === rows.length ? 0 : ctx;
    const foldable = j - i - head - tail;
    if (!state.allExpanded && !state.expanded.has(i) && foldable >= minFold) {
      for (let k = i; k < i + head; k++) {
        out.push({ kind: 'row', row: rows[k] });
      }
      out.push({ kind: 'fold', key: i, count: foldable });
      for (let k = j - tail; k < j; k++) {
        out.push({ kind: 'row', row: rows[k] });
      }
    } else {
      for (let k = i; k < j; k++) {
        out.push({ kind: 'row', row: rows[k] });
      }
    }
    i = j;
  }
  return out;
}

function isChangeItem(item: DisplayItem): boolean {
  return item.kind === 'row' && item.row.t !== 'ctx';
}

function rebuildDisplay(preserveScroll: boolean): void {
  const model = state.model;
  rowHtmlCache = new Map();
  noteEl.textContent = '';
  noteEl.classList.add('hidden');

  if (!model || model.note || !model.rows || model.rows.length === 0) {
    displayList = [];
    changeBlocks = [];
    spacerEl.style.height = '0px';
    rowsLayerEl.textContent = '';
    noteEl.classList.remove('hidden');
    noteEl.textContent = state.loading
      ? 'Loading diff…'
      : model?.note ?? 'The files are identical.';
    drawMinimap();
    renderHeader();
    return;
  }

  const scrollTop = preserveScroll ? scrollerEl.scrollTop : 0;
  displayList = buildDisplay(model.rows, state.session?.contextLines ?? 3);

  changeBlocks = [];
  for (let i = 0; i < displayList.length; i++) {
    if (isChangeItem(displayList[i]) && (i === 0 || !isChangeItem(displayList[i - 1]))) {
      changeBlocks.push(i);
    }
  }

  computeMetrics(model.rows);
  spacerEl.style.height = `${displayList.length * ROW_H}px`;
  spacerEl.style.width = `${totalWidth()}px`;
  scrollerEl.scrollTop = scrollTop;
  updateWindow();
  drawMinimap();
  updateMinimapView();
  renderHeader();
}

function expandedLen(text: string): number {
  if (!text.includes('\t')) {
    return text.length;
  }
  let col = 0;
  for (const ch of text) {
    col = ch === '\t' ? col + TAB_SIZE - (col % TAB_SIZE) : col + 1;
  }
  return col;
}

function computeMetrics(rows: DiffRow[]): void {
  const probe = el('div', 'code probe');
  probe.textContent = 'M';
  scrollerEl.appendChild(probe);
  const font = getComputedStyle(probe).font;
  probe.remove();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  charW = ctx.measureText('MMMMMMMMMM').width / 10 || 8;

  let maxChars = 40;
  for (const row of rows) {
    if (row.l !== undefined) {
      maxChars = Math.max(maxChars, expandedLen(row.l));
    }
    if (row.r !== undefined) {
      maxChars = Math.max(maxChars, expandedLen(row.r));
    }
  }
  maxChars = Math.min(maxChars, 2_000);

  const maxLine = Math.max(
    ...rows.slice(-1).map((r) => Math.max(r.ln ?? 0, r.rn ?? 0)),
    rows.length
  );
  gutterW = Math.max(44, 20 + String(maxLine).length * charW);
  codeW = Math.ceil(maxChars * charW) + 28;

  contentEl.style.setProperty('--gut', `${gutterW}px`);
  contentEl.style.setProperty('--codew', `${codeW}px`);
  contentEl.style.setProperty('--row-h', `${ROW_H}px`);
}

function totalWidth(): number {
  const min = scrollerEl.clientWidth;
  const width =
    state.mode === 'split' ? gutterW * 2 + codeW * 2 : gutterW * 2 + 22 + codeW;
  return Math.max(min, width);
}

// ---------------------------------------------------------- virtual window

function updateWindow(): void {
  if (displayList.length === 0) {
    rowsLayerEl.textContent = '';
    return;
  }
  const start = Math.max(0, Math.floor(scrollerEl.scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(
    displayList.length,
    Math.ceil((scrollerEl.scrollTop + scrollerEl.clientHeight) / ROW_H) + OVERSCAN
  );

  rowsLayerEl.textContent = '';
  const frag = document.createDocumentFragment();
  const width = totalWidth();
  spacerEl.style.width = `${width}px`;
  for (let i = start; i < end; i++) {
    let rowEl = rowHtmlCache.get(i);
    if (!rowEl) {
      rowEl = buildItem(displayList[i]);
      rowHtmlCache.set(i, rowEl);
      if (rowHtmlCache.size > 3_000) {
        rowHtmlCache = new Map([...rowHtmlCache].slice(-1_000));
        rowHtmlCache.set(i, rowEl);
      }
    }
    rowEl.style.top = `${i * ROW_H}px`;
    rowEl.style.width = `${width}px`;
    const flashing =
      state.flash && i >= state.flash.from && i < state.flash.to;
    rowEl.classList.toggle('flash', !!flashing);
    frag.appendChild(rowEl);
  }
  rowsLayerEl.appendChild(frag);
}

function buildItem(item: DisplayItem): HTMLElement {
  if (item.kind === 'fold') {
    const fold = el('div', 'vrow fold');
    const button = el('button', 'fold-btn');
    button.appendChild(el('span', 'fold-icon', '⋯'));
    button.appendChild(el('span', '', ` ${item.count} unchanged lines`));
    button.addEventListener('click', () => {
      state.expanded.add(item.key);
      rebuildDisplay(true);
    });
    fold.appendChild(button);
    return fold;
  }
  return state.mode === 'split' ? buildSplitRow(item.row) : buildInlineRow(item.row);
}

function buildSplitRow(row: DiffRow): HTMLElement {
  const moved = row.mv !== undefined;
  const rowEl = el('div', `vrow row split t-${row.t}${moved ? ' moved' : ''}`);
  const leftType = row.t === 'ctx' ? 'ctx' : row.t === 'add' ? 'empty' : 'del';
  const rightType = row.t === 'ctx' ? 'ctx' : row.t === 'del' ? 'empty' : 'add';
  const rightText = row.t === 'ctx' ? row.r ?? row.l : row.r;

  rowEl.appendChild(gutterCell(row.ln, leftType, moved && row.t === 'del'));
  rowEl.appendChild(codeCell(row.l, row.lh, 'hl-del', leftType));
  rowEl.appendChild(gutterCell(row.rn, rightType, moved && row.t === 'add'));
  rowEl.appendChild(codeCell(rightText, row.rh, 'hl-add', rightType));
  if (moved) {
    rowEl.title = 'Moved code — this block was relocated, not changed';
  }
  return rowEl;
}

function buildInlineRow(row: DiffRow): HTMLElement {
  // mod rows never reach here: pushChangeRow expands them to del + add.
  const moved = row.mv !== undefined;
  const rowEl = el('div', `vrow row inline t-${row.t}${moved ? ' moved' : ''}`);
  rowEl.appendChild(gutterCell(row.ln, row.t, moved && row.t === 'del'));
  rowEl.appendChild(gutterCell(row.rn, row.t, moved && row.t === 'add'));
  const signText = row.t === 'add' ? '+' : row.t === 'del' ? '−' : '';
  rowEl.appendChild(el('div', `sign sign-${row.t}`, signText));
  if (row.t === 'del') {
    rowEl.appendChild(codeCell(row.l, row.lh, 'hl-del', 'del'));
  } else if (row.t === 'add') {
    rowEl.appendChild(codeCell(row.r, row.rh, 'hl-add', 'add'));
  } else {
    rowEl.appendChild(codeCell(row.l, undefined, '', 'ctx'));
  }
  return rowEl;
}

function gutterCell(num: number | undefined, type: string, movedMark: boolean): HTMLElement {
  const g = el('div', `gutter g-${type}`);
  g.textContent = movedMark ? '⇄' : num !== undefined ? String(num) : '';
  if (movedMark) {
    g.classList.add('g-moved');
  }
  return g;
}

function codeCell(
  text: string | undefined,
  ranges: CharRange[] | undefined,
  hlClass: string,
  type: string
): HTMLElement {
  const cell = el('div', `code c-${type}`);
  if (text === undefined) {
    return cell;
  }
  if (text === '') {
    cell.appendChild(document.createTextNode(' '));
    return cell;
  }
  let html: string;
  try {
    html =
      lang && hljs.getLanguage(lang)
        ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
        : escapeHtml(text);
  } catch {
    html = escapeHtml(text);
  }
  cell.innerHTML = html;
  if (ranges && ranges.length > 0) {
    for (const [start, end] of ranges) {
      wrapRange(cell, start, end, hlClass);
    }
  }
  return cell;
}

/** Wrap the character range [start, end) of the cell's text content in spans. */
function wrapRange(root: HTMLElement, start: number, end: number, cls: string): void {
  if (end <= start) {
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Array<{ node: Text; s: number; e: number }> = [];
  let offset = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const len = textNode.data.length;
    const s = Math.max(start - offset, 0);
    const e = Math.min(end - offset, len);
    if (s < e) {
      targets.push({ node: textNode, s, e });
    }
    offset += len;
    if (offset >= end) {
      break;
    }
  }
  for (const t of targets) {
    const range = document.createRange();
    range.setStart(t.node, t.s);
    range.setEnd(t.node, t.e);
    const span = document.createElement('span');
    span.className = cls;
    try {
      range.surroundContents(span);
    } catch {
      // partial selection of a non-text node; skip this segment
    }
  }
}

function langFor(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext];
}

// ------------------------------------------------------------- navigation

function gotoBlock(index: number): void {
  if (changeBlocks.length === 0) {
    return;
  }
  currentBlock = ((index % changeBlocks.length) + changeBlocks.length) % changeBlocks.length;
  const start = changeBlocks[currentBlock];
  let end = start;
  while (end < displayList.length && isChangeItem(displayList[end])) {
    end++;
  }
  scrollerEl.scrollTop = Math.max(0, start * ROW_H - scrollerEl.clientHeight / 3);
  state.flash = { from: start, to: end };
  updateWindow();
  renderHeader();
  setTimeout(() => {
    state.flash = null;
    updateWindow();
  }, 700);
}

// ---------------------------------------------------------------- minimap

function drawMinimap(): void {
  const h = minimapEl.clientHeight;
  const w = minimapEl.clientWidth;
  if (h === 0 || w === 0) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  minimapCanvas.width = w * dpr;
  minimapCanvas.height = h * dpr;
  minimapCanvas.style.width = `${w}px`;
  minimapCanvas.style.height = `${h}px`;
  const ctx = minimapCanvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const n = displayList.length;
  if (n === 0) {
    return;
  }

  const styles = getComputedStyle(document.documentElement);
  const colAdd = styles.getPropertyValue('--dp-add-fg').trim() || '#3fb950';
  const colDel = styles.getPropertyValue('--dp-del-fg').trim() || '#f85149';
  const colMod = styles.getPropertyValue('--dp-mod-fg').trim() || '#d29922';
  const colMove = styles.getPropertyValue('--dp-move-fg').trim() || '#58a6ff';

  // aggregate rows into pixel buckets (priority: move < mod < add/del)
  const buckets = new Array<string | null>(h).fill(null);
  for (let i = 0; i < n; i++) {
    const item = displayList[i];
    if (item.kind !== 'row' || item.row.t === 'ctx') {
      continue;
    }
    const y = Math.min(h - 1, Math.floor((i / n) * h));
    const color =
      item.row.mv !== undefined
        ? colMove
        : item.row.t === 'mod'
          ? colMod
          : item.row.t === 'add'
            ? colAdd
            : colDel;
    buckets[y] = buckets[y] ?? color;
  }
  for (let y = 0; y < h; y++) {
    const color = buckets[y];
    if (color) {
      ctx.fillStyle = color;
      ctx.fillRect(2, y, w - 4, 2);
    }
  }
}

function updateMinimapView(): void {
  const total = displayList.length * ROW_H;
  if (total <= 0) {
    minimapView.style.display = 'none';
    return;
  }
  const h = minimapEl.clientHeight;
  const top = (scrollerEl.scrollTop / total) * h;
  const height = Math.max(12, (scrollerEl.clientHeight / total) * h);
  minimapView.style.display = 'block';
  minimapView.style.top = `${Math.min(top, h - height)}px`;
  minimapView.style.height = `${height}px`;
}

function minimapScrollTo(clientY: number): void {
  const rect = minimapEl.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  scrollerEl.scrollTop = ratio * displayList.length * ROW_H - scrollerEl.clientHeight / 2;
}

let minimapDragging = false;
minimapEl.addEventListener('mousedown', (e) => {
  minimapDragging = true;
  minimapScrollTo(e.clientY);
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (minimapDragging) {
    minimapScrollTo(e.clientY);
  }
});
window.addEventListener('mouseup', () => {
  minimapDragging = false;
});

// --------------------------------------------------------------- AI drawer

let aiRenderQueued = false;

function queueAiRender(): void {
  if (aiRenderQueued) {
    return;
  }
  aiRenderQueued = true;
  requestAnimationFrame(() => {
    aiRenderQueued = false;
    const content = drawerEl.querySelector('.ai-content');
    if (content) {
      content.innerHTML = renderMarkdown(state.aiText);
      content.scrollTop = content.scrollHeight;
    } else {
      renderDrawer();
    }
  });
}

function renderDrawer(): void {
  drawerEl.textContent = '';
  if (!state.aiOpen) {
    drawerEl.classList.add('hidden');
    return;
  }
  drawerEl.classList.remove('hidden');

  const head = el('div', 'ai-head');
  const title = el('div', 'ai-title');
  title.appendChild(el('span', 'ai-badge', '✦'));
  title.appendChild(
    el('span', '', state.aiKind === 'review' ? 'Copilot Review' : 'Copilot Explanation')
  );
  if (state.aiStreaming) {
    title.appendChild(el('span', 'spinner'));
  }
  head.appendChild(title);

  const headActions = el('div', 'ai-head-actions');
  if (state.aiStreaming) {
    headActions.appendChild(
      btn('Stop', 'ghost small', 'Stop generating', () => vscode.postMessage({ type: 'aiCancel' }))
    );
  } else if (state.aiText) {
    headActions.appendChild(
      btn('Copy', 'ghost small', 'Copy response', () =>
        void navigator.clipboard.writeText(state.aiText)
      )
    );
  }
  headActions.appendChild(
    btn('✕', 'ghost small', 'Close', () => {
      state.aiOpen = false;
      vscode.postMessage({ type: 'aiCancel' });
      renderDrawer();
    })
  );
  head.appendChild(headActions);
  drawerEl.appendChild(head);

  const content = el('div', 'ai-content');
  if (state.aiError) {
    content.appendChild(el('div', 'ai-error', state.aiError));
  } else if (state.aiText) {
    content.innerHTML = renderMarkdown(state.aiText);
  } else {
    content.appendChild(el('div', 'ai-waiting', 'Asking Copilot…'));
  }
  drawerEl.appendChild(content);
}

/** Minimal, safe markdown renderer (input is escaped before transforming). */
function renderMarkdown(src: string): string {
  const SENTINEL = String.fromCharCode(0);
  const stash: string[] = [];
  const put = (html: string): string => {
    stash.push(html);
    return `${SENTINEL}${stash.length - 1}${SENTINEL}`;
  };

  let out = escapeHtml(src);

  out = out.replace(/```(\w*)\n?([\s\S]*?)(?:```|$)/g, (_m, _lang, code) =>
    put(`<pre class="md-code">${code}</pre>`)
  );
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => put(`<code>${code}</code>`));

  out = out
    .replace(/^#### (.*)$/gm, '<h5>$1</h5>')
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/^\s*(\d+)\. (.*)$/gm, '<li value="$1">$2</li>');

  out = out.replace(/(?:^|\n)((?:<li[^>]*>.*<\/li>\n?)+)/g, (_m, items) => `\n<ul>${items}</ul>`);

  out = out
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) {
        return '';
      }
      if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith(SENTINEL)) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  out = out.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'), (_m, i) => stash[Number(i)] ?? '');
  return out;
}

// ------------------------------------------------------------------ helpers

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function btn(label: string, className: string, tooltip: string, onClick: () => void): HTMLElement {
  const button = el('button', `btn ${className}`, label) as HTMLButtonElement;
  button.type = 'button';
  button.title = tooltip;
  button.addEventListener('click', onClick);
  return button;
}

function toggleBtn(
  label: string,
  active: boolean,
  tooltip: string,
  onClick: () => void
): HTMLElement {
  return btn(label, `ghost toggle${active ? '' : ' off'}`, tooltip, onClick);
}

function segBtn(label: string, active: boolean, onClick: () => void): HTMLElement {
  return btn(label, `seg${active ? ' active' : ''}`, label, onClick);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
