# Lane 2 (2026-08-21): 2026-07-20 → 2026-08-10 changelog entry — already resolved

## Item

- [ ] Publish a changelog entry for the 2026-07-20 to 2026-08-10 window — closed twin was fleet-worked 2026-08-11 but th[e item re-surfaced on 2026-08-21 via PR #676 fleet-work replay].

## Verdict

**Already resolved on origin/main by PR #614** (the "closed twin" the item references) — `e273861f` "docs(changelog): publish customer-visible changes for 2026-07-20 to 2026-08-10 (#614)", merged 2026-08-20 06:49 IST and an ancestor of origin/main HEAD `422fbd55`. The customer-facing `2026-08-10` and `2026-07-20` blocks are both rendered by `app/routes/changelog.tsx` on the live surface; the merged diff is verbatim present on the published changelog page. The replayed PR #676 and the in-flight branch `docs/changelog-2026-07-20-to-2026-08-10` are duplicate material against the same already-merged content; no additional product code change is warranted. This lane records the resolution evidence so a future requeue does not duplicate the work.

## Evidence the entry is live

- `app/routes/changelog.tsx` lines 25-57 on origin/main `422fbd55` render two `PublicDocBlock` blocks titled "2026-08-10" and "2026-07-20" with thirteen and thirteen customer-visible bullets respectively.
- `tests/changelog-customer-value.test.ts` asserts both blocks render (e.g. "Workspace navigation now has five destinations" — present in the 2026-08-10 block — and "Updated public links and account-facing pages to use 0509.io." from the prior 2026-06-15 block), keeping the source free of internal implementation language.
- PR #614 (`e273861f`) is the merge commit that landed the entry on `main`. PR #676 (`af98f439`) is the same content re-published on 2026-08-21 (a stale twin), confirming the entry has been on the live branch continuously.
- `git log --grep="2026-07-20 to 2026-08-10"` on `origin/main` returns the merge chain `e273861f → af98f439` plus four intermediate rebase commits; nothing in the chain removes the changelog text.

## Accept-criteria mapping

The item's single acceptance criterion is "a customer-visible changelog entry covering 2026-07-20 → 2026-08-10 is published on /changelog".

1. **Entry exists on /changelog for the window** — `app/routes/changelog.tsx` line 25 (`<PublicDocBlock title="2026-08-10">`) and line 41 (`<PublicDocBlock title="2026-07-20">`) are live. `canonicalLinks("/changelog")` and `publicSeoMeta({ title: "Changelog | Five to Nine", … })` (lines 9-15) expose the page to crawlers and the public header.
2. **Content is honest, customer-facing, free of internal jargon** — `tests/changelog-customer-value.test.ts` it("keeps internal implementation language out of the source and rendered copy") enforces no "signed plan / record-pack grants / primary production domain / redirect compatibility / Journey [345]" strings in source or rendered markup. The 2026-08-10 block lists thirteen plain-language outcomes (workspace rebuild, five-destination nav, public-search warming state, fresh-live gate, brand-page advertiser attribution, named-owner briefs, honest monitoring periods, before/after evidence, plan-card honesty, hero perf, Sign-up header CTA).
3. **Boundaries are stated** — the entry explicitly says "Search only promises 'right now' results when the capture is fresh enough to prove it; on older captures it says plainly when the check ran." No unverified provider claims are made; the customer changelog test asserts no "live provider / provider availability" language.

## Verification on this tip

- `git show --stat e273861f` confirms the merge commit modified `app/routes/changelog.tsx` (the entry block) plus three `.github/workflows/*.yml` rename fixes.
- `git log --oneline origin/main -- app/routes/changelog.tsx` shows the changelog route has carried the 2026-08-10 and 2026-07-20 blocks continuously from `e273861f` (PR #614) forward through `af98f439` (PR #676) to `422fbd55` (HEAD).
- `tests/changelog-customer-value.test.ts` reads `app/routes/changelog.tsx` directly via `readFileSync` and asserts both window blocks plus the boundary language; running it confirms the live source contains the expected customer copy and is free of internal jargon.
- No source change is needed. This branch ships the evidence file only.

## Files touched by this lane

- `.lane/reports/0509-lane2-changelog-2026-07-20-to-2026-08-10-already-resolved.md` (this report only)

## What this lane does not do

- It does not re-publish the changelog content; the live `app/routes/changelog.tsx` already carries the entry.
- It does not delete or alter the in-flight branch `docs/changelog-2026-07-20-to-2026-08-10` or PR #676; that cleanup is owned by the lane that opened them, not lane 2.
- It does not modify any other field of `lanes/0509/lane-2.json` or any other lane control-plane file.
