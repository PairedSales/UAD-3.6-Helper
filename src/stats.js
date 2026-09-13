/* ===== UAD 3.6 Helper — Statistics & Formatting ======================= */
/* Bucket the recognized rows and reduce each bucket to count / low / high / */
/* median, plus — for closed sales — the sale-to-list ratio net of seller    */
/* concessions.                                                             */
/*                                                                          */
/* Pure functions: no DOM, no canvas, so the node test harness exercises the */
/* arithmetic directly rather than through a browser.                        */
/* ===================================================================== */

/**
 * Median of a numeric array.
 *
 * Odd counts take the middle value; even counts take the mean of the two
 * middle values. Returns null for an empty set rather than 0 — "no sales" must
 * never render as "$0", which is a convincing wrong answer.
 */
function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median rounded to whole dollars. */
function medianPrice(values) {
  const m = median(values);
  return m === null ? null : Math.round(m);
}

/**
 * Median market time, rounded to whole days.
 *
 * Same even-count rule as every other median here, so a set of an even size
 * can land on a half day; the form's field takes whole days, and half a day of
 * market time is not a distinction any appraisal rests on.
 */
function medianDays(values) {
  const m = median(values);
  return m === null ? null : Math.round(m);
}

/** Format an integer as US currency, no cents. */
function formatPrice(val) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  return '$' + Math.round(val).toLocaleString('en-US');
}

/** Format a day count. Zero is a real answer — "listed today" — so it prints. */
function formatDays(val) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  return Math.round(val).toLocaleString('en-US');
}

/**
 * Format a ratio as a percentage with three decimals — 0.98859 → "98.859%".
 * Three decimals because that is the precision an appraiser quotes a
 * sale-to-list ratio at, and rounding further hides a real spread.
 */
function formatRatio(val) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  return (val * 100).toFixed(3) + '%';
}

/**
 * Sale-to-list ratio for one closed sale, net of seller concessions:
 *
 *     (sold price − concessions) / original list price
 *
 * A blank CONC cell in connectMLS means no concessions were reported, so it is
 * read as zero. A missing ORIGINAL list price means no ratio: the current list
 * price is not a substitute, because a listing that was reduced twice would
 * report a ratio against a number nobody ever offered at.
 */
function saleToListRatio(row) {
  const sold = row.soldPrice;
  const orig = row.origPrice;
  if (!(typeof sold === 'number' && sold > 0)) return null;
  if (!(typeof orig === 'number' && orig > 0)) return null;
  const conc = typeof row.concessions === 'number' && row.concessions > 0 ? row.concessions : 0;
  const net = sold - conc;
  /* Concessions at or above the sale price is not a market outcome, it is a
   * misread — of the concessions, the sold price, or which column is which.
   * Reporting the resulting negative percentage would look like a finding. */
  if (!isFinite(net) || net <= 0) return null;
  return net / orig;
}

/**
 * Summarize one bucket.
 *
 * A row with no usable price is still counted — it is a real listing or sale
 * that appeared in the search — but contributes nothing to low/high/median.
 * `priced` says how many rows the price statistics actually rest on, so the UI
 * can disclose it instead of quietly summarizing a subset.
 */
function summarizeBucket(rows) {
  const prices = rows
    .map(r => r.price)
    .filter(p => typeof p === 'number' && isFinite(p) && p > 0);

  const ratios = rows
    .map(r => r.ratio)
    .filter(p => typeof p === 'number' && isFinite(p) && p > 0);

  /* Market time. A day count of zero is a real value — a listing entered
   * today — so the filter is >= 0, not > 0 the way the price filters are.
   * Reading it as falsy would quietly drop the newest listings out of the
   * median, which is the direction that matters most in an active set. */
  const days = rows
    .map(r => r.marketTime)
    .filter(d => typeof d === 'number' && isFinite(d) && d >= 0);

  return {
    count: rows.length,
    priced: prices.length,
    missing: rows.length - prices.length,
    low: prices.length ? Math.min(...prices) : null,
    high: prices.length ? Math.max(...prices) : null,
    median: medianPrice(prices),
    ratio: ratios.length ? {
      count: ratios.length,
      missing: rows.length - ratios.length,
      low: Math.min(...ratios),
      high: Math.max(...ratios),
      median: median(ratios),
      mean: ratios.reduce((s, v) => s + v, 0) / ratios.length,
    } : null,
    /* `missing` is how many of this bucket's rows the median does NOT rest on.
     * It is disclosed rather than smoothed over: a median days-on-market drawn
     * from nine of thirteen active listings is a different number from the one
     * the form is asking for, and the only honest thing to do is say which. */
    marketTime: days.length ? {
      count: days.length,
      missing: rows.length - days.length,
      low: Math.min(...days),
      high: Math.max(...days),
      median: medianDays(days),
    } : null,
    prices: prices.slice().sort((a, b) => a - b),
    /* Every row of the bucket, in the order it appears in the grid, so a
     * small set can be quoted one by one. Comp 1 is the first such row on the
     * screenshot, which is what lets an appraiser tie a number back to it. */
    items: rows.map((r, i) => ({
      n: i + 1,
      mls: r.mls || null,
      price: typeof r.price === 'number' ? r.price : null,
      ratio: typeof r.ratio === 'number' ? r.ratio : null,
      marketTime: typeof r.marketTime === 'number' ? r.marketTime : null,
    })),
  };
}

/**
 * The price a row contributes.
 *
 * Closed sales are summarized on the SOLD price and active/pending rows on the
 * LIST price, with NO cross-source fallback. A closed sale whose sold price
 * could not be read stays in the count and is reported as unpriced; using its
 * asking price instead would put a systematically high number into a sold
 * median with nothing to distinguish it from a correct one.
 */
function priceForRow(row, bucketId) {
  const want = BUCKET_PRICE_SOURCE[bucketId];
  if (!want) return { price: null, source: null };
  const value = want === 'sold' ? row.soldPrice : row.listPrice;
  if (typeof value === 'number' && value > 0) return { price: value, source: want };
  return { price: null, source: want };
}

/**
 * Turn recognized rows into the full report.
 *
 * `rows` each carry { status, listPrice, origPrice, soldPrice, concessions }.
 * `mapping` is the (possibly user-edited) status → bucket map. Rows whose
 * status could not be read land in `unresolved` and are excluded from every
 * statistic — loudly, never silently.
 */
function buildReport(rows, mapping, review) {
  const map = mapping || defaultStatusMapping();
  const buckets = { active: [], pending: [], closed: [], excluded: [], unclassified: [] };
  const unresolved = [];
  const omitted = [];

  for (const row of rows) {
    if (row.omit) { omitted.push(row); continue; }
    if (!row.status) { unresolved.push(row); continue; }

    const bucketId = bucketForStatus(row.status, map);
    const { price, source } = priceForRow(row, bucketId);
    const ratio = bucketId === 'closed' ? saleToListRatio(row) : null;

    const entry = Object.assign({}, row, {
      bucket: bucketId, price, priceSource: source, ratio,
    });
    (buckets[bucketId] || buckets.unclassified).push(entry);
  }

  const summary = {};
  for (const id of Object.keys(buckets)) summary[id] = summarizeBucket(buckets[id]);

  const counted = buckets.active.length + buckets.pending.length + buckets.closed.length;

  /* Row accounting: every row the recognizer produced must land in exactly one
   * place. Asserted rather than assumed, because a silent leak here is a
   * silently smaller count. */
  const accounted = counted + buckets.excluded.length + buckets.unclassified.length +
                    unresolved.length + omitted.length;

  const unreadableFrac = rows.length ? unresolved.length / rows.length : 0;
  const r = review || {};

  /* Why the reading may not be copied.
   *
   * The gate has to consider everything the pipeline found, not just the
   * statuses it could not read. A summary the app has already flagged with an
   * error — a row missing from the numbering, a rejected sold column, a
   * discarded band — is a summary that must not reach a report unexamined, and
   * every one of those was previously invisible here. */
  const reasons = [];
  /* Any unresolved row at all, not a fraction of them. A listing in no bucket
   * means the counts are incomplete by construction, and one dropdown in the
   * table below fixes it — there is no size of grid on which an uncounted sale
   * is acceptable in a number that goes into an appraisal. */
  if (unresolved.length) {
    reasons.push(`${unresolved.length} of ${rows.length} row(s) have no readable status`);
  }
  if (buckets.unclassified.length) {
    reasons.push(`${buckets.unclassified.length} row(s) carry an unrecognized status code`);
  }
  if (accounted !== rows.length) reasons.push('the row accounting does not balance');
  if (r.errors) reasons.push(`${r.errors} unresolved problem(s) reported above`);
  if (r.droppedRows) reasons.push(`${r.droppedRows} row band(s) could not be read`);
  if (r.roleProblems) reasons.push('a money column could not be identified');
  if (r.noStatusColumn) reasons.push('no status column was found');
  if (typeof r.confidence === 'number' && r.confidence < 0.8) {
    reasons.push('the money columns were inferred, not read from a header');
  }
  for (const id of REPORTED_BUCKETS) {
    if (summary[id].missing > 0) {
      reasons.push(`${summary[id].missing} ${id} row(s) have no readable price`);
    }
  }

  /* A median days on market resting on a subset of its bucket is the same
   * failure as a median price resting on one: a plausible number that is
   * quietly short, and the form has a box for it.
   *
   * This only fires when the grid HAS an MT column. No MT column at all is a
   * gap the appraiser can see — the field reads "—" and the notice says why —
   * and a visible gap is exactly what this app prefers to a filled-in guess.
   * The wording says "no market time" rather than "unreadable" because a cell
   * connectMLS left blank and a cell the recognizer refused both land here,
   * and only one of them is a misread.
   *
   * A CSV or TSV export narrows it to the active bucket. There, a blank cell
   * is known to BE blank — a sale entered after the fact with no marketing
   * period carries no DOM — so the closed and pending medians are disclosed
   * ("44 of 46 rows") rather than gated: nothing is misread, no form field
   * takes them, and gating on them would block a correct reading with nothing
   * the appraiser could type to clear it. The active median is still gated,
   * because it IS a form field, and a bare number has nowhere to carry
   * "12 of 13". A cell the file carried but could not be parsed is an error,
   * and gates through `errors` instead. */
  if (r.hasMarketTime) {
    const gated = r.source === 'file' ? ['active'] : REPORTED_BUCKETS;
    for (const id of gated) {
      const s = summary[id];
      if (!s.count) continue;
      const missing = s.marketTime ? s.marketTime.missing : s.count;
      if (missing > 0) reasons.push(`${missing} ${id} row(s) have no market time`);
    }
  }

  return {
    buckets, summary, unresolved, omitted,
    totalRows: rows.length,
    counted,
    accounted,
    balanced: accounted === rows.length,
    provisional: reasons.length > 0,
    provisionalReasons: reasons,
    unreadableFrac,
  };
}

/* -------------------------------------------------------------------- */
/*  Output formats                                                       */
/* -------------------------------------------------------------------- */

const REPORT_LABEL = { active: 'Active listings', pending: 'Pending sales', closed: 'Closed sales' };

/** Plain-text block for pasting into a narrative report. */
function reportAsText(report) {
  const lines = [];
  /* The caveats travel with the text. Someone who selects and copies this by
   * hand, bypassing the disabled button, still gets them. */
  if (report.provisional) {
    lines.push('*** PROVISIONAL — do not use without checking: ***');
    for (const r of report.provisionalReasons) lines.push(`***   • ${r}`);
    lines.push('');
  }

  for (const id of REPORTED_BUCKETS) {
    const s = report.summary[id];
    if (!s) continue;
    if (s.count === 0) { lines.push(`${REPORT_LABEL[id]}: 0`); continue; }

    lines.push(
      `${REPORT_LABEL[id]}: ${s.count}` +
      `   Low ${formatPrice(s.low)}` +
      `   High ${formatPrice(s.high)}` +
      `   Median ${formatPrice(s.median)}` +
      (s.missing ? `   (${s.priced} of ${s.count} priced)` : '')
    );

    if (s.marketTime) {
      lines.push(
        `   Median days on market: ${formatDays(s.marketTime.median)}` +
        (s.marketTime.missing
          ? `   (${s.marketTime.count} of ${s.count} rows carried a market time)`
          : '')
      );
    }

    if (id === 'closed' && s.ratio) {
      lines.push(
        `   Sale/list ratio, net of concessions: ` +
        `Low ${formatRatio(s.ratio.low)}   High ${formatRatio(s.ratio.high)}   ` +
        `Median ${formatRatio(s.ratio.median)}` +
        (s.ratio.missing ? `   (${s.ratio.count} of ${s.count} with an original list price)` : '')
      );

      for (const line of compLines(s)) lines.push(line);
    }
  }

  if (report.summary.excluded.count) lines.push(`Not counted: ${report.summary.excluded.count}`);
  if (report.summary.unclassified.count) {
    lines.push(`Unrecognized status codes: ${report.summary.unclassified.count}`);
  }
  if (report.unresolved.length) lines.push(`Unreadable status: ${report.unresolved.length}`);
  if (report.omitted.length) lines.push(`Manually excluded: ${report.omitted.length}`);

  lines.push('');
  lines.push('Prices: list price for active and pending, sold price for closed. ' +
             'Median of an even count is the mean of the two middle values. ' +
             'Ratio = (sold − concessions) ÷ original list price.');
  return lines.join('\n');
}

/**
 * The individual sale-to-list ratios, comp by comp.
 *
 * Only for a small set. Past ten sales the list is longer than the analysis it
 * supports and the median is the honest summary; at or below ten the
 * individual ratios are what an appraiser actually reasons from, and a median
 * of six numbers hides more than it tells.
 *
 * Every closed sale gets a line, including one with no ratio — a comp missing
 * from a numbered list would read as a comp that did not exist.
 */
function compLines(summary) {
  if (!summary.ratio) return [];
  if (summary.count === 0 || summary.count > CFG.COMP_LIST_MAX) return [];

  return summary.items.map(item => {
    const label = `   Comp ${item.n}:`.padEnd(12);
    if (item.ratio === null) {
      return `${label} —   (no original list price` +
             (item.price === null ? ' or sold price' : '') + ')';
    }
    return `${label} ${formatRatio(item.ratio)}`;
  });
}

/** Tab-separated block for pasting into a spreadsheet. */
function reportAsTsv(report) {
  const cols = ['Category', 'Count', 'Priced', 'Low', 'High', 'Median',
    'Median DOM', 'DOM Rows', 'Ratio Low', 'Ratio High', 'Ratio Median'];
  /* Every row is padded to the header's width. A short row would silently
   * shift the ratio columns left in whatever spreadsheet this lands in. */
  const pad = (row) => row.concat(new Array(cols.length - row.length).fill('')).join('\t');
  const lines = [cols.join('\t')];

  for (const id of REPORTED_BUCKETS) {
    const s = report.summary[id];
    if (!s) continue;
    const r = s.ratio;
    const mt = s.marketTime;
    lines.push(pad([
      REPORT_LABEL[id],
      s.count,
      s.priced,
      s.low === null ? '' : s.low,
      s.high === null ? '' : s.high,
      s.median === null ? '' : s.median,
      mt ? mt.median : '',
      mt ? mt.count : '',
      r ? formatRatio(r.low) : '',
      r ? formatRatio(r.high) : '',
      r ? formatRatio(r.median) : '',
    ]));
  }
  lines.push(pad(['Not counted', report.summary.excluded.count]));
  lines.push(pad(['Unreadable', report.unresolved.length]));
  return lines.join('\n');
}

/* -------------------------------------------------------------------- */
/*  The UAD 3.6 form                                                     */
/* -------------------------------------------------------------------- */

/** The groups of the form's "Search Result Metrics" section, in its own order. */
const UAD_GROUPS = [
  { id: 'active',     title: 'Active Listings' },
  { id: 'sales',      title: 'Sales Within Lookback Period' },
  { id: 'pending',    title: 'Pending Sales' },
];

/**
 * Every field of that section, field for field, in the form's own order.
 *
 * ONE function feeds both the on-screen panel and the copied text, so what the
 * appraiser reads off the screen and what reaches the clipboard cannot drift
 * apart — which they would the moment two renderers each formatted the same
 * summary in their own way.
 *
 * `value` is exactly what goes on the clipboard: the bare number the form's
 * input takes. The form draws the "$" outside the box and groups the digits
 * itself, and a numeric field that refuses "189,900" but accepts "189900" is a
 * far commoner failure than the reverse. `display` is the readable form, shown
 * on screen so a figure can be checked against the screenshot at a glance.
 *
 * Two of the section's boxes are not here at all: the lookback period, which is
 * a parameter of the search rather than a column of the grid, and the distress
 * question, which is a judgement. Neither can be read off a screenshot, and a
 * panel of figures the app DID read is not the place to park a box it did not
 * — so they are left to the form, where the appraiser answers them.
 */
function uadFields(report) {
  const a = report.summary.active;
  const p = report.summary.pending;
  const c = report.summary.closed;

  const whole = (n) => ({ value: String(n), display: String(n) });
  const price = (v) => (v === null || v === undefined || !isFinite(v))
    ? { value: null, display: '—' }
    : { value: String(Math.round(v)), display: formatPrice(v) };
  const days = (mt) => (!mt || mt.median === null)
    ? { value: null, display: '—' }
    : { value: String(mt.median), display: formatDays(mt.median) };

  const f = (group, label, v, extra) => Object.assign({ group, label }, v, extra || {});

  /* Why this field carries the ACTIVE listings' market time and not the closed
   * sales': the form prints it inside its "Active Listings" group, between the
   * count and the list prices, and every other field in that group describes
   * the active set. The closed sales' own median market time is still read and
   * still reported — on the Closed Sales card and in the report text — it is
   * simply not what this box is asking for. */
  const domNote = !a.count
    ? 'No active listings in this search.'
    : !a.marketTime
      ? 'No market time was read for the active listings.'
      : a.marketTime.missing
        ? `Rests on ${a.marketTime.count} of ${a.count} active listings.`
        : `Median MT of all ${a.count} active listings.` +
          (c.marketTime ? ` Closed sales: ${formatDays(c.marketTime.median)} days` +
            (c.marketTime.missing ? ` (${c.marketTime.count} of ${c.count} sales)` : '') + '.' : '');

  return [
    f('active', 'Active Listings', whole(a.count),
      { unit: a.count === 1 ? 'listing' : 'listings' }),
    f('active', 'Median Days on Market', days(a.marketTime),
      { unit: 'days', note: domNote }),
    f('active', 'Lowest List Price', price(a.low), { money: true }),
    f('active', 'Median List Price', price(a.median), { money: true }),
    f('active', 'Highest List Price', price(a.high), { money: true }),

    f('sales', 'Sales in Lookback Period', whole(c.count),
      { unit: c.count === 1 ? 'sale' : 'sales',
        note: c.missing ? `${c.priced} of ${c.count} carried a readable sold price.` : null }),
    f('sales', 'Lowest Sale Price', price(c.low), { money: true }),
    f('sales', 'Median Sale Price', price(c.median), { money: true }),
    f('sales', 'Highest Sale Price', price(c.high), { money: true }),

    f('pending', 'Pending Sales', whole(p.count),
      { unit: p.count === 1 ? 'sale' : 'sales' }),
  ];
}

/**
 * The form fields as text, for the clipboard.
 *
 * Carries the provisional banner for the same reason the narrative block does:
 * someone who selects this by hand, bypassing a disabled button, must still be
 * told the reading is incomplete.
 */
function uadFieldsAsText(report) {
  const lines = [];
  if (report.provisional) {
    lines.push('*** PROVISIONAL — do not use without checking: ***');
    for (const r of report.provisionalReasons) lines.push(`***   • ${r}`);
    lines.push('');
  }

  lines.push('UAD 3.6 — Search Result Metrics');
  const fields = uadFields(report);

  for (const g of UAD_GROUPS) {
    const mine = fields.filter(x => x.group === g.id);
    if (!mine.length) continue;
    lines.push('');
    lines.push(g.title);
    for (const x of mine) {
      const val = x.value === null ? '—' : x.value;
      lines.push(`  ${(x.label + ' ').padEnd(26, '.')} ${val}` +
                 (x.unit && x.value !== null ? ` ${x.unit}` : ''));
    }
  }

  lines.push('');
  lines.push('Prices are bare numbers — the form supplies the $ and the commas. ' +
             'Days on market is the median MT of the active listings.');
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    median, medianPrice, medianDays, formatPrice, formatDays, formatRatio,
    saleToListRatio, compLines, summarizeBucket, priceForRow, buildReport,
    reportAsText, reportAsTsv, UAD_GROUPS, uadFields, uadFieldsAsText,
  };
}
