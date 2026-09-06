# Final Self-Serve GA Scorecard

Last updated: 2026-07-13 (dated snapshot; current Gate B/C refresh pending)

## Verdict

Historical release verdict (2026-07-02 snapshot): SCOUT/STARTER MONTHLY AND ANNUAL, TOP-UPS, AND AGENCY SELF-SERVE RELEASED. This scorecard is not a current Gate B/C or Gate D pass.

Current Gate A–C release readiness is **0/6**: all six journeys remain active, four frozen candidates remain blocked, subset fingerprints are historical/local-only, and the final all-six exact candidate, review, and Gate C proof remain open.

The dated fixed-candidate/live evidence verified Scout, Starter, and Agency deployment surfaces with Dodo checkout, top-ups, webhook grants, email proof, pricing preview, public copy, API/MCP Slack removal, and Agency fan-out dispatch covered by tests and live canaries. Monthly checkout, annual checkout, and top-ups passed the dated live Dodo preview canary in IN, US, and GB. Scout/Starter monthly and annual products use Dodo's documented by-currency localized pricing mode where fixed USD/GBP amounts are needed, while INR remains the corrected base price. Dodo Product Collection membership is configured for Scout/Starter monthly and annual products, and the repo has owner-only in-app plan switching through Dodo's documented subscription plan-change preview/change endpoints. Backup scheduling and an uptime health workflow are repo-configured; dated workflow runs passed, and a fresh owner-operated D1-to-R2 backup uploaded successfully on 2026-07-02. GitHub backup secrets and the first successful Actions backup were completed on 2026-07-13 (dispatch run `29225583866`); future scheduled observation, remote-scratch restore, uptime alert receipt, and other external proof remain open.

Evidence lanes: fixed-candidate and local verification are historical below; a candidate without immutable fingerprint or required evidence is review-blocked; Gate B requires current deterministic browser/restore/postflight evidence; Gate C requires current provider, scheduled-workflow, alert, dashboard, deployed-version and cleanup proof; Gate D is target-buyer market validation only.

## Baseline

| Item | Result |
| --- | --- |
| Release branch | `codex/final-self-serve-ga-hardening-20260625` |
| Starting main commit | `ed109a9` |
| Merged main commit | `629fb14` (`Merge pull request #251`) |
| Current `main` vs `origin/main` | Matched after PR #271 merge and production deploy provenance; original self-serve GA release code merge was `629fb14` |
| Pull request | #251 merged on 2026-06-27 |
| Worker deploy | Latest commercial proof-gate deploy: `0e6e55ed-0f7a-44da-a25c-9a9e817fd918`, serving version `03a448ee-de75-4688-a56d-312f63de6c6e` at 100% |
| Fresh release backup | Timestamped object under the private R2 backup prefix confirmed |
| Fresh post-cleanup backup | Timestamped objects under the private R2 backup prefix confirmed, including a 2026-07-02 owner-operated backup after migration `0062` |
| Production domains from repo config | `.io` primary domains plus `.in` redirect compatibility routes |
| Monitoring mode from repo config | `fanout`; global fan-out enabled |
| Presence rollout from repo config | Website GA; digest, X, Reddit, and LinkedIn disabled |
| Agency state | Available for checkout after live dispatch proof |

## Historical Verification Matrix (2026-07-02 snapshot)

| Check | Result | Evidence |
| --- | --- | --- |
| Full unit/integration tests | PASS | `npm test`: 165 files, 1641 tests |
| Typecheck | PASS | `npm run typecheck` |
| Production build | PASS | `npm run build` |
| Dependency audit | PASS | `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities |
| Backup validator | PASS local dry-run (2026-07-02 snapshot) | `node scripts/validate-d1-backup.mjs`; dated snapshot reached migration `0062_dodo_plan_change_pending_target.sql`; current validation must derive the latest repo migration dynamically |
| D1-to-R2 scheduled workflow | PROVEN ON 2026-07-13 / FUTURE OBSERVATION OPEN | 2026-07-02 manual `npm run backup:d1:r2` uploaded a fresh private R2 object while secrets were absent; 2026-07-13 dispatch run `29225583866` completed validation, export, and upload after `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` were added |
| Uptime health workflow | SCHEDULED PASS / ALERT UNPROVEN | `.github/workflows/uptime-health.yml` checks `https://0509.io/api/health` on an offset five-minute schedule without secrets; manual run `28540913266` and scheduled runs `28548096175`, `28552452662`, and `28555610571` passed on `main`; GitHub failure-notification routing still needs owner/operator confirmation |
| Restore drill | PASS LOCAL / REMOTE SCRATCH OPEN | Post-cleanup backup imported into isolated SQLite; aggregate schema, migration-ledger, plan, Dodo linkage, and retired-provider invariants passed. A production-like remote scratch restore remains required |
| Diff whitespace | PASS | `git diff --check HEAD` |
| Autoreview | PASS | Final staged autoreview clean; no accepted/actionable findings |
| Retired billing provider surface | PASS | Routes, helpers, env typing, tests, active docs, historical setup migrations, and fresh-start schema references removed; `0060` converges already-created remote schema artifacts to Dodo-only billing fields after deploy |
| Local D1 migration list | LOCAL ONLY | Local simulator reports pending `0053`-`0060` from prior local state |
| Remote D1 migration list | PASS ON DATED SNAPSHOT | Migration `0062_dodo_plan_change_pending_target.sql` applied remotely before that deploy; no migrations remained afterward. Current Gate B/C must rerun the migration sync against the current ledger |
| D1 cleanup evidence | PASS | Aggregate pre/post evidence preserved plan rows and Dodo linkage; post evidence shows no legacy billing columns and no retired-provider webhook table |
| Pricing canary | PASS | Live Dodo pricing canary reached IN, US, and GB previews; monthly, annual, and top-ups pass for Scout/Starter annual validation and all public top-up packs; redacted Dodo API product proof confirmed Scout/Starter monthly and annual products are `by_currency` with active USD/GBP localized rules |
| Billing canary | PASS | Dodo signed-webhook plan/top-up canary passed and cleanup passed |
| Proof/email canary | PASS | Launch proof canary passed with email delivery |
| Production canary | PASS | Health on primary domains, fresh-live search, ops readiness, and Meta ads beta passed |
| Provider bakeoff launch gate | PASS/PARTIAL | Current live provider passed all launch queries; optional alternate providers skipped because their credentials are absent |
| Full launch readiness script | PASS ON DATED SNAPSHOT | `npm run launch:readiness` passed after the Dodo Scout/Starter monthly and annual by-currency localized pricing repair; not a current candidate result |
| Presence website canary | PASS | `npm run canary:presence` now follows the current GA rollout and runs without requiring the old internal workspace id |
| Agency fan-out proof | DATED PASS DISPATCH / EXTERNAL SCAN WATCH | Local fan-out tests passed; the dated production cron queued 78 fan-out jobs for the internal Agency-scale proof workspace with 0 dispatch failures and 8 max concurrency slots; synthetic proof watchlists were deactivated after proof |
| Cloudflare Email visibility | PARTIAL | Fresh proof canary sent email and aggregate D1 shows recent Cloudflare Email sends; dashboard Email Service Logs/Activity still needs owner/browser confirmation |
| WhatsApp stored target review | REVIEWED / PRESERVE | Aggregate-only review found stale unsupported WhatsApp target/config rows and no send-attempt evidence; no deletion performed |

## Product Contract

| Requirement | Status | Notes |
| --- | --- | --- |
| Scout sellable self-serve | Monthly and annual verified on dated candidate | Dodo monthly and annual checkout, plan copy, pricing preview, webhook grant, and canary covered |
| Starter sellable self-serve | Monthly and annual verified on dated candidate | Daily monitoring/daily+weekly digest copy plus monthly and annual checkout paths covered |
| Top-ups self-serve | Verified in dated branch evidence | Existing Dodo products, grants, cleanup, and non-expiring copy covered |
| Agency sellable | Historical dated release only; current A–C open | Dated live dispatch proof passed, but current scan-health, exact-candidate review, all-six Gate B and deployed Gate C remain open |
| Email delivery | Verified on dated proof | Email proof canary passed |
| Slack public/API/MCP surface | Removed from GA surfaces | Dormant implementation preserved behind product gates |
| WhatsApp public surface | Hidden | Dormant implementation preserved; readiness and launch blockers gated off while non-GA |
| Presence website/blog | GA in dated repo config and copy | X, Reddit, and LinkedIn remain disabled |
| Billing management | Repo-configured self-serve | Hosted portal route works for portal tasks, and owner-only in-app plan switching uses Dodo's documented plan-change preview/change endpoints; a 2026-07-02 aggregate remote D1 check found no linked Scout/Starter subscriptions, so one internal paid subscription is still needed before claiming real-customer plan-change proof, and cancellation remains portal/support-backed until checked |
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

1. Create or identify one internal paid Scout/Starter subscription, then verify in-app Dodo plan switching, signed webhook account update, and cancellation availability in the hosted portal.
2. Confirm the uptime failure-notification path, or keep/add UptimeRobot as the stronger independent external monitor for `https://0509.io/api/health`.
3. Observe a future scheduled D1-to-R2 run and decide R2 retention; the first successful Actions backup was dispatch run `29225583866` on 2026-07-13.
4. Monitor the next nightly fan-out window for dispatch failures and real-customer scan completion; the dated dispatch proof did not establish customer-quality scan completion.
5. Confirm Cloudflare Email activity/log visibility in the Cloudflare dashboard.
6. Preserve unsupported WhatsApp stored targets unless owner approves a backup-backed anonymization/cleanup.
7. Clean up retired provider dashboard artifacts: old webhooks, subscriptions, payment links, and live products.

## Non-Exposure Confirmation

This scorecard intentionally omits secrets, provider ids, Dodo product ids, customer ids, webhook URLs, canary record ids, and customer data.
