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
/* Two tiers:                                                               */
/*   RECOGNIZED_TOKENS — what the image recognizer may emit.                */
/*   STATUS_CODES      — everything the mapping editor knows and the user    */
/*                       may assign by hand, including codes that carry a    */
/*                       variable suffix (HS72, HC24) no template can match. */
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
    flag: 'Seller keeps a kick-out clause and is still soliciting offers — ' +
          'the most defensible “still active” contingency.',
    note: 'Renders with the kick-out hours appended, e.g. HS72.' },
  { code: 'HC', name: 'Home Close Contingency', bucket: 'pending', given: false, ocr: false,
    note: 'Renders with the kick-out hours appended, e.g. HC24.' },
  { code: 'PS', name: 'Commercial Property Sale', bucket: 'pending', given: false, ocr: false,
    note: 'Commercial analogue of HS.' },
  { code: 'PC', name: 'Commercial Property Close', bucket: 'pending', given: false, ocr: false,
    note: 'Commercial analogue of HC.' },

  /* --- Closed: MRED §2.5(j) --- */
  { code: 'CLSD', name: 'Closed', bucket: 'closed', given: true, ocr: true,
    note: 'Settled sale. Summarized on Sold Pr — never on List Price.' },

  /* --- Read, displayed, deliberately not counted --- */
  { code: 'TEMP', name: 'Temporarily No Showings', bucket: 'excluded', given: false, ocr: true,
    flag: 'Listed but un-showable. MRED itself excludes TEMP days from Listing ' +
          'Market Time. Flip to Active if you count it as supply.',
    note: 'Agreement in force, not under contract, cannot be shown.' },
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
];

const STATUS_BY_CODE = {};
for (const s of STATUS_CODES) STATUS_BY_CODE[s.code] = s;

/** The closed set the image recognizer is allowed to choose from. */
const RECOGNIZED_TOKENS = STATUS_CODES.filter(s => s.ocr).map(s => s.code);

/** Everything a user may assign by hand. */
const STATUS_TOKENS = STATUS_CODES.map(s => s.code);

/**
 * Pairs that differ by a single glyph. They get a stricter margin, because a
 * one-glyph confusion here moves an entire cluster of rows between buckets.
 */
const CONFUSABLE_STATUS_PAIRS = [
  ['CTGA', 'CTGO'], ['HS', 'HC'], ['PS', 'PC'],
  ['ACTV', 'AUCT'], ['PEND', 'PCHG'], ['CANC', 'CTG'],
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
 * implies. Roles the app acts on are 'status', 'list', 'sold', 'orig' and
 * 'conc'; the rest are decoys, named so a column can be positively ruled out
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
  { text: 'MT',              role: 'num'    },
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
    RECOGNIZED_TOKENS, STATUS_TOKENS, CONFUSABLE_STATUS_PAIRS, HEADER_LABELS,
    ANCHOR_HEADER_ROLES, defaultStatusMapping, bucketForStatus,
    normalizeStatusCode,
  };
}
