/* ===== UAD 3.6 Helper — Extraction Pipeline =========================== */
/* One pass over a pasted grid: preprocess, find the header, tokenize every  */
/* row, group tokens into columns, name the columns we need, and read them   */
/* row by row.                                                               */
/*                                                                           */
/* Nothing here truncates silently. Every row band the image contains is      */
/* either read or accounted for — as an unreadable status, a missing price, a */
/* row clipped by the screenshot edge, or a band that carried no listing at   */
/* all. A row that vanishes without a word moves a median with no sign it     */
/* ever happened, which is the one failure this tool must not have.           */
/* ===================================================================== */

/**
 * Read the row-number column, if the grid has one.
 *
 * connectMLS numbers its result rows 1..N down the left edge, which is a
 * direct check that no row was lost between the screenshot and the summary.
 * A GAP in the sequence is the finding, not a reason to abandon the check —
 * "rows 31 and 32 are missing" is exactly what the user needs to hear.
 */
function findIndexColumn(surf, cols, dataRows, bank) {
  let best = null;

  for (const col of cols) {
    if (col.cells.size < Math.max(3, dataRows.length * 0.6)) continue;

    const seen = new Map();
    for (const [row, token] of col.cells) {
      if (token.tall.length < 1 || token.tall.length > 4) continue;
      let str = '', worst = 1, bad = false;
      for (const g of token.tall) {
        const norm = normalizeGlyph(surf.gray, g.x, g.y, g.w, g.h);
        norm.features = computeStructuralFeatures(norm.binary, CFG.NORM_W, CFG.NORM_H, norm.grayscale);
        const cls = classifyGlyph(norm, bank);
        if (isAmbiguous(cls)) { bad = true; break; }
        str += String(cls.digit);
        worst = Math.min(worst, cls.score);
      }
      if (bad || !/^\d{1,4}$/.test(str) || worst < CFG.MIN_DIGIT_SCORE) continue;
      seen.set(row, parseInt(str, 10));
    }

    if (seen.size < Math.max(3, dataRows.length * 0.6)) continue;

    const nums = Array.from(seen.values()).sort((a, b) => a - b);
    const first = nums[0], last = nums[nums.length - 1];
    const span = last - first + 1;

    /* A row-number column counts up by one and repeats nothing. Anything else
     * is some other numeric column that happens to look tidy. */
    const unique = new Set(nums);
    if (unique.size !== nums.length) continue;
    if (span > nums.length * 1.5 + 3) continue;

    const missing = [];
    for (let v = first; v <= last; v++) if (!unique.has(v)) missing.push(v);

    const candidate = { col, numbers: seen, first, last, span, missing, read: seen.size };
    if (!best || candidate.read > best.read || (candidate.read === best.read && !candidate.missing.length)) {
      best = candidate;
    }
    if (!missing.length) break;      /* a perfect run is as good as it gets */
  }

  return best;
}

/** Map each column to the role its header label claimed. */
function headerRoleMap(header, cols) {
  return bindHeaderRoles(header, cols).roles;
}

/**
 * Rows the screenshot cut through.
 *
 * A band that touches the top or bottom edge AND is noticeably shorter than
 * the rest has had its glyphs sliced. normalizeGlyph would stretch the
 * remainder back to 24×32 and classify it confidently — so these are excluded
 * by name rather than read.
 */
function findClippedRows(surf, rows) {
  const clipped = new Set();
  if (rows.length < 3) return clipped;
  const heights = rows.map(r => r.h).sort((a, b) => a - b);
  const med = heights[Math.floor(heights.length / 2)];

  for (const row of rows) {
    const touchesEdge = row.y <= 1 || row.y + row.h >= surf.H - 1;
    if (touchesEdge && Math.abs(row.h - med) / med > 0.15) clipped.add(row);
  }
  return clipped;
}

/**
 * Run the whole extraction.
 *
 * Returns everything the UI and the debug panel need, including the
 * intermediate structures — a reading you cannot inspect is a reading you
 * cannot check, and this one decides numbers that go into an appraisal.
 */
async function extractGrid(img, onProgress) {
  const step = (pct, msg) => { if (onProgress) onProgress(pct, msg); };

  step(4, 'Loading templates…');
  const bank = await ensureDigitBank();

  step(12, 'Preprocessing…');
  const surf = buildSurface(img);
  const warnings = [];
  const skipped = {
    noStatusCell: 0, notAListing: 0, clipped: 0, aboveHeader: 0,
    outOfRange: surf.droppedRows.length,
  };

  if (surf.downscaled) {
    warnings.push({
      level: 'info',
      text: `This looks like a high-DPI screenshot. It was scaled to ×${surf.downscaled.toFixed(2)} ` +
            `before analysis so the browser could hold it in memory.`,
    });
  }
  if (surf.src.width < 400) {
    warnings.push({
      level: 'error',
      text: `The image is only ${surf.src.width}px wide. A connectMLS grid must be pasted at full ` +
            `size — a scaled-down screenshot no longer has the pixels the recognizer matches against.`,
    });
  }
  if (surf.rows.length < 2) {
    return {
      surf, rows: [], failed: true, skipped, warnings: warnings.concat([
        { level: 'error', text: 'No table rows were found in this image.' },
      ]),
    };
  }

  step(22, 'Reading the header…');
  const header = findHeaderRow(surf);
  if (!header) {
    warnings.push({
      level: 'warn',
      text: 'No header row was recognized, so the money columns had to be identified from the ' +
            'data itself. Check the column assignment below before using these numbers.',
    });
  } else if (header.skippedAbove > 0) {
    skipped.aboveHeader = header.skippedAbove;
    warnings.push({
      level: 'info',
      text: `${header.skippedAbove} row band(s) above the header row were ignored (toolbar or ` +
            `result-count line).`,
    });
  }

  const headerRowY = header ? header.row.y : -1;
  let dataRows = surf.rows.filter(r => r.y > headerRowY);

  const clipped = findClippedRows(surf, dataRows);
  if (clipped.size) {
    skipped.clipped = clipped.size;
    dataRows = dataRows.filter(r => !clipped.has(r));
    warnings.push({
      level: 'warn',
      text: `${clipped.size} row(s) were cut off by the edge of the screenshot and could not be ` +
            `read. Re-take the screenshot with whole rows to include them.`,
    });
  }

  step(32, 'Splitting rows into cells…');
  for (const row of dataRows) row.tokens = extractTokens(surf, row);

  const allTokens = [];
  for (const row of dataRows) allTokens.push(...row.tokens);
  const cols = groupIntoColumns(allTokens);
  console.log(`[Grid] ${dataRows.length} data rows, ${allTokens.length} tokens → ${cols.length} columns`);

  const headerRoles = headerRoleMap(header, cols);

  step(45, 'Finding the status column…');
  const statusCol = findStatusColumn(surf, dataRows, cols, headerRoles, bank);
  let statusByRow = new Map();
  let clusters = [];
  if (statusCol) {
    clusters = clusterStatusCells(surf, statusCol.cells);
    statusByRow = labelStatusClusters(clusters, statusCol.font);
    const merged = mergeSameCodeClusters(clusters);
    clusters = merged.clusters;
    for (const c of merged.contradictions) {
      warnings.push({
        level: 'warn',
        text: `Two groups of cells were both read as "${c.code}" but are printed in different ` +
              `colours (${c.colors.join(' vs ')}). connectMLS colour-codes this column, so one of ` +
              `the groups is probably a different code — check those rows.`,
      });
    }
  } else {
    warnings.push({
      level: 'error',
      text: 'No status column was found. Every listing needs a "Stat" value to be counted — ' +
            'make sure the Stat column is inside the pasted screenshot.',
    });
  }

  step(65, 'Reading prices…');
  /* The family the status column resolved in is the family the whole grid is
   * drawn in, so it is what the digit fallback should synthesize. */
  const uiFont = (statusCol && statusCol.font) || (header && header.font) || null;
  const { money, integers } = scoreColumns(surf, dataRows, cols, bank, uiFont);
  console.log(`[Grid] ${money.length} money column(s): ` + money.map(m =>
    `x=${m.col.x0}-${m.col.x1} filled ${(100 * m.fillFrac).toFixed(0)}% median ` +
    `$${m.median.toLocaleString('en-US')}`).join('; '));

  const roles = assignRoles(money, integers, statusByRow, dataRows, header, cols);
  for (const p of roles.problems) warnings.push({ level: 'error', text: p });
  if (roles.confidence < 0.9) {
    warnings.push({
      level: 'warn',
      text: `Money columns were inferred rather than read from a header (confidence ` +
            `${(100 * roles.confidence).toFixed(0)}%). ${roles.notes.join(' ')}`,
    });
  }
  if (!roles.orig) {
    warnings.push({
      level: 'info',
      text: 'No "Orig List Pr" column was found, so no sale-to-list ratios could be computed. ' +
            'Include that column in the screenshot to get them.',
    });
  }
  if (!roles.conc && roles.sold) {
    warnings.push({
      level: 'info',
      text: 'No concessions (CONC) column was found. Sale-to-list ratios treat concessions as zero.',
    });
  }

  step(80, 'Cross-checking…');
  const mlsCol = findMlsColumn(surf, cols, bank);
  const indexCol = findIndexColumn(surf, cols, dataRows, bank);

  /* ---- Assemble the rows ---- */
  const rows = [];
  const valueAt = (role, row) => {
    const r = roles[role];
    if (!r) return null;
    const src = r.prices || r.values;
    const hit = src.get(row);
    return hit ? hit.value : null;
  };

  for (const row of dataRows) {
    const st = statusByRow.get(row);
    const hasStatusCell = statusCol ? !!tokenAt(statusCol.col, row) : false;

    /* A band is discarded ONLY when nothing about it says "listing". A missing
     * status cell alone is not enough: a row with a row number, an MLS number
     * and a sold price is unmistakably a sale whose Stat glyph simply did not
     * survive, and dropping it removes a real sale from the median with no
     * trace. Those rows come through with status null, land in `unresolved`,
     * appear in the review table, and trip the provisional gate. */
    if (!hasStatusCell) {
      const hasMoney = ['list', 'orig', 'sold'].some(r => roles[r] && roles[r].prices.has(row));
      const hasMls = !!(mlsCol && mlsCol.values.has(row));
      const hasIndex = !!(indexCol && indexCol.numbers.has(row));
      if (!hasMoney && !hasMls && !hasIndex) { skipped.notAListing++; continue; }
      skipped.noStatusCell++;
    }

    rows.push({
      y: row.y,
      h: row.h,
      index: indexCol ? (indexCol.numbers.has(row) ? indexCol.numbers.get(row) : null) : null,
      mls: mlsCol ? (mlsCol.values.has(row) ? mlsCol.values.get(row) : null) : null,
      status: st ? st.code : null,
      statusScore: st ? st.score : 0,
      statusMargin: st ? st.margin : 0,
      statusColor: st ? st.color : null,
      statusRanked: st ? st.ranked : [],
      statusReject: st ? st.reject : 'no-cell',
      listPrice: valueAt('list', row),
      origPrice: valueAt('orig', row),
      soldPrice: valueAt('sold', row),
      concessions: valueAt('conc', row),
      edited: false,
      omit: false,
      _row: row,
    });
  }

  /* ---- Completeness and sanity checks ---- */
  if (skipped.notAListing) {
    warnings.push({
      level: 'info',
      text: `${skipped.notAListing} row band(s) carried no status, price, MLS number or row number ` +
            `and were treated as page chrome rather than listings.`,
    });
  }
  if (skipped.outOfRange) {
    warnings.push({
      level: 'warn',
      text: `${skipped.outOfRange} band(s) of ink were too short or too tall to be a table row and ` +
            `were not read. If your grid has more rows than the count below, re-take the screenshot.`,
    });
  }

  const unreadable = rows.filter(r => !r.status).length;
  if (unreadable) {
    warnings.push({
      level: 'warn',
      text: `${unreadable} status value(s) could not be read` +
            (skipped.noStatusCell
              ? ` (${skipped.noStatusCell} of them had no status cell at all)`
              : '') +
            `. Those rows are listed below and are excluded from every count until you set a ` +
            `status for them.`,
    });
  }

  /* The row-number cross-check.
   *
   * It has to be computed against the rows that actually reached the report,
   * not against the bands the reader started from — otherwise a row lost
   * anywhere downstream still has its number counted, and the check certifies
   * the very loss it exists to catch. A number that could not be READ is a
   * different thing from a listing that is ABSENT, and they are reported
   * separately: only the second means a sale is missing from the median. */
  const dropped = skipped.notAListing + skipped.clipped +
                  skipped.outOfRange + skipped.aboveHeader;

  if (indexCol) {
    const got = new Set(rows.map(r => r.index).filter(v => v !== null && v !== undefined));
    const unnumbered = rows.filter(r => r.index === null || r.index === undefined).length;
    const gaps = [];
    for (let v = indexCol.first; v <= indexCol.last; v++) if (!got.has(v)) gaps.push(v);
    const absent = Math.max(0, gaps.length - unnumbered);

    if (absent > 0) {
      warnings.push({
        level: 'error',
        text: `The grid numbers its rows ${indexCol.first}–${indexCol.last}, but ${absent} of them ` +
              `${gaps.length === absent
                ? `(${gaps.slice(0, 12).join(', ')}${gaps.length > 12 ? '…' : ''}) `
                : ''}` +
              `are missing from the summary below. Those listings are not in any count.`,
      });
    } else if (gaps.length) {
      warnings.push({
        level: 'info',
        text: `${gaps.length} row number(s) could not be read, but every row band was. No listing ` +
              `is missing.`,
      });
    }

    if (indexCol.first > 1) {
      warnings.push({
        level: 'warn',
        text: `The grid numbers its rows from ${indexCol.first}, not 1. If this is the first page ` +
              `of your results, rows 1–${indexCol.first - 1} are above the top of the screenshot ` +
              `and are not in this summary.`,
      });
    }

    if (!absent && !gaps.length && indexCol.first === 1 && !dropped && !unreadable) {
      warnings.push({
        level: 'ok',
        text: `Row numbers 1–${indexCol.last} were all read — no rows were dropped.`,
      });
    }
  } else {
    warnings.push({
      level: 'info',
      text: 'The grid has no readable row-number column, so the app cannot independently confirm ' +
            'that every row was read. Compare the count below against your search results.',
    });
  }

  if (mlsCol) {
    const counts = new Map();
    for (const r of rows) if (r.mls) counts.set(r.mls, (counts.get(r.mls) || 0) + 1);
    const dupes = Array.from(counts.entries()).filter(([, n]) => n > 1);
    if (dupes.length) {
      warnings.push({
        level: 'warn',
        text: `The same MLS number appears more than once: ` +
              `${dupes.map(([m, n]) => `${m} ×${n}`).join(', ')}. One property counted twice will ` +
              `skew the median — untick the duplicate below.`,
      });
    }
  }

  const flagged = new Set();
  for (const r of rows) {
    const entry = r.status ? STATUS_BY_CODE[normalizeStatusCode(r.status)] : null;
    if (entry && entry.flag) flagged.add(entry.code);
  }
  for (const code of flagged) {
    warnings.push({ level: 'info', text: `${code}: ${STATUS_BY_CODE[code].flag}` });
  }

  step(95, 'Summarizing…');

  /* Everything buildReport needs in order to decide whether this reading may
   * be copied. Without it the gate can only see unreadable statuses, and a
   * summary the app has itself flagged with an error reaches the clipboard
   * carrying no sign of it. */
  const review = {
    errors: warnings.filter(w => w.level === 'error').length,
    warns: warnings.filter(w => w.level === 'warn').length,
    droppedRows: dropped,
    roleProblems: roles.problems.length,
    confidence: roles.confidence,
    noStatusColumn: !statusCol,
  };

  return {
    surf, rows, warnings, skipped, review,
    header, cols, statusCol, statusClusters: clusters,
    money, integers, roles, mlsCol, indexCol,
    dataRowCount: dataRows.length,
    failed: false,
  };
}
