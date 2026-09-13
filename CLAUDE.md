# UAD 3.6 Helper — working notes

Read `README.md` first; it covers what the app does and how it reads an image.
This file is about working *on* it.

## The rule everything else follows

The output goes into an appraisal. **A confidently wrong number is far worse
than a missing one.** An appraiser can see a gap; they cannot see a plausible
mistake. So when a change makes the recognizer read more, ask what it would read
*wrongly* — and prefer the version that refuses.

Concretely, do not undo any of these without a very good reason:

- No cross-source price fallback. A closed sale with no readable Sold Pr is
  counted and reported as unpriced. Its asking price never enters a sold median.
- `isAmbiguous()` runs on every digit of every price. One ambiguous glyph
  rejects the whole cell. (The currency symbol is exempt — see `price.js`.)
- Comma grouping is validated on every numeric token, dollar sign or not.
- Unreadable statuses land in `unresolved`, never in a bucket — and a row is
  only ever DISCARDED when it has no status, no price, no MLS number and no row
  number. Anything less and it is a listing whose Stat glyph did not survive.
- Any unresolved row makes the report provisional and disables copy — the
  per-field copy buttons on the form panel included, because a bare number has
  nowhere to carry a caveat. The provisional banner is written into the copied
  text too — the narrative block AND the form-field block — so select-and-copy
  cannot escape it.
- Market time is bound by the header label `MT` and by nothing else. It is a
  column of one- to three-digit integers, indistinguishable in the data from
  `# Rms`, `Yr Blt`, `All Beds`, `ASF` and `# Garage`; `CFG.MT_MAX_DAYS` is not
  a second guard and must not be described as one, since every year in a
  `Yr Blt` column clears it. No `MT` header, no days on market.
- The two boxes the app cannot source — the lookback period and the distress
  question — are not on the panel. The lookback period is a parameter of the
  search rather than a column of the grid, and whether the market is distressed
  is a judgement; MRED gives a short sale a code and gives an REO, a relocation
  or an estate sale none, so nothing in the pixels answers either one. Do not
  add them back with a typed box or an inferred Yes/No: every figure on that
  panel is one the app read, and one box that is not would teach the reader
  that some of the others might not be either.
- Every skipped row increments a named counter that reaches the UI, and the
  green "no rows were dropped" tick is gated on all of them being zero.
- The row-number cross-check compares against the rows that reached the REPORT,
  never against the bands the reader started from. Comparing against the latter
  is how the check certifies the very loss it exists to catch.
- A money column is bound to a role only on positive evidence. "Agrees with the
  closed rows" is not positive evidence on a grid that is nearly all closed;
  "blank on the rows that are not closed" is.

## Ported code — do not tune locally

`src/imaging.js`, `src/segment.js`, `src/glyph.js` and `src/rules.js` are
byte-for-byte copies of MLS-Extract (`C:\Users\jeffh\Coding Projects\MLS-Extract`,
`script.js` sections 3, 4, 5, 7, 8, 10). Their constants are benchmarked against
real connectMLS screenshots there. `rules.js` has exactly one deliberate change,
documented at the top of the file.

If one of them is wrong, fix it in MLS-Extract and re-port. Divergence between
the two projects is a bug in itself.

## Scale-dependence is the recurring bug

Every horizontal threshold must be a multiple of `surf.glyphW` (the screenshot's
own glyph width) or `surf.medH`, never a pixel constant. A fixed constant is
correct at exactly one zoom level and one DPI, and fails *partially* elsewhere —
some glyphs split and others do not, which produces plausible wrong numbers
rather than an obvious failure. `CFG.TOKEN_GAP_GLYPHS`,
`CFG.GLYPH_SPLIT_RATIO` and `CFG.COLUMN_GAP_GLYPHS` exist because of this.

The last of those is the subtlest. `buildCompactSurface` draws a gutter between
the strips it lays side by side, and that gutter has to be WIDER than the gap
that ends a token — or the last cell of one column and the first cell of the
next come back as a single token. The token gap is measured in glyph widths, so
the gutter has to be too: as a source-pixel constant it was correct at 11px
text and crossed over at around a 16px glyph, which a Retina paste at browser
zoom reaches. Note that the same number used to do a second, unrelated job —
deciding whether two source ranges are close enough to crop as one — and that
one is still `CFG.COLUMN_GAP_SRC` in source pixels, on purpose: widening it
fuses more ranges, and a fused range is drawn from the source verbatim, which
copies the ink of columns that were deliberately not kept.

## Two decisions that are made per-column, not per-cell

Both are load-bearing and both look like they should be per-cell:

1. **Currency prefix** (`decideCurrencyPrefix`). At 11px the `$` loses its stem
   to binarization and correlates as `5`, `8` or `S`; it is not reliably taller
   than the digits either. Per cell there is no evidence. Per column there is:
   the comma grouping must add up, and every cell votes.

2. **Status code** (`clusterStatusCells` → `labelStatusClusters`). Identical
   codes are pixel-identical, so cells are clustered and labelled once per
   cluster. The three-branch merge rule matters: colour must never *veto* a
   merge of two near-identical bitmaps (row shading moves anti-aliased ink a few
   RGB points), and must never *cause* one between different shapes.

## A variable suffix is read in two halves, not two ways

`HS48` has no fixed rendering, so no whole-cell template can match it. The cell
is split: the two letters are matched glyph by glyph against `STATUS_ALPHABET`,
and the suffix only has to prove it is digits. Three things about
`applyKickoutRead` in `status.js` look optional and are not:

- **Glyph by glyph, not as a two-letter word.** Correlated whole, `HS` and `HC`
  share their first glyph, so half the stretched raster agrees whichever is
  right and they finish 0.06 apart — under the one-glyph confusable margin, and
  the cell is refused. Per glyph the second letter is `S` at 0.74 with `C`
  nowhere near it. The evidence was always there; averaging it against an
  identical `H` is what hid it.

- **The hours are a gate, not a reading.** They move no row between buckets and
  enter no price, median or ratio, so printing `HS124` for a cell that says
  `HS120` is a number on screen contradicting the screenshot in exchange for
  nothing. That is exactly the trade the top of this file forbids. `HS` is also
  what `normalizeStatusCode` folds a hand-typed `HS48` onto, so the row table,
  the mapping grid and the copied report all agree.

- **A digit only has to be CREDIBLE at each suffix position, not win.** Bold `O`
  and `0` are the same shape — in Verdana they finish 0.011 apart — and
  demanding the digit win loses `HS120` on a coin toss. Nothing rides on the
  toss: a kick-out code is exactly two letters, so no letter reading of a suffix
  glyph spells a valid code either. What the gate must catch is a suffix that is
  confidently letters, i.e. a clipped `PCHG` becoming a pending `PC`.

The strict margin is spent where it buys something: `kickoutRivals` names only
the substitutions that would spell a DIFFERENT kick-out code, because those are
the only misreads that move a bucket and still get accepted.

## Confidence is per role

`roles.methodBy` records how each of list / orig / sold / conc was decided
(`header`, `fill-pattern`, `position`). The reported confidence is the WEAKEST
of the roles that feed a number, not the best method used for any role — a
header that matched only "CONC" must not report 95% over two positional guesses.
Keep it that way, and keep the column map showing provenance per row.

## Locate cheaply, read narrowly

The app never reads off the full page. `src/compact.js` runs a locate pass at
source resolution, picks the columns worth reading (the header names them when
there is one), cuts those out and lays them side by side at 4×. Everything
downstream runs on that compacted surface without knowing it happened.

Two things this makes easy to get wrong:

- **Glyph width is a property of the font, not of the compacted surface.** The
  compacted grid is almost all digits, which are narrower than letters, so
  measuring there returns a smaller width and every threshold derived from it
  splits bold status letters down the middle. It is carried over from the
  locate pass on purpose.
- **Rules must be whitened in the pixels, not just the binary.** A rule that
  was full-span across the page is not full-span once the columns either side
  are removed, so it survives the crop and reappears as a stray row band.
  `buildSurface` keeps a `grayClean` canvas for exactly this.

Two surfaces means two working scales, which is why the ported code reads
`workScale()` instead of `CFG.UPSCALE`. Every one of those was already
"convert source pixels to working pixels"; only the constant changed.

## A short mark is not always a comma

A comma and a decimal point are both about three pixels of ink at 11px, and
neither survives the height filter that separates digits from punctuation — so
both reach `analyseNumericMarks` as anonymous short glyphs. They are told apart
by POSITION: a thousands separator has a multiple of three digits to its right,
a decimal point has the one or two digits of the cents.

This is load-bearing. connectMLS writes money as `254,900` and seller
concessions as `9978.71`. Assuming every short mark is a comma reads that as
`997,871` — and the grouping check *passes*, because five digits do follow one
mark — so a hundredfold concession lands in a sale-to-list ratio with nothing to
show for it. Do not "simplify" this back to counting marks.

Note the asymmetry the CONC column forces: it carries a decimal but never a
thousands separator at any length, so `readIntegerToken` enforces comma grouping
only when separators are actually present. `readPriceToken` still requires one,
because a dollar amount without a separator is a fragment.

## The form panel is the deliverable

`uadFields()` in `stats.js` returns the UAD 3.6 "Search Result Metrics" section
field for field, in the form's own order. It is the ONE source for both the
on-screen panel (`renderUad` in `app.js`) and the copied text
(`uadFieldsAsText`). Do not grow a second field list in the UI layer: two
renderers formatting the same summary is how the screen and the clipboard come
to disagree about a number, and the number here goes into an appraisal.

Each field carries a `value` and a `display`, and they are different on purpose.
`value` is what reaches the clipboard: the bare number the form's input takes,
`189900`. `display` is `$189,900`, so a figure can be checked against the
screenshot at a glance. The form draws the `$` outside the box and groups the
digits itself.

One more thing that looks like a detail and is not: nothing on that panel is an
input, and if anything ever becomes one its `change` handler must not call
`recompute()`. That rebuilds the panel the input lives in, and since `change`
fires on blur, clicking a copy button straight after typing would destroy the
button between mousedown and mouseup — the copy would silently do nothing.

## The comp list

At or below `CFG.COMP_LIST_MAX` closed sales, every sale-to-list ratio is quoted
individually as well as in aggregate — in the closed card and in the copied
report text. Two rules that are easy to break:

- **Grid order, not sorted.** Comp 1 must be the first closed sale on the
  screenshot, or the number cannot be tied back to its row.
- **Every closed sale gets a line, ratio or not.** A comp missing from a
  numbered list reads as a comp that did not exist; one with no original list
  price prints `—` and says why.

## Exports are parsed, not recognized

`src/table.js` reads a CSV or TSV export into rows of exactly the shape
`extractGrid()` produces, so `buildReport` and every renderer take it
unchanged. Several things in it look like they could be looser and should not be:

- **The header list is wider than `HEADER_LABELS`, on purpose.** The image
  matcher refuses extra labels because each is a near-tie for a pixel match;
  text has no near-ties, so `DOM` and `Close Price` are safe there. The test for
  a new label is meaning, not shape — which is why `CDOM` stays out: it survives
  a relisting and MT does not. Do not copy the file list into `HEADER_LABELS`.
- **Two columns claiming a role bind neither.** Picking the first is a coin toss
  about which number the appraiser meant.
- **A record whose field count differs from the header is kept with no values.**
  Its columns have shifted, so its "sold price" may be its list price. It must
  stay a row (unresolved, blocking) — dropping it is a silent missing sale.
- **An unparseable cell is an error, not a blank.** For CONC in particular,
  blank means zero concessions, which is a confident wrong ratio.
- **The market-time gate is narrowed to the active bucket for files only**
  (`review.source === 'file'` in `buildReport`). In a file a blank DOM is known
  to be blank; in a screenshot it may be a lost glyph. The screenshot gate is
  unchanged, and the active bucket stays gated in both because it is a form field.
- **`S` / `A` / `P` are `ocr: false`.** They exist for exports only; the
  recognizer must never be able to emit a one-letter code.

The real exports this was built against are live MLS data with agent names in
them, and are not committed. `tests/table-fixtures.js` writes the reference
grid out in both layouts instead, so exports and screenshots share one ground
truth.

## Testing

`npm test` runs everything. `npm run test:stats` is the fast loop — pure
arithmetic, no browser, about a second.

The reference test asserts **every row individually**, not just the totals. Keep
it that way: two errors that cancel out would otherwise pass.

When you change recognition, re-run `test:edge` in full. Several of those
fixtures are idempotence tests — a highlighted row, a greyscale paste, a 2×
screenshot must all give byte-identical buckets — and they catch classes of
failure nobody predicted.

To debug one fixture, the page keeps everything: `window.UAD.getResult()`
returns the surface, the columns, the clusters and the role assignment, and the
console log traces each decision (`[Grid]`, `[Header]`, `[Stat]`, `[Money]`).

## Known limits, deliberately

- A grid rendered with no `$` at all falls back to comma-grouped numbers and
  says so loudly. It is not silent, but it is weaker.
- Duplicate detection keys on the MLS number. The duplicate an appraiser
  actually hits — one property relisted under a new number — needs the address
  columns, which the app does not read.
- `HS**` / `HC**` are reported as `HS` / `HC`. The hours are read only far
  enough to prove they are digits, never far enough to print — see below.
- Without an `MT` header there is no days on market at all, and a grid whose
  layout calls that column something else gets the same answer. Widening the
  label list is one more near-tie for the whole-word matcher, which is the
  trade `vocab.js` already refuses for status codes.
- connectMLS's `MT` on a closed row is the time that sale was marketed and on
  an active row it is days on market so far. The app never pools the two: each
  bucket's median is of its own rows, and only the active one feeds the form.
