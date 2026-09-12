/*
 * The headline test: the reference grid must produce exactly the counts, lows,
 * highs, medians and sale-to-list ratios that tests/grid-data.js says it
 * should — and it must read every individual row correctly, not merely land on
 * the right totals by two errors cancelling out.
 */

const { launch, analyze, truthFor, fixturePath, makeChecker, checkBucket,
        checkMarketTime } = require('./harness.js');
const { LISTINGS } = require('./grid-data.js');

const pct = v => (v == null ? '—' : (v * 100).toFixed(3) + '%');

(async () => {
  console.log('\n========== REFERENCE GRID ==========\n');

  const truth = truthFor('grid');
  const browser = await launch();
  let res;
  try {
    res = await analyze(browser, fixturePath('grid'));
  } finally {
    await browser.close();
  }

  const check = makeChecker('Reference grid');

  if (!check.ok('analysis completed', res.ok, res.status)) {
    console.log('\n--- page log tail ---');
    res.logs.slice(-60).forEach(l => console.log(l));
    process.exit(1);
  }

  /* --- Structure --- */
  check.ok('header row recognized', res.header);
  check.eq('column-role method', res.roles.method, 'header');
  check.ok('list price column found', res.roles.hasList);
  check.ok('original list price column found', res.roles.hasOrig);
  check.ok('sold price column found', res.roles.hasSold);
  check.ok('concessions column found', res.roles.hasConc);
  check.ok('no column problems reported', res.roles.problems.length === 0,
    res.roles.problems.join(' | '));
  check.eq('rows read', res.rows.length, LISTINGS.length);
  check.ok('row accounting balances', res.balanced);
  check.ok('result is not provisional', res.provisional === false);

  /* --- Per-row correctness --- */
  const byN = new Map(res.rows.map(r => [r.index != null ? r.index : r.n, r]));
  const wrong = { status: [], list: [], orig: [], sold: [], conc: [] };

  for (const want of LISTINGS) {
    const got = byN.get(want.n);
    if (!got) { wrong.status.push(`row ${want.n}: missing entirely`); continue; }
    if (got.status !== want.stat) {
      wrong.status.push(`row ${want.n}: read ${got.status || 'nothing'}, expected ${want.stat}`);
    }
    if (got.listPrice !== want.list) wrong.list.push(`row ${want.n}: ${got.listPrice} ≠ ${want.list}`);
    if (got.origPrice !== want.orig) wrong.orig.push(`row ${want.n}: ${got.origPrice} ≠ ${want.orig}`);
    if (got.soldPrice !== want.sold) wrong.sold.push(`row ${want.n}: ${got.soldPrice} ≠ ${want.sold}`);
    if (got.concessions !== want.conc) wrong.conc.push(`row ${want.n}: ${got.concessions} ≠ ${want.conc}`);
  }

  const n = LISTINGS.length;
  check.ok(`all ${n} statuses read correctly`, !wrong.status.length, wrong.status.slice(0, 6).join('; '));
  check.ok(`all ${n} list prices read correctly`, !wrong.list.length, wrong.list.slice(0, 6).join('; '));
  check.ok(`all ${n} original list prices read correctly`, !wrong.orig.length, wrong.orig.slice(0, 6).join('; '));
  check.ok('sold prices read correctly (and blank where blank)', !wrong.sold.length, wrong.sold.slice(0, 6).join('; '));
  check.ok('concessions read correctly (and blank where blank)', !wrong.conc.length, wrong.conc.slice(0, 6).join('; '));
  check.eq('rows with an unreadable status', res.unresolved, 0);

  /* --- The numbers the app exists to produce --- */
  console.log('');
  checkBucket(check, 'active', res.summary.active, truth.expected.active);
  checkBucket(check, 'pending', res.summary.pending, truth.expected.pending);
  checkBucket(check, 'closed', res.summary.closed, truth.expected.closed);
  check.eq('excluded.count', res.summary.excluded.count, truth.expected.excluded.count);

  /* --- Sale-to-list ratio, net of concessions --- */
  console.log('');
  const gotR = res.summary.closed.ratio;
  const wantR = truth.expected.closed.ratio;
  if (check.ok('closed sales carry a sale/list ratio', !!gotR)) {
    check.eq('ratio.count', gotR.count, wantR.count);
    check.eq('ratio.low', pct(gotR.low), pct(wantR.low));
    check.eq('ratio.high', pct(gotR.high), pct(wantR.high));
    check.eq('ratio.median', pct(gotR.median), pct(wantR.median));
  }

  /* --- Market time, the days-on-market source --- */
  console.log('');
  check.ok('the MT column was found', !!res.marketTimeCol, 'no MT column bound');
  if (res.marketTimeCol) {
    check.eq('every MT cell read', res.marketTimeCol.read, LISTINGS.length);
    check.eq('no MT cell refused', res.marketTimeCol.unreadable, 0);
    check.eq('no MT cell blank', res.marketTimeCol.blank, 0);
  }
  const wrongMt = [];
  for (const want of LISTINGS) {
    const got = byN.get(want.n);
    if (got && got.marketTime !== want.mt) {
      wrongMt.push(`row ${want.n}: ${got.marketTime} ≠ ${want.mt}`);
    }
  }
  check.ok(`all ${n} market times read correctly`, !wrongMt.length, wrongMt.slice(0, 6).join('; '));

  checkMarketTime(check, 'active', res.summary.active.marketTime, truth.expected.active.marketTime);
  checkMarketTime(check, 'pending', res.summary.pending.marketTime, truth.expected.pending.marketTime);
  checkMarketTime(check, 'closed', res.summary.closed.marketTime, truth.expected.closed.marketTime);
  check.eq('no active row is missing a market time',
    res.summary.active.marketTime.missing, 0);

  /* --- The form fields --- */
  console.log('');
  const field = (label) => (res.fields.find(f => f.label === label) || {});
  check.eq('Active Listings', field('Active Listings').value, String(truth.expected.active.count));
  check.eq('Median Days on Market',
    field('Median Days on Market').value, String(truth.expected.active.marketTime.median));
  check.eq('Lowest List Price is a bare number',
    field('Lowest List Price').value, String(truth.expected.active.low));
  check.eq('Median List Price is a bare number',
    field('Median List Price').value, String(truth.expected.active.median));
  check.eq('Highest List Price is a bare number',
    field('Highest List Price').value, String(truth.expected.active.high));
  check.eq('Sales in Lookback Period', field('Sales in Lookback Period').value,
    String(truth.expected.closed.count));
  check.eq('Median Sale Price is the SOLD median, bare',
    field('Median Sale Price').value, String(truth.expected.closed.median));
  check.eq('Pending Sales', field('Pending Sales').value, String(truth.expected.pending.count));
  check.ok('the two boxes the grid cannot answer are not on the panel',
    !res.fields.some(f => f.label === 'Lookback Period' ||
                          f.label === 'Distressed Market Competition'));
  check.ok('no copied price carries a $ or a comma',
    res.fields.filter(f => f.value !== null).every(f => /^[0-9]+$/.test(f.value)),
    JSON.stringify(res.fields.filter(f => f.value !== null && !/^[0-9]+$/.test(f.value))));
  check.ok('a complete reading copies without a caveat',
    !/PROVISIONAL/.test(res.uadOutput), res.uadOutput.split('\n')[0]);

  /* --- Completeness guard --- */
  const errors = res.warnings.filter(w => w.level === 'error');
  check.ok('no completeness errors raised', errors.length === 0, errors.map(w => w.text).join(' | '));
  if (res.indexCol) {
    check.ok('row-number check found no gaps', res.indexCol.missing.length === 0,
      `missing ${res.indexCol.missing.join(', ')}`);
  }

  console.log('\n--- status clusters ---');
  for (const c of res.clusters) console.log(`  ${c.code || 'UNREADABLE'} ×${c.n} (${c.score.toFixed(3)})`);
  console.log('\n--- form fields ---');
  console.log(res.uadOutput.split('\n').map(l => '  ' + l).join('\n'));
  console.log('\n--- report text ---');
  console.log(res.textOutput.split('\n').map(l => '  ' + l).join('\n'));

  const passed = check.done();
  if (!passed) {
    console.log('\n--- page log tail ---');
    res.logs.slice(-70).forEach(l => console.log(l));
  }
  console.log('====================================\n');
  process.exit(passed ? 0 : 1);
})();
