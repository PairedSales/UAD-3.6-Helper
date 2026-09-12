/* ===== UAD 3.6 Helper — Grid Analysis ================================= */
/* Turns a pasted connectMLS screenshot into rows of                        */
/* { status, listPrice, origPrice, soldPrice, concessions }.                 */
/*                                                                          */
/* The one structural departure from MLS-Extract: that project crops to a    */
/* single column and reads it, because an MLS number lives in exactly one    */
/* place. This app needs five columns at once and must keep them aligned     */
/* row-for-row, so it never crops. It reads every run of ink on every row,   */
/* then groups those runs into columns by horizontal overlap.                */
/*                                                                          */
/* Reading first and grouping afterwards matters: "Orig List Pr" and "List   */
/* Price" sit a few source pixels apart, closer than any column-gutter       */
/* heuristic can reliably separate, but their cells never overlap — so       */
/* overlap-grouping tells them apart where a gutter threshold would fuse     */
/* them and silently summarize the wrong money.                              */
/* ===================================================================== */

/**
 * Build the working surface from a source image.
 *
 * Keeps the upscaled RGB canvas alongside the grayscale one: connectMLS
 * colour-codes the status column, and that colour is useful evidence for
 * grouping identical status cells.
 */
function buildSurface(img, scale) {
  const k = scale || CFG.UPSCALE;
  setWorkScale(k);
  let src = canvasFromImage(img);

  /* A 2× HiDPI paste upscaled 4× is ~90 megapixels per canvas, and Chrome
   * fails that allocation by returning transparent black from getImageData
   * rather than by throwing — which downstream looks exactly like an empty
   * page. Downscale first and say so. */
  let downscaled = 0;
  const mpx = (src.width * src.height * k * k) / 1e6;
  if (mpx > CFG.MAX_UPSCALED_MPX) {
    const factor = Math.sqrt(CFG.MAX_UPSCALED_MPX / mpx);
    const w = Math.max(1, Math.round(src.width * factor));
    const h = Math.max(1, Math.round(src.height * factor));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    downscaled = factor;
    src = c;
  }

  const up = k === 1 ? cloneCanvas(src) : upscaleCanvas(src, k);

  /* Colour is sampled from the SOURCE canvas, not an upscaled copy of it.
   * Only the status cells need colour, they are a few hundred pixels each, and
   * an upscaled clone of a full grid is ~96 MB that has to be allocated and
   * copied before anything else can start. Callers divide by CFG.UPSCALE. */
  const rgb = src;

  toGrayscale(up);
  const shadedBands = normalizeShadedBands(up);
  const gray = cloneCanvas(up);

  const work = cloneCanvas(up);
  const thr = binarize(work);
  const W = work.width, H = work.height;

  const rawBin = getBinary(work);
  const stripped = stripTableRules(rawBin, W, H);
  const bin = stripped.bin;

  /* A grayscale copy with the table rules whitened out.
   *
   * stripTableRules erases rules from the BINARY, which is all the full-page
   * path needs. But the compaction crops from the grayscale canvas, and a rule
   * that was full-span across the page is no longer full-span once the columns
   * either side of it are removed — so it survives into the compacted surface
   * and reappears as a stray row band. Whitening it here means the pixels the
   * crop inherits already agree with the binary about what is content. */
  const grayClean = cloneCanvas(gray);
  {
    const gctx = grayClean.getContext('2d', { willReadFrequently: true });
    const gimg = gctx.getImageData(0, 0, W, H);
    let n = 0;
    for (let i = 0; i < rawBin.length; i++) {
      if (rawBin[i] === 0 && bin[i] === 1) {
        gimg.data[i * 4] = gimg.data[i * 4 + 1] = gimg.data[i * 4 + 2] = 255;
        n++;
      }
    }
    if (n) gctx.putImageData(gimg, 0, 0);
  }

  const findBands = () =>
    classifyBands(findRows(hProjection(bin, W, H), W, CFG.MIN_ROW_DENSITY), k, H);
  let bands = findBands();

  const surf = {
    src, rgb, gray, grayClean, bin, W, H, scale: k,
    rows: bands.rows, rawRows: bands.rawRows, droppedRows: bands.droppedRows,
    medH: medianRowHeight(bands.rows), thr, shadedBands,
    rulesRemoved: stripped.removed, downscaled,
  };
  surf.glyphW = measureGlyphWidth(surf);

  /* Link underlines, then everything that depends on where the ink is. */
  const underlined = stripUnderlines(surf);
  if (underlined) {
    bands = findBands();
    surf.rows = bands.rows;
    surf.rawRows = bands.rawRows;
    surf.droppedRows = bands.droppedRows;
    surf.medH = medianRowHeight(bands.rows);
    surf.glyphW = measureGlyphWidth(surf);
  }
  surf.underlinesRemoved = underlined;
  const rows = surf.rows, rawRows = surf.rawRows, droppedRows = surf.droppedRows, medH = surf.medH;

  console.log(`[Grid] ${src.width}×${src.height} → ${W}×${H}; Otsu ${thr}; ` +
    `${rawRows.length} raw rows → ${rows.length} kept (${droppedRows.length} out of range); ` +
    `medH ${medH}; glyphW ${surf.glyphW}; ${shadedBands.length} shaded band(s); ` +
    `${stripped.removed} rule px stripped` + (underlined ? `; ${underlined} underline px stripped` : '') +
    (downscaled ? `; downscaled ×${downscaled.toFixed(2)}` : ''));

  return surf;
}

/**
 * Sort the raw ink bands into table rows and bands that are not rows.
 *
 * A band too short to be a row is usually a fragment of the row it touches,
 * not a row of its own. At 13px Verdana the tail of a comma and the foot of a
 * '$' hang a pixel below the digits, and on a shaded row the anti-aliased
 * pixel joining them to the glyph falls just under the threshold — so every
 * shaded row of a Matrix grid used to shed a one-pixel band, each one counted
 * as a row that could not be read, blocking the copy on a grid that had lost
 * nothing.
 *
 * So a sliver that sits right against a real row is folded INTO that row, and
 * its ink is then read with the glyphs it belongs to. "Sliver" and "right
 * against" are both fractions of the median row height, never pixel counts: a
 * comma tail is one pixel on a 1x paste and two or three on a Retina one, and
 * a source-pixel bar that absorbed the first shed every row of the second. Anything else out of range is still
 * dropped and still counted: a band that is not beside a row is not a
 * descender, a band that is too tall is not one either, and a sliver touching
 * the top or bottom of the image may be all that is left of a row the
 * screenshot cut off — which is a loss, and has to stay visible as one.
 */
function classifyBands(rawRows, k, H) {
  const minH = k * 5;
  const maxH = k * 30;

  const rows = rawRows.filter(r => r.h >= minH && r.h <= maxH).map(r => ({ y: r.y, h: r.h }));
  const hs = rows.map(r => r.h).sort((a, b) => a - b);
  const medH = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
  const maxFrag = Math.max(1, Math.round(medH * CFG.FRAGMENT_MAX_ROW_FRAC));
  const maxGap = Math.max(1, Math.round(medH * CFG.FRAGMENT_GAP_ROW_FRAC));
  const droppedRows = [];
  let absorbed = 0;

  for (const r of rawRows) {
    if (r.h >= minH && r.h <= maxH) continue;
    let host = null;
    const atEdge = r.y <= 1 || r.y + r.h >= H - 1;
    if (r.h <= maxFrag && !atEdge) {
      for (const row of rows) {
        const gap = r.y >= row.y + row.h ? r.y - (row.y + row.h) : row.y - (r.y + r.h);
        if (gap >= 0 && gap <= maxGap && (!host || gap < host.gap)) host = { row, gap };
      }
    }
    if (!host) { droppedRows.push(r); continue; }
    const y0 = Math.min(host.row.y, r.y);
    const y1 = Math.max(host.row.y + host.row.h, r.y + r.h);
    host.row.y = y0;
    host.row.h = y1 - y0;
    absorbed++;
  }

  return { rawRows, rows, droppedRows, absorbed };
}

/**
 * Erase link underlines, in the binary and in the clean grayscale.
 *
 * Matrix draws the MLS number and the address as underlined links. An
 * underline is not a table rule — it spans one cell, not the page, so
 * stripTableRules rightly leaves it — but it does two kinds of damage. It
 * joins every digit of the number into one run of ink, so the number cannot be
 * segmented; and in the compacted surface, where it sits a pixel below its
 * digits, it is a sliver of a band of its own, counted as a row that could not
 * be read and so blocking the copy on a grid that had lost nothing.
 *
 * What makes a run an underline is unambiguous at any scale: it is several
 * GLYPHS long, which no stroke inside a character ever is, and it is as thin
 * as a hairline across most of its length. Where a descender crosses it the
 * ink is thick; those columns are left alone, so no letter loses its tail.
 *
 * Returns the number of pixels erased.
 */
function stripUnderlines(surf) {
  const { bin, W, H, grayClean } = surf;
  const minRun = Math.round(surf.glyphW * CFG.UNDERLINE_MIN_GLYPHS);
  const maxThick = Math.max(1, Math.round(surf.scale * CFG.UNDERLINE_MAX_THICK_SRC));
  if (minRun < 4) return 0;

  const erase = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (bin[y * W + x] !== 0) { x++; continue; }
      const x0 = x;
      while (x < W && bin[y * W + x] === 0) x++;
      if (x - x0 < minRun) continue;
      /* Only the top row of a thin run starts one; the rows beneath it belong
       * to the same line and are handled with it. */
      let thin = 0;
      const cols = [];
      for (let cx = x0; cx < x; cx++) {
        if (y > 0 && bin[(y - 1) * W + cx] === 0) { cols.push(null); continue; }
        let t = 0;
        while (y + t < H && bin[(y + t) * W + cx] === 0) t++;
        if (t <= maxThick) { thin++; cols.push(t); } else cols.push(null);
      }
      if (thin / (x - x0) < CFG.UNDERLINE_MIN_THIN_FRAC) continue;
      for (let i = 0; i < cols.length; i++) if (cols[i]) erase.push([x0 + i, y, cols[i]]);
    }
  }
  if (!erase.length) return 0;

  const gctx = grayClean.getContext('2d', { willReadFrequently: true });
  const gimg = gctx.getImageData(0, 0, W, H);
  let n = 0;
  for (const [x, y, t] of erase) {
    for (let dy = 0; dy < t; dy++) {
      const i = (y + dy) * W + x;
      if (bin[i] === 0) { bin[i] = 1; n++; }
      gimg.data[i * 4] = gimg.data[i * 4 + 1] = gimg.data[i * 4 + 2] = 255;
    }
    /* The anti-aliased fringe the threshold did not count as ink would
     * otherwise come back as ink once the crop is upscaled and re-thresholded. */
    for (const yy of [y - 1, y + t]) {
      if (yy < 0 || yy >= H) continue;
      const i = yy * W + x;
      if (bin[i] !== 0) gimg.data[i * 4] = gimg.data[i * 4 + 1] = gimg.data[i * 4 + 2] = 255;
    }
  }
  gctx.putImageData(gimg, 0, 0);
  return n;
}

/**
 * Median ink width of a single glyph, in upscaled px.
 *
 * Every horizontal threshold in this file is expressed as a multiple of this,
 * so the same code works on a 100%-zoom screenshot and a 2× HiDPI one. A
 * fixed pixel constant is correct at exactly one scale.
 */
function measureGlyphWidth(surf) {
  const widths = [];
  const step = Math.max(1, Math.floor(surf.rows.length / 8));
  for (let i = 0; i < surf.rows.length; i += step) {
    const row = surf.rows[i];
    const vP = vProjection(surf.bin, surf.W, row.y, row.h);
    for (const s of findSegmentsRaw(vP, 1)) widths.push(s.w);
    if (widths.length > 900) break;
  }
  if (!widths.length) return surf.scale * 5;
  widths.sort((a, b) => a - b);
  /* The 65th percentile, not the median: commas, periods and '1' pull the
   * median below a representative letter. */
  return Math.max(surf.scale * 2, widths[Math.floor(widths.length * 0.65)]);
}

/* -------------------------------------------------------------------- */
/*  Tokens — runs of ink inside one row                                  */
/* -------------------------------------------------------------------- */

/** Split one row band into tokens: glyph groups separated by a cell-sized gap. */
function extractTokens(surf, row, gapOverride) {
  const minSegW = Math.max(2, Math.floor(CFG.MIN_DIGIT_W_SRC * surf.scale / 2));
  const maxSegW = Math.max(12, Math.round(surf.glyphW * CFG.GLYPH_SPLIT_RATIO));
  const vP = vProjection(surf.bin, surf.W, row.y, row.h);
  let segs = findSegmentsRaw(vP, 1);
  segs = splitWideSegments(segs, vP, minSegW, maxSegW);

  const boxed = [];
  for (const s of segs) {
    const bb = tightBBox(surf.bin, surf.W, s.x, row.y, s.w, row.h);
    if (bb && bb.w >= 1 && bb.h >= 1) boxed.push({ x: s.x, w: s.w, bbox: bb });
  }
  if (!boxed.length) return [];

  const gap = gapOverride || Math.max(2 * surf.scale,
    Math.round(surf.glyphW * CFG.TOKEN_GAP_GLYPHS));

  const groups = [];
  let group = [boxed[0]];
  for (let i = 1; i < boxed.length; i++) {
    const prev = boxed[i - 1];
    if (boxed[i].x - (prev.x + prev.w) >= gap) { groups.push(group); group = []; }
    group.push(boxed[i]);
  }
  groups.push(group);

  return groups.map(g => finishToken(g, row)).filter(Boolean);
}

/** Attach a bounding box and split a token's glyphs into tall marks and commas. */
function finishToken(group, row) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, maxH = 0;
  for (const g of group) {
    x0 = Math.min(x0, g.bbox.x);
    x1 = Math.max(x1, g.bbox.x + g.bbox.w);
    y0 = Math.min(y0, g.bbox.y);
    y1 = Math.max(y1, g.bbox.y + g.bbox.h);
    maxH = Math.max(maxH, g.bbox.h);
  }
  if (!isFinite(x0) || x1 <= x0) return null;

  const tall = [], commas = [];
  for (const g of group) (g.bbox.h >= maxH * 0.55 ? tall : commas).push(g.bbox);

  return { row, glyphs: group, tall, commas, bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** Merge several tokens of one row into a single cell (residual split repair). */
function mergeTokens(tokens) {
  if (tokens.length === 1) return tokens[0];
  const glyphs = [];
  for (const t of tokens) glyphs.push(...t.glyphs);
  glyphs.sort((a, b) => a.x - b.x);
  return finishToken(glyphs, tokens[0].row);
}

/* -------------------------------------------------------------------- */
/*  Columns — group tokens across rows by horizontal overlap             */
/* -------------------------------------------------------------------- */

/**
 * Group tokens into columns.
 *
 * A token joins a column when it overlaps that column's current x-range by at
 * least half its own width. Cells in the same column always overlap heavily;
 * cells in different columns never overlap, because a gutter separates them.
 * The grouping is therefore independent of whether a column is left-, right-
 * or centre-aligned, which matters because a screenshot of six-figure prices
 * gives no evidence either way and a seven-figure price arriving later would
 * break an alignment guess.
 */
function groupIntoColumns(tokens) {
  const sorted = tokens.slice().sort((a, b) => a.bbox.x - b.bbox.x);
  const cols = [];

  for (const t of sorted) {
    const tx0 = t.bbox.x, tx1 = t.bbox.x + t.bbox.w;
    let target = null;
    for (const c of cols) {
      const ov = Math.min(tx1, c.x1) - Math.max(tx0, c.x0);
      if (ov > 0 && ov >= 0.5 * Math.min(t.bbox.w, c.x1 - c.x0)) { target = c; break; }
    }
    if (target) {
      target.x0 = Math.min(target.x0, tx0);
      target.x1 = Math.max(target.x1, tx1);
      target.tokens.push(t);
    } else {
      cols.push({ x0: tx0, x1: tx1, tokens: [t] });
    }
  }

  return finalizeColumns(splitFusedColumns(cols));
}

/**
 * Split a column that fused two real columns.
 *
 * Union-by-overlap is a chaining operation: one over-wide token — a
 * seven-figure price reaching left into a gutter, a long street name — can
 * bridge two columns, and the widened range then swallows everything else.
 * The symptom is unmistakable: many rows contribute TWO tokens with a
 * consistent gap between them. Splitting at that gap recovers both columns;
 * doing nothing would leave a money column whose per-row value is whichever
 * token happened to be read last.
 */
function splitFusedColumns(cols) {
  const out = [];

  for (const col of cols) {
    const byRow = new Map();
    for (const t of col.tokens) {
      if (!byRow.has(t.row)) byRow.set(t.row, []);
      byRow.get(t.row).push(t);
    }

    const multi = Array.from(byRow.values()).filter(ts => ts.length > 1);
    if (multi.length < 2 || multi.length < byRow.size * 0.3) { out.push(col); continue; }

    /* The widest internal gap of each multi-token row. If those gaps line up
     * across rows, they are one boundary, not ragged content. */
    const cuts = [];
    for (const ts of multi) {
      ts.sort((a, b) => a.bbox.x - b.bbox.x);
      let best = null;
      for (let i = 1; i < ts.length; i++) {
        const gap = ts[i].bbox.x - (ts[i - 1].bbox.x + ts[i - 1].bbox.w);
        if (!best || gap > best.gap) {
          best = { gap, at: ts[i - 1].bbox.x + ts[i - 1].bbox.w + gap / 2 };
        }
      }
      if (best) cuts.push(best.at);
    }
    cuts.sort((a, b) => a - b);
    const cut = cuts[Math.floor(cuts.length / 2)];
    const spread = cuts[cuts.length - 1] - cuts[0];

    if (!isFinite(cut) || spread > (col.x1 - col.x0) * 0.35) { out.push(col); continue; }

    const left = col.tokens.filter(t => t.bbox.x + t.bbox.w / 2 < cut);
    const right = col.tokens.filter(t => t.bbox.x + t.bbox.w / 2 >= cut);
    if (!left.length || !right.length) { out.push(col); continue; }

    console.log(`[Grid] split fused column x=${col.x0}-${col.x1} at ${Math.round(cut)} ` +
      `(${multi.length}/${byRow.size} rows had two cells)`);
    for (const part of [left, right]) {
      out.push({
        x0: Math.min(...part.map(t => t.bbox.x)),
        x1: Math.max(...part.map(t => t.bbox.x + t.bbox.w)),
        tokens: part,
      });
    }
  }

  return out;
}

/** Index the columns and collapse each row's leftover tokens into one cell. */
function finalizeColumns(cols) {
  cols.sort((a, b) => a.x0 - b.x0);
  cols.forEach((c, i) => {
    c.index = i;
    c.x = c.x0;
    c.w = c.x1 - c.x0;

    const byRow = new Map();
    for (const t of c.tokens) {
      if (!byRow.has(t.row)) byRow.set(t.row, []);
      byRow.get(t.row).push(t);
    }
    c.cells = new Map();
    c.splitCells = 0;
    for (const [row, ts] of byRow) {
      if (ts.length > 1) c.splitCells++;
      ts.sort((a, b) => a.bbox.x - b.bbox.x);
      c.cells.set(row, mergeTokens(ts));
    }
  });
  return cols;
}

/** The cell a column holds on a given row, or null. */
function tokenAt(col, row) {
  return col.cells.get(row) || null;
}

/* -------------------------------------------------------------------- */
/*  Header row                                                           */
/* -------------------------------------------------------------------- */

/**
 * Match one header cell against the known labels.
 *
 * The cell is also tried with its LAST glyph dropped, for a sort indicator
 * drawn as an icon rather than a character. Matrix glues a bold arrow to the
 * label of the sorted column, and correlated whole, "Orig Price" plus an arrow
 * matches nothing — so the column the grid is sorted by, which is very often a
 * price, is the one whose header goes unread.
 *
 * The trimmed reading has to EARN its place. A real label with its last letter
 * cut off correlates worse with that label than the whole word does, so on a
 * cell that has no icon the untrimmed reading wins and nothing changes. Only
 * when the dropped glyph was foreign ink does trimming score clearly higher,
 * and only a narrow glyph — an icon, not a word — is ever dropped.
 */
function matchHeaderToken(surf, token, candidates, font, weight) {
  const whole = matchWord(
    rasterizeBox(surf.gray, token.bbox.x, token.bbox.y, token.bbox.w, token.bbox.h),
    candidates, font, weight);

  const glyphs = token.glyphs.slice().sort((a, b) => a.bbox.x - b.bbox.x);
  if (glyphs.length < 3) return whole;
  const last = glyphs[glyphs.length - 1].bbox;
  if (last.w > surf.glyphW * CFG.HEADER_ICON_MAX_GLYPHS) return whole;

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const g of glyphs.slice(0, -1)) {
    x0 = Math.min(x0, g.bbox.x); x1 = Math.max(x1, g.bbox.x + g.bbox.w);
    y0 = Math.min(y0, g.bbox.y); y1 = Math.max(y1, g.bbox.y + g.bbox.h);
  }
  const trimmed = matchWord(rasterizeBox(surf.gray, x0, y0, x1 - x0, y1 - y0), candidates, font, weight);
  if (trimmed && (!whole || trimmed.score >= whole.score + CFG.HEADER_TRIM_MIN_GAIN)) {
    return Object.assign({}, trimmed, { trimmedIcon: true });
  }
  return whole;
}

/**
 * Find the header row.
 *
 * Searched over the top HEADER_MAX_ROWS rows rather than just the first two:
 * a screenshot that includes a toolbar or a "1 – 45 of 45" count line puts the
 * header several bands down, and missing it silently drops the app onto its
 * weakest column-identification path.
 *
 * The TOPMOST qualifying row wins, not the highest-scoring one. Rows above the
 * chosen header are discarded, so preferring a lower row over a valid one
 * above it deletes a real listing without a trace.
 */
function findHeaderRow(surf, knownFont, knownWeight) {
  if (surf.rows.length < 3) return null;

  /* A sort indicator is drawn on whichever column the grid is sorted by — see
   * headerCandidates. */
  const { base: labels, all: candidates } = headerCandidates();

  const limit = Math.min(CFG.HEADER_MAX_ROWS, surf.rows.length - 1);
  for (let i = 0; i < limit; i++) {
    const row = surf.rows[i];
    const tokens = extractTokens(surf, row,
      Math.max(3 * surf.scale, Math.round(surf.glyphW * 1.35)));
    if (tokens.length < CFG.HEADER_MIN_LABELS) continue;

    /* The font is a property of the screenshot, so it is chosen once — by the
     * header-band pass if that ran, and only here otherwise. */
    let font = knownFont, weight = knownWeight;
    if (!font || !weight) {
      const rasters = tokens
        .map(t => rasterizeBox(surf.gray, t.bbox.x, t.bbox.y, t.bbox.w, t.bbox.h))
        .filter(Boolean);
      ({ font, weight } = pickFont(rasters, labels, CFG.SYNTH_WEIGHTS));
    }

    const matches = [];
    for (const t of tokens) {
      const m = matchHeaderToken(surf, t, candidates, font, weight);
      if (!m || m.score < CFG.HEADER_MIN_WORD_SCORE) continue;
      const base = headerLabelOf(m.text);
      const entry = HEADER_LABELS.find(h => h.text === base);
      matches.push({ token: t, label: base, role: headerMatchRole(entry ? entry.role : 'text', m.score),
                     score: m.score });
    }

    const anchors = countHeaderAnchors(matches);
    const qualifies = matches.length >= CFG.HEADER_MIN_LABELS && anchors >= CFG.HEADER_MIN_ANCHORS;

    console.log(`[Header] row ${i} (y=${row.y}): ${tokens.length} tokens, ` +
      `${matches.length} labels, ${anchors} anchors in ${weight} ${font}` +
      (qualifies ? ' → HEADER' : '') +
      (matches.length ? ` — ${matches.map(m => `${m.label}:${m.score.toFixed(2)}`).join(', ')}` : ''));

    if (qualifies) return { row, index: i, tokens, matches, font, weight, skippedAbove: i };
  }

  return null;
}

/* -------------------------------------------------------------------- */
/*  Column roles                                                         */
/* -------------------------------------------------------------------- */

function medianOf(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Read every column as money, and as plain integers.
 *
 * A column only qualifies as money when nearly all of its parsed cells carry a
 * dollar sign. Without that gate a comma-grouped four-digit column — ASF
 * "1,850", or a Taxes column — parses cleanly and, sitting to the right of
 * List Price, wins the positional fallback outright. The active median then
 * comes back as $1,850, or worse, as a plausible-looking $4,231.
 */
function scoreColumns(surf, dataRows, cols, bank, uiFont, closedRows, headerRoles) {
  const money = [];
  const integers = [];
  const closed = closedRows || new Set();

  /* Built lazily, and only consulted for cells the reference bank could not
   * read — see fontAdaptedDigitBank. */
  let alt = null;
  const altBank = () => {
    if (alt === null) alt = uiFont ? fontAdaptedDigitBank(bank, uiFont) : false;
    return alt || null;
  };

  /**
   * Could this column be the concessions column, on geometry alone?
   *
   * CONC is populated on closed rows and blank on the rest — the same shape
   * the sold column has. Asking that question before reading anything is what
   * lets ~20 columns of a 23-column grid skip classification entirely.
   */
  const isConcCandidate = (col) => {
    if (headerRoles && headerRoles.get(col) === 'conc') return true;
    if (col.cells.size < CFG.PRICE_COL_MIN_ROWS) return false;
    if (!closed.size) return false;
    if (dataRows.length && col.cells.size / dataRows.length >= CFG.DENSE_COL_MIN_FRAC) return false;
    let blankNonClosed = 0;
    for (const row of dataRows) if (!col.cells.has(row) && !closed.has(row)) blankNonClosed++;
    return blankNonClosed >= CFG.SOLD_MIN_BLANK_ROWS;
  };

  /* The no-currency fallback needs integers too, but only from columns whose
   * cells actually carry thousands separators. */
  const couldBeUncurrencedMoney = (cells) => {
    const withComma = cells.filter(([, t]) => t.commas.length).length;
    return cells.length >= CFG.PRICE_COL_MIN_ROWS && withComma / cells.length >= 0.9;
  };

  for (const col of cols) {
    const cells = Array.from(col.cells.entries());
    if (cells.length < CFG.PRICE_COL_MIN_ROWS) continue;

    /* Settled once for the column, not per cell — see decideCurrencyPrefix. */
    const currency = decideCurrencyPrefix(surf, cells, bank);
    col.currencyPrefix = currency;
    const concCandidate = isConcCandidate(col);

    const prices = new Map();
    const ints = new Map();
    let rescued = 0;

    /* Reading a cell means normalizing and correlating every one of its glyphs
     * against the whole template bank, five sub-pixel shifts each. Doing that
     * for every cell of all twenty-odd columns is what made this slow: a grid
     * has ~1000 cells and at most three of its columns hold money. So each
     * column is first asked, from geometry alone, whether it could possibly be
     * one of the columns we need. */
    const wantsPrices = currency || couldBeUncurrencedMoney(cells);
    const wantsIntegers = concCandidate;

    for (const [row, token] of cells) {
      const n = token.tall.length;
      if (currency && n >= 2 && n <= 14) {
        let p = readPriceToken(surf, row, token, bank, true);
        if (!p && altBank()) {
          p = readPriceToken(surf, row, token, altBank(), true);
          if (p) rescued++;
        }
        if (p) { prices.set(row, p); continue; }
      }
      if ((wantsIntegers || wantsPrices) && n >= 1 && n <= 8) {
        let v = readIntegerToken(surf, row, token, bank);
        if (!v && altBank()) {
          v = readIntegerToken(surf, row, token, altBank());
          if (v) rescued++;
        }
        if (v) ints.set(row, v);
      }
    }
    if (rescued) {
      console.log(`[Money] col ${col.index}: ${rescued} cell(s) read only after adapting the ` +
        `digit templates to ${uiFont}`);
    }
    const dollarCount = currency ? prices.size : 0;

    if (ints.size >= CFG.PRICE_COL_MIN_ROWS) {
      integers.push({
        col, values: ints,
        median: medianOf(Array.from(ints.values()).map(v => v.value)),
        fillFrac: dataRows.length ? ints.size / dataRows.length : 0,
      });
    }

    /* A grid configured without the currency symbol still has money columns:
     * comma-grouped four-figure-plus numbers in the right magnitude range.
     * They are accepted only as a last resort (see assignRoles), because
     * without the '$' anchor a Taxes or Assessment column looks identical. */
    let noCurrency = false;
    if (!currency && ints.size >= CFG.PRICE_COL_MIN_ROWS) {
      const commaCells = cells.filter(([, t]) => t.commas.length).length;
      const vals = Array.from(ints.values());
      const med = medianOf(vals.map(v => v.value));
      if (commaCells / cells.length >= 0.9 &&
          vals.every(v => v.digits.length >= 4) &&
          med !== null && med >= CFG.PRICE_COL_MEDIAN_MIN && med <= CFG.PRICE_COL_MEDIAN_MAX) {
        noCurrency = true;
        for (const [row, v] of ints) prices.set(row, v);
      }
    }

    const parsedFrac = cells.length ? prices.size / cells.length : 0;
    const dollarFrac = prices.size ? dollarCount / prices.size : 0;
    if (prices.size < CFG.PRICE_COL_MIN_ROWS || parsedFrac < CFG.PRICE_COL_MIN_FRAC) continue;
    if (!currency && !noCurrency) continue;

    /* A value whose digit count is far from the column's own is a token that
     * split at a comma — "$1,085,000" read as "$1,085". Drop it and say so
     * rather than letting it become the bucket low. */
    const lens = Array.from(prices.values()).map(p => p.digits.length);
    const medLen = medianOf(lens);
    /* A token that split at a comma comes back SHORT — "$1,085,000" read as
     * "$1,085". A genuinely large sale in a modest column comes back long, and
     * dropping it would silently remove the market's high sale. So only short
     * values are treated as artefacts, and they are reported. */
    const outlierRows = [];
    for (const [row, p] of Array.from(prices.entries())) {
      if (medLen - p.digits.length >= CFG.PRICE_DIGIT_SPREAD) {
        prices.delete(row);
        outlierRows.push(p.value);
      }
    }
    const outliers = outlierRows.length;
    if (outliers) {
      console.log(`[Money] col ${col.index}: dropped ${outliers} short value(s) ` +
        `(${outlierRows.join(', ')}) against a ${medLen}-digit column`);
    }

    const median = medianOf(Array.from(prices.values()).map(p => p.value));
    if (median === null || median < CFG.PRICE_COL_MEDIAN_MIN || median > CFG.PRICE_COL_MEDIAN_MAX) {
      console.log(`[Money] col ${col.index} rejected: median ${median} outside ` +
        `[${CFG.PRICE_COL_MEDIAN_MIN}, ${CFG.PRICE_COL_MEDIAN_MAX}]`);
      continue;
    }

    money.push({
      col, prices, median, outliers, dollarFrac, parsedFrac, noCurrency,
      fillFrac: dataRows.length ? prices.size / dataRows.length : 0,
      splitCells: col.splitCells,
    });
  }

  money.sort((a, b) => a.col.x0 - b.col.x0);
  integers.sort((a, b) => a.col.x0 - b.col.x0);
  return { money, integers };
}

/** Bind header labels to columns: nearest centre, one column per role. */
function bindHeaderRoles(header, cols) {
  const roles = new Map();      /* column → role   */
  const byRole = new Map();     /* role → {col, score, label} */
  if (!header) return { roles, byRole };

  const taken = new Set();
  const ordered = header.matches.slice().sort((a, b) => b.score - a.score);

  for (const m of ordered) {
    /* One column per role we act on, and it is the best-matching label's. A
     * second, weaker match for the same role — "Orig Price" scored as a poor
     * "Sold Price", "BR" as a poor "St" — used to tag its own column with that
     * role as well, and a caller walking the column map could meet the wrong
     * one first: a status vocabulary run over a column of bedroom counts. */
    if (ACTED_HEADER_ROLES.includes(m.role) && byRole.has(m.role)) continue;
    const mid = m.token.bbox.x + m.token.bbox.w / 2;
    let best = null;
    for (const col of cols) {
      if (taken.has(col)) continue;
      const overlap = Math.min(m.token.bbox.x + m.token.bbox.w, col.x1) -
                      Math.max(m.token.bbox.x, col.x0);
      /* A label must actually sit over its own column. Nearest-centre alone
       * would hand "Sold Pr" to a neighbouring money column whenever the
       * search returned no closed sales — the Sold Pr column then has no data
       * tokens, so it does not exist to be matched, and the label drifts. That
       * binds the closed-sale median to original list prices, at full stated
       * confidence. No overlap, no binding. */
      if (overlap <= 0) continue;
      const d = Math.abs((col.x0 + col.x1) / 2 - mid);
      if (!best || d < best.d) best = { col, d, overlap };
    }
    if (!best) continue;
    taken.add(best.col);
    roles.set(best.col, m.role);
    if (!byRole.has(m.role)) byRole.set(m.role, { col: best.col, score: m.score, label: m.label });
  }

  return { roles, byRole };
}

/**
 * Name the money columns, and say how confident we are and why.
 *
 * Header labels win where they exist, but each role is resolved
 * independently: a header that yields "List Price" and not "Sold Pr" must
 * still fall through to the data-driven passes for the sold column. Returning
 * early on a partial header match is how a closed median ends up being a
 * median of asking prices at 95% stated confidence.
 */
function assignRoles(allMoney, integers, statusByRow, dataRows, header, cols, closedRows) {
  const result = {
    list: null, orig: null, sold: null, conc: null,
    /* How each role was decided, individually — see the confidence rule below. */
    methodBy: {},
    method: null, confidence: 0, notes: [], problems: [],
  };

  /* Prefer the columns anchored by a currency symbol. Only if there are none
   * do the bare comma-grouped columns come into play, and then loudly. */
  const withCurrency = allMoney.filter(m => !m.noCurrency);
  const money = withCurrency.length ? withCurrency : allMoney;
  if (money.length && !withCurrency.length) {
    result.notes.push('No column carried a dollar sign, so comma-grouped numbers of the right ' +
      'magnitude were used instead. Confirm the columns below — a taxes or assessment column ' +
      'looks the same to the recognizer.');
  }

  if (!money.length) {
    result.problems.push(
      'No money column was found in this image. Prices are located by their dollar sign and ' +
      'thousands separator — make sure the price columns are inside the screenshot and not cut off.'
    );
    return result;
  }

  const found = [];
  const { byRole, roles: labelled } = bindHeaderRoles(header, cols);

  /* A header label only binds a role to a column of the right KIND. "Sold Pr"
   * sitting above a column that holds no money — which is exactly what happens
   * when the search returned no closed sales — must bind nothing, rather than
   * attaching the label to whatever column is nearest. */
  const pick = (role, pool) => {
    const hit = byRole.get(role);
    if (!hit) return null;
    return pool.find(m => m.col === hit.col) || null;
  };

  /* --- 1. Header labels, role by role --- */
  if (header) {
    for (const role of ['list', 'sold', 'orig']) {
      const hit = pick(role, money);
      if (hit) { result[role] = hit; result.methodBy[role] = 'header'; found.push(role); }
    }
    const conc = pick('conc', integers);
    if (conc) { result.conc = conc; result.methodBy.conc = 'header'; found.push('conc'); }
    if (found.length) {
      result.method = 'header';
      result.notes.push(`Read from the header row: ${found.join(', ')}.`);
    }
  }

  /* --- 2. Sold price by fill pattern against the closed rows --- */
  let nonClosed = 0;
  for (const row of dataRows) {
    const st = statusByRow.get(row);
    const code = st && st.code ? normalizeStatusCode(st.code) : null;
    if (code && !closedRows.has(row)) nonClosed++;
  }

  if (!result.sold && closedRows.size > 0 && nonClosed > 0) {
    let best = null;
    for (const m of money) {
      if (m === result.list || m === result.orig) continue;
      /* A column the header labelled as something else is not the sold price. */
      if (labelled.has(m.col)) continue;

      /* Agreement alone is not evidence. On a grid that is almost all closed
       * sales, an always-populated asking-price column agrees with the closed
       * set on nearly every row simply because nearly every row IS closed —
       * and binding it here puts list prices into the sold median, which is
       * the exact substitution this app exists to prevent. A sold column must
       * be positively BLANK on the rows that are not closed. */
      let agree = 0, blankOnNonClosed = 0;
      for (const row of dataRows) {
        const has = m.prices.has(row);
        const isClosed = closedRows.has(row);
        if (has === isClosed) agree++;
        if (!has && !isClosed) blankOnNonClosed++;
      }
      const acc = dataRows.length ? agree / dataRows.length : 0;
      if (m.fillFrac >= CFG.DENSE_COL_MIN_FRAC) continue;
      if (blankOnNonClosed < CFG.SOLD_MIN_BLANK_ROWS) continue;
      if (!best || acc > best.acc) best = { m, acc, blankOnNonClosed };
    }
    if (best && best.acc >= CFG.SOLD_FILL_MIN_ACC) {
      result.sold = best.m;
      result.methodBy.sold = 'fill-pattern';
      result.notes.push(`Sold price identified by its fill pattern ` +
        `(${(100 * best.acc).toFixed(0)}% agreement with the closed rows, and empty on ` +
        `${best.blankOnNonClosed} row(s) that are not closed).`);
      if (!result.method) result.method = 'fill-pattern';
    } else if (closedRows.size >= 3) {
      result.problems.push(
        'No column behaves like a sold-price column — none is populated on the closed rows and ' +
        'empty on the rest. Closed sales cannot be summarized without one.'
      );
    }
  }

  /* --- 3. List and Orig: the always-populated money columns ---
   *
   * Only columns the header did NOT label are available to a positional guess.
   * A column already bound to a role is spoken for, and a column labelled with
   * anything else has been positively ruled out. Without this, a Matrix layout
   * that carries "Sold Price" and "Orig Price" but no current list price had
   * its Orig Price column re-bound as the list price, by position — so every
   * active listing was summarized on the price it was FIRST offered at, which
   * is the cross-source substitution this app exists to refuse. */
  const unlabelled = m => m !== result.sold && m !== result.list && m !== result.orig &&
                          m !== result.conc && !labelled.has(m.col);
  const dense = money.filter(m => unlabelled(m) && m.fillFrac >= CFG.DENSE_COL_MIN_FRAC);

  if (!result.list) {
    const avail = dense;
    if (avail.length) {
      result.list = avail[avail.length - 1];       /* rightmost */
      result.methodBy.list = 'position';
      if (avail.length > 1) {
        result.notes.push(`${avail.length} money columns are populated on every row; ` +
          `took the rightmost as "List Price" (connectMLS places "Orig List Pr" to its left).`);
      }
      if (!result.method) result.method = 'position';
    } else {
      const rest = money.filter(unlabelled);
      if (rest.length) {
        result.list = rest[rest.length - 1];
        result.methodBy.list = 'position';
        result.method = result.method || 'position';
      }
    }
  }

  if (!result.orig) {
    const avail = dense.filter(unlabelled);
    if (avail.length) { result.orig = avail[avail.length - 1]; result.methodBy.orig = 'position'; }
  }

  /* --- 4. Concessions: a small integer column filled only on closed rows --- */
  if (!result.conc && closedRows.size > 0) {
    const soldMedian = result.sold ? result.sold.median : (result.list ? result.list.median : null);
    let best = null;
    for (const m of integers) {
      if (m.col === (result.list && result.list.col) ||
          m.col === (result.orig && result.orig.col) ||
          m.col === (result.sold && result.sold.col)) continue;

      /* Same trap as the sold column, and worse: a concessions column that is
       * actually Street # or ASF puts the wrong quantity into every ratio, to
       * three decimal places. It must be EMPTY on rows that are not closed —
       * an always-populated column is not concessions no matter how it scores. */
      let agree = 0, populated = 0, blankOnNonClosed = 0;
      for (const row of dataRows) {
        const has = m.values.has(row);
        if (has) populated++;
        if (has && !closedRows.has(row)) agree -= 2;
        else if (has) agree += 1;
        else if (!closedRows.has(row)) blankOnNonClosed++;
      }
      if (populated < 2) continue;
      if (m.fillFrac >= CFG.DENSE_COL_MIN_FRAC) continue;
      if (blankOnNonClosed < CFG.SOLD_MIN_BLANK_ROWS) continue;
      /* Concessions are a few percent of the price, not a fraction of a percent
       * and not a quarter of it. */
      if (soldMedian && (m.median > soldMedian * CFG.CONC_MAX_FRAC_OF_LIST ||
                         m.median < soldMedian * CFG.CONC_MIN_FRAC_OF_LIST)) continue;
      if (!best || agree > best.agree) best = { m, agree };
    }
    if (best && best.agree > 0) {
      result.conc = best.m;
      result.methodBy.conc = 'fill-pattern';
      result.notes.push('Concessions identified as the small whole-number column populated only ' +
        'on closed rows.');
    }
  }

  /* --- 5. Cross-checks that can still overturn the assignment --- */
  runRoleCrossChecks(result, dataRows);

  /* Money columns expose `prices`, integer columns `values`. Alias them so a
   * caller never has to know which kind a role turned out to be. */
  for (const role of ['list', 'orig', 'sold', 'conc']) {
    const r = result[role];
    if (!r) continue;
    if (!r.prices) r.prices = r.values;
    if (!r.values) r.values = r.prices;
  }

  /* Confidence is the confidence of the WEAKEST role that feeds a number, not
   * of the best method used for any role. A header that matched "CONC" and
   * nothing else would otherwise report 95% while the list and sold columns
   * were positional guesses — full stated confidence over an invented answer. */
  const STRENGTH = { header: 0.95, 'fill-pattern': 0.75, position: 0.45 };
  const feeding = ['list', 'sold'];
  /* An ABSENT role is not a guess, and is not scored as one. It feeds no number
   * — the rows it would have priced come out unpriced, which gates the copy on
   * its own and says why — so folding it in here only produced a second,
   * false reason ("the money columns were inferred") beside a header that had
   * in fact named every column it found. A missing column is reported by name
   * in the pipeline instead. */
  const present = feeding.filter(role => result[role]);
  let weakest = present.length ? 0.95 : 0.2;
  for (const role of present) {
    weakest = Math.min(weakest, STRENGTH[result.methodBy[role]] || 0.45);
  }
  result.confidence = Math.max(0.2, weakest - result.problems.length * 0.2);

  /* One headline word for a decision made per role: report the weakest, since
   * that is what the confidence figure means and what the user should check. */
  const ORDER = ['position', 'fill-pattern', 'header'];
  const used = feeding.map(r => result.methodBy[r]).filter(Boolean);
  result.method = used.length
    ? used.reduce((a, b) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b))
    : (result.methodBy.orig || result.methodBy.conc || null);

  return result;
}

/**
 * Sanity-check the assignment against facts about how a grid must behave.
 *
 * These catch the failures that produce a confident wrong number: List bound
 * to Orig (a median a few percent high, forever), Sold bound to CONC (a
 * median in the thousands), Orig and List swapped by a non-standard column
 * order.
 */
function runRoleCrossChecks(result, dataRows) {
  const { list, orig, sold, conc } = result;

  if (list && orig) {
    let origHigher = 0, listHigher = 0;
    for (const row of dataRows) {
      const a = orig.prices.get(row), b = list.prices.get(row);
      if (!a || !b) continue;
      if (a.value > b.value) origHigher++;
      else if (b.value > a.value) listHigher++;
    }
    const decided = origHigher + listHigher;
    if (decided >= 3 && listHigher / decided > CFG.ORIG_GE_LIST_FRAC) {
      result.orig = list;
      result.list = orig;
      const m = result.methodBy.list;
      result.methodBy.list = result.methodBy.orig;
      result.methodBy.orig = m;
      result.notes.push('Swapped the two always-populated money columns: the left one held ' +
        'the LOWER price on most rows, which is the current list price, not the original.');
    }
  }

  if (sold && result.list) {
    const ratio = result.list.median ? sold.median / result.list.median : 0;
    if (ratio < CFG.SOLD_LIST_RATIO_MIN || ratio > CFG.SOLD_LIST_RATIO_MAX) {
      result.problems.push(
        `The column taken as the sold price has a median of ` +
        `$${sold.median.toLocaleString('en-US')} against a list median of ` +
        `$${result.list.median.toLocaleString('en-US')} — too far apart to be the same market. ` +
        `The sold column was rejected.`
      );
      result.sold = null;
      delete result.methodBy.sold;
    }
  }

  if (conc && sold && conc.median > sold.median * CFG.CONC_MAX_FRAC_OF_LIST) {
    result.problems.push('The column taken as concessions is too large relative to the sold ' +
      'prices; concessions were not used.');
    result.conc = null;
    delete result.methodBy.conc;
  }
}

/**
 * Read the MT (market time) column — connectMLS's days on market.
 *
 * Bound by its HEADER LABEL and by nothing else, on purpose. A money column
 * can be identified from the data because money has a shape: a dollar sign,
 * thousands separators, a plausible magnitude. Market time has none of that.
 * It is a column of one- to three-digit integers, which is exactly what
 * "# Rms", "Yr Blt", "All Beds", "# Garage" and "ASF" are too — and a median
 * days-on-market that is really a median year built is a number an appraiser
 * cannot see is wrong. So with no "MT" header there is no market time, and the
 * app says so instead of guessing.
 *
 * The header label is the ONLY guard against a decoy column. CFG.MT_MAX_DAYS
 * is not one and is not meant to be: every value in a Yr Blt column is under
 * 3650 and would pass it. It bounds a market time that IS one, nothing more.
 *
 * Returns { col, values: Map(row → days), read, unreadable, blank } or null.
 */
function readMarketTimeColumn(surf, dataRows, cols, bank, uiFont, headerRoles) {
  if (!headerRoles) return null;
  let col = null;
  for (const [c, role] of headerRoles) if (role === 'mt') { col = c; break; }
  if (!col) return null;

  /* Same lazy font-adapted fallback the money columns use: the bank is built
   * from real connectMLS pixels in one family, and a screenshot taken on a
   * machine with a different UI font needs the templates re-synthesized. */
  let alt = null;
  const altBank = () => {
    if (alt === null) alt = uiFont ? fontAdaptedDigitBank(bank, uiFont) : false;
    return alt || null;
  };

  const values = new Map();
  let unreadable = 0, blank = 0;

  for (const row of dataRows) {
    const token = tokenAt(col, row);
    if (!token) { blank++; continue; }
    /* connectMLS writes a market time as bare digits at every length, so a
     * short mark in this cell is a mark that does not belong to a market time
     * — a speck, or ink from a neighbour. readIntegerToken would accept a
     * validly grouped "1,234" as 1234; refusing it leaves a gap the appraiser
     * can see and type over, which is the cheaper of the two mistakes. */
    if (token.commas && token.commas.length) { unreadable++; continue; }
    let v = readIntegerToken(surf, row, token, bank);
    if (!v && altBank()) v = readIntegerToken(surf, row, token, altBank());
    /* A day count is a whole number of days. A fraction means the token is not
     * a market time — or is a fragment of something else that landed in this
     * column — and either way it must not become a median. */
    if (!v || v.fraction || v.digits.length > CFG.MT_MAX_DIGITS ||
        v.value < 0 || v.value > CFG.MT_MAX_DAYS) {
      unreadable++;
      continue;
    }
    values.set(row, v.value);
  }

  console.log(`[MT] col ${col.index}: ${values.size} value(s) read, ` +
    `${unreadable} unreadable, ${blank} blank cell(s)`);

  return { col, values, read: values.size, unreadable, blank };
}

/**
 * Find the MLS # column, used to flag duplicate listings.
 *
 * MRED numbers are eight digits, and that shape alone is enough to find the
 * column. Other MLSs use other lengths — Matrix's Cedar Rapids board uses
 * seven — and a seven-digit shape is not distinctive on its own, so any other
 * length is accepted only in the column the header labelled as the MLS number.
 * Whatever the length, every cell of the column has to agree on it.
 */
function findMlsColumn(surf, cols, bank, headerRoles, altBank) {
  const readWith = (token, b) => {
    let str = '', worst = 1;
    for (const g of token.tall) {
      const norm = normalizeGlyph(surf.gray, g.x, g.y, g.w, g.h);
      norm.features = computeStructuralFeatures(norm.binary, CFG.NORM_W, CFG.NORM_H, norm.grayscale);
      const cls = classifyGlyph(norm, b);
      if (isAmbiguous(cls)) return null;
      str += String(cls.digit);
      worst = Math.min(worst, cls.score);
    }
    return (/^\d+$/.test(str) && worst >= CFG.MIN_DIGIT_SCORE) ? str : null;
  };

  let best = null;
  for (const col of cols) {
    const named = !!(headerRoles && headerRoles.get(col) === 'mls');
    let digits = CFG.MLS_DIGITS;
    if (named) {
      const counts = new Map();
      for (const t of col.cells.values()) counts.set(t.tall.length, (counts.get(t.tall.length) || 0) + 1);
      const [mode] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0] || [0];
      if (mode >= CFG.MLS_MIN_DIGITS && mode <= CFG.MLS_MAX_DIGITS) digits = mode;
    }
    const cells = Array.from(col.cells.entries()).filter(([, t]) => t.tall.length === digits);
    if (cells.length < Math.max(2, col.cells.size * 0.6)) continue;

    const values = new Map();
    let ok = 0;
    for (const [row, token] of cells) {
      const str = readWith(token, bank) || (altBank ? readWith(token, altBank) : null);
      if (str && str.length === digits) {
        values.set(row, str);
        ok++;
      }
    }
    const frac = cells.length ? ok / cells.length : 0;
    if (frac >= 0.6 && (!best || frac > best.frac)) best = { col, values, frac };
  }
  return best;
}
