/* ===== UAD 3.6 Helper — UI ============================================ */
/* Paste a connectMLS grid, read it once, then let the appraiser correct     */
/* anything the recognizer got wrong. Every correction recomputes the three  */
/* summary cards immediately, so the numbers on screen always match the      */
/* table below them.                                                         */
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
const clearBtn     = $('#clear-btn');
const extractBtn   = $('#extract-btn');
const outputBox    = $('#output-box');
const copyBtn      = $('#copy-btn');
const copyNote     = $('#copy-note');
const statusArea   = $('#status-area');
const progressWrap = $('#progress-container');
const progressFill = $('#progress-fill');
const progressPct  = $('#progress-pct');
const progressMsg  = $('#progress-msg');

const summaryCard  = $('#summary-card');
const summaryGrid  = $('#summary-grid');
const noticeList   = $('#notice-list');
const columnsCard  = $('#columns-card');
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
let currentImageBlob = null;
let lastResult = null;      /* raw pipeline output */
let rows = [];              /* editable working copy */
let statusMapping = defaultStatusMapping();
let outputFormat = 'text';
let lastReport = null;
/* Bumped on every new image. A run whose token is stale writes nothing: two
 * pastes in quick succession otherwise leave the slower image's numbers on
 * screen beside the newer image's preview, with copy enabled. */
let runToken = 0;

/* ================================================================== */
/*  Image input                                                        */
/* ================================================================== */

document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      handleImageFile(item.getAsFile());
      return;
    }
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) handleImageFile(fileInput.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) handleImageFile(e.dataTransfer.files[0]);
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
  copyBtn.innerHTML = ok ? '<span>✅</span> Copied' : '<span>⚠️</span> Copy failed';
  setTimeout(() => {
    copyBtn.classList.remove('copied');
    copyBtn.innerHTML = '<span>📋</span> Copy to Clipboard';
  }, 1600);
});

function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showStatus('That does not look like an image. Paste a PNG or JPG screenshot.', 'error');
    return;
  }

  /* Corrections are work. A stray Ctrl+V anywhere on the page would otherwise
   * throw them away silently, and there is no undo. */
  const edits = rows.filter(r => r.edited || r.omit).length;
  if (edits > 0 && !window.confirm(
    `You have corrected ${edits} row${edits === 1 ? '' : 's'} by hand. ` +
    `Replacing the screenshot discards those corrections. Continue?`)) {
    return;
  }

  if (previewImg.src && previewImg.src.startsWith('blob:')) URL.revokeObjectURL(previewImg.src);
  resetResults();
  currentImageBlob = file;
  previewImg.src = URL.createObjectURL(file);
  previewWrap.classList.remove('hidden');
  extractBtn.disabled = false;
  clearStatus();
  runAnalysis();
}

function resetResults() {
  lastResult = null;
  lastReport = null;
  rows = [];
  for (const card of [summaryCard, columnsCard, mappingCard, reviewCard, debugCard]) {
    card.classList.add('hidden');
  }
  outputBox.value = '';
  copyBtn.disabled = true;
}

function resetState() {
  placeInputCard('top');
  currentImageBlob = null;
  previewImg.src = '';
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
  const anchor = where === 'bottom' ? appFooter : summaryCard;
  if (inputCard.nextElementSibling !== anchor) appContainer.insertBefore(inputCard, anchor);
}

/** Bring the summary into view if the reorder left it off screen. */
function revealSummary() {
  const box = summaryCard.getBoundingClientRect();
  if (box.top >= 0 && box.top < window.innerHeight * 0.5) return;
  summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================================================================== */
/*  Analysis                                                           */
/* ================================================================== */

async function runAnalysis() {
  if (!currentImageBlob) return;

  const token = ++runToken;
  const stale = () => token !== runToken;
  const blob = currentImageBlob;

  extractBtn.disabled = true;
  resetResults();
  clearStatus();
  progressWrap.classList.remove('hidden');
  setProgress(0, 'Starting…');

  const perf = {};
  const t0 = performance.now();

  try {
    const img = await decodeImage(blob);
    if (stale()) return;
    const result = await extractGrid(img, (pct, msg) => { if (!stale()) setProgress(pct, msg); });
    if (stale()) return;
    perf.total = performance.now() - t0;

    lastResult = result;
    rows = result.rows.map((r, i) => ({
      n: i + 1,
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
      omit: false,
      edited: false,
      original: {
        status: r.status, listPrice: r.listPrice, origPrice: r.origPrice,
        soldPrice: r.soldPrice, concessions: r.concessions,
      },
    }));

    summaryCard.classList.remove('hidden');
    if (result.failed || rows.length === 0) {
      placeInputCard('top');
      renderNotices(result.warnings || []);
      summaryGrid.innerHTML = '';
      showStatus('No listings could be read from this image.', 'error');
      setProgress(100, 'Done');
      return;
    }

    for (const card of [columnsCard, mappingCard, reviewCard, debugCard]) {
      card.classList.remove('hidden');
    }
    placeInputCard('bottom');
    revealSummary();

    renderColumns(result);
    recompute();

    renderDebugOverlay($('#debug-canvas'), result);
    renderDebugClusters($('#debug-clusters'), result);
    renderDebugPerf($('#debug-perf'), result, perf);

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
    showStatus(`Analysis failed: ${err.message || 'the image could not be read'}`, 'error');
    setProgress(100, 'Failed');
  } finally {
    if (!stale()) {
      extractBtn.disabled = !currentImageBlob;
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
  renderSummary(lastReport);
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
  if (!copyNote) return;
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

/* ================================================================== */
/*  Rendering                                                          */
/* ================================================================== */

const NOTICE_ICON = { ok: '✅', info: 'ℹ️', warn: '⚠️', error: '⛔' };

function renderNotices(warnings) {
  noticeList.innerHTML = '';
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
            `not recognize. Set them in the table below, or add the code to the mapping.`,
    });
  }

  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  all.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));

  for (const w of all) {
    const el = document.createElement('div');
    el.className = `notice notice--${w.level}`;
    el.innerHTML = `<span class="notice__icon">${NOTICE_ICON[w.level] || 'ℹ️'}</span><span></span>`;
    el.lastElementChild.textContent = w.text;
    noticeList.appendChild(el);
  }
}

function renderSummary(report) {
  summaryGrid.innerHTML = '';

  for (const id of REPORTED_BUCKETS) {
    const meta = BUCKETS.find(b => b.id === id);
    const s = report.summary[id];
    const card = document.createElement('div');
    card.className = `stat-card stat-card--${id}`;

    const unit = id === 'active' ? (s.count === 1 ? 'listing' : 'listings')
                                 : (s.count === 1 ? 'sale' : 'sales');

    let html =
      `<div class="stat-card__label">${meta.label}</div>` +
      `<div class="stat-card__count">${s.count}` +
      `<span class="stat-card__count-unit">${unit}</span></div>`;

    if (s.priced > 0) {
      const source = BUCKET_PRICE_SOURCE[id] === 'sold' ? 'sold price' : 'list price';
      html +=
        `<div class="stat-card__stats">` +
          statLine('Low', formatPrice(s.low)) +
          statLine('High', formatPrice(s.high)) +
          statLine('Median', formatPrice(s.median), true) +
        `</div>` +
        `<div class="stat-card__empty">by ${source}</div>`;

      if (s.ratio) {
        html +=
          `<div class="stat-card__subhead" ` +
          `title="(sold price − concessions) ÷ original list price">Sale / list ratio</div>` +
          `<div class="stat-card__stats stat-card__stats--tight">` +
            statLine('Low', formatRatio(s.ratio.low)) +
            statLine('High', formatRatio(s.ratio.high)) +
            statLine('Median', formatRatio(s.ratio.median), true) +
          `</div>` +
          `<div class="stat-card__empty">net of concessions, against original list` +
          (s.ratio.missing ? ` · ${s.ratio.count} of ${s.count} rows` : '') + `</div>` +
          compListMarkup(s);
      }

      if (s.missing > 0) {
        html += `<div class="stat-card__note">${s.missing} row(s) had no readable price. ` +
                `They are counted but not priced.</div>`;
      }
    } else if (s.count > 0) {
      html += `<div class="stat-card__note">No prices could be read for these rows.</div>`;
    } else {
      html += `<div class="stat-card__empty">None in this search.</div>`;
    }

    card.innerHTML = html;
    summaryGrid.appendChild(card);
  }
}

/**
 * The individual sale-to-list ratios, comp by comp.
 *
 * Shown only for a small closed-sale set — see compLines() in stats.js for why
 * ten is the line. Every closed sale gets a row, including one with no ratio: a
 * comp missing from a numbered list would read as a comp that did not exist.
 */
function compListMarkup(s) {
  if (!s.ratio || !s.count || s.count > CFG.COMP_LIST_MAX) return '';

  const rows = s.items.map(item => {
    const value = item.ratio === null
      ? '<span class="dim">—</span>'
      : formatRatio(item.ratio);
    const title = item.ratio === null
      ? 'No original list price for this sale'
      : `${formatPrice(item.price)} net of concessions, against the original list price` +
        (item.mls ? ` · MLS ${item.mls}` : '');
    return `<div class="stat-line" title="${title}">` +
           `<span class="stat-line__key">Comp ${item.n}</span>` +
           `<span class="stat-line__val">${value}</span></div>`;
  }).join('');

  return `<div class="stat-card__subhead">Each sale</div>` +
         `<div class="stat-card__stats stat-card__stats--tight">${rows}</div>`;
}

function statLine(key, val, emphasize) {
  return `<div class="stat-line${emphasize ? ' stat-line--median' : ''}">` +
         `<span class="stat-line__key">${key}</span>` +
         `<span class="stat-line__val">${val}</span></div>`;
}

function renderColumns(result) {
  columnMap.innerHTML = '';
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

    tr.appendChild(cell(row.index != null ? String(row.index) : String(row.n), 'num dim'));
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
    else if (row.status) conf.textContent = row.statusScore.toFixed(2);
    else conf.textContent = '—';
    if (!row.edited && row.status && row.statusScore < 0.65) conf.style.color = 'var(--warning)';
    tr.appendChild(conf);

    reviewBody.appendChild(tr);
  }
}

/** One place decides whether a row carries a hand correction. */
function markEdited(row) {
  row.edited = ['status', 'listPrice', 'origPrice', 'soldPrice', 'concessions']
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

function renderOutput() {
  if (!lastReport) return;
  if (outputFormat === 'tsv') outputBox.value = reportAsTsv(lastReport);
  else if (outputFormat === 'rows') outputBox.value = allRowsAsTsv(lastReport);
  else outputBox.value = reportAsText(lastReport);
}

function allRowsAsTsv(report) {
  const lines = ['#\tMLS #\tStatus\tCategory\tOrig List\tList Price\tSold Price\tConcessions\t' +
                 'Counted\tSale/List'];
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
      entry && entry.price != null ? entry.price : '',
      ratio != null ? formatRatio(ratio) : '',
    ].join('\t'));
  }
  return lines.join('\n');
}

/* ================================================================== */
/*  Small helpers                                                      */
/* ================================================================== */

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    try {
      outputBox.select();
      document.execCommand('copy');
      return true;
    } catch (e) {
      return false;
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
    return reportAsText(lastReport);
  },
};
