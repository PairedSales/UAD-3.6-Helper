/*
 * The fixtures that are not the happy path.
 *
 * Most of these are IDEMPOTENCE tests: a highlighted row, a greyscale paste and
 * a different UI font change how the grid looks but not what it says, so the
 * buckets must come back byte-identical to the reference. That catches whole
 * classes of failure without anyone having to predict how they would break.
 *
 * The rest check that the app degrades in the right direction: when a column
 * is missing it must say so, not quietly summarize the wrong one.
 */

const { launch, analyze, truthFor, fixturePath, makeChecker, checkBucket } = require('./harness.js');

const pct = v => (v == null ? '—' : (v * 100).toFixed(3) + '%');

/** Buckets must match the fixture's own ground truth exactly. */
function expectExact(check, res, truth, label) {
  checkBucket(check, `${label}.active`, res.summary.active, truth.expected.active);
  checkBucket(check, `${label}.pending`, res.summary.pending, truth.expected.pending);
  checkBucket(check, `${label}.closed`, res.summary.closed, truth.expected.closed);
  check.eq(`${label}.excluded.count`, res.summary.excluded.count, truth.expected.excluded.count);
}

const CASES = [
  {
    name: 'grid-no-header',
    title: 'Header row cropped off — columns must be inferred from the data',
    run(check, res, truth) {
      check.ok('no header was claimed', res.header === false);
      check.ok('sold column still identified', res.roles.hasSold,
        `method was ${res.roles.method}`);
      check.eq('the sold column came from the fill pattern', res.roles.methodBy.sold, 'fill-pattern');
      check.eq('the list column came from column order', res.roles.methodBy.list, 'position');
      check.ok('confidence reflects the weaker of the two', res.roles.confidence < 0.8,
        String(res.roles.confidence));
      check.ok('a low-confidence warning was raised',
        res.warnings.some(w => w.level === 'warn' && /header/i.test(w.text)));
      expectExact(check, res, truth, 'no-header');
    },
  },
  {
    name: 'grid-no-closed',
    title: 'A search with no closed sales — no sold column may be bound',
    run(check, res, truth) {
      check.eq('closed.count', res.summary.closed.count, 0);
      check.eq('closed.median', res.summary.closed.median, null);
      check.ok('no sold column was bound to another money column',
        !res.roles.hasSold || res.summary.closed.count > 0);
      expectExact(check, res, truth, 'no-closed');
    },
  },
  {
    name: 'grid-all-closed',
    title: 'A search with nothing but closed sales',
    run(check, res, truth) {
      check.eq('active.count', res.summary.active.count, 0);
      check.eq('pending.count', res.summary.pending.count, 0);
      check.eq('active.median', res.summary.active.median, null);
      expectExact(check, res, truth, 'all-closed');
      const r = res.summary.closed.ratio, w = truth.expected.closed.ratio;
      check.eq('ratio.median', pct(r && r.median), pct(w && w.median));
    },
  },
  {
    name: 'grid-selected',
    title: 'One row highlighted by the user’s click — must not change any bucket',
    run(check, res, truth) {
      expectExact(check, res, truth, 'selected');
      check.eq('unreadable statuses', res.unresolved, 0);
    },
  },
  {
    name: 'grid-grayscale',
    title: 'A greyscale paste — clustering must fall back to shape alone',
    run(check, res, truth) {
      expectExact(check, res, truth, 'grayscale');
      check.eq('unreadable statuses', res.unresolved, 0);
    },
  },
  {
    name: 'grid-verdana',
    title: 'A different UI font — the font must be detected, not assumed',
    run(check, res, truth) {
      expectExact(check, res, truth, 'verdana');
      check.eq('unreadable statuses', res.unresolved, 0);
      check.ok('a font was chosen', !!(res.statusColumn && res.statusColumn.font),
        JSON.stringify(res.statusColumn));
    },
  },
  {
    name: 'grid-narrow',
    title: 'A narrow crop: row #, MLS #, Stat, Sold Pr and List Price only',
    run(check, res, truth) {
      check.ok('status column found', !!res.statusColumn);
      check.ok('list price column found', res.roles.hasList);
      check.ok('sold price column found', res.roles.hasSold);
      check.ok('no original list price column', !res.roles.hasOrig);
      check.ok('the missing ratio is reported',
        res.warnings.some(w => /Orig List Pr/.test(w.text)));
      check.eq('no ratio is produced', res.summary.closed.ratio, null);
      expectExact(check, res, truth, 'narrow');
    },
  },
  {
    name: 'grid-blank-stat',
    title: 'One row’s Stat cell is unreadable — the listing must survive as unreadable',
    run(check, res, truth) {
      /* The regression this fixture exists for: the row used to be deleted
       * outright. The summary then reported 20 closed sales with a median
       * $4,000 low, called itself complete, printed a green "no rows were
       * dropped", and enabled the copy button. */
      check.eq('the row is still in the table', res.rows.length, 37);
      check.eq('its status is unreadable, not guessed', res.unresolved, 1);
      check.ok('the summary is marked provisional', res.provisional === true);
      check.ok('no green “no rows were dropped” claim',
        !res.warnings.some(w => w.level === 'ok' && /no rows were dropped/.test(w.text)),
        JSON.stringify(res.warnings.filter(w => w.level === 'ok')));
      check.ok('the unreadable status is reported',
        res.warnings.some(w => /status/i.test(w.text) && w.level !== 'info'));
      check.ok('the copied text carries the caveat',
        /PROVISIONAL/.test(res.textOutput), res.textOutput.split('\n')[0]);

      /* The other 36 rows are still summarized correctly. */
      expectExact(check, res, truth, 'blank-stat');
    },
  },
  {
    name: 'grid-hidpi',
    title: 'A 2× Retina screenshot — every pixel threshold must rescale',
    run(check, res, truth) {
      expectExact(check, res, truth, 'hidpi');
      check.eq('unreadable statuses', res.unresolved, 0);
      check.ok('rows read', res.rows.length === 37, `read ${res.rows.length}`);
    },
  },
  {
    name: 'grid-clipped-top',
    title: 'The screenshot cuts through the first row — it must not be counted',
    run(check, res, truth) {
      check.eq('rows read', res.rows.length, 36);
      check.ok('the clipped row is reported',
        res.warnings.some(w => /cut off|clipped/i.test(w.text)) ||
        (res.indexCol && res.indexCol.first === 2),
        JSON.stringify(res.indexCol));
      expectExact(check, res, truth, 'clipped-top');
    },
  },
  {
    name: 'grid-clipped-bottom',
    title: 'The screenshot cuts through the last row — it must not be counted',
    run(check, res, truth) {
      check.eq('rows read', res.rows.length, 36);
      check.ok('the clipped row is reported',
        res.warnings.some(w => /cut off|clipped/i.test(w.text)) ||
        (res.indexCol && res.indexCol.last === 36),
        JSON.stringify(res.indexCol));
      expectExact(check, res, truth, 'clipped-bottom');
    },
  },
  {
    name: 'grid-wide-range',
    title: 'Prices in the millions and under $100k',
    run(check, res, truth) {
      expectExact(check, res, truth, 'wide-range');
      const all = res.rows.flatMap(r => [r.listPrice, r.origPrice, r.soldPrice])
        .filter(v => typeof v === 'number');
      check.ok('no price landed below $20,000',
        all.every(v => v >= 20000), `min was ${Math.min(...all)}`);
      check.ok('no price landed above $20,000,000',
        all.every(v => v <= 20000000), `max was ${Math.max(...all)}`);
    },
  },
];

(async () => {
  console.log('\n========== EDGE CASES ==========');
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

  console.log(`\n${CASES.length - failures.length}/${CASES.length} edge cases passed`);
  if (failures.length) console.log(`FAILED: ${failures.join(', ')}`);
  console.log('================================\n');
  process.exit(failures.length ? 1 : 0);
})();
