# CI Gates Ledger

Decision (Nish, 2026-09-11, issue #2994): "only keep the relevant ones duhh."

This file is the reference every time someone wants to **add** a gate: a new gate
needs a row here with a **named incident** (issue link) or a **standing rule**
(vault `global-standing-rules.md`) behind it. "It seemed prudent" is DELETE.

Standing rules that earn a gate (cited per row below):

- **R1 restore-evidence** — restore evidence must exist and be proven before any
  migration/deploy mutation (vault global-standing-rules.md).
- **R2 secret scanning** — no secret reaches a public repo or a runner log.
- **R3 nothing-fails-silently** — every scheduled job monitors its own freshness
  or has a monitor that does.
- **R4 reversibility-over-gating** — a merge must be as undoable as a deploy
  (Nish, canonical; enforced by auto-revert).
- **R5 independent verifier integrity** — required verifiers may not self-certify
  their own definitions (sol-sweep finding; Nish 2026-08-25 "no agent runs amok
  and bypasses our quality gates").

## Target shape

- **One required PR job** (`ci.yml`, path-gated where the check is path-scoped):
  typecheck + node tests + build + Gitleaks + Dependabot-critical + the
  verifier-integrity claim check. One `codex-node-checks` context, not four.
- **One nightly canary job** (provider / billing / proof / email canaries, plus
  the SEO/meta canaries) — scheduled, non-blocking, monitored for staleness (R3).
- **Deploy production kept, trimmed** to the steps that have incidents behind
  them (R1);
- **One admin attestation path, not two** (or none on non-workflow diffs).
- Everything else: visibility-only or deleted, with the deleting PR carrying its
  ledger row.

## Baseline (BEFORE numbers, measured 2026-09-11)

- Median PR `ci.yml` wall-clock: **4.2 min** (n=134 recent pull_request runs),
  p90 **16.8 min**.
- PR-blocking contexts observed on CI: `Gitleaks`, `codex-node-checks`,
  `codex-node-checks-shard-2`, `codex-node-checks-shard-3`,
  `codex-node-checks-shard-4`, `dependabot-critical-check` — **6 required
  contexts** produced by PR CI, plus integrity gates compiled in on top
  (`required-verifier-integrity`, `gate-integrity`).
- 26 workflow files, 5,093 lines of workflow YAML; `deploy-production.yml` alone
  728 lines / 6 jobs.

## The table

| Gate / workflow | What it blocks | Justification (named incident / rule) | Cost per PR | Disposition |
| --- | --- | --- | --- | --- |
| `ci.yml` `codex-node-checks` (+3 shards) | Untested code reaching main | Standing: nothing merges untested | ~4.2 min median per PR, ×4 shard overhead | **MERGE-INTO** one `codex-node-checks` required context (single job or matrix with one context name) |
| `ci.yml` `dependabot-critical-check` | Open critical Dependabot alerts on direct deps | Standing: critical dep vulns block merge | ~1 min (step-gated) | **KEEP** (in the one PR job) |
| `ci.yml` `release-proof` | Merge-group batch without Gate-B release proof | Incident #2840: batch suspiciously short carrier era | Only in merge_group | **KEEP** |
| `secret-scan.yml` (Gitleaks) | Secrets in the repo | R2 secret scanning (holding rule) | ~1 min | **KEEP** (merge into the one PR job, keep the writer/authorizer intact) |
| `required-verifier-integrity.yml` | PR touching the verifier definitions self-certifying; unverified admin bypasses | Incident: PR #694 changed both required-context producers and self-succeeded; Nish 2026-08-25 | ~1–2 min (compile + diff-owned heuristic) | **KEEP** — this is the P10-B seatbelt |
| `required-verifier-integrity.yml` `verifier-attest:` | Admin-only fast path for verifier-definition changes | Owner decision Nish 2026-08-20; head-sha-pinned so any push invalidates | Conditional | **KEEP** (sha-pinned, non-additive) |
| `gate-integrity.yml` | Gate-bypass *moves* RVI cannot see (copies, driver-step swaps) | Nish 2026-08-25 ("cover all our bases"); fleet-ops#828 / 0509#1273 prose-attest shape | ~1 min compile + diff gate | **KEEP** detector, **MERGE-INTO** `required-verifier-integrity` — one integrity workflow files both, and the second admin attestation (`gate-integrity-attest:`) is dropped; two admin attestations per push is not acceptable |
| `deploy-production.yml` (730 lines, 6 jobs) push-to-main deploy + Gate A/B/C + restore-evidence + ledger | Undeployable or unrestorable state reaching prod | R1 restore-evidence-before-migrations (incidents: scratch-restore kill #630, deploy drift 0509 .lane reports, #2840 gate-B, #2975 concurrency) | Runs only on main | **KEPT, TRIMMED** (#3070): step audit table below — every surviving step names an incident/rule or is pinned by the gate tests; only `- name: Typecheck` (a duplicate of the deploy plan's `launch_readiness` typecheck) had none and was deleted |
| `preview-assert.yml` | Merge lands a diff that fails the release assertion on main | Incident 0509#1576: 9 of 120 merges auto-reverted because the assertion ran only after merge | Path-gated (PR #1580 lesson) ~5 min | **KEEP** |
| `auto-revert.yml` | Red main after merge | R4 reversibility (Nish canonical) | Runs on failure only | **KEEP** |
| `auto-merge-arm.yml` | Un-armed merges / merge-queue misuse | fleet-ops#1457, #3532 | ~1 min, PR events only | **KEEP** |
| `review-gate.yml` | Greptile review budget burn | Incident 2026-08-03: 50/month budget ran dry across 185 PRs/30d | Conditional (`review:deep` only) | **KEEP** |
| `semgrep-actionlint.yml` | Malformed/miswritten workflow + TS checks | Purpose-built for the smallest-diff rule (fork-guard authorizers); not yet a required context | ~2 min per PR | **MERGE-INTO** the one PR job as a path-gated step (`.github/**`) so it is one context, not a fourth workflow |
| `content-quality.yml` (Vale) | Prose regressions repo-wide | Incident #1728 | Full-tree Vale on every PR | **KEEP**, path-gate to `docs/**`, `.vale/**`, `app/**/*.md` |
| `quality-ratchet.yml` | Sentence-length ceiling drift | Incident #1728 | Weekly on main | **KEEP** |
| `ratchet-auto-tighten.yml` | Design-system banned-marker drift | Background: monotone ratchet purpose; separate ceiling for markers in `app/` | Weekly on main | **MERGE-INTO** `quality-ratchet.yml` — one weekly ratchet workflow, two ratchet scripts |
| `cross-browser-matrix.yml` | (nothing blocking — diagnostic) | Diagnostic only, nightly | Nightly | **KEEP** as nightly diagnostic (does not belong in the PR path) |
| `stale-unarmed-prs.yml` | Forgotten PRs drifting unarmed | fleet-ops#4146 replacement; nudge only, never closes | Daily, non-blocking | **KEEP** |
| `uptime-health.yml` | Production down unnoticed | Runtime-described: the 5-min Actions cron was never real liveness (median 63 min, 300 obs 2026-07-25..08-11); VPS systemd timer owns liveness now | 0 by default (dispatch-only) | **DELETE** the file — the 0509-liveness systemd timer is the detector; a dispatch-only workflow is dead weight (deletion PR carries this row) |
| `ads-prog-seo-canary.yml` | /ads/:domain union regression (noindex/sitemap parity) | Issue #1455 (BET 5 surface-live bet) | Nightly | **KEEP** (nightly canary row of the target shape) |
| `meta-discovery-canary.yml` | Meta discovery / full-site run liveness | Issue #2110 | Nightly | **KEEP** |
| `market-signal-snapshot.yml` | Missing daily market-signal D1 snapshot | Incident: cron OAuth expiry left it stale 5 mornings (PR #557) | Daily | **KEEP** |
| `market-signal-snapshot-age.yml` | A missed daily snapshot being silent | R3 + issue #1894 (2026-09-06 miss) | Daily | **KEEP** |
| `d1-backup-r2.yml` | No restorable D1 backup | R1 | Daily | **KEEP** |
| `d1-backup-validate.yml` | Broken backup tooling in a PR | R1 (validated tooling) | Path-gated to backup scripts/wrangler.jsonc | **KEEP** |
| `d1-remote-restore-evidence.yml` | Deploy without proved restore | R1 (#2975 per-lane concurrency fix) | On deploy cadence | **KEEP** |
| `d1-restore-proof-auto-refresh.yml` | Backup proof going stale between restores | R1 | Daily | **KEEP** — candidate to MERGE-INTO `d1-backup-r2`'s schedule; the deletion PR decides with one cron |
| `finalize-production-soak.yml` | Un-halting a deploy without soak proof | Gate C (deploy-production-gate tests) | Dispatch-only post-deploy | **KEEP** |
| `backlog-console-refresh-test.yml` | Regression in automation/backlog-console/refresh.sh | Left its own file deliberately to keep the protected-verifier files untouched; hermetic, path-scoped | Disposable-path PRs | **MERGE-INTO** the one PR job as an additional path-gated job |
| `launch:readiness` npm chain | Ship-block readiness pipeline | Standing pre-launch proof; `:predeploy` variant exists | Manual | **KEEP** (script, not a gate); documenting only — do not delete |
| `legacy/` (Supabase-era reference) | Nothing (not in the build) | README: "not part of the live build" | 0 | **KEEP as archive** (marked, documented) — zero CI cost; deleting is optional cleanup |
| `.lane/reports/` (179 files) | Nothing (audit trail) | Standing: lane reports are the audit artifact for gate decisions | 0 (docs) | **KEEP**; future reports go to `archive/lane/` so the live tree stays small |
| Admin attestations `verifier-attest:` + `gate-integrity-attest:` | Admin fast-path for verifier/gate diffs | verifier-attest: Nish 2026-08-20; gate-attest: duplicate detector | Conditional | **MERGE-INTO**: one attestation marker (`verifier-attest:`) parsed by the single integrity workflow; non-workflow diffs need no attestation |

## Deletion batches (small PRs, each carries its row)

1. **DELETE `uptime-health.yml`** (row above; VPS systemd timer owns liveness).
2. **MERGE-IN**: shards→one `codex-node-checks` context; `semgrep-actionlint` +
   `backlog-console-refresh-test` → path-gated steps in the one PR job;
   `content-quality` path-gated; `ratchet-auto-tighten` → one ratchet workflow;
   integrity attest → single marker.
3. **TRIM `deploy-production.yml`** — DONE in #3070: the audit of every named
   step is the table below. Exactly one step (`- name: Typecheck`) had no
   incident behind it and was deleted. Every other step either names an
   incident/rule or is pinned by `deploy-production-gate.test.ts` and
   `production-candidate-workflow.test.ts` (step names, ordering, and run lines
   are asserted there), so deleting it would weaken an encoded gate.

### Deploy production step audit (issue #3070)

Costs measured on run 34380544970 (last green deploy, 2026-09-09); steps not
listed under a job's own name are runner scaffolding (checkout, setup-node,
`npm ci`, `validate-d1-backup.mjs`) and stay because the job's pinned steps need
them.

| Step (job) | Incident / rule | Cost | Disposition |
| --- | --- | --- | --- |
| `Authorize release request` (authorize_release) | Exact-SHA release barrier (#480/#484); dispatch-resolution incident 2026-08-13 (2c6cc3eb); push auto-deploy (Nish 2026-08-25) | ~3 s | KEEP |
| `Verify and pin exact main candidate` (pin_candidate) | #630 CAS + #2701 forward-drift tolerance | ~8 s | KEEP |
| `Verify pinned candidate before deploy work` (prepare) | Deploy-drift re-verify; run line test-pinned | <5 s | KEEP |
| `Bind restore evidence archive path` (prepare) | R1 evidence chain; run content test-pinned | <1 s | KEEP |
| `Bind a clean exact-main candidate manifest` (prepare) | R1 + pinned-SHA manifest binding | <5 s | KEEP |
| `Verify pre-generated exact R2 restore evidence` (prepare) | R1; run 32232488597 bootstrap anchor | ~20 s | KEEP |
| `Preserve private restore evidence for this deploy only` (prepare) | R1 private-evidence retention | ~1 s | KEEP |
| `Remove local restore evidence archive` (prepare) | Secret-material hygiene on the runner | <1 s | KEEP |
| `Verify authorized evidence checkout` (generate) | Detached-HEAD pinned-tree proof before evidence mutation (#630 lineage) | <1 s | KEEP |
| `Bind run-scoped backup directory` (generate, cleanup) | Run-scoped plaintext quarantine; test-pinned | <1 s | KEEP |
| `Reconfirm frozen main before evidence mutation` (generate) | Drift CAS immediately before provider mutation (#556/#630) | <5 s | KEEP |
| `Create fresh backup and prove an isolated remote restore` (generate) | R1 — the restore drill itself; #630 scratch-kill | ~3 min when it runs | KEEP |
| `Remove run-scoped plaintext backup files` (generate) | Plaintext-backup hygiene; test-pinned | <5 s | KEEP |
| `Archive permission-preserving restore evidence` (generate) | R1 permission-preserved packaging | <5 s | KEEP |
| `Preserve private restore evidence` (generate) | R1 evidence retention | ~5 s | KEEP |
| `Verify authorized cleanup checkout` (cleanup) | Same pinned-tree proof for the cleanup mutation | <1 s | KEEP |
| `Delete every exact scratch database from this run` (cleanup) | #630 — a lost runner must not park production scratch DBs | ~20 s | KEEP |
| `Verify pinned candidate before repository and secret work` (deploy) | Drift re-verify at deploy-job start; position + env test-pinned | <1 s | KEEP |
| `Verify Cloudflare deploy secrets` (deploy) | Fail-fast secret preflight; position + env test-pinned | <1 s | KEEP |
| `Install dependencies` (deploy) | Prerequisite for every later step | ~11 s | KEEP |
| `Install Playwright browsers` (deploy) | Incident f2e194184 (deploy-gate browser installs); the plan's `e2e:local:release` + 3-engine diagnostic need them | ~14 s | KEEP |
| `Typecheck` (deploy) | None for a discrete step — `launch:readiness:predeploy` inside `Deploy` re-runs `npm run typecheck`. Its NODE_OPTIONS heap fix (exit-134, 2026-08-11) targeted the retired 3 GiB VPS runner; the plan's uncapped typecheck passes on every green hosted deploy (run 34380544970) so the fix needs no re-home | 62 s | **DELETE** |
| `Test` (deploy) | Position-pinned by the gate test + auto-revert assertion anchor (0509#1576). Duplicates the plan's `npm test` (194 s) — noted cost, kept per no-gate-weakening | 194 s | KEEP |
| `Materialize private remote-restore evidence` (deploy) | R1 evidence handoff; content test-pinned | ~1 s | KEEP |
| `Verify and extract private remote-restore evidence` (deploy) | R1 archive integrity (single member, chmod 600) | ~1 s | KEEP |
| `Reconfirm frozen main before provider mutation` (deploy) | #556/#630 drift; test-pinned to sit as `Deploy` − 1 | <1 s | KEEP |
| `Deploy` (deploy) | The release gate itself — plan re-runs launch_readiness, readiness evidence, Gate B/C, and its own CAS before `wrangler deploy` | ~17.5 min | KEEP |
| `Synchronize Worker secrets` (deploy) | Runs 32854505876 / 31514742997 (secret-put ordering + versions-API breakage) | ~2 s | KEEP |
| `Verify complete release evidence set` (deploy) | Runs 29767292426 / 29804405475 (flaky diagnostic manifests counted as real) | <1 s | KEEP |
| `Record the deploy in the on-main ledger` (deploy) | #2975 last-resort anchor chain | ~1 s | KEEP |
| `Archive permission-preserving release evidence` (deploy) | R1 release-evidence packaging | ~1 s | KEEP |
| `Preserve release evidence` (deploy) | R1 90-day retention | ~2 s | KEEP |
| `Preserve private immediate Gate C evidence` (deploy) | Gate C deferred-release immediate-only semantics (judge 0509#2241) | ~1 s, deferred path only | KEEP |
| `Preserve failed release diagnostics` (deploy) | R3 — a failed deploy must not fail silently | 0 on green | KEEP |
| `Emit deploy-age measure line` (deploy) | #2975 item 4 stalled-deploy detector | <1 s | KEEP |
| `Emit deploy-chain progress line` (deploy) | #2975 reopened-accept chain detector | <1 s | KEEP |

Note for the next auditor: `auto-revert.yml`'s assertion classifier still lists
`"Typecheck"` — the string is test-pinned there, so it stays; after this trim a
typecheck failure inside the plan surfaces under the `Deploy` step, which the
same classifier already treats as an assertion step, so revert semantics are
unchanged.

Each deletion PR must update the branch-protection required-check list in the
same PR (an orphaned required check blocks main forever — the incident the
`deploy-production-gate.test.ts` history encodes) and record the measured
**after** median PR CI wall-clock and required-check count on this ledger's
"after" table below.

Where the "after" row lands safe: the **after** table is filled by the respective
deletion PR (this unit only owns the baseline + the table + the batch issues).

## After table

Fill per deletion batch when merged:

| PR | before (median PR CI min, required contexts) | after | delta |
| --- | --- | --- | --- |
| #3070 trim (deploy-production.yml) | Deploy Worker job 22.5 min — run 34380544970, 2026-09-09 | pending first green post-merge run (deploy chain red on #3174 stale-ledger blocker); expected ≈21.4 min | −62 s (Typecheck duplicate removed) |
| (pending) | | | |
