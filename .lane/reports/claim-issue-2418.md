# Watchlist setup: auto-resolve target, infer tracking role (issue #2418)

Branch: `claim/issue-2418`
Base: `origin/main`

## What changed

- `app/components/watchlists/watchlist-setup-card.tsx`: the Competitor/My-brand
  radio is gone and the website field is folded into the single "Brand or
  search term" input — it prefills the tracked URL for website targets and
  the target label for keyword targets. Name stays prefilled-but-editable.
- `app/components/watchlists/competitor-detail.tsx`: callsite updated for the
  dropped `selectedTrackingRole` prop (the card no longer takes it).
- `app/lib/watchlist-route-actions.server.ts` (`update-watchlist` intent): the
  posted `targetLabel` is run through `parseSearchInput` — a domain/URL
  resolves to the tracked website with the advertiser label derived from it,
  a term stays a keyword target. `trackingRole` is now inferred, not chosen:
  `self` only when the target's registrable domain equals the workspace
  `brandWebsite`'s registrable domain, else `competitor`; saved_query targets
  keep their stored role. A posted `competitorWebsite` field still wins so
  stale renders of the old two-field form keep working. Each save emits one
  structured `watchlist_setup_save` log line with `prefill_match` and the
  list of fields the customer edited (`name`, `target`).
- `tests/watchlists.route.actions.test.ts`: new coverage for the single-field
  domain resolve, domain-based self inference, keyword targets, and the
  prefill_match log line; the two pre-existing tracking-role tests updated to
  the inferred-role contract.

## Judge edits applied

- Handler path named exactly (`watchlist-route-actions.server.ts`).
- Name field kept; only the radio deleted; website folded into the domain
  input.
- `trackingRole=self` = same registrable domain as workspace `brandWebsite`.
- Acceptance metric = one structured log line per save with
  `prefill_match=true|false` plus the differing fields.

## Verification

- `npx vitest run --configLoader runner --project node --changed origin/main`
  — 12 files, 195/195 tests pass (incl. the 4 new/updated watchlist action
  tests).
