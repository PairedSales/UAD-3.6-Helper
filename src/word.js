/* ===== UAD 3.6 Helper — Whole-Word Template Matching ================== */
/* MLS-Extract reads digits one glyph at a time because an MLS number is    */
/* eight arbitrary digits. The two things this app has to read are not      */
/* arbitrary: the "Stat" cell holds one of ~20 known codes, and a header    */
/* cell holds one of ~25 known labels. Matching the WHOLE cell against the  */
/* whole rendered candidate is both cheaper and far more robust than        */
/* segmenting bold 4-letter tokens into letters and hoping each one wins.   */
/*                                                                         */
/* The raster is stretched to a fixed box rather than fitted, so tokens of  */
/* different widths align stroke-for-stroke; the width information that     */
/* throws away is put back as a separate aspect-ratio term.                 */
/* ===================================================================== */

/**
 * Rasterize an ink region into the fixed word box.
 * Returns { gray: Float32Array, aspect, w, h } or null when the region is blank.
 *
 * `gray` is inverted luminance (1 = ink) so it feeds ncc() directly.
 */
function rasterizeRegion(srcCanvas, bin, W, rx, ry, rw, rh) {
  const bb = tightBBox(bin, W, rx, ry, rw, rh);
  if (!bb || bb.w < 2 || bb.h < 2) return null;
  return rasterizeBox(srcCanvas, bb.x, bb.y, bb.w, bb.h);
}

/** Rasterize an already-tight box from a grayscale canvas. */
function rasterizeBox(srcCanvas, sx, sy, sw, sh) {
  const NW = CFG.WORD_NORM_W, NH = CFG.WORD_NORM_H;
  const c = document.createElement('canvas');
  c.width = NW;
  c.height = NH;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, NW, NH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, NW, NH);

  const d = ctx.getImageData(0, 0, NW, NH).data;
  const n = NW * NH;
  const gray = new Float32Array(n);
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) {
    const lum = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    const v = 1 - lum;
    gray[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  /* Contrast stretch, so a pale anti-aliased cell and a crisp one compare
   * on shape rather than on how dark the screenshot happened to be. */
  const range = hi - lo;
  if (range > 0.15) for (let i = 0; i < n; i++) gray[i] = (gray[i] - lo) / range;

  return { gray, canvas: c, aspect: sw / sh, w: sw, h: sh };
}

const _wordTemplateCache = {};

/**
 * Render a candidate string and rasterize it the same way.
 * Cached per (text, font, weight) — a screenshot asks for the same handful of
 * candidates once per row.
 */
function synthWordRaster(text, font, weight) {
  const key = `${weight}|${font}|${text}`;
  if (_wordTemplateCache[key]) return _wordTemplateCache[key];

  const size = CFG.SYNTH_FONT_SIZE;
  const pad = size;
  const probe = document.createElement('canvas');
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.font = `${weight} ${size}px ${font}`;
  const measured = Math.ceil(pctx.measureText(text).width);

  const c = document.createElement('canvas');
  c.width = measured + pad * 2;
  c.height = size * 3;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000000';
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, pad, c.height / 2);

  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const bin = new Uint8Array(c.width * c.height);
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    bin[i / 4] = g < 128 ? 0 : 1;
  }
  const bb = tightBBox(bin, c.width, 0, 0, c.width, c.height);
  if (!bb) return null;

  const raster = rasterizeBox(c, bb.x, bb.y, bb.w, bb.h);
  raster.text = text;
  raster.font = font;
  raster.weight = weight;
  _wordTemplateCache[key] = raster;
  return raster;
}

/**
 * Agreement between two aspect ratios, in [0, 1].
 * A 2× difference in width-for-height scores 0 — which is exactly what rules
 * out matching "FIN" (3 glyphs) against "PCHG" (4 glyphs).
 */
function aspectAgreement(a, b) {
  if (!(a > 0) || !(b > 0)) return 0;
  const ratio = Math.abs(Math.log(a / b)) / Math.LN2;
  return Math.max(0, 1 - ratio);
}

/** Combined word score: stretched-raster NCC, tempered by aspect agreement. */
function wordScore(raster, template) {
  const shape = ncc(raster.gray, template.gray);
  const asp = aspectAgreement(raster.aspect, template.aspect);
  const w = CFG.WORD_ASPECT_WEIGHT;
  return { combined: (1 - w) * shape + w * asp, shape, aspect: asp };
}

/**
 * Match one rasterized cell against a list of candidate strings.
 *
 * `candidates` are plain strings. Returns
 *   { text, score, margin, shape, aspect, ranked }
 *
 * `ranked` holds EVERY candidate, not a top-N slice. Cluster voting sums each
 * candidate's score across a cluster's members and divides by the member
 * count; truncating the list would zero out a runner-up in the members where
 * it fell outside the cut, deflating its mean and inflating the winner's
 * margin — the ambiguity guard would then be fooled in the direction of
 * overconfidence, which is the one direction that matters.
 */
function matchWord(raster, candidates, font, weight) {
  if (!raster) return null;
  const ranked = [];
  for (const text of candidates) {
    const tmpl = synthWordRaster(text, font, weight || CFG.SYNTH_WEIGHT);
    if (!tmpl) continue;
    const s = wordScore(raster, tmpl);
    ranked.push({ text, ...s });
  }
  if (!ranked.length) return null;
  ranked.sort((a, b) => b.combined - a.combined);

  return {
    text: ranked[0].text,
    score: ranked[0].combined,
    shape: ranked[0].shape,
    aspect: ranked[0].aspect,
    margin: ranked.length > 1 ? ranked[0].combined - ranked[1].combined : 1,
    ranked,
  };
}

/**
 * Pick the font family whose rendering of `samples` best explains the
 * observed rasters.
 *
 * connectMLS does not ship a font; it inherits the browser's UI stack, so the
 * same grid is Segoe UI on one machine and Helvetica on another. Rather than
 * guess, we score every candidate family against the cells we actually have
 * and keep the winner for the rest of the run.
 */
function pickFont(rasters, candidates, weight) {
  /* A handful of cells is plenty to tell five families apart, and this runs
   * once per candidate column: scoring every raster against every candidate in
   * five fonts was the single most expensive thing the app did. */
  const step = Math.max(1, Math.floor(rasters.length / CFG.FONT_SAMPLE_RASTERS));
  const sample = [];
  for (let i = 0; i < rasters.length && sample.length < CFG.FONT_SAMPLE_RASTERS; i += step) {
    sample.push(rasters[i]);
  }
  if (!sample.length) return { font: CFG.SYNTH_FONTS[0], mean: 0 };

  let best = null;
  for (const font of CFG.SYNTH_FONTS) {
    let total = 0;
    for (const raster of sample) {
      const m = matchWord(raster, candidates, font, weight);
      if (m) total += m.score;
    }
    const mean = total / sample.length;
    if (!best || mean > best.mean) best = { font, mean };
  }
  return best || { font: CFG.SYNTH_FONTS[0], mean: 0 };
}
