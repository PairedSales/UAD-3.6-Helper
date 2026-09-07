/*
 * The reference search: 37 rows of a connectMLS residential grid for Dolton,
 * IL, transcribed from the screenshot this project was built against.
 *
 * Ground truth for every test lives here and nowhere else, so a fixture and
 * the numbers it is checked against can never drift apart.
 */

/* mls, stat, streetNo, street, sfx, mt, closed, sold, conc, orig, list,
 * rms, asf, yr, beds, full, half, type, gar */
const ROWS = [
  ['12741305', 'NEW',  '14448', 'Van Buren',         'Street', 4,   '', null,   null,  189900, 189900, 7, 1062, 1972, '3', 2, 0, 'Split Level',  '2'],
  ['12593242', 'PCHG', '15340', 'Harper',            'Avenue', 44,  '', null,   null,  199000, 189900, 7, 1056, 1970, '3', 1, 1, '2 Stories',    '2'],
  ['12694549', 'ACTV', '14820', 'Cottage Grove',     'Avenue', 66,  '', null,   null,  211150, 201150, 7, 3000, 1975, '4', 1, 1, '1.5 Story',    '2'],
  ['12699534', 'ACTV', '15041', 'Irving',            'Avenue', 60,  '', null,   null,  215000, 205000, 8, 1244, 1965, '3+1', 2, 1, '2 Stories',    '2'],
  ['12522195', 'ACTV', '14316', 'Dante',             'Avenue', 288, '', null,   null,  240000, 220000, 6, 5312, 1970, '3', 2, 0, 'Split Level',  '2'],
  ['12695123', 'ACTV', '14340', 'Ingleside',         'Avenue', 58,  '', null,   null,  249900, 244900, 7, 1223, 1961, '3', 2, 0, 'Split Level',  '2'],
  ['12652682', 'ACTV', '15622', 'Madison',           'Avenue', 101, '', null,   null,  275000, 250000, 7, 1150, 1976, '3', 2, 0, 'Split Level',  '2'],
  ['12646685', 'ACTV', '15339', 'Blackstone',        'Avenue', 116, '', null,   null,  259900, 250000, 8, 1640, 1973, '3', 2, 0, 'Split Level',  '2'],
  ['12662597', 'ACTV', '15206', 'Blackstone',        'Avenue', 189, '', null,   null,  259000, 259000, 7, 1381, 1968, '3', 2, 0, '1.5 Story',    '2'],
  ['12723349', 'ACTV', '14844', 'Cottage Grove',     'Avenue', 34,  '', null,   null,  275000, 260000, 7, 1917, 1962, '3', 2, 0, 'Split Level',  '1'],
  ['12715596', 'ACTV', '14201', 'Maryland',          'Avenue', 193, '', null,   null,  269900, 269900, 8, 2059, 1973, '4', 2, 0, '1.5 Story',    '2'],
  ['12545410', 'TEMP', '14640', 'Martin Luther King', 'Drive', 224, '', null,   null,  206500, 198500, 8, 1651, 1963, '4', 2, 0, 'Other',        '2'],
  ['12658627', 'TEMP', '14516', 'Harper',            'Avenue', 403, '', null,   null,  229500, 229500, 7, 1400, 1978, '3', 1, 1, 'Split Level',  '2'],
  ['12693407', 'FIN',  '15635', 'Minerva',           'Avenue', 238, '', null,   null,  299000, 224900, 7, 1329, 1964, '3', 2, 0, 'Split Level',  '2'],
  ['12738141', 'A/I',  '14446', 'Dante',             'Avenue', 17,  '', null,   null,  249900, 249900, 7, 1458, 1967, '3', 1, 1, 'Split Level',  '2'],
  ['12650118', 'PEND', '14544', 'Woodlawn',          'Avenue', 85,  '', null,   null,  198000, 188000, 6, 1240, 1970, '3', 2, 0, 'Split Level',  '2'],

  ['12571527', 'CLSD', '14817', 'Wentworth',  'Avenue', 4,   '04/02/2026', 180000, 5000,  174900, 174900, 7, 1270, 1979, '3', 2, 0, 'Split Level',  '2'],
  ['12374771', 'CLSD', '1420',  '146th',      'Street', 44,  '10/01/2025', 180000, 5000,  195000, 180000, 3, 1066, 1969, '3', 2, 0, '2 Stories',    '2'],
  ['12522236', 'CLSD', '14920', 'Wentworth',  'Avenue', 221, '08/07/2026', 181000, 5425,  239900, 187900, 6, 1223, 1972, '3', 1, 1, 'Raised Ranch', '2'],
  ['12752072', 'CLSD', '14504', 'Harper',     'Avenue', 1,   '09/04/2026', 185400, 5562,  185400, 185400, 7, 1432, 1969, '3', 1, 1, 'Split Level',  '2'],
  ['12678976', 'CLSD', '15705', 'Madison',    'Avenue', 193, '07/30/2026', 186000, 6000,  175900, 175900, 7, 1350, 1975, '3', 2, 0, 'Split Level',  '2'],
  ['12447138', 'CLSD', '14425', 'Sanderson',  'Avenue', 188, '10/10/2025', 199000, null,  199000, 199000, 7, 1500, 1975, '3', 2, 0, 'Split Level',  '2'],
  ['12500165', 'CLSD', '15037', 'Irving',     'Avenue', 132, '01/09/2026', 204900, 6147,  204900, 204900, 7, 1357, 1968, '3', 1, 1, 'Split Level',  '2'],
  ['12742430', 'CLSD', '14643', 'Dante',      'Avenue', 102, '08/27/2026', 210000, 8400,  210000, 210000, 6, 1700, 1962, '3', 1, 1, 'Split Level',  '2'],
  ['12590975', 'CLSD', '14521', 'Kenwood',    'Avenue', 5,   '05/12/2026', 215000, 6000,  215000, 215000, 7, 1249, 1962, '3', 2, 1, 'Split Level',  '2'],
  ['12386837', 'CLSD', '15240', 'Woodlawn',   'Avenue', 118, '12/31/2025', 217000, 1500,  269000, 217000, 7, 1150, 1978, '3', 2, 0, '2 Stories',    '2'],
  ['12476442', 'CLSD', '14409', 'Kimbark',    'Avenue', 205, '12/01/2025', 225000, 1200,  217500, 217500, 7, 1825, 1960, '3', 1, 1, 'Split Level',  '2'],
  ['12646154', 'CLSD', '14223', 'University', 'Avenue', 201, '07/02/2026', 232000, 6960,  224900, 224900, 5, 1109, 1960, '3', 2, 0, 'Split Level',  '2'],
  ['12479222', 'CLSD', '15709', 'Maryland',   'Avenue', 88,  '11/07/2025', 235000, 7000,  229000, 229000, 7, 1281, 1972, '3', 2, 0, 'Split Level',  '2'],
  ['12627111', 'CLSD', '15333', 'Dante',      'Avenue', 41,  '06/26/2026', 245000, 7350,  249000, 244000, 7, 1250, 1970, '3', 2, 0, '2 Stories',    '2'],
  ['12359892', 'CLSD', '14328', 'Dorchester', 'Avenue', 68,  '09/10/2025', 246000, 7000,  244900, 239900, 7, 1200, 1962, '3', 2, 0, 'Split Level',  '2'],
  ['12651339', 'CLSD', '505',   '146th',      'Street', 157, '07/27/2026', 248000, null,  260000, 260000, 7, 1177, 1977, '3', 2, 0, 'Split Level',  '2'],
  ['12583983', 'CLSD', '14927', 'Cottage Grove', 'Avenue', 37, '05/28/2026', 250000, 10000, 250000, 250000, 7, 1095, 1970, '3', 2, 0, 'Split Level', '2'],
  ['12447136', 'CLSD', '14519', 'Kenwood',    'Avenue', 46,  '10/29/2025', 251000, 7470,  259000, 249000, 7, 1206, 1961, '3', 2, 0, 'Split Level',  '2'],
  ['12673055', 'CLSD', '15631', 'East End',   'Avenue', 49,  '07/08/2026', 260000, null,  269900, 269900, 7, 1300, 1972, '3', 2, 0, 'Split Level',  '2.5'],
  ['12598468', 'CLSD', '515',   '146',        'Street', 75,  '04/29/2026', 260000, null,  254900, 254900, 8, 1572, 1977, '4', 2, 0, 'Split Level',  '2'],
  ['12668507', 'CLSD', '14237', 'Minerva',    'Avenue', 8,   '07/10/2026', 269000, 8070,  269000, 269000, 7, 1600, 1961, '3', 2, 0, 'Split Level',  '2'],
];

const FIELDS = ['mls', 'stat', 'streetNo', 'street', 'sfx', 'mt', 'closed', 'sold',
  'conc', 'orig', 'list', 'rms', 'asf', 'yr', 'beds', 'full', 'half', 'type', 'gar'];

const LISTINGS = ROWS.map((r, i) => {
  const o = { n: i + 1 };
  FIELDS.forEach((f, j) => { o[f] = r[j]; });
  return o;
});

/* Status → bucket, matching src/vocab.js defaults. */
const DEFAULT_BUCKET = {
  NEW: 'active', PCHG: 'active', ACTV: 'active',
  FIN: 'pending', 'A/I': 'pending', PEND: 'pending',
  CLSD: 'closed',
  TEMP: 'excluded',
};

/** Unrounded median, for ratios. */
function medianRaw(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median with the same even-count rule as src/stats.js. */
function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Expected summary for a set of listings under a status→bucket mapping.
 * Closed rows are summarized on the sold price; everything else on list.
 */
function expectedSummary(listings, mapping) {
  const map = mapping || DEFAULT_BUCKET;
  const out = {};
  for (const bucket of ['active', 'pending', 'closed', 'excluded']) {
    const rows = listings.filter(l => (map[l.stat] || 'excluded') === bucket);
    const prices = rows
      .map(l => (bucket === 'closed' ? (l.sold != null ? l.sold : l.list) : l.list))
      .filter(p => typeof p === 'number' && p > 0);
    /* (sold - concessions) / original list price, for closed sales only. */
    const ratios = bucket !== 'closed' ? [] : rows
      .filter(l => l.sold > 0 && l.orig > 0)
      .map(l => (l.sold - (l.conc || 0)) / l.orig);

    out[bucket] = {
      count: rows.length,
      low: prices.length ? Math.min(...prices) : null,
      high: prices.length ? Math.max(...prices) : null,
      median: median(prices),
      ratio: ratios.length ? {
        count: ratios.length,
        low: Math.min(...ratios),
        high: Math.max(...ratios),
        median: medianRaw(ratios),
      } : null,
    };
  }
  return out;
}

module.exports = { LISTINGS, FIELDS, DEFAULT_BUCKET, expectedSummary, median, medianRaw };
