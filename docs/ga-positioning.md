# GA Positioning (draft — gates not passed)

**Status:** NOT LIVE — do not publish as customer truth until scorecard verdict upgrades.

## Target positioning (post-gate)

- **Product name:** Five to Nine
- **Domain:** 0509.io (primary)
- **Promise:** See what changed, with proof.
- **Availability:** Scout, Starter, and Agency self-serve (Agency only after fan-out proof)

## Copy changes deferred from beta

| Surface | Current | GA target |
|---------|---------|-----------|
| Homepage announcement | "Early access" | "Now available" or remove pill |
| Homepage honest note | Meta ads beta caveat | GRADUATED 2026-08-12: canary green (Gate C pass on live worker) — no beta caveat in served hero copy; keep the freshness-labeling note |
| `/status` | Lists limited surfaces | Reflect GA availability per plan |
| README launch framing | Pilot-ready language | GA-ready when ops gates green |

## What stays honest

- Homepage proof brief renders real cached captures; an honest no-live-proof state replaces any sample fixture.
- Live search results labeled fresh/recent/sample.
- No WhatsApp delivery claims until provider configured.
- No unlimited monitoring claims — evidence checks are metered.

## Gate to publish this doc externally

All must be true:

1. `docs/ga-launch-scorecard.md` verdict = GA LIVE (full or Scout+Starter only).
2. `npm run launch:readiness` exits 0.
3. Owner actions 1–5 in scorecard completed with evidence.
4. Phase 10 commit removes "Early access" and updates `/status`.
