/*
 * Shared puppeteer harness.
 *
 * Same approach as MLS-Extract's tests: launch a real browser, load index.html
 * from disk, hand the page an image, and read the app's own output back. That
 * exercises the canvas pipeline exactly as a user's paste would, rather than
 * testing a node-side reimplementation of it.
 *
 * Each image gets a FRESH page so nothing — cached fonts, a picked font
 * family, a template bank — carries from one fixture to the next.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = `file://${path.join(ROOT, 'index.html').replace(/\\/g, '/')}`;
const FIXTURES = path.join(__dirname, 'fixtures');

async function launch() {
  return puppeteer.launch({
    args: ['--allow-file-access-from-files', '--disable-web-security', '--font-render-hinting=none'],
  });
}

/**
 * Run one fixture through the app.
 * Returns { report, rows, roles, warnings, logs }.
 */
async function analyze(browser, pngPath, opts = {}) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push(`PAGEERROR ${e.message}`));

  await page.goto(INDEX, { waitUntil: 'networkidle0' });

  const b64 = fs.readFileSync(pngPath).toString('base64');
  await page.evaluate(async (data) => {
    const res = await fetch(`data:image/png;base64,${data}`);
    const blob = await res.blob();
    window.UAD.handleImageFile(new File([blob], 'fixture.png', { type: 'image/png' }));
  }, b64);

  await page.waitForFunction(
    () => window.UAD.getReport() !== null ||
          document.querySelector('#status-area').className.includes('status--error'),
    { timeout: 120000 }
  );

  if (opts.mapping) {
    await page.evaluate(m => window.UAD.setMapping(m), opts.mapping);
  }

  const out = await page.evaluate(() => {
    const report = window.UAD.getReport();
    const result = window.UAD.getResult();
    const plain = s => s && ({
      count: s.count, priced: s.priced, missing: s.missing,
      low: s.low, high: s.high, median: s.median,
      ratio: s.ratio ? {
        count: s.ratio.count, low: s.ratio.low, high: s.ratio.high, median: s.ratio.median,
      } : null,
    });
    return {
      ok: !!report,
      status: document.querySelector('#status-area').textContent,
      summary: report ? {
        active: plain(report.summary.active),
        pending: plain(report.summary.pending),
        closed: plain(report.summary.closed),
        excluded: plain(report.summary.excluded),
      } : null,
      unresolved: report ? report.unresolved.length : 0,
      provisional: report ? report.provisional : null,
      balanced: report ? report.balanced : null,
      rows: window.UAD.getRows().map(r => ({
        n: r.n, index: r.index, mls: r.mls, status: r.status,
        listPrice: r.listPrice, origPrice: r.origPrice,
        soldPrice: r.soldPrice, concessions: r.concessions,
        statusScore: r.statusScore,
      })),
      roles: result ? {
        method: result.roles.method,
        confidence: result.roles.confidence,
        notes: result.roles.notes,
        hasList: !!result.roles.list,
        hasOrig: !!result.roles.orig,
        hasSold: !!result.roles.sold,
        hasConc: !!result.roles.conc,
        problems: result.roles.problems,
      } : null,
      header: result ? !!result.header : false,
      statusColumn: result && result.statusCol ? {
        cells: result.statusCol.cells.length,
        font: result.statusCol.font,
        resolvedFrac: result.statusCol.resolvedFrac,
      } : null,
      clusters: result ? (result.statusClusters || []).map(c => ({
        code: c.code, n: c.members.length, score: c.score,
      })) : [],
      warnings: result ? result.warnings : [],
      skipped: result ? result.skipped : null,
      indexCol: result && result.indexCol
        ? { first: result.indexCol.first, last: result.indexCol.last, missing: result.indexCol.missing }
        : null,
      textOutput: window.UAD.outputFor('text'),
    };
  });

  await page.close();
  return { ...out, logs };
}

/** Load the ground truth emitted next to a fixture PNG. */
function truthFor(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
}

function fixturePath(name) {
  return path.join(FIXTURES, `${name}.png`);
}

/* ---- Tiny assertion helpers, so every test reports the same way ---- */

function makeChecker(label) {
  const failures = [];
  let checks = 0;

  const eq = (what, got, want) => {
    checks++;
    const ok = got === want;
    if (!ok) failures.push(`${what}: got ${fmt(got)}, expected ${fmt(want)}`);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}: ${fmt(got)}${ok ? '' : ` (expected ${fmt(want)})`}`);
    return ok;
  };

  const ok = (what, condition, detail) => {
    checks++;
    if (!condition) failures.push(`${what}${detail ? `: ${detail}` : ''}`);
    console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${what}${detail && !condition ? ` — ${detail}` : ''}`);
    return condition;
  };

  const done = () => {
    console.log(`\n${label}: ${checks - failures.length}/${checks} checks passed`);
    if (failures.length) {
      console.log('FAILURES:');
      for (const f of failures) console.log(`  • ${f}`);
    }
    return failures.length === 0;
  };

  return { eq, ok, done, failures };
}

function fmt(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

/** Compare one bucket summary against ground truth. */
function checkBucket(check, name, got, want) {
  check.eq(`${name}.count`, got.count, want.count);
  check.eq(`${name}.low`, got.low, want.low);
  check.eq(`${name}.high`, got.high, want.high);
  check.eq(`${name}.median`, got.median, want.median);
}

module.exports = {
  launch, analyze, truthFor, fixturePath, makeChecker, checkBucket, FIXTURES, INDEX, ROOT,
};
