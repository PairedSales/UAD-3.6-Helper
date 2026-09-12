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
function sampleInkColor(surf, box) {
  const rgbCanvas = surf.rgb;
  const ctx = rgbCanvas.getContext('2d', { willReadFrequently: true });
  /* Boxes are in the working surface's coordinates, which may be a compacted
   * arrangement of the original columns; the colour canvas is the untouched
   * source. */
  const k = surf.scale;
  const x = Math.max(0, Math.floor(compactToSourceX(surf, box.x)));
  const y = Math.max(0, Math.floor(box.y / k));
  const w = Math.min(rgbCanvas.width - x, Math.max(1, Math.round(box.w / k)));
  const h = Math.min(rgbCanvas.height - y, Math.max(1, Math.round(box.h / k)));
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
/**
 * Does this column hold numbers?
 *
 * Stretched to a fixed raster, a two-digit number correlates alarmingly well
 * with a two-letter code — nineteen of the integers below 100 match "SS" above
 * the acceptance bar. So a column whose cells read as digits is disqualified
 * outright, before any word score is consulted. Days-on-market silently
 * relabelled as a status moves every row in the grid into one bucket.
 */
function columnIsNumeric(surf, col, bank) {
  const cells = Array.from(col.cells.entries());
  if (!cells.length) return false;
  const step = Math.max(1, Math.floor(cells.length / 8));

  let looked = 0, numeric = 0;
  for (let i = 0; i < cells.length && looked < 8; i += step) {
    const token = cells[i][1];
    if (!token.tall.length || token.tall.length > 6) continue;
    looked++;
    let allDigits = true;
    for (const g of token.tall) {
      const norm = normalizeGlyph(surf.gray, g.x, g.y, g.w, g.h);
      norm.features = computeStructuralFeatures(norm.binary, CFG.NORM_W, CFG.NORM_H, norm.grayscale);
      const cls = classifyGlyph(norm, bank);
      if (!/^[0-9]$/.test(String(cls.digit)) || cls.score < CFG.MIN_DIGIT_SCORE) {
        allDigits = false;
        break;
      }
    }
    if (allDigits) numeric++;
  }
  return looked >= 2 && numeric / looked >= 0.75;
}

function scoreStatusColumn(surf, dataRows, col, headerRole, bank, font) {
  const cells = [];
  for (const [row, token] of col.cells) {
    if (token.tall.length < 1 || token.tall.length > CFG.STATUS_MAX_GLYPHS) continue;
    const raster = rasterizeBox(surf.gray, token.bbox.x, token.bbox.y, token.bbox.w, token.bbox.h);
    if (raster) cells.push({ token, row, raster });
  }
  if (cells.length < 2) return null;
  if (bank && headerRole !== 'status' && columnIsNumeric(surf, col, bank)) return null;

  /* Which codes this column can hold — MRED's or Matrix's one-letter set — is
   * settled for the whole column from its glyph counts. See statusVocabularyFor. */
  const vocab = statusVocabularyFor(cells, headerRole === 'status');

  /* Candidacy is judged on a sample; the winning column is read in full
   * afterwards. Scoring every cell of every column is what made a large grid
   * appear to hang. */
  const step = Math.max(1, Math.floor(cells.length / CFG.STATUS_SAMPLE_CELLS));
  const sample = [];
  for (let i = 0; i < cells.length && sample.length < CFG.STATUS_SAMPLE_CELLS; i += step) {
    sample.push(cells[i]);
  }

  /* The stroke weight, from this column's own cells. connectMLS prints its
   * codes bold and Matrix prints its letters regular, and the header is no
   * guide to it: the two are set independently. Decided once per column, on
   * the same sample that judges its candidacy. */
  const weight = pickWeight(sample.map(c => c.raster), vocab.tokens, font, CFG.SYNTH_WEIGHTS);

  let resolved = 0, scoreSum = 0;
  for (const cell of sample) {
    const m = matchWord(cell.raster, vocab.tokens, font, weight);
    cell.match = m;
    if (m && m.score >= CFG.STATUS_MIN_SCORE && m.shape >= CFG.STATUS_ABS_SHAPE &&
        m.margin >= requiredMargin(m.text, m.ranked[1] && m.ranked[1].text)) {
      resolved++;
      scoreSum += m.score;
    }
  }

  const resolvedFrac = sample.length ? resolved / sample.length : 0;
  const meanScore = resolved ? scoreSum / resolved : 0;
  const coverage = dataRows.length ? Math.min(1, cells.length / dataRows.length) : 0;
  const headerBonus = headerRole === 'status' ? 0.5 : 0;

  return {
    col, cells, font, weight, vocab, resolvedFrac, meanScore, coverage, headerBonus,
    score: resolvedFrac * 0.5 + meanScore * 0.3 + coverage * 0.2 + headerBonus,
  };
}

/**
 * Find the status column.
 *
 * When the header named one, that column wins outright. Shape evidence alone
 * is not enough to overrule a label: the failure it guards against — a numeric
 * column winning and every row inheriting one code — moves the entire grid
 * into one bucket at once.
 */
function findStatusColumn(surf, dataRows, cols, headerRoles, bank, uiFont) {
  let best = null;
  let headerNamed = null;

  /* The font family is a property of the SCREENSHOT, not of a column, so it is
   * chosen once. Choosing it per column meant five families × the whole
   * vocabulary × a sample of cells, twenty-odd times over — and a per-column
   * sample small enough to be affordable was also small enough to pick the
   * wrong family. One decision, made on plenty of evidence, is both faster and
   * more reliable. */
  const font = uiFont || pickStatusFont(surf, cols, headerRoles);

  for (const col of cols) {
    const res = scoreStatusColumn(surf, dataRows, col, headerRoles.get(col), bank, font);
    if (!res) continue;
    if (res.headerBonus) headerNamed = res;
    if (res.resolvedFrac > 0 || res.headerBonus) {
      console.log(`[Stat] col ${col.index} x=${col.x0}-${col.x1} (${res.vocab.id}, ${res.weight}): ` +
        `resolved ${(100 * res.resolvedFrac).toFixed(0)}% mean ${res.meanScore.toFixed(2)} ` +
        `coverage ${(100 * res.coverage).toFixed(0)}%${res.headerBonus ? ' +header' : ''} ` +
        `→ ${res.score.toFixed(3)}`);
    }
    if (!best || res.score > best.score) best = res;
  }

  if (headerNamed && headerNamed !== best) {
    console.log(`[Stat] col ${best.col.index} outscored the header-named col ` +
      `${headerNamed.col.index}; keeping the header's choice`);
    best = headerNamed;
  }

  if (!best) return null;
  if (best.resolvedFrac < CFG.STATUS_BAND_MIN_FRAC) {
    console.log(`[Stat] best column resolved only ${(100 * best.resolvedFrac).toFixed(0)}% ` +
      `of its sampled cells — below the ${(100 * CFG.STATUS_BAND_MIN_FRAC).toFixed(0)}% bar`);
    return null;
  }
  return best;
}

/**
 * Choose the UI font family from whichever column looks most like the status
 * column, before any column has been scored.
 *
 * Used only when no header row was recognized; with a header, its labels are
 * far better evidence and the font comes from there.
 */
function pickStatusFont(surf, cols, headerRoles) {
  let candidate = null;
  for (const col of cols) {
    if (headerRoles.get(col) === 'status') { candidate = col; break; }
    const short = Array.from(col.cells.values())
      .filter(t => t.tall.length >= 2 && t.tall.length <= CFG.STATUS_MAX_GLYPHS).length;
    if (short < 3) continue;
    if (!candidate || short > candidate._shortCount) { candidate = col; candidate._shortCount = short; }
  }
  if (!candidate) return CFG.SYNTH_FONTS[0];

  const rasters = [];
  for (const t of candidate.cells.values()) {
    const r = rasterizeBox(surf.gray, t.bbox.x, t.bbox.y, t.bbox.w, t.bbox.h);
    if (r) rasters.push(r);
  }
  const pick = pickFont(rasters, RECOGNIZED_TOKENS, CFG.SYNTH_WEIGHT);
  console.log(`[Stat] UI font chosen from col ${candidate.index}: ${pick.font} (${pick.mean.toFixed(3)})`);
  return pick.font;
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
  for (const cell of cells) cell.color = sampleInkColor(surf, cell.token.bbox);

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
 * Turn one cluster's per-cell matches into a decision.
 *
 * Every member votes, so a cluster of twenty CLSD cells is one twenty-sample
 * decision. The three bars are absolute rather than relative, which is what
 * lets an unknown code be refused instead of named after whichever known code
 * it least resembles.
 *
 * Returns { ranked, top, second, score, shape, margin, reject } with `reject`
 * null only when every bar is cleared.
 */
function voteOnMatches(matches, memberCount) {
  const combined = new Map();
  const shapes = new Map();
  let voters = 0;
  for (const m of matches) {
    if (!m) continue;
    voters++;
    for (const r of m.ranked) {
      combined.set(r.text, (combined.get(r.text) || 0) + r.combined);
      shapes.set(r.text, (shapes.get(r.text) || 0) + r.shape);
    }
  }

  /* Divide by the members that actually voted, not by the cluster size: a
   * member whose raster produced no match should not drag every candidate's
   * mean down, because the floors are absolute. */
  const denom = voters || 1;
  const ranked = Array.from(combined.entries())
    .map(([text, sum]) => ({ text, mean: sum / denom, shape: (shapes.get(text) || 0) / denom }))
    .sort((a, b) => b.mean - a.mean);

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
  const floor = (memberCount === 1 && !decisive)
    ? CFG.STATUS_SINGLETON_SCORE : CFG.STATUS_MIN_SCORE;

  let reject = null;
  if (!top) reject = 'no-candidates';
  else if (top.shape < CFG.STATUS_ABS_SHAPE) reject = `shape ${top.shape.toFixed(2)} below floor`;
  else if (top.mean < floor) reject = `score ${top.mean.toFixed(2)} below ${floor}`;
  else if (margin < needMargin) reject = `margin ${margin.toFixed(3)} below ${needMargin}`;

  return {
    ranked, top, second, margin, reject,
    score: top ? top.mean : 0,
    shape: top ? top.shape : 0,
  };
}

/**
 * Is a kick-out suffix digits?
 *
 * Note what this does NOT do: read them. The hours move no row between
 * buckets and enter no price, no median and no ratio — so printing HS124 for
 * a cell that says HS120 buys nothing and puts a number on screen that
 * contradicts the screenshot. The reported code is the base one, which is
 * also what normalizeStatusCode() folds a hand-typed HS48 onto.
 *
 * What the digits are FOR is the gate. Two letters followed by something that
 * is not a number is not a kick-out cell, and a clipped PCHG whose first two
 * glyphs happen to read P and C must not become a pending PC.
 *
 * So the test is whether a digit is a CREDIBLE reading of each suffix glyph,
 * not whether it wins outright. Bold O and 0 are the same shape — in Verdana
 * they finish 0.011 apart — and demanding the digit win refuses HS120 over a
 * coin toss. Nothing rides on which way that toss lands: a kick-out code is
 * exactly two letters, so no letter reading of a suffix glyph spells a valid
 * code either. A real letter is not close to any digit at all, which is the
 * only distinction the gate has to make.
 */
function suffixIsDigits(surf, cells, font) {
  const len = cells[0].token.tall.length;
  for (let i = CFG.KICKOUT_LETTERS; i < len; i++) {
    const matches = cells.map(cell => {
      const g = cell.token.tall[i];
      const raster = rasterizeBox(surf.gray, g.x, g.y, g.w, g.h);
      return raster && matchWord(raster, STATUS_GLYPHS, font, CFG.SYNTH_WEIGHT);
    });
    const v = voteOnMatches(matches, cells.length);
    if (!v.top) return false;
    const digit = v.ranked.find(r => /^[0-9]$/.test(r.text));
    if (!digit || digit.shape < CFG.STATUS_ABS_SHAPE) return false;
    if (v.top.mean - digit.mean > CFG.STATUS_CONFUSABLE_MARGIN) return false;
  }
  return true;
}

/**
 * Read the letters of a kick-out prefix, ONE GLYPH AT A TIME.
 *
 * The whole-cell matcher is the right reader for a closed vocabulary and the
 * wrong one here. Correlated as a two-letter word, HS and HC share their first
 * glyph, so half the stretched raster agrees whichever is right and the two
 * finish 0.06 apart — under the margin a one-glyph confusion is required to
 * clear, and the cell is refused. Ranked glyph by glyph, the second letter is
 * S at 0.74 with C nowhere near it. The evidence was always there; averaging
 * it against an identical H is what hid it.
 *
 * Every member of the cluster votes on every position, exactly as the
 * whole-cell path does.
 *
 * Returns { code, score, shape, margin } or { reject }.
 */
function readKickoutLetters(surf, cells, font) {
  const letters = [], votes = [];
  for (let i = 0; i < CFG.KICKOUT_LETTERS; i++) {
    const matches = cells.map(cell => {
      const g = cell.token.tall[i];
      const raster = rasterizeBox(surf.gray, g.x, g.y, g.w, g.h);
      return raster && matchWord(raster, STATUS_GLYPHS, font, CFG.SYNTH_WEIGHT);
    });
    const v = voteOnMatches(matches, cells.length);
    if (v.reject) return { reject: `letter ${i + 1} ${v.reject}` };
    letters.push(v.top.text);
    votes.push(v);
  }

  const code = letters.join('');
  if (KICKOUT_CODES.indexOf(code) < 0) return { reject: `"${code}" is not a kick-out code` };

  for (let i = 0; i < CFG.KICKOUT_LETTERS; i++) {
    const mean = new Map(votes[i].ranked.map(r => [r.text, r.mean]));
    for (const rival of kickoutRivals(code, i)) {
      const gap = votes[i].top.mean - (mean.get(rival) || 0);
      if (gap < CFG.STATUS_CONFUSABLE_MARGIN) {
        return { reject: `letter ${i + 1} beats ${rival} by only ${gap.toFixed(3)}` };
      }
    }
  }

  /* The weakest glyph is the confidence in the code, not the best one. */
  return {
    code,
    score: Math.min(...votes.map(v => v.score)),
    shape: Math.min(...votes.map(v => v.shape)),
    margin: Math.min(...votes.map(v => v.margin)),
  };
}

/**
 * Second chance for a cluster the whole-cell matcher refused: is it a code
 * with kick-out hours appended?
 *
 * MRED writes the home-sale and home-close contingencies with the kick-out
 * period stuck on the end — HS48, HC24 — and the period is whatever the
 * listing agent typed, so there is no closed set of renderings for the whole
 * cell to correlate against. The cell is split instead: every glyph is ranked
 * against STATUS_GLYPHS — letters and digits alike, so neither half is told
 * in advance what it is looking at — and the leading two must spell a code
 * while the rest need only be credible as digits.
 *
 * Deliberately narrow. It runs only on a cluster already rejected, only when
 * every member splits into two letters and one to three digits, and it keeps
 * the reading only when the letters spell a kick-out code outright.
 *
 * Mutates `cl` and returns true when it claimed the cluster.
 */
function applyKickoutRead(cl, font, surf) {
  if (!surf) return false;
  /* Everything below is MRED's: the suffix, the alphabet and the rivals. */
  const len = cl.members[0].token.tall.length;
  if (len <= CFG.KICKOUT_LETTERS) return false;
  if (len - CFG.KICKOUT_LETTERS > CFG.KICKOUT_MAX_DIGITS) return false;
  /* Members are clustered on ink width, so they agree on glyph count in
   * practice; one that does not cannot be voted on position by position. */
  if (cl.members.some(cell => cell.token.tall.length !== len)) return false;
  if (!suffixIsDigits(surf, cl.members, font)) return false;

  const read = readKickoutLetters(surf, cl.members, font);
  if (read.reject) { cl.kickoutReject = read.reject; return false; }

  cl.code = read.code;
  cl.score = read.score;
  cl.shape = read.shape;
  cl.margin = read.margin;
  cl.ranked = [{ text: cl.code, mean: read.score, shape: read.shape }];
  cl.reject = null;
  cl.kickout = true;
  return true;
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
function labelStatusClusters(clusters, font, surf, vocab, weight) {
  const byRow = new Map();
  const tokens = vocab ? vocab.tokens : RECOGNIZED_TOKENS;
  const w = weight || CFG.SYNTH_WEIGHT;
  const mred = !vocab || vocab.id === 'mred';

  for (const cl of clusters) {
    const matches = cl.members.map(cell =>
      cell.match || (cell.match = matchWord(cell.raster, tokens, font, w)));

    const n = cl.members.length;
    const v = voteOnMatches(matches, n);
    cl.ranked = v.ranked;
    cl.score = v.score;
    cl.shape = v.shape;
    cl.margin = v.margin;
    cl.reject = v.reject;
    cl.code = v.reject ? null : v.top.text;
    cl.kickout = false;

    const whole = { code: cl.code, reject: cl.reject, second: v.second };
    if (cl.reject && mred) applyKickoutRead(cl, font, surf);

    console.log(`[Stat] cluster ×${n} ${colorHex(cl.color)} → ${cl.code || 'UNREADABLE'} ` +
      (cl.kickout ? '(kick-out split) ' : '') +
      `(score ${cl.score.toFixed(3)}, shape ${cl.shape.toFixed(3)}, margin ${cl.margin.toFixed(3)}` +
      (cl.kickout ? `, whole cell rejected: ${whole.reject}`
                  : (whole.second ? `, runner-up ${whole.second.text} ${whole.second.mean.toFixed(3)}` : '')) +
      (cl.reject ? ` — rejected: ${cl.reject}` : '') +
      (cl.kickoutReject ? `; not a kick-out code either: ${cl.kickoutReject}` : '') + ')');

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
