# Commercial Ad Dogfood Set

## Purpose

Use this set to validate the browser-backed commercial ad discovery path before widening customer trust.

The goal is not broad market coverage. The goal is to verify the full operator loop:

- live discovery
- cache fallback
- proof-first event confirmation
- conservative delivery
- operator visibility when discovery degrades

## Internal Account

- account email: `me@inish.in`
- channels:
  - email: `me@inish.in`
  - WhatsApp: `+91XXXXXXXXXX` (redacted: real number lives in the credential store, not the repo)

## Initial Watchlists

- `adspy`
- `bigspy`
- `adflex`

These are intentionally commercial-ad-heavy competitors and should be used to validate that the product can detect live ad changes without depending on the official Meta API.

## Expected Discovery Behavior

- default live provider: `meta_library_browser`
- official Meta API: diagnostic-only
- demo mode: explicit only, never silent
- stale cache fallback: allowed when the live browser path fails
- no cached result should be presented as a fresh live fetch

## Per-Run Checks

For each dogfood refresh, verify:

1. the watchlist no longer reports demo mode when Browser Run is configured
2. the search and watchlist surfaces clearly show whether results are live, cached, diagnostic, or demo
3. discovery failures appear in `/app/ops`
4. cache-only provider state appears in `/app/ops` when live discovery fails but stale cache exists
5. proof capture only runs when the proof policy says it should
6. confirmed events still compare against the last successful proof
7. delivery stays conservative when discovery is degraded

## Operator Checks

The operator surface should answer:

- what is failing right now
- whether discovery is degraded or cache-only
- which watchlists are affected
- whether proof or delivery failed after discovery succeeded

## Launch Gate For This Replacement

Do not widen customer usage until the dogfood set shows:

- repeated live discovery success through Browser Run
- cache fallback only on genuine provider issues
- no silent demo fallback
- no duplicate sends caused by repeated degraded runs
- trustworthy watchlist messaging about source health
