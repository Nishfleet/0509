===== ISSUE #3081 =====
TITLE: fix(deploy-gate): marketing-proof-brief assertion blocks every production deploy | CREATED: 2026-09-11T22:27:13Z

Deploy production run 34652386080 (sha 168c7eb6, 2026-09-11T22:05Z) failed launch:readiness:predeploy on one test:

tests/marketing-proof-brief.test.tsx > anonymous homepage proof brief (real proof) > renders real capture clocks and the real proof label when proof exists

AssertionError: expected homepage HTML to contain 'was the hook on 6 Meta ads'. 749/750 files and 9533/9534 tests passed — this single assertion is the only thing between main and a green deploy (0 green deploys in the last 100 runs; 310 merges have reached no user).

required: find why the anonymous homepage proof brief no longer renders that proof label (real data drift vs a homepage regression from the 310 undeployed merges) and fix the surface or the test at the root — never delete or weaken the assertion.
accept: one Deploy production run on main ends conclusion=success with this test green.

===== ISSUE #3097 =====
TITLE: test: marketing-proof-brief.test.tsx#222 red on main — homepage render lacks 'was the hook on 6 Meta ads' | CREATED: 2026-09-11T23:17:50Z

Visible on unrelated prose PR #3096 and PR #3094: `codex-node-checks-shard-4` fails at `tests/marketing-proof-brief.test.tsx:222` with `AssertionError: expected rendered homepage to contain 'was the hook on 6 Meta ads'`. The rendered output is the full f9-home SSR string, so the fixture/content pair diverged on main. Blocks the merge queue for any non-shard-touching PR. Fleet range: within last ~hour shard-4 was green on other shards; shard-4 works for e.g. #3094 which also has the same failure, so it looks repo-wide, not branch-local.

===== ISSUE #3124 =====
TITLE: test(marketing-proof-brief): stale homepage copy assertion fails on main (was the hook on 6 Meta ads) | CREATED: 2026-09-12T00:57:52Z

`tests/marketing-proof-brief.test.tsx:222` fails on `main` — it asserts homepage markup that the current component no longer renders.

## Evidence (reproducible)

```
$ npx vitest run --configLoader runner --project node tests/marketing-proof-brief.test.tsx
❯ tests/marketing-proof-brief.test.tsx:222:20
    222|     expect(markup).toContain("was the hook on 6 Meta ads");
       |                    ^
Test Files  1 failed (1)
     Tests  1 failed | 12 passed (13)
```

The rendered markup now says:

```
<span class="ld-proof-attrib">is a hook on record across 6 Meta ads linking to nykaa.com. We saved every one.</span>
```

so the assertion looks for a sentence the component stopped emitting. The sibling assertions on the same markup (`"We saved the proof"`, `"Routine-first bundle"`) both pass — only this one string is stale.

## Impact

Red on `main`, and it fails the `codex-node-checks` + `codex-node-checks-shard-4` jobs on unrelated PRs, which makes every worker read a pre-existing failure as its own. Found while shipping `Nishfleet/0509#2966`; that diff touches only `scripts/check-outbound-email-auth.mjs`, `tests/outbound-email-auth.test.ts`, `tsconfig.node.json` and `docs/`, so it is not the cause.

## Fix shape

Either update the assertion to the copy the component actually renders, or restore the old sentence in the proof-strip attribution if it was dropped by mistake. Which one is correct depends on whether the new copy was intentional — that is a product-copy call, so the test should be pointed at whichever wording is wanted.


===== ISSUE #2944 =====
TITLE: fix(e2e): Gate-B journey-2 mobile — entity context detached from its title (58.8px > 48px limit) blocks every production deploy | CREATED: 2026-09-11T12:44:05Z

**Gate-B `launch:readiness:predeploy` is now the thing keeping 0509 dark.** Not Gate C.

Evidence, run `34595877209` (head `d0ae8ec9`, `Deploy production` on main, completed **failure** 2026-09-11T12:29:15Z). The Deploy Worker job never reached Gate C — it died in predeploy with **1 failed / 72 passed (5.0m)**:

```
1) [local-release] > e2e/journey-2-release.spec.ts:223:3 > Gate-B Journey 2: onboarding creates the first tracked competitor (mobile)
   Error: mobile entity context should stay attached to its title
   expect(received).toBeLessThanOrEqual(expected)
   Expected: <= 48
   Received:    58.8125
   at e2e/journey-2-release.spec.ts:296:11
launch:readiness:predeploy failed - manifest status=failed; strictIssues=["annotation:finalUrl","artifact_count","artifact_missing","browser_run_fai...
```

The assertion is `contextBox.y - (nameBox.y + nameBox.height) <= 48` (spec lines 294-296): on the mobile viewport the entity context block sits **58.81px** below its title, 10.81px past the allowed gap.

**This is a regression inside today's merge window, or a real flake — establish which first.** The previous *completed* run `34587175261` (head `264bcee3`, 10:01Z) passed every predeploy test (`728 passed`, `60 passed`) and failed later, at Gate C. So the mobile gap broke somewhere between `264bcee3` and `d0ae8ec9`. A 22% overshoot is not sub-pixel jitter.

do:
1. Read run `34598995470` (head `56f4e7e6`, started 12:27Z) — if journey-2 mobile fails there too, it is deterministic; if it passes, treat it as a flake and fix the flake source, not the layout.
2. If deterministic: `git log --oneline 264bcee3..d0ae8ec9 -- app/ e2e/journey-2-release.spec.ts` and find the commit that moved the mobile spacing. Fix the **layout** so the context block sits back within 48px of its title.
3. Re-run `npm run launch:readiness:predeploy` (or the single spec at the mobile project) and paste the measured gap in the PR body as `run-proof:`.

must-not:
- **Do not raise the 48px threshold, do not `test.skip`, do not mark the spec flaky-retry.** The assertion is the gate; the gap is the bug. Motive 1: no gate weakened, ever.
- Do not touch Gate C, `verify-post-deploy-release.mjs`, `backupProofStatus: required`, or the rollback path — different gate, different owner (#2646).
- Do not widen the mobile viewport or change the project config to make the number fit.

accept:
- One `Deploy production` run on main whose Deploy Worker job passes `launch:readiness:predeploy`.
- The measured `contextBox.y - (nameBox.y + nameBox.height)` quoted in the PR body, under 48.

Context: `product-live 0509: last_green_deploy=NONE-in-100`, `auto_revert_halts_open=105`. ~100 merged PRs in 24h have reached no user. This spec is the current first gate in the way.


===== ISSUE #2703 =====
TITLE: fix(e2e): Gate-B journey-3 still asserts /app/digests after route-diet rename — Deploy production red on every merge | CREATED: 2026-09-10T21:40:28Z

Deploy production is failing on every merge since route-diet phase 1 (#2213, merged as ff69f596) renamed `/app/digests` to `/app/briefs` with 302/307 stubs.

## Root cause

The Gate-B release spec was not updated for the rename. The app is correct — the spec asserts the pre-rename URL.

## Failing evidence (run 34529182476, sha 06b00694, 2026-09-10)

`e2e/journey-3-release.spec.ts:537` — "first filed brief opens as the one designed brief" fails at all 3 viewports (3 failed / 70 passed):

- Expected: `http://127.0.0.1:PORT/app/digests?firstrun=1`
- Received: `http://127.0.0.1:PORT/app/briefs?firstrun=1`

The dashboard "Read latest brief" link (`app/routes/app.dashboard.tsx:970`) still points at `/app/digests?firstrun=1`; the `app.digests.tsx` stub 302s to `/app/briefs`, so the browser lands on the canonical new URL and `toHaveURL` sees `/app/briefs?firstrun=1`.

## Same-pattern stale assertion (fix in the same PR)

- `e2e/local-authenticated.spec.ts:882` — `toHaveURL(/\/app\/digests/)` after `page.goto("/app/digests")` lands on `/app/briefs`. Not among the 3 observed failures (likely runs outside the deploy e2e project), but it asserts the old URL and will go red wherever it runs.

## Fix (minimal)

- `e2e/journey-3-release.spec.ts:537` → `toHaveURL("/app/briefs?firstrun=1")`
- `e2e/local-authenticated.spec.ts:882` → `toHaveURL(/\/app\/briefs/)`
- Optional cosmetic: point the `app.dashboard.tsx` "Read latest brief" link directly at `/app/briefs?firstrun=1` (the stub keeps the old link working either way — not required to unblock).

Other `/app/digests` references in journey-3 (lines 283, 367, 553, 561) are `page.goto` calls that follow the 302 fine — leave them.

## Accept

Next `Deploy production` run after merge passes Gate-B journey-3 at all viewports; deploy reaches live again.

Note: run 34532722404 (sha 63e4b9d, in flight at filing) is pinned to a sha carrying the stale spec and will fail at this same assertion — expected, not a new regression. The earlier same-day journey-1 webkit failures (runs 34520673955, 34514527796 — instant 4ms fails) did not reproduce on the latest head and are a separate, apparently-transient signature. Related standing halt: #2211.

===== ISSUE #2865 =====
TITLE: fix(test): brands-category loader 404 test is order-dependent on the beforeEach sitemap mock — currently the sole red turning every Deploy production red | CREATED: 2026-09-11T07:46:07Z

Production has been dark for 16h+ (`last_green_deploy=NONE-in-100`, 100 merges reaching no user). The current red is **one test**, and it is not the readiness gate and not journey-3 (those were the previous two rounds).

## Evidence (run 34571086375, Deploy Worker > Test)
```
FAIL tests/brands-category.loader.test.ts > /brands/:category loader (issue #2067)
Error: loader resolved — expected a 404 Response   (tests/brands-category.loader.test.ts:114)
Test Files  1 failed | 714 passed (715)
Tests       1 failed | 8539 passed (8540)
```

## Diagnosis — this is a TEST-ISOLATION defect, not a product bug
`app/routes/brands.$category.tsx` is correct as written: the `catch` at L124 degrades a rejection to `brandEntries = []`, and the empty-curated-category guard at L148-151 then `throw new Response("Not Found", {status: 404})`. With an empty list that path cannot resolve.

The loader nonetheless *resolved*, which means it did not see the rejection mock. The suite `beforeEach` (L13-35) already `vi.doMock`s `~/lib/sitemap.server` with the happy-path entries (nykaa/sugarcosmetics); the failing test re-`doMock`s the same specifier with `Promise.reject`. When the happy-path registration wins, `categoryLinks` is non-empty and the loader resolves with data — exactly the observed failure. `vi.doMock` is not hoisted and applies to the *next* import, so the override is order-sensitive against the `beforeEach` registration + the loader's call-time dynamic `import("~/lib/sitemap.server")`.

## do:
1. Make the rejection override deterministic — e.g. `vi.resetModules()` immediately before the override `doMock` in that test, or have the `beforeEach` mock read a per-test mutable fn (`let loadEntries; vi.doMock(..., () => ({ loadIndexableBrandPageEntries: (...a) => loadEntries(...a) }))`) so the test swaps behaviour instead of re-registering the module.
2. Prove it is deterministic: run the single file 20x in a row green, and run it as part of the full suite (ordering matters).

## must-not:
- Do **not** relax or delete the assertion. The 404-on-source-failure contract is real (#1988, #2600): a D1 hiccup must not fabricate an empty 200 brand page.
- Do **not** change `app/routes/brands.$category.tsx` — its behaviour is already correct; changing it to make a flaky test pass would be weakening a gate.
- Do not skip/`.skip` the test.

## accept:
- `tests/brands-category.loader.test.ts` passes 20/20 standalone and in the full suite.
- One `Deploy production` run on main with `conclusion=success`.

## required:
The fix is in the test file only (or a shared test helper), with the assertion text unchanged.

Class owner for "a merge can never turn Deploy production red" is #2840; this is the instance currently holding the line red.


===== ISSUE #3212 =====
TITLE: fix(test): clock-rot in public-status-counters digest fixture fails required shard-4 and blocks all PRs | CREATED: 2026-09-12T05:16:46Z

`tests/public-status-counters.test.ts:33` hardcodes a digest timestamp (`2026-09-05T04:00:52.000Z`) and asserts `digestHealth: "recent"`. `digestHealthState` compares that timestamp against `Date.now()` with a 7-day threshold (`DIGEST_STALENESS_THRESHOLD_MS`, `app/lib/public-status-counters.server.ts:15`).

The fixture date aged past 7 days on 2026-09-12, so the test began failing with `digestHealth: "stalled"` — and `codex-node-checks-shard-4` is a required check, so it blocks every PR.

Reproduced on clean `origin/main` (5c9cf8d66), file untouched by any open PR:

```
- "digestHealth": "recent",
+ "digestHealth": "stalled",
Tests  1 failed | 14 passed (15)
```

Confirmed affecting open PRs: #3194, #3183, #3181, #3169, #3164 — all red on `codex-node-checks-shard-4` for this reason.

The same file already contains the correct clock-independent pattern in its sibling cases (`new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()`), so only line 33 and the assertion on line 56 need to follow it. Without the fix the test rots again 7 days after any new hardcoded date.


===== ISSUE #2797 =====
TITLE: flaky test: digest-partial-failure-status.test.ts 're-attempts the digest run when no delivery row exists yet' fails in CI shards, passes locally | CREATED: 2026-09-11T05:14:55Z

Filed by pi-issue-0509-2448 worker while unblocking PR #2767.

Second occurrence of this flake:
- PR #2729: worker pushed `ci: retrigger after unrelated digest-test flake on the merge ref` (78cefb5f6).
- PR #2767: codex-node-checks-shard-3 run 34559081681 failed with `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times` at tests/digest-partial-failure-status.test.ts:574 (`expect(deliverWeeklyDigest).toHaveBeenCalledTimes(1)` after `await runScheduledCycle(null)` in the 're-attempts the digest run when no delivery row exists yet' case). The full file passes locally with the same diff (9/9), and passed on the retrigger run.

Suspect: shard-level parallelism/timing sensitivity in the orchestration re-entry suite, not a product defect. Each occurrence burns a full CI round-trip and blocks armed auto-merge until a retrigger lands.

mechanical fix wanted: deflake the suite (fake timers or drain promises deterministically around runScheduledCycle), or add an automatic single-retry for this file in the shard config; whichever is smaller.

