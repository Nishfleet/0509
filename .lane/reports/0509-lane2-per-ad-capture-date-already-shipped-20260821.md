# Lane 2 evidence: per-ad capture date on brand-page ad wall cards — already shipped

Item: "Brand-page ad wall cards show no per-ad capture date, so months-old
seasonal creatives (Diwali/Navratri/Pay Day) r[emain] ..." (dispatched
2026-08-05, researched 2026-08-21).

This lane records resolution evidence. No product code change was warranted:
the item's assumption is false against the live system — the defect was fixed
and merged to origin/main nine days before this lane dispatched, and the fix
sits in the current main HEAD this worktree started from.

## Resolution

- PR #686 — commit `c9dcda0d` "fix(ads): show per-ad capture date on
  brand-page ad wall cards" (2026-08-12), an ancestor of main HEAD
  `422fbd55` (2026-08-21) that this worktree is at.

## What the merged code does (verified on this tip)

- `app/lib/ad-display.ts` — [`formatAdCaptureSinceLabel`] renders the per-ad
  capture-date pill "Since 24 Oct 2025" from the ad's real `firstSeenAt`,
  in pinned en-GB/UTC copy (SSR/client parity rule). Null — no date — only
  when first-seen proof is missing, unparseable, or in the future (clock-skew
  guard). A months-old seasonal creative therefore reads as dated instead of
  current rotation.
- `app/components/ads/brand-ad-wall.tsx` — every visible card renders the
  capture-since pill in the card's pill row (next to the "Running N days"
  longevity badge), keyed off the same `firstSeenAt`.
- Data path: the wall's `AdRecord[]` comes from
  `loadBrandPageCacheSnapshot` → `toUsableSnapshot`, whose cached payload ads
  carry `firstSeenAt` end to end (populated by the discovery cache read in
  `app/lib/ad-persistence.server.ts` `firstSeenAt: row.first_seen_at ??
  raw.firstSeenAt`). No per-ad display date can be missing when the creative
  has first-seen proof.

## Evidence of correctness on this tip (re-run this lane)

- `npx vitest run tests/ad-display.test.ts tests/ads-brand-page.render.test.tsx`
  → **2 files, 32 tests passed**:
  - `tests/ad-display.test.ts` pins `formatAdCaptureSinceLabel`: "Since 1 Jun
    2026", "Since 24 Oct 2025", null on missing/unparseable/future dates.
  - `tests/ads-brand-page.render.test.tsx` "dates every visible wall card with
    its own capture date, so months-old creatives read as old" — asserts all 5
    visible wall cards carry the ad's own "Since …" pill, and the twin test
    asserts no pill when first-seen proof is missing.

## Files touched by this lane

- `.lane/reports/0509-lane2-per-ad-capture-date-already-shipped-20260821.md`
  — this evidence record (the only change; claim matches).

The shared `.lane/report.md` is untouched.