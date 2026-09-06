# GA Positioning

This doc is the positioning pointer for the self-serve GA surfaces. It does NOT
state enablement status — that verdict lives in
`docs/final-self-serve-ga-scorecard.md` (dated release evidence) and in
`CLAUDE.md` → "Production Reality" (the canonical current-truth pointer for what is
deployed). Never put an enablement verdict word in this header; when this
positioning copy and the scorecard disagree, the scorecard + `CLAUDE.md` win and
this doc gets fixed.

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
- No WhatsApp delivery claims in GA copy — WhatsApp is dormant, non-GA, barred from customer truth until a provider is configured and Nish un-gates it. Slack and Teams incoming-webhook delivery of confirmed changes is a live Starter+ channel (2026-08-12 decision); the legacy Slack export/API/MCP surface remains dormant and unclaimed.
- No unlimited monitoring claims — evidence checks are metered.
- Screenshot and landing-page-change-history copy matches live capture coverage: source-linked proof always, a screenshot only when the capture includes one, and change history that fills as scheduled watches complete. See `docs/customer-claim-audit-table.json` (AUDIT-SAVES-SCREENSHOTS, AUDIT-LANDING-PAGE-CHANGE-HISTORY).

## Source of truth

- Live GA verdict: `docs/final-self-serve-ga-scorecard.md` (dated release evidence).
- Deployed state + bindings: `CLAUDE.md` → "Production Reality" and `wrangler.jsonc`.
- Claim-by-claim reality check: `docs/customer-claim-audit-table.json` +
  `docs/customer-claim-surface-registry.json` → `rows` (mechanical check:
  `npm run verify:claims`).
- `docs/ga-launch-scorecard.md` is SUPERSEDED — do not use it as the live verdict.
