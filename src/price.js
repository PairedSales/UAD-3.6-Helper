/* ===== UAD 3.6 Helper — Number Reading ================================ */
/* Prices and concessions are read glyph-by-glyph with MLS-Extract's digit   */
/* bank, which is built from real connectMLS pixels.                        */
/*                                                                          */
/* Two things are held to a stricter standard than MLS-Extract holds an MLS  */
/* number to, and deliberately so. An eight-digit MLS number is              */
/* format-checkable — if a digit flips, the number simply stops being a real */
/* listing and the error is visible. A price is not: $465,000 misread as     */
/* $165,000 is a perfectly plausible number that moves the low, the high and */
/* the median at once, with nothing to give it away. So:                     */
/*                                                                          */
/*   • every glyph goes through isAmbiguous() — the confusable-pair guard    */
/*     MLS-Extract uses — and one ambiguous glyph rejects the whole token;   */
/*   • the comma grouping must agree with the digit count, always, including */
/*     on tokens that start with a dollar sign.                             */
/*                                                                          */
/* A rejected token is reported as an unreadable price. It is never guessed. */
/* ===================================================================== */

/**
 * Split a merged glyph segment at its projection minimum.
 *
 * Ported from MLS-Extract, with one change: `maxW` is derived from the
 * screenshot's own glyph width instead of the constant 35 upscaled px. On a
 * 2× (HiDPI) paste every wide glyph exceeds a fixed 35 and gets shredded in
 * half, which turns prices into nonsense while leaving the narrow '1'
 * untouched — the worst kind of failure, because it is partial.
 */
function splitWideSegments(segs, vP, minW, maxW) {
  const cap = maxW || 35;
  const result = [];

  for (const seg of segs) {
    if (seg.w >= cap) {
      /* Best split point in the middle 50% of the segment */
      const lo = seg.x + Math.floor(seg.w * 0.25);
      const hi = seg.x + Math.floor(seg.w * 0.75);
      const center = seg.x + seg.w / 2;
      let minVal = Infinity, minPos = -1;

      for (let x = lo; x <= hi; x++) {
        const dist = Math.abs(x - center);
        const val = vP[x] + dist * 1.5;
        if (val < minVal) { minVal = val; minPos = x; }
      }

      if (minPos > 0) {
        const left = { x: seg.x, w: minPos - seg.x };
        const right = { x: minPos, w: seg.x + seg.w - minPos };
        if (left.w >= minW && right.w >= minW) {
          result.push(
            ...splitWideSegments([left], vP, minW, cap),
            ...splitWideSegments([right], vP, minW, cap)
          );
          continue;
        }
      }
    }
    result.push(seg);
  }
  return result;
}

/**
 * Re-segment a numeric token's glyphs using its own pitch.
 *
 * At 11px adjacent digits sometimes binarize into one ink run. The generic
 * splitter halves an over-wide run, which is right for two merged glyphs and
 * wrong for three — "244" comes back as two half-glyphs that each classify
 * confidently as something, and the price silently loses a digit.
 *
 * Numerals are tabular: every digit occupies the same advance, so a token's
 * own glyph starts give its pitch, and any run is exactly round(width ÷ pitch)
 * glyphs. That turns "how do I split this?" into arithmetic instead of a
 * threshold, and it rescales itself for any font size or DPI.
 */
function refineTokenGlyphs(surf, token) {
  if (!token.tall || token.tall.length < 2) return token;

  const runs = coalesceAdjacent(token.tall);
  const pitch = estimateGlyphPitch(runs);
  if (!pitch) return token;

  const row = token.row;
  let vP = null;
  const out = [];
  let changed = runs.length !== token.tall.length;

  for (const g of runs) {
    const ratio = g.w / pitch;
    const k = ratio < 1.35 ? 1 : Math.round(ratio);
    if (k <= 1) { out.push(g); continue; }

    if (!vP) vP = vProjection(surf.bin, surf.W, row.y, row.h);
    const parts = splitRunEvenly(vP, g, k);
    if (parts.length < 2) { out.push(g); continue; }
    for (const p of parts) {
      const bb = tightBBox(surf.bin, surf.W, p.x, row.y, p.w, row.h);
      out.push(bb || p);
    }
    changed = true;
  }

  /* Re-joining runs is only ever a means to re-splitting them. If the pitch
   * analysis did not put back at least as many glyphs as it took away, it has
   * learned nothing and the original segmentation stands. */
  if (!changed || out.length < token.tall.length) return token;
  out.sort((a, b) => a.x - b.x);
  return Object.assign({}, token, { tall: out, refined: true });
}

/**
 * Re-join runs the generic splitter cut apart.
 *
 * Two glyphs of real text always leave at least one blank column between them
 * at 4× upscale; a boundary with EXACTLY zero gap can only be one the splitter
 * introduced, so undoing it loses nothing and lets the pitch analysis see the
 * original run.
 */
function coalesceAdjacent(tall) {
  const sorted = tall.slice().sort((a, b) => a.x - b.x);
  const out = [];
  for (const g of sorted) {
    const prev = out[out.length - 1];
    if (prev && g.x === prev.x + prev.w) {
      out[out.length - 1] = {
        x: prev.x, w: g.x + g.w - prev.x,
        y: Math.min(prev.y, g.y),
        h: Math.max(prev.y + prev.h, g.y + g.h) - Math.min(prev.y, g.y),
      };
    } else {
      out.push({ x: g.x, y: g.y, w: g.w, h: g.h });
    }
  }
  return out;
}

/**
 * Advance width of one digit, from the token's own glyph starts.
 *
 * Steps between consecutive singles are all one pitch; steps across a merge or
 * a comma are multiples of it. Taking the median of the smallest cluster of
 * steps gives the pitch without knowing the font or the scale.
 */
function estimateGlyphPitch(runs) {
  if (runs.length < 3) return null;
  const diffs = [];
  for (let i = 1; i < runs.length; i++) diffs.push(runs[i].x - runs[i - 1].x);
  const positive = diffs.filter(d => d > 0).sort((a, b) => a - b);
  if (positive.length < 2) return null;

  const min = positive[0];
  const singles = positive.filter(d => d <= min * 1.45);
  if (singles.length < 2) return null;
  return singles[Math.floor(singles.length / 2)];
}

/** Cut one run into `k` glyphs, each boundary snapped to a projection minimum. */
function splitRunEvenly(vP, run, k) {
  const cuts = [];
  const window = Math.max(2, Math.round(run.w / (k * 4)));
  for (let i = 1; i < k; i++) {
    const ideal = run.x + (run.w * i) / k;
    const lo = Math.max(run.x + 1, Math.round(ideal - window));
    const hi = Math.min(run.x + run.w - 1, Math.round(ideal + window));
    let best = Math.round(ideal), bestVal = Infinity;
    for (let x = lo; x <= hi; x++) {
      const val = vP[x] + Math.abs(x - ideal) * 0.5;
      if (val < bestVal) { bestVal = val; best = x; }
    }
    cuts.push(best);
  }

  const parts = [];
  let start = run.x;
  for (const c of cuts) {
    if (c <= start) continue;
    parts.push({ x: start, w: c - start });
    start = c;
  }
  parts.push({ x: start, w: run.x + run.w - start });
  return parts.filter(p => p.w > 1);
}

/**
 * Decide, for a whole column at once, whether its cells carry a leading
 * currency symbol.
 *
 * This cannot be decided per cell. At 11px the '$' loses its stem to
 * binarization and correlates as '5', '8' or 'S'; it is not reliably taller
 * than the digits either, because the ascender and descender are one pixel
 * each and do not survive the threshold. Per-cell, the evidence simply is not
 * there — and a '$' read as '8' prepends a digit to a price.
 *
 * Per COLUMN the evidence is decisive, because the comma grouping has to add
 * up. "$189,900" segments into seven glyphs with one comma: seven digits would
 * need two commas, six digits need one. So dropping the leading glyph is the
 * only reading that is arithmetically consistent — and every cell in the
 * column votes on it.
 */
function decideCurrencyPrefix(surf, cells, bank) {
  let n = 0, withComma = 0, keepValid = 0, dropValid = 0;

  for (const [, token] of cells) {
    const g = token.tall;
    if (!g || g.length < 3) continue;
    n++;
    if (token.commas.length) withComma++;
    const needs = k => token.commas.length === Math.floor((k - 1) / 3);
    if (needs(g.length)) keepValid++;
    if (needs(g.length - 1)) dropValid++;
  }
  if (n < CFG.PRICE_COL_MIN_ROWS) return false;

  /* Any price connectMLS renders above $999 carries a thousands separator, so
   * a column with no commas has no currency symbol to strip either. This is
   * what keeps "5000" in CONC and "1972" in Yr Blt from losing a digit. */
  if (withComma / n < 0.9) return false;

  /* Whichever reading is consistent across the column wins, and it has to win
   * clearly. Comparing each fraction against a fixed bar would fail on a
   * column of mixed magnitudes: "$1,519,200" is arithmetically consistent read
   * either way, so it dilutes the losing reading's score without being
   * evidence for it. What matters is which reading holds for every cell. */
  const keep = keepValid / n, drop = dropValid / n;
  if (drop >= 0.9 && drop > keep + 0.15) return true;
  if (keep >= 0.9 && keep > drop + 0.15) return false;
  if (keep < 0.9 || drop < 0.9) return false;

  /* Both readings are arithmetically consistent — which happens when every
   * value in the column has the same digit count. Fall back to magnitude: only
   * one reading puts the column inside the range a house sells in. */
  const sample = cells.slice(0, 8);
  const medianOfWay = (usePrefix) => {
    const vals = [];
    for (const [row, token] of sample) {
      const p = readPriceToken(surf, row, token, bank, usePrefix);
      if (p) vals.push(p.value);
    }
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  const inRange = v => v !== null &&
    v >= CFG.PRICE_COL_MEDIAN_MIN && v <= CFG.PRICE_COL_MEDIAN_MAX;

  const keptMedian = medianOfWay(false);
  const droppedMedian = medianOfWay(true);
  if (inRange(keptMedian) && !inRange(droppedMedian)) return false;
  if (inRange(droppedMedian) && !inRange(keptMedian)) return true;
  return false;
}

/**
 * Classify a token's tall glyphs.
 *
 * `skipAmbiguityAt` names an index exempt from the confusable-pair guard —
 * used for the currency symbol, whose bucket competes with '5', '8' and 'S'
 * and therefore never wins by a wide margin. That is safe because the symbol
 * contributes no digits to the value: if it were misjudged, the comma-grouping
 * check on the remaining glyphs rejects the token anyway.
 */
function classifyTokenGlyphs(surf, token, bank, skipAmbiguityAt) {
  const glyphs = token.tall;
  if (!glyphs || !glyphs.length) return null;

  const chars = [];
  let worst = 1;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const norm = normalizeGlyph(surf.gray, g.x, g.y, g.w, g.h);
    norm.features = computeStructuralFeatures(norm.binary, CFG.NORM_W, CFG.NORM_H, norm.grayscale);
    const cls = classifyGlyph(norm, bank);
    if (i !== skipAmbiguityAt) {
      const ambiguity = isAmbiguous(cls);
      if (ambiguity) return { rejected: `glyph ${i}: ${ambiguity}` };
    }
    chars.push({ ch: String(cls.digit), score: cls.score, margin: cls.margin, box: g });
    if (i !== skipAmbiguityAt) worst = Math.min(worst, cls.score);
  }
  return { chars, worst };
}

/**
 * Commas must fall on thousands boundaries.
 *
 * The comma glyphs are dropped before classification (too short to clear the
 * height filter) but their positions are kept. A genuine price carries one
 * comma per three digits from the right; anything else means the token is not
 * a price, or is a fragment of one.
 */
function commaGroupingIsValid(digitCount, token) {
  return token.commas.length === Math.floor((digitCount - 1) / 3);
}

/**
 * Read one token as a price.
 *
 * `hasCurrencyPrefix` comes from decideCurrencyPrefix(), which settles the
 * question for the whole column. Returns { value, text, digits, score } or
 * null when the token is not a price.
 */
function readPriceToken(surf, row, rawToken, bank, hasCurrencyPrefix) {
  const token = refineTokenGlyphs(surf, rawToken);
  if (!token.tall || token.tall.length < 3) return null;

  const hadDollar = !!hasCurrencyPrefix;
  const res = classifyTokenGlyphs(surf, token, bank, hadDollar ? 0 : -1);
  if (!res || res.rejected) return null;
  const { chars, worst } = res;
  if (chars.length < 2) return null;

  const digitChars = hadDollar ? chars.slice(1) : chars;
  if (!digitChars.length) return null;

  let digits = '';
  for (const c of digitChars) {
    if (!/^[0-9]$/.test(c.ch)) return null;          /* '$' mid-number, or junk */
    if (c.score < CFG.MIN_DIGIT_SCORE) return null;
    digits += c.ch;
  }
  if (digits.length < CFG.PRICE_MIN_DIGITS || digits.length > CFG.PRICE_MAX_DIGITS) return null;

  /* Comma grouping is checked on EVERY token, dollar sign or not. A price
   * that split at a comma — "$1,085,000" read as "$1,085" — otherwise passes
   * every other check and lands in the statistics as $1,085. */
  if (!commaGroupingIsValid(digits.length, token)) return null;

  /* A dollar amount of four or more digits with no comma at all is a
   * fragment, not a price: connectMLS always renders the separator. */
  if (digits.length >= 4 && token.commas.length === 0) return null;

  const value = parseInt(digits, 10);
  if (!isFinite(value) || value < CFG.PRICE_MIN_VALUE || value > CFG.PRICE_MAX_VALUE) return null;

  return {
    value,
    digits,
    text: (hadDollar ? '$' : '') + value.toLocaleString('en-US'),
    score: worst,
    hadDollar,
    chars,
  };
}

/**
 * Read one token as a plain integer.
 *
 * This is what the CONC (seller concessions) column holds: "5000", "10000" —
 * no dollar sign, no comma. Kept separate from readPriceToken so that a
 * dollar-less four-digit number can never be mistaken for a price by the
 * column scorer.
 */
function readIntegerToken(surf, row, rawToken, bank) {
  const token = refineTokenGlyphs(surf, rawToken);
  const res = classifyTokenGlyphs(surf, token, bank, -1);
  if (!res || res.rejected) return null;
  const { chars, worst } = res;

  let digits = '';
  for (const c of chars) {
    if (!/^[0-9]$/.test(c.ch)) return null;
    if (c.score < CFG.MIN_DIGIT_SCORE) return null;
    digits += c.ch;
  }
  if (!digits.length || digits.length > 7) return null;
  if (token.commas.length && !commaGroupingIsValid(digits.length, token)) return null;

  const value = parseInt(digits, 10);
  if (!isFinite(value)) return null;
  return { value, digits, text: value.toLocaleString('en-US'), score: worst };
}
