/* ===== UAD 3.6 Helper — Surface Analysis & Table Rules ================ */
/* Ported from MLS-Extract (script.js, SECTION 10).                       */
/*                                                                        */
/* One deliberate change: findColumnBands() takes an explicit minGutter    */
/* instead of deriving it from CFG.COL_GUTTER_RATIO. MLS-Extract only has  */
/* to keep the MLS # column apart from its neighbours, so a wide gutter is */
/* safe there. This app has to keep "Orig List Pr" apart from "List Price",*/
/* which sit about three source pixels closer together than that threshold */
/* tolerates, so the caller sweeps the gutter instead of assuming one.     */
/* --------------------------------------------------------------------- */
/* analyzeSurface, medianRowHeight, suppressGridLines, stripFullSpanRules, */
/* stripTableRules, findColumnBands                                       */
/* ===================================================================== */


/**
 * Binarize + detect row bands for an upscaled grayscale canvas.
 * Returns { gray, bin, W, H, rows, thr }.
 */
function analyzeSurface(grayCanvas) {
  const work = cloneCanvas(grayCanvas);
  const thr = binarize(work);
  const W = work.width, H = work.height;
  const bin = stripTableRules(getBinary(work), W, H).bin;

  const hP = hProjection(bin, W, H);
  const rawRows = findRows(hP, W, CFG.MIN_ROW_DENSITY);
  const minH = CFG.UPSCALE * 5;
  const maxH = CFG.UPSCALE * 30;
  const rows = rawRows.filter(r => r.h >= minH && r.h <= maxH);

  return { gray: grayCanvas, bin, W, H, rows, rawRows, thr, minH, maxH };
}

/** Median row-band height, used to scale every gutter/gridline threshold. */
function medianRowHeight(rows) {
  if (!rows.length) return CFG.UPSCALE * 8;
  const hs = rows.map(r => r.h).sort((a, b) => a - b);
  return hs[Math.floor(hs.length / 2)];
}

/**
 * Copy `bin` with table rules erased: any horizontal ink run spanning a large
 * fraction of the width, or any vertical run far taller than a text row, is a
 * border rather than a glyph. Left in place they bridge every gutter and the
 * page reads as one solid column.
 */
function suppressGridLines(bin, W, H, medH) {
  const out = Uint8Array.from(bin);
  const hMin = Math.max(8, Math.round(W * CFG.COL_HLINE_RATIO));
  const vMin = Math.max(8, Math.round(medH * CFG.COL_VLINE_RATIO));

  /* Horizontal rules */
  for (let y = 0; y < H; y++) {
    const base = y * W;
    let run = 0;
    for (let x = 0; x <= W; x++) {
      const ink = x < W && bin[base + x] === 0;
      if (ink) { run++; continue; }
      if (run >= hMin) for (let k = x - run; k < x; k++) out[base + k] = 1;
      run = 0;
    }
  }

  /* Vertical rules */
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y <= H; y++) {
      const ink = y < H && bin[y * W + x] === 0;
      if (ink) { run++; continue; }
      if (run >= vMin) for (let k = y - run; k < y; k++) out[k * W + x] = 1;
      run = 0;
    }
  }

  return out;
}

/**
 * Erase rules that run edge to edge across the image.
 *
 * `suppressGridLines` sizes its thresholds against the median row height, which
 * is not known until rows have been found — and a cell border running the
 * height of the crop is exactly what stops them from being found. It puts ink
 * on every scanline, so the horizontal projection never returns to zero, the
 * whole image comes back as one over-tall band, and the height filter throws
 * every row away. A hand-drawn selection that starts on a column separator or
 * clips the header keeps borders like that routinely.
 *
 * Ink reaching both edges needs no row geometry to judge: no glyph spans a
 * table crop end to end, so a thin run that does is a rule. Thickness is
 * checked as well, so a solid block — a row that binarized flat, say — is never
 * mistaken for one.
 */
function stripFullSpanRules(bin, W, H) {
  const out = Uint8Array.from(bin);
  const slack = CFG.RULE_SPAN_SLACK_SRC * CFG.UPSCALE;
  const maxThick = CFG.RULE_MAX_THICK_SRC * CFG.UPSCALE;

  /* Vertical: column separators, and the borders a crop begins or ends on. */
  const vSpan = new Uint8Array(W);
  const vMin = Math.max(8, H - slack);
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y < H; y++) {
      if (bin[y * W + x] === 0) { if (++run >= vMin) { vSpan[x] = 1; break; } }
      else run = 0;
    }
  }
  for (let x = 0; x < W; x++) {
    if (!vSpan[x]) continue;
    let end = x;
    while (end + 1 < W && vSpan[end + 1]) end++;
    if (end - x + 1 <= maxThick) {
      for (let cx = x; cx <= end; cx++) {
        for (let y = 0; y < H; y++) out[y * W + cx] = 1;
      }
    }
    x = end;
  }

  /* Horizontal: header underlines and row separators. */
  const hSpan = new Uint8Array(H);
  const hMin = Math.max(8, W - slack);
  for (let y = 0; y < H; y++) {
    const base = y * W;
    let run = 0;
    for (let x = 0; x < W; x++) {
      if (bin[base + x] === 0) { if (++run >= hMin) { hSpan[y] = 1; break; } }
      else run = 0;
    }
  }
  for (let y = 0; y < H; y++) {
    if (!hSpan[y]) continue;
    let end = y;
    while (end + 1 < H && hSpan[end + 1]) end++;
    if (end - y + 1 <= maxThick) {
      for (let cy = y; cy <= end; cy++) out.fill(1, cy * W, cy * W + W);
    }
    y = end;
  }

  return out;
}

/**
 * Strip table rules from a binary image, in the order the thresholds allow.
 *
 * Edge-to-edge rules go first, since they need no row geometry. Rows can then
 * be measured on the cleaned image, which unlocks `suppressGridLines` and the
 * shorter rules it recognizes — among them a border broken partway down
 * because the selected row's highlight is painted over it, which reaches
 * neither edge and would otherwise survive into segmentation as a ninth glyph.
 *
 * Returns the cleaned copy and how many ink pixels it dropped.
 */
function stripTableRules(bin, W, H) {
  let out = stripFullSpanRules(bin, W, H);

  const rows = findRows(hProjection(out, W, H), W, CFG.MIN_ROW_DENSITY)
    .filter(r => r.h >= CFG.UPSCALE * 5 && r.h <= CFG.UPSCALE * 30);
  if (rows.length) out = suppressGridLines(out, W, H, medianRowHeight(rows));

  let removed = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== bin[i]) removed++;
  return { bin: out, removed };
}

/**
 * Split the page into column bands: x-ranges of ink separated by gutters that
 * are empty in *every* text row. Ragged cell contents never close a gutter, so
 * only real column padding survives.
 */
function findColumnBands(bin, W, rows, medH, gutterOverride) {
  const inked = new Uint8Array(W);
  for (const row of rows) {
    for (let y = row.y; y < row.y + row.h; y++) {
      const base = y * W;
      for (let x = 0; x < W; x++) {
        if (bin[base + x] === 0) inked[x] = 1;
      }
    }
  }

  const minGutter = gutterOverride
    ? Math.max(2, Math.round(gutterOverride))
    : Math.max(2, Math.round(medH * CFG.COL_GUTTER_RATIO));
  const minBandW = CFG.MIN_DIGIT_W_SRC * CFG.UPSCALE;
  const bands = [];

  let x = 0;
  while (x < W) {
    if (!inked[x]) { x++; continue; }

    const start = x;
    let end = x, gap = 0;
    x++;
    while (x < W) {
      if (inked[x]) { end = x; gap = 0; }
      else if (++gap >= minGutter) break;
      x++;
    }
    bands.push({ x: start, w: end - start + 1 });
  }

  return bands.filter(b => b.w >= minBandW);
}

/**
 * Score one band as an MLS # candidate.
 *
 * Coverage comes first (cheap): the MLS column segments into exactly 8 glyphs
 * in nearly every row, which drops short numerics, dates and street names.
 * Bands that survive get a sample of rows classified, which is what separates
 * MLS numbers from the other 8-glyph cells — "$755,000" segments into 8 too,
 * but its glyphs come back as '$' and a comma rather than digits.
 */
