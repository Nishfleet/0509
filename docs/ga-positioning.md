# GA Positioning

**Status:** LIVE for Scout, Starter, and Agency self-serve. Email delivery, Dodo
billing, and Workflow-based monitoring fan-out are live in production
(`docs/final-self-serve-ga-scorecard.md` is the dated release verdict;
`CLAUDE.md` → "Production Reality" is the canonical current-truth pointer for
what is deployed). WhatsApp and Slack delivery are dormant and barred from GA
claims — see "What stays honest" below.

This doc is the positioning pointer. The live GA verdict lives in
`docs/final-self-serve-ga-scorecard.md`; do not restate that verdict here, point
at it. When the two disagree, the scorecard + `CLAUDE.md` win and this doc gets
fixed.

## Target positioning

- **Product name:** Five to Nine
- **Domain:** 0509.io (primary)
- **Promise:** See what changed, with proof.
- **Availability:** Scout, Starter, and Agency self-serve (Agency only after fan-out proof)

## Copy status (reconciled 2026-08-25)

| Surface | Status |
|---------|--------|
| Homepage announcement | GA live — "Early access" framing retired with the Scout/Starter/Agency release |
| Homepage honest note | GRADUATED 2026-08-12: canary green (Gate C pass on live worker) — no beta caveat in served hero copy; freshness-labeling note retained |
| `/status` | Reflects GA availability per plan |
| README launch framing | GA-ready; see `docs/final-self-serve-ga-scorecard.md` |

## What stays honest

- Homepage proof brief renders real cached captures; an honest no-live-proof state replaces any sample fixture.
- Live search results labeled fresh/recent/sample.
- No WhatsApp or Slack delivery claims in GA copy — both are dormant, non-GA channels barred from customer truth until a provider is configured and Nish un-gates them.
- No unlimited monitoring claims — evidence checks are metered.
- Screenshot and landing-page-change-history claims are data-gated; see `docs/customer-claim-audit-table.json` (AUDIT-SAVES-SCREENSHOTS, AUDIT-LANDING-PAGE-CHANGE-HISTORY).

## Source of truth

- Live GA verdict: `docs/final-self-serve-ga-scorecard.md` (dated release evidence).
- Deployed state + bindings: `CLAUDE.md` → "Production Reality" and `wrangler.jsonc`.
- Claim-by-claim reality check: `docs/customer-claim-audit-table.json`.
- `docs/ga-launch-scorecard.md` is SUPERSEDED — do not use it as the live verdict.
