/* ===== UAD 3.6 Helper — Glyph Normalization & Classification ========== */
/* Ported verbatim from MLS-Extract (script.js, SECTIONS 5, 7 and 8).     */
/* --------------------------------------------------------------------- */
/* normalizeGlyph, ncc, shiftedNCC, computeStructuralFeatures, countHoles,*/
/* morphClose, robustHoleCount, countHolesMinSize, CANONICAL_HOLES,       */
/* structuralScore, classifyGlyph, isAmbiguous                            */
/* ===================================================================== */

/**
 * Extract a glyph region from a GRAYSCALE canvas and normalize to NORM_W × NORM_H.
 * Returns { canvas, grayscale: Float32Array, binary: Uint8Array }.
 *
 * - grayscale: inverted luminance (1.0 = ink, 0.0 = bg) for NCC matching
 * - binary: thresholded at 0.5 (1 = ink, 0 = bg) for structural features
 * - canvas: visual preview (dark ink on white bg)
 */
function normalizeGlyph(srcCanvas, sx, sy, sw, sh) {
  const { NORM_W: NW, NORM_H: NH, NORM_PAD: P } = CFG;
  const c = document.createElement('canvas');
  c.width = NW;
  c.height = NH;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  /* White background */
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, NW, NH);

  /* Scale to fit with padding, preserving aspect ratio */
  const aW = NW - P * 2, aH = NH - P * 2;
  const sc = Math.min(aW / sw, aH / sh);
  const dw = sw * sc, dh = sh * sc;
  const dx = (NW - dw) / 2, dy = (NH - dh) / 2;

  /* Bilinear for smoother normalization — preserves anti-alias gradients */
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, sx, sy, sw, sh, dx, dy, dw, dh);

  /* Extract dual representation */
  const img = ctx.getImageData(0, 0, NW, NH);
  const d = img.data;
  const n = NW * NH;
  const grayscale = new Float32Array(n);
  const binary = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    /* Luminance → inverted (ink = 1.0, bg = 0.0) */
    const lum = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    grayscale[i] = 1.0 - lum;
  }

  /* Contrast stretching: map min grayscale to 0.0 and max to 1.0 if range is significant */
  let minG = 1.0, maxG = 0.0;
  for (let i = 0; i < n; i++) {
    if (grayscale[i] < minG) minG = grayscale[i];
    if (grayscale[i] > maxG) maxG = grayscale[i];
  }
  const rangeG = maxG - minG;
  if (rangeG > 0.15) {
    for (let i = 0; i < n; i++) {
      grayscale[i] = (grayscale[i] - minG) / rangeG;
    }
  }

  for (let i = 0; i < n; i++) {
    binary[i] = grayscale[i] > 0.5 ? 1 : 0;
  }

  /* Also update canvas pixels to clean binary preview */
  for (let i = 0; i < n; i++) {
    const v = binary[i] ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  ctx.putImageData(img, 0, 0);

  return { canvas: c, grayscale, binary };
}

/**
 * Normalized Cross-Correlation between two arrays (same length).
 * Works on Float32Array (grayscale) or Uint8Array (binary).
 * Returns value in [-1, 1] where 1 = perfect match.
 */
function ncc(a, b) {
  const n = a.length;
  let sA = 0, sB = 0;
  for (let i = 0; i < n; i++) { sA += a[i]; sB += b[i]; }
  const mA = sA / n, mB = sB / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - mA, db = b[i] - mB;
    num += da * db;
    dA += da * da;
    dB += db * db;
  }
  const den = Math.sqrt(dA * dB);
  return den < 1e-10 ? 0 : num / den;
}

/**
 * NCC with sub-pixel shift: correlate a[y][x] against b[y+dy][x+dx]
 * over their overlapping region. Returns NCC in [-1, 1].
 */
function shiftedNCC(a, b, W, H, dx, dy) {
  const x0 = Math.max(0, -dx), y0 = Math.max(0, -dy);
  const x1 = Math.min(W, W - dx), y1 = Math.min(H, H - dy);
  const count = (x1 - x0) * (y1 - y0);
  if (count <= 0) return -1;
  let sA = 0, sB = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sA += a[y * W + x];
      sB += b[(y + dy) * W + (x + dx)];
    }
  }
  const mA = sA / count, mB = sB / count;
  let num = 0, dA = 0, dB = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const da = a[y * W + x] - mA;
      const db = b[(y + dy) * W + (x + dx)] - mB;
      num += da * db;
      dA += da * da;
      dB += db * db;
    }
  }
  const den = Math.sqrt(dA * dB);
  return den < 1e-10 ? 0 : num / den;
}

/**
 * Compute structural features from a binary glyph (1 = ink, 0 = bg).
 * Used alongside NCC for robust classification.
 * If grayscale is provided, uses multi-threshold robust hole counting.
 */
function computeStructuralFeatures(binary, W, H, grayscale) {
  const n = W * H;
  const halfH = Math.floor(H / 2);

  /* Density: fraction of ink pixels */
  let inkCount = 0;
  for (let i = 0; i < n; i++) { if (binary[i] === 1) inkCount++; }
  const density = inkCount / n;

  /* Upper/lower density */
  let upperInk = 0, lowerInk = 0;
  const upperN = halfH * W;
  const lowerN = (H - halfH) * W;
  for (let y = 0; y < halfH; y++) {
    for (let x = 0; x < W; x++) {
      if (binary[y * W + x] === 1) upperInk++;
    }
  }
  for (let y = halfH; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (binary[y * W + x] === 1) lowerInk++;
    }
  }
  const upperDensity = upperN > 0 ? upperInk / upperN : 0;
  const lowerDensity = lowerN > 0 ? lowerInk / lowerN : 0;

  /* Aspect ratio of tight ink bounding box */
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (binary[y * W + x] === 1) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const bboxW = x1 >= 0 ? x1 - x0 + 1 : 1;
  const bboxH = y1 >= 0 ? y1 - y0 + 1 : 1;
  const aspectRatio = bboxW / bboxH;

  /* Hole count — robust multi-threshold with morphological closing */
  let holeCount, holeDetail;
  if (grayscale) {
    const hResult = robustHoleCount(grayscale, W, H);
    holeCount = hResult.max;
    holeDetail = hResult;
  } else {
    holeCount = countHoles(binary, W, H);
    holeDetail = { max: holeCount, perThreshold: [] };
  }

  return { density, upperDensity, lowerDensity, aspectRatio, holeCount, holeDetail };
}

/**
 * Count enclosed background regions (holes) in a binary glyph.
 * 4-connected flood-fill from border → remaining unvisited bg = holes.
 */
function countHoles(binary, W, H) {
  const visited = new Uint8Array(W * H);

  /* Mark all ink pixels as visited */
  for (let i = 0; i < W * H; i++) {
    if (binary[i] === 1) visited[i] = 1;
  }

  /* Flood-fill "outside" from all border background pixels */
  const queue = [];
  const tryEnqueue = (x, y) => {
    if (x >= 0 && x < W && y >= 0 && y < H) {
      const i = y * W + x;
      if (!visited[i]) { visited[i] = 1; queue.push(i); }
    }
  };
  for (let x = 0; x < W; x++) { tryEnqueue(x, 0); tryEnqueue(x, H - 1); }
  for (let y = 1; y < H - 1; y++) { tryEnqueue(0, y); tryEnqueue(W - 1, y); }

  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const x = idx % W, y = (idx - x) / W;
    tryEnqueue(x - 1, y);
    tryEnqueue(x + 1, y);
    tryEnqueue(x, y - 1);
    tryEnqueue(x, y + 1);
  }

  /* Count remaining unvisited background regions */
  let holes = 0;
  for (let i = 0; i < W * H; i++) {
    if (!visited[i]) {
      holes++;
      /* Flood-fill this hole so it's not counted again */
      const hq = [i];
      visited[i] = 1;
      let hi = 0;
      while (hi < hq.length) {
        const idx = hq[hi++];
        const x = idx % W, y = (idx - x) / W;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            const ni = ny * W + nx;
            if (!visited[ni]) { visited[ni] = 1; hq.push(ni); }
          }
        }
      }
    }
  }

  return holes;
}

/**
 * Morphological closing (dilate → erode) with a 3×3 cross structuring element.
 * Bridges 1px gaps in thin strokes (e.g., middle bar of '8').
 */
function morphClose(binary, W, H) {
  const n = W * H;
  /* Dilate: pixel is ink if it or any 4-neighbor is ink */
  const dilated = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (binary[i] === 1 ||
          (x > 0 && binary[i - 1] === 1) ||
          (x < W - 1 && binary[i + 1] === 1) ||
          (y > 0 && binary[i - W] === 1) ||
          (y < H - 1 && binary[i + W] === 1)) {
        dilated[i] = 1;
      }
    }
  }
  /* Erode: pixel is ink only if it and all existing 4-neighbors are ink */
  const closed = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (dilated[i] !== 1) continue;
      if ((x === 0 || dilated[i - 1] === 1) &&
          (x === W - 1 || dilated[i + 1] === 1) &&
          (y === 0 || dilated[i - W] === 1) &&
          (y === H - 1 || dilated[i + W] === 1)) {
        closed[i] = 1;
      }
    }
  }
  return closed;
}

/**
 * Robust hole counting: multi-threshold approach WITHOUT morphological closing.
 * Tries multiple binarization thresholds and takes the maximum hole count.
 *
 * At lower thresholds (0.35, 0.40), more pixels count as ink, which
 * naturally bridges thin strokes like 8's waist. Meanwhile 9's opening
 * remains open because it's a true structural gap, not a thin stroke.
 * Returns { max, perThreshold }.
 */
function robustHoleCount(grayscale, W, H) {
  let max = 0;
  const perThreshold = [];

  for (const thr of CFG.HOLE_THRESHOLDS) {
    const bin = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      bin[i] = grayscale[i] > thr ? 1 : 0;
    }
    const holes = countHolesMinSize(bin, W, H, 3);
    perThreshold.push([thr, holes]);
    if (holes > max) max = holes;
  }

  return { max, perThreshold };
}

/**
 * Count holes with a minimum size filter.
 * Same as countHoles but only counts background regions with >= minSize pixels.
 * This prevents tiny 1-2px noise holes from being counted.
 */
function countHolesMinSize(binary, W, H, minSize) {
  const visited = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (binary[i] === 1) visited[i] = 1;
  }

  /* Flood-fill outside from border */
  const queue = [];
  const tryEnqueue = (x, y) => {
    if (x >= 0 && x < W && y >= 0 && y < H) {
      const i = y * W + x;
      if (!visited[i]) { visited[i] = 1; queue.push(i); }
    }
  };
  for (let x = 0; x < W; x++) { tryEnqueue(x, 0); tryEnqueue(x, H - 1); }
  for (let y = 1; y < H - 1; y++) { tryEnqueue(0, y); tryEnqueue(W - 1, y); }
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const x = idx % W, y = (idx - x) / W;
    tryEnqueue(x - 1, y); tryEnqueue(x + 1, y);
    tryEnqueue(x, y - 1); tryEnqueue(x, y + 1);
  }

  /* Count remaining unvisited regions, filtering by size */
  let holes = 0;
  for (let i = 0; i < W * H; i++) {
    if (!visited[i]) {
      /* Flood-fill this region and count its size */
      const hq = [i];
      visited[i] = 1;
      let hi = 0;
      while (hi < hq.length) {
        const idx = hq[hi++];
        const x = idx % W, y = (idx - x) / W;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            const ni = ny * W + nx;
            if (!visited[ni]) { visited[ni] = 1; hq.push(ni); }
          }
        }
      }
      if (hq.length >= minSize) holes++;
    }
  }
  return holes;
}

/** Canonical expected hole counts per digit (for structural discrimination) */
const CANONICAL_HOLES = { 0: 1, 1: 0, 2: 0, 3: 0, 4: 1, 5: 0, 6: 1, 7: 0, 8: 2, 9: 1 };

/**
 * Compute structural similarity between a candidate and a template.
 * Returns score in [0, 1] where 1 = perfect structural match.
 */
function structuralScore(candidateFeatures, templateFeatures) {
  /* Hole count mismatch: strongest discriminator */
  const holeDiff = Math.abs(candidateFeatures.holeCount - templateFeatures.holeCount);
  const holePenalty = Math.min(holeDiff, 2) / 2;

  /* Density difference */
  const densityPenalty = Math.abs(candidateFeatures.density - templateFeatures.density);

  /* Vertical balance: upper-lower asymmetry difference */
  const candBalance = candidateFeatures.upperDensity - candidateFeatures.lowerDensity;
  const tmplBalance = templateFeatures.upperDensity - templateFeatures.lowerDensity;
  const balancePenalty = Math.min(Math.abs(candBalance - tmplBalance), 1.0);

  /* Aspect ratio difference */
  const arPenalty = Math.min(Math.abs(candidateFeatures.aspectRatio - templateFeatures.aspectRatio), 1.0);

  /* Weighted penalty → score */
  const penalty = holePenalty * 0.4 + densityPenalty * 0.2 + balancePenalty * 0.2 + arPenalty * 0.2;
  return Math.max(0, 1.0 - penalty);
}

/**
 * Classify a normalized glyph against the template bank.
 * Combines grayscale NCC (with ±1px shifts), structural features,
 * and hole-match bias for robust digit discrimination.
 *
 * Returns { digit, score, nccScore, structScore, margin, top3, allScores, features }.
 */
function classifyGlyph(glyph, bank) {
  const results = [];
  const { NORM_W: W, NORM_H: H } = CFG;
  const candHoles = glyph.features.holeCount;

  for (const d of Object.keys(bank)) {
    let bestCombined = -Infinity, bestNCC_val = -Infinity, bestStruct = 0;
    const dNum = parseInt(d, 10);

    for (const tmpl of bank[d]) {
      /* Shifted NCC: try original + ±1px offsets, take best */
      let nccS = ncc(glyph.grayscale, tmpl.grayscale);
      for (const [dx, dy] of CFG.NCC_SHIFT_OFFSETS) {
        if (dx === 0 && dy === 0) continue;
        const s = shiftedNCC(glyph.grayscale, tmpl.grayscale, W, H, dx, dy);
        if (s > nccS) nccS = s;
      }

      const strS = structuralScore(glyph.features, tmpl.features);
      let combined = nccS * CFG.NCC_WEIGHT + strS * CFG.STRUCTURAL_WEIGHT;

      /* Hole-match bias: small boost/penalty based on hole count agreement.
       * This biases, not overrides — magnitudes are small relative to NCC. */
      const tmplHoles = tmpl.features.holeCount;
      if (candHoles === tmplHoles) {
        combined += CFG.HOLE_MATCH_BOOST;
      } else if (Math.abs(candHoles - tmplHoles) >= 1) {
        combined -= CFG.HOLE_MISMATCH_PENALTY;
      }

      /* Vertical density balance bias for 8/9 discrimination.
       * 8 is vertically balanced (upper/lower ratio ~0.8–1.2).
       * 9 is top-heavy (ratio > 1.2). Apply a small bias accordingly. */
      if (!isNaN(dNum) && (dNum === 8 || dNum === 9)) {
        const ud = glyph.features.upperDensity;
        const ld = glyph.features.lowerDensity;
        const balance = ld > 0.001 ? ud / ld : 10;
        if (dNum === 8 && balance > 1.2) {
          /* Glyph is top-heavy: penalize 8 (which should be balanced) */
          combined -= 0.01;
        } else if (dNum === 9 && balance > 1.2) {
          /* Glyph is top-heavy: boost 9 (which is top-heavy) */
          combined += 0.01;
        } else if (dNum === 9 && balance <= 1.2) {
          /* Glyph is balanced: penalize 9 (which should be top-heavy) */
          combined -= 0.01;
        } else if (dNum === 8 && balance <= 1.2) {
          /* Glyph is balanced: boost 8 (which should be balanced) */
          combined += 0.01;
        }
      }

      if (combined > bestCombined) {
        bestCombined = combined;
        bestNCC_val = nccS;
        bestStruct = strS;
      }
    }

    const parsedD = isNaN(dNum) ? d : dNum;
    results.push({ d: parsedD, combined: bestCombined, ncc: bestNCC_val, structural: bestStruct });
  }

  results.sort((a, b) => b.combined - a.combined);
  const top = results[0], sec = results[1];
  const margin = top.combined - sec.combined;

  return {
    digit: top.d,
    score: top.combined,
    nccScore: top.ncc,
    structScore: top.structural,
    margin,
    top3: results.slice(0, 3),
    allScores: results,
    features: glyph.features,
  };
}

/* ================================================================== */
/*  SECTION 8 — AMBIGUITY + VALIDATION                                */
/* ================================================================== */

/**
 * Determine if a classification result is too ambiguous to trust.
 * Favors false negatives over false positives.
 * Uses hole-count discrimination to relax confusable-pair margins when
 * structural features provide strong evidence.
 * For 8/9 confusion: uses vertical density balance to discriminate.
 */
function isAmbiguous(result) {
  /* Hard rejection: below minimum thresholds */
  if (result.score < CFG.MIN_COMBINED) return 'score-below-min';
  if (result.margin < CFG.MIN_MARGIN) return 'margin-below-min';

  /* Confused-pair rejection: stricter margin for known confusable pairs */
  const top2 = [result.top3[0].d, result.top3[1].d];
  for (const [a, b] of CFG.CONFUSABLE_PAIRS) {
    if (top2.includes(a) && top2.includes(b)) {
      let effectiveMargin = CFG.CONFUSABLE_MARGIN;

      /* Relax margin when hole count definitively discriminates.
       * Only when candidate holes match top but not second candidate. */
      const candHoles = result.features.holeCount;
      const topExpected = CANONICAL_HOLES[result.top3[0].d];
      const secExpected = CANONICAL_HOLES[result.top3[1].d];
      if (topExpected !== undefined && secExpected !== undefined &&
          topExpected !== secExpected &&
          candHoles === topExpected && candHoles !== secExpected) {
        effectiveMargin = CFG.MIN_MARGIN;
      }

      /* Special 8/9 discrimination via vertical density balance.
       * 8 has balanced upper/lower density (ratio ~0.8–1.2).
       * 9 is top-heavy (upper density >> lower density, ratio > 1.15).
       * If the top pick is 8 but vertical balance suggests 9, require wide margin. */
      if (top2.includes(8) && top2.includes(9)) {
        const ud = result.features.upperDensity;
        const ld = result.features.lowerDensity;
        const balance = ld > 0.001 ? ud / ld : 10;
        if (result.top3[0].d === 8 && balance > 1.15) {
          /* Glyph is top-heavy like a 9, but classified as 8 — require strict margin */
          effectiveMargin = Math.max(effectiveMargin, 0.20);
        } else if (result.top3[0].d === 9 && balance < 1.15) {
          /* Glyph is balanced like an 8, but classified as 9 — require strict margin */
          effectiveMargin = Math.max(effectiveMargin, 0.20);
        }
      }

      if (result.margin < effectiveMargin) {
        return `confusable-${a}/${b}`;
      }
    }
  }

  return null; /* Not ambiguous */
}

