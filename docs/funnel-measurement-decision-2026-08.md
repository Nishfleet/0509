# Funnel Measurement Decision — 2026-08

Filed by BET 10 reconciliation (issue #1278). This doc records the funnel-measurement
decision request in one place: the production state, the §8 gates and their status, the
two resolution paths, and which path this PR takes.

## (i) Current production state

`wrangler.jsonc` once set `FUNNEL_MEASUREMENT_ENABLED: "1"` — the gate ON in production
config — while `docs/ga-metrics.md` documented collection as NOT live. The docs and the
live config contradicted each other in plain view of any privacy-concerned buyer.

`app/lib/funnel-measurement.server.ts` reads `FUNNEL_MEASUREMENT_ENABLED` and emits
`funnel_*` records only when the value is exactly `1`/`true`/`yes`/`on`
(case-insensitive). Any other value — including `"0"` — leaves measurement disabled.
GPC (`Sec-GPC: 1`) requests record nothing even when the gate is on.

## (ii) Spec §8 gates and their status

`docs/funnel-measurement-spec.md` §8 requires ALL of these before any collection is
enabled. As of 2026-09-04 none are cleared:

| Gate | Status |
|---|---|
| 1. Privacy/legal review | ⛔ not done |
| 2. Owner approval (incl. retention period) | ⛔ not done — `[NISH]` |
| 3. Approved implementation PR | ✅ exists (`app/lib/funnel-measurement.server.ts`) |
| 4. Focused tests | ✅ exist (`tests/funnel-measurement.test.ts`) |
| 5. Policy-surface parity review (privacy/terms copy) | ⛔ not done |
| 6. Redaction test | ⛔ not done |
| 7. Retention/delete test | ⛔ not done |
| 8. Post-enable canary | ⛔ not done |

## (iii) The two resolution paths

- **Path A — gate-cleared-and-keep:** clear the §8 gates (privacy/legal review, owner
  approval, policy-surface copy, tests, canary), then keep `FUNNEL_MEASUREMENT_ENABLED`
  on. Only Nish can clear the owner-approval gate; the policy-surface copy is a legal
  change. This path is `[NISH]`-reserved.
- **Path B — flip-to-off:** correct the config so docs and config agree that collection
  is off, and defer enablement until the gates clear. This is the worker default when
  the worker is not Nish; it needs no owner input to be honest.

## (iv) Path taken in this PR

Path B — **flip-to-off**. The 2026-09-04 change:

- `wrangler.jsonc` sets `FUNNEL_MEASUREMENT_ENABLED: "0"` (the gate stays off).
- `docs/ga-metrics.md` §"Still required before enablement" now reads
  "Enablement deferred; flag currently off in production."
- Re-enablement once the §8 gates are cleared is tracked in issue #1590; the
  audit rows (`docs/customer-claim-audit-table.json` → AUDIT-FUNNEL-MEASUREMENT and
  `docs/customer-claim-surface-registry.json` → rows) record the off state and point at
  #1590.

Rollback: revert `wrangler.jsonc:87` to `"1"` and the doc edits in a single PR — no D1,
no Durable Object, no KV, no R2 changes.