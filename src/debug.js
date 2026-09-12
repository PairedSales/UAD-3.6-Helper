/* ===== UAD 3.6 Helper — Recognition Detail Panel ====================== */
/* Shows what the recognizer actually did: which bands it called rows, which */
/* columns it named, and what each status cluster resolved to. A reading you */
/* cannot inspect is a reading you cannot check, and these numbers end up in */
/* an appraisal.                                                             */
/* ===================================================================== */

const DEBUG_COLORS = {
  row:    'rgba(255, 255, 255, 0.10)',
  header: '#ffb86c',
  status: '#50fa7b',
  list:   '#bd93f9',
  sold:   '#8be9fd',
  orig:   '#ff79c6',
  conc:   '#ffb86c',
  mls:    '#6272a4',
};

/**
 * Draw the analyzed surface with every decision overlaid.
 * Rendered at source resolution (the upscale is undone) so it lines up with
 * the screenshot the user pasted.
 */
function renderDebugOverlay(canvasEl, result) {
  if (!canvasEl || !result || !result.surf) return;
  const { surf } = result;
  const scale = CFG.UPSCALE;
  const W = Math.round(surf.W / scale), H = Math.round(surf.H / scale);

  canvasEl.width = W;
  canvasEl.height = H;
  const ctx = canvasEl.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(surf.gray, 0, 0, surf.W, surf.H, 0, 0, W, H);

  /* Wash the page back so the overlay reads over it. */
  ctx.fillStyle = 'rgba(40, 42, 54, 0.55)';
  ctx.fillRect(0, 0, W, H);

  const box = (x, y, w, h, color, fill) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x / scale, y / scale, w / scale, h / scale); }
    ctx.strokeRect(x / scale + 0.5, y / scale + 0.5, w / scale - 1, h / scale - 1);
  };

  for (const row of surf.rows) box(0, row.y, surf.W, row.h, DEBUG_COLORS.row);

  if (result.header) {
    box(0, result.header.row.y, surf.W, result.header.row.h, DEBUG_COLORS.header,
        'rgba(255, 184, 108, 0.10)');
  }

  const colBox = (col, color) => {
    if (!col) return;
    const top = surf.rows.length ? surf.rows[0].y : 0;
    const last = surf.rows.length ? surf.rows[surf.rows.length - 1] : { y: 0, h: surf.H };
    box(col.x0, top, col.x1 - col.x0, (last.y + last.h) - top, color);
  };

  if (result.statusCol) colBox(result.statusCol.col, DEBUG_COLORS.status);
  for (const role of ['list', 'orig', 'sold', 'conc']) {
    if (result.roles && result.roles[role]) colBox(result.roles[role].col, DEBUG_COLORS[role]);
  }
  if (result.mlsCol) colBox(result.mlsCol.col, DEBUG_COLORS.mls);

  /* Individual cells that were actually read. */
  if (result.statusCol) {
    for (const cell of result.statusCol.cells) {
      const b = cell.token.bbox;
      box(b.x, b.y, b.w, b.h, DEBUG_COLORS.status, 'rgba(80, 250, 123, 0.14)');
    }
  }
  for (const role of ['list', 'orig', 'sold', 'conc']) {
    const pc = result.roles && result.roles[role];
    if (!pc) continue;
    const src = pc.prices || pc.values;
    for (const [row, ] of src) {
      const t = pc.col.cells.get(row);
      if (!t) continue;
      box(t.bbox.x, t.bbox.y, t.bbox.w, t.bbox.h, DEBUG_COLORS[role]);
    }
  }
}

/** One line per status cluster: the actual pixels, the code, and the runner-up. */
function renderDebugClusters(el, result) {
  if (!el) return;
  el.innerHTML = '';
  if (!result.statusClusters || !result.statusClusters.length) {
    el.innerHTML = '<div class="section-note">No status clusters were formed.</div>';
    return;
  }

  for (const cl of result.statusClusters) {
    const wrap = document.createElement('div');
    wrap.className = 'debug-cluster';

    const proto = cl.members[0].raster.canvas;
    const c = document.createElement('canvas');
    c.width = proto.width;
    c.height = proto.height;
    c.getContext('2d').drawImage(proto, 0, 0);
    wrap.appendChild(c);

    const sw = document.createElement('span');
    sw.className = 'review-swatch';
    sw.style.background = colorHex(cl.color);
    wrap.appendChild(sw);

    const label = document.createElement('span');
    label.style.fontWeight = '700';
    label.style.color = cl.code ? 'var(--success)' : 'var(--error)';
    label.textContent = cl.code || 'UNREADABLE';
    wrap.appendChild(label);

    const meta = document.createElement('span');
    meta.style.color = 'var(--text-secondary)';
    meta.textContent =
      `×${cl.members.length}  score ${cl.score.toFixed(3)}  margin ${cl.margin.toFixed(3)}` +
      (cl.ranked && cl.ranked[1] ? `  (2nd: ${cl.ranked[1].text} ${cl.ranked[1].mean.toFixed(3)})` : '');
    wrap.appendChild(meta);

    el.appendChild(wrap);
  }
}

/**
 * The same panel for an export, which has no pixels to overlay: how the file
 * was split, which heading every role came from, and each cell it refused.
 */
function renderDebugTable(el, result, perf) {
  if (!el) return;
  const lines = [];
  lines.push(`${result.fileName}: ${result.delimiter}-separated` +
             (result.encoding ? `, ${result.encoding}` : '') +
             `, header on line ${result.headerLine} with ${result.headerLabels.length} columns`);
  lines.push(`${result.recordCount} records after the header  → ${result.rows.length} rows  ` +
             `(${result.skipped.malformed} malformed, ${result.skipped.notAListing} empty, ` +
             `${result.skipped.aboveHeader} above the header)`);
  for (const [role, c] of Object.entries(result.columns)) {
    lines.push(`  ${role.padEnd(7)} ← column ${String(c.index + 1).padStart(2)} "${c.label}"`);
  }
  for (const a of result.ambiguous) {
    lines.push(`  ${a.role.padEnd(7)} ✕ claimed by ${a.labels.map(l => `"${l}"`).join(', ')} — not used`);
  }
  for (const r of result.refused) {
    lines.push(`  refused  line ${r.line}, ${r.label}: "${r.raw}" ${r.why}`);
  }
  if (perf) lines.push(Object.entries(perf).map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join('   '));
  el.textContent = lines.join('\n');
}

/** Timings and the headline structural facts. */
function renderDebugPerf(el, result, perf) {
  if (!el) return;
  const lines = [];
  if (result.surf.segments) {
    lines.push(`read from ${result.surf.segments.length} column group(s) cut out of the page — ` +
      `the image below is those columns side by side, which is all that was analyzed`);
  }
  lines.push(`source ${result.surf.src.width}×${result.surf.src.height}px  ` +
             `→ upscaled ${result.surf.W}×${result.surf.H}  ` +
             `Otsu ${result.surf.thr}  medRow ${result.surf.medH}`);
  lines.push(`${result.surf.rows.length} row bands  ` +
             `${result.dataRowCount} data rows  ` +
             `${result.cols.length} columns  ` +
             `${result.money.length} money columns  ` +
             `${result.surf.shadedBands.length} shaded bands  ` +
             `${result.surf.rulesRemoved} rule px stripped`);
  if (result.statusCol) {
    lines.push(`status column: font ${result.statusCol.font}  ` +
               `resolved ${(100 * result.statusCol.resolvedFrac).toFixed(0)}%  ` +
               `mean ${result.statusCol.meanScore.toFixed(3)}`);
  }
  lines.push(`column roles: ${result.roles.method || 'none'} ` +
             `(confidence ${(100 * (result.roles.confidence || 0)).toFixed(0)}%)`);
  if (perf) {
    lines.push(Object.entries(perf).map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join('   '));
  }
  el.textContent = lines.join('\n');
}
