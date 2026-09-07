# UAD 3.6 Helper

Paste a connectMLS search-results screenshot. Get the three numbers a market
analysis needs — **active listings**, **pending sales** and **closed sales**,
each with its low, high and median price — plus the **sale-to-list ratio** of
every closed sale, net of seller concessions.

Nothing is uploaded. The screenshot is read in your browser, by the same
deterministic template-matching recognizer as its sibling project
[MLS-Extract](../MLS-Extract): no OCR engine, no model, no network.

![UAD 3.6 Helper reading a 37-row Dolton search](docs/screenshot.png)

---

## Using it

Double-click `index.html`. No server, no build step, no browser flags.

1. Screenshot your connectMLS grid — include the header row and the **Stat**,
   **Orig List Pr**, **List Price**, **Sold Pr** and **CONC** columns.
2. `Ctrl+V` into the page (or click to upload).
3. Read the three cards. Check the review table underneath. Copy.

### What it computes

| Bucket | Rows | Price used |
|---|---|---|
| Active listings | `ACTV`, `PCHG`, `NEW`, `RACT`, `BOMK`, `AUCT` | List Price |
| Pending sales | `PEND`, `FIN`, `A/I`, `CTGO`, `SS` | List Price |
| Closed sales | `CLSD` | **Sold Pr** |
| Not counted | `TEMP`, `EXP`, `CANC`, `RNTD`, `CTGA`, … | — |

`ACTV`, `PCHG`, `FIN`, `PEND` and `CLSD` are mapped as specified by the user;
the rest follow MRED Rules & Regulations §2.5 and standard appraisal practice.
**Every mapping is editable in the app**, and the cards recalculate as you
change it. The two genuine judgment calls are flagged on screen:

- **`TEMP`** (Temporarily No Showings) — listed but un-showable, so it is *not
  counted* by default. MRED itself excludes TEMP days from Listing Market Time.
  One click makes it Active if your analysis counts it as supply.
- **`A/I`** (Attorney Approval / Inspection) — treated as *pending*, because a
  contract exists at an agreed price, which matches UAD 3.6's "Contract" status
  and the user's own `FIN = pending` mapping. MRED classes it Active-Contingent;
  one click moves it.

**Median**: the middle value for an odd count, the mean of the two middle values
for an even one, rounded to the dollar. An empty set reports `—`, never `$0`.

**Sale-to-list ratio**: `(sold price − concessions) ÷ original list price`,
shown to three decimals (`98.859%`). A blank CONC cell counts as no concessions.
A closed sale with no original list price gets no ratio — the *current* list
price is not substituted, because a listing reduced twice would report a ratio
against a number nobody ever offered at.

---

## What it will not do

The whole design principle is that a **wrong number is far worse than a missing
one**. An appraiser can see a gap; they cannot see a plausible mistake.

- A closed sale whose **Sold Pr** could not be read is still counted, but
  contributes nothing to low/high/median, and the card says how many rows the
  prices actually rest on. Its asking price is never substituted.
- A status that does not clear the recognizer's confidence bar is reported as
  unreadable, not filed under the nearest guess. A row whose Stat cell is blank
  is **still a listing** — it appears in the table with no status, waiting for
  you, and is never deleted from the reckoning.
- **Any** unresolved row marks the summary **provisional**: the copy buttons go
  off and the text itself carries a `*** PROVISIONAL ***` header listing what is
  outstanding, so a summary copied by hand still says so. The gate also fires on
  a rejected money column, a discarded row band, a gap in the row numbering, an
  unpriced row, or money columns identified only by position.
- The green "no rows were dropped" tick appears only when the numbering starts
  at 1, has no gaps, nothing was discarded, and every status was read.
- Every glyph of every price goes through the confusable-pair guard
  (`0`/`9`, `3`/`5`, `1`/`7`, …). One ambiguous glyph rejects the whole cell.
- If the grid numbers its rows, those numbers are read back as an independent
  check that nothing was dropped, and any gap is reported by row number.

---

## How it reads the image

The recognizer knows what connectMLS looks like. It is not general OCR.

1. **Preprocess** — upscale 4×, flatten alternating-row and selection shading,
   Otsu threshold, erase table rules. (Ported verbatim from MLS-Extract.)
2. **Rows** — horizontal projection. Bands cut by the screenshot edge are
   detected and excluded by name.
3. **Tokens** — each row is split into runs of ink at a gap derived from the
   screenshot's own glyph width, so the same code works at 100% zoom and on a
   2× Retina paste.
4. **Columns** — tokens are grouped across rows by horizontal overlap, not by
   gutter width. `Orig List Pr` and `List Price` sit a few pixels apart, closer
   than any gutter threshold can separate, but their cells never overlap.
5. **Header** — each header cell is matched as a *whole word* against the known
   connectMLS labels, in whichever of five UI font families fits best.
6. **Status** — the `Stat` cell is matched as a whole token against the closed
   MRED vocabulary. Cells are then clustered by shape and ink colour and
   labelled once per cluster, so twenty-one `CLSD` cells are one twenty-one-vote
   decision rather than twenty-one coin flips.
7. **Prices** — read glyph-by-glyph against a bank built from real connectMLS
   pixels. Whether a column carries a leading `$` is decided for the whole
   column at once: at 11px the dollar sign loses its stem to binarization and
   correlates as `5`, `8` or `S`, but the comma grouping has to add up, and
   every cell in the column votes on it.
8. **Roles** — `Stat`, `List Price`, `Orig List Pr`, `Sold Pr` and `CONC` are
   named from the header where there is one. Failing that, the sold column is
   the money column populated on the closed rows **and blank on the rest** —
   agreement alone is not evidence, because on a closed-heavy grid an
   always-filled asking-price column agrees with the closed set simply because
   almost every row is closed. Cross-checks can still overturn the result:
   `Orig ≥ List` on most rows, `median(sold)` within half to one-and-a-half
   times `median(list)`. Each role records **how** it was decided, and the
   reported confidence is that of the weakest role that feeds a number.

---

## Development

```bash
npm install          # puppeteer + node-canvas, for the tests only
npm run fixture:all  # regenerate every fixture PNG and its ground truth
npm run build:assets # re-inline assets/*.png into src/assets.js
npm test             # fixtures, statistics, reference grid, edge cases
```

| Script | What it does |
|---|---|
| `npm test` | Everything, in order |
| `npm run test:stats` | Arithmetic only — no browser, ~1s |
| `npm run test:grid` | The 37-row reference grid, asserted row by row |
| `npm run test:edge` | Eleven awkward inputs (below) |
| `npm run build:assets` | Re-inline `assets/*.png` into `src/assets.js` |

### Fixtures

The user's original screenshot is not a file we have, so `tests/grid-data.js`
holds its 37 rows transcribed, and `tests/make-grid-fixture.js` re-renders them
at connectMLS's real geometry — 11px text on a 27px pitch, bold colour-coded
status codes, alternating shading, a header with a sort arrow. Ground truth is
computed from the same table and written next to each PNG, so a fixture and its
expected numbers cannot drift apart.

| Fixture | What it proves |
|---|---|
| `grid` | Every status, price, concession and ratio, row by row |
| `grid-no-header` | Columns inferred from the data alone |
| `grid-no-closed` | No sold column is bound when there are no closed sales |
| `grid-all-closed` | Active and pending report zero, not null noise |
| `grid-selected` | A highlighted row changes nothing |
| `grid-grayscale` | Clustering falls back to shape when colour is gone |
| `grid-verdana` | The UI font is detected, not assumed |
| `grid-narrow` | A crop with no `Orig List Pr` — ratios absent and *said so* |
| `grid-hidpi` | A 2× Retina paste gives identical buckets |
| `grid-clipped-top` / `-bottom` | A sliced row is excluded, not misread |
| `grid-blank-stat` | A blank Stat cell keeps its listing, and blocks the copy |
| `grid-wide-range` | Prices from $87k to $2.1M |

### Layout

```
index.html            markup
styles.css            MLS-Extract's design tokens, plus this app's components
app.js                UI: state, rendering, the editable review table
src/
  config.js           every threshold, and why it has that value
  vocab.js            MRED status codes and connectMLS header labels
  assets.js           reference glyph images, inlined as data URIs
  imaging.js  ┐
  segment.js  ├─ ported verbatim from MLS-Extract — do not tune here
  glyph.js    │
  rules.js    ┘
  templates.js        the digit bank, and its font-adapted fallback
  word.js             whole-word template matching
  price.js            prices, concessions, and pitch-aware re-segmentation
  grid.js             tokens → columns → named roles
  status.js           the Stat column: clustering and constrained decoding
  stats.js            buckets, medians, ratios, output formats (pure, testable)
  pipeline.js         the run, and everything it refuses to do quietly
  debug.js            the recognition-detail panel
tests/                fixtures, generators and suites
```

`src/imaging.js`, `src/segment.js`, `src/glyph.js` and `src/rules.js` are byte-
for-byte copies of MLS-Extract's calibrated routines. They are shared, not
forked: fix a bug in one project and port it to the other rather than tuning
locally.
