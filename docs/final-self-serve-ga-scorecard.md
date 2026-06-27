# Final Self-Serve GA Scorecard

Last updated: 2026-06-27

## Verdict

Current repo verdict: BRANCH READY FOR PROTECTED PR - OWNER ACTION REQUIRED.

Scout and Starter are locally verified as self-serve in the reviewed branch, with Dodo checkout, top-ups, webhook grants, email proof, pricing preview, public copy, and API/MCP Slack removal covered by tests and live canaries. Agency remains held because production fan-out proof has not passed. This is not a live GA verdict until the protected PR is reviewed, merged, deployed, and the post-deploy D1 cleanup is verified.

## Baseline

| Item | Result |
| --- | --- |
| Starting branch | `codex/final-self-serve-ga-hardening-20260625` |
| Starting main commit | `ed109a9` |
| Local `main` vs `origin/main` | Match at `ed109a9` after `git fetch origin` |
| Current branch status | Verified on the current checkout; re-run `git status --short --branch` and `git log -1 --oneline` before PR/deploy |
| Pull request | Not opened yet; protected `gh pr create` is awaiting explicit owner approval |
| PR body draft | `docs/final-self-serve-ga-pr-body.md` |
| Safety patch | Saved at `../pre-final-self-serve-ga-hardening.patch` |
| Worker version | Not verified in this pass; Cloudflare deployment API was not used |
| Production domains from repo config | `.io` primary domains plus `.in` redirect compatibility routes |
| Monitoring mode from repo config | `inline`; fan-out not globally enabled |
| Presence rollout from repo config | Website GA; digest, X, Reddit, and LinkedIn disabled |
| Agency state | Held unless fan-out proof passes |

## Verification Matrix

| Check | Result | Evidence |
| --- | --- | --- |
| Full unit/integration tests | PASS | `npm test`: 143 files, 1334 tests |
| Typecheck | PASS | `npm run typecheck` |
| Production build | PASS | `npm run build` |
| Dependency audit | PASS | `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities |
| Backup validator | PASS local dry-run | `node scripts/validate-d1-backup.mjs`; latest repo migration `0060_remove_legacy_billing_provider.sql` |
| Diff whitespace | PASS | `git diff --check HEAD` |
| Autoreview | PASS | Final staged autoreview clean; no accepted/actionable findings |
| Retired billing provider surface | PASS | Routes, helpers, env typing, tests, active docs, historical setup migrations, and fresh-start schema references removed; `0060` converges already-created remote schema artifacts to Dodo-only billing fields after deploy |
| Local D1 migration list | LOCAL ONLY | Local simulator reports pending `0053`-`0060` from prior local state |
| Remote D1 migration list | PENDING POST-DEPLOY | Remote reports only `0060_remove_legacy_billing_provider.sql` pending; deploy compatible Worker first, then apply cleanup with backup/count evidence |
| Pricing canary | PASS | Dodo pricing canary passed for IN, US, and GB previews |
| Billing canary | PASS | Dodo signed-webhook plan/top-up canary passed and cleanup passed |
| Proof/email canary | PASS | Launch proof canary passed with email delivery |
| Production canary | PASS | Health on primary domains, fresh-live search, ops readiness, and Meta ads beta passed |
| Provider bakeoff launch gate | PASS/PARTIAL | Current live provider passed all launch queries; optional alternate providers skipped because their credentials are absent |
| Full launch readiness script | PASS | Rerun after the retired-provider history removal and scorecard/copy refresh: typecheck, tests, build, audit, pricing, billing, proof/email, prod, and provider bakeoff passed with local canary env exported |
| Presence website canary | BLOCKED | `npm run canary:presence` still stops at missing local internal Presence workspace id |

## Product Contract

| Requirement | Status | Notes |
| --- | --- | --- |
| Scout sellable self-serve | Verified in branch | Dodo checkout, plan copy, pricing preview, webhook grant, and canary covered |
| Starter sellable self-serve | Verified in branch | Daily monitoring/daily+weekly digest copy and checkout path covered |
| Top-ups self-serve | Verified in branch | Existing Dodo products, grants, cleanup, and non-expiring copy covered |
| Agency sellable | Held | Do not open until live production fan-out ladder passes |
| Email delivery | Verified | Email proof canary passed |
| Slack public/API/MCP surface | Removed from GA surfaces | Dormant implementation preserved behind product gates |
| WhatsApp public surface | Hidden | Dormant implementation preserved; readiness and launch blockers gated off while non-GA |
| Presence website/blog | GA in repo config and copy | X, Reddit, and LinkedIn remain disabled |
| Billing portal | Partial self-serve | Hosted portal route works in code; plan changes/cancellation remain support-backed until Dodo dashboard setting is verified |
| Trust/backup wording | Truthful in branch | Public trust copy limited to dry-run validation and owner-operated backup posture |
| Provider/network timeouts | Improved | Shared timeout/bounded-response helpers and regression tests added across touched hot paths; stalled Cloudflare Email sends now move to pending/provider-unknown rather than retryable failure |
| Retired billing provider | Removed from runtime; pending post-deploy schema cleanup | Routes, helpers, env typing, tests, active docs, lookup index, live code references, and fresh-start setup migrations removed; `0060` removes already-created remote plan columns/table after deploy |

## Follow-up Hardening Notes

- Cloudflare Email delivery now has an explicit application timeout with regression coverage for a never-resolving provider send; stalled sends are recorded as pending/provider unknown, not retryable failures.
- Older top-up billing docs now point to the current final-GA truth: configured Dodo checkout and signed-webhook canary coverage are verified, while checkout still fails closed if required product mappings are absent.
- Fresh-start migration replay no longer creates retired-provider setup artifacts. The remaining `0060` cleanup removes already-created remote schema artifacts after the compatible Worker is deployed.

## Remaining Owner Actions

The branch is not a full live GA closeout until these are resolved or accepted:

1. Confirm Dodo Product Collection membership for Scout/Starter, the Dodo subscription-update setting, and cancellation availability in the customer portal.
2. Confirm external uptime monitoring on `https://0509.io/api/health`.
3. Activate or explicitly defer automated D1-to-R2 backup schedule and restore drill.
4. Provide internal Presence workspace config, then rerun `npm run canary:presence`.
5. Run live fan-out ladder before opening Agency checkout.
6. Clean up retired provider dashboard artifacts: old webhooks, subscriptions, payment links, and live products.
7. Open a protected PR, wait for GitHub checks/review, merge through protection, then run merged-main validation.
8. Deploy the schema-compatible Worker with `0060_remove_legacy_billing_provider.sql` still pending.
9. Before applying `0060`, create a fresh remote D1 backup/export and run `SAFE_DEPLOY_APPROVED=d1 npm run d1:cleanup-0060:evidence -- --remote --stage pre`.
10. Apply `0060` only after the new Worker is live, then run `SAFE_DEPLOY_APPROVED=d1 npm run d1:cleanup-0060:evidence -- --remote --stage post` and verify `user_plan` row counts match, legacy billing columns/table are gone, and Dodo linkage remains.
11. Rerun billing/prod smokes and canaries after the migration.

## Non-Exposure Confirmation

This scorecard intentionally omits secrets, provider ids, Dodo product ids, customer ids, webhook URLs, canary record ids, and customer data.
