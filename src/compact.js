/* ===== UAD 3.6 Helper — Locate, then read only what matters ============ */
/* This is MLS-Extract's method, generalized from one column to several.     */
/*                                                                          */
/* MLS-Extract reads a full page by finding the MLS # column, cropping to    */
/* it, and re-analyzing that crop from scratch — every glyph it classifies   */
/* comes off a strip a few dozen pixels wide. Feeding it a hand-cropped      */
/* column is why it feels instant; on a full 23-column grid its own code     */
/* costs the same second of preprocessing this app used to.                  */
/*                                                                          */
/* So the work is split the same way:                                        */
/*                                                                          */
/*   1. A LOCATE pass at source resolution. It only has to find row bands    */
/*      and column bands, which needs no sub-pixel detail — and at 1x that   */
/*      is 1.5 megapixels instead of 24.                                     */
/*                                                                          */
/*   2. A short list of columns worth reading: the ones the header names,    */
/*      or failing that the ones whose shape could be money or a status.     */
/*                                                                          */
/*   3. A COMPACT surface — those columns cut out and laid side by side,     */
/*      then upscaled 4x. Row positions are untouched, so the compacted      */
/*      grid is just the original with the irrelevant columns removed, and   */
/*      every downstream stage runs on it unchanged at full fidelity.        */
/*                                                                          */
/* Of a 23-column grid, six or seven columns carry everything this app       */
/* reports on. The rest never reach a template.                              */
/* ===================================================================== */

/**
 * Read the header labels off a thin full-width band at reading resolution.
 *
 * This runs before the compaction, because what the header says is the best
 * evidence for which columns are worth keeping. It is affordable because the
 * band is only a row tall: a 1466-wide header at 4x is a third of a megapixel,
 * against 24 for the whole page.
 */
function readHeaderBand(surf) {
  if (surf.rows.length < 3) return null;

  const k = CFG.UPSCALE / surf.scale;
  const limit = Math.min(CFG.HEADER_MAX_ROWS, surf.rows.length - 1);
  const pad = Math.max(1, Math.round(surf.medH * 0.4));

  for (let i = 0; i < limit; i++) {
    const row = surf.rows[i];
    const y0 = Math.max(0, row.y - pad);
    const y1 = Math.min(surf.H, row.y + row.h + pad);

    const crop = cropCanvas(surf.grayClean || surf.gray, 0, y0, surf.W, y1 - y0);
    const band = buildBandSurface(crop, k);
    if (!band.rows.length) continue;

    /* One band, one row: judge the tallest thing in it. */
    const bandRow = band.rows.reduce((a, b) => (a.h > b.h ? a : b));
    const found = matchHeaderRow(band, bandRow);
    if (!found) continue;

    console.log(`[Header] source row ${i} (y=${row.y}): ${found.matches.length} labels, ` +
      `${found.anchors} anchors in ${found.font}` +
      ` — ${found.matches.map(m => `${m.label}:${m.score.toFixed(2)}`).join(', ')}`);

    if (found.matches.length >= CFG.HEADER_MIN_LABELS && found.anchors >= CFG.HEADER_MIN_ANCHORS) {
      /* Map each label back to a LOCATE column by horizontal overlap. */
      const roles = new Map();
      const taken = new Set();
      for (const m of found.matches.slice().sort((a, b) => b.score - a.score)) {
        const sx0 = m.token.bbox.x / k, sx1 = (m.token.bbox.x + m.token.bbox.w) / k;
        let best = null;
        for (const col of surf.columns) {
          if (taken.has(col)) continue;
          const ov = Math.min(sx1, col.x1) - Math.max(sx0, col.x0);
          if (ov <= 0) continue;
          const d = Math.abs((col.x0 + col.x1) / 2 - (sx0 + sx1) / 2);
          if (!best || d < best.d) best = { col, d };
        }
        if (best) { taken.add(best.col); roles.set(best.col, m.role); }
      }
      return { rowIndex: i, row, roles, font: found.font, matches: found.matches };
    }
  }
  return null;
}

/** Grayscale crop → an upscaled, binarized, row-detected surface. */
function buildBandSurface(grayCrop, k) {
  const up = k === 1 ? cloneCanvas(grayCrop) : upscaleCanvas(grayCrop, k);
  setWorkScale(CFG.UPSCALE);
  const analyzed = analyzeSurface(up);
  const surf = Object.assign({}, analyzed, { scale: CFG.UPSCALE });
  surf.glyphW = measureGlyphWidth(surf);
  return surf;
}

/** Match one row of a band surface against the known header labels. */
function matchHeaderRow(band, row) {
  const candidates = [];
  for (const h of HEADER_LABELS) {
    candidates.push(h.text);
    if (ANCHOR_HEADER_ROLES.includes(h.role)) candidates.push(h.text + '▲', h.text + '▼');
  }

  const tokens = extractTokens(band, row,
    Math.max(3 * band.scale, Math.round(band.glyphW * 1.35)));
  if (tokens.length < CFG.HEADER_MIN_LABELS) return null;

  const rasters = tokens
    .map(t => rasterizeBox(band.gray, t.bbox.x, t.bbox.y, t.bbox.w, t.bbox.h))
    .filter(Boolean);
  const font = pickFont(rasters, candidates, 'bold').font;

  const matches = [];
  const seen = new Set();
  for (const t of tokens) {
    const raster = rasterizeBox(band.gray, t.bbox.x, t.bbox.y, t.bbox.w, t.bbox.h);
    const m = matchWord(raster, candidates, font, 'bold');
    if (!m || m.score < CFG.HEADER_MIN_WORD_SCORE) continue;
    const base = m.text.replace(/[▲▼]$/, '');
    const entry = HEADER_LABELS.find(h => h.text === base);
    const role = entry ? entry.role : 'text';
    matches.push({ token: t, label: base, role, score: m.score });
    seen.add(role);
  }

  return { matches, font, anchors: ANCHOR_HEADER_ROLES.filter(r => seen.has(r)).length };
}

/**
 * Which locate-columns are worth upscaling and reading.
 *
 * With a header this is exact. Without one it falls back to shape: money cells
 * carry thousands separators, a status cell is a short all-caps token, an MLS
 * number is eight glyphs, and the row number is one to three. Those tests cost
 * nothing — they read glyph counts that tokenizing already produced — and they
 * are deliberately generous, because keeping a column we did not need only
 * costs a slice of a megapixel, while dropping one we did would be silent.
 */
function columnsWorthReading(surf, header) {
  const keep = new Set();
  const why = new Map();
  const mark = (col, reason) => { if (col) { keep.add(col); why.set(col, reason); } };

  /* The row-number column is always worth keeping: it is the only independent
   * check that no listing was lost, and it is a dozen pixels wide. */
  for (const col of surf.columns) {
    const cells = Array.from(col.cells.values());
    if (cells.length < 3) continue;
    if (cells.filter(t => t.tall.length >= 1 && t.tall.length <= 3).length / cells.length >= 0.9) {
      mark(col, 'index?');
      break;                                   /* leftmost only */
    }
  }

  const named = header
    ? Array.from(header.roles.entries())
        .filter(([, role]) => ['status', 'list', 'orig', 'sold', 'conc', 'mls'].includes(role))
    : [];

  /* A header that named the status column and at least one money column has
   * told us everything; guessing further would only add pixels. */
  const decisive = named.some(([, r]) => r === 'status') &&
                   named.some(([, r]) => ['list', 'sold', 'orig'].includes(r));

  for (const [col, role] of named) mark(col, role);
  if (decisive) return finishKeep(surf, keep, why);

  /* No header, or a partial one: fall back to shape. Deliberately generous —
   * keeping a column we did not need costs a slice of a megapixel, dropping
   * one we did would be silent. */
  for (const col of surf.columns) {
    if (keep.has(col)) continue;
    const cells = Array.from(col.cells.values());
    if (!cells.length) continue;
    const frac = (f) => cells.filter(f).length / cells.length;

    if (frac(t => t.commas.length) >= 0.8) mark(col, 'money?');
    else if (frac(t => t.tall.length === CFG.MLS_DIGITS) >= 0.6) mark(col, 'mls?');
    else if (frac(t => t.tall.length >= 2 && t.tall.length <= 5) >= 0.8 &&
             (col.x1 - col.x0) <= surf.glyphW * 10) mark(col, 'status?');
  }
  return finishKeep(surf, keep, why);
}

function finishKeep(surf, keep, why) {

  const kept = surf.columns.filter(c => keep.has(c));
  const px = kept.reduce((s, c) => s + (c.x1 - c.x0), 0);
  console.log(`[Compact] keeping ${kept.length}/${surf.columns.length} columns ` +
    `(${px}/${surf.W} source px): ` +
    kept.map(c => `${c.index}:${why.get(c)}`).join(' '));
  return kept;
}

/**
 * Cut the kept columns out and lay them side by side at reading resolution.
 *
 * Row positions are preserved exactly — only x changes — so the result is the
 * original grid with the irrelevant columns deleted. Every stage downstream
 * runs on it without knowing anything happened.
 */
function buildCompactSurface(surf, keep) {
  const k = CFG.UPSCALE / surf.scale;
  const pad = Math.max(1, CFG.COLUMN_PAD_SRC * surf.scale);
  const gap = Math.max(2, CFG.COLUMN_GAP_SRC * surf.scale);

  const ranges = keep
    .map(c => ({ x0: Math.max(0, c.x0 - pad), x1: Math.min(surf.W, c.x1 + pad) }))
    .sort((a, b) => a.x0 - b.x0);

  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.x0 <= last.x1 + gap) last.x1 = Math.max(last.x1, r.x1);
    else merged.push({ x0: r.x0, x1: r.x1 });
  }

  const width = merged.reduce((s, r) => s + (r.x1 - r.x0), 0) + gap * (merged.length + 1);
  const flat = document.createElement('canvas');
  flat.width = Math.max(1, width);
  flat.height = surf.H;
  const ctx = flat.getContext('2d', { willReadFrequently: true });
  /* White, because the locate surface is already grayscale and
   * shading-normalized: white is the page. */
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, flat.width, flat.height);

  let dx = gap;
  for (const r of merged) {
    const w = r.x1 - r.x0;
    ctx.drawImage(surf.grayClean || surf.gray, r.x0, 0, w, surf.H, dx, 0, w, surf.H);
    r.dx = dx;
    dx += w + gap;
  }

  const up = k === 1 ? cloneCanvas(flat) : upscaleCanvas(flat, k);
  setWorkScale(CFG.UPSCALE);

  const work = cloneCanvas(up);
  const thr = binarize(work);
  const W = up.width, H = up.height;
  const stripped = stripTableRules(getBinary(work), W, H);
  const bin = stripped.bin;

  const rawRows = findRows(hProjection(bin, W, H), W, CFG.MIN_ROW_DENSITY);
  const minH = CFG.UPSCALE * 5, maxH = CFG.UPSCALE * 30;
  const rows = rawRows.filter(r => r.h >= minH && r.h <= maxH);

  const compact = {
    src: surf.src,
    rgb: surf.rgb,
    gray: up, bin, W, H,
    scale: CFG.UPSCALE,
    /* Maps a compacted x back to the source, for colour sampling. */
    segments: merged.map(r => ({ dx: r.dx * k, w: (r.x1 - r.x0) * k, sx: r.x0 / surf.scale })),
    sourceScale: surf.scale,
    rows, rawRows,
    droppedRows: rawRows.filter(r => r.h < minH || r.h > maxH),
    medH: medianRowHeight(rows),
    thr,
    shadedBands: surf.shadedBands,
    rulesRemoved: stripped.removed,
    downscaled: surf.downscaled,
  };
  /* Glyph width is a property of the screenshot's font, so it is carried over
   * from the whole page rather than re-measured on the compacted one. The
   * compacted surface is almost all digits, which are narrower than letters;
   * measuring there returns a smaller width, and every threshold derived from
   * it then treats a bold 'A' as two merged glyphs and splits it down the
   * middle. */
  compact.glyphW = Math.max(surf.scale * 2, Math.round(surf.glyphW * k));

  console.log(`[Compact] ${surf.W}×${surf.H} @${surf.scale}× → ${W}×${H} @${CFG.UPSCALE}× ` +
    `(${(W * H / 1e6).toFixed(1)} Mpx, was ${(surf.W * surf.H * k * k / 1e6).toFixed(1)}); ` +
    `${rows.length} rows; glyphW ${compact.glyphW}`);

  return compact;
}

/** Compacted x → source x, for sampling colour from the original pixels. */
function compactToSourceX(surf, x) {
  if (!surf.segments) return x / surf.scale;
  for (const s of surf.segments) {
    if (x >= s.dx && x <= s.dx + s.w) return s.sx + (x - s.dx) / surf.scale;
  }
  return x / surf.scale;
}
