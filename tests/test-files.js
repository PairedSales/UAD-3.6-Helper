/*
 * Exports, through the page.
 *
 * test-table.js proves the parser; this proves the app around it — that a file
 * dropped on the page reaches the form panel, the column map, the review table
 * and the copy gate, and that nothing on the way assumes there was a
 * screenshot. The numbers are held to the same reference as every screenshot
 * fixture.
 */

const { launch, analyzeFile, makeChecker, checkBucket, checkMarketTime } = require('./harness.js');
const { LISTINGS, expectedSummary, DEFAULT_BUCKET } = require('./grid-data.js');
const { mredTsv, craarCsv } = require('./table-fixtures.js');

function expectExact(check, res, want, label) {
  for (const id of ['active', 'pending', 'closed']) {
    checkBucket(check, `${label}.${id}`, res.summary[id], want[id]);
    checkMarketTime(check, `${label}.${id}`, res.summary[id].marketTime, want[id].marketTime);
  }
}

function expectNoPageErrors(check, res, label) {
  const errors = res.logs.filter(l => /PAGEERROR/.test(l));
  check.ok(`${label}: the page threw nothing`, errors.length === 0, errors.join(' | '));
}

const CASES = [
  {
    title: 'The reference search as a connectMLS TSV export',
    file: () => [mredTsv(), 'ConnectMLS_export.TSV'],
    run(check, res) {
      expectNoPageErrors(check, res, 'tsv');
      check.eq('rows read', res.rows.length, LISTINGS.length);
      const off = LISTINGS.filter((l, i) => {
        const r = res.rows[i];
        return !r || r.mls !== l.mls || r.status !== l.stat || r.listPrice !== l.list ||
          r.soldPrice !== l.sold || r.origPrice !== l.orig || r.concessions !== l.conc ||
          r.marketTime !== l.mt;
      }).map(l => l.n);
      check.ok('every row matches the reference, field by field', off.length === 0, `rows ${off.join(', ')}`);
      expectExact(check, res, expectedSummary(LISTINGS, DEFAULT_BUCKET), 'tsv');
      check.eq('not provisional', res.provisional, false);
      check.eq('so every field can be copied', res.dom.copyAllDisabled, false);
      check.ok('the form panel was drawn', res.dom.uadValues.length === 10, res.dom.uadValues.join(', '));
      check.ok('the column map names the file’s own headings',
        /“Sold Pr”/.test(res.dom.columnMap) && /“MT”/.test(res.dom.columnMap), res.dom.columnMap);
      check.ok('and says nothing was inferred', /nothing was inferred/.test(res.dom.columnsNote));
      check.eq('the review table lists every row', res.dom.reviewRows, LISTINGS.length);
      check.ok('the detail panel describes the file, not a canvas',
        /tab-separated/.test(res.dom.debug), res.dom.debug.slice(0, 120));
      check.ok('the preview names the file', /ConnectMLS_export\.TSV/.test(res.dom.preview));
      check.ok('the green tick is earned', res.warnings.some(w => w.level === 'ok'));
    },
  },
  {
    title: 'The same search as a CRAAR-style CSV with single-letter statuses',
    file: () => [craarCsv(null, { letters: true }), 'Custom.csv'],
    run(check, res) {
      expectNoPageErrors(check, res, 'csv');
      const want = expectedSummary(LISTINGS.map(l => Object.assign({}, l, { conc: null })), DEFAULT_BUCKET);
      expectExact(check, res, want, 'csv');
      check.eq('not provisional', res.provisional, false);
      check.ok('the review table shows the file’s own codes',
        res.dom.reviewStatuses.every(s => ['S', 'A', 'P'].includes(s)), res.dom.reviewStatuses.join(','));
      check.ok('Close Price and Current Price are shown as what fed the numbers',
        /“Close Price”/.test(res.dom.columnMap) && /“Current Price”/.test(res.dom.columnMap),
        res.dom.columnMap);
      check.ok('the missing concessions column is shown as missing',
        /Concessions\s*not in this file/.test(res.dom.columnMap), res.dom.columnMap);
    },
  },
  {
    title: 'An active listing with a blank DOM — the form field must be withheld',
    file: () => {
      const rows = LISTINGS.map(l => (l.n === 5 ? Object.assign({}, l, { mt: null }) : l));
      return [mredTsv(rows), 'blank-dom.tsv'];
    },
    run(check, res) {
      expectNoPageErrors(check, res, 'blank-dom');
      check.eq('provisional', res.provisional, true);
      check.eq('copy every field is off', res.dom.copyAllDisabled, true);
      check.ok('the copied block carries the caveat', /PROVISIONAL/.test(res.uadOutput));
    },
  },
  {
    title: 'A record that lost a field — kept, unresolved, and blocking',
    file: () => {
      const lines = mredTsv().split('\n');
      lines[3] = lines[3].split('\t').filter((_, i) => i !== 9).join('\t');   /* drop CONC */
      return [lines.join('\n'), 'shifted.tsv'];
    },
    run(check, res) {
      expectNoPageErrors(check, res, 'shifted');
      check.eq('every record is still a row', res.rows.length, LISTINGS.length);
      check.eq('the shifted one is unresolved', res.unresolved, 1);
      check.eq('provisional', res.provisional, true);
      check.ok('the line is named', res.warnings.some(w => w.level === 'error' && /line 4/.test(w.text)));
    },
  },
  {
    title: 'A code this app does not know is shown as the file wrote it',
    file: () => {
      const rows = LISTINGS.map(l => (l.n === 1 ? Object.assign({}, l, { stat: 'ZZZ' }) : l));
      return [mredTsv(rows), 'unknown.tsv'];
    },
    run(check, res) {
      expectNoPageErrors(check, res, 'unknown');
      check.eq('the select holds the file’s code, not "— set —"', res.dom.reviewStatuses[0], 'ZZZ');
      check.eq('provisional', res.provisional, true);
    },
  },
  {
    title: 'A CSV that is not an MLS export',
    file: () => ['name,email\nJo,jo@example.com\n', 'contacts.csv'],
    run(check, res) {
      expectNoPageErrors(check, res, 'not-export');
      check.eq('no report', res.ok, false);
      check.ok('the page says what it expected', /could not be read|No listings/.test(res.status), res.status);
    },
  },
];

(async () => {
  console.log('\n========== EXPORTS THROUGH THE PAGE ==========');
  const browser = await launch();
  const results = [];
  try {
    for (const c of CASES) {
      console.log(`\n--- ${c.title}`);
      const check = makeChecker(c.title);
      const [text, name] = c.file();
      const res = await analyzeFile(browser, text, name);
      c.run(check, res);
      results.push(check.done());
    }
  } finally {
    await browser.close();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\nExports through the page: ${passed}/${results.length} cases passed`);
  console.log('==============================================\n');
  process.exit(passed === results.length ? 0 : 1);
})();
