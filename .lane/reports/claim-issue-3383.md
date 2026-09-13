# Lane report — claim/issue-3383 (issue #3383, research-delta: #3114's routes vs the generic card)

Unit: pi-issue-0509-3383. Base: origin/main @ 635db2d1 (rebased; #3384/#3386/#3370-AGENTS landed during the run — none touch this diff's files). Head: 52a701ed1 (amended: + this report).

## What the research-delta got right, and what it predates

The delta (filed 2026-09-13T16:30Z) verified against production: all four routes stamp the generic og-image.png and every would-be card 404s. Both true — #3371's fix (9fa38d5ba, the STATIC_SURFACE_SOCIAL_CARDS machinery + the per-route head-tag sweep) merged 13:20Z but is undeployed; production deploys are Nish-gated. The delta's own termination, however, contains one clause that never passes even after that deploy: it expects `https://0509.io/social-card/briefs/weekly.png` to return image/png, while the shipped design resolves that card only under its canonical dashed slug `/social-card/briefs-weekly.png` — the surface matcher in `app/lib/social-cards.server.ts` was single-segment (`[^/]+`), so a nested page's page-path card URL could never resolve. This PR closes that clause; it is the only repo-side gap this unit could prove.

## Diff

`app/lib/social-cards.server.ts` (+22/-4: the surface matcher also joins a multi-segment rest to its registry slug with dashes and returns the CANONICAL slug, so the alias serves the exact bytes the og:image stamps; joined-to-nothing rests still 404 through the same fall-through) and `tests/social-cards.test.ts` (+37: parse + render + negative assertions). Stateless, URL-derived, no D1 read, no renderer change, no new mechanism — the joined-alias IS the guides precedent the issue cites. +55/-4 net.

## Runs (this worktree, post-rebase, VITEST_MAX_WORKERS respected)

- `npx vitest run --configLoader runner --project node tests/social-cards.test.ts` → 73/73. Includes the #3114 one-assertion-per-route head-tag sweep (each of the five routes' real `meta()` stamps exactly its `/social-card/<slug>.png`, never the generic) — the issue's acceptance-test clause, already landed by #3371 and passing here.
- `npx vitest run --configLoader runner --project workers tests/integration/social-card-raster.integration.test.ts` → 7/7 on real workerd (the /social-card → 1200×630 PNG path this matcher feeds).
- `npx vitest run --configLoader runner --project node --changed origin/main` → 10 files / 134 tests, all passed.
- `sgscan` → no new security findings, exit 0.
- `crgate` → "CodeRabbit is not signed in on this machine" (headless, no OAuth session; the CLI printed usage, no local review). Flagged, not explained away. The substantive review is the PR's senior round.

## Production

Still undeployed as of this run: all four routes 404-free-stamp the generic og-image.png, and `/social-card/briefs/weekly.png`, `/social-card/briefs-weekly.png`, `/social-card/sample-brief.png`, `/social-card/brands.png`, `/social-card/methodology-ad-aggression-score.png` all 404 (curl receipts, 2026-09-13 ~22:55Z). After the next 0509 deploy of this merge: the four routes stamp their own cards (locked by the head-tag sweep) and the issue's termination goes green — the briefs clause via this PR's alias.
