## Subdomain signals via Certificate Transparency (crt.sh) — issue #2198

Replaces the seam (#2218) stub with a real subdomains source: it watches
Certificate Transparency logs (crt.sh) for a tracked competitor's registrable
domain and alerts on new public subdomains, which are often the first public
signal that a competitor is standing up a new product surface.

### What shipped

- `app/lib/sources/subdomains/subdomain-signals.server.ts` — `fetchSubdomains(domain)`:
  one crt.sh fetch (60s budget, no retry in-app), normalize (lowercase, split
  `name_value` on newlines, strip a leading `*.`, drop the apex and anything
  not ending in `.<domain>`, dedupe by min `not_before`), classify
  `kind: "internal" | "public"` (regex documented in-file), cap at 5,000
  entries with `truncated: true`. Treats 5xx/timeout/non-JSON/empty-domain as
  `{ unavailable: true, reason }`.
- `app/lib/sources/subdomains/subdomain-snapshot.server.ts` — snapshot payload
  + `diffSubdomainSnapshots`: returns `SourceChange[]` **only** for new public
  names and `[]` on a first (baseline) snapshot; internal names live in the
  payload, never in diff output (judge edit batch 2). Unavailable never blocks.
- `app/lib/sources/subdomains.server.ts` — the real adapter (was the stub):
  `implemented: true`, cadence `daily` (no new schedule; crt.sh politeness),
  `requiresEnv: () => true`, resolves the registrable domain from the
  watchlist, delegates fetch + diff, `Section` wired.
- `app/components/sources/subdomains.tsx` — the Section (renders inside the
  seam's source section): count, newest 10 public names with firstSeen, an
  expandable list of internal names, and a one-line explanation.
- `tests/fixtures/crtsh/**` + `tests/sources/subdomains-*.test.ts` — fixtures
  with wildcards/duplicates/apex/unrelated names and unit tests for
  classification, baseline-never-alerts, new-public-alerts, new-internal-no-
  alert, unavailable, truncated.

### Scope note (two shared test files)

Per the ownership note, seam shared **runtime** files (`registry.server.ts`,
`presence-source-coverage.server.ts`, `types.ts`, `env.server.ts`, the claim
table, migrations) were not edited. The seam's `implemented: true` flip this
ticket requires necessarily invalidates the hardcoded "subdomains is a stub"
assertions in `tests/sources/registry.test.ts` and
`tests/presence-source-coverage.test.ts`, so those two test files were updated
to derive stub state from the registry rather than hardcode the list — kept
robust so the parallel source tickets (#2181/#2189/#2194/#2199) don't conflict
as they land one at a time. The Seam's own claim-table row stays the seam's
("not live - stub"); #2188 flips it on production proof. Per do:4 I did not
edit the claim table.

do:5 (crWorker can reach crt.sh) — verified live from the worker environment:
`GET https://crt.sh/?q=%25.notion.so&output=json&exclude=expired` returned
`200` / `application/json` / 265 entries. (The full preview-deploy fetch is
available once deployed under #2188's production proof; I cannot deploy from
this worker.)

### Verification

- `npx vitest run --configLoader runner --project node <5 touched test files>`
  → 62 passed. Full `--project node` suite → 665 files / 7917 tests passed.
- `fleet-no-agent-names-check --commit-range origin/main..HEAD` → OK.
- `fleet-review-arm-check` → exit 0 (senior seat usable).

run-proof: node vitest project, 5 subdomain/registry/coverage test files
(green), full node project (green).

research: the crt.sh endpoint contract and the existing Meta watch-event path
come from the issue's own verified request and the seam (#2218) in-repo code;
no new dependency. Not a hand-build of an existing seam helper.

help-first: no new CLI; implementation-only PR within the seam's existing
source adapter shape.

loose-ends: none intentional beyond the below reviewer buckets.

### Reviewer round (one)

reviewer seat: cursor/cursor-grok-4.6-high

Review-adjudication buckets for findings from the single reviewer round:
- Act on: none
- Consider: see notes kept in PR thread
- Noted: —
- Dismissed-with-reason: —

Closes #2198