/*
 * The export reader, run without a browser.
 *
 * Like test-stats.js, the shipping scripts are evaluated together in one VM
 * context, the way the page loads them, so what is tested is the code that
 * runs.
 *
 * The reference search is checked ROW BY ROW, not just in total, for the same
 * reason test-grid.js is: two errors that cancel out would otherwise pass.
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { LISTINGS, expectedSummary, DEFAULT_BUCKET } = require('./grid-data.js');
const { mredTsv, craarCsv } = require('./table-fixtures.js');

const SRC = path.resolve(__dirname, '..', 'src');
const context = vm.createContext({ console, module: {}, Math, JSON, TextDecoder });
for (const f of ['config.js', 'vocab.js', 'stats.js', 'table.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), context, { filename: f });
}
const T = context;

const failures = [];
let checks = 0;

function eq(what, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures.push(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}` +
    (ok ? '' : ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`));
}

/* Plain objects out of the VM context, so JSON comparison is not fooled by
 * a different realm's Object prototype. */
const plain = v => JSON.parse(JSON.stringify(v));

function read(text, name) {
  const res = T.extractTable(text, name);
  const report = res.failed ? null : T.buildReport(res.rows, T.defaultStatusMapping(), res.review);
  return { res, report };
}

const near = (a, b) => a === b || (a != null && b != null && Math.abs(a - b) < 1e-12);

function expectBuckets(label, report, want) {
  for (const id of ['active', 'pending', 'closed']) {
    const s = report.summary[id], w = want[id];
    eq(`${label}.${id}: count / low / high / median`,
      [s.count, s.low, s.high, s.median], [w.count, w.low, w.high, w.median]);
    eq(`${label}.${id}: median days on market`,
      s.marketTime ? [s.marketTime.count, s.marketTime.median] : null,
      w.marketTime ? [w.marketTime.count, w.marketTime.median] : null);
    if (id === 'closed') {
      checks++;
      const ok = (!s.ratio && !w.ratio) || (s.ratio && w.ratio &&
        s.ratio.count === w.ratio.count && near(s.ratio.low, w.ratio.low) &&
        near(s.ratio.high, w.ratio.high) && near(s.ratio.median, w.ratio.median));
      if (!ok) failures.push(`${label}.closed ratio: got ${JSON.stringify(s.ratio)}, expected ${JSON.stringify(w.ratio)}`);
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}.closed: sale-to-list ratios`);
    }
  }
}

console.log('\n========== EXPORTS (CSV / TSV) ==========\n');

/* ---- splitting ---- */
console.log('splitting records');
{
  const p = T.parseDelimited('a,"b,c","d ""e"" f"\r\n1,"two\nlines",3\n', ',');
  eq('a quoted comma is data', plain(p.records[0].fields), ['a', 'b,c', 'd "e" f']);
  eq('a quoted line break is data, not a new record', p.records.length, 2);
  eq('…and the record after it keeps its own fields', plain(p.records[1].fields), ['1', 'two\nlines', '3']);
  eq('each record knows the line it starts on', p.records.map(r => r.line), [1, 2]);

  const lines = T.parseDelimited('h1,h2\n"x\ny",1\nz,2\n', ',');
  eq('a record after a multi-line field starts on the right line', lines.records[2].line, 4);

  eq('a trailing newline is not an extra record', T.parseDelimited('a,b\n1,2\n', ',').records.length, 2);
  eq('blank lines are not records', T.parseDelimited('a,b\n\n\n1,2', ',').records.length, 2);

  const tsv = T.parseDelimited('Lot\tNote\n85\'x138"\tFinished, Rec Room\n', '\t');
  eq('in a TSV, a quote mid-field and a comma are both ordinary characters',
    plain(tsv.records[1].fields), ['85\'x138"', 'Finished, Rec Room']);

  const open = T.parseDelimited('a,b\n"never closed,1\n2,3\n', ',');
  eq('an unterminated quote is an error for the whole file', /never closed/.test(open.error || ''), true);

  eq('a stray character after a closing quote marks the record',
    T.parseDelimited('"abc"d,e\n', ',').records[0].stray, true);
}

console.log('\nthe delimiter comes from the header line');
{
  eq('tabs', T.sniffDelimiter('MLS #\tStat\tList Price\n1\t2\t3'), '\t');
  eq('commas', T.sniffDelimiter('"MLS#","Status"\n'), ',');
  eq('a comma inside a quoted TSV header does not win',
    T.sniffDelimiter('"Beds, Total"\tStat\tMLS #\n'), '\t');
  eq('a .csv that is really tab-separated is read on tabs',
    T.sniffDelimiter('MLS #\tStat\tList Price', 'export.csv'), '\t');
}

console.log('\ndecoding');
{
  const enc = s => Uint8Array.from(Buffer.from(s, 'utf8'));
  const bom = Uint8Array.from([0xEF, 0xBB, 0xBF, ...enc('Stat,MLS #')]);
  eq('a UTF-8 byte-order mark is removed', T.decodeTableBytes(bom).text, 'Stat,MLS #');
  const le = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('Stat\tMLS #', 'utf16le')]);
  eq('UTF-16 with a BOM decodes', T.decodeTableBytes(Uint8Array.from(le)).text, 'Stat\tMLS #');
  const cp1252 = Uint8Array.from([0x43, 0x61, 0x66, 0xE9]);       /* "Café" in Windows-1252 */
  eq('bytes that are not UTF-8 fall back to Windows-1252', T.decodeTableBytes(cp1252).text, 'Café');
}

/* ---- cells ---- */
console.log('\nreading a money cell');
{
  const money = (s, role) => plain(T.parseTableMoney(s, role || 'sold'));
  eq('dollar sign and thousands separators', money('$647,839'), { value: 647839 });
  eq('a bare number', money('310000'), { value: 310000 });
  eq('trailing cents on a price', money('$425,000.00'), { value: 425000 });
  eq('a blank cell is blank', money('  '), { blank: true });
  eq('a zero price is no price — some MLSs write $0 on an unsold listing', money('$0'), { blank: true });
  eq('concessions keep their cents', money('9978.71', 'conc'), { value: 9978.71 });
  eq('a zero concession is a real zero', money('0', 'conc'), { value: 0 });
  eq('bad comma grouping is refused, not read as 123456', !!money('1,23,456').error, true);
  eq('a letter O is not a zero', !!money('42O,000').error, true);
  eq('a negative amount is refused', !!money('-5000').error, true);
  eq('a price below the floor is refused', !!money('$500').error, true);
  eq('a price above the ceiling is refused', !!money('$45,000,000').error, true);
  eq('a range is not an amount', !!money('$400,000-$450,000').error, true);
}

console.log('\nreading a market-time cell');
{
  const days = s => plain(T.parseTableDays(s));
  eq('whole days', days('57'), { value: 57 });
  eq('zero is a real answer', days('0'), { value: 0 });
  eq('blank', days(''), { blank: true });
  eq('a fraction is refused', !!days('3.5').error, true);
  eq('a decade and more is refused', !!days('9999').error, true);
}

console.log('\nstatus text');
{
  eq('carried as the file wrote it', T.tableStatusText(' CLSD '), 'CLSD');
  eq('kick-out hours fold onto the base code, as the screenshot reader does',
    T.tableStatusText('HS48'), 'HS');
  eq('CRAAR S is a closed sale', T.bucketForStatus('S', T.defaultStatusMapping()), 'closed');
  eq('CRAAR A is an active listing', T.bucketForStatus('A', T.defaultStatusMapping()), 'active');
  eq('CRAAR P is a pending sale', T.bucketForStatus('P', T.defaultStatusMapping()), 'pending');
  eq('C is not guessed at — Closed in one MLS, Contingent in another',
    T.bucketForStatus('C', T.defaultStatusMapping()), 'unclassified');
  eq('the screenshot recognizer can never emit a single letter',
    ['S', 'A', 'P'].some(c => vm.runInContext('RECOGNIZED_TOKENS', context).includes(c)), false);
}

/* ---- the header ---- */
console.log('\nbinding columns by their header');
{
  const bind = labels => plain(T.bindTableHeader(labels));
  const roles = labels => {
    const b = bind(labels);
    return Object.fromEntries(Object.entries(b.columns).map(([k, v]) => [k, v.label]));
  };

  eq('connectMLS labels', roles(['MLS #', 'Stat', 'MT', 'Sold Pr', 'CONC', 'Orig List Pr', 'List Price']),
    { status: 'Stat', mls: 'MLS #', list: 'List Price', orig: 'Orig List Pr', sold: 'Sold Pr',
      conc: 'CONC', mt: 'MT' });
  eq('another MLS’s labels for the same things',
    roles(['', 'MLS#', 'Status', 'DOM', 'Close Price', 'Original List Price', 'Current Price']),
    { status: 'Status', mls: 'MLS#', list: 'Current Price', orig: 'Original List Price',
      sold: 'Close Price', mt: 'DOM' });
  eq('CDOM is not market time', roles(['Stat', 'CDOM', 'List Price']).mt, undefined);
  eq('SP:OLP is not a price', Object.keys(roles(['Stat', 'SP:OLP'])), ['status']);

  const two = bind(['Stat', 'List Price', 'Current Price', 'Sold Pr']);
  eq('two columns claiming the list price bind neither', two.columns.list, undefined);
  eq('…and the ambiguity is named', two.ambiguous, [{ role: 'list', labels: ['List Price', 'Current Price'] }]);
}

/* ---- the reference search, both ways ---- */
console.log('\nthe reference search as a connectMLS TSV');
{
  const { res, report } = read(mredTsv(), 'grid.tsv');
  eq('it is read', res.failed, false);
  eq('tab-separated', res.delimiter, 'tab');
  eq('one row per listing', res.rows.length, LISTINGS.length);

  let rowFailures = 0;
  LISTINGS.forEach((l, i) => {
    const r = res.rows[i];
    const got = [r.mls, r.status, r.listPrice, r.origPrice, r.soldPrice, r.concessions, r.marketTime];
    const want = [l.mls, l.stat, l.list, l.orig, l.sold, l.conc, l.mt];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      rowFailures++;
      eq(`row ${l.n}`, got, want);
    }
  });
  eq('every row, field by field, matches the reference', rowFailures, 0);

  expectBuckets('tsv', report, expectedSummary(LISTINGS, DEFAULT_BUCKET));
  eq('a complete export is not provisional', report.provisional, false);
  eq('and says no rows were dropped', res.warnings.some(w => w.level === 'ok'), true);
  eq('no problems were reported', res.warnings.filter(w => w.level === 'error' || w.level === 'warn').length, 0);
}

console.log('\nthe same search as a CRAAR-style CSV');
{
  /* No concessions column, so the reference is the same search with none. */
  const noConc = LISTINGS.map(l => Object.assign({}, l, { conc: null }));
  const want = expectedSummary(noConc, DEFAULT_BUCKET);

  const { res, report } = read(craarCsv(), 'Custom.csv');
  eq('it is read', res.failed, false);
  eq('comma-separated', res.delimiter, 'comma');
  eq('quoted commas and quotes did not shift a column', res.skipped.malformed, 0);
  eq('prices with "$" and commas are read exactly',
    res.rows.map(r => r.soldPrice), LISTINGS.map(l => l.sold));
  expectBuckets('csv', report, want);
  eq('a missing concessions column is disclosed',
    res.warnings.some(w => /no concessions/.test(w.text)), true);

  const letters = read(craarCsv(null, { letters: true }), 'Custom.csv');
  eq('S / A / P codes give the same buckets', plain(letters.report.summary.closed.count), want.closed.count);
  expectBuckets('csv-letters', letters.report, want);
  eq('the file’s own codes are what the table shows',
    Array.from(new Set(letters.res.rows.map(r => r.status))).sort(), ['A', 'P', 'S']);
}

console.log('\nthe screenshot and the export agree');
{
  const truth = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'grid.json'), 'utf8'));
  const { report } = read(mredTsv(), 'grid.tsv');
  for (const id of ['active', 'pending', 'closed']) {
    const s = report.summary[id], w = truth.expected[id];
    eq(`${id}: the TSV gives the grid fixture’s numbers`,
      [s.count, s.low, s.high, s.median], [w.count, w.low, w.high, w.median]);
  }
}

/* ---- market time: blank is blank ---- */
console.log('\na blank DOM in an export');
{
  const rows = LISTINGS.map(l => Object.assign({}, l));
  rows.find(l => l.stat === 'CLSD').mt = null;         /* a sale entered with no marketing period */
  const closedBlank = read(mredTsv(rows), 'grid.tsv');
  eq('the closed median discloses it rests on a subset',
    closedBlank.report.summary.closed.marketTime.missing, 1);
  eq('but a known-blank closed DOM does not block the form, which never takes it',
    closedBlank.report.provisional, false);
  eq('and the reason text says it for the report',
    /of 21 rows carried a market time/.test(T.reportAsText(closedBlank.report)), true);

  const activeRows = LISTINGS.map(l => Object.assign({}, l));
  activeRows.find(l => l.stat === 'ACTV').mt = null;
  const activeBlank = read(mredTsv(activeRows), 'grid.tsv');
  eq('a blank DOM on an ACTIVE listing still blocks — that median IS a form field',
    activeBlank.report.provisional, true);
  eq('…by name', activeBlank.report.provisionalReasons.some(r => /active row\(s\) have no market time/.test(r)), true);

  /* The screenshot path is unchanged: there a blank might be a lost glyph. */
  const imageLike = T.buildReport(closedBlank.res.rows, T.defaultStatusMapping(),
    { hasMarketTime: true });
  eq('a screenshot reading with the same hole still blocks', imageLike.provisional, true);
}

/* ---- what the reader refuses ---- */
console.log('\nrefusals');
{
  const header = 'MLS #\tStat\tMT\tSold Pr\tCONC\tOrig List Pr\tList Price';
  const good = '12000001\tCLSD\t10\t250000\t5000\t260000\t260000';

  const shifted = read([header, good, '12000002\tCLSD\t10\t250000\t260000\t260000', good.replace('01', '03')].join('\n'), 'x.tsv');
  eq('a record with a missing field is kept, not dropped', shifted.res.rows.length, 3);
  eq('…with none of its values used', [shifted.res.rows[1].status, shifted.res.rows[1].soldPrice], [null, null]);
  eq('…counted by name', shifted.res.skipped.malformed, 1);
  eq('…so it is unresolved and blocks copying',
    [shifted.report.unresolved.length, shifted.report.provisional], [1, true]);
  eq('…and the line is named', shifted.res.warnings.some(w => w.level === 'error' && /line 3/.test(w.text)), true);

  const trailing = read([header + '\t', good + '\t', good.replace('01', '02') + '\t'].join('\n'), 'x.tsv');
  eq('a trailing delimiter on every line moves nothing', trailing.res.skipped.malformed, 0);
  eq('…and is not provisional', trailing.report.provisional, false);

  const badConc = read([header, good, '12000002\tCLSD\t10\t250000\t5,00O\t260000\t260000'].join('\n'), 'x.tsv');
  eq('an unreadable concession is left empty, not guessed', badConc.res.rows[1].concessions, null);
  eq('…and because empty would read as zero, it is an error that blocks copying',
    [badConc.res.review.errors > 0, badConc.report.provisional], [true, true]);
  eq('…naming the line, the column and the text',
    badConc.res.warnings.some(w => /line 3, CONC "5,00O"/.test(w.text)), true);

  const blankStat = read([header, good, '12000002\t\t10\t250000\t\t260000\t260000'].join('\n'), 'x.tsv');
  eq('a blank status keeps its row', blankStat.res.rows.length, 2);
  eq('…unresolved, not bucketed', blankStat.report.unresolved.length, 1);

  const empty = read([header, good, '\t\t\t\t\t\t', good.replace('01', '02')].join('\n'), 'x.tsv');
  eq('a record with every field empty is not a listing', empty.res.rows.length, 2);
  eq('…and is counted', empty.res.skipped.notAListing, 1);
  eq('…and the green tick does not appear', empty.res.warnings.some(w => w.level === 'ok'), false);

  const dupe = read([header, good, good].join('\n'), 'x.tsv');
  eq('a duplicate MLS number is flagged', dupe.res.warnings.some(w => /more than once/.test(w.text)), true);

  const ambiguous = read(['Stat\tList Price\tCurrent Price', 'ACTV\t200000\t210000'].join('\n'), 'x.tsv');
  eq('an ambiguous list price is not used', ambiguous.res.rows[0].listPrice, null);
  eq('…and blocks copying', ambiguous.report.provisional, true);

  const noStat = read(['MLS #\tList Price', '12000001\t200000'].join('\n'), 'x.tsv');
  eq('no status column: the row is still listed', noStat.res.rows.length, 1);
  eq('…and reported', noStat.res.warnings.some(w => w.level === 'error' && /no "Stat"/.test(w.text)), true);
  eq('…and blocks copying', noStat.report.provisional, true);

  const junk = T.extractTable('name,email\nJo,jo@example.com\n', 'contacts.csv');
  eq('a CSV that is not an MLS export fails, and says what it expected',
    [junk.failed, /does not look like an MLS export/.test(junk.warnings[0].text)], [true, true]);

  const preamble = read(['Search results — 2 listings', header, good, good.replace('01', '02')].join('\n'), 'x.tsv');
  eq('a line above the header is skipped', preamble.res.skipped.aboveHeader, 1);
  eq('…and the rows below it are read', preamble.res.rows.length, 2);

  const unknown = read([header, good, '12000002\tZZZ\t10\t\t\t260000\t260000'].join('\n'), 'x.tsv');
  eq('an unknown code is carried as written', unknown.res.rows[1].status, 'ZZZ');
  eq('…and is unclassified, which blocks copying',
    [unknown.report.summary.unclassified.count, unknown.report.provisional], [1, true]);
}

console.log('\nrecognizing a pasted table');
{
  eq('spreadsheet cells with a header', T.looksLikeTable('MLS #\tStat\tList Price\n1\tACTV\t200000\n'), true);
  eq('a single typed number is not a table', T.looksLikeTable('425000'), false);
  eq('an unrelated table is not an export', T.looksLikeTable('a\tb\n1\t2\n'), false);
}

console.log(`\nExports: ${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  • ${f}`);
}
console.log('=========================================\n');
process.exit(failures.length ? 1 : 0);
