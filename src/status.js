/* ===== UAD 3.6 Helper — Status Column Recognition ===================== */
/* The "Stat" cell is the one field this app cannot afford to get wrong: a   */
/* misread status moves a listing into the wrong bucket, which changes a     */
/* count, a low, a high and a median all at once — and because cells are     */
/* labelled per CLUSTER, one mistake moves every row that shares it.         */
/*                                                                          */
/* Three things make it tractable where free-form OCR would not be:          */
/*                                                                          */
/*   1. The vocabulary is CLOSED. The recognizer never spells a word out of  */
/*      letters and hopes; it renders each real connectMLS code and asks     */
/*      which one the cell looks most like.                                  */
/*                                                                          */
/*   2. Every cell showing the same code is pixel-identical, so the cells    */
/*      are clustered first and decided once per cluster with every member   */
/*      voting. Twenty-one CLSD cells become one twenty-one-sample decision. */
/*                                                                          */
/*   3. Whatever does not clear the bar is reported as unreadable. Because   */
/*      the vocabulary is closed, an unknown code would otherwise be given   */
/*      the name of whichever known code it least resembles — so there is an */
/*      absolute floor on the raw correlation, not just a relative margin.   */
/* ===================================================================== */

/**
 * Average colour of a cell's ink.
 *
 * Takes the darkest quarter of the pixels inside the glyph box, so the value
 * comes from stroke cores rather than anti-aliased edges — which is what keeps
 * one code sampling to the same colour on a shaded row and an unshaded one.
 */
function sampleInkColor(rgbCanvas, box) {
  const ctx = rgbCanvas.getContext('2d', { willReadFrequently: true });
  const x = Math.max(0, box.x), y = Math.max(0, box.y);
  const w = Math.min(rgbCanvas.width - x, box.w), h = Math.min(rgbCanvas.height - y, box.h);
  if (w <= 0 || h <= 0) return null;

  const d = ctx.getImageData(x, y, w, h).data;
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  }
  const sorted = Float32Array.from(lum).sort();
  const cut = sorted[Math.max(0, Math.floor(n * 0.25) - 1)];

  let r = 0, g = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) {
    if (lum[i] > cut) continue;
    r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; c++;
  }
  if (!c) return null;
  return { r: Math.round(r / c), g: Math.round(g / c), b: Math.round(b / c) };
}

function colorDistance(a, b) {
  if (!a || !b) return Infinity;
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function colorHex(c) {
  if (!c) return '#000000';
  const h = v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Extra margin required when the top two candidates differ by one glyph. */
function requiredMargin(top, second) {
  if (!second) return CFG.STATUS_MIN_MARGIN;
  for (const [a, b] of CONFUSABLE_STATUS_PAIRS) {
    if ((top === a && second === b) || (top === b && second === a)) {
      return CFG.STATUS_CONFUSABLE_MARGIN;
    }
  }
  return CFG.STATUS_MIN_MARGIN;
}

/**
 * Score one column as the "Stat" column.
 *
 * Columns of ordinary words — "Dolton", "Avenue", "Split" — do not clear the
 * bar, because none of them look like a short all-caps code at the right
 * aspect ratio.
 */
function scoreStatusColumn(surf, dataRows, col, headerRole) {
  const cells = [];
  for (const [row, token] of col.cells) {
    if (token.tall.length < 1 || token.tall.length > CFG.STATUS_MAX_GLYPHS) continue;
    const raster = rasterizeBox(surf.gray, token.bbox.x, token.bbox.y, token.bbox.w, token.bbox.h);
    if (raster) cells.push({ token, row, raster });
  }
  if (cells.length < 2) return null;

  const font = pickFont(cells.map(c => c.raster), RECOGNIZED_TOKENS, CFG.SYNTH_WEIGHT).font;

  let resolved = 0, scoreSum = 0;
  for (const cell of cells) {
    const m = matchWord(cell.raster, RECOGNIZED_TOKENS, font, CFG.SYNTH_WEIGHT);
    cell.match = m;
    if (m && m.score >= CFG.STATUS_MIN_SCORE && m.shape >= CFG.STATUS_ABS_SHAPE &&
        m.margin >= requiredMargin(m.text, m.ranked[1] && m.ranked[1].text)) {
      resolved++;
      scoreSum += m.score;
    }
  }

  const resolvedFrac = cells.length ? resolved / cells.length : 0;
  const meanScore = resolved ? scoreSum / resolved : 0;
  const coverage = dataRows.length ? Math.min(1, cells.length / dataRows.length) : 0;
  const headerBonus = headerRole === 'status' ? 0.5 : 0;

  return {
    col, cells, font, resolvedFrac, meanScore, coverage, headerBonus,
    score: resolvedFrac * 0.5 + meanScore * 0.3 + coverage * 0.2 + headerBonus,
  };
}

/** Find the status column. */
function findStatusColumn(surf, dataRows, cols, headerRoles) {
  let best = null;
  for (const col of cols) {
    const res = scoreStatusColumn(surf, dataRows, col, headerRoles.get(col));
    if (!res) continue;
    if (res.resolvedFrac > 0 || res.headerBonus) {
      console.log(`[Stat] col ${col.index} x=${col.x0}-${col.x1}: ` +
        `resolved ${(100 * res.resolvedFrac).toFixed(0)}% mean ${res.meanScore.toFixed(2)} ` +
        `coverage ${(100 * res.coverage).toFixed(0)}%${res.headerBonus ? ' +header' : ''} ` +
        `→ ${res.score.toFixed(3)}`);
    }
    if (!best || res.score > best.score) best = res;
  }

  if (!best) return null;
  if (best.resolvedFrac < CFG.STATUS_BAND_MIN_FRAC) {
    console.log(`[Stat] best column resolved only ${(100 * best.resolvedFrac).toFixed(0)}% ` +
      `of its cells — below the ${(100 * CFG.STATUS_BAND_MIN_FRAC).toFixed(0)}% bar`);
    return null;
  }
  return best;
}

/** Ink width of a rasterized cell, used as a hard gate before correlating. */
function inkWidth(cell) {
  return cell.raster.w;
}

/**
 * Group status cells that show the same code.
 *
 * Three branches, and the ordering is deliberate. Colour must never be able to
 * VETO a merge of two near-identical bitmaps: row shading moves anti-aliased
 * ink by a few RGB points, and a colour veto there would split one code into
 * two clusters, each then judged on fewer votes. Equally, colour alone must
 * never merge two clearly different shapes. So colour only decides the middle
 * band, where the shapes are similar but not conclusive.
 *
 * Width is checked before correlation because the rasters are stretched to a
 * fixed box: two codes of different lengths correlate deceptively well once
 * that stretch has thrown their proportions away.
 */
function clusterStatusCells(surf, cells) {
  for (const cell of cells) cell.color = sampleInkColor(surf.rgb, cell.token.bbox);

  const clusters = [];
  for (const cell of cells) {
    let target = null;
    for (const cl of clusters) {
      const w1 = inkWidth(cell), w2 = inkWidth(cl.medoid);
      if (Math.abs(w1 - w2) / Math.max(w1, w2) > CFG.CLUSTER_WIDTH_TOL) continue;

      const shape = ncc(cell.raster.gray, cl.medoid.raster.gray);
      if (shape >= CFG.CLUSTER_SHAPE_MERGE) { target = cl; break; }
      if (shape < CFG.CLUSTER_SHAPE_NEVER) continue;
      if (colorDistance(cl.color, cell.color) <= CFG.COLOR_CLUSTER_DIST) { target = cl; break; }
    }
    if (target) target.members.push(cell);
    else clusters.push({ medoid: cell, color: cell.color, members: [cell] });
  }

  /* Re-centre each cluster's colour and medoid over all its members. */
  for (const cl of clusters) {
    const cols = cl.members.map(m => m.color).filter(Boolean);
    if (cols.length) {
      cl.color = {
        r: Math.round(cols.reduce((s, c) => s + c.r, 0) / cols.length),
        g: Math.round(cols.reduce((s, c) => s + c.g, 0) / cols.length),
        b: Math.round(cols.reduce((s, c) => s + c.b, 0) / cols.length),
      };
    }
    cl.colorSpread = Math.max(0, ...cl.members.map(m => colorDistance(cl.color, m.color))
      .filter(d => isFinite(d)));
  }

  clusters.sort((a, b) => b.members.length - a.members.length);
  return clusters;
}

/**
 * Label each cluster by the mean score of its members over the FULL candidate
 * list, and hand that label to every row in the cluster.
 *
 * A cluster whose winner does not clear the absolute correlation floor, the
 * score bar, or the margin over its runner-up is left unlabelled. Its rows are
 * surfaced as unreadable so an appraiser can name them, rather than being
 * filed under whatever happened to score highest.
 */
function labelStatusClusters(clusters, font) {
  const byRow = new Map();

  for (const cl of clusters) {
    const combined = new Map();
    const shapes = new Map();
    for (const cell of cl.members) {
      const m = cell.match ||
        (cell.match = matchWord(cell.raster, RECOGNIZED_TOKENS, font, CFG.SYNTH_WEIGHT));
      if (!m) continue;
      for (const r of m.ranked) {
        combined.set(r.text, (combined.get(r.text) || 0) + r.combined);
        shapes.set(r.text, (shapes.get(r.text) || 0) + r.shape);
      }
    }

    const n = cl.members.length;
    const ranked = Array.from(combined.entries())
      .map(([text, sum]) => ({ text, mean: sum / n, shape: (shapes.get(text) || 0) / n }))
      .sort((a, b) => b.mean - a.mean);

    cl.ranked = ranked;
    const top = ranked[0];
    const second = ranked[1];
    const margin = second ? top.mean - second.mean : 1;
    const needMargin = requiredMargin(top && top.text, second && second.text);

    /* A one-cell cluster has no votes behind it, so it has to be clearer on
     * its own — either by scoring higher, or by beating every one of the other
     * codes by a wide margin, which is different evidence of the same
     * strength. Insisting on the score alone would refuse a correct reading of
     * a code that simply renders less like its template in this font. */
    const decisive = margin >= CFG.STATUS_SINGLETON_MARGIN;
    const floor = (n === 1 && !decisive) ? CFG.STATUS_SINGLETON_SCORE : CFG.STATUS_MIN_SCORE;

    cl.score = top ? top.mean : 0;
    cl.shape = top ? top.shape : 0;
    cl.margin = margin;
    cl.code = null;
    cl.reject = null;

    if (!top) cl.reject = 'no-candidates';
    else if (top.shape < CFG.STATUS_ABS_SHAPE) cl.reject = `shape ${top.shape.toFixed(2)} below floor`;
    else if (top.mean < floor) cl.reject = `score ${top.mean.toFixed(2)} below ${floor}`;
    else if (margin < needMargin) cl.reject = `margin ${margin.toFixed(3)} below ${needMargin}`;
    else cl.code = top.text;

    console.log(`[Stat] cluster ×${n} ${colorHex(cl.color)} → ${cl.code || 'UNREADABLE'} ` +
      `(score ${cl.score.toFixed(3)}, shape ${cl.shape.toFixed(3)}, margin ${cl.margin.toFixed(3)}` +
      (second ? `, runner-up ${second.text} ${second.mean.toFixed(3)}` : '') +
      (cl.reject ? ` — rejected: ${cl.reject}` : '') + ')');

    for (const cell of cl.members) {
      byRow.set(cell.row, {
        code: cl.code, score: cl.score, shape: cl.shape, margin: cl.margin,
        color: cell.color, cluster: cl, token: cell.token,
        ranked: cl.ranked.slice(0, 4), reject: cl.reject,
      });
    }
  }

  return byRow;
}

/**
 * Two clusters with the same label are usually one code rendered on a shaded
 * row and an unshaded one. Merging them keeps the debug panel honest about how
 * many distinct codes were seen — but if their sampled colours are far apart,
 * that is a contradiction worth raising rather than swallowing, because colour
 * is the evidence that would reveal a shape-based mislabel.
 */
function mergeSameCodeClusters(clusters) {
  const byCode = new Map();
  const out = [];
  const contradictions = [];

  for (const cl of clusters) {
    if (!cl.code) { out.push(cl); continue; }
    const existing = byCode.get(cl.code);
    if (!existing) { byCode.set(cl.code, cl); out.push(cl); continue; }

    const dist = colorDistance(existing.color, cl.color);
    if (isFinite(dist) && dist > CFG.COLOR_CLUSTER_DIST) {
      contradictions.push({
        code: cl.code,
        colors: [colorHex(existing.color), colorHex(cl.color)],
        counts: [existing.members.length, cl.members.length],
        distance: Math.round(dist),
      });
    }
    existing.members.push(...cl.members);
    existing.score = Math.max(existing.score, cl.score);
  }

  return { clusters: out, contradictions };
}
