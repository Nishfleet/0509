# Worker terminal report — anonymous homepage sample brief truthfulness

**Date:** 2026-08-06
**Worktree:** `/home/nish/workspaces/agent-worktrees/0509-sample-brief-candidate-5`
**Base:** `1f865fa` (worktree HEAD, detached)
**Packet:** Make the anonymous homepage sample brief truthful and decision-ready (sample-brief candidate 5).

## Outcome

Implementable in scope, no blockers. No live evidence was invented; no deploy, commit, PR, auth, billing, migration, or pricing/legal copy touched.

## Files changed

| File | Change |
|---|---|
| `app/routes/marketing.tsx` | Added exported `SAMPLE_FIELD_UNAVAILABLE` ("Not available in this sample") and `sampleProofField()` fallback helper; wired all 7 Decision summary proof fields (subject, what changed, why it matters, urgency, proof status, source, freshness, next action) and all 3 source-trail fields (signal, evidence, source) through it so a blank fixture value can never render a blank proof label; added an explicit illustrative label to the Source trail card ("Illustrative sample — sources are capture types, shown without links. In your account, each trail entry links to its saved capture."). No fake URLs introduced anywhere. |
| `tests/marketing-sample-brief.test.ts` | New focused regression suite (5 tests): renders every decision-summary field with its fixture-backed value; renders the source trail with all fixture items plus the explicit illustrative label and no `href=`/empty `<li>` in the trail region; renders "Not available in this sample" when a fixture value is blank (via mocked mutated fixture); asserts every proof field is wired through the fallback in source; asserts the fixture itself has no empty proof items and no URLs. |

`app/lib/demo-proof.ts` and `app/lib/pricing.ts` were not changed — the existing sample fixture already provides every displayed value; the gap was rendering guarantees and source-trail labeling, so the change stayed in the route plus tests.

## Verification (exact exit codes)

- `npm run typecheck` → exit **0**
- `npm run build` → exit **0** (built in 47.22s)
- `npm test` → full suite: 412 files, 4644 tests. Marketing suites green every run. Exit **0** (vitest run always exits 0 in this repo config; failures are reported per-file).
- Focused: `tests/marketing-sample-brief.test.ts` **5/5 pass**; `tests/marketing-rebuild.test.ts` + `tests/marketing-sample-brief.test.ts` together **29/29 pass**; `tests/marketing-nav.test.ts` pass.
- `git diff --check` → exit **0**
- `/home/nish/.local/bin/sgscan` → **exit 137 (semgrep OOM-killed)** — see pre-existing findings below.
- Scoped semgrep (`--config=p/default` on the two changed files, sgscan's own JSON + severity ranking): **no findings, exit 0**.
- `npm run check:public-home` → passed (exit **0**).

## Pre-existing findings (unrelated to this diff, reported separately)

1. `tests/deploy-window-lock.test.ts` fails at clean HEAD with this diff stashed (6–7 failures; child-process lane tests, timing-dependent, varies run to run). Pre-existing.
2. `tests/watchlists.route.test.ts` intermittently times out (10s test timeouts) during full-suite runs but passes 62/62 in isolation. Pre-existing load flakiness; its module graph does not touch `marketing.tsx`/`demo-proof.ts`.
3. `sgscan` cannot run in its baseline mode in this worktree: `origin/HEAD` and worktree HEAD share `merge-base == HEAD`, so sgscan falls back to a whole-tree scan, and semgrep is OOM-killed (exit 137). The scoped scan of the changed files (above) produced no findings.
4. Local visual preview unavailable: `vite preview` / dev server require a Cloudflare remote proxy session and the wrangler auth token is expired in this environment. Criterion-4 layout was instead verified via the render test (full route SSR without errors) and the existing responsive CSS (`.ld-caseboard` collapses to a single column under 760px; cards use `min-width: 0` + `overflow-wrap: anywhere`; the new note uses the existing `.ld-honest` style).

## Notes

- The observed blank-field homepage was a stale production deploy: the live page (fetched 2026-08-06) and worktree HEAD both already render fixture values. This change makes the guarantee structural (fallback on any future blank fixture value) and the source trail explicitly illustrative, plus adds the regression coverage the backlog requires.
- `proofStatus: "Verified evidence"` remains the fixture's sample status inside the clearly labeled "Sample brief" section; per the packet, fixture-backed values are acceptable and no live evidence claim is made.
- No descendants, commits, PRs, or deploys created.
