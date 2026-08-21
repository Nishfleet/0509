# PR Body: Final Self-Serve GA Hardening

Branch: `codex/final-self-serve-ga-hardening-20260625`

Title:

`fix(launch): close final self-serve SaaS gaps`

## Summary

This PR closes the remaining in-repo Five to Nine launch-hardening gaps for the currently supportable Scout, Starter, and Agency self-serve SaaS path. This file was the original PR body; the 2026-06-28 closeout updated Agency from held to open after live fan-out dispatch proof.

- Scout and Starter stay publicly sellable and self-serve.
- Top-up packs stay self-serve through the existing Dodo products and signed webhook grant path.
- Agency is open after live production fan-out dispatch proof; monitor nightly scan health.
- Slack and WhatsApp stay dormant and hidden from GA customer UI/API/MCP surfaces.
- Email remains the verified automated delivery channel.
- Public, README, `/llms.txt`, API-readable docs, onboarding, and in-app copy are aligned to current plan/top-up semantics.
- Trust and backup wording no longer claims unproven automated R2 backup/restore proof.
- Provider/network hot paths have explicit timeout, bounded-response, and safe-error handling.
- The retired billing provider is removed from active runtime, tests, active docs, and fresh-start schema; final remote DB cleanup is deferred to the post-deploy `0060` migration gate.

## Verified Audit Findings

- Slack export/API/MCP exposure: resolved. Slack is not advertised or accepted as a GA export format, and forged customer requests fail closed.
- Public copy/doc drift: resolved. Scout, Starter, top-up, Agency, Presence, support, and channel copy match the current product contract.
- Backup/trust overclaim: resolved. Public trust copy is limited to proven dry-run validation and owner-operated backup posture.
- Backup validator coverage: resolved. Validation walks the current migration chain through the latest repo migration.
- Billing management: repo-configured self-serve. Portal route exists for hosted portal tasks, Dodo Product Collection membership is configured for Scout/Starter monthly and annual products, and in-app plan switching now uses Dodo's documented plan-change preview/change endpoints. One internal provider smoke is still needed before claiming live customer plan-change proof; cancellation remains portal/support-backed until checked.
- Provider reliability: improved. Dodo, email, Browser Run/Browserless, Meta/customer token checks, landing/proof fetches, Presence checks, Slack, WhatsApp, and LinkedIn OAuth token exchange now use timeout/bounded handling where touched.
- Agency state: open. Live production fan-out dispatch proof passed; scan health remains monitored.
- Account-controls branch: reviewed and not merged. Useful ideas were classified for later rebuild; stale migrations/code were not imported.
- Branch/stash cleanup: documented only. No branch, stash, or worktree deletion was performed.

## Key Docs

- `docs/final-self-serve-ga-scorecard.md`
- `docs/ga-owner-actions.md`
- `docs/launch-hardening-progress.md`
- `docs/codex-account-controls-branch-review.md`
- `docs/branch-and-stash-cleanup.md`

## Tests And Canaries

Latest branch proof recorded in the scorecard:

- `npm run typecheck` passed.
- `npm test` passed: 143 files / 1336 tests.
- `npm run build` passed.
- `npm audit --omit=dev --audit-level=moderate` passed with 0 vulnerabilities.
- `node scripts/validate-d1-backup.mjs` passed through `0060_remove_legacy_billing_provider.sql`.
- `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations list 0509 --remote` showed only `0060_remove_legacy_billing_provider.sql` pending as a post-deploy cleanup migration.
- `npm run canary:pricing` passed.
- `npm run canary:billing` passed.
- `npm run canary:proof` passed through email delivery.
- `npm run canary:prod` passed.
- `npm run provider:bakeoff:launch` passed for the current live provider path; optional alternate providers were skipped where credentials were absent.
- `npm run launch:readiness` passed with local canary env exported.
- Final autoreview passed with no accepted/actionable findings.

Presence website canary now follows the current GA rollout and runs without requiring the old internal workspace id.

## Owner Actions

These are not proven by repo code alone:

- After deploy, confirm in-app Dodo plan switching with an internal linked subscription, signed webhook account update, and cancellation availability in the customer portal.
- Confirm the uptime health workflow's first scheduled run and alert path, or add/keep an independent UptimeRobot monitor for `https://0509.io/api/health`.
- Activate or explicitly defer D1-to-R2 scheduled backup and restore drill.
- Monitor the next live Agency fan-out window for dispatch failures and real scan completion.
- Confirm Cloudflare Email activity/log visibility.
- Review unsupported WhatsApp stored targets without destructive cleanup.
- Clean up retired provider dashboard artifacts.

## Deployment Order

1. Merge this protected PR normally after required checks/review pass.
2. Sync local `main` and rerun merged-main validation:
   - `npm test`
   - `npm run typecheck`
   - `npm run build`
   - `npm audit --omit=dev --audit-level=moderate`
   - `node scripts/validate-d1-backup.mjs`
   - `SAFE_DEPLOY_APPROVED=d1 npx wrangler d1 migrations list 0509 --remote`
   - `git diff --check`
3. Deploy the schema-compatible Worker while `0060_remove_legacy_billing_provider.sql` is still pending.
4. Rerun pricing, billing, proof/email, production, and provider bakeoff canaries.
5. Create a fresh remote D1 backup/export.
6. Record pre-`0060` aggregate evidence with `SAFE_DEPLOY_APPROVED=d1 npm run d1:cleanup-0060:evidence -- --remote --stage pre`.
7. Apply only `0060_remove_legacy_billing_provider.sql` after the compatible Worker is live.
8. Verify row counts, Dodo linkage, and legacy billing schema removal after `0060` with `SAFE_DEPLOY_APPROVED=d1 npm run d1:cleanup-0060:evidence -- --remote --stage post`.
9. Rerun billing/prod smokes and canaries after the cleanup migration.

## Rollback

- Before `0060`: rollback by redeploying the previous Worker version if auth, billing, checkout, Search V2, Presence, dashboard, API/MCP, Agency gating, public copy, or provider timeout behavior regresses.
- After `0060`: do not redeploy older code that expects retired-provider tables or columns. Roll forward or restore from the fresh D1 backup/export if the cleanup migration causes a data/schema issue.
- Keep Agency checkout open while nightly dispatch failures stay at zero and real scan failures remain explainable.
- Keep Slack and WhatsApp dormant unless a future verified product decision reintroduces them.

## PR Command

Use this body when explicit protected-command approval is given:

```sh
SAFE_DEPLOY_APPROVED='gh pr create' gh pr create --repo Nishfleet/0509 --base main --head codex/final-self-serve-ga-hardening-20260625 --title "fix(launch): close final self-serve SaaS gaps" --body-file docs/final-self-serve-ga-pr-body.md
```
