/* ===== UAD 3.6 Helper — UI ============================================ */
/* Paste a connectMLS grid, read it once, then let the appraiser correct     */
/* anything the recognizer got wrong. Every correction recomputes the form   */
/* fields immediately, so the numbers on screen always match the table       */
/* below them.                                                               */
/*                                                                          */
/* Copying is gated on the reading being complete: if rows could not be      */
/* read, the summary is marked provisional and the copy buttons stay off     */
/* until the appraiser has resolved them. An unreviewed number reaching the  */
/* clipboard is how it reaches a report.                                     */
/* ===================================================================== */

const $ = (sel) => document.querySelector(sel);

const dropZone     = $('#drop-zone');
const fileInput    = $('#file-input');
const previewWrap  = $('#preview-wrapper');
const previewImg   = $('#preview-img');
const previewFile  = $('#preview-file');
const clearBtn     = $('#clear-btn');
const extractBtn   = $('#extract-btn');
const statusArea   = $('#status-area');
const progressWrap = $('#progress-container');
const progressFill = $('#progress-fill');
const progressPct  = $('#progress-pct');
const progressMsg  = $('#progress-msg');

const uadCard      = $('#uad-card');
const uadGrid      = $('#uad-grid');
const uadProvisional = $('#uad-provisional');
const uadCopyAll   = $('#uad-copy-all');
const uadLive      = $('#uad-live');
const outputCard   = $('#output-card');
const outputBox    = $('#output-box');
const copyBtn      = $('#copy-btn');
const copyNote     = $('#copy-note');
const noticeCard   = $('#notice-card');
const noticeList   = $('#notice-list');
const noteList     = $('#note-list');
const columnsNote  = $('#columns-note');
const columnMap    = $('#column-map');
const mappingCard  = $('#mapping-card');
const mappingGrid  = $('#mapping-grid');
const reviewCard   = $('#review-card');
const reviewBody   = $('#review-body');
const reviewCount  = $('#review-count');
const debugCard    = $('#debug-card');
const inputCard    = $('#input-card');
const appContainer = $('.app-container');
const appFooter    = $('.app-footer');

/* ---- State ---- */
/* What is being read: { kind: 'image', blob } for a screenshot, or
 * { kind: 'table', text, name, encoding } for a CSV / TSV export. */
let currentInput = null;
let lastResult = null;      /* raw pipeline output */
let rows = [];              /* editable working copy */
let statusMapping = defaultStatusMapping();
let outputFormat = 'uad';
let lastReport = null;
/* Bumped on every new image. A run whose token is stale writes nothing: two
 * pastes in quick succession otherwise leave the slower image's numbers on
 * screen beside the newer image's preview, with copy enabled. */
let runToken = 0;

/* ================================================================== */
/*  Input: a screenshot, or an export                                  */
/* ================================================================== */

document.addEventListener('paste', (e) => {
  const data = e.clipboardData;
  if (!data) return;
  for (const item of data.items || []) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      handleImageFile(item.getAsFile());
      return;
    }
  }
  /* A file copied in Explorer or Finder arrives as a file, not as text. */
  for (const file of data.files || []) {
    if (isTableFile(file)) {
      e.preventDefault();
      handleTableFile(file);
      return;
    }
  }
  /* Cells copied out of a spreadsheet arrive as tab-separated text. Only taken
   * when it has a header this app recognizes, and never from a paste into one
   * of the review table's own fields — that is somebody typing a price. */
  const target = e.target;
  if (target && target.closest && target.closest('input, textarea, select')) return;
  const text = data.getData('text/plain');
  if (text && looksLikeTable(text)) {
    e.preventDefault();
    handleTableText(text, 'pasted table');
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
  /* Cleared so choosing the same file again — after fixing it — fires again. */
  fileInput.value = '';
});

/* A file can be dropped anywhere on the page, not only on the drop zone — once
 * there are results the drop zone is at the bottom. Only drags carrying files
 * are taken, so dragging text into a review-table field still works. The
 * enter/leave counter is there because both fire for every child element the
 * pointer crosses; without it the overlay flickers. */
const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
let dragDepth = 0;

function setDragging(on) {
  document.body.classList.toggle('is-dragging', on);
  dropZone.classList.toggle('drag-over', on);
}

document.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  if (dragDepth++ === 0) setDragging(true);
});
document.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; setDragging(false); }
});
document.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  setDragging(false);
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

clearBtn.addEventListener('click', resetState);
extractBtn.addEventListener('click', runAnalysis);

for (const id of ['debug-toggle', 'mapping-toggle']) {
  const el = $('#' + id);
  if (!el) continue;
  el.addEventListener('click', () => {
    const body = $('#' + id.replace('-toggle', '-body'));
    body.classList.toggle('hidden');
    const chev = el.querySelector('.debug-chevron');
    if (chev) chev.textContent = body.classList.contains('hidden') ? '▸' : '▾';
  });
}

for (const tab of document.querySelectorAll('.tab[data-format]')) {
  tab.addEventListener('click', () => {
    outputFormat = tab.dataset.format;
    for (const t of document.querySelectorAll('.tab[data-format]')) {
      t.classList.toggle('is-active', t === tab);
    }
    renderOutput();
  });
}

$('#mapping-reset').addEventListener('click', () => {
  statusMapping = defaultStatusMapping();
  recompute();
});

copyBtn.addEventListener('click', async () => {
  if (copyBtn.disabled) return;
  const ok = await copyToClipboard(outputBox.value);
  copyBtn.classList.toggle('copied', ok);
  copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
  setTimeout(() => {
    copyBtn.classList.remove('copied');
    copyBtn.textContent = 'Copy to Clipboard';
  }, 1600);
});

uadCopyAll.addEventListener('click', async () => {
  if (uadCopyAll.disabled || !lastReport) return;
  const ok = await copyToClipboard(uadFieldsAsText(lastReport));
  uadCopyAll.classList.toggle('copied', ok);
  uadCopyAll.textContent = ok ? 'Copied' : 'Copy failed';
  announce(ok ? 'Every field copied.' : 'Copy failed.');
  setTimeout(() => {
    uadCopyAll.classList.remove('copied');
    uadCopyAll.textContent = 'Copy every field';
  }, 1600);
});

/** A dropped or chosen file: a screenshot or an export, told apart here. */
function handleFile(file) {
  if (!file) return;
  if (file.type && file.type.startsWith('image/')) return handleImageFile(file);
  if (isTableFile(file)) return handleTableFile(file);
  showStatus(
    /\.xlsx?$/i.test(file.name || '')
      ? 'An Excel workbook cannot be read directly. Save it as CSV (or export the search as CSV ' +
        'or TSV) and drop that in instead.'
      : 'That is neither a screenshot nor an export. Paste a PNG or JPG screenshot, or drop in a ' +
        '.csv or .tsv file.',
    'error');
}

/** Export files, by extension first — Windows often reports a .tsv with no type at all. */
function isTableFile(file) {
  if (!file) return false;
  if (/\.(csv|tsv|tab|txt)$/i.test(file.name || '')) return true;
  return /^text\/(csv|tab-separated-values|plain)$/i.test(file.type || '');
}

/**
 * Corrections are work. A stray Ctrl+V anywhere on the page would otherwise
 * throw them away silently, and there is no undo.
 */
function confirmDiscardEdits(what) {
  const edits = rows.filter(r => r.edited || r.omit).length;
  return edits === 0 || window.confirm(
    `You have corrected ${edits} row${edits === 1 ? '' : 's'} by hand. ` +
    `Replacing the ${what} discards those corrections. Continue?`);
}

function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showStatus('That does not look like an image. Paste a PNG or JPG screenshot.', 'error');
    return;
  }
  if (!confirmDiscardEdits('screenshot')) return;

  if (previewImg.src && previewImg.src.startsWith('blob:')) URL.revokeObjectURL(previewImg.src);
  resetResults();
  currentInput = { kind: 'image', blob: file };
  previewImg.src = URL.createObjectURL(file);
  previewImg.classList.remove('hidden');
  previewFile.classList.add('hidden');
  previewWrap.classList.remove('hidden');
  extractBtn.disabled = false;
  clearStatus();
  runAnalysis();
}

async function handleTableFile(file) {
  if (file.size > TABLE_MAX_BYTES) {
    showStatus(`${file.name} is ${(file.size / 1048576).toFixed(0)} MB — far larger than an MLS ` +
               `export. Check that this is the right file.`, 'error');
    return;
  }
  let decoded;
  try {
    decoded = decodeTableBytes(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    showStatus(`${file.name} could not be opened: ${err.message || err}`, 'error');
    return;
  }
  handleTableText(decoded.text, file.name, decoded.encoding);
}

function handleTableText(text, name, encoding) {
  if (!confirmDiscardEdits(currentInput && currentInput.kind === 'table' ? 'file' : 'screenshot')) return;

  if (previewImg.src && previewImg.src.startsWith('blob:')) URL.revokeObjectURL(previewImg.src);
  resetResults();
  currentInput = { kind: 'table', text, name, encoding: encoding || null };
  previewImg.removeAttribute('src');
  previewImg.classList.add('hidden');
  previewFile.classList.remove('hidden');
  previewFile.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = name;
  previewFile.append(strong, document.createTextNode(' — an export, read as text.'));
  previewWrap.classList.remove('hidden');
  extractBtn.disabled = false;
  clearStatus();
  runAnalysis();
}

function resetResults() {
  lastResult = null;
  lastReport = null;
  rows = [];
  for (const card of [noticeCard, uadCard, outputCard, mappingCard, reviewCard, debugCard]) {
    card.classList.add('hidden');
  }
  showingResults(false);
  uadGrid.innerHTML = '';
  uadCopyAll.disabled = true;
  outputBox.value = '';
  copyBtn.disabled = true;
}

/**
 * The page head and its explainer are for someone who has not pasted anything
 * yet. Once there are numbers, the numbers are the page.
 */
function showingResults(on) {
  appContainer.classList.toggle('has-results', on);
}

function resetState() {
  placeInputCard('top');
  currentInput = null;
  previewImg.removeAttribute('src');
  previewFile.innerHTML = '';
  previewFile.classList.add('hidden');
  previewWrap.classList.add('hidden');
  extractBtn.disabled = true;
  fileInput.value = '';
  resetResults();
  clearStatus();
  progressWrap.classList.add('hidden');
}

/**
 * Where the paste box sits.
 *
 * Above the results while there are none, because that is the only thing to
 * do; below them once there are, because the numbers are what you came for and
 * scrolling past the screenshot to reach them every time is friction. Moving
 * the node rather than reordering with flexbox keeps the card margins — which
 * are adjacency-based — correct in both arrangements.
 */
function placeInputCard(where) {
  const anchor = where === 'bottom' ? appFooter : noticeCard;
  if (inputCard.nextElementSibling !== anchor) appContainer.insertBefore(inputCard, anchor);
}

/** Bring the results into view if the reorder left them off screen. */
function revealSummary() {
  const top = noticeCard.classList.contains('hidden') ? uadCard : noticeCard;
  const box = top.getBoundingClientRect();
  if (box.top >= 0 && box.top < window.innerHeight * 0.5) return;
  top.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================================================================== */
/*  Analysis                                                           */
/* ================================================================== */

async function runAnalysis() {
  if (!currentInput) return;

  const token = ++runToken;
  const stale = () => token !== runToken;
  const input = currentInput;

  extractBtn.disabled = true;
  resetResults();
  clearStatus();
  progressWrap.classList.remove('hidden');
  setProgress(0, 'Starting…');

  const perf = {};
  const t0 = performance.now();

  try {
    let result;
    if (input.kind === 'table') {
      setProgress(40, 'Reading the export…');
      result = extractTable(input.text, input.name, { encoding: input.encoding });
    } else {
      const img = await decodeImage(input.blob);
      if (stale()) return;
      result = await extractGrid(img, (pct, msg) => { if (!stale()) setProgress(pct, msg); });
    }
    if (stale()) return;
    perf.total = performance.now() - t0;

    lastResult = result;
    rows = result.rows.map((r, i) => ({
      n: i + 1,
      line: r.line || null,
      index: r.index,
      mls: r.mls,
      status: r.status,
      statusScore: r.statusScore,
      statusColor: r.statusColor,
      statusRanked: r.statusRanked,
      statusReject: r.statusReject,
      listPrice: r.listPrice,
      origPrice: r.origPrice,
      soldPrice: r.soldPrice,
      concessions: r.concessions,
      marketTime: r.marketTime,
      omit: false,
      edited: false,
      original: {
        status: r.status, listPrice: r.listPrice, origPrice: r.origPrice,
        soldPrice: r.soldPrice, concessions: r.concessions, marketTime: r.marketTime,
      },
    }));

    if (result.failed || rows.length === 0) {
      placeInputCard('top');
      renderNotices(result.warnings || []);
      showStatus(`No listings could be read from this ${input.kind === 'table' ? 'file' : 'image'}.`,
        'error');
      setProgress(100, 'Done');
      return;
    }

    for (const card of [uadCard, outputCard, mappingCard, reviewCard, debugCard]) {
      card.classList.remove('hidden');
    }
    showingResults(true);
    placeInputCard('bottom');
    revealSummary();

    renderColumns(result);
    recompute();

    const canvas = $('#debug-canvas');
    const clustersEl = $('#debug-clusters');
    const isFile = result.source === 'file';
    canvas.classList.toggle('hidden', isFile);
    clustersEl.classList.toggle('hidden', isFile);
    if (isFile) {
      renderDebugTable($('#debug-perf'), result, perf);
    } else {
      renderDebugOverlay(canvas, result);
      renderDebugClusters(clustersEl, result);
      renderDebugPerf($('#debug-perf'), result, perf);
    }

    setProgress(100, 'Done');
    const s = lastReport.summary;
    showStatus(
      `Read ${rows.length} listings — ${s.active.count} active, ` +
      `${s.pending.count} pending, ${s.closed.count} closed.`,
      lastReport.provisional ? 'info' : 'success'
    );
  } catch (err) {
    if (stale()) return;
    placeInputCard('top');
    console.error(err);
    showStatus(`Analysis failed: ${err.message ||
      (input.kind === 'table' ? 'the file could not be read' : 'the image could not be read')}`, 'error');
    setProgress(100, 'Failed');
  } finally {
    if (!stale()) {
      extractBtn.disabled = !currentInput;
      setTimeout(() => { if (!stale()) progressWrap.classList.add('hidden'); }, 900);
    }
  }
}

/**
 * Decode a pasted blob into an image.
 *
 * loadImageFromBlob rejects with the raw error Event, which surfaces as
 * "Analysis failed: undefined" and tells the user nothing. It also leaks the
 * object URL. Both are handled here rather than in the ported module.
 */
async function decodeImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(
        'that image could not be decoded. Paste it as a PNG — some formats ' +
        '(HEIC, AVIF) and truncated clipboard images cannot be read.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rebuild every derived view from `rows` + `statusMapping`. */
function recompute() {
  lastReport = buildReport(rows, statusMapping, lastResult && lastResult.review);
  renderNotices((lastResult && lastResult.warnings) || []);
  renderUad(lastReport);
  renderMapping(lastReport);
  renderReview(lastReport);
  renderOutput();
  gateCopy(lastReport);
}

/**
 * Copying is only enabled once the reading is complete.
 *
 * A provisional summary in the clipboard is a provisional summary in the
 * report, with nothing in the pasted text to say so.
 */
function gateCopy(report) {
  const blocked = report.provisional;
  copyBtn.disabled = blocked;
  if (blocked) {
    copyNote.textContent =
      'Copying is off until this reading is complete: ' +
      report.provisionalReasons.join('; ') +
      '. Resolve them below, or select the text above by hand — it carries the same caveats.';
    copyNote.classList.remove('hidden');
  } else {
    copyNote.classList.add('hidden');
  }
}

function renderOutput() {
  if (!lastReport) return;
  if (outputFormat === 'tsv') outputBox.value = reportAsTsv(lastReport);
  else if (outputFormat === 'rows') outputBox.value = allRowsAsTsv(lastReport);
  else if (outputFormat === 'text') outputBox.value = reportAsText(lastReport);
  else outputBox.value = uadFieldsAsText(lastReport);
}

/* ================================================================== */
/*  Rendering                                                          */
/* ================================================================== */

const NOTICE_ICON = { ok: '✓', info: 'i', warn: '!', error: '✕' };

function renderNotices(warnings) {
  noticeList.innerHTML = '';
  noteList.innerHTML = '';
  const all = warnings.slice();

  if (lastReport && !lastReport.balanced) {
    all.unshift({
      level: 'error',
      text: `Row accounting does not balance: ${lastReport.accounted} rows are placed but ` +
            `${lastReport.totalRows} were read. Do not rely on these numbers.`,
    });
  }
  if (lastReport && lastReport.summary.unclassified.count) {
    all.unshift({
      level: 'warn',
      text: `${lastReport.summary.unclassified.count} row(s) carry a status code this app does ` +
            `not recognize. Set a status for each of them in the table below.`,
    });
  }

  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  all.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));

  /* Only what bears on the numbers sits above the fields. The rest — a column
   * the file lacks, a code that carries a flag, the tick for a clean row count —
   * waits under Recognition Detail, there to check without standing between
   * the appraiser and the figures. */
  for (const w of all) {
    const el = document.createElement('div');
    el.className = `notice notice--${w.level}`;
    el.innerHTML = `<span class="notice__icon">${NOTICE_ICON[w.level] || 'i'}</span><span></span>`;
    el.lastElementChild.textContent = w.text;
    (w.level === 'error' || w.level === 'warn' ? noticeList : noteList).appendChild(el);
  }
  noticeCard.classList.toggle('hidden', !noticeList.childElementCount);
}

function renderColumns(result) {
  columnMap.innerHTML = '';
  if (result.source === 'file') return renderFileColumns(result);
  const roles = result.roles || {};
  const surf = result.surf;
  const px = v => Math.round(compactToSourceX(surf, v));

  const HOW = {
    header: 'named by the header',
    'fill-pattern': 'inferred from the fill pattern',
    position: 'inferred from column order — check this',
  };

  const line = (label, col, count, extra, roleKey) => {
    const row = document.createElement('div');
    row.className = 'column-map__row';
    const how = roleKey && roles.methodBy ? HOW[roles.methodBy[roleKey]] : null;
    row.innerHTML =
      `<span class="column-map__role">${label}</span>` +
      `<span>${col ? `x ${px(col.x0)}–${px(col.x1)}px, ${count} value(s)` : 'not found'}</span>` +
      (how ? `<span class="column-map__how">${how}</span>` : '') +
      (extra ? `<span class="column-map__how">${extra}</span>` : '');
    columnMap.appendChild(row);
  };

  line('Status',
    result.statusCol && result.statusCol.col,
    result.statusCol ? result.statusCol.cells.length : 0,
    result.statusCol ? `${result.statusClusters.length} distinct code(s)` : '');
  line('List price', roles.list && roles.list.col, roles.list ? roles.list.prices.size : 0,
    'feeds active + pending', 'list');
  line('Orig list price', roles.orig && roles.orig.col, roles.orig ? roles.orig.prices.size : 0,
    'denominator of the sale/list ratio', 'orig');
  line('Sold price', roles.sold && roles.sold.col, roles.sold ? roles.sold.prices.size : 0,
    'feeds closed sales', 'sold');
  line('Concessions', roles.conc && roles.conc.col, roles.conc ? roles.conc.values.size : 0,
    'subtracted from the sold price in the ratio', 'conc');
  line('Market time (MT)',
    result.marketTimeCol && result.marketTimeCol.col,
    result.marketTimeCol ? result.marketTimeCol.read : 0,
    result.marketTimeCol
      ? 'feeds median days on market · named by the header, never inferred'
      : 'no MT header — days on market cannot be inferred from a column of small numbers');
  if (result.mlsCol) line('MLS #', result.mlsCol.col, result.mlsCol.values.size, 'duplicate check');

  const summary = {
    header: 'Every money column was named by the grid’s own header row.',
    'fill-pattern': 'At least one money column was identified from the data rather than a header ' +
                    'label — check the assignment below.',
    position: 'At least one money column was taken from connectMLS’s default column order, with ' +
              'no header label and no fill pattern to confirm it. Check it against your ' +
              'screenshot before using the numbers.',
  };
  columnsNote.textContent =
    (summary[roles.method] || 'Columns could not be identified.') +
    ` Confidence ${(100 * (roles.confidence || 0)).toFixed(0)}%.` +
    (roles.notes && roles.notes.length ? ' ' + roles.notes.join(' ') : '');
}

/**
 * The column map for an export: which heading each role was read from.
 *
 * Nothing here was inferred, so there is no provenance to grade — but the
 * heading is still worth showing, because "Current Price" feeding the list
 * price is a decision the appraiser should be able to see was made.
 */
function renderFileColumns(result) {
  const cols = result.columns || {};
  const counts = result.valueCounts || {};
  const ambiguous = new Map((result.ambiguous || []).map(a => [a.role, a.labels]));

  const line = (label, role, extra) => {
    const row = document.createElement('div');
    row.className = 'column-map__row';
    const c = cols[role];
    const where = c
      ? `column ${c.index + 1}, “${c.label}” — ${counts[role] || 0} value(s)`
      : ambiguous.has(role)
        ? `not used — ${ambiguous.get(role).map(l => `“${l}”`).join(' and ')} both claim it`
        : 'not in this file';
    row.innerHTML =
      `<span class="column-map__role"></span><span></span>` +
      (c ? '<span class="column-map__how">named by the header</span>' : '') +
      (extra ? '<span class="column-map__how"></span>' : '');
    row.children[0].textContent = label;
    row.children[1].textContent = where;
    if (extra) row.lastElementChild.textContent = extra;
    columnMap.appendChild(row);
  };

  line('Status', 'status', 'decides the bucket');
  line('List price', 'list', 'feeds active + pending');
  line('Orig list price', 'orig', 'denominator of the sale/list ratio');
  line('Sold price', 'sold', 'feeds closed sales');
  line('Concessions', 'conc', 'subtracted from the sold price in the ratio');
  line('Market time', 'mt', 'feeds median days on market');
  line('MLS #', 'mls', 'duplicate check');

  columnsNote.textContent =
    `Read from ${result.fileName} as ${result.delimiter}-separated text` +
    (result.encoding ? ` (${result.encoding})` : '') +
    `. Every column below was named by the file’s own header row, on line ${result.headerLine}; ` +
    `nothing was inferred, and a column no heading names was not read.`;
}

function renderMapping() {
  mappingGrid.innerHTML = '';

  const present = new Map();
  for (const r of rows) {
    if (!r.status) continue;
    const code = normalizeStatusCode(r.status) || r.status;
    present.set(code, (present.get(code) || 0) + 1);
  }

  const ordered = STATUS_CODES.slice().sort((a, b) => {
    const pa = present.has(a.code) ? 0 : 1, pb = present.has(b.code) ? 0 : 1;
    return pa - pb || a.code.localeCompare(b.code);
  });

  for (const entry of ordered) {
    const row = document.createElement('div');
    row.className = 'mapping-row' + (present.has(entry.code) ? ' is-present' : '');

    const code = document.createElement('span');
    code.className = 'mapping-row__code';
    code.textContent = entry.code;
    row.appendChild(code);

    const sel = document.createElement('select');
    sel.className = 'field';
    for (const b of BUCKETS) {
      if (b.id === 'unclassified') continue;
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.short;
      sel.appendChild(opt);
    }
    sel.value = statusMapping[entry.code] || entry.bucket;
    sel.addEventListener('change', () => {
      statusMapping[entry.code] = sel.value;
      recompute();
    });
    row.appendChild(sel);

    const meta = document.createElement('span');
    meta.className = 'mapping-row__meta';
    meta.title = `${entry.name} — ${entry.note}` + (entry.flag ? `\n\n⚠ ${entry.flag}` : '');
    meta.textContent = entry.name + (entry.given ? ' (as specified)' : '') + (entry.flag ? ' ⚠' : '');
    row.appendChild(meta);

    if (present.has(entry.code)) {
      const n = document.createElement('span');
      n.className = 'mapping-row__count';
      n.textContent = `×${present.get(entry.code)}`;
      row.appendChild(n);
    }

    mappingGrid.appendChild(row);
  }
}

function renderReview(report) {
  reviewBody.innerHTML = '';
  reviewCount.textContent = `(${rows.length})`;

  for (const row of rows) {
    const entry = findReportEntry(report, row);
    const bucketId = row.omit ? null : (row.status ? bucketForStatus(row.status, statusMapping) : null);

    const tr = document.createElement('tr');
    if (row.omit) tr.classList.add('is-omitted');
    if (row.edited) tr.classList.add('is-edited');
    if (!row.status || bucketId === 'unclassified') tr.classList.add('is-unread');

    /* Use */
    const useTd = document.createElement('td');
    const use = document.createElement('input');
    use.type = 'checkbox';
    use.checked = !row.omit;
    use.title = 'Include this row in the summary';
    use.addEventListener('change', () => { row.omit = !use.checked; recompute(); });
    useTd.appendChild(use);
    tr.appendChild(useTd);

    const numTd = cell(row.index != null ? String(row.index) : String(row.n), 'num dim');
    if (row.line) numTd.title = `Line ${row.line} of the file`;
    tr.appendChild(numTd);
    tr.appendChild(cell(row.mls || '—', 'num'));

    /* Status */
    const stTd = document.createElement('td');
    if (row.statusColor) {
      const sw = document.createElement('span');
      sw.className = 'review-swatch';
      sw.style.background = colorHex(row.statusColor);
      sw.title = colorHex(row.statusColor);
      stTd.appendChild(sw);
    }
    const sel = document.createElement('select');
    sel.className = 'field field--status field--mono';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— set —';
    sel.appendChild(blank);
    for (const code of STATUS_TOKENS) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = code;
      sel.appendChild(opt);
    }
    /* An export can carry a code this app does not know. It is shown as the
     * file wrote it — a select that cannot hold the value would show "— set —"
     * and make a row that WAS read look like one that was not. */
    if (row.status && !STATUS_TOKENS.includes(row.status)) {
      const opt = document.createElement('option');
      opt.value = row.status;
      opt.textContent = bucketForStatus(row.status, statusMapping) === 'unclassified'
        ? `${row.status} (unknown)` : row.status;
      sel.appendChild(opt);
    }
    sel.value = row.status || '';
    if (!row.status && row.statusRanked && row.statusRanked.length) {
      sel.title = 'Best guesses: ' +
        row.statusRanked.slice(0, 3).map(r => `${r.text} ${r.mean.toFixed(2)}`).join(', ') +
        (row.statusReject ? ` — rejected because ${row.statusReject}` : '');
    }
    sel.addEventListener('change', () => {
      row.status = sel.value || null;
      markEdited(row);
      recompute();
    });
    stTd.appendChild(sel);
    tr.appendChild(stTd);

    /* Bucket */
    const bTd = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `bucket-pill bucket-pill--${row.omit ? 'excluded' : (bucketId || 'unread')}`;
    pill.textContent = row.omit ? 'skipped'
      : (bucketId ? (BUCKETS.find(b => b.id === bucketId) || {}).short : 'unread');
    bTd.appendChild(pill);
    tr.appendChild(bTd);

    tr.appendChild(priceCell(row, 'origPrice'));
    tr.appendChild(priceCell(row, 'listPrice'));
    tr.appendChild(priceCell(row, 'soldPrice'));
    tr.appendChild(priceCell(row, 'concessions'));
    tr.appendChild(daysCell(row));

    /* Counted price */
    const countedTd = document.createElement('td');
    countedTd.className = 'num';
    if (row.omit || !bucketId || bucketId === 'excluded' || bucketId === 'unclassified') {
      countedTd.innerHTML = '<span class="dim">—</span>';
    } else if (entry && entry.price != null) {
      countedTd.textContent = formatPrice(entry.price);
    } else {
      countedTd.innerHTML = '<span style="color:var(--error)">no price</span>';
    }
    tr.appendChild(countedTd);

    /* Sale / list ratio */
    const ratioTd = document.createElement('td');
    ratioTd.className = 'num';
    const ratio = saleToListRatio(row);
    if (bucketId === 'closed' && ratio != null) {
      ratioTd.textContent = formatRatio(ratio);
      ratioTd.title =
        `(${formatPrice(row.soldPrice)} − ${formatPrice(row.concessions || 0)}) ÷ ` +
        `${formatPrice(row.origPrice)}`;
    } else if (bucketId === 'closed') {
      ratioTd.innerHTML = '<span class="dim">—</span>';
      ratioTd.title = row.origPrice ? 'No sold price read' : 'No original list price read';
    } else {
      ratioTd.innerHTML = '<span class="dim"></span>';
    }
    tr.appendChild(ratioTd);

    /* Confidence */
    const conf = document.createElement('td');
    conf.className = 'num dim';
    if (row.edited) conf.textContent = 'edited';
    else if (row.status && row.statusScore == null) conf.textContent = 'text';
    else if (row.status) conf.textContent = row.statusScore.toFixed(2);
    else conf.textContent = '—';
    if (!row.edited && row.status && row.statusScore != null && row.statusScore < 0.65) {
      conf.style.color = 'var(--warning)';
    }
    tr.appendChild(conf);

    reviewBody.appendChild(tr);
  }
}

/** One place decides whether a row carries a hand correction. */
function markEdited(row) {
  row.edited = ['status', 'listPrice', 'origPrice', 'soldPrice', 'concessions', 'marketTime']
    .some(k => row[k] !== row.original[k]);
}

/** Find the report entry produced for a given source row. */
function findReportEntry(report, row) {
  for (const id of Object.keys(report.buckets)) {
    for (const e of report.buckets[id]) if (e.n === row.n) return e;
  }
  return null;
}

function cell(text, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text;
  return td;
}

function priceCell(row, key) {
  const td = document.createElement('td');
  td.className = 'num';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'field field--price field--mono';
  input.value = fieldValue(row[key]);
  input.placeholder = '—';
  input.addEventListener('change', () => {
    const parsed = parseMoneyInput(input.value, key);
    if (parsed.error) {
      input.classList.add('is-invalid');
      input.title = parsed.error;
      showStatus(parsed.error, 'error');
      return;                       /* keep what the user typed so they can fix it */
    }
    input.classList.remove('is-invalid');
    input.title = '';
    row[key] = parsed.value;
    input.value = fieldValue(row[key]);
    markEdited(row);
    recompute();
  });
  td.appendChild(input);
  return td;
}

/**
 * The market-time cell.
 *
 * Editable for the same reason the price cells are: a cell the recognizer
 * refused is what makes the reading provisional, and typing the two digits off
 * the screenshot is how the appraiser clears it. Without this the median days
 * on market would be uncorrectable, and one smudged cell would disable copying
 * with nothing the user could do about it.
 */
function daysCell(row) {
  const td = document.createElement('td');
  td.className = 'num';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'field field--days field--mono';
  input.value = row.marketTime === null || row.marketTime === undefined
    ? '' : String(row.marketTime);
  input.placeholder = '—';
  const HINT = 'Market time in days, from the MT column';
  input.title = HINT;
  input.addEventListener('change', () => {
    const parsed = parseDaysInput(input.value);
    if (parsed.error) {
      input.classList.add('is-invalid');
      input.title = parsed.error;
      showStatus(parsed.error, 'error');
      return;                       /* keep what the user typed so they can fix it */
    }
    input.classList.remove('is-invalid');
    input.title = HINT;
    row.marketTime = parsed.value;
    input.value = row.marketTime === null ? '' : String(row.marketTime);
    markEdited(row);
    recompute();
  });
  td.appendChild(input);
  return td;
}

/**
 * Parse a typed market time.
 *
 * Whole days only, held to the same bounds the recognizer holds a read cell to,
 * so a hand correction cannot put a value into the median that the reader
 * itself would have refused.
 */
function parseDaysInput(raw) {
  const text = String(raw).trim();
  if (!text) return { value: null };
  const cleaned = text.replace(/[\s,]/g, '');
  if (!/^\d+$/.test(cleaned)) {
    return { error: `"${text}" is not a number of days. Enter whole days, e.g. 44.` };
  }
  const value = parseInt(cleaned, 10);
  if (!isFinite(value) || value > CFG.MT_MAX_DAYS) {
    return { error: `${text} days is outside the range this tool accepts ` +
                    `(0–${CFG.MT_MAX_DAYS}). Check for a stray digit.` };
  }
  return { value };
}

/**
 * Parse a typed or pasted price.
 *
 * connectMLS copies prices as "$425,000.00". Stripping every non-digit turns
 * that into 42,500,000 — a hundredfold error that changes a bucket's high with
 * nothing on screen to suggest anything went wrong. The cents are dropped, and
 * the same magnitude bounds the recognizer applies are applied here.
 */
function parseMoneyInput(raw, kind) {
  const text = String(raw).trim();
  if (!text) return { value: null };

  const cleaned = text.replace(/[\s$,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return { error: `"${text}" is not an amount. Enter digits, e.g. 425000.` };
  }

  /* Concessions are the one figure that legitimately carries cents and can be
   * small — connectMLS writes them as 9978.71 — so they keep their decimals
   * and are not held to a price's minimum. */
  const isConcessions = kind === 'concessions';
  const parsed = parseFloat(cleaned);
  const value = isConcessions ? Math.round(parsed * 100) / 100 : Math.round(parsed);
  if (!isFinite(value)) return { error: `"${text}" is not an amount.` };

  const min = isConcessions ? 0 : CFG.PRICE_MIN_VALUE;
  if (value < min || value > CFG.PRICE_MAX_VALUE) {
    return {
      error: `${formatPrice(value)} is outside the range this tool accepts ` +
             `(${formatPrice(min)}–${formatPrice(CFG.PRICE_MAX_VALUE)}). ` +
             `Check for a stray digit or a pasted cents value.`,
    };
  }
  return { value };
}

/** Display an amount in a review-table field, keeping cents where they exist. */
function fieldValue(v) {
  if (v === null || v === undefined) return '';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function allRowsAsTsv(report) {
  const lines = ['#\tMLS #\tStatus\tCategory\tOrig List\tList Price\tSold Price\tConcessions\t' +
                 'MT\tCounted\tSale/List'];
  for (const row of rows) {
    const entry = findReportEntry(report, row);
    const bucketId = row.omit ? 'skipped'
      : (row.status ? bucketForStatus(row.status, statusMapping) : 'unread');
    const ratio = bucketId === 'closed' ? saleToListRatio(row) : null;
    lines.push([
      row.index != null ? row.index : row.n,
      row.mls || '',
      row.status || '',
      bucketId,
      row.origPrice != null ? row.origPrice : '',
      row.listPrice != null ? row.listPrice : '',
      row.soldPrice != null ? row.soldPrice : '',
      row.concessions != null ? row.concessions : '',
      row.marketTime != null ? row.marketTime : '',
      entry && entry.price != null ? entry.price : '',
      ratio != null ? formatRatio(ratio) : '',
    ].join('\t'));
  }
  return lines.join('\n');
}

/* ================================================================== */
/*  The UAD 3.6 form panel                                             */
/* ================================================================== */

/**
 * The form's own fields, laid out the way the form lays them out.
 *
 * The panel answers the question the appraiser is actually sitting in front
 * of — what goes in each box. So it copies ONE field at a time, and what
 * it copies is the bare number that field takes: the form draws the "$" outside
 * the input and groups the digits itself, and a numeric field that rejects
 * "189,900" while accepting "189900" is far commoner than the reverse.
 *
 * The fields themselves come from uadFields() in stats.js, which is also what
 * the copied text block is built from — one source, so the panel and the
 * clipboard cannot disagree about a number.
 */
/* Which of the form's two columns each block sits in. The form runs its left
 * column continuously — pending sales begin directly under the last list price
 * — so the panel is built as two columns of blocks rather than as a grid of
 * shared rows, where the taller right column would push a gap in above
 * pending. A group with no entry here falls to the left. */
const UAD_COLUMN_OF = { active: 'left', pending: 'left', sales: 'right' };

function renderUad(report) {
  uadGrid.innerHTML = '';
  const fields = uadFields(report);

  const columns = { left: document.createElement('div'), right: document.createElement('div') };
  columns.left.className = 'uad-column';
  columns.right.className = 'uad-column';
  uadGrid.append(columns.left, columns.right);

  /* Per-field copy is off while the reading is provisional: a bare number has
   * nowhere to carry the caveat. */
  const blocked = report.provisional;

  for (const g of UAD_GROUPS) {
    const mine = fields.filter(f => f.group === g.id);
    if (!mine.length) continue;

    const box = document.createElement('div');
    box.className = `uad-group uad-group--${g.id}`;

    const title = document.createElement('div');
    title.className = 'uad-group__title';
    title.textContent = g.title;
    box.appendChild(title);

    for (const f of mine) box.appendChild(uadFieldRow(f, blocked));
    columns[UAD_COLUMN_OF[g.id] || 'left'].appendChild(box);
  }

  if (blocked) {
    uadProvisional.textContent =
      'Provisional — copying is off until this reading is complete: ' +
      report.provisionalReasons.join('; ') +
      '. Fix them in the table below; the fields here update as you go.';
    uadProvisional.classList.remove('hidden');
  } else {
    uadProvisional.classList.add('hidden');
  }

  uadCopyAll.disabled = blocked;
}

function uadFieldRow(field, blocked) {
  const row = document.createElement('div');
  row.className = 'uad-field' + (field.value === null ? ' uad-field--empty' : '');

  const label = document.createElement('span');
  label.className = 'uad-field__label';
  /* Every label is printed, including one that repeats its block's heading.
   * The form works the same way — "Active Listings" IS the row with the count
   * beside it, not a caption above one — and the stylesheet hides the block
   * heading wherever the first field already says it. */
  label.textContent = field.label;
  row.appendChild(label);

  row.appendChild(uadCopyButton(field, blocked));

  if (field.note) {
    const note = document.createElement('span');
    note.className = 'uad-field__note';
    note.textContent = field.note;
    row.appendChild(note);
  }
  return row;
}

function uadCopyButton(field, blocked) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'uad-field__value';
  btn.disabled = field.value === null || blocked;

  const val = document.createElement('span');
  val.className = 'uad-field__num';
  val.textContent = field.display;
  btn.appendChild(val);

  if (field.unit) {
    const unit = document.createElement('span');
    unit.className = 'uad-field__unit';
    unit.textContent = field.unit;
    btn.appendChild(unit);
  }

  btn.title = field.value === null
    ? `${field.label} could not be read from this screenshot.`
    : blocked
      ? 'Copying is off until the reading above is complete.'
      : `Copy ${field.value} — ${field.label}`;
  btn.setAttribute('aria-label', btn.title);

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const ok = await copyToClipboard(field.value);
    btn.classList.toggle('is-copied', ok);
    announce(ok ? `${field.label} copied: ${field.value}` : 'Copy failed.');
    setTimeout(() => btn.classList.remove('is-copied'), 1400);
  });
  return btn;
}

/** One live region, so a copy is announced to a screen reader once. */
function announce(message) {
  if (!uadLive) return;
  uadLive.textContent = message;
  clearTimeout(announce._t);
  announce._t = setTimeout(() => { uadLive.textContent = ''; }, 3000);
}

/* ================================================================== */
/*  Small helpers                                                      */
/* ================================================================== */

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    try {
      box.select();
      return document.execCommand('copy');
    } catch (e) {
      return false;
    } finally {
      box.remove();
    }
  }
}

function showStatus(message, type) {
  statusArea.textContent = message;
  statusArea.className = `status status--${type}`;
  statusArea.classList.remove('hidden');
}

function clearStatus() {
  statusArea.className = 'status hidden';
  statusArea.textContent = '';
}

function setProgress(pct, msg) {
  progressFill.style.width = `${pct}%`;
  progressPct.textContent = `${Math.round(pct)}%`;
  if (msg) progressMsg.textContent = msg;
}

/* ================================================================== */
/*  Test surface                                                       */
/* ================================================================== */

window.UAD = {
  handleImageFile,
  handleFile,
  handleTableText,
  runAnalysis,
  reset: resetState,
  getRows: () => rows,
  getReport: () => lastReport,
  getResult: () => lastResult,
  setMapping: (m) => { statusMapping = Object.assign(defaultStatusMapping(), m); recompute(); },
  getMapping: () => statusMapping,
  setRow: (n, patch) => {
    const row = rows.find(r => r.n === n);
    if (!row) return false;
    Object.assign(row, patch);
    row.edited = true;
    recompute();
    return true;
  },
  outputFor: (fmt) => {
    if (!lastReport) return '';
    if (fmt === 'tsv') return reportAsTsv(lastReport);
    if (fmt === 'rows') return allRowsAsTsv(lastReport);
    if (fmt === 'uad') return uadFieldsAsText(lastReport);
    return reportAsText(lastReport);
  },
  getFields: () => (lastReport ? uadFields(lastReport) : []),
};
