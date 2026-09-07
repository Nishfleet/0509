# /pricing tier-card grid: Free card render-only fix (issue #1499)

**Status: implemented; pending PR merge.**

Branch: `claim/issue-1499`
Base: `origin/main` at `4b3336f8` (post #1531)
Issue: Nishfleet/0509#1499

## Item

The /pricing tier-card grid omitted the Free plan. The "no card required"
promise lived only in the prose note below. Buyer scans saw paid prices
before ever seeing the free option.

## Verdict

Render-only change in `app/components/pricing-section.tsx`. Adds a
`<article class="f9-commerce-card">` for the Free plan as the FIRST card
in the grid, ahead of `pricingPlans.map(...)`. No billing or pricing-logic
change. No new SKU. No new identifier. No new D1 schema.

Funnel plumbing (mirror of the MagicBrief migration marker):
- `PRICING_FREE_SIGNUP_SOURCE = "pricing-free"` allowlisted constant.
- New event kind `pricing_free_card_clicked` → operation
  `funnel_pricing_free_card_clicked`, route `signup`.
- The raw `source=pricing-free` query value is compared against the
  allowlisted constant server-side; the raw value is never stored.

## Diff summary (9 files, +225 / −8)

- `app/components/pricing-section.tsx` — Free card markup, no other card
  changed.
- `app/lib/funnel-measurement.server.ts` — new event kind + allowlisted
  source + dispatch branch.
- `app/lib/signup-source.ts` — `PRICING_FREE_SIGNUP_SOURCE` added to
  `ALLOWED_SIGNUP_SOURCES`.
- `docs/funnel-measurement-spec.md` — new event row in §3.2 and a
  paragraph mirroring the MagicBrief marker note.
- `tests/integration/pricing.spec.ts` (new) — the regression guard.
- `tests/funnel-measurement.test.ts` — pricing-free kind selection.
- `tests/signup-source.test.ts` — allowlist entry + URL-fragment
  rejection.
- `tests/marketing-pricing-latency.test.ts` — four-card cadence
  expectations (Free stays on `free, forever`).
- `vite.config.ts` — include `tests/integration/pricing.spec.ts` in the
  `node` project.

## Verification on this branch

- `pnpm vitest run tests/integration/pricing.spec.ts` — 4 passed in 497 ms.
- `pnpm vitest run tests/funnel-measurement.test.ts tests/signup-source.test.ts tests/marketing-pricing-latency.test.ts` — 41 passed in 4.38 s.
- `pnpm vitest run --configLoader runner --project node` — 6381 passed in 129.58 s (530 files).
- `pnpm tsc -b` — exit 0.
- `sgscan` — `No new security findings.`

## Live termination (after merge + deploy)

```
curl -sS https://0509.io/pricing | grep -c '<span>Free</span>'              # 1
curl -sS https://0509.io/pricing | grep -c '<span>Scout</span>'             # 1
curl -sS https://0509.io/pricing | grep -c '<span>Starter</span>'           # 1
curl -sS https://0509.io/pricing | grep -c '<span>Agency</span>'            # 1
```

## Out of scope

- Pricing data, billing, Dodo SKUs, `pricingPlans` array, JSON-LD — all
  unchanged.
- `ld-pricing-note` prose paragraph — unchanged (the card mirrors it).
- No new label, no orchestrator handoff.
