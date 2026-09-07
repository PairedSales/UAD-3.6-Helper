/*
 * Regenerate every fixture, then run every suite in order of how quickly it
 * tells you something useful: arithmetic first (no browser), then the
 * reference grid, then the awkward cases.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['Fixtures',   'make-grid-fixture.js', ['--all']],
  ['Statistics', 'test-stats.js',        []],
  ['Reference',  'test-grid.js',         []],
  ['Edge cases', 'test-edge-cases.js',   []],
];

const results = [];
for (const [label, file, args] of SUITES) {
  console.log(`\n\n>>> ${label} (${file})`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], {
    stdio: 'inherit',
  });
  results.push({ label, code: r.status });
  if (r.status !== 0 && label === 'Fixtures') {
    console.error('Fixture generation failed — the rest cannot run.');
    process.exit(1);
  }
}

console.log('\n\n=============== SUMMARY ===============');
for (const r of results) console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.label}`);
const failed = results.filter(r => r.code !== 0);
console.log(`  ${results.length - failed.length}/${results.length} suites passed`);
console.log('=======================================\n');
process.exit(failed.length ? 1 : 0);
