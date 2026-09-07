/* ===== UAD 3.6 Helper — Configuration ================================= */
/* Recognition constants are inherited from MLS-Extract, whose values are  */
/* benchmarked against real connectMLS screenshots. Everything under       */
/* "GRID" and "STATUS" is new and specific to this app.                    */
/* ===================================================================== */

const CFG = {
  /* ---- Preprocessing (MLS-Extract parity) ---- */
  UPSCALE: 4,                   // Nearest-neighbor upscale factor

  /* Normalization — 24×32 kept after benchmarking (20px risks 8/0 collapse) */
  NORM_W: 24,
  NORM_H: 32,
  NORM_PAD: 2,

  /* Classification thresholds */
  MIN_COMBINED: 0.35,           // Min combined score to accept a glyph
  MIN_DIGIT_SCORE: 0.60,        // Min combined score for ANY digit in a valid row
  MIN_MARGIN: 0.02,             // Min gap between 1st and 2nd combined scores
  NCC_WEIGHT: 0.8,              // Weight of NCC in combined score
  STRUCTURAL_WEIGHT: 0.2,       // Weight of structural features in combined score

  /* Confused-pair rejection (stricter margin for known confusable digits) */
  CONFUSABLE_MARGIN: 0.05,
  CONFUSABLE_PAIRS: [
    [0, 9], [0, 8], [3, 5], [3, 8],
    [5, 6], [6, 9], [1, 7], [8, 9],
  ],

  /* Row-shading normalization (selected/alternating row highlights) */
  SHADE_LEVEL_PCT: 0.50,
  SHADE_FG_PCT: 0.02,
  SHADE_MIN_DELTA: 12,
  SHADE_MIN_BAND_H_SRC: 3,
  SHADE_MIN_CONTRAST: 20,
  SHADE_MIN_PAGE_CONTRAST: 40,

  /* Table rules (cell borders a hand-drawn crop keeps) */
  RULE_SPAN_SLACK_SRC: 2,
  RULE_MAX_THICK_SRC: 4,

  /* Segmentation */
  MIN_ROW_DENSITY: 0.012,
  MIN_DIGIT_W_SRC: 2,
  MIN_DIGIT_H_SRC: 4,
  MIN_CC_AREA: 10,

  /* Adaptive template bank */
  MAX_TEMPLATES_PER_DIGIT: 16,
  REFINE_SCORE: 0.80,
  REFINE_MARGIN: 0.18,
  DEDUP_THRESHOLD: 0.97,

  /* Robust hole analysis */
  HOLE_THRESHOLDS: [0.40],
  HOLE_MATCH_BOOST: 0.04,
  HOLE_MISMATCH_PENALTY: 0.02,

  /* Sub-pixel alignment: ±1px shifts for NCC matching */
  NCC_SHIFT_OFFSETS: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]],

  /* Column banding (MLS-Extract parity) */
  MLS_DIGITS: 8,
  COL_MIN_BANDS: 3,
  COL_GUTTER_RATIO: 0.5,
  COL_HLINE_RATIO: 0.5,
  COL_VLINE_RATIO: 3.0,
  COL_MIN_COVERAGE: 0.4,
  COL_SAMPLE_ROWS: 8,
  COL_MIN_VALID: 0.35,
  COL_PAD_SRC: 3,

  /* Feature flag — Tesseract kept available but disabled */
  USE_TESSERACT_FALLBACK: false,

  /* ================================================================== */
  /*  NEW — GRID ANALYSIS                                               */
  /* ================================================================== */

  /* Guard against a HiDPI paste exploding into an unallocatable canvas.
   * Chrome fails a large getImageData SILENTLY (transparent black), which
   * would look like "no rows found" instead of "out of memory". */
  MAX_UPSCALED_MPX: 60,

  /* --- Tokenizing a row ---
   * The gap that ends a cell is derived from the screenshot's own glyph
   * width, never from a fixed pixel count. Intra-cell gaps (around a comma,
   * between '$' and the first digit) run 1-3 source px; column gutters run
   * 8px and up. A multiple of the glyph width sits cleanly between the two at
   * any DPI or zoom level, where a constant does not. */
  TOKEN_GAP_GLYPHS: 1.15,       // Gap ending a token, as a multiple of glyph width
  GLYPH_SPLIT_RATIO: 1.45,      // Segment wider than this × glyph width is merged glyphs

  /* --- Reading numbers --- */
  PRICE_MIN_DIGITS: 3,
  PRICE_MAX_DIGITS: 9,          // "$123,456,789"
  PRICE_MIN_VALUE: 1000,
  PRICE_MAX_VALUE: 30000000,

  /* --- Scoring a column as money --- */
  PRICE_COL_MIN_ROWS: 2,        // Rows a column must parse before it is money
  PRICE_COL_MIN_FRAC: 0.60,     // Fraction of its non-empty cells that must parse
  PRICE_COL_MIN_DOLLAR: 0.90,   // Fraction of parsed cells carrying a '$'
  PRICE_COL_MEDIAN_MIN: 20000,  // Plausible median for a residential sale column
  PRICE_COL_MEDIAN_MAX: 20000000,
  PRICE_DIGIT_SPREAD: 2,        // Digit-count deviation from the column median that
                                // marks a value as a split-token artefact
  DENSE_COL_MIN_FRAC: 0.85,     // Populated on this fraction of rows → "always filled"
  SOLD_FILL_MIN_ACC: 0.90,      // Agreement with the closed-row set to name Sold Pr
  SOLD_MIN_BLANK_ROWS: 3,       // …and it must be BLANK on at least this many non-closed rows.
                                // Agreement alone is worthless on a closed-heavy grid, where an
                                // always-filled asking-price column agrees with the closed set
                                // simply because almost every row is closed.
  SOLD_LIST_RATIO_MIN: 0.5,     // median(sold) must land in this band around
  SOLD_LIST_RATIO_MAX: 1.5,     //   median(list), or the pairing is rejected
  ORIG_GE_LIST_FRAC: 0.60,      // Orig ≥ List on this fraction of rows, else swap
  CONC_MAX_FRAC_OF_LIST: 0.25,  // A concessions column's median, as a fraction of the sold
  CONC_MIN_FRAC_OF_LIST: 0.002, //   median — concessions are a few percent, not a rounding
                                //   error and not a quarter of the price

  /* --- Header row --- */
  HEADER_MAX_ROWS: 6,           // Rows from the top that may be the header. A grid
                                // preceded by a toolbar or a "1–45 of 45" line puts
                                // the header well below row 0.
  HEADER_MIN_WORD_SCORE: 0.42,
  HEADER_MIN_LABELS: 4,         // Labels a row must match to be the header
  HEADER_MIN_ANCHORS: 2,        // …of which this many must be Stat/List/Sold/MLS

  /* --- Word matching (status tokens, header labels) --- */
  WORD_NORM_W: 128,
  WORD_NORM_H: 32,
  WORD_ASPECT_WEIGHT: 0.25,
  STATUS_MIN_SCORE: 0.55,       // Min combined score to name a status token
  STATUS_MIN_MARGIN: 0.05,      // Min gap to the runner-up token
  STATUS_CONFUSABLE_MARGIN: 0.10, // …raised for pairs differing by one glyph
  STATUS_SINGLETON_SCORE: 0.65, // A cluster of one gets no votes, so it must be clearer…
  STATUS_SINGLETON_MARGIN: 0.22, // …unless it beats every alternative by this much, which is
                                // evidence of a different kind and just as strong
  STATUS_ABS_SHAPE: 0.50,       // Absolute floor on raw NCC — an open-set guard, so an
                                // unknown token is refused rather than named
  STATUS_BAND_MIN_FRAC: 0.55,
  STATUS_SAMPLE_CELLS: 12,      // Cells scored while judging a column's candidacy. The winner is
                                // then read in full; scoring every cell of every column is what
                                // made a 200-row grid appear to hang.
  STATUS_MAX_GLYPHS: 6,

  /* --- Clustering status cells ---
   * Three branches, because colour must never be able to veto a merge of two
   * near-identical bitmaps: row shading shifts anti-aliased ink by a few RGB
   * points, and a colour veto would split one code into two clusters. */
  CLUSTER_SHAPE_MERGE: 0.955,   // ≥ this → merge whatever the colours say
  CLUSTER_SHAPE_NEVER: 0.86,    // < this → never merge, whatever the colours say
  CLUSTER_WIDTH_TOL: 0.14,      // Ink-width agreement required before NCC is consulted
  COLOR_CLUSTER_DIST: 42,       // Between the two, colours must agree within this

  /* --- When to stop trusting the result --- */
  UNRESOLVED_PROVISIONAL: 0.10, // Unreadable fraction above which the summary is
                                // marked provisional and copying is blocked
  SMALL_GRID_ROWS: 15,          // …and below this row count, ANY unreadable row does it

  /* Fonts tried when synthesizing templates. The best-scoring family for a
   * given screenshot wins; connectMLS renders in the browser's UI stack, so
   * which one is in play depends on the machine that took the screenshot. */
  SYNTH_FONTS: [
    '"Segoe UI", sans-serif',
    'Arial, sans-serif',
    'Tahoma, sans-serif',
    'Verdana, sans-serif',
    '"Helvetica Neue", Helvetica, sans-serif',
  ],
  SYNTH_FONT_SIZE: 48,
  SYNTH_WEIGHT: 'bold',
};
