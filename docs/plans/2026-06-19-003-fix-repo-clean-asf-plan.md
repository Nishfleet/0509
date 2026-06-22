# fix: Make 0509 repo fully clean

Created: 2026-06-19

## Summary

Finish the 0509 cleanup so `main` is not only branch-clean, but also free of important unmerged local work and known merge-blocking dependency security drift.

## Problem Frame

The branch and PR cleanup left `main` clean, but four preserved stashes still contain old local worktree edits. Separately, the Cloudflare/Wrangler dependency bump that resolves the high-severity `undici` audit issue fails typecheck because the app's local `AppEnv` browser binding type no longer matches generated `wrangler types` output.

## Requirements

- R1: Do not discard important work silently.
- R2: Complete and merge work that is still valuable and current.
- R3: Explicitly discard work only after verifying it is stale, duplicate, or superseded.
- R4: Fix the dependency security blocker without weakening type safety.
- R5: Leave `main` as the only local and remote branch, with no open PRs, no extra worktrees, and no important preserved stashes.
- R6: Run the repo's verification and review gates before merging to `main`.

## Key Technical Decisions

- Use generated Cloudflare `wrangler types` as the source of truth for Worker bindings. Cloudflare's current docs recommend generated runtime/binding types instead of hand-written `Env` shapes.
- Treat old stashes as evidence to triage, not work to blindly replay. Large stale changes must be compared against current `main` and either salvaged as focused commits or dropped with a documented reason.
- Keep the foreground checkout clean by doing all work in `codex/0509-clean-asf`, then merge through the normal protected path and delete the branch.

## Implementation Units

### U1. Classify preserved stashes

**Goal:** Identify which stash contents still matter and which are obsolete.

**Requirements:** R1, R2, R3

**Files:** none expected, unless a kept item becomes a focused implementation unit.

**Approach:** Inspect each preserved stash with untracked files included. Compare the changed files and intent against current `main`, recent merged PRs, and product memory. Record the decision as merge/salvage/discard in the final cleanup evidence.

**Patterns to follow:** Current `app/` runtime and tests are authoritative; old `.in`, Resend, Better Auth, or superseded Dodo assumptions are stale.

**Test scenarios:** Test expectation: none -- classification is repository state inspection.

**Verification:** Every preserved stash has an explicit decision and there is no important unmerged work left hidden in stash state.

### U2. Fix Cloudflare dependency security drift

**Goal:** Upgrade the vulnerable Cloudflare tooling dependency path and adjust the app's Worker binding types so typecheck passes against the generated `BrowserRun` binding.

**Requirements:** R4

**Files:** `package.json`, `package-lock.json`, `worker-configuration.d.ts`, app Worker env type files, and tests touching Browser Run/ad-source behavior if needed.

**Approach:** Apply the Dependabot Cloudflare/Wrangler bump, regenerate types, then replace any hand-written browser binding type that conflicts with generated `Env`. Keep runtime behavior unchanged; this is a compatibility/security repair, not a Browser Run feature rewrite.

**Patterns to follow:** Existing `npm run cf-typegen`, `workers/app.ts` env plumbing, and tests around `app/lib/ad-source.server.ts`, `app/lib/browser-run.server.ts`, and Cloudflare bindings.

**Test scenarios:**
- Typecheck passes after `wrangler types` generates `BROWSER: BrowserRun`.
- Browser-dependent code still accepts the generated Worker env without unsafe public-secret exposure.
- Existing route and Worker tests still pass.
- `npm audit --audit-level=high` no longer reports the `undici` high-severity issue.

**Verification:** `npm run typecheck`, `npm run test`, `npm run build`, and `npm audit --audit-level=high` pass.

### U3. Salvage or discard old local work

**Goal:** Recover any stash content that remains important after U1, and drop the rest only after it is documented as stale or duplicate.

**Requirements:** R1, R2, R3, R5

**Files:** Depends on U1 findings.

**Approach:** For any still-current work, apply it into this branch as a small coherent change with tests. For stale work, leave it out of `main` and remove the corresponding stash after final verification.

**Patterns to follow:** Small focused commits, current product/runtime truth, and no revival of stale billing/auth/domain assumptions.

**Test scenarios:** Any salvaged behavior must have focused tests or be covered by existing tests.

**Verification:** No preserved `branch-triage preserve` stashes remain after final merge unless a stash is intentionally retained with a specific follow-up reason.

### U4. Review, merge, and prove final cleanliness

**Goal:** Merge the finished cleanup to `main` and leave no dirty branch or unreviewed work behind.

**Requirements:** R5, R6

**Files:** All changed files from U2/U3 plus this plan.

**Approach:** Run focused checks during implementation, then full checks. Run CE code review where applicable and the installed autoreview helper on the final diff. Push, open a PR, merge only when clean, delete branch, prune, and verify final repo state.

**Patterns to follow:** Existing GitHub PR path and safe-deploy wrappers.

**Test scenarios:** Test expectation: none -- final gate is repository/CI/review state.

**Verification:** `main` clean and synced, only `main` exists locally/remotely, no open PRs, no extra worktrees, no important stashes, full checks pass.

## Sources & Research

- Cloudflare Workers TypeScript docs: `wrangler types` generates binding/runtime types matching Worker configuration.
- Cloudflare Workers best practices: generated `Env` types should prevent drift from configured bindings.
- Cloudflare Browser Run docs: Browser Run is configured as a Worker browser binding.

## Stash Triage Decisions

Use the stable stash commit IDs below as the cleanup handles. Do not treat the `stash@{N}` ordinals as durable because they shift whenever another stash is created; before dropping, re-list stashes and drop only the entry whose commit ID and message both match.

- `a8219657877421b75ead11fa8e35079241b53ef2` (`codex/0509-launch-hardening-20260613`): salvage the Cloudflare dependency/security fix only, implemented here against current Cloudflare versions and generated binding types. Discard the remaining stash contents because current `main` already has the Dodo webhook ledger, checkout claim helpers, billing canary, and launch canary, while the stash also carries stale `.in` domain assumptions and migration-number conflicts.
- `a3c485b1639aa107d42f4414e08617cd64411290` (`work/20260615-152433-dashboard-poc-preserve`): discard. This is a large dashboard visual proof-of-concept CSS rewrite, not current product-critical work, with no behavior or test coverage to merge safely.
- `2eb614643c4990d5f3d7a75ec047deaf58622bc5` (`work/20260604-102723-0509-launch-proof-cleanup`): salvage only `brand/five-to-nine-colored-logo.svg` as a reusable source asset. Discard generated PNG previews and the `dodo-login.png` screenshot as transient artifacts.
- `18cc2b14cd7e064d96dabd6f69ff26dabd85ab02` (`work/20260515-dodo-international-billing`): discard. This predates the current Better Auth/Cloudflare Email/Dodo stack, includes stale Resend assumptions, old dependency drift, and broad product/UI edits that are no longer safe to replay.

After this branch merges, the corresponding preserved stashes can be dropped by matching these exact commit IDs/messages because every saved item is either merged as a focused current change or explicitly classified as stale, duplicate, or transient.
