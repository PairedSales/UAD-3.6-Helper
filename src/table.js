/* ===== UAD 3.6 Helper — Reading an MLS Export (CSV / TSV) ============= */
/* The other way in. A screenshot has to be RECOGNIZED; an export only has   */
/* to be PARSED — every value is already text, so there is nothing to guess  */
/* at and nothing to infer. That changes what can go wrong, not what the app */
/* refuses to do about it:                                                   */
/*                                                                           */
/*   - Columns are bound by their header text and by nothing else. A column  */
/*     no header names is not read; two columns that claim the same role     */
/*     bind neither.                                                          */
/*   - A cell that does not parse as what its column holds is refused and    */
/*     named, never coerced. "$42O,000" is not 420000.                        */
/*   - A record whose field count does not match the header has shifted     */
/*     columns, so NONE of its values can be trusted. It is kept as a row     */
/*     with no status, so it lands in `unresolved` and blocks copying.         */
/*   - Every record after the header reaches the report or a named counter,  */
/*     and the two are checked to add up.                                     */
/*                                                                           */
/* Pure functions: no DOM, no canvas. The output has the same row shape as   */
/* extractGrid(), so buildReport and every renderer take it unchanged.       */
/* ===================================================================== */

/**
 * The header text that binds each role, per export.
 *
 * Wider than the image recognizer's HEADER_LABELS, and deliberately so. There,
 * every extra label is one more near-tie for a whole-word PIXEL match to lose
 * on — which is why a screenshot's market time is bound by "MT" alone. Here the
 * header is exact text, "DOM" cannot be misread as "# Rms", and the only thing
 * a label has to be is unambiguous in meaning.
 *
 * Which is why "CDOM" is absent: cumulative days on market survives a relisting
 * and MT does not, so it is a different number under a similar name.
 */
const TABLE_HEADER_ROLES = [
  { role: 'status', labels: ['Stat', 'Status'] },
  { role: 'mls',    labels: ['MLS #', 'MLS Number', 'MLS No'] },
  { role: 'list',   labels: ['List Price', 'Current Price', 'Current List Price'] },
  { role: 'orig',   labels: ['Orig List Pr', 'Orig List Price', 'Original List Price'] },
  { role: 'sold',   labels: ['Sold Pr', 'Sold Price', 'Close Price', 'Closed Price', 'Closed Pr'] },
  { role: 'conc',   labels: ['CONC', 'Concessions', 'Seller Concessions'] },
  { role: 'mt',     labels: ['MT', 'Market Time', 'DOM', 'Days on Market'] },
];

const TABLE_ROLE_NAME = {
  status: 'status', mls: 'MLS number', list: 'list price', orig: 'original list price',
  sold: 'sold price', conc: 'concessions', mt: 'market time',
};

/** Case, spacing and punctuation do not distinguish two labels: "MLS #" is "MLS#". */
function headerKey(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const TABLE_ROLE_BY_KEY = {};
for (const r of TABLE_HEADER_ROLES) for (const l of r.labels) TABLE_ROLE_BY_KEY[headerKey(l)] = r.role;

/** The largest file this will read. An MLS export of a few hundred rows is ~100 KB. */
const TABLE_MAX_BYTES = 20 * 1024 * 1024;

/* -------------------------------------------------------------------- */
/*  Bytes → text → records                                               */
/* -------------------------------------------------------------------- */

/**
 * Decode a file's bytes.
 *
 * A byte-order mark is believed. Without one the bytes must be valid UTF-8, and
 * if they are not the file is read as Windows-1252 — which is what Excel writes
 * a "CSV" in on an American Windows machine, and which cannot fail to decode.
 * Only addresses and agent names carry anything outside ASCII, so a wrong guess
 * here costs a mangled street name, never a number.
 */
function decodeTableBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'UTF-8' };
  }
  if (b[0] === 0xFF && b[1] === 0xFE) {
    return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16LE' };
  }
  if (b[0] === 0xFE && b[1] === 0xFF) {
    return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16BE' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8' };
  } catch (e) {
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252' };
  }
}

/**
 * Tab or comma.
 *
 * Decided by the header line, not the file extension: an export named .csv that
 * is really tab-separated is common enough, and reading it on commas turns every
 * "Finished, Rec/Family Area" into two columns. The extension only breaks a tie
 * — a header with no delimiter at all, which is one column and binds nothing.
 */
function sniffDelimiter(text, fileName) {
  let tabs = 0, commas = 0, inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && ch === '\t') tabs++;
    else if (!inQuotes && ch === ',') commas++;
  }
  if (tabs && tabs >= commas) return '\t';
  if (commas) return ',';
  return /\.tsv$/i.test(fileName || '') ? '\t' : ',';
}

/**
 * Split text into records, RFC 4180 style, for either delimiter.
 *
 * A field that STARTS with a quote is quoted: delimiters and line breaks inside
 * it are data, and "" is a literal quote. A quote anywhere else is an ordinary
 * character — a TSV lot size of 85'x138" is not the start of a quoted field.
 *
 * Each record carries the physical line it starts on, because that is how the
 * appraiser finds it again in the file.
 *
 * Returns { records, error }. An unterminated quote is an error for the whole
 * file: everything after it has been swallowed into one field, and no record
 * past that point can be trusted.
 */
function parseDelimited(text, delim) {
  const records = [];
  let fields = [], field = '', quoted = false, afterQuote = false;
  let line = 1, startLine = 1, stray = false, atFieldStart = true;
  let quoteLine = 0;

  const endField = () => {
    fields.push(field);
    field = ''; quoted = false; afterQuote = false; atFieldStart = true;
  };
  const endRecord = () => {
    endField();
    records.push({ fields, line: startLine, stray });
    fields = []; stray = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else {
        if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++;
        field += ch;
      }
      continue;
    }

    if (ch === delim) { endField(); continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      /* A line with nothing on it is not a record at all — most often the
       * newline that ends the file. */
      if (!(fields.length === 0 && field === '' && atFieldStart)) endRecord();
      line++;
      startLine = line;
      continue;
    }
    if (ch === '"' && atFieldStart) {
      quoted = true; atFieldStart = false; quoteLine = line;
      continue;
    }
    /* Text after a closing quote — "abc"def — is not a well-formed field. The
     * characters are kept, and the record is marked so it is not trusted. */
    if (afterQuote) stray = true;
    atFieldStart = false;
    field += ch;
  }

  if (quoted) {
    return {
      records,
      error: `a quoted field opened on line ${quoteLine} is never closed, so nothing after it ` +
             `can be split into columns`,
    };
  }
  if (fields.length || field !== '' || !atFieldStart) endRecord();
  return { records, error: null };
}

/* -------------------------------------------------------------------- */
/*  Cells                                                                */
/* -------------------------------------------------------------------- */

/**
 * A money cell: "$647,839", "310000", "9978.71".
 *
 * Comma grouping, where there is any, must be exact — "1,23,456" is refused, not
 * read as 123456. A zero price is read as no price: several MLSs write $0 in the
 * sold column of a listing that has not sold, and zero is never a price.
 *
 * Returns { value }, { blank: true } or { error }.
 */
function parseTableMoney(raw, role) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { blank: true };

  const m = text.match(/^\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return { error: 'is not an amount' };

  const n = parseFloat(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
  if (!isFinite(n)) return { error: 'is not an amount' };

  if (role === 'conc') {
    /* Concessions keep their cents, and a small one is still a real one. */
    const value = Math.round(n * 100) / 100;
    if (value > CFG.PRICE_MAX_VALUE) return { error: 'is larger than any concession this tool accepts' };
    return { value };
  }

  const value = Math.round(n);
  if (value === 0) return { blank: true };
  if (value < CFG.PRICE_MIN_VALUE || value > CFG.PRICE_MAX_VALUE) {
    return { error: `is outside the range this tool accepts for a price ` +
                    `(${formatPrice(CFG.PRICE_MIN_VALUE)}–${formatPrice(CFG.PRICE_MAX_VALUE)})` };
  }
  return { value };
}

/** A market-time cell: whole days, within the bounds a read cell is held to. */
function parseTableDays(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { blank: true };
  if (!/^(\d{1,3}(?:,\d{3})+|\d+)$/.test(text)) return { error: 'is not a whole number of days' };
  const value = parseInt(text.replace(/,/g, ''), 10);
  if (!isFinite(value) || value > CFG.MT_MAX_DAYS) {
    return { error: `is outside the range this tool accepts (0–${CFG.MT_MAX_DAYS} days)` };
  }
  return { value };
}

/**
 * A status cell, as the report should carry it.
 *
 * The file's own text, with one exception: a kick-out code with its hours
 * appended — HS48 — is carried as HS, the same as the screenshot reader carries
 * it, so the row table, the mapping grid and the copied report agree.
 */
function tableStatusText(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return null;
  const kick = text.toUpperCase().match(/^(HS|HC|PS|PC)\d+$/);
  return kick ? kick[1] : text;
}

/* -------------------------------------------------------------------- */
/*  The header                                                           */
/* -------------------------------------------------------------------- */

/**
 * Bind roles from one header record.
 *
 * Returns { columns: { role: { index, label } }, ambiguous: [{ role, labels }] }.
 * A role named by two columns — "List Price" beside "Current Price" — binds
 * NEITHER: picking one is a coin toss about which number the appraiser meant.
 */
function bindTableHeader(fields) {
  const claims = {};
  fields.forEach((label, index) => {
    const role = TABLE_ROLE_BY_KEY[headerKey(label)];
    if (!role) return;
    (claims[role] = claims[role] || []).push({ index, label: String(label).trim() });
  });

  const columns = {}, ambiguous = [];
  for (const { role } of TABLE_HEADER_ROLES) {
    const c = claims[role];
    if (!c) continue;
    if (c.length === 1) columns[role] = c[0];
    else ambiguous.push({ role, labels: c.map(x => x.label) });
  }
  return { columns, ambiguous };
}

/** Which row field each role's value lands in. */
const ROW_KEY_OF_ROLE = {
  mls: 'mls', list: 'listPrice', orig: 'origPrice', sold: 'soldPrice', conc: 'concessions', mt: 'marketTime',
};

/** Roles a record must bind, two of them, to be taken for the header. */
const TABLE_ANCHOR_ROLES = ['status', 'mls', 'list', 'orig', 'sold'];

/** The header is the first record that names two anchor columns, within the first few. */
function findTableHeader(records) {
  const limit = Math.min(records.length, 10);
  for (let i = 0; i < limit; i++) {
    const bound = bindTableHeader(records[i].fields);
    const anchors = TABLE_ANCHOR_ROLES.filter(r =>
      bound.columns[r] || bound.ambiguous.some(a => a.role === r));
    if (anchors.length >= 2) return Object.assign({ at: i }, bound);
  }
  return null;
}

/* -------------------------------------------------------------------- */
/*  The whole file                                                       */
/* -------------------------------------------------------------------- */

/** "lines 4, 9 and 12" — and past a handful, how many more. */
function tableLineList(lines, max) {
  const cap = max || 8;
  const shown = lines.slice(0, cap);
  const more = lines.length - shown.length;
  const words = shown.length === 1 ? `line ${shown[0]}`
    : `lines ${shown.slice(0, -1).join(', ')}${more ? ', ' + shown[shown.length - 1] : ' and ' + shown[shown.length - 1]}`;
  return words + (more ? ` and ${more} more` : '');
}

/**
 * Read an export.
 *
 * Returns the same shape extractGrid() does where the UI shares it — rows,
 * warnings, skipped, review, roles — plus what only a file has: the delimiter,
 * the header's own labels, and which column each role came from.
 */
function extractTable(text, fileName, meta) {
  const name = fileName || 'pasted table';
  const warnings = [];
  const skipped = { notAListing: 0, malformed: 0, aboveHeader: 0 };
  const fail = (message) => ({
    source: 'file', fileName: name, failed: true, rows: [], skipped,
    warnings: warnings.concat([{ level: 'error', text: message }]),
  });

  const body = String(text || '').replace(/^\uFEFF/, '');
  if (!body.trim()) return fail(`${name} is empty.`);

  const delimiter = sniffDelimiter(body, fileName);
  const parsed = parseDelimited(body, delimiter);
  if (parsed.error) return fail(`${name} could not be read: ${parsed.error}.`);

  const header = findTableHeader(parsed.records);
  if (!header) {
    const first = parsed.records[0] ? parsed.records[0].fields.slice(0, 12).join(' | ') : '';
    return fail(
      `${name} does not look like an MLS export: no header row names a status, MLS number or ` +
      `price column. Expected labels such as "Stat" or "Status", "MLS #", "List Price", ` +
      `"Sold Pr" or "Close Price". The first line reads: ${first.slice(0, 160)}`);
  }

  const cols = header.columns;
  const headerRecord = parsed.records[header.at];
  const width = headerRecord.fields.length;
  const records = parsed.records.slice(header.at + 1);

  if (header.at > 0) {
    skipped.aboveHeader = header.at;
    warnings.push({
      level: 'info',
      text: `${header.at} line(s) above the header row were ignored.`,
    });
  }

  for (const a of header.ambiguous) {
    warnings.push({
      level: 'error',
      text: `More than one column could be the ${TABLE_ROLE_NAME[a.role]} ` +
            `(${a.labels.map(l => `"${l}"`).join(', ')}), so none of them was used. Remove the ` +
            `extra column from the export.`,
    });
  }

  /* ---- Rows ---- */
  const rows = [];
  const refused = [];                 /* { line, role, label, raw, why } */
  const malformedLines = [];
  const blankStatusLines = [];

  const cell = (rec, role) => (cols[role] ? rec.fields[cols[role].index] : undefined);

  for (const rec of records) {
    const f = rec.fields;
    if (f.every(v => String(v).trim() === '')) { skipped.notAListing++; continue; }

    /* A trailing delimiter adds empty fields past the header's width and moves
     * nothing. Any other mismatch has moved values between columns. */
    const extraIsEmpty = f.length > width && f.slice(width).every(v => String(v).trim() === '');
    if ((f.length !== width && !extraIsEmpty) || rec.stray) {
      skipped.malformed++;
      malformedLines.push(rec.line);
      rows.push(tableRow(rec, { reject: 'malformed' }));
      continue;
    }

    const values = {};
    for (const role of ['list', 'orig', 'sold', 'conc']) {
      if (!cols[role]) { values[role] = null; continue; }
      const p = parseTableMoney(cell(rec, role), role);
      if (p.error) refused.push({ line: rec.line, role, label: cols[role].label, raw: cell(rec, role), why: p.error });
      values[role] = p.value === undefined ? null : p.value;
    }
    if (cols.mt) {
      const d = parseTableDays(cell(rec, 'mt'));
      if (d.error) refused.push({ line: rec.line, role: 'mt', label: cols.mt.label, raw: cell(rec, 'mt'), why: d.error });
      values.mt = d.value === undefined ? null : d.value;
    } else {
      values.mt = null;
    }

    const status = cols.status ? tableStatusText(cell(rec, 'status')) : null;
    if (cols.status && !status) blankStatusLines.push(rec.line);
    const mls = cols.mls ? (String(cell(rec, 'mls')).trim() || null) : null;

    rows.push(tableRow(rec, {
      status, mls,
      listPrice: values.list, origPrice: values.orig, soldPrice: values.sold,
      concessions: values.conc, marketTime: values.mt,
      reject: status ? null : (cols.status ? 'blank' : 'no-column'),
    }));
  }

  /* ---- Accounting ----
   * Every record after the header is a row or a named count. Checked, not
   * assumed: this is the file's equivalent of the row-number cross-check. */
  const accounted = rows.length + skipped.notAListing;
  if (accounted !== records.length) {
    warnings.push({
      level: 'error',
      text: `Row accounting does not balance: the file has ${records.length} records after the ` +
            `header but ${accounted} were placed. Do not rely on these numbers.`,
    });
  }

  /* ---- What the file lacked ---- */
  if (!cols.status && !header.ambiguous.some(a => a.role === 'status')) {
    warnings.push({
      level: 'error',
      text: 'The file has no "Stat" or "Status" column. Every listing needs a status to be ' +
            'counted — add that column to the export.',
    });
  }
  if (!cols.list && !header.ambiguous.some(a => a.role === 'list')) {
    warnings.push({
      level: 'warn',
      text: 'The file has no "List Price" or "Current Price" column, so active listings and ' +
            'pending sales cannot be priced.',
    });
  }
  if (!cols.sold && !header.ambiguous.some(a => a.role === 'sold')) {
    warnings.push({
      level: 'warn',
      text: 'The file has no "Sold Pr" or "Close Price" column, so closed sales cannot be priced. ' +
            'The list price is not substituted.',
    });
  }
  if (!cols.orig && !header.ambiguous.some(a => a.role === 'orig')) {
    warnings.push({
      level: 'info',
      text: 'The file has no "Orig List Pr" or "Original List Price" column, so no sale-to-list ' +
            'ratios could be computed.',
    });
  }
  if (!cols.conc && cols.sold) {
    warnings.push({
      level: 'info',
      text: 'The file has no concessions (CONC) column. Sale-to-list ratios treat concessions as zero.',
    });
  }
  if (!cols.mt && !header.ambiguous.some(a => a.role === 'mt')) {
    warnings.push({
      level: 'info',
      text: 'The file has no "MT" or "DOM" column, so no median days on market could be computed. ' +
            '(CDOM is not used: cumulative days on market survives a relisting, so it is a ' +
            'different number.)',
    });
  }

  /* ---- What the file carried that could not be used ---- */
  if (malformedLines.length) {
    warnings.push({
      level: 'error',
      text: `${malformedLines.length} record(s) do not have the header's ${width} columns ` +
            `(${tableLineList(malformedLines)}), so their values may sit under the wrong headings ` +
            `and none of them was used. They are listed below with no status — fix the export, ` +
            `or enter them by hand.`,
    });
  }
  if (refused.length) {
    const sample = refused.slice(0, 6).map(r =>
      `line ${r.line}, ${r.label} "${String(r.raw).trim()}" ${r.why}`).join('; ');
    warnings.push({
      level: 'error',
      text: `${refused.length} cell(s) could not be read as a number and were left empty rather ` +
            `than guessed at: ${sample}${refused.length > 6 ? '; …' : ''}.`,
    });
  }
  if (blankStatusLines.length) {
    warnings.push({
      level: 'warn',
      text: `${blankStatusLines.length} row(s) have an empty status (${tableLineList(blankStatusLines)}). ` +
            `They are listed below and are excluded from every count until you set a status for them.`,
    });
  }
  if (skipped.notAListing) {
    warnings.push({
      level: 'info',
      text: `${skipped.notAListing} record(s) had every field empty and were not treated as listings.`,
    });
  }

  if (cols.mt) {
    const blankMt = rows.filter(r => r.reject !== 'malformed' && r.marketTime === null).length;
    if (blankMt) {
      warnings.push({
        level: 'info',
        text: `${blankMt} row(s) have an empty ${cols.mt.label} cell. Each bucket's median days on ` +
              `market rests on the rows that carry one, and says so.`,
      });
    }
  }

  if (cols.mls) {
    const counts = new Map();
    for (const r of rows) if (r.mls) counts.set(r.mls, (counts.get(r.mls) || 0) + 1);
    const dupes = Array.from(counts.entries()).filter(([, n]) => n > 1);
    if (dupes.length) {
      warnings.push({
        level: 'warn',
        text: `The same MLS number appears more than once: ` +
              `${dupes.map(([m, n]) => `${m} ×${n}`).join(', ')}. One property counted twice will ` +
              `skew the median — untick the duplicate below.`,
      });
    }
  }

  const flagged = new Set();
  for (const r of rows) {
    if (!r.status) continue;
    if (/^PRIV-/i.test(r.status)) flagged.add('PRIV');
    const entry = STATUS_BY_CODE[normalizeStatusCode(r.status)];
    if (entry && entry.flag) flagged.add(entry.code);
  }
  for (const code of flagged) {
    warnings.push({ level: 'info', text: `${code}: ${STATUS_BY_CODE[code].flag}` });
  }

  const dropped = skipped.notAListing + skipped.aboveHeader;
  const unreadable = rows.filter(r => !r.status).length;
  if (!dropped && !unreadable && !refused.length && accounted === records.length) {
    warnings.push({
      level: 'ok',
      text: `All ${rows.length} rows of ${name} were read — no rows were dropped.`,
    });
  }

  const roleProblems = header.ambiguous.length;
  const review = {
    errors: warnings.filter(w => w.level === 'error').length,
    warns: warnings.filter(w => w.level === 'warn').length,
    droppedRows: dropped,
    roleProblems,
    confidence: 1,
    noStatusColumn: !cols.status,
    hasMarketTime: !!cols.mt,
    /* A blank cell in a file is known to be blank; a blank cell in a screenshot
     * might be a glyph that did not survive. buildReport needs to know which it
     * is looking at — see the market-time gate there. */
    source: 'file',
  };

  const count = (role) => rows.filter(r => r[ROW_KEY_OF_ROLE[role]] !== null &&
                                           r[ROW_KEY_OF_ROLE[role]] !== undefined).length;
  const methodBy = {};
  for (const role of ['list', 'orig', 'sold', 'conc']) if (cols[role]) methodBy[role] = 'header';

  return {
    source: 'file',
    fileName: name,
    encoding: meta && meta.encoding || null,
    delimiter: delimiter === '\t' ? 'tab' : 'comma',
    headerLine: headerRecord.line,
    headerLabels: headerRecord.fields.map(s => String(s).trim()),
    columns: cols,
    ambiguous: header.ambiguous,
    valueCounts: {
      status: rows.filter(r => r.status).length,
      mls: count('mls'), list: count('list'), orig: count('orig'),
      sold: count('sold'), conc: count('conc'), mt: count('mt'),
    },
    refused,
    recordCount: records.length,
    dataRowCount: rows.length,
    rows, warnings, skipped, review,
    roles: {
      method: 'header', methodBy, confidence: 1, notes: [],
      problems: header.ambiguous.map(a => `ambiguous ${TABLE_ROLE_NAME[a.role]} column`),
      list: cols.list || null, orig: cols.orig || null, sold: cols.sold || null, conc: cols.conc || null,
    },
    header: true,
    statusCol: null,
    statusClusters: [],
    indexCol: null,
    mlsCol: null,
    marketTimeCol: cols.mt ? {
      read: count('mt'),
      blank: rows.filter(r => r.reject !== 'malformed' && r.marketTime === null).length,
      unreadable: refused.filter(r => r.role === 'mt').length,
    } : null,
    failed: false,
  };
}

/** One row, in exactly the shape extractGrid() produces. */
function tableRow(rec, v) {
  return {
    line: rec.line,
    index: null,
    mls: v.mls || null,
    status: v.status || null,
    statusScore: null,
    statusMargin: null,
    statusColor: null,
    statusRanked: [],
    statusReject: v.reject || null,
    reject: v.reject || null,
    listPrice: v.listPrice === undefined ? null : v.listPrice,
    origPrice: v.origPrice === undefined ? null : v.origPrice,
    soldPrice: v.soldPrice === undefined ? null : v.soldPrice,
    concessions: v.concessions === undefined ? null : v.concessions,
    marketTime: v.marketTime === undefined ? null : v.marketTime,
    edited: false,
    omit: false,
  };
}

/** Does this pasted text look like an export, rather than something typed? */
function looksLikeTable(text) {
  const body = String(text || '').replace(/^\uFEFF/, '');
  if (!/[\r\n]/.test(body.trim())) return false;
  const parsed = parseDelimited(body.slice(0, 20000), sniffDelimiter(body));
  return !!findTableHeader(parsed.records);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TABLE_HEADER_ROLES, TABLE_MAX_BYTES, headerKey, decodeTableBytes, sniffDelimiter,
    parseDelimited, parseTableMoney, parseTableDays, tableStatusText, bindTableHeader,
    findTableHeader, extractTable, looksLikeTable,
  };
}
