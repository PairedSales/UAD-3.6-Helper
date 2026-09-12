/*
 * The CoreLogic Matrix profile.
 *
 * Same standard as the reference grid: every row asserted individually, not
 * just the totals. The Matrix grid is drawn in a different face (Verdana,
 * regular weight), reads a one-letter status, heads days on market "DOM",
 * underlines its MLS numbers — and in the layout it was built from, carries no
 * current list price at all. Each of those broke something, so each is checked.
 */

const { launch, analyze, truthFor, fixturePath, makeChecker, checkBucket,
        checkMarketTime } = require('./harness.js');
const { MATRIX_LISTINGS } = require('./matrix-data.js');
const { withListPrices } = require('./make-matrix-fixture.js');

const pct = v => (v == null ? '—' : (v * 100).toFixed(3) + '%');

/** Every row, field by field, against the listings the fixture was drawn from. */
function checkRows(check, res, listings, label, fields) {
  const byN = new Map(res.rows.map(r => [r.index, r]));
  const wrong = {};
  for (const f of fields) wrong[f] = [];
  const got = { status: 'status', mls: 'mls', listPrice: 'listPrice', origPrice: 'origPrice',
                soldPrice: 'soldPrice', marketTime: 'marketTime' };
  const want = { status: l => l.stat, mls: l => l.mls, listPrice: l => l.list,
                 origPrice: l => l.orig, soldPrice: l => l.sold, marketTime: l => l.mt };

  let mlsUnread = 0;
  for (const l of listings) {
    const r = byN.get(l.n);
    if (!r) { wrong[fields[0]].push(`row ${l.n}: missing entirely`); continue; }
    for (const f of fields) {
      /* An MLS number feeds only the duplicate check, and the ported
       * confusable-digit guard refuses a number with an ambiguous 0/8/9 in it.
       * A blank is allowed there — a WRONG number is not. */
      if (f === 'mls' && r.mls === null) { mlsUnread++; continue; }
      if (r[got[f]] !== want[f](l)) wrong[f].push(`row ${l.n}: ${r[got[f]]} ≠ ${want[f](l)}`);
    }
  }
  for (const f of fields) {
    check.ok(`${label}: no ${f} value read wrongly` + (f === 'mls' ? '' : ` (all ${listings.length} read)`),
      !wrong[f].length, wrong[f].slice(0, 6).join('; '));
  }
  if (fields.includes('mls')) {
    check.ok(`${label}: nearly every MLS number read`, mlsUnread <= listings.length * 0.1,
      `${mlsUnread} of ${listings.length} unread`);
  }
}

const ALL_FIELDS = ['status', 'mls', 'listPrice', 'origPrice', 'soldPrice', 'marketTime'];

const CASES = [
  {
    name: 'matrix',
    title: 'The Matrix layout as it is: Sold Price and Orig Price, but no List Price',
    run(check, res, truth) {
      check.ok('header row recognized', res.header);
      check.eq('rows read', res.rows.length, MATRIX_LISTINGS.length);
      check.eq('every status read', res.unresolved, 0);
      check.ok('the one-letter vocabulary was used', res.clusters.every(c => /^[A-Z]$/.test(c.code)),
        JSON.stringify(res.clusters));
      check.ok('sold price named by the header', res.roles.methodBy.sold === 'header');
      check.ok('Orig Price named by the header', res.roles.methodBy.orig === 'header');

      /* The regression this fixture exists for. The header named Orig Price, and
       * the positional fallback re-bound that same column as the list price, so
       * nine active listings were summarized on their ORIGINAL asking prices. */
      check.ok('NO list price column was bound', !res.roles.hasList,
        JSON.stringify(res.roles.methodBy));
      check.ok('no row carries a list price', res.rows.every(r => r.listPrice === null));
      check.eq('active listings are counted', res.summary.active.count, truth.expected.active.count);
      check.eq('…and not priced', res.summary.active.priced, 0);
      check.eq('active low is empty, not Orig Price', res.summary.active.low, null);
      check.ok('the missing List Price column is reported by name',
        res.warnings.some(w => /List Price/.test(w.text) && w.level === 'warn'));
      check.ok('the reading is provisional', res.provisional === true);
      check.ok('the Lowest List Price field is empty',
        (res.fields.find(f => f.label === 'Lowest List Price') || {}).value === null);

      checkRows(check, res, MATRIX_LISTINGS, 'matrix', ALL_FIELDS);
      checkBucket(check, 'closed', res.summary.closed, truth.expected.closed);
      check.eq('pending.count', res.summary.pending.count, truth.expected.pending.count);

      /* DOM is Matrix's market time. It binds by its label, like MT. */
      check.ok('the DOM column was bound as market time', !!res.marketTimeCol);
      check.eq('the blank DOM cell is blank, not read', res.marketTimeCol && res.marketTimeCol.blank, 1);
      checkMarketTime(check, 'active', res.summary.active.marketTime, truth.expected.active.marketTime);
      checkMarketTime(check, 'closed', res.summary.closed.marketTime, truth.expected.closed.marketTime);

      const r = res.summary.closed.ratio, w = truth.expected.closed.ratio;
      check.eq('ratio.count', r && r.count, w.count);
      check.eq('ratio.median', pct(r && r.median), pct(w.median));
      check.eq('ratio.low', pct(r && r.low), pct(w.low));
      check.eq('ratio.high', pct(r && r.high), pct(w.high));

      check.ok('row numbers 1–48 cross-checked',
        res.indexCol && res.indexCol.first === 1 && res.indexCol.last === 48 && !res.indexCol.missing.length,
        JSON.stringify(res.indexCol));
      check.eq('no row band was discarded', res.skipped.outOfRange + res.skipped.notAListing, 0);
    },
  },
  {
    name: 'matrix-list-price',
    title: 'The same search with List Price added to the display — a complete reading',
    run(check, res, truth) {
      const listings = withListPrices(MATRIX_LISTINGS);
      check.eq('column-role method', res.roles.method, 'header');
      check.ok('list, orig and sold all named by the header',
        res.roles.hasList && res.roles.hasOrig && res.roles.hasSold);
      checkRows(check, res, listings, 'list-price', ALL_FIELDS);
      checkBucket(check, 'active', res.summary.active, truth.expected.active);
      checkBucket(check, 'pending', res.summary.pending, truth.expected.pending);
      checkBucket(check, 'closed', res.summary.closed, truth.expected.closed);
      checkMarketTime(check, 'active', res.summary.active.marketTime, truth.expected.active.marketTime);
      check.ok('the reading is NOT provisional', res.provisional === false,
        res.uadOutput.split('\n').slice(0, 6).join(' | '));
      check.ok('the green no-rows-dropped tick is earned',
        res.warnings.some(w => w.level === 'ok' && /no rows were dropped/.test(w.text)));
      const field = label => (res.fields.find(f => f.label === label) || {}).value;
      check.eq('Active Listings', field('Active Listings'), String(truth.expected.active.count));
      check.eq('Median Days on Market', field('Median Days on Market'),
        String(truth.expected.active.marketTime.median));
      check.eq('Median List Price', field('Median List Price'), String(truth.expected.active.median));
      check.eq('Median Sale Price', field('Median Sale Price'), String(truth.expected.closed.median));
      check.eq('Pending Sales', field('Pending Sales'), String(truth.expected.pending.count));
    },
  },
  {
    name: 'matrix-hidpi',
    title: 'A 2× Retina paste of the Matrix grid — identical to 1×',
    run(check, res, truth) {
      const listings = withListPrices(MATRIX_LISTINGS);
      checkRows(check, res, listings, 'hidpi', ALL_FIELDS);
      checkBucket(check, 'active', res.summary.active, truth.expected.active);
      checkBucket(check, 'pending', res.summary.pending, truth.expected.pending);
      checkBucket(check, 'closed', res.summary.closed, truth.expected.closed);
      checkMarketTime(check, 'active', res.summary.active.marketTime, truth.expected.active.marketTime);
      check.ok('the reading is NOT provisional', res.provisional === false,
        res.uadOutput.split('\n').slice(0, 6).join(' | '));
    },
  },
  {
    name: 'matrix-no-header',
    title: 'Header cropped off — a one-letter status must not be read without its label',
    run(check, res) {
      /* A column of single glyphs is also BR, # Garage and a row number, and
       * at this size S correlates with 5. Without the "St" label there is
       * nothing to say it holds letters. Nothing may be counted. */
      check.ok('no header was claimed from a data row', res.header === false);
      check.ok('no status column was bound', res.statusColumn === null, JSON.stringify(res.statusColumn));
      check.eq('nothing counted as active', res.summary.active.count, 0);
      check.eq('nothing counted as closed', res.summary.closed.count, 0);
      check.ok('no days on market without a DOM label', res.marketTimeCol === null,
        JSON.stringify(res.marketTimeCol));
      check.ok('the reading is provisional', res.provisional === true);
      check.ok('the missing status column is an error',
        res.warnings.some(w => w.level === 'error' && /status/i.test(w.text)));
    },
  },
];

(async () => {
  console.log('\n========== MATRIX ==========');
  const browser = await launch();
  const failures = [];
  try {
    for (const c of CASES) {
      console.log(`\n--- ${c.name}: ${c.title}\n`);
      const check = makeChecker(c.name);
      let res;
      try {
        res = await analyze(browser, fixturePath(c.name));
      } catch (err) {
        console.log(`  FAIL  analysis threw: ${err.message}`);
        failures.push(c.name);
        continue;
      }
      if (!check.ok('analysis completed', res.ok, res.status)) {
        res.logs.slice(-25).forEach(l => console.log('    ' + l));
        failures.push(c.name);
        continue;
      }
      c.run(check, res, truthFor(c.name));
      if (!check.done()) {
        failures.push(c.name);
        console.log('\n  --- page log tail ---');
        res.logs.slice(-30).forEach(l => console.log('    ' + l));
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${CASES.length - failures.length}/${CASES.length} Matrix cases passed`);
  if (failures.length) console.log(`FAILED: ${failures.join(', ')}`);
  console.log('============================\n');
  process.exit(failures.length ? 1 : 0);
})();
