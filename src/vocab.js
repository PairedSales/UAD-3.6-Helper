/* ===== UAD 3.6 Helper — Status & Header Vocabularies ================== */
/* Everything the recognizer is allowed to read out of a connectMLS grid    */
/* lives here. Both vocabularies are CLOSED: the recognizer never invents a  */
/* token, it only picks the best member of these lists — or refuses.         */
/*                                                                          */
/* The status list follows MRED Rules & Regulations §2.5 ("Reporting Status  */
/* of Listing") and the MRED Residential Glossary. Codes other MLSs use but  */
/* MRED does not — WDRN, EXPD, LEAS, CONT — are deliberately absent: every   */
/* extra candidate is one more near-tie for the matcher to lose on, so a     */
/* padded vocabulary makes the real codes LESS reliable, not more.           */
/*                                                                          */
/* Three tiers:                                                             */
/*   RECOGNIZED_TOKENS — what the whole-cell matcher may emit.              */
/*   KICKOUT_CODES     — codes MRED renders with a variable suffix (HS72,   */
/*                       HC24). No whole-cell template can match one, so a  */
/*                       refused cell is split: the letters read glyph by   */
/*                       glyph, the suffix only proving it is digits.       */
/*   STATUS_CODES      — everything the mapping editor knows and the user    */
/*                       may assign by hand, and every code a CSV or TSV    */
/*                       export may carry as text.                          */
/* ===================================================================== */

/* Buckets the app reports on.
 *   excluded     — known code, deliberately not counted
 *   unclassified — we do not know what this is; never silently merged with
 *                  "excluded", because "read and set aside" and "could not
 *                  read" call for completely different responses. */
const BUCKETS = [
  { id: 'active',       label: 'Active Listings', short: 'Active' },
  { id: 'pending',      label: 'Pending Sales',   short: 'Pending' },
  { id: 'closed',       label: 'Closed Sales',    short: 'Closed' },
  { id: 'excluded',     label: 'Not Counted',     short: 'Excluded' },
  { id: 'unclassified', label: 'Unclassified',    short: 'Unknown' },
];

const REPORTED_BUCKETS = ['active', 'pending', 'closed'];

/**
 * Which price column feeds each bucket.
 *   'list' → the "List Price" column (current asking price)
 *   'sold' → the "Sold Pr" column (settled sale price)
 * There is no cross-source fallback anywhere in this app: a closed sale whose
 * sold price could not be read contributes nothing to the closed statistics.
 * An asking price silently entering a sold median is the exact error this
 * tool exists to prevent.
 */
const BUCKET_PRICE_SOURCE = {
  active:  'list',
  pending: 'list',
  closed:  'sold',
};

/**
 *   code   — exactly as the grid renders it
 *   name   — what it stands for
 *   bucket — default bucket id
 *   given  — the user specified this mapping themselves
 *   ocr    — the image recognizer may emit this token
 *   flag   — a caution shown next to rows carrying this code
 *   note   — shown in the mapping editor
 */
const STATUS_CODES = [
  /* --- Active: MRED §2.5(a), (h) --- */
  { code: 'ACTV', name: 'Active', bucket: 'active', given: true, ocr: true,
    note: 'On market, no accepted contract.' },
  { code: 'PCHG', name: 'Price Change', bucket: 'active', given: true, ocr: true,
    note: 'Active listing whose price was revised; reverts to ACTV after 5 days.' },
  { code: 'NEW', name: 'New Listing', bucket: 'active', given: false, ocr: true,
    note: 'Newly entered active listing; a 5-day display flag on ACTV.' },
  { code: 'RACT', name: 'Reactivated', bucket: 'active', given: false, ocr: true,
    note: 'Back on market after being contingent, pending or TEMP.' },
  { code: 'BOMK', name: 'Back on Market', bucket: 'active', given: false, ocr: true,
    note: 'Relisted after cancel, close, expiry or rental. Closed Date may be stale.' },
  { code: 'AUCT', name: 'Auction', bucket: 'active', given: false, ocr: true,
    flag: 'The List Price may be a reserve or opening bid, not an asking price.',
    note: 'Available for showings, marketed by auction.' },
  { code: 'TEMP', name: 'Temporarily No Showings', bucket: 'active', given: true, ocr: true,
    note: 'Listing agreement in force and not under contract, but temporarily not showable. ' +
          'MRED classes it Active (MC=A); it is competing supply with a current list price.' },
  { code: 'PRIV', name: 'Private Listing Network', bucket: 'active', given: false, ocr: false,
    flag: 'No open-market exposure — many appraisers exclude these.',
    note: 'Renders as PRIV-ACTV / PRIV-PEND etc. Excluded from IDX and syndication.' },

  /* --- Pending / under contract: MRED §2.5(b)–(f), (i) --- */
  { code: 'PEND', name: 'Pending', bucket: 'pending', given: true, ocr: true,
    note: 'Executed contract, no contingencies other than closing.' },
  { code: 'FIN', name: 'Financing Contingency', bucket: 'pending', given: true, ocr: true,
    note: 'Under contract, awaiting the mortgage commitment.' },
  { code: 'A/I', name: 'Attorney Approval / Inspection', bucket: 'pending', given: false, ocr: true,
    flag: 'MRED classes A/I as Active-Contingent — flip to Active if your ' +
          'analysis counts showable contingent listings as supply.',
    note: 'Under contract, in the Illinois attorney-review and inspection window.' },
  { code: 'CTGO', name: 'Contingent — Other', bucket: 'pending', given: false, ocr: true,
    flag: 'Unspecified contingency; the listing broker must be called to know its strength.',
    note: 'Under contract with an unspecified contingency.' },
  { code: 'CTG', name: 'Contingent', bucket: 'pending', given: false, ocr: false,
    note: 'MRED search umbrella for the contingency flags; some layouts print it.' },
  { code: 'SS', name: 'Short Sale', bucket: 'pending', given: false, ocr: true,
    flag: 'Short sales are frequently not arm’s-length for value purposes.',
    note: 'Under contract, awaiting lienholder approval.' },
  { code: 'HS', name: 'Home Sale Contingency', bucket: 'pending', given: false, ocr: false,
    kickout: true,
    flag: 'Seller keeps a kick-out clause and is still soliciting offers — ' +
          'the most defensible “still active” contingency.',
    note: 'Renders with the kick-out hours appended, e.g. HS72. Read as HS: the hours ' +
          'change no bucket, so they are proved to be digits but never printed.' },
  { code: 'HC', name: 'Home Close Contingency', bucket: 'pending', given: false, ocr: false,
    kickout: true,
    note: 'Renders with the kick-out hours appended, e.g. HC24. Read as HC.' },
  { code: 'PS', name: 'Commercial Property Sale', bucket: 'pending', given: false, ocr: false,
    kickout: true,
    note: 'Commercial analogue of HS.' },
  { code: 'PC', name: 'Commercial Property Close', bucket: 'pending', given: false, ocr: false,
    kickout: true,
    note: 'Commercial analogue of HC.' },

  /* --- Closed: MRED §2.5(j) --- */
  { code: 'CLSD', name: 'Closed', bucket: 'closed', given: true, ocr: true,
    note: 'Settled sale. Summarized on Sold Pr — never on List Price.' },

  /* --- Read, displayed, deliberately not counted --- */
  { code: 'CTGA', name: 'Contingent on Auction', bucket: 'excluded', given: false, ocr: true,
    note: 'Under contract awaiting auction — the price is not yet a market price.' },
  { code: 'EXP', name: 'Expired', bucket: 'excluded', given: false, ocr: true,
    note: 'Listing agreement ended unsold. Neither supply nor a sale.' },
  { code: 'CANC', name: 'Cancelled', bucket: 'excluded', given: false, ocr: true,
    note: 'Listing agreement cancelled. MRED uses CANC where other MLSs say Withdrawn.' },
  { code: 'RNTD', name: 'Rented', bucket: 'excluded', given: false, ocr: true,
    flag: 'A lease is not a settled sale — rents must never enter a sale median.',
    note: 'Lease executed. Move to Closed only if you are analyzing rentals.' },
  { code: 'HOLD', name: 'Hold', bucket: 'excluded', given: false, ocr: false,
    note: 'System hold for a missing primary photo; visible only to the listing office.' },
  { code: 'DRF', name: 'Draft', bucket: 'excluded', given: false, ocr: false,
    note: 'Draft listing — not a market state at all.' },

  /* --- One-letter status codes: CoreLogic Matrix, and other MLSs' exports ---
   *
   * Two ways in, one vocabulary.
   *
   * As the TEXT of a CSV or TSV export the letter is exact. Read off a Matrix
   * SCREENSHOT it is a single coloured glyph, and a one-glyph cell can only ever
   * be one of these while a two-or-more-glyph cell can only ever be one of the
   * MRED codes above — see statusVocabularyFor() — so neither set is ever a
   * near-tie for the other. The one-letter set is also allowed only under a
   * header-named status column.
   *
   * Only S, A and P are put in a bucket. Their meaning is the same everywhere
   * they appear, and an export proves it: every S row carries a close date and
   * a close price, every P row a pending date, and no A row either.
   *
   * C, W, X and T are here for the RECOGNIZER, as an open-set guard, and are
   * bucketed nowhere. At 13px a letter nobody told the matcher about is still
   * some distance from S, A or P, and against a list of three it would be named
   * after the nearest one — a withdrawn listing counted as active. Known by
   * shape, each is read and then left unclassified, which blocks the copy until
   * the appraiser says what it means on their board: C is Closed in one MLS and
   * Contingent in another, and even W, X and T are a guess the app will not
   * make silently — a glyph misread as W must not quietly remove a listing.
   * In an export, where any unknown letter is unclassified anyway, they change
   * nothing. */
  { code: 'S', name: 'Sold', bucket: 'closed', given: false, ocr: true, mls: 'matrix',
    note: 'One-letter code (Matrix, e.g. CRAAR). Summarized on the sold / close price.' },
  { code: 'A', name: 'Active', bucket: 'active', given: false, ocr: true, mls: 'matrix',
    note: 'One-letter code (Matrix, e.g. CRAAR). On market, no accepted contract.' },
  { code: 'P', name: 'Pending', bucket: 'pending', given: false, ocr: true, mls: 'matrix',
    note: 'One-letter code (Matrix, e.g. CRAAR). Under contract.' },
  { code: 'C', name: 'Contingent or Closed/Cancelled', bucket: 'unclassified', given: false, ocr: true,
    mls: 'matrix',
    flag: 'C means different things on different boards — contingent in some, closed or ' +
          'cancelled in others. Set it to match yours.',
    note: 'One-letter code whose meaning varies by board: counted nowhere until you choose.' },
  { code: 'W', name: 'Withdrawn (usually)', bucket: 'unclassified', given: false, ocr: true,
    mls: 'matrix',
    note: 'One-letter code, withdrawn on most Matrix boards. Counted nowhere until you choose — ' +
          'usually Excluded.' },
  { code: 'X', name: 'Expired (usually)', bucket: 'unclassified', given: false, ocr: true,
    mls: 'matrix',
    note: 'One-letter code, expired on most Matrix boards. Counted nowhere until you choose — ' +
          'usually Excluded.' },
  { code: 'T', name: 'Temporarily off / Terminated', bucket: 'unclassified', given: false, ocr: true,
    mls: 'matrix',
    note: 'One-letter code, temporarily off market or terminated. Counted nowhere until you choose.' },
];

const STATUS_BY_CODE = {};
for (const s of STATUS_CODES) STATUS_BY_CODE[s.code] = s;

/** The closed set the whole-cell matcher is allowed to choose from (MRED codes). */
const RECOGNIZED_TOKENS = STATUS_CODES.filter(s => s.ocr && !s.mls).map(s => s.code);

/** Matrix's one-letter codes: the closed set for a column of single glyphs. */
const SINGLE_LETTER_TOKENS = STATUS_CODES.filter(s => s.ocr && s.mls === 'matrix').map(s => s.code);

/**
 * Which vocabulary a status column is read against, decided ONCE for the
 * column from how many glyphs its cells hold.
 *
 * Every MRED code is two to five glyphs and every Matrix code is one, so glyph
 * count separates the two vocabularies outright — no Matrix letter is ever a
 * candidate for a CLSD cell, and no MRED code for an S cell. Mixing them would
 * put SS beside S and PC beside P, which is exactly the kind of padding the top
 * of this file refuses.
 *
 * The one-letter vocabulary is only allowed on a column the HEADER named as
 * the status. A column of single glyphs is also what BR, # Garage and a row
 * number are, and at 13px S correlates with 5 — so without the label there is
 * nothing to say the column holds letters at all. Same rule as market time.
 */
function statusVocabularyFor(cells, headerNamed) {
  const n = cells.length;
  const single = cells.filter(c => c.token.tall.length === 1).length;
  if (headerNamed && n >= 2 && single / n >= 0.9) return { id: 'matrix', tokens: SINGLE_LETTER_TOKENS };
  return { id: 'mred', tokens: RECOGNIZED_TOKENS };
}

/**
 * Codes MRED prints with the kick-out period stuck on the end — HS48, HC24 —
 * where the period is whatever hours the listing agent typed. There is no
 * closed set of renderings to correlate against, so these cells are read in
 * two parts: the letters as a word, the suffix as digits. See src/status.js.
 */
const KICKOUT_CODES = STATUS_CODES.filter(s => s.kickout).map(s => s.code);

/**
 * Every letter that appears in a status code.
 *
 * The kick-out prefix is read one glyph at a time, and each glyph is ranked
 * against this whole set rather than against the four letters that would suit
 * the answer. A glyph that is really a B wins as B, spells nothing, and is
 * refused — which is the open-set guard the closed vocabulary gives the
 * whole-cell matcher for free.
 */
const STATUS_ALPHABET = Array.from(new Set(
  STATUS_CODES.filter(s => !s.mls).map(s => s.code).join('').split('')
    .filter(c => /[A-Z]/.test(c)))).sort();

/**
 * Everything a glyph inside a status cell may be: a letter of some code, or a
 * digit of a kick-out period.
 *
 * The suffix is proved to be a number against THIS set rather than against
 * the digit bank, because the bank is a fixed bitmap set calibrated on the
 * regular-weight digits of a price column and the Stat column is bold. Ranked
 * here, both alternatives are synthesized in the screenshot's own font at the
 * weight it is actually printed in, and the only question asked is the one
 * that matters: letter or digit.
 */
const STATUS_GLYPHS = STATUS_ALPHABET.concat('0123456789'.split(''));

/**
 * The letters that, substituted at position `i` of `code`, would spell a
 * DIFFERENT kick-out code.
 *
 * Those substitutions are the only ones that can move a row to another bucket
 * and still be accepted — every other misread spells something that is not a
 * code at all and is refused on that alone. So they are where the strict
 * one-glyph margin is spent, rather than on the runner-up whatever it is.
 */
function kickoutRivals(code, i) {
  return KICKOUT_CODES
    .filter(c => c !== code && c.length === code.length &&
                 c.split('').every((ch, j) => j === i || ch === code[j]))
    .map(c => c[i]);
}

/** Everything a user may assign by hand. */
const STATUS_TOKENS = STATUS_CODES.map(s => s.code);

/**
 * Pairs that differ by a single glyph. They get a stricter margin, because a
 * one-glyph confusion here moves an entire cluster of rows between buckets.
 */
const CONFUSABLE_STATUS_PAIRS = [
  ['CTGA', 'CTGO'], ['HS', 'HC'], ['PS', 'PC'],
  ['ACTV', 'AUCT'], ['PEND', 'PCHG'], ['CANC', 'CTG'],
  /* The kick-out letters are matched two glyphs at a time, which puts them in
   * reach of the only other two-letter code in the vocabulary. */
  ['HS', 'SS'], ['PS', 'SS'], ['HC', 'SS'], ['PC', 'SS'],
];

/**
 * Fold a rendered code onto a vocabulary entry.
 * MRED appends kick-out hours to HS/HC/PS/PC and prefixes Private Listing
 * Network codes with "PRIV-", neither of which is a distinct market state.
 */
function normalizeStatusCode(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (STATUS_BY_CODE[s]) return s;
  const kick = s.match(/^(HS|HC|PS|PC)\d+$/);
  if (kick) return kick[1];
  const priv = s.match(/^PRIV-(.+)$/);
  if (priv) return STATUS_BY_CODE[priv[1]] ? priv[1] : 'PRIV';
  return null;
}

/**
 * Header labels the column identifier can recognize, and the role each
 * implies. Roles the app acts on are 'status', 'list', 'sold', 'orig', 'conc'
 * and 'mt'; the rest are decoys, named so a column can be positively ruled out
 * rather than merely failing to match.
 */
const HEADER_LABELS = [
  { text: 'Stat',            role: 'status' },
  { text: 'Status',          role: 'status' },
  { text: 'List Price',      role: 'list'   },
  { text: 'Current Price',   role: 'list'   },
  { text: 'Sold Pr',         role: 'sold'   },
  { text: 'Sold Price',      role: 'sold'   },
  { text: 'Closed Pr',       role: 'sold'   },
  { text: 'Orig List Pr',    role: 'orig'   },
  { text: 'Orig List Price', role: 'orig'   },
  { text: 'CONC',            role: 'conc'   },
  { text: 'Conc',            role: 'conc'   },
  { text: 'MLS #',           role: 'mls'    },
  { text: 'Closed Date',     role: 'date'   },
  { text: 'City',            role: 'text'   },
  { text: 'Street #',        role: 'text'   },
  { text: 'Str Name',        role: 'text'   },
  { text: 'Sfx',             role: 'text'   },
  /* Market time — connectMLS's days-on-market. A column of one- to three-digit
   * integers, which is the same shape as '# Rms', 'Yr Blt', 'All Beds' and
   * 'ASF'; nothing but the header label tells them apart, so nothing but the
   * header label is allowed to bind it. See readMarketTimeColumn in grid.js. */
  { text: 'MT',              role: 'mt'     },
  { text: 'Market Time',     role: 'mt'     },

  /* --- CoreLogic Matrix ---
   * 'DOM' is Matrix's own label for days on market — the same quantity MT is,
   * bound the same way: by its label and never by the shape of its data.
   * Matrix has no List Price in every layout; when it does, it is labelled
   * 'List Price', which is already above. 'Orig Price' is the ORIGINAL list
   * price and is never read as the current one. */
  { text: 'St',              role: 'status' },
  { text: 'ML #',            role: 'mls'    },
  { text: 'DOM',             role: 'mt'     },
  { text: 'Orig Price',      role: 'orig'   },
  /* Decoys: the rest of a Matrix grid. Named so each is positively ruled out
   * — without 'BR', a two-letter header could be matched as 'St' and put the
   * status label over a column of bedroom counts. */
  { text: 'Sold Date',       role: 'date'   },
  { text: 'SubTy',           role: 'text'   },
  { text: 'Area',            role: 'text'   },
  { text: 'City/Town',       role: 'text'   },
  { text: 'Address',         role: 'text'   },
  { text: 'Style',           role: 'text'   },
  { text: 'BR',              role: 'num'    },
  { text: 'Baths',           role: 'num'    },
  { text: 'AGF Sq',          role: 'num'    },
  { text: 'Total Sqft',      role: 'num'    },
  { text: 'Lot Size',        role: 'text'   },
  { text: 'Garage',          role: 'text'   },
  { text: 'Acres',           role: 'num'    },

  { text: '# Rms',           role: 'num'    },
  { text: 'ASF',             role: 'num'    },
  { text: 'Yr Blt',          role: 'num'    },
  { text: 'All Beds',        role: 'num'    },
  { text: '# Full Baths',    role: 'num'    },
  { text: '# Half Baths',    role: 'num'    },
  { text: 'Type',            role: 'text'   },
  { text: '# Garage',        role: 'num'    },
];

/** The header labels that positively identify a column we act on. */
const ANCHOR_HEADER_ROLES = ['status', 'list', 'sold', 'mls'];

/** Every role the app reads a number or a status out of. At most one column each. */
const ACTED_HEADER_ROLES = ['status', 'list', 'orig', 'sold', 'conc', 'mls', 'mt'];

/**
 * Every string a header cell may be matched against.
 *
 * A sort indicator is drawn on whichever column the grid is sorted by, glued to
 * its label. connectMLS draws a solid triangle, which a font renders closely
 * enough to template, so the anchor labels get ▲ and ▼ variants. Matrix draws
 * an arrow ICON that no font glyph resembles; that one is handled by matching
 * the cell with its last glyph dropped — see matchHeaderToken in grid.js.
 *
 * `base` is the plain labels alone, for the one font-selection pass: it only
 * has to tell font families apart, and the variants would multiply its cost
 * without adding evidence.
 */
function headerCandidates() {
  const base = HEADER_LABELS.map(h => h.text);
  const all = base.slice();
  for (const h of HEADER_LABELS) {
    if (ANCHOR_HEADER_ROLES.includes(h.role)) all.push(h.text + '▲', h.text + '▼');
  }
  return { base, all };
}

/**
 * The role a header match may claim, given how well it matched.
 *
 * Short labels — St, BR, MT, DOM — are also what short DATA looks like, so a
 * weak match of one is not allowed to do anything that only a header can do:
 * it does not count toward recognizing the row as a header, and a market-time
 * label, which is the ONLY thing that binds days on market, does not bind.
 */
function headerMatchRole(role, score) {
  if (role === 'mt' && score < CFG.HEADER_MIN_ANCHOR_SCORE) return 'text';
  return role;
}

/** Anchor roles present among matches strong enough to count as anchors. */
function countHeaderAnchors(matches) {
  const strong = new Set(matches.filter(m => m.score >= CFG.HEADER_MIN_ANCHOR_SCORE).map(m => m.role));
  return ANCHOR_HEADER_ROLES.filter(r => strong.has(r)).length;
}

/** A matched header string back to its label: strip any sort indicator. */
function headerLabelOf(text) {
  return String(text).replace(/[▲▼]$/, '');
}

/** Default mapping object: { code: bucketId }. */
function defaultStatusMapping() {
  const m = {};
  for (const s of STATUS_CODES) m[s.code] = s.bucket;
  return m;
}

/** Resolve a status code to its bucket under a (possibly edited) mapping. */
function bucketForStatus(code, mapping) {
  const norm = normalizeStatusCode(code);
  if (!norm) return 'unclassified';
  if (mapping && Object.prototype.hasOwnProperty.call(mapping, norm)) return mapping[norm];
  const entry = STATUS_BY_CODE[norm];
  return entry ? entry.bucket : 'unclassified';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BUCKETS, REPORTED_BUCKETS, BUCKET_PRICE_SOURCE, STATUS_CODES, STATUS_BY_CODE,
    RECOGNIZED_TOKENS, SINGLE_LETTER_TOKENS, statusVocabularyFor,
    KICKOUT_CODES, STATUS_ALPHABET, STATUS_GLYPHS, kickoutRivals,
    STATUS_TOKENS, CONFUSABLE_STATUS_PAIRS, HEADER_LABELS,
    ANCHOR_HEADER_ROLES, ACTED_HEADER_ROLES, headerCandidates, headerLabelOf,
    headerMatchRole, countHeaderAnchors,
    defaultStatusMapping, bucketForStatus, normalizeStatusCode,
  };
}
