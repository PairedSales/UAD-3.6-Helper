/*
 * Exports built from the reference search.
 *
 * The same 37 rows the screenshot fixtures are drawn from, written out the way
 * two real MLSs export them — so the export reader is checked against the SAME
 * ground truth as the recognizer, and the two ways in cannot quietly come to
 * disagree about a number.
 *
 *   mredTsv   — connectMLS's "Export → TSV": bare numbers, LF line ends, no
 *               quoting, MRED status codes, and the grid's own column labels.
 *   craarCsv  — a Paragon-style CSV from another MLS: every field quoted, "$"
 *               and thousands separators, CRLF, no concessions column, and
 *               labels that name the same things differently ("Close Price",
 *               "Current Price", "DOM").
 *
 * The real exports these were modelled on are not committed: they are live MLS
 * data, with agent names in them.
 */

const { LISTINGS } = require('./grid-data.js');

const MRED_HEADER = ['MLS #', 'Stat', 'City', 'Street #', 'Str Name', 'Sfx', 'MT', 'Closed Date',
  'Sold Pr', 'CONC', 'Orig List Pr', 'List Price', '# Rms', 'ASF', 'Yr Blt', 'All Beds',
  '# Full Baths', '# Half Baths', 'Type', '# Garage Spaces', 'SP:OLP', 'Basement Description'];

const blank = v => (v === null || v === undefined ? '' : String(v));

function mredTsv(listings, opts = {}) {
  const rows = (listings || LISTINGS).map(l => [
    l.mls, l.stat, 'Dolton', l.streetNo, l.street, l.sfx, blank(l.mt), l.closed,
    blank(l.sold), blank(l.conc), blank(l.orig), blank(l.list), l.rms, l.asf, l.yr, l.beds,
    l.full, l.half, l.type, l.gar,
    l.sold && l.orig ? Math.round(100 * l.sold / l.orig) + '%' : '',
    /* Commas inside a TSV field are data, and must not split it. */
    'Partially Finished, Rec/Family Area, Storage Space',
  ]);
  const eol = opts.eol || '\n';
  return [MRED_HEADER].concat(rows).map(r => r.join('\t')).join(eol) + eol;
}

const CRAAR_HEADER = ['', 'MLS#', 'Status', 'SubType', 'City', 'Address', 'Close Date', 'DOM',
  'Close Price', 'Original List Price', 'Style', 'Year Built', 'Beds Total',
  'List Agent Full Name', 'Current Price', 'Listing Contract Date', 'Pending Date'];

/* CRAAR's single-letter codes, for a search whose statuses are all of the three
 * the vocabulary maps. Every other MRED code in the reference grid is active. */
const CRAAR_CODE = { CLSD: 'S', PEND: 'P', FIN: 'P', 'A/I': 'P' };

const money = v => (v === null || v === undefined ? '' : '$' + Number(v).toLocaleString('en-US'));
const q = v => `"${String(v).replace(/"/g, '""')}"`;

function craarCsv(listings, opts = {}) {
  const rows = (listings || LISTINGS).map((l, i) => [
    '1', l.mls, opts.letters ? (CRAAR_CODE[l.stat] || 'A') : l.stat, 'SFM', 'Dolton',
    /* A comma and a quote inside quoted fields: the two things a naive split breaks on. */
    `${l.streetNo} ${l.street}, Unit ${i + 1}`, l.closed, blank(l.mt),
    money(l.sold), money(l.orig), 'RANCH', l.yr, l.beds,
    i === 2 ? 'Bob "Ace" Smith' : 'Jane Agent', money(l.list), '01/02/2026', '',
  ]);
  return [CRAAR_HEADER].concat(rows).map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}

module.exports = { mredTsv, craarCsv, CRAAR_CODE, MRED_HEADER, CRAAR_HEADER };
