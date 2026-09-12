/*
 * A CoreLogic Matrix search: the 48 visible rows of a Cedar Rapids Area
 * Association of Realtors results grid (Marion / Cedar Rapids, "RES 1000-1800
 * sqft"), transcribed from the screenshot this profile was built against.
 *
 * Matrix differs from connectMLS in every way the recognizer cares about:
 *
 *   - the status is ONE letter (S, A, P), not a four-letter MRED code;
 *   - days on market is headed "DOM", not "MT";
 *   - the MLS number has seven digits and is an underlined link;
 *   - the grid is drawn in Verdana at regular weight, header included;
 *   - this layout carries Sold Price and Orig Price but NO current list price.
 *
 * That last one is data, not a rendering detail: the active and pending rows
 * of this screenshot have no price the app is allowed to use. Ground truth
 * therefore has `list: null` on every row, and the fixture built from it must
 * come out with the active and pending prices missing — never filled in from
 * Orig Price.
 */

/* mls, st, subty, area, city, address, soldDate, dom, sold, orig, style, yr, br, baths */
const ROWS = [
  ['2508889', 'S', 'SFM', 'MAR', 'Marion', '505 S 22nd St',         '09/12/2025', null, 285300, 285300, '',            2002, 4, '3.1'],
  ['2508927', 'S', 'SFM', 'MAR', 'Marion', '2200 50th St',          '01/21/2026', 47,   292000, 300000, 'RANCH',       2002, 5, '3.0'],
  ['2507927', 'S', 'SFM', 'MAR', 'Marion', '255 Partridge Ave',     '10/03/2025', 0,    335000, 335000, 'RANCH',       1993, 3, '3.0'],
  ['2506864', 'S', 'SFM', 'MAR', 'Marion', '2810 Bullis Dr',        '10/14/2025', 1,    347500, 347500, 'RANCH',       2005, 4, '3.0'],
  ['2502808', 'S', 'SFM', 'NE',  'Cedar Rapids', '5951 Shiloh LN NE', '10/03/2025', 151, 280000, 350000, 'CONTEMP, SI', 1979, 4, '2.0'],
  ['2507651', 'S', 'SFM', 'NE',  'Cedar Rapids', '4307 Viola St NE',  '10/24/2025', 0,   379000, 379000, 'RANCH',       2005, 4, '3.0'],
  ['2604553', 'S', 'SFM', 'MAR', 'Marion', '2405 Bridlewood Ct',    '08/19/2026', 2,    408000, 399900, 'RANCH',       2013, 5, '3.0'],
  ['2508790', 'S', 'SFM', 'MAR', 'Marion', '3155 Stanley Cup Dr',   '12/05/2025', 1,    400000, 409900, 'RANCH',       2005, 4, '3.0'],
  ['2601995', 'S', 'SFM', 'MAR', 'Marion', '3454 Penny Ln',         '05/13/2026', 12,   415000, 415000, 'RANCH',       2009, 3, '2.0'],
  ['2508168', 'S', 'SFM', 'MAR', 'Marion', '770 Oak Park CIR',      '11/24/2025', 36,   405000, 419900, 'RANCH',       2010, 4, '3.0'],
  ['2604344', 'S', 'SFM', 'MAR', 'Marion', '982 Raleigh Ln',        '08/27/2026', 2,    425000, 425000, 'RANCH',       2013, 4, '3.0'],
  ['2508102', 'S', 'SFM', 'NE',  'Cedar Rapids', '4301 Viola St NE',  '01/09/2026', 63,  419000, 429400, 'RANCH',       2010, 4, '3.0'],
  ['2603149', 'S', 'SFM', 'MAR', 'Marion', '3215 Stanley Cup Dr',   '08/05/2026', 39,   422000, 429999, 'RANCH',       2008, 5, '3.0'],
  ['2602731', 'S', 'SFM', 'MAR', 'Marion', '733 Raleigh Ln',        '06/25/2026', 2,    452000, 438000, 'RANCH',       2017, 5, '3.0'],
  ['2506622', 'S', 'SFM', 'MAR', 'Marion', '2750 Burns Dr',         '07/31/2026', 318,  444135, 439900, 'RANCH',       2025, 4, '3.0'],
  ['2604046', 'S', 'SFM', 'MAR', 'Marion', '3118 Carlisle CIR',     '08/05/2026', 13,   435000, 439900, 'RANCH',       2011, 5, '3.1'],
  ['2605253', 'P', 'SFM', 'MAR', 'Marion', '1364 Lindenbrook Ln',   '',           12,   null,   440000, 'RANCH',       2008, 4, '3.0'],
  ['2601419', 'S', 'SFM', 'MAR', 'Marion', '677 Raleigh Ln',        '05/15/2026', 28,   429000, 445000, 'RANCH',       2013, 4, '3.0'],
  ['2408252', 'S', 'CON/', 'MAR', 'Marion', '1596 Connection Ave',  '10/31/2025', 294,  410000, 448900, 'RANCH',       2024, 4, '3.0'],
  ['2606262', 'A', 'SFM', 'MAR', 'Marion', '272 Barrington Ct',     '',           8,    null,   449900, 'RANCH',       2007, 4, '3.0'],
  ['2601211', 'S', 'SFM', 'MAR', 'Marion', '3965 Peridot Dr',       '07/10/2026', 91,   425000, 460000, 'RANCH',       2019, 3, '3.0'],
  ['2408616', 'A', 'SFM', 'MAR', 'Marion', '3263 Platinum Way',     '',           619,  null,   460000, 'RANCH',       2022, 5, '3.0'],
  ['2600825', 'S', 'SFM', 'MAR', 'Marion', '3113 Carlisle CIR',     '05/19/2026', 32,   437500, 465000, 'RANCH',       2012, 4, '3.0'],
  ['2600955', 'S', 'SFM', 'NE',  'Cedar Rapids', '804 Palmyra Dr NE', '04/10/2026', 10,  468000, 469990, 'RANCH',       2009, 5, '3.0'],
  ['2507220', 'S', 'SFM', 'MAR', 'Marion', '657 Oak Park CIR',      '10/03/2025', 20,   460000, 470000, 'RANCH',       2013, 5, '3.0'],
  ['2604679', 'S', 'SFM', 'MAR', 'Marion', '1202 Cedar Springs Dr', '08/21/2026', 8,    460000, 475000, 'RANCH',       2018, 4, '3.0'],
  ['2603492', 'S', 'SFM', 'NE',  'Cedar Rapids', '4140 Elkhorn Dr',   '07/31/2026', 48,  465000, 479000, 'RANCH',       1982, 3, '3.0'],
  ['2602749', 'S', 'CON/', 'MAR', 'Marion', '3223 Silver Oak TRL',  '07/31/2026', 0,    485000, 485000, 'RANCH',       2019, 3, '3.0'],
  ['2604506', 'A', 'SFM', 'MAR', 'Marion', '1426 Echo Ridge Ln',    '',           79,   null,   485000, 'RANCH',       2026, 5, '3.0'],
  ['2604304', 'P', 'SFM', 'MAR', 'Marion', '1735 Cottage Ridge Dr', '',           68,   null,   485000, 'RANCH',       2020, 3, '3.0'],
  ['2603804', 'S', 'SFM', 'MAR', 'Marion', '1422 Echo Ridge Ln',    '07/31/2026', 12,   477000, 485900, 'RANCH',       2026, 5, '3.0'],
  ['2601788', 'S', 'SFM', 'MAR', 'Marion', '2770 Burns Dr',         '06/01/2026', 24,   485900, 489900, 'RANCH',       2025, 5, '3.0'],
  ['2606203', 'A', 'SFM', 'NE',  'Cedar Rapids', '716 Tiburan Lane NE', '',        8,    null,   490000, 'RANCH',       2017, 4, '3.0'],
  ['2605934', 'A', 'SFM', 'MAR', 'Marion', '1410 Echo Ridge Ln',    '',           23,   null,   495000, 'RANCH',       2026, 5, '3.0'],
  ['2604078', 'S', 'SFM', 'NE',  'Cedar Rapids', '718 Palmyra Dr NE', '07/31/2026', 2,   508000, 498900, 'RANCH',       2007, 4, '3.0'],
  ['2602747', 'S', 'SFM', 'MAR', 'Marion', '1558 Settlers Dr',      '06/05/2026', 2,    509000, 509810, 'RANCH',       2018, 4, '3.0'],
  ['2601117', 'S', 'SFM', 'MAR', 'Marion', '1024 Kettering Rd',     '06/05/2026', 43,   509900, 509900, 'RANCH',       2025, 4, '3.0'],
  ['2509189', 'S', 'SFM', 'MAR', 'Marion', '1399 Echo Ridge Ln',    '02/27/2026', 80,   505000, 509900, 'RANCH',       2025, 5, '3.0'],
  ['2600870', 'A', 'SFM', 'MAR', 'Marion', '1359 Cedar Springs Dr', '',           219,  null,   514900, 'RANCH',       2026, 5, '3.0'],
  ['2509022', 'S', 'SFM', 'MAR', 'Marion', '1284 Hickory Ridge Dr', '01/23/2026', 46,   510000, 525000, 'RANCH',       2023, 5, '3.0'],
  ['2601964', 'S', 'SFM', 'MAR', 'Marion', '1269 Tramore Rd',       '06/11/2026', 41,   505000, 525000, 'RANCH',       2020, 5, '3.0'],
  ['2605581', 'A', 'SFM', 'MAR', 'Marion', '3170 Stanley Cup Dr',   '',           37,   null,   525000, 'RANCH',       2017, 4, '3.0'],
  ['2508669', 'S', 'SFM', 'MAR', 'Marion', '1335 Cedar Springs Dr', '02/20/2026', 85,   500000, 527000, 'RANCH',       2021, 5, '3.0'],
  ['2601504', 'S', 'SFM', 'MAR', 'Marion', '1297 Hickory Ridge Dr', '04/03/2026', 1,    527500, 527500, 'RANCH',       2026, 5, '3.0'],
  ['2605379', 'A', 'SFM', 'MAR', 'Marion', '1986 Royal Oak Ridge R', '',          46,   null,   540000, 'RANCH',       2026, 5, '3.0'],
  ['2603518', 'A', 'SFM', 'MAR', 'Marion', '829 Longbow Ct',        '',           117,  null,   541000, 'RANCH',       2026, 4, '3.0'],
  ['2600182', 'S', 'SFM', 'MAR', 'Marion', '1052 Tramore Ct',       '01/29/2026', 3,    559000, 559000, 'RANCH',       2019, 5, '3.0'],
  ['2504506', 'S', 'SFM', 'MAR', 'Marion', '2682 Burr Oak Ct',      '11/21/2025', 31,   562820, 560000, 'RANCH',       2025, 5, '3.0'],
];

const FIELDS = ['mls', 'stat', 'subty', 'area', 'city', 'address', 'soldDate', 'mt', 'sold',
  'orig', 'style', 'yr', 'br', 'baths'];

/* `conc: null` — this layout has no concessions column, so every ratio is
 * sold ÷ original list price, exactly as the app computes it with no CONC. */
const MATRIX_LISTINGS = ROWS.map((r, i) => {
  const o = { n: i + 1, list: null, conc: null };
  FIELDS.forEach((f, j) => { o[f] = r[j]; });
  return o;
});

/* Matrix status letter → bucket, matching src/vocab.js defaults. */
const MATRIX_BUCKET = { A: 'active', P: 'pending', S: 'closed' };

module.exports = { MATRIX_LISTINGS, MATRIX_BUCKET };
