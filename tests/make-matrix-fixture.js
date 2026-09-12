/*
 * Builds the CoreLogic Matrix grid fixtures under tests/fixtures/.
 *
 * Re-rendered from tests/matrix-data.js at the geometry of the Cedar Rapids
 * screenshot the Matrix profile was built against: 13px Verdana at REGULAR
 * weight on a 23px pitch, a grey header of blue link-coloured labels with bold
 * sort arrows, alternating white and grey rows with white cell dividers, a
 * one-letter colour-coded status, and the MLS number and address drawn as
 * underlined links. The drag handle, checkbox and three icon columns to the
 * left of the MLS number are drawn too, because they are exactly the narrow
 * one-glyph columns that sit where a row-number column is looked for.
 *
 *   node tests/make-matrix-fixture.js          → the main Matrix grid
 *   node tests/make-matrix-fixture.js --all    → every Matrix variant
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const { MATRIX_LISTINGS, MATRIX_BUCKET } = require('./matrix-data.js');
const { expectedSummary } = require('./grid-data.js');

const OUT_DIR = path.join(__dirname, 'fixtures');

const BASE = { FONT_SIZE: 13, ROW_PITCH: 23, HEADER_H: 25, PAD_X: 4, GUTTER: 2, MARGIN: 6 };
let S = 1;
const px = v => v * S;

const FONT      = 'Verdana';
const INK       = '#1a1a1a';
const LINK      = '#1f5fa8';
const HEADER_BG = '#e6e6e6';
const HEADER_FG = '#2a70c0';
const ROW_SHADE = '#eeeeee';
const DIVIDER   = '#ffffff';
const PAGE      = '#ffffff';

const STATUS_COLOR = { S: '#d42a1f', A: '#2e8b2e', P: '#e0901a' };

const money = v => (v == null ? '' : '$' + v.toLocaleString('en-US'));

/**
 * Column definitions. `align` is l / c / r; `link` draws the text blue and
 * underlined; `clip` cuts the text at the cell edge the way Matrix truncates.
 */
const COLUMNS = [
  { key: 'drag',  header: '',           draw: 'drag',     width: 22 },
  { key: 'chk',   header: '',           draw: 'checkbox', width: 24, headerDraw: 'checkbox' },
  { key: 'n',     header: '',           align: 'l', get: l => String(l.n), width: 30 },
  { key: 'ico1',  header: '',           draw: 'photo',    width: 18, skip: l => l.n === 1 || l.n === 3 },
  { key: 'ico2',  header: '',           draw: 'map',      width: 18, skip: l => l.n === 1 },
  { key: 'ico3',  header: '',           draw: 'globe',    width: 18 },
  { key: 'mls',   header: 'ML #',       align: 'c', get: l => l.mls, link: true },
  { key: 'stat',  header: 'St',         align: 'c', get: l => l.stat, color: l => STATUS_COLOR[l.stat] || INK },
  { key: 'subty', header: 'SubTy',      align: 'c', get: l => l.subty },
  { key: 'area',  header: 'Area',       align: 'c', get: l => l.area },
  { key: 'city',  header: 'City/Town',  align: 'l', get: l => l.city },
  { key: 'addr',  header: 'Address',    align: 'l', get: l => l.address, link: l => l.n !== 1 },
  { key: 'sdate', header: 'Sold Date',  align: 'r', get: l => l.soldDate },
  /* Matrix leaves DOM blank rather than printing a zero when it has none. */
  { key: 'dom',   header: 'DOM',        align: 'r', get: l => (l.mt == null ? '' : String(l.mt)) },
  { key: 'sold',  header: 'Sold Price', align: 'r', get: l => money(l.sold), arrow: 'up' },
  { key: 'orig',  header: 'Orig Price', align: 'r', get: l => money(l.orig), arrow: 'down' },
  /* Present only in the list-price variant: the column the real layout lacks. */
  { key: 'list',  header: 'List Price', align: 'r', get: l => money(l.list), optional: true },
  { key: 'style', header: 'Style',      align: 'c', get: l => l.style, maxW: 96, clip: true },
  { key: 'yr',    header: 'Yr Blt',     align: 'r', get: l => String(l.yr) },
  { key: 'br',    header: 'BR',         align: 'c', get: l => String(l.br) },
  { key: 'baths', header: 'Baths',      align: 'c', get: l => l.baths },
];

function layout(listings, withList) {
  const probe = createCanvas(10, 10).getContext('2d');
  let x = px(BASE.MARGIN);
  const cols = [];
  for (const col of COLUMNS) {
    if (col.optional && !withList) continue;
    let w;
    if (col.width) {
      w = px(col.width);
    } else {
      probe.font = `${px(BASE.FONT_SIZE)}px ${FONT}`;
      w = Math.ceil(probe.measureText(col.header).width) + (col.arrow ? px(14) : 0);
      for (const l of listings) w = Math.max(w, Math.ceil(probe.measureText(col.get(l)).width));
      if (col.maxW) w = Math.min(w, px(col.maxW));
      w += px(BASE.PAD_X) * 2;
    }
    cols.push({ ...col, x, w });
    x += w + px(BASE.GUTTER);
  }
  return { cols, width: x + px(BASE.MARGIN) };
}

/**
 * opts:
 *   header    — draw the header row (default true)
 *   listPrice — draw a List Price column (the real layout has none)
 *   scale     — device scale, for a genuine 2x render
 */
function renderMatrix(listings, opts = {}) {
  const o = Object.assign({ header: true, listPrice: false, scale: 1 }, opts);
  S = o.scale;
  const use = layout(listings, o.listPrice);
  const headerH = o.header ? px(BASE.HEADER_H) : 0;
  const pitch = px(BASE.ROW_PITCH);
  const width = use.width;
  const height = headerH + listings.length * pitch + px(BASE.MARGIN);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, width, height);

  if (o.header) {
    for (const col of use.cols) {
      ctx.fillStyle = HEADER_BG;
      ctx.fillRect(col.x, 0, col.w, headerH - px(2));
    }
    ctx.font = `${px(BASE.FONT_SIZE)}px ${FONT}`;
    for (const col of use.cols) {
      if (col.headerDraw === 'checkbox') { drawCheckbox(ctx, col, headerH / 2); continue; }
      if (!col.header) continue;
      ctx.fillStyle = HEADER_FG;
      const tw = ctx.measureText(col.header).width + (col.arrow ? px(14) : 0);
      const tx = col.align === 'r' ? col.x + col.w - px(BASE.PAD_X) - tw
        : col.align === 'c' ? col.x + (col.w - tw) / 2 : col.x + px(BASE.PAD_X);
      ctx.fillText(col.header, tx, headerH / 2);
      if (col.arrow) drawArrow(ctx, tx + ctx.measureText(col.header).width + px(7), headerH / 2, col.arrow);
    }
  }

  listings.forEach((l, i) => {
    const top = headerH + i * pitch;
    const cy = top + pitch / 2;
    if (i % 2 === 1) {
      ctx.fillStyle = ROW_SHADE;
      ctx.fillRect(0, top, width, pitch);
      /* White dividers between the cells of a shaded row. */
      ctx.fillStyle = DIVIDER;
      for (const col of use.cols) ctx.fillRect(col.x + col.w, top, px(BASE.GUTTER), pitch);
    }

    for (const col of use.cols) {
      if (col.draw) {
        if (col.skip && col.skip(l)) continue;
        DRAW[col.draw](ctx, col, cy);
        continue;
      }
      const text = col.get(l);
      if (!text) continue;
      ctx.font = `${px(BASE.FONT_SIZE)}px ${FONT}`;
      const isLink = typeof col.link === 'function' ? col.link(l) : !!col.link;
      ctx.fillStyle = isLink ? LINK : (col.color ? col.color(l) : INK);
      ctx.save();
      if (col.clip) {
        ctx.beginPath();
        ctx.rect(col.x, top, col.w, pitch);
        ctx.clip();
      }
      const tw = ctx.measureText(text).width;
      const tx = col.align === 'r' ? col.x + col.w - px(BASE.PAD_X) - tw
        : col.align === 'c' ? col.x + Math.max(px(BASE.PAD_X), (col.w - tw) / 2) : col.x + px(BASE.PAD_X);
      ctx.fillText(text, tx, cy);
      if (isLink) ctx.fillRect(Math.round(tx), Math.round(cy + px(6)), Math.round(tw), Math.max(1, px(1)));
      ctx.restore();
    }
  });

  return canvas;
}

function drawCheckbox(ctx, col, cy) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(col.x + px(5), cy - px(7), px(14), px(14));
  ctx.strokeStyle = '#767676';
  ctx.lineWidth = px(1);
  ctx.beginPath();
  ctx.roundRect(col.x + px(5) + 0.5, cy - px(7) + 0.5, px(13), px(13), px(2));
  ctx.stroke();
}

function drawArrow(ctx, x, cy, dir) {
  ctx.strokeStyle = HEADER_FG;
  ctx.lineWidth = px(2);
  const s = dir === 'up' ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(x, cy - s * px(6));
  ctx.lineTo(x, cy + s * px(6));
  ctx.moveTo(x - px(4), cy + s * px(2));
  ctx.lineTo(x, cy + s * px(6.5));
  ctx.lineTo(x + px(4), cy + s * px(2));
  ctx.stroke();
}

const DRAW = {
  drag(ctx, col, cy) {
    ctx.fillStyle = '#8c8c8c';
    const x = col.x + px(4), w = px(14);
    ctx.beginPath();
    ctx.moveTo(x + w / 2, cy - px(9)); ctx.lineTo(x + w - px(3), cy - px(5)); ctx.lineTo(x + px(3), cy - px(5));
    ctx.closePath(); ctx.fill();
    for (const dy of [-3, 0, 3]) ctx.fillRect(x, cy + px(dy) - px(1), w, px(2));
    ctx.beginPath();
    ctx.moveTo(x + w / 2, cy + px(9)); ctx.lineTo(x + w - px(3), cy + px(5)); ctx.lineTo(x + px(3), cy + px(5));
    ctx.closePath(); ctx.fill();
  },
  checkbox: drawCheckbox,
  photo(ctx, col, cy) {
    ctx.fillStyle = '#3f7f3f';
    ctx.fillRect(col.x + px(2), cy - px(7), px(14), px(14));
    ctx.fillStyle = '#9fd4ff';
    ctx.fillRect(col.x + px(4), cy - px(5), px(10), px(6));
  },
  map(ctx, col, cy) {
    ctx.fillStyle = '#e8c84a';
    ctx.fillRect(col.x + px(2), cy - px(7), px(14), px(14));
    ctx.fillStyle = '#4c9a4c';
    ctx.fillRect(col.x + px(4), cy + px(1), px(10), px(4));
  },
  globe(ctx, col, cy) {
    ctx.strokeStyle = '#5a8fc8';
    ctx.lineWidth = px(2);
    ctx.beginPath();
    ctx.arc(col.x + px(9), cy, px(6), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#d9b44a';
    ctx.fillRect(col.x + px(7), cy - px(2), px(4), px(4));
  },
};

function write(name, canvas, listings, opts) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const png = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(png, canvas.toBuffer('image/png'));
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify({
    name,
    listings: listings.map(l => ({ n: l.n, mls: l.mls, stat: l.stat, list: l.list, sold: l.sold })),
    expected: expectedSummary(listings, MATRIX_BUCKET),
    opts: opts || {},
  }, null, 2));
  console.log(`Wrote ${png} (${canvas.width}×${canvas.height}, ${listings.length} rows)`);
}

/* The friend's layout plus the column it lacks: current list prices, with a
 * few actives reduced below their original price so a List/Orig mix-up shows,
 * and row 1's blank DOM filled so a complete reading can be proved to copy. */
function withListPrices(listings) {
  const cuts = { 22: 449000, 39: 509900, 46: 535000, 17: 435000 };
  return listings.map(l => ({
    ...l,
    list: l.stat === 'S' ? l.orig : (cuts[l.n] || l.orig),
    mt: l.n === 1 ? 5 : l.mt,
  }));
}

const VARIANTS = {
  /* The screenshot as the friend's Matrix actually lays it out. */
  matrix: () => write('matrix', renderMatrix(MATRIX_LISTINGS), MATRIX_LISTINGS),

  /* The same search with a List Price column added to the display. */
  'matrix-list-price': () => {
    const rows = withListPrices(MATRIX_LISTINGS);
    write('matrix-list-price', renderMatrix(rows, { listPrice: true }), rows, { listPrice: true });
  },

  /* A 2× (Retina) paste of the list-price layout. */
  'matrix-hidpi': () => {
    const rows = withListPrices(MATRIX_LISTINGS);
    write('matrix-hidpi', renderMatrix(rows, { listPrice: true, scale: 2 }), rows,
      { listPrice: true, scale: 2 });
  },

  /* Cropped below the header. A one-letter status is a column of single
   * glyphs, and at 13px S is 5, so it must NOT be read without its label. */
  'matrix-no-header': () => {
    const rows = withListPrices(MATRIX_LISTINGS);
    write('matrix-no-header', renderMatrix(rows, { listPrice: true, header: false }), rows,
      { listPrice: true, header: false });
  },
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const named = args.filter(a => !a.startsWith('--'));
  const wanted = args.includes('--all') ? Object.keys(VARIANTS) : (named.length ? named : ['matrix']);
  for (const name of wanted) {
    if (!VARIANTS[name]) {
      console.error(`Unknown fixture "${name}". Known: ${Object.keys(VARIANTS).join(', ')}`);
      process.exit(1);
    }
    VARIANTS[name]();
  }
}

module.exports = { renderMatrix, withListPrices };
