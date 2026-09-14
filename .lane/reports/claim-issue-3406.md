# Triage report — claim/issue-3406

Checkout: `5b14f14e8` (origin/main) + wip commits; branch `claim/issue-3406`.
Phase-1 triage ran on `7ecb3c6dd` by the prior worker (report below); all
verdicts re-verified on this head by the resume worker.

Vitest invocation per environment constraint:
`npx vitest run --configLoader runner --project node <file>` (node project only).

## Resume-worker re-verification (head `04cc5f932` + the #2703 remnant diff)

Command:
`npx vitest run --configLoader runner --project node tests/public-status-counters.test.ts tests/marketing-proof-brief.test.tsx tests/brands-category.loader.test.ts tests/digest-partial-failure-status.test.ts tests/dashboard.route.test.ts tests/e2e-route-guards.test.ts tests/e2e-harness-guard.test.ts tests/e2e-local-fixture.test.ts tests/customer-claim-surface-registry.test.ts --reporter=dot`

Observed: `Test Files 9 passed (9) / Tests 157 passed (157)` — the four named
files all green on the current head, and the dashboard/route-guard/surface
suites stay green with the `app.dashboard.tsx` link change.
`tests/app-redirects.test.ts` separately: 17/17 pass (covers the
/app/digests → /app/briefs stub).

Live redirect proof (`npm run e2e:serve:local`, fixture server on 4179,
authenticated via `f9_e2e_fixture=e2e-free-onboarded` + `x-0509-e2e-test-mode: 1`):

```
GET /app/digests              -> 302 http://127.0.0.1:4179/app/briefs
GET /app/digests?firstrun=1   -> 302 http://127.0.0.1:4179/app/briefs?firstrun=1
GET /app/briefs               -> 200
```

So `page.goto("/app/digests")` lands the browser on `/app/briefs`, and the
spec now asserts exactly that URL.

---

## #3212 — clock-rot, tests/public-status-counters.test.ts:33

**Verdict: PROOF-GREEN** (re-verified on `5b14f14e8`+wip; original proof sha `7ecb3c6dd`)

Command: `npx vitest run --configLoader runner --project node tests/public-status-counters.test.ts`

Observed:
```
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

The named failure no longer reproduces. The file has been rewritten to be
clock-independent: `tests/public-status-counters.test.ts:36` pins the clock with
`vi.useFakeTimers({ now: new Date("2026-09-08T00:00:00.000Z") })` and line 44 uses
`new Date(Date.now() - 60 * 60 * 1000).toISOString()` for `last_digest_sent_at`
instead of the hardcoded `2026-09-05T04:00:52.000Z`. The stale "stalled vs recent"
assertion is gone.

## #3097 + #3124 + #3081 — marketing-proof-brief homepage copy family

**Verdict: PROOF-GREEN** (re-verified on `5b14f14e8`+wip; original proof sha `7ecb3c6dd`)

Command: `npx vitest run --configLoader runner --project node tests/marketing-proof-brief.test.tsx`

Observed:
```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

The assertion (now at `tests/marketing-proof-brief.test.tsx:241`,
`expect(markup).toContain("was the hook on 6 Meta ads")`) passes. Root cause of the
original red is resolved in the fixture, not the component: `withCaptureAge({ hoursAgo: 4 })`
(test lines 232, 252-268) keeps `fetchedAt` relative to `Date.now()` inside
`PROOF_CAPTURE_FRESH_DAYS = 30` (`app/routes/marketing.tsx:326`), so `heroCaptureStale`
is false and the `ld-proof-attrib` span renders the fresh-capture branch.

What the span renders now (`app/routes/marketing.tsx:623-634`):
- fresh capture (the passing fixture): `"was the hook on 6 Meta ads linking to nykaa.com. We saved every one."` (`{proofBrief.freshForLiveClaim ? "is the hook on" : "was the hook on"} {adCount} Meta ads linking to {website}. We saved every one.`)
- stale capture (>30d): `"is a hook on record across {adCount} Meta ads linking to {website}. We saved every one."` — the copy the old fixed-date fixture had drifted into.

## #2865 — order-dependent 404 test, tests/brands-category.loader.test.ts

**Verdict: FIXED-BY-5b6dcc811** (`test(brands-category): make the sitemap-mock rejection override deterministic (Closes #2865)`)

Command: `npx vitest run --configLoader runner --project node tests/brands-category.loader.test.ts`

Observed:
```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

`git log --oneline --since=2026-09-10 -- tests/brands-category.loader.test.ts app/routes/brands.$category.tsx`
shows the file changed: `5b6dcc811` (test file only, 15 lines touched) plus later
unrelated commits (`ab70fc9e1` category-registry coverage, `56b61479c`).

The order-dependence defect described in the issue is gone. `beforeEach`
(`tests/brands-category.loader.test.ts:17-44`) registers ONE `~/lib/sitemap.server`
`vi.doMock` that delegates to a per-test mutable `loadIndexableBrandPageEntries`
function, with `vi.resetModules()` in both `beforeEach` and `afterEach`. The 404 test
(`tests/brands-category.loader.test.ts:106-126`) now swaps behaviour via
`loadIndexableBrandPageEntries = () => Promise.reject(new Error("D1 hiccup"))` instead
of re-`doMock`ing the same specifier — exactly the fix shape the issue prescribed.

## #2797 — flaky digest-partial-failure-status.test.ts

**Verdict: FIXED-BY-7533fc018** (`test(digest-partial-failure-status): one plan.server mock for the file — ends the orchestration re-entry flake`, 2026-09-11)

Command: `npx vitest run --configLoader runner --project node tests/digest-partial-failure-status.test.ts`

Observed (single local run, expected pass — flake signature):
```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

Code inspection: the timing-sensitive shape that caused the flake is removed. The
assertion itself is unchanged — `tests/digest-partial-failure-status.test.ts:577-580`
still does `const deliverWeeklyDigest = await runScheduledCycle(null); expect(deliverWeeklyDigest).toHaveBeenCalledTimes(1);`
— but the race source is gone: a single shared `planServerMock` (spy + `PLAN_LIMITS`
fixture) is registered once in the file-level `beforeEach` (lines 158-175), and
`runScheduledCycle` no longer registers a second `~/lib/plan.server` factory.
`git show 7533fc018` documents the mechanism: under CI load the dynamic import
sometimes resolved the first (PLAN_LIMITS-less) mock, the scheduled job died with
"No PLAN_LIMITS export is defined on the mock" before `deliverWeeklyDigest` ran, and
the assertion saw 0 calls; reproduced 2/24 under parallel load before, 30/30 after.

Shard config unchanged: `.github/workflows/ci.yml` still runs the same 4
`codex-node-checks-shard-{1..4}` jobs with `--shard=N/4`; no per-file retry added
(none needed — the mock race was the defect, and it is removed).

## #2703 — Gate-B journey-3 stale /app/digests assertion

**Verdict: FIXED BY THIS PR** (primary Gate-B failure already fixed by `0e783c6d5`;
this branch lands the same-pattern remnant the issue scoped in)

File:line evidence:

- `e2e/journey-3-release.spec.ts:552` — FIXED by `0e783c6d5`
  (`fix(e2e): assert the folded /app/briefs URL in journey-3 first-brief arc`):
  now `await expect(page).toHaveURL("/app/briefs?firstrun=1");`. The deploy-blocking
  assertion named in the issue no longer reproduces.
- `e2e/local-authenticated.spec.ts:882` — **fixed in this branch**:
  `toHaveURL(/\/app\/digests/)` → `toHaveURL(/\/app\/briefs/)` after
  `page.goto("/app/digests")`. Live-verified: authenticated GET on the local
  e2e server returns `302 -> /app/briefs`, so the browser lands on `/app/briefs`
  and the assertion now checks the truth.
- `e2e/local-authenticated.spec.ts:611` — same-file remnant caught by the
  senior review round: the sidebar-walk table row `{ label: "Deliver",
  path: "/app/digests", direct: true }` feeds a
  `toHaveURL(url => url.pathname === route.path)` check at :716 — red under
  the 302. Path now `/app/briefs`; the :607 comment updated to match.
- `e2e/local-authenticated.spec.ts:92` — `conditionalPrimaryRoutes` carried
  `/app/digests`, which can never be the landed pathname post-redirect; now
  `/app/briefs`, restoring the working-header classification the renamed
  route always had (a wrong membership would assert `.f9-wk-head` count 0 on
  the briefs page wherever the helper runs).
- `tests/dashboard-activation.route.test.ts:153` — senior review caught this
  pinning the dashboard link's old href; now expects
  `href="/app/briefs?firstrun=1"`. Verified red before the fix, green after.
- `app/routes/app.digests.tsx:9-12` — stub still 302s `/app/digests` → `/app/briefs`
  (unchanged, expected to stay until phase-2 cleanup #2217).
- `app/routes/app.dashboard.tsx:1036` — "Read latest brief" link now points
  directly at `/app/briefs?firstrun=1` (the issue's optional cosmetic; keeps the
  link off the redirect hop and identical to what journey-3:552 asserts).

## #2944 — Gate-B journey-2 mobile entity-context 58.8px > 48px

**Verdict: FIXED-BY-602b86723** (`fix(e2e): read the entity-context gap in one layout pass (Closes #2944)`, 2026-09-11; ancestor of HEAD)

(a) Spec/component history: `git log --oneline --since=2026-09-10 -- e2e/journey-2-release.spec.ts`
shows `602b86723` plus two later release-spec commits. The entity-context block is
`.f9-wk-context` rendered by `app/components/workspace/working-header.tsx:53` — no
layout change to that component was needed; the fleet determined the 58.8px was a
measurement race, not a layout regression. The spec now
(`e2e/journey-2-release.spec.ts:285-315`) waits for `document.fonts.status === "loaded"`
and reads both boxes in ONE synchronous `page.evaluate` — the comment records that
run 34595877209 measured 58.8px on a settled ~18px layout (mobile Chrome's
visual-viewport-relative `boundingBox().y` went stale between the two reads) and the
same head passed the next run. The 48px threshold is unchanged.

(b) Latest Deploy production runs (`gh run list -R Nishfleet/0509 --workflow deploy-production.yml --limit 15`):

- Run `34779307565` (head `d0ddd3dbc`, 2026-09-13T19:58Z — the last run to reach
  predeploy): `launch:readiness:predeploy` ran and
  `✓ 5 [local-release] › e2e/journey-2-release.spec.ts:223:3 › Gate-B Journey 2: onboarding creates the first tracked competitor (mobile) (3.1s)` PASSED
  (tablet/desktop also passed). The run died much later at
  `Record the deploy in the on-main ledger` with `exit code 126` — unrelated.
- The three most recent completed failures (`34785248344`, `34785039993`,
  `34784405126`, all 2026-09-13 ~21:40-22:05Z) all die earlier, at the unit `Test`
  step on `tests/no-time-bomb-fixtures.test.ts > every test file with an ISO literal
  is either pinned, relative, or marked fixed-date` — never reaching e2e.
- No recent run fails on the journey-2 mobile entity-context assertion.

## New find folded into this PR — journey-1 trial-CTA nav budget

Deploy production run `34786485796` (sha `16bb3165`) failed
`launch:readiness:predeploy` on `e2e/journey-1-release.spec.ts:208`:
`toHaveURL(/\/search\?.*mode=advertiser/)` timed out at the 5s expect default.
The app is correct — the trial CTA does land on `/search` with `mode=advertiser`;
the first client-side nav waits for react-router to fetch+vite-transform the
search route module graph before committing the URL (dev-server-only cost).
Fixed in `6bf7f07d7`: explicit 20s budget on the click and the URL assertion.
Assertion unchanged — `mode=advertiser` still required.

---

## Summary table

| issue | verdict | evidence |
|---|---|---|
| #3212 | PROOF-GREEN | 15/15 pass on 7ecb3c6dd, re-verified green on this head |
| #3097 | PROOF-GREEN | 13/13 pass; assertion now at :241 green via withCaptureAge |
| #3124 | PROOF-GREEN | same file, same run |
| #3081 | PROOF-GREEN | same file, same run |
| #2865 | FIXED-BY-5b6dcc811 | 7/7 pass; single beforeEach mock + per-test mutable fn |
| #2797 | FIXED-BY-7533fc018 | 9/9 local; duplicate plan.server mock race removed |
| #2703 | FIXED BY THIS PR | journey-3:552 fixed by 0e783c6d5; local-authenticated:882 + :611 path + conditionalPrimaryRoutes membership + dashboard link + its unit-test pin all fixed here |
| #2944 | FIXED-BY-602b86723 | run 34779307565 passed journey-2 mobile (3.1s) |

---

## Close-out — production proof + the last two closes (2026-09-14, lane resume)

`Deploy production` run
[34798996355](https://github.com/Nishfleet/0509/actions/runs/34798996355)
completed **success** on head `16bd92843` (the #3463 merge, 2026-09-14T02:22Z) —
all six jobs green including `Deploy Worker` (unit `Test` step +
`launch:readiness:predeploy` e2e gate). That head contains every fix commit in
this cluster:

- `602b86723` (#2944 fix) — `git merge-base --is-ancestor 602b86723 16bd92843` passes
- `5b6dcc811` (#2865 fix) — ancestor, same check
- `dba1669df` (#2703 fix) — ancestor, same check

Seven of eight leaves closed and stayed closed. The two reopened by the
deploy-fault gate (fleet-ops#5785) — #2944 and #2865 — bounce for a bookkeeping
reason, not a product one: the gate resolves each issue's delivery as the
merged PR's *merge commit* (PR #2947 → `9cc3f3bab`, PR #2874 → `61e3cae75`),
and both SHAs compare `diverged` against the rebuilt main line — the fix
commits re-entered on a later lineage, so no green run can ever contain those
merge SHAs. Verified by running the gate's own check live
(`lib/deploy-fault-gate.sh::deploy_fault_has_proof "Nishfleet/0509" <n>`):
rc=1, fix_shas={9cc3f3bab} / {61e3cae75}, no qualifying run, check_failed=0.

The legal close the gate defines: a green `Deploy production` run whose head
contains a *delivery merge* for the issue — a merged PR on `claim/issue-<N>`
or any merged PR body carrying `Closes #N`. This close-out PR carries
`Closes #2944` and `Closes #2865` so its squash merge lands a fresh delivery
SHA on the current main line; every subsequent green run contains it. The
substance is already true in production — the fixes ran green inside run
34798996355 — this lands the bookkeeping the gate can verify.

If the lifecycle sweep's reopen pass lands inside the window between this
merge and the first green run containing it, the re-close afterwards is legal
unchanged: cite the first green `Deploy production` run on-or-after this PR's
merge SHA.

### Final scoreboard

| issue | final state | proof |
|---|---|---|
| #3081 | closed 01:40Z | PROOF-GREEN (marketing-proof-brief 13/13) |
| #3097 | closed 01:40Z | PROOF-GREEN (same file) |
| #3124 | closed 01:40Z | PROOF-GREEN (same file) |
| #3212 | closed 01:40Z | PROOF-GREEN (15/15, fake-timers pin) |
| #2797 | closed 01:40Z | FIXED-BY-7533fc018 (mock race removed) |
| #2703 | closed 02:22Z | PR #3463 merge auto-close; green run 34798996355 |
| #2944 | closed by this PR | FIXED-BY-602b86723; green run 34798996355; delivery re-minted here |
| #2865 | closed by this PR | FIXED-BY-5b6dcc811; green run 34798996355; delivery re-minted here |
