/* ===== UAD 3.6 Helper — Segmentation ================================== */
/* Ported verbatim from MLS-Extract (script.js, SECTION 4).               */
/* --------------------------------------------------------------------- */
/* hProjection, findRows, vProjection, findSegmentsRaw, mergeClosest,     */
/* medianWidthExcept, splitWidest, findDigitSegments, tightBBox,          */
/* connectedComponents, fallbackSegmentation                              */
/* ===================================================================== */


/** Horizontal projection: count ink pixels per row across full width. */
function hProjection(bin, W, H) {
  const p = new Uint32Array(H);
  for (let y = 0; y < H; y++) {
    let c = 0;
    const base = y * W;
    for (let x = 0; x < W; x++) {
      if (bin[base + x] === 0) c++;
    }
    p[y] = c;
  }
  return p;
}

/** Find contiguous text-row bands from horizontal projection. */
function findRows(hP, W, minRatio) {
  const thr = Math.max(1, Math.floor(W * minRatio));
  const rows = [];
  let inside = false, sy = 0;
  for (let y = 0; y <= hP.length; y++) {
    const val = y < hP.length ? hP[y] : 0;
    if (val >= thr) {
      if (!inside) { sy = y; inside = true; }
    } else if (inside) {
      rows.push({ y: sy, h: y - sy });
      inside = false;
    }
  }
  return rows;
}

/**
 * Vertical projection within a row: count ink pixels per column.
 * Optionally restricted to the x-range [bx, bx+bw); columns outside stay 0 so
 * segment coordinates remain absolute.
 */
function vProjection(bin, W, ry, rh, bx = 0, bw = W) {
  const p = new Uint32Array(W);
  const x0 = Math.max(0, bx);
  const x1 = Math.min(W, bx + bw);
  for (let x = x0; x < x1; x++) {
    let c = 0;
    for (let y = ry; y < ry + rh; y++) {
      if (bin[y * W + x] === 0) c++;
    }
    p[x] = c;
  }
  return p;
}

/** Find segment boundaries from vertical projection (zero-crossing). */
function findSegmentsRaw(vP, minW) {
  const segs = [];
  let inside = false, sx = 0;
  for (let x = 0; x <= vP.length; x++) {
    const val = x < vP.length ? vP[x] : 0;
    if (val > 0) {
      if (!inside) { sx = x; inside = true; }
    } else if (inside) {
      const w = x - sx;
      if (w >= minW) segs.push({ x: sx, w });
      inside = false;
    }
  }
  return segs;
}

/** Merge the closest adjacent segment pairs until we reach the target count. */
function mergeClosest(segs, target) {
  segs = segs.slice();
  while (segs.length > target) {
    let minGap = Infinity, minIdx = -1;
    for (let i = 0; i < segs.length - 1; i++) {
      const gap = segs[i + 1].x - (segs[i].x + segs[i].w);
      if (gap < minGap) { minGap = gap; minIdx = i; }
    }
    if (minIdx < 0) break;
    const a = segs[minIdx], b = segs[minIdx + 1];
    segs.splice(minIdx, 2, { x: a.x, w: (b.x + b.w) - a.x });
  }
  return segs;
}

/** Median width of every segment except the one at `skipIdx`. 0 if none left. */
function medianWidthExcept(segs, skipIdx) {
  const ws = [];
  for (let i = 0; i < segs.length; i++) {
    if (i !== skipIdx) ws.push(segs[i].w);
  }
  if (!ws.length) return 0;
  ws.sort((a, b) => a - b);
  return ws[ws.length >> 1];
}

/**
 * Split the widest segment until we reach the target count.
 *
 * Cuts are scored on the vertical projection, biased toward where a boundary is
 * expected so one never settles into the hollow of a loop — the lowest column
 * inside a '0' or an '8' is not a gap.
 *
 * How many boundaries to expect is the whole trick. A blob is not always two
 * glyphs: at a threshold running a few levels hot, a '4' bleeds into its right
 * neighbour and drags a third glyph into the same run. Biasing such a run
 * toward its centre aims the cut squarely at the middle glyph — for "548" the
 * lowest weighted column lands inside the '4', which then splits into a stub
 * plus a '4'+'8' smear, and the row is lost.
 *
 * So the run is first sized against the row's other segments: a run about k
 * digits wide has its boundaries near the k−1 interior k-ths, and each
 * candidate is weighted by its distance to the closest one. A two-glyph run
 * (k = 2) has a single ideal boundary at the centre, which is exactly the
 * previous behaviour; wider runs are the ones that now aim correctly.
 */
function splitWidest(segs, vP, minW, target) {
  segs = segs.slice();
  while (segs.length < target) {
    let maxW = 0, maxIdx = -1;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].w > maxW) { maxW = segs[i].w; maxIdx = i; }
    }
    if (maxIdx < 0 || maxW < minW * 2) break;
    const seg = segs[maxIdx];
    const lo = seg.x + Math.floor(seg.w * 0.25);
    const hi = seg.x + Math.floor(seg.w * 0.75);

    /* Glyphs this run probably holds, measured against the row's clean ones.
     * Never fewer than 2 (it is being split) and never more than the number of
     * segments still owed, so a stray wide blob cannot over-fragment. */
    const dw = medianWidthExcept(segs, maxIdx);
    const owed = target - segs.length + 1;
    let k = dw > 0 ? Math.round(seg.w / dw) : 2;
    k = Math.max(2, Math.min(k, Math.max(2, owed)));

    /* Ideal boundaries: the k−1 interior k-ths of the run. */
    const ideals = [];
    for (let i = 1; i < k; i++) ideals.push(seg.x + (seg.w * i) / k);

    let minVal = Infinity, minPos = -1;
    for (let x = lo; x <= hi; x++) {
      let dist = Infinity;
      for (const p of ideals) dist = Math.min(dist, Math.abs(x - p));
      const val = vP[x] + dist * 1.5;
      if (val < minVal) { minVal = val; minPos = x; }
    }
    if (minPos < 0) break;
    const left  = { x: seg.x, w: minPos - seg.x };
    const right = { x: minPos, w: seg.x + seg.w - minPos };
    if (left.w < minW || right.w < minW) break;
    segs.splice(maxIdx, 1, left, right);
  }
  return segs;
}

/**
 * Find exactly `target` digit segments for a row.
 * Primary: projection-based with merge/split heuristics.
 * Fallback: connected-component analysis (only if projection fails).
 */
function findDigitSegments(vP, minW, target, bin, W, row) {
  let segs = findSegmentsRaw(vP, minW);
  if (segs.length === target) return { segs, method: 'projection' };

  /* Projection heuristics: merge if too many, split if too few */
  if (segs.length > target && segs.length <= target + 4) {
    segs = mergeClosest(segs, target);
  }
  if (segs.length >= Math.max(4, target - 4) && segs.length < target) {
    segs = splitWidest(segs, vP, minW, target);
  }
  if (segs.length === target) return { segs, method: 'projection-adjusted' };

  /* Connected-component fallback (more expensive, only if projection failed) */
  if (bin && W && row) {
    const ccSegs = fallbackSegmentation(bin, W, row, target);
    if (ccSegs && ccSegs.length === target) return { segs: ccSegs, method: 'cc-fallback' };
  }

  return { segs, method: 'projection-failed' };
}

/**
 * Find the tight bounding box of dark (ink) pixels within a rectangular region.
 * Returns { x, y, w, h } in absolute coordinates, or null if no ink found.
 */
function tightBBox(bin, W, rx, ry, rw, rh) {
  let x0 = rw, y0 = rh, x1 = -1, y1 = -1;
  for (let dy = 0; dy < rh; dy++) {
    for (let dx = 0; dx < rw; dx++) {
      if (bin[(ry + dy) * W + rx + dx] === 0) {
        if (dx < x0) x0 = dx;
        if (dx > x1) x1 = dx;
        if (dy < y0) y0 = dy;
        if (dy > y1) y1 = dy;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: rx + x0, y: ry + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* --- Connected-Component Analysis (fallback segmentation) --- */

/**
 * Flood-fill connected-component labeling within a row region (4-connected).
 * Returns array of { x, y, w, h, area } bounding boxes for ink components.
 */
function connectedComponents(bin, W, rx, ry, rw, rh) {
  const labels = new Int32Array(rw * rh);
  const components = [];
  let nextLabel = 1;

  for (let ly = 0; ly < rh; ly++) {
    for (let lx = 0; lx < rw; lx++) {
      const gi = (ry + ly) * W + (rx + lx);
      if (bin[gi] !== 0 || labels[ly * rw + lx] !== 0) continue;

      /* BFS flood fill */
      let minX = lx, maxX = lx, minY = ly, maxY = ly, area = 0;
      const queue = [lx, ly];
      labels[ly * rw + lx] = nextLabel;
      let qi = 0;
      while (qi < queue.length) {
        const cx = queue[qi++], cy = queue[qi++];
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < rw && ny >= 0 && ny < rh) {
            const ni = ny * rw + nx;
            const ngi = (ry + ny) * W + (rx + nx);
            if (labels[ni] === 0 && bin[ngi] === 0) {
              labels[ni] = nextLabel;
              queue.push(nx, ny);
            }
          }
        }
      }
      components.push({
        x: rx + minX, y: ry + minY,
        w: maxX - minX + 1, h: maxY - minY + 1,
        area,
      });
      nextLabel++;
    }
  }
  return components;
}

/**
 * Fallback segmentation using connected components.
 * Groups spatially close components, then merges/filters to target count.
 */
function fallbackSegmentation(bin, W, row, target) {
  const ccs = connectedComponents(bin, W, 0, row.y, W, row.h);
  /* Filter tiny noise components */
  const minArea = CFG.MIN_CC_AREA * CFG.UPSCALE;
  const valid = ccs.filter(c => c.area >= minArea);
  if (valid.length === 0) return null;

  /* Sort by x */
  valid.sort((a, b) => a.x - b.x);

  /* Group components that are spatially close (likely parts of same digit) */
  const groups = [];
  let cur = { x: valid[0].x, w: valid[0].w, components: [valid[0]] };
  for (let i = 1; i < valid.length; i++) {
    const c = valid[i];
    const curEnd = cur.x + cur.w;
    const overlap = curEnd - c.x;
    /* If overlapping or very close, merge into same group */
    if (overlap >= -2) {
      const newEnd = Math.max(curEnd, c.x + c.w);
      cur.w = newEnd - cur.x;
      cur.components.push(c);
    } else {
      groups.push({ x: cur.x, w: cur.w });
      cur = { x: c.x, w: c.w, components: [c] };
    }
  }
  groups.push({ x: cur.x, w: cur.w });

  if (groups.length === target) return groups;

  /* Try merge/split to hit target */
  if (groups.length > target && groups.length <= target + 4) {
    return mergeClosest(groups, target);
  }

  return null;
}

