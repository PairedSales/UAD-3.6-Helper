/* ===== UAD 3.6 Helper — Template Banks ================================ */
/* Two banks feed the recognizer:                                          */
/*                                                                         */
/*   digitBank  — the canonical connectMLS digits, cut from the reference   */
/*                strip MLS-Extract calibrated against, plus the two real   */
/*                dollar-sign crops. These are real screenshot pixels, so   */
/*                prices are read with the sibling project's accuracy.      */
/*                                                                         */
/*   font-adapted — the same bank plus digits synthesized in the family the   */
/*                screenshot turned out to be drawn in. connectMLS renders  */
/*                in the browser's UI font stack, so which family is on     */
/*                screen depends on the machine that took the screenshot.   */
/*                Used only on cells the reference bank could not read.     */
/* ===================================================================== */

let _digitBank = null;
let _digitBankPromise = null;


/**
 * Load a template from an image (data URI). Extracts the tight bbox and
 * normalizes to NORM_W × NORM_H. Ported from MLS-Extract.
 */
async function loadTemplateFromImage(src, rx = 0) {
  const img = await loadImage(src);
  const c = canvasFromImage(img);
  toGrayscale(c);
  const binCanvas = cloneCanvas(c);
  binarize(binCanvas);
  const bin = getBinary(binCanvas);

  const bb = tightBBox(bin, c.width, rx, 0, c.width - rx, c.height);
  if (!bb || bb.w < 2 || bb.h < 2) {
    throw new Error('Failed to find tight bbox for embedded template image');
  }

  const glyph = normalizeGlyph(c, bb.x, bb.y, bb.w, bb.h);
  const features = computeStructuralFeatures(glyph.binary, CFG.NORM_W, CFG.NORM_H, glyph.grayscale);
  return { grayscale: glyph.grayscale, binary: glyph.binary, features, score: 1.0, isReference: true };
}

/**
 * Render one character on a canvas and normalize it into a template.
 * Ported from MLS-Extract, with the font family made a parameter.
 */
function createSynthesizedTemplate(char, font, weight, size) {
  const fontFamily = font || CFG.SYNTH_FONTS[0];
  const fontWeight = weight || CFG.SYNTH_WEIGHT;
  const fontSize = size || CFG.SYNTH_FONT_SIZE;

  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 160;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000000';
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(char, c.width / 2, c.height / 2);

  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const bin = new Uint8Array(c.width * c.height);
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    bin[i / 4] = g < 128 ? 0 : 1;    /* 0 = ink, matching getBinary() */
  }

  const bb = tightBBox(bin, c.width, 0, 0, c.width, c.height);
  if (!bb) return null;             /* Space and other blank glyphs */

  const glyph = normalizeGlyph(c, bb.x, bb.y, bb.w, bb.h);
  const features = computeStructuralFeatures(glyph.binary, CFG.NORM_W, CFG.NORM_H, glyph.grayscale);
  return {
    grayscale: glyph.grayscale,
    binary: glyph.binary,
    features,
    score: 1.0,
    isReference: true,
    /* Un-normalized ink extent, in em units — lets the word matcher predict
     * how wide a rendered token should be before it has seen one. */
    emW: bb.w / fontSize,
    emH: bb.h / fontSize,
  };
}

/**
 * Load the canonical digit strip and build the digit + '$' bank.
 * Ported from MLS-Extract's loadReferenceTemplates, reading data URIs so the
 * page never taints its canvas on file://.
 */
async function loadDigitBank() {
  const img = await loadImage(ASSETS.REFERENCE_DIGITS);
  const srcCanvas = canvasFromImage(img);

  toGrayscale(srcCanvas);
  const grayCanvas = cloneCanvas(srcCanvas);

  const binCanvas = cloneCanvas(srcCanvas);
  binarize(binCanvas);
  const bin = getBinary(binCanvas);

  const hP = hProjection(bin, binCanvas.width, binCanvas.height);
  const rows = findRows(hP, binCanvas.width, 0.01);
  if (rows.length === 0) throw new Error('No text rows found in the reference digit strip');

  const row = rows.reduce((a, b) => (a.h > b.h ? a : b));
  const vP = vProjection(bin, binCanvas.width, row.y, row.h);
  const { segs } = findDigitSegments(vP, 2, 10, bin, binCanvas.width, row);
  if (segs.length !== 10) {
    throw new Error(`Expected 10 digit segments in the reference strip, got ${segs.length}`);
  }

  const bank = {};
  for (let d = 0; d <= 9; d++) bank[String(d)] = [];
  bank['$'] = [];

  const ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  for (let i = 0; i < 10; i++) {
    const seg = segs[i];
    const bb = tightBBox(bin, binCanvas.width, seg.x, row.y, seg.w, row.h);
    if (!bb || bb.w < 2 || bb.h < 2) continue;

    const glyph = normalizeGlyph(grayCanvas, bb.x, bb.y, bb.w, bb.h);
    const features = computeStructuralFeatures(glyph.binary, CFG.NORM_W, CFG.NORM_H, glyph.grayscale);
    bank[ORDER[i]].push({
      grayscale: glyph.grayscale, binary: glyph.binary, features,
      score: 1.0, isReference: true,
    });
  }

  const missing = ORDER.filter(d => bank[d].length === 0);
  if (missing.length) throw new Error(`Missing reference templates for digits: ${missing.join(', ')}`);

  /* Real dollar-sign crops, plus a synthesized 'S' for the case where
   * binarization eats the vertical stroke. */
  for (const [key, rx] of [[ASSETS.DOLLAR_REF_1, 4], [ASSETS.DOLLAR_REF_2, 4]]) {
    try { bank['$'].push(await loadTemplateFromImage(key, rx)); }
    catch (err) { console.warn('[Templates] dollar reference failed:', err.message); }
  }
  /* One synthesized 'S', for when binarization eats the symbol's vertical
   * stroke and leaves something closer to an S.
   *
   * The bucket is deliberately small. Whether a column carries a currency
   * prefix is settled by decideCurrencyPrefix from the comma arithmetic, so
   * these templates only have to stop a currency symbol being read as a digit
   * — and every template in this bank is correlated against every glyph in the
   * grid, five shifts each. Ten synthesized variants here cost more than they
   * were ever worth. A font-specific one is added on demand by
   * fontAdaptedDigitBank when the reference bank cannot read a cell. */
  const sTemplate = createSynthesizedTemplate('S', CFG.SYNTH_FONTS[1], 'normal');
  if (sTemplate) bank['$'].push(sTemplate);

  if (bank['$'].length === 0) throw new Error('No dollar-sign templates could be built');

  console.log(`[Templates] Digit bank ready (10 digits, ${bank['$'].length} dollar templates)`);
  return bank;
}

/**
 * The digit bank plus digits synthesized in one font family.
 *
 * The reference strip carries connectMLS's own pixels, which is why it is the
 * primary bank — but connectMLS inherits the browser's UI font, so the same
 * grid is Segoe UI on one machine and Verdana on another, and a Verdana '4'
 * does not correlate with an Arial '4'.
 *
 * This is used only as a SECOND pass, on the cells the reference bank could
 * not read. Adding these templates unconditionally would put more candidates
 * in front of every glyph, narrowing the margins the confusable-pair guard
 * depends on — and that guard is what keeps a misread digit out of a median.
 */
function fontAdaptedDigitBank(base, font) {
  const clone = {};
  for (const key of Object.keys(base)) clone[key] = base[key].slice();

  for (const ch of '0123456789$') {
    if (!clone[ch]) clone[ch] = [];
    for (const weight of ['normal', 'bold']) {
      const t = createSynthesizedTemplate(ch, font, weight);
      if (t) clone[ch].push(t);
    }
  }
  return clone;
}

/** Digit bank, loaded once. */
async function ensureDigitBank() {
  if (_digitBank) return _digitBank;
  if (!_digitBankPromise) _digitBankPromise = loadDigitBank();
  _digitBank = await _digitBankPromise;
  return _digitBank;
}

/** Reset the cached bank — used by tests that reload templates between runs. */
function resetTemplateCaches() {
  _digitBank = null;
  _digitBankPromise = null;
}
