/* ===== UAD 3.6 Helper — Image Preprocessing =========================== */
/* Ported verbatim from MLS-Extract (script.js, SECTION 3). Do not tune   */
/* these routines here: they are calibrated against real connectMLS       */
/* screenshots and shared with the sibling project.                       */
/* --------------------------------------------------------------------- */
/* loadImage, loadImageFromBlob, canvasFromImage, cloneCanvas, cropCanvas, */
/* upscaleCanvas, toGrayscale, histPercentile, normalizeShadedBands,      */
/* computeOtsu, binarize, getBinary                                       */
/* ===================================================================== */


/** Load an image element from a URL or blob URL. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/** Load an image element from a Blob. */
function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

/** Create a canvas from an image element. */
function canvasFromImage(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return c;
}

/** Clone a canvas (same dimensions, same pixel data). */
function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  return c;
}

/** Crop a rectangular region out of a canvas into a new canvas. */
function cropCanvas(src, x, y, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

/** Upscale canvas with nearest-neighbor (preserves sharp pixel edges). */
function upscaleCanvas(src, factor) {
  const c = document.createElement('canvas');
  c.width = src.width * factor;
  c.height = src.height * factor;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Convert canvas to grayscale in-place. Returns the canvas. */
function toGrayscale(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Value at percentile `p` (0–1) of a 256-bin histogram holding `total` samples. */
function histPercentile(hist, total, p) {
  const want = Math.max(1, Math.round(total * p));
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= want) return v;
  }
  return 255;
}

/**
 * Neutralize row shading — the coloured highlight a grid paints behind the
 * selected row (and similar banded backgrounds).
 *
 * A shaded band's background is darker than the rest of the table, and the
 * single global Otsu threshold applied afterwards cannot serve both. Depending
 * on how dark the highlight is, the band either binarizes to a solid block —
 * losing that row outright — or loses enough contrast that its digits merge and
 * segmentation returns the wrong count. The band's extra dark pixels also skew
 * the global threshold, so one highlighted row shifts the result for every
 * other row in the image.
 *
 * Each shaded band is linearly rescaled so its background and ink levels match
 * the unshaded rows, which restores both the band itself and the global
 * histogram. Operates on (and expects) a grayscale canvas. An image with no
 * shaded bands is left unchanged.
 *
 * Returns the list of bands that were normalized.
 */
function normalizeShadedBands(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  /* Dominant surface level per scanline. The median is deliberate: it lands on
   * whichever colour fills most of the scanline, so it reports the fill for a
   * dark highlight (light text) just as reliably as the paper for ordinary
   * dark-on-light text. A high percentile would latch onto light glyphs and
   * miss dark bands entirely. */
  const levelOf = new Uint8Array(H);
  const line = new Uint32Array(256);
  for (let y = 0; y < H; y++) {
    line.fill(0);
    const base = y * W * 4;
    for (let x = 0; x < W; x++) line[d[base + x * 4]]++;
    levelOf[y] = histPercentile(line, W, CFG.SHADE_LEVEL_PCT);
  }

  /* Page background = median scanline level. Robust as long as shaded rows
   * are the minority; if most of the table is shaded there is no unshaded
   * reference to normalize toward and we correctly do nothing. */
  const pageBg = [...levelOf].sort((a, b) => a - b)[H >> 1];
  const shaded = new Uint8Array(H);
  let shadedCount = 0;
  for (let y = 0; y < H; y++) {
    if (levelOf[y] <= pageBg - CFG.SHADE_MIN_DELTA) { shaded[y] = 1; shadedCount++; }
  }
  if (shadedCount === 0) return [];

  /* Page ink level, measured only where the page is not shaded. */
  const pageHist = new Uint32Array(256);
  let pageN = 0;
  for (let y = 0; y < H; y++) {
    if (shaded[y]) continue;
    const base = y * W * 4;
    for (let x = 0; x < W; x++) { pageHist[d[base + x * 4]]++; pageN++; }
  }
  const pageFg = histPercentile(pageHist, pageN, CFG.SHADE_FG_PCT);
  if (pageBg - pageFg < CFG.SHADE_MIN_PAGE_CONTRAST) return [];

  /* Group shaded scanlines into contiguous bands. */
  const bands = [];
  let inside = false, sy = 0;
  for (let y = 0; y <= H; y++) {
    const s = y < H ? shaded[y] : 0;
    if (s) { if (!inside) { sy = y; inside = true; } }
    else if (inside) { bands.push({ y: sy, h: y - sy }); inside = false; }
  }

  const minH = CFG.SHADE_MIN_BAND_H_SRC * CFG.UPSCALE;
  const applied = [];
  for (const band of bands) {
    /* Thin bands are rules, borders and underlines, not row highlights. */
    if (band.h < minH) continue;

    const bandHist = new Uint32Array(256);
    let bandN = 0;
    for (let y = band.y; y < band.y + band.h; y++) {
      const base = y * W * 4;
      for (let x = 0; x < W; x++) { bandHist[d[base + x * 4]]++; bandN++; }
    }
    /* The fill is whatever covers most of the band, so its level is the band
     * median — true for any glyph coverage, unlike an outer percentile, which
     * collapses onto the fill once the text is sparse. The glyphs are then the
     * extreme lying furthest from that fill, on whichever side that is: dark
     * text on a light highlight, or light text on a dark one. */
    const bandBg = histPercentile(bandHist, bandN, 0.5);
    const darkEnd = histPercentile(bandHist, bandN, CFG.SHADE_FG_PCT);
    const lightEnd = histPercentile(bandHist, bandN, 1 - CFG.SHADE_FG_PCT);

    const inverted = (lightEnd - bandBg) > (bandBg - darkEnd);
    const bandFg = inverted ? lightEnd : darkEnd;

    /* A flat band carries no text to recover; rescaling it only amplifies
     * noise, so leave solid fills, rules and gradients alone. */
    const contrast = Math.abs(bandBg - bandFg);
    if (contrast < CFG.SHADE_MIN_CONTRAST) continue;

    const scale = (pageBg - pageFg) / contrast;
    for (let y = band.y; y < band.y + band.h; y++) {
      const base = y * W * 4;
      for (let x = 0; x < W; x++) {
        const i = base + x * 4;
        /* 0 at the glyph level, `contrast` at the fill level, either polarity. */
        const rel = inverted ? bandFg - d[i] : d[i] - bandFg;
        const v = Math.max(0, Math.min(255, Math.round(pageFg + rel * scale)));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    applied.push({ ...band, bandBg, bandFg, scale, inverted });
  }

  if (applied.length) ctx.putImageData(img, 0, 0);
  return applied;
}

/** Compute Otsu's optimal binarization threshold for a grayscale array. */
function computeOtsu(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumBg = 0, wBg = 0, best = 0, thr = 0;
  for (let t = 0; t < 256; t++) {
    wBg += hist[t];
    if (wBg === 0) continue;
    const wFg = total - wBg;
    if (wFg === 0) break;
    sumBg += t * hist[t];
    const diff = sumBg / wBg - (sumAll - sumBg) / wFg;
    const v = wBg * wFg * diff * diff;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

/** Binarize a grayscale canvas using Otsu's method. Returns the threshold used. */
function binarize(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const n = canvas.width * canvas.height;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) gray[i] = d[i * 4];
  const thr = computeOtsu(gray);
  for (let i = 0; i < n; i++) {
    const v = gray[i] <= thr ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return thr;
}

/**
 * Get flat binary array from a binarized canvas.
 * Convention: 0 = ink (dark), 1 = background (light).
 */
function getBinary(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const n = canvas.width * canvas.height;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = d[i * 4] < 128 ? 0 : 1;
  return b;
}

