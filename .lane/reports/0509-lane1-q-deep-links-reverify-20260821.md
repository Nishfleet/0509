# Lane 1 evidence: honor `?q=` on public `/search` — already merged (reverify)

Item: "Honor `?q=` on public `/search` so shared/deep links actually run (or
honestly reject) the query" (scout 2026-08-09).
This lane re-verifies the resolution on fresh origin/main tip `422fbd55`; no
product code change was warranted.

## Resolution

The item is already merged to origin/main:

- PR #565 — commit `f1327522` "fix(search): honor ?q= deep links on public
  /search so shared queries actually run" (merged 2026-08-09, the scout's own
  flag date), plus the pre-merge commit `a90bea49` on `fix/search-honor-q-param`.
  `f1327522` is an ancestor of main HEAD `422fbd55` (verified via
  `git merge-base --is-ancestor f1327522 origin/main`).

Prior lane evidence recorded the same verdict:

- 2026-08-10 lane 1 — `99e80367` (evidence branch never merged; record lives
  in the git history).
- 2026-08-12 lane 7 — `c5d4e223` "docs(lane): record evidence that public
  /search ?q= deep links already landed via PR #565".

## What the merged code does

- `app/lib/normalize.ts` — `parseSearchParams()` resolves the search term as
  `query ?? q ?? ''`. `q` is the conventional shared-link alias; an explicit
  `query` always wins so canonical product links never change meaning; empty
  or whitespace `q` is treated as absent.
- `app/lib/normalize.ts` — `fingerprintSavedQuery()` runs over the resolved
  filters, so `/search?q=nykaa` and `/search?query=nykaa` produce the same
  cache fingerprint and hit the same warm entry.
- `app/routes/search.tsx` — the public loader feeds `url.searchParams` into
  `parseSearchParams`, so a logged-out visitor's `?q=` link executes live
  discovery (read-only, rate-limited, warmed) instead of idling on the empty
  form; an empty `q` stays on the idle pre-search page.
- `app/lib/competitor-website.ts` — `applyWebsiteSearchFallback()` only fills
  the query when it is blank, so a `?q=` term on a shared link is never
  clobbered by a `website=` param.
- Regression pins: `tests/normalize.test.ts` (alias precedence, empty/whitespace
  q, fingerprint parity) and `tests/search.route.test.ts` (logged-out `?q=`
  deep link runs discovery, `?q=` with no term stays idle).

## Verification on this tip (2026-08-21)

- `NODE_ENV=development vitest run tests/normalize.test.ts tests/search.route.test.ts`
  → **2 files / 78/78 passed**.
- Named pin: "runs read-only live discovery for a logged-out visitor via the
  q= shared-link alias" — passes on tip `422fbd55`.
- `git merge-base --is-ancestor f1327522 origin/main` → fix is in origin/main.
- `git diff --check` clean (no product code touched by this lane).

## Files

- `.lane/reports/0509-lane1-q-deep-links-reverify-20260821.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
