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

/* analyseNumericMarks is the one piece of price.js that needs no canvas: it
 * reads glyph positions only. Pulled in on its own so the decimal-versus-comma
 * rule can be tested here, in the fast loop, rather than only through a
 * browser and a rendered fixture. */
vm.runInContext(
  fs.readFileSync(path.join(SRC, 'price.js'), 'utf8')
    .match(/function analyseNumericMarks[\s\S]*?\r?\n}\r?\n/)[0],
  context, { filename: 'price.js#analyseNumericMarks' });

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
  return Object.assign({ n, status, listPrice: null, origPrice: null, soldPrice: null,
    concessions: null, marketTime: null }, over);
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

/* ---- market time and the days-on-market figure ---- */
console.log('\nmarket time');
{
  eq('median days rounds to whole days', S.medianDays([10, 11]), 11);
  eq('an empty set has no median, not zero', S.medianDays([]), null);
  eq('a day count formats without a currency symbol', S.formatDays(403), '403');
  eq('no market time renders as a dash', S.formatDays(null), '—');
  eq('zero days is a real answer, not a blank', S.formatDays(0), '0');

  const rows = [
    row(1, 'ACTV', { listPrice: 200000, marketTime: 10 }),
    row(2, 'ACTV', { listPrice: 210000, marketTime: 0 }),
    row(3, 'ACTV', { listPrice: 220000, marketTime: 100 }),
    row(4, 'CLSD', { listPrice: 240000, origPrice: 240000, soldPrice: 240000, marketTime: 44 }),
  ];
  const r = S.buildReport(rows, S.defaultStatusMapping(), { hasMarketTime: true });
  eq('a listing entered today is in the median, not filtered out as falsy',
    r.summary.active.marketTime.count, 3);
  eq('median market time', r.summary.active.marketTime.median, 10);
  eq('low market time', r.summary.active.marketTime.low, 0);
  eq('high market time', r.summary.active.marketTime.high, 100);
  eq('closed sales carry their own market time', r.summary.closed.marketTime.median, 44);
  eq('a complete market time is not a reason to withhold the reading',
    r.provisional, false);
}

console.log('\nan incomplete market time blocks copying');
{
  const rows = [
    row(1, 'ACTV', { listPrice: 200000, marketTime: 10 }),
    row(2, 'ACTV', { listPrice: 210000, marketTime: null }),
  ];
  /* With an MT column present, a blank cell means the median rests on a subset
   * of the bucket it claims to summarize — the same failure as an unpriced
   * row, and gated the same way. */
  const gated = S.buildReport(rows, S.defaultStatusMapping(), { hasMarketTime: true });
  eq('the median discloses what it rests on', gated.summary.active.marketTime.count, 1);
  eq('…and what it does not', gated.summary.active.marketTime.missing, 1);
  eq('a subset median is provisional', gated.provisional, true);
  eq('and says so by name',
    gated.provisionalReasons.some(x => /active row\(s\) have no market time/.test(x)), true);

  /* With NO MT column at all the field simply reads "—": a gap the appraiser
   * can see is not a reason to withhold the prices, which were read fine. */
  const noColumn = S.buildReport(
    [row(1, 'ACTV', { listPrice: 200000 })], S.defaultStatusMapping(), {});
  eq('no MT column is not a provisional reason', noColumn.provisional, false);
  eq('and produces no median', noColumn.summary.active.marketTime, null);
}

/* ---- the form fields ---- */
console.log('\nUAD 3.6 form fields');
{
  const rows = [
    row(1, 'ACTV', { listPrice: 200000, marketTime: 10 }),
    row(2, 'ACTV', { listPrice: 300000, marketTime: 30 }),
    row(3, 'ACTV', { listPrice: 250000, marketTime: 20 }),
    row(4, 'PEND', { listPrice: 240000, marketTime: 15 }),
    row(5, 'CLSD', { listPrice: 260000, origPrice: 275000, soldPrice: 250000, marketTime: 44 }),
    row(6, 'CLSD', { listPrice: 240000, origPrice: 240000, soldPrice: 230000, marketTime: 60 }),
    row(7, 'SS', { listPrice: 190000, marketTime: 90 }),
  ];
  const r = S.buildReport(rows, S.defaultStatusMapping(), { hasMarketTime: true });
  const fields = S.uadFields(r);
  const get = (label) => fields.find(f => f.label === label);

  eq('the fields are the form’s, in the form’s order',
    fields.map(f => f.label),
    ['Active Listings', 'Median Days on Market', 'Lowest List Price', 'Median List Price',
     'Highest List Price', 'Sales in Lookback Period', 'Lowest Sale Price',
     'Median Sale Price', 'Highest Sale Price', 'Pending Sales']);

  eq('Active Listings counts the active bucket', get('Active Listings').value, '3');
  eq('Median Days on Market is the ACTIVE listings’ median',
    get('Median Days on Market').value, '20');
  eq('Lowest List Price is the bare number the field takes',
    get('Lowest List Price').value, '200000');
  eq('…and the screen still shows it as money',
    get('Lowest List Price').display, '$200,000');
  eq('Median Sale Price is the SOLD median', get('Median Sale Price').value, '240000');
  eq('Sales in Lookback Period counts the closed bucket',
    get('Sales in Lookback Period').value, '2');
  eq('Pending Sales counts pending, and a short sale is pending',
    get('Pending Sales').value, '2');
  eq('every value on the clipboard is bare digits',
    fields.filter(f => f.value !== null).every(f => /^[0-9]+$/.test(f.value)), true);

  eq('the lookback period is not on the panel — the grid does not carry it',
    get('Lookback Period'), undefined);
  eq('nor is the distress question, which is a judgement',
    get('Distressed Market Competition'), undefined);
  eq('every field on the panel was read off the grid',
    fields.every(f => f.sourced === undefined), true);

  const text = S.uadFieldsAsText(r);
  eq('the text block names the section', /UAD 3.6 — Search Result Metrics/.test(text), true);
  eq('the text block quotes the same days on market', /Median Days on Market \.+ 20 days/.test(text), true);
  eq('the text block quotes the same bare price', /Lowest List Price \.+ 200000/.test(text), true);
  eq('a complete reading carries no caveat', /PROVISIONAL/.test(text), false);
}

console.log('\nthe form fields cannot escape the provisional banner');
{
  const rows = [
    row(1, 'ACTV', { listPrice: 200000, marketTime: 10 }),
    row(2, null, { listPrice: 300000, marketTime: 30 }),
  ];
  const r = S.buildReport(rows, S.defaultStatusMapping(), { hasMarketTime: true });
  eq('an unreadable status is still provisional', r.provisional, true);
  const text = S.uadFieldsAsText(r);
  eq('so the copied field block says so on its first line',
    text.split('\n')[0], '*** PROVISIONAL — do not use without checking: ***');
  eq('and lists why', /no readable status/.test(text), true);
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

console.log('\ndecimal point versus thousands separator');
{
  /* Build a token the way finishToken does: tall glyphs on a 10px pitch, with
   * the short marks sitting between them. Only the x positions matter. */
  const token = (digits, markAfter) => ({
    tall: Array.from({ length: digits }, (_, i) => ({ x: i * 10 })),
    commas: markAfter.map(n => ({ x: (digits - n) * 10 - 5 })),
  });
  const marks = (digits, markAfter) => S.analyseNumericMarks(token(digits, markAfter));

  eq('no marks at all', marks(5, []), { commas: 0, fraction: 0 });
  eq('254,900 is one thousands separator', marks(6, [3]), { commas: 1, fraction: 0 });
  eq('1,234,567 is two', marks(7, [3, 6]), { commas: 2, fraction: 0 });

  /* The regression: six digits and one mark. Read as a comma the grouping
   * "checks out" and 9978.71 becomes 997,871 — a hundredfold concession. */
  eq('9978.71 is a decimal point, not a comma', marks(6, [2]), { commas: 0, fraction: 2 });
  eq('one decimal place is a decimal place', marks(5, [1]), { commas: 0, fraction: 1 });
  eq('1,234.56 is both', marks(6, [2, 5]), { commas: 1, fraction: 2 });
  eq('a mark on no boundary at all is rejected', marks(6, [4]), null);
  eq('two decimal points are rejected', marks(6, [1, 2]), null);

  eq('the integer part is what the value keeps',
    S.formatPrice(9978.71), '$9,979');
}

console.log('\nper-comp ratios on a small closed set');
{
  const closed = (n, over) => row(n, 'CLSD', Object.assign(
    { origPrice: 200000, soldPrice: 190000, concessions: 0, mls: '1200000' + n }, over));
  const pcts = (summary) => S.compLines(summary).map(l => {
    const m = l.match(/([\d.]+)%/);
    return m ? m[1] + '%' : '—';
  });

  const six = S.buildReport([1, 2, 3, 4, 5, 6].map(n => closed(n)), S.defaultStatusMapping());
  const sixText = S.reportAsText(six);
  eq('six sales are quoted one by one', (sixText.match(/^ +Comp \d+:/gm) || []).length, 6);
  eq('Comp 1 carries the first sale’s ratio', /^ +Comp 1:\s+95\.000%/m.test(sixText), true);
  eq('the aggregate line is still there', /Sale\/list ratio/.test(sixText), true);

  const many = n => S.buildReport(
    Array.from({ length: n }, (_, i) => closed(i + 1)), S.defaultStatusMapping());
  eq('ten is inside the line', (S.reportAsText(many(10)).match(/^ +Comp /gm) || []).length, 10);
  eq('eleven is past it — median only',
    (S.reportAsText(many(11)).match(/^ +Comp /gm) || []).length, 0);

  /* Order is grid order, so Comp N ties back to the row on the screenshot. */
  const varied = S.buildReport([
    closed(1, { soldPrice: 250000, origPrice: 250000 }),
    closed(2, { soldPrice: 180000, origPrice: 200000 }),
    closed(3, { soldPrice: 210000, origPrice: 200000 }),
  ], S.defaultStatusMapping());
  eq('comps are listed in grid order, not sorted by ratio',
    pcts(varied.summary.closed), ['100.000%', '90.000%', '105.000%']);

  /* A sale with no original list price still gets a numbered line — a comp
   * missing from a numbered list reads as a comp that did not exist. */
  const gap = S.buildReport(
    [closed(1), closed(2, { origPrice: null }), closed(3)], S.defaultStatusMapping());
  const gapLines = S.compLines(gap.summary.closed);
  eq('every closed sale gets a line, ratio or not', gapLines.length, 3);
  eq('the one without an original list price says so',
    /Comp 2:\s+—\s+\(no original list price\)/.test(gapLines[1]), true);

  const conc = S.buildReport(
    [closed(1, { soldPrice: 200000, concessions: 6000, origPrice: 200000 })],
    S.defaultStatusMapping());
  eq('the per-comp ratio is net of concessions', pcts(conc.summary.closed), ['97.000%']);

  eq('no closed sales means no comp list',
    S.compLines(S.buildReport([row(1, 'ACTV', { listPrice: 100000 })],
      S.defaultStatusMapping()).summary.closed).length, 0);
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
    tsv.split('\n')[0], 'Category\tCount\tPriced\tLow\tHigh\tMedian\tMedian DOM\tDOM Rows\tRatio Low\tRatio High\tRatio Median');
}

console.log(`\nStatistics: ${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  • ${f}`);
}
console.log('================================\n');
process.exit(failures.length ? 1 : 0);
