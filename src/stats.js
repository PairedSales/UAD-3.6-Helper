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

/** Format an integer as US currency, no cents. */
function formatPrice(val) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  return '$' + Math.round(val).toLocaleString('en-US');
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
    prices: prices.slice().sort((a, b) => a - b),
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

    if (id === 'closed' && s.ratio) {
      lines.push(
        `   Sale/list ratio, net of concessions: ` +
        `Low ${formatRatio(s.ratio.low)}   High ${formatRatio(s.ratio.high)}   ` +
        `Median ${formatRatio(s.ratio.median)}` +
        (s.ratio.missing ? `   (${s.ratio.count} of ${s.count} with an original list price)` : '')
      );
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

/** Tab-separated block for pasting into a spreadsheet. */
function reportAsTsv(report) {
  const lines = ['Category\tCount\tPriced\tLow\tHigh\tMedian\tRatio Low\tRatio High\tRatio Median'];
  for (const id of REPORTED_BUCKETS) {
    const s = report.summary[id];
    if (!s) continue;
    const r = s.ratio;
    lines.push([
      REPORT_LABEL[id],
      s.count,
      s.priced,
      s.low === null ? '' : s.low,
      s.high === null ? '' : s.high,
      s.median === null ? '' : s.median,
      r ? formatRatio(r.low) : '',
      r ? formatRatio(r.high) : '',
      r ? formatRatio(r.median) : '',
    ].join('\t'));
  }
  lines.push(['Not counted', report.summary.excluded.count, '', '', '', '', '', '', ''].join('\t'));
  lines.push(['Unreadable', report.unresolved.length, '', '', '', '', '', '', ''].join('\t'));
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    median, medianPrice, formatPrice, formatRatio, saleToListRatio,
    summarizeBucket, priceForRow, buildReport, reportAsText, reportAsTsv,
  };
}
