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
- Unreadable statuses land in `unresolved`, never in a bucket.
- Above the provisional threshold, the copy buttons are disabled.
- Every skipped row increments a named counter that reaches the UI.

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
rather than an obvious failure. `CFG.TOKEN_GAP_GLYPHS` and
`CFG.GLYPH_SPLIT_RATIO` exist because of this.

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
- `HS**` / `HC**` (kick-out hours) normalize to their base code but are not in
  the OCR vocabulary, because the suffix varies. They can be set by hand.
