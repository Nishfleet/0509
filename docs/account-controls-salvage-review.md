# Account Controls Salvage Review

Date: 2026-06-30
Branch reviewed from: `codex/market-desk-first-value-20260628`

## Scope

The Market Desk plan called for a review of `codex/0509-saas-account-controls-20260622` before applying any account-control improvements.

## Live Repo Result

No matching account-controls branch was available in the local or remote repository refs at review time.

- `git branch -a | rg "0509-saas-account-controls|account-controls|saas-account|account"` returned no matches.
- `git ls-remote --heads origin "*account*" "*saas*" "*controls*"` returned no matches.

## Salvage Decision

No unmerged account-controls commits were inspected or applied because the referenced branch could not be found.

Safe account-control clarity already present in `main` was preserved:

- Signed-in support cases remain the fallback for billing changes, cancellation, deletion, security reports, migration, and setup help.
- Subscription mutations and payment changes remain gated; this branch does not add direct subscription mutation behavior.
- Customer-facing support success copy now only claims support was notified after the alert path has succeeded or was already sent.

## Deferred

If the missing branch is restored later, review it against these rules before applying anything:

- Keep billing and subscription changes behind the existing Dodo/support gates.
- Do not ship customer-visible claims about hosted portal changes unless the runtime setting is verified.
- Do not expose private auth, billing, provider, or workspace material.
- Prefer small copy or status improvements over new account mutation paths unless the existing repo gates already support them.
