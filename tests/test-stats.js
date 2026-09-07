/*
 * Arithmetic tests, run without a browser.
 *
 * src/config.js, src/vocab.js and src/stats.js are plain scripts that share
 * globals, so they are evaluated together in one VM context — the same way the
 * page loads them. That keeps the statistics under test as the very code that
 * ships, rather than a node-flavoured copy of it.
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');
const context = vm.createContext({ console, module: {}, Math, JSON });
for (const f of ['config.js', 'vocab.js', 'stats.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), context, { filename: f });
}
const S = context;

const failures = [];
let checks = 0;

function eq(what, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures.push(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}` +
    (ok ? '' : ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`));
}

function row(n, status, over) {
  return Object.assign({ n, status, listPrice: null, origPrice: null, soldPrice: null, concessions: null }, over);
}

console.log('\n========== STATISTICS ==========\n');

/* ---- median ---- */
console.log('median');
eq('odd count takes the middle', S.median([3, 1, 2]), 2);
eq('even count averages the middle pair', S.median([1, 2, 3, 4]), 2.5);
eq('empty set is null, never 0', S.median([]), null);
eq('price median rounds to whole dollars', S.medianPrice([100001, 100002]), 100002);
eq('formatPrice on null', S.formatPrice(null), '—');
eq('formatPrice groups thousands', S.formatPrice(1234567), '$1,234,567');

/* ---- sale-to-list ratio ---- */
console.log('\nsale-to-list ratio');
eq('three decimals, as an appraiser quotes it', S.formatRatio(0.98859), '98.859%');
eq('null ratio renders as a dash', S.formatRatio(null), '—');
eq('concessions are subtracted from the sold price',
  S.saleToListRatio({ soldPrice: 245000, concessions: 7350, origPrice: 249000 }),
  (245000 - 7350) / 249000);
eq('a blank concessions cell counts as zero',
  S.saleToListRatio({ soldPrice: 199000, concessions: null, origPrice: 199000 }), 1);
eq('no original list price means no ratio',
  S.saleToListRatio({ soldPrice: 199000, concessions: 0, origPrice: null }), null);
eq('the CURRENT list price is not substituted for the original',
  S.saleToListRatio({ soldPrice: 199000, listPrice: 190000, origPrice: null }), null);
eq('no sold price means no ratio',
  S.saleToListRatio({ soldPrice: null, origPrice: 199000 }), null);
eq('concessions above the sale price is a misread, not a negative ratio',
  S.saleToListRatio({ soldPrice: 200000, concessions: 250000, origPrice: 210000 }), null);

/* ---- bucketing ---- */
console.log('\nbucketing');
eq('a lease is not a settled sale', S.bucketForStatus('RNTD', S.defaultStatusMapping()), 'excluded');
eq('CLSD is closed', S.bucketForStatus('CLSD', S.defaultStatusMapping()), 'closed');
eq('kick-out hours fold onto the base code',
  S.bucketForStatus('HS72', S.defaultStatusMapping()), 'pending');
eq('a private-network code folds onto its base',
  S.bucketForStatus('PRIV-PEND', S.defaultStatusMapping()), 'pending');
eq('an unknown code is unclassified, not silently excluded',
  S.bucketForStatus('ZZZZ', S.defaultStatusMapping()), 'unclassified');

/* ---- the report ---- */
console.log('\nreport');
{
  const rows = [
    row(1, 'ACTV', { listPrice: 200000 }),
    row(2, 'PCHG', { listPrice: 300000 }),
    row(3, 'PEND', { listPrice: 250000 }),
    row(4, 'CLSD', { listPrice: 260000, origPrice: 275000, soldPrice: 250000, concessions: 5000 }),
    row(5, 'CLSD', { listPrice: 240000, origPrice: 240000, soldPrice: 240000 }),
    row(6, 'CANC', { listPrice: 999999 }),
  ];
  const r = S.buildReport(rows, S.defaultStatusMapping());

  eq('active count', r.summary.active.count, 2);
  eq('active median', r.summary.active.median, 250000);
  eq('TEMP is an active listing', S.bucketForStatus('TEMP', S.defaultStatusMapping()), 'active');
  eq('pending count', r.summary.pending.count, 1);
  eq('closed count', r.summary.closed.count, 2);
  eq('closed uses the sold price, not the list price', r.summary.closed.high, 250000);
  eq('a cancelled listing is excluded from every reported bucket', r.summary.excluded.count, 1);
  eq('row accounting balances', r.balanced, true);
  eq('a complete reading is not provisional', r.provisional, false);
  eq('closed ratio median',
    r.summary.closed.ratio.median, ((250000 - 5000) / 275000 + 1) / 2);
}

/* ---- the failure this app exists to prevent ---- */
console.log('\nno cross-source price fallback');
{
  const rows = [
    row(1, 'CLSD', { listPrice: 500000, origPrice: 500000, soldPrice: null }),
    row(2, 'CLSD', { listPrice: 200000, origPrice: 200000, soldPrice: 200000 }),
  ];
  const r = S.buildReport(rows, S.defaultStatusMapping());
  eq('the unpriced closed sale is still counted', r.summary.closed.count, 2);
  eq('…but contributes nothing to the statistics', r.summary.closed.priced, 1);
  eq('…and is reported as missing', r.summary.closed.missing, 1);
  eq('the asking price never enters the sold median', r.summary.closed.median, 200000);
  eq('the asking price never becomes the high', r.summary.closed.high, 200000);
}

console.log('\nprovisional gating');
{
  const many = [];
  for (let i = 1; i <= 20; i++) many.push(row(i, 'ACTV', { listPrice: 100000 + i }));
  many.push(row(21, null));
  many.push(row(22, null));
  many.push(row(23, null));
  const r = S.buildReport(many, S.defaultStatusMapping());
  eq('3 unreadable rows out of 23 is over the bar', r.provisional, true);
  eq('unreadable rows are listed, not dropped', r.unresolved.length, 3);

  const small = [row(1, 'ACTV', { listPrice: 100000 }), row(2, null)];
  eq('on a small grid, one unreadable row is enough',
    S.buildReport(small, S.defaultStatusMapping()).provisional, true);

  const clean = [row(1, 'ACTV', { listPrice: 100000 }), row(2, 'CLSD', { soldPrice: 90000, origPrice: 95000 })];
  eq('a clean small grid is not provisional',
    S.buildReport(clean, S.defaultStatusMapping()).provisional, false);
}

console.log('\noutput');
{
  const rows = [
    row(1, 'ACTV', { listPrice: 200000 }),
    row(2, 'CLSD', { origPrice: 275000, soldPrice: 250000, concessions: 5000 }),
  ];
  const r = S.buildReport(rows, S.defaultStatusMapping());
  const text = S.reportAsText(r);
  eq('the report names the ratio', /Sale\/list ratio/.test(text), true);
  eq('the report states the median rule', /two middle values/.test(text), true);
  const tsv = S.reportAsTsv(r);
  eq('the spreadsheet output discloses the priced count',
    tsv.split('\n')[0], 'Category\tCount\tPriced\tLow\tHigh\tMedian\tRatio Low\tRatio High\tRatio Median');
}

console.log(`\nStatistics: ${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  • ${f}`);
}
console.log('================================\n');
process.exit(failures.length ? 1 : 0);
