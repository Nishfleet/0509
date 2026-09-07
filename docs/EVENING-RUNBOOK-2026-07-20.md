# Evening Runbook — 2026-07-20 (one password sitting → everything live)

**State when you left:** main frozen at `3717419` (the complete product: overnight stack + polish + QA fixes + all four pipeline fixes). Every gate green EXCEPT the remote-restore evidence, which is bound to an older candidate and needs one fresh drill. The drill needs your Mac password (~7 prompts in one sitting) — the single thing no agent could do today.

## The 5-minute sequence (in any terminal)

```bash
# 1. Run Codex's staged drill (it wrote and verified this script at 12:34 today).
#    Enter your Mac password at each prompt; the sequence advances itself.
/Users/nish/.codex/state/0509-run-3717419-remote-restore.command

# 2. Rerun the failed deploy for the frozen main tip:
cd "/Users/nish/Vibecoded projects/0509"
gh run rerun 29721139858 --failed
```

Then tell Claude "rerun fired" (or just wait — Claude's watchers catch the worker flip automatically and start live verification).

**If step 1 errors** (staged script gone stale): open the Codex window instead and say: *"I'm back and available for password prompts — run the remote restore drill + evidence rebind for main tip 3717419 now, then rerun deploy run 29721139858."* Codex rebuilds and executes it in ~7 minutes; approve the prompts as they appear.

## After the worker flips (Claude handles these — listed for visibility)

**PREFERRED PATH (if `origin/preview/integration-eve-2026-07-20` exists and its INTEGRATION-PREVIEW doc says "integration-proven"):** merge that ONE branch instead of the 13-item sequence below — it is all thirteen pre-reconciled and suite-proven as a single tree (same lesson as the overnight integration: one proven artifact beats sequential merge roulette). The list below is the fallback/reference order.
Staged branches, deliberately NOT merged today (merging would move main and unbind the staged drill). Post-flip merge order (Claude executes via Chrome after live verification): 1) test/clock-flake-hardening, 2) docs/changelog-honesty, 3) docs/ops-truth-sweep, 4) fix/local-authenticated-realign, 5) ci/cross-browser-scheduled, 6) refactor/consolidation-2026-07-20, 7) refactor/watchlists-split (KNOWN SEAM: 6 and 7 both touch app.watchlists.tsx — Claude reconciles 7 onto post-6 main before merging it), 8) polish/email-render-pass, 9) audit/new-surface-security (bulk-cap DoS fix — merge early if reordering), 10) fix/megabrand-advertiser-resolution (page-id-scoped mega-brand search, live-proven Nike 50k-junk→43-clean; touches search files — reconcile against 6 if needed), 11) feat/spec-leftovers-wp44-47 + audit/a11y-sweep when accepted. Each merge triggers a now-unblocked deploy; batching several before one deploy is fine.

## Why this is safe
- The drill only exports prod D1 to a scratch database, verifies integrity, and records evidence — no prod mutation.
- Main is frozen; the deploy content is the fully verified candidate (3,690 tests, 66/66 journeys, adversarial review, QA matrix all green on exactly this content).
- The canonical release gate passed on every run today; the only failures since morning were pipeline interlocks, each now structurally fixed.

## What happened while you were out (summary — full log in the session)
- Codex prepped the drill to the password gate, then parked (by design — no bypass exists or should).
- Claude re-homed work around the block: consolidation refactor (Opus), e2e realignment + changelog honesty (Grok), cross-browser matrix re-homing, all on branches for review/merge.
- Prod stayed healthy on the previous build all day; zero customer risk taken.
