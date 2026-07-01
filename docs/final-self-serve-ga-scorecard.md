# Final Self-Serve GA Scorecard

Last updated: 2026-07-02

## Verdict

Current live verdict: SCOUT/STARTER MONTHLY AND ANNUAL, TOP-UPS, AND AGENCY SELF-SERVE RELEASED.

Scout, Starter, and Agency are deployed and verified on the live Worker with Dodo checkout, top-ups, webhook grants, email proof, pricing preview, public copy, API/MCP Slack removal, and Agency fan-out dispatch covered by tests and live canaries. Monthly checkout, annual checkout, and top-ups pass the live Dodo preview canary in IN, US, and GB. Scout/Starter monthly and annual products use Dodo's documented by-currency localized pricing mode where fixed USD/GBP amounts are needed, while INR remains the corrected base price. Dodo Product Collection membership is now configured for Scout/Starter monthly and annual portal plan changes. Backup scheduling and an uptime health workflow are now repo-configured, and restore proof exists locally, but GitHub backup secrets, the first scheduled backup run, and the first scheduled uptime alert path remain owner-controlled. The remaining gaps are owner/dashboard/operator actions: Dodo subscription-update dashboard confirmation, first uptime workflow run/notification proof or UptimeRobot confirmation, Cloudflare Email dashboard visibility, and retired-provider dashboard cleanup.

## Baseline

| Item | Result |
| --- | --- |
| Release branch | `codex/final-self-serve-ga-hardening-20260625` |
| Starting main commit | `ed109a9` |
| Merged main commit | `629fb14` (`Merge pull request #251`) |
| Current `main` vs `origin/main` | Matched after PR #271 merge and production deploy provenance; original self-serve GA release code merge was `629fb14` |
| Pull request | #251 merged on 2026-06-27 |
| Worker deploy | Latest commercial proof-gate deploy: `ad02524f-866a-4ef8-b2b6-d58040e94679`, serving version `cab91367-2fe1-46df-845e-33ec104186c2` at 100% |
| Fresh release backup | Timestamped object under the private R2 backup prefix confirmed |
| Fresh post-cleanup backup | Timestamped object under the private R2 backup prefix confirmed |
| Production domains from repo config | `.io` primary domains plus `.in` redirect compatibility routes |
| Monitoring mode from repo config | `fanout`; global fan-out enabled |
| Presence rollout from repo config | Website GA; digest, X, Reddit, and LinkedIn disabled |
| Agency state | Available for checkout after live dispatch proof |

## Verification Matrix

| Check | Result | Evidence |
| --- | --- | --- |
| Full unit/integration tests | PASS | `npm test`: 143 files, 1336 tests |
| Typecheck | PASS | `npm run typecheck` |
| Production build | PASS | `npm run build` |
| Dependency audit | PASS | `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities |
| Backup validator | PASS local dry-run | `node scripts/validate-d1-backup.mjs`; latest repo migration `0060_remove_legacy_billing_provider.sql` |
| D1-to-R2 scheduled workflow | REPO CONFIGURED / OWNER SECRET | `.github/workflows/d1-backup-r2.yml` runs weekly/manual backup through `npm run backup:d1:r2`; required GitHub Cloudflare secrets were not listed locally, so first scheduled run is unproven; D1 export blocking risk documented |
| Uptime health workflow | REPO CONFIGURED / FIRST RUN UNPROVEN | `.github/workflows/uptime-health.yml` checks `https://0509.io/api/health` every 5 minutes and can be run manually without secrets; first scheduled run and GitHub failure-notification routing still need owner/operator confirmation |
| Restore drill | PASS local | Post-cleanup backup imported into isolated SQLite; aggregate schema, migration-ledger, plan, Dodo linkage, and retired-provider invariants passed |
| Diff whitespace | PASS | `git diff --check HEAD` |
| Autoreview | PASS | Final staged autoreview clean; no accepted/actionable findings |
| Retired billing provider surface | PASS | Routes, helpers, env typing, tests, active docs, historical setup migrations, and fresh-start schema references removed; `0060` converges already-created remote schema artifacts to Dodo-only billing fields after deploy |
| Local D1 migration list | LOCAL ONLY | Local simulator reports pending `0053`-`0060` from prior local state |
| Remote D1 migration list | PASS | No migrations to apply after `0060_remove_legacy_billing_provider.sql` |
| D1 cleanup evidence | PASS | Aggregate pre/post evidence preserved plan rows and Dodo linkage; post evidence shows no legacy billing columns and no retired-provider webhook table |
| Pricing canary | PASS | Live Dodo pricing canary reached IN, US, and GB previews; monthly, annual, and top-ups pass for Scout/Starter annual validation and all public top-up packs; redacted Dodo API product proof confirmed Scout/Starter monthly and annual products are `by_currency` with active USD/GBP localized rules |
| Billing canary | PASS | Dodo signed-webhook plan/top-up canary passed and cleanup passed |
| Proof/email canary | PASS | Launch proof canary passed with email delivery |
| Production canary | PASS | Health on primary domains, fresh-live search, ops readiness, and Meta ads beta passed |
| Provider bakeoff launch gate | PASS/PARTIAL | Current live provider passed all launch queries; optional alternate providers skipped because their credentials are absent |
| Full launch readiness script | PASS | `npm run launch:readiness` passed after the Dodo Scout/Starter monthly and annual by-currency localized pricing repair |
| Presence website canary | PASS | `npm run canary:presence` now follows the current GA rollout and runs without requiring the old internal workspace id |
| Agency fan-out proof | PASS dispatch / WATCH scan health | Local fan-out tests passed; production cron queued 78 fan-out jobs for the internal Agency-scale proof workspace with 0 dispatch failures and 8 max concurrency slots; synthetic proof watchlists were deactivated after proof |
| Cloudflare Email visibility | PARTIAL | Fresh proof canary sent email and aggregate D1 shows recent Cloudflare Email sends; dashboard Email Service Logs/Activity still needs owner/browser confirmation |
| WhatsApp stored target review | REVIEWED / PRESERVE | Aggregate-only review found stale unsupported WhatsApp target/config rows and no send-attempt evidence; no deletion performed |

## Product Contract

| Requirement | Status | Notes |
| --- | --- | --- |
| Scout sellable self-serve | Monthly and annual verified | Dodo monthly and annual checkout, plan copy, pricing preview, webhook grant, and canary covered |
| Starter sellable self-serve | Monthly and annual verified | Daily monitoring/daily+weekly digest copy plus monthly and annual checkout paths covered |
| Top-ups self-serve | Verified in branch | Existing Dodo products, grants, cleanup, and non-expiring copy covered |
| Agency sellable | Open | Live dispatch proof passed; keep monitoring nightly scan health and dispatch failures |
| Email delivery | Verified | Email proof canary passed |
| Slack public/API/MCP surface | Removed from GA surfaces | Dormant implementation preserved behind product gates |
| WhatsApp public surface | Hidden | Dormant implementation preserved; readiness and launch blockers gated off while non-GA |
| Presence website/blog | GA in repo config and copy | X, Reddit, and LinkedIn remain disabled |
| Billing portal | Partial self-serve | Hosted portal route works in code and Dodo Product Collection membership is configured for Scout/Starter monthly and annual products; plan changes/cancellation remain support-backed until the Dodo subscription-update dashboard setting and portal behavior are verified |
| Trust/backup wording | Truthful in branch | Public trust copy limited to dry-run validation and owner-operated backup posture |
| Provider/network timeouts | Improved | Shared timeout/bounded-response helpers and regression tests added across touched hot paths; stalled Cloudflare Email sends now move to pending/provider-unknown rather than retryable failure |
| Retired billing provider | Removed from runtime and remote schema | Routes, helpers, env typing, tests, active docs, lookup index, live code references, fresh-start setup migrations, legacy remote plan columns, and retired-provider webhook table removed |

## Follow-up Hardening Notes

- Cloudflare Email delivery now has an explicit application timeout with regression coverage for a never-resolving provider send; stalled sends are recorded as pending/provider unknown, not retryable failures. Fresh app-side proof exists, but Cloudflare dashboard log visibility is still owner-confirmed.
- Older top-up billing docs now point to the current final-GA truth: configured Dodo checkout and signed-webhook canary coverage are verified, while checkout still fails closed if required product mappings are absent.
- Fresh-start migration replay no longer creates retired-provider setup artifacts. Migration `0060` removed already-created remote schema artifacts after the compatible Worker was deployed.
- Backup output now redacts temporary signed export URLs, a weekly GitHub Actions workflow exists, and a post-cleanup local SQLite import smoke passed.

## Remaining Owner Actions

The live release still has these owner/operator actions:

1. Enable and confirm the Dodo subscription-update dashboard setting, then verify plan-change and cancellation behavior in an internal customer portal session.
2. Confirm the first scheduled uptime workflow run and failure-notification path, or keep/add UptimeRobot as the stronger independent external monitor for `https://0509.io/api/health`.
3. Add GitHub Cloudflare secrets for the scheduled D1-to-R2 backup workflow, run it once, confirm a new R2 object, and decide R2 retention.
4. Monitor the next nightly fan-out window for dispatch failures and real-customer scan completion.
5. Confirm Cloudflare Email activity/log visibility in the Cloudflare dashboard.
6. Preserve unsupported WhatsApp stored targets unless owner approves a backup-backed anonymization/cleanup.
7. Clean up retired provider dashboard artifacts: old webhooks, subscriptions, payment links, and live products.

## Non-Exposure Confirmation

This scorecard intentionally omits secrets, provider ids, Dodo product ids, customer ids, webhook URLs, canary record ids, and customer data.
