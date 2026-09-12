# Lane evidence — claim/issue-3003 (Nishfleet/0509#3003)

## Task

The fleet visitor probe (fleet-ops `bin/fleet-visitor-probe`, run by the
hourly judge sweep) reported `manifest=404 dup_routes=4 public_repo_leaks=18`
on 2026-09-11T17:22Z. Accept: the visitor line reads
`manifest=200 dup_routes=0 public_repo_leaks=0`.

## Finding: already resolved on main before this claim

All three fixes landed through earlier issues' PRs while this issue's claim
branch was being recycled (the claim was released and re-claimed four times;
the salvage from the first run was itself merged as PR #3101):

- `manifest=404` -> `200`: `0af792432` "fix(seo): serve /site.webmanifest and
  link it from the root document" (PR #3001, issue #2960) — added
  `public/site.webmanifest` plus the `{ rel: "manifest" }` link in
  `app/root.tsx`, guarded by `tests/seo/site-webmanifest.test.ts`.
- `dup_routes=4` -> `0`: `717de37f8` "fix(seo): 301 non-canonical public
  paths to lowercase, slash-free URLs" (issue #2955) — `canonicalPathRedirect`
  in `workers/app.ts` runs before route handling; guarded by
  `tests/canonical-path.test.ts` which covers `/Pricing` and `/pricing/`.
- `public_repo_leaks=18` -> `0`: `a7739ed1e` "privacy: scrub personal emails
  and internal agent notes from the public tree" (#2954) removed the personal
  addresses, and PR #3101 (`8735cd334` + `6074cfafc`, built from this very
  claim branch's salvage) renamed the `docs/*audit*` files to leak-free names
  (`customer-journey-audit.md` -> `ga-customer-journey.md`,
  `customer-claim-audit-table.json` -> `customer-claim-table.json`) and
  extended `tests/docs-no-agent-artifacts.test.ts` to gate the probe's leak
  classes (the two `VISITOR_PERSONAL_EMAILS` defaults, `MEMORY.md`,
  `agent-state/`, `design-qa*`, `docs/*audit*`, `.lane`) in CI.

## Live verification (real probe run, 2026-09-12)

`bash bin/fleet-visitor-probe` (fleet-ops deploy clone, real curl + gh):

```
visitor: https_redirect=301 home_ttfb_ms=1257 home_edge=NONE search_ttfb_ms=6151 manifest=200 dup_routes=0 public_repo_leaks=0
```

Acceptance line reads `manifest=200 dup_routes=0 public_repo_leaks=0` — green.

Field-by-field spot checks behind the probe's numbers:

- `GET https://0509.io/site.webmanifest` -> 200, valid JSON manifest
  (`name: "0509"`, icons resolve to files that exist in `public/`).
- `GET /Pricing`, `/pricing/`, `/Search`, `/search/` -> each 301 to the
  canonical lowercase slash-free route (zero serve a 200 duplicate).
- `gh api repos/Nishfleet/0509/git/trees/HEAD?recursive=1` greped with the
  probe's own pattern (`(^|/)MEMORY\.md$|^agent-state/|(^|/)design-qa|^docs/[^/]*audit`)
  -> 0 hits.
- `gh api search/code` for each of the two `VISITOR_PERSONAL_EMAILS`
  defaults in `repo:Nishfleet/0509` -> `total_count: 0` for both; a
  `git grep` of the origin/main tree for the exact addresses also returns 0.
  (Addresses deliberately not reproduced here — the tracked-files guard is
  built from parts for the same reason: quoting them would re-leak.)

## What this PR adds

The lane evidence record only. Every fix class the issue named already has a
detector (the hourly probe itself) and an in-repo CI guard (the three test
files above); no product diff was needed. `home_edge=NONE` on the same line
is tracked separately as issue #2950 and is out of scope here.
