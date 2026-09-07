/*
 * Regenerates src/assets.js from the PNGs in assets/.
 *
 * The reference glyph images are inlined as data URIs rather than loaded from
 * disk. A page opened straight from file:// taints its canvas the moment it
 * draws a file:// image, and getImageData() then throws — so an app that
 * loaded these normally would only work behind a web server or with
 * --allow-file-access-from-files. Inlining is what lets a user double-click
 * index.html.
 *
 *   node tests/build-assets.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = {
  REFERENCE_DIGITS: 'assets/reference-digits.png',
  DOLLAR_REF_1: 'assets/dollar-ref1.png',
  DOLLAR_REF_2: 'assets/dollar-ref2.png',
};

const header =
`/* ===== UAD 3.6 Helper — Embedded Reference Glyph Assets ============== */
/* The canonical connectMLS digit strip and two dollar-sign crops, copied  */
/* from MLS-Extract and inlined as data URIs.                             */
/*                                                                        */
/* Inlining is deliberate: a page opened straight from file:// taints its  */
/* canvas when it draws a file:// image, and getImageData() then throws.   */
/* Data URIs are same-origin everywhere, so the app runs by double-        */
/* clicking index.html with no server and no browser flags.               */
/*                                                                        */
/* Regenerate with: node tests/build-assets.js                            */
/* ===================================================================== */

const ASSETS = {
`;

let body = '';
for (const [key, rel] of Object.entries(FILES)) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  body += `  ${key}: 'data:image/png;base64,${buf.toString('base64')}',\n`;
}

const out = path.join(ROOT, 'src', 'assets.js');
fs.writeFileSync(out, header + body + '};\n');
console.log(`Wrote ${out} (${fs.statSync(out).size} bytes from ${Object.keys(FILES).length} images)`);
