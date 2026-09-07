/*
 * Builds the connectMLS grid fixtures under tests/fixtures/.
 *
 * The user's original screenshot is not a file we have, so the grid is
 * re-rendered from tests/grid-data.js at connectMLS's real geometry: 11px
 * text on a 27px row pitch, bold colour-coded status codes, alternating row
 * shading, a bold header with a sort arrow, and Sold Pr / CONC / Closed Date
 * populated only on closed rows.
 *
 * Column widths are measured rather than hard-coded, so every gutter is a real
 * gutter — the layout cannot accidentally encode an assumption the recognizer
 * then "passes" on.
 *
 *   node tests/make-grid-fixture.js          → the main grid
 *   node tests/make-grid-fixture.js --all    → every variant
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const { LISTINGS, expectedSummary, DEFAULT_BUCKET } = require('./grid-data.js');

const OUT_DIR = path.join(__dirname, 'fixtures');

/* ---- Geometry, matching a 100%-zoom connectMLS grid ----
 * Everything is expressed at 1x and multiplied by the device scale, so the
 * HiDPI fixture is a genuine 2x render (crisper glyphs) rather than an
 * upscaled 1x one, which is what a Retina screenshot actually looks like. */
const BASE = { FONT_SIZE: 11, ROW_PITCH: 27, HEADER_H: 24, PAD_X: 6, GUTTER: 9, MARGIN: 10 };
let SCALE = 1;
let FONT_SIZE = BASE.FONT_SIZE, ROW_PITCH = BASE.ROW_PITCH, HEADER_H = BASE.HEADER_H;
let PAD_X = BASE.PAD_X, GUTTER = BASE.GUTTER, MARGIN = BASE.MARGIN;

function setScale(s) {
  SCALE = s;
  FONT_SIZE = BASE.FONT_SIZE * s;
  ROW_PITCH = BASE.ROW_PITCH * s;
  HEADER_H  = BASE.HEADER_H * s;
  PAD_X     = BASE.PAD_X * s;
  GUTTER    = BASE.GUTTER * s;
  MARGIN    = BASE.MARGIN * s;
}

const INK        = '#1a1a1a';
const HEADER_INK = '#2c3e50';
const RULE       = '#9aa0a6';
const SHADE      = '#f2f2f2';
const PAGE       = '#ffffff';

/* connectMLS colour-codes the Stat column. FIN, A/I and ACTV deliberately
 * share a colour here: clustering must separate them on shape alone. */
const STATUS_COLOR = {
  NEW:  '#00873c',
  PCHG: '#1a3fa0',
  ACTV: '#0b6b3a',
  TEMP: '#c62828',
  FIN:  '#0b6b3a',
  'A/I': '#0b6b3a',
  PEND: '#1565c0',
  CLSD: '#1a1a1a',
};

const money = v => (v == null ? '' : '$' + v.toLocaleString('en-US'));

/**
 * Column definitions. `get` returns the cell text for a listing; `align` is
 * 'l' or 'r'; `bold` and `color` are optional per-cell overrides.
 */
const COLUMNS = [
  { key: 'n',       header: '#',            align: 'r', get: l => String(l.n) },
  { key: 'chk',     header: '',             align: 'l', get: () => '',  draw: 'checkbox', width: () => 14 * SCALE },
  { key: 'pin',     header: '',             align: 'l', get: () => '',  draw: 'pin',      width: () => 12 * SCALE },
  { key: 'mls',     header: 'MLS #',        align: 'l', get: l => l.mls },
  { key: 'stat',    header: 'Stat▲',        align: 'l', get: l => l.stat, bold: true,
    color: l => STATUS_COLOR[l.stat] || INK },
  { key: 'city',    header: 'City',         align: 'l', get: () => 'Dolton' },
  { key: 'streetNo', header: 'Street #',    align: 'l', get: l => l.streetNo },
  { key: 'street',  header: 'Str Name',     align: 'l', get: l => l.street },
  { key: 'sfx',     header: 'Sfx',          align: 'l', get: l => l.sfx },
  { key: 'mt',      header: 'MT',           align: 'r', get: l => String(l.mt) },
  { key: 'closed',  header: 'Closed Date',  align: 'l', get: l => l.closed },
  { key: 'sold',    header: 'Sold Pr',      align: 'r', get: l => money(l.sold) },
  { key: 'conc',    header: 'CONC',         align: 'r',
    /* No thousands separator, and cents when the figure has them — which is
     * exactly how connectMLS writes seller concessions. */
    get: l => (l.conc == null ? '' : String(l.conc)) },
  { key: 'orig',    header: 'Orig List Pr', align: 'r', get: l => money(l.orig) },
  { key: 'list',    header: 'List Price',   align: 'r', get: l => money(l.list) },
  { key: 'rms',     header: '# Rms',        align: 'r', get: l => String(l.rms) },
  { key: 'asf',     header: 'ASF',          align: 'r', get: l => String(l.asf) },
  { key: 'yr',      header: 'Yr Blt',       align: 'r', get: l => String(l.yr) },
  { key: 'beds',    header: 'All Beds',     align: 'r', get: l => l.beds },
  { key: 'full',    header: '# Full Baths', align: 'r', get: l => String(l.full) },
  { key: 'half',    header: '# Half Baths', align: 'r', get: l => String(l.half) },
  { key: 'type',    header: 'Type',         align: 'l', get: l => l.type },
  { key: 'gar',     header: '# Garage',     align: 'r', get: l => l.gar },
];

/** Measure every column and lay the grid out left to right. */
function layout(listings) {
  const probe = createCanvas(10, 10).getContext('2d');
  let x = MARGIN;
  const cols = [];

  for (const col of COLUMNS) {
    let w = col.width ? col.width() : 0;
    if (!col.width) {
      probe.font = `bold ${FONT_SIZE}px Arial`;
      w = Math.ceil(probe.measureText(col.header).width);
      probe.font = `${col.bold ? 'bold ' : ''}${FONT_SIZE}px Arial`;
      for (const l of listings) {
        w = Math.max(w, Math.ceil(probe.measureText(col.get(l)).width));
      }
    }
    cols.push({ ...col, x, w: w + PAD_X * 2 });
    x += w + PAD_X * 2 + GUTTER;
  }

  return { cols, width: x - GUTTER + MARGIN };
}

/**
 * Render one grid.
 *
 * opts:
 *   header      — draw the header row (default true)
 *   selectedRow — index (0-based) of a row painted with the selection highlight
 *   grayscale   — desaturate the finished image
 *   font        — font family for every cell (default Arial)
 *   columns     — subset of column keys to draw
 */
function renderGrid(listings, opts = {}) {
  const o = Object.assign({ header: true, selectedRow: -1, grayscale: false, font: 'Arial', scale: 1 }, opts);
  setScale(o.scale);
  const use = o.columns ? layoutSubset(listings, o.columns) : layout(listings);
  const headerH = o.header ? HEADER_H : 0;
  const width = use.width;
  const height = headerH + listings.length * ROW_PITCH + MARGIN;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'middle';
  ctx.antialias = 'subpixel';

  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, width, height);

  /* Alternating row shading */
  for (let i = 0; i < listings.length; i++) {
    if (i % 2 === 0) continue;
    ctx.fillStyle = SHADE;
    ctx.fillRect(0, headerH + i * ROW_PITCH, width, ROW_PITCH);
  }

  /* Selection highlight, multiplied so the ink darkens with the fill the way a
   * real one does. */
  if (o.selectedRow >= 0 && o.selectedRow < listings.length) {
    ctx.fillStyle = '#cfe4f7';
    ctx.fillRect(0, headerH + o.selectedRow * ROW_PITCH, width, ROW_PITCH);
  }

  /* Header */
  if (o.header) {
    ctx.fillStyle = HEADER_INK;
    ctx.font = `bold ${FONT_SIZE}px ${o.font}`;
    for (const col of use.cols) {
      if (!col.header) continue;
      drawText(ctx, col.header, col, HEADER_H / 2 + SCALE);
    }
    ctx.fillStyle = RULE;
    ctx.fillRect(0, HEADER_H - 3 * SCALE, width, Math.max(1, SCALE));
  }

  /* Rows */
  listings.forEach((l, i) => {
    const cy = headerH + i * ROW_PITCH + ROW_PITCH / 2;

    for (const col of use.cols) {
      if (col.draw === 'checkbox') {
        ctx.strokeStyle = '#8a8a8a';
        ctx.lineWidth = 1;
        ctx.lineWidth = SCALE;
        ctx.strokeRect(col.x + PAD_X + 0.5, cy - 5.5 * SCALE, 10 * SCALE, 10 * SCALE);
        continue;
      }
      if (col.draw === 'pin') {
        ctx.fillStyle = '#1565c0';
        ctx.beginPath();
        ctx.arc(col.x + PAD_X + 5 * SCALE, cy - SCALE, 4 * SCALE, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(col.x + PAD_X + 1.6 * SCALE, cy + SCALE);
        ctx.lineTo(col.x + PAD_X + 8.4 * SCALE, cy + SCALE);
        ctx.lineTo(col.x + PAD_X + 5 * SCALE, cy + 6 * SCALE);
        ctx.closePath();
        ctx.fill();
        continue;
      }

      const text = col.get(l);
      if (!text) continue;
      ctx.font = `${col.bold ? 'bold ' : ''}${FONT_SIZE}px ${o.font}`;
      ctx.fillStyle = col.color ? col.color(l) : INK;
      drawText(ctx, text, col, cy);
    }
  });

  /* Paint out a Stat cell, leaving the rest of its row intact. A row that
   * still carries a row number, an MLS number and a sold price is
   * unmistakably a listing — the app must surface it as unreadable, never
   * delete it from the summary. */
  for (const i of (o.blankStat || [])) {
    const col = use.cols.find(c => c.key === 'stat');
    if (!col) continue;
    ctx.fillStyle = (i % 2 === 1) ? SHADE : PAGE;
    ctx.fillRect(col.x, headerH + i * ROW_PITCH + 2, col.w, ROW_PITCH - 4);
  }

  if (o.grayscale) desaturate(ctx, width, height);
  return canvas;
}

function drawText(ctx, text, col, cy) {
  if (col.align === 'r') {
    const w = ctx.measureText(text).width;
    ctx.fillText(text, col.x + col.w - PAD_X - w, cy);
  } else {
    ctx.fillText(text, col.x + PAD_X, cy);
  }
}

/** Layout restricted to a subset of columns (for the narrow-crop fixture). */
function layoutSubset(listings, keys) {
  const probe = createCanvas(10, 10).getContext('2d');
  let x = MARGIN;
  const cols = [];
  for (const col of COLUMNS) {
    if (!keys.includes(col.key)) continue;
    let w = col.width ? col.width() : 0;
    if (!col.width) {
      probe.font = `bold ${FONT_SIZE}px Arial`;
      w = Math.ceil(probe.measureText(col.header).width);
      probe.font = `${col.bold ? 'bold ' : ''}${FONT_SIZE}px Arial`;
      for (const l of listings) w = Math.max(w, Math.ceil(probe.measureText(col.get(l)).width));
    }
    cols.push({ ...col, x, w: w + PAD_X * 2 });
    x += w + PAD_X * 2 + GUTTER;
  }
  return { cols, width: x - GUTTER + MARGIN };
}

function desaturate(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
}

/* -------------------------------------------------------------------- */

/** Crop a rendered grid, cutting through a row at the top or bottom edge. */
function cropThroughRow(canvas, where) {
  const cut = Math.round(ROW_PITCH * 0.6);
  const w = canvas.width;
  const h = canvas.height - cut - Math.round(MARGIN);
  const out = createCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, w, h);
  /* 'top' slices the first data row; 'bottom' slices the last. */
  const sy = where === 'top' ? HEADER_H + cut : 0;
  ctx.drawImage(canvas, 0, sy, w, h, 0, 0, w, h);
  return out;
}

function write(name, canvas, listings, opts) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const png = path.join(OUT_DIR, `${name}.png`);
  const json = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(png, canvas.toBuffer('image/png'));
  fs.writeFileSync(json, JSON.stringify({
    name,
    listings: listings.map(l => ({
      n: l.n, mls: l.mls, stat: l.stat, list: l.list, sold: l.sold,
    })),
    expected: expectedSummary(listings, DEFAULT_BUCKET),
    opts: opts || {},
  }, null, 2));
  console.log(`Wrote ${png} (${canvas.width}×${canvas.height}, ${listings.length} rows)`);
}

const VARIANTS = {
  /* The reference grid: everything present, header included. */
  grid: () => write('grid', renderGrid(LISTINGS), LISTINGS),

  /* Cropped below the header — column roles must come from the data. */
  'grid-no-header': () =>
    write('grid-no-header', renderGrid(LISTINGS, { header: false }), LISTINGS, { header: false }),

  /* An all-active search: no closed rows, so no sold column is populated. */
  'grid-no-closed': () => {
    const rows = LISTINGS.filter(l => l.stat !== 'CLSD').map((l, i) => ({ ...l, n: i + 1 }));
    write('grid-no-closed', renderGrid(rows), rows);
  },

  /* An all-closed search: nothing active or pending. */
  'grid-all-closed': () => {
    const rows = LISTINGS.filter(l => l.stat === 'CLSD').map((l, i) => ({ ...l, n: i + 1 }));
    write('grid-all-closed', renderGrid(rows), rows);
  },

  /* One row highlighted by the user's click. */
  'grid-selected': () =>
    write('grid-selected', renderGrid(LISTINGS, { selectedRow: 8 }), LISTINGS, { selectedRow: 8 }),

  /* A greyscale paste — colour clustering must fall back to shape. */
  'grid-grayscale': () =>
    write('grid-grayscale', renderGrid(LISTINGS, { grayscale: true }), LISTINGS, { grayscale: true }),

  /* A different UI font, to prove the font is detected rather than assumed. */
  'grid-verdana': () =>
    write('grid-verdana', renderGrid(LISTINGS, { font: 'Verdana' }), LISTINGS, { font: 'Verdana' }),

  /* A narrow crop: just the columns that matter. */
  'grid-narrow': () =>
    write('grid-narrow',
      renderGrid(LISTINGS, { columns: ['n', 'mls', 'stat', 'sold', 'list'] }),
      LISTINGS, { columns: ['n', 'mls', 'stat', 'sold', 'list'] }),

  /* One row's Stat cell is blank, but the row is otherwise complete. */
  'grid-blank-stat': () => {
    const blanked = LISTINGS.length - 1;                    /* the last row, a CLSD sale */
    const canvas = renderGrid(LISTINGS, { blankStat: [blanked] });
    /* Ground truth is what the app may legitimately COUNT: everything except
     * the row whose status it cannot read. That row must still be listed. */
    const countable = LISTINGS.filter((_, i) => i !== blanked);
    write('grid-blank-stat', canvas, countable, { blankStat: [blanked], totalRows: LISTINGS.length });
  },

  /* Concessions with cents. connectMLS writes them without a thousands
   * separator but with a decimal, so a short mark in this column is a decimal
   * point, not a comma — and reading it as a comma multiplies it by a hundred. */
  'grid-decimal-conc': () => {
    const cents = { 17: 5000.25, 19: 9978.71, 23: 6147.5, 27: 1200.08 };
    const rows = LISTINGS.map(l => (cents[l.n] ? { ...l, conc: cents[l.n] } : l));
    write('grid-decimal-conc', renderGrid(rows), rows);
  },

  /* A handful of closed sales — few enough that each ratio is quoted. */
  'grid-few-closed': () => {
    const actives = LISTINGS.filter(l => l.stat !== 'CLSD');
    const closed = LISTINGS.filter(l => l.stat === 'CLSD').slice(0, 6);
    const rows = actives.concat(closed).map((l, i) => ({ ...l, n: i + 1 }));
    write('grid-few-closed', renderGrid(rows), rows);
  },

  /* Exactly one over the line, so the list must NOT appear. */
  'grid-eleven-closed': () => {
    const actives = LISTINGS.filter(l => l.stat !== 'CLSD');
    const closed = LISTINGS.filter(l => l.stat === 'CLSD').slice(0, 11);
    const rows = actives.concat(closed).map((l, i) => ({ ...l, n: i + 1 }));
    write('grid-eleven-closed', renderGrid(rows), rows);
  },

  /* A 2× (Retina) screenshot — every upscaled-pixel constant must rescale. */
  'grid-hidpi': () =>
    write('grid-hidpi', renderGrid(LISTINGS, { scale: 2 }), LISTINGS, { scale: 2 }),

  /* The screenshot cuts through the first data row. That row must be named as
   * unreadable, never silently dropped and never confidently misread. */
  'grid-clipped-top': () => {
    const full = renderGrid(LISTINGS);
    const rows = LISTINGS.slice(1).map((l, i) => ({ ...l, n: i + 2 }));
    write('grid-clipped-top', cropThroughRow(full, 'top'), rows, { clipped: 'top' });
  },

  /* …and through the last one. */
  'grid-clipped-bottom': () => {
    const full = renderGrid(LISTINGS);
    const rows = LISTINGS.slice(0, -1).map(l => ({ ...l }));
    write('grid-clipped-bottom', cropThroughRow(full, 'bottom'), rows, { clipped: 'bottom' });
  },

  /* Prices in the millions and under $100k, to exercise digit counts the
   * reference search never reaches. */
  'grid-wide-range': () => {
    const rows = LISTINGS.map((l, i) => {
      const scale = i % 5 === 0 ? 8 : (i % 7 === 0 ? 0.35 : 1);
      return {
        ...l,
        orig: Math.round(l.orig * scale / 100) * 100,
        list: Math.round(l.list * scale / 100) * 100,
        sold: l.sold == null ? null : Math.round(l.sold * scale / 100) * 100,
      };
    });
    write('grid-wide-range', renderGrid(rows), rows);
  },
};

const args = process.argv.slice(2);
const wanted = args.includes('--all') ? Object.keys(VARIANTS)
  : (args.filter(a => !a.startsWith('--')).length ? args.filter(a => !a.startsWith('--')) : ['grid']);

for (const name of wanted) {
  if (!VARIANTS[name]) {
    console.error(`Unknown fixture "${name}". Known: ${Object.keys(VARIANTS).join(', ')}`);
    process.exit(1);
  }
  VARIANTS[name]();
}

module.exports = { renderGrid, COLUMNS, STATUS_COLOR };
